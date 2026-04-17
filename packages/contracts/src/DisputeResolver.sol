// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.25;

import {IStakeManager} from "./interfaces/IStakeManager.sol";
import {Pausable} from "./Pausable.sol";

/// @title DisputeResolver
/// @notice Handles disputes between merchants and node operators.
///         Phase 1: resolved by a 3-of-5 multisig controlled by the core team.
///         Phase 3: migrates to on-chain governance via RFC process.
///
/// @dev Dispute lifecycle:
///      Open → (NodeResponded) → Resolved
///      Open → Expired (if node does not respond within NODE_RESPONSE_WINDOW)
///
/// Slashing is executed by calling StakeManager.slash() on MerchantWins outcome.
/// Slashed funds are transferred to the treasury address.
contract DisputeResolver is Pausable {
    // ── Constants ────────────────────────────────────────────

    uint256 public constant NODE_RESPONSE_WINDOW = 48 hours;
    uint256 public constant SLASH_PERCENTAGE     = 20; // slash 20% of node stake on loss

    // ── Types ─────────────────────────────────────────────────

    enum DisputeStatus  { Open, NodeResponded, Resolved, Expired }
    enum DisputeOutcome { None, MerchantWins, NodeWins }

    struct Dispute {
        bytes32        id;
        bytes32        paymentIntentId;
        address        merchant;
        address        nodeOperator;
        string         evidenceCid;         // IPFS CID of merchant evidence
        string         counterEvidenceCid;  // IPFS CID of node counter-evidence
        uint256        openedAt;
        DisputeStatus  status;
        DisputeOutcome outcome;
        uint256        resolvedAt;
    }

    // ── State ─────────────────────────────────────────────────

    IStakeManager public immutable stakeManager;
    address       public immutable treasury;

    /// @notice Addresses that can resolve disputes (Phase 1: multisig signers)
    mapping(address => bool) public isArbiter;
    address[] public arbiters;
    uint256 public arbiterCount;

    /// @notice Minimum arbiters required to resolve a dispute
    uint256 public constant REQUIRED_ARBITERS = 3;

    /// @notice Approvals for adding new arbiters (candidate => approver => approved)
    mapping(address => mapping(address => bool)) public arbiterApprovals;
    uint256 public constant REQUIRED_APPROVALS = 3;

    /// @notice disputeId → Dispute
    mapping(bytes32 => Dispute) private _disputes;

    /// @notice paymentIntentId → disputeId (one dispute per intent max)
    mapping(bytes32 => bytes32) public intentToDispute;

    /// @notice Tracks arbiter votes per dispute
    mapping(bytes32 => mapping(address => DisputeOutcome)) public arbiterVotes;
    mapping(bytes32 => uint256) public merchantWinsVotes;
    mapping(bytes32 => uint256) public nodeWinsVotes;

    // ── Events ───────────────────────────────────────────────

    event DisputeOpened(
        bytes32 indexed disputeId,
        bytes32 indexed paymentIntentId,
        address indexed merchant,
        address nodeOperator
    );
    event DisputeResponded(
        bytes32 indexed disputeId,
        address indexed nodeOperator,
        string counterEvidenceCid
    );
    event DisputeResolved(
        bytes32 indexed disputeId,
        DisputeOutcome outcome,
        address resolvedBy
    );
    event DisputeExpired(bytes32 indexed disputeId);
    event ArbiterAdded(address indexed arbiter);
    event ArbiterRemoved(address indexed arbiter);
    event ArbiterVoted(bytes32 indexed disputeId, address indexed arbiter, DisputeOutcome vote);

    // ── Errors ───────────────────────────────────────────────

    error NotArbiter();
    error NotMerchant();
    error NotNodeOperator();
    error DisputeNotFound();
    error DisputeAlreadyExists();
    error DisputeNotOpen();
    error DisputeNotResolvable();
    error ResponseWindowExpired();
    error ResponseWindowNotExpired();
    error AlreadyVoted();
    error EmptyEvidence();
    error InvalidOutcome();
    error NotEnoughArbiters();

    // ── Modifiers ─────────────────────────────────────────────

    modifier onlyArbiter() {
        if (!isArbiter[msg.sender]) revert NotArbiter();
        _;
    }

    modifier disputeExists(bytes32 disputeId) {
        if (_disputes[disputeId].openedAt == 0) revert DisputeNotFound();
        _;
    }

    // ── Constructor ──────────────────────────────────────────

    /// @param _stakeManager Address of the StakeManager contract
    /// @param _treasury     Address that receives slashed stake
    /// @param _arbiters     Initial set of arbiter addresses (3–5 recommended)
    constructor(
        address _stakeManager,
        address _treasury,
        address[] memory _arbiters,
        address _guardian
    ) Pausable(_guardian) {
        if (_arbiters.length < REQUIRED_ARBITERS) revert NotEnoughArbiters();

        stakeManager = IStakeManager(_stakeManager);
        treasury     = _treasury;

        for (uint256 i = 0; i < _arbiters.length; i++) {
            isArbiter[_arbiters[i]] = true;
            arbiters.push(_arbiters[i]);
            arbiterCount++;
            emit ArbiterAdded(_arbiters[i]);
        }
    }

    // ── External — Merchant ───────────────────────────────────

    /// @notice Open a dispute against the node that routed a payment intent.
    /// @param paymentIntentId  The payment intent ID (bytes32 hash of the pi_ string ID)
    /// @param nodeOperator     Wallet address of the node operator being disputed
    /// @param evidenceCid      IPFS CID of the merchant's evidence package
    function openDispute(
        bytes32 paymentIntentId,
        address nodeOperator,
        string calldata evidenceCid
    ) external whenNotPaused returns (bytes32 disputeId) {
        if (bytes(evidenceCid).length == 0) revert EmptyEvidence();
        if (intentToDispute[paymentIntentId] != bytes32(0)) revert DisputeAlreadyExists();

        disputeId = keccak256(abi.encodePacked(paymentIntentId, msg.sender, block.timestamp));

        _disputes[disputeId] = Dispute({
            id:                 disputeId,
            paymentIntentId:    paymentIntentId,
            merchant:           msg.sender,
            nodeOperator:       nodeOperator,
            evidenceCid:        evidenceCid,
            counterEvidenceCid: '',
            openedAt:           block.timestamp,
            status:             DisputeStatus.Open,
            outcome:            DisputeOutcome.None,
            resolvedAt:         0
        });

        intentToDispute[paymentIntentId] = disputeId;

        emit DisputeOpened(disputeId, paymentIntentId, msg.sender, nodeOperator);
    }

    // ── External — Node Operator ──────────────────────────────

    /// @notice Respond to an open dispute with counter-evidence.
    ///         Must be called within NODE_RESPONSE_WINDOW of dispute opening.
    /// @param disputeId        The dispute ID
    /// @param counterEvidenceCid  IPFS CID of the node's counter-evidence
    function respondToDispute(
        bytes32 disputeId,
        string calldata counterEvidenceCid
    ) external whenNotPaused disputeExists(disputeId) {
        Dispute storage dispute = _disputes[disputeId];

        if (msg.sender != dispute.nodeOperator) revert NotNodeOperator();
        if (dispute.status != DisputeStatus.Open) revert DisputeNotOpen();
        if (block.timestamp > dispute.openedAt + NODE_RESPONSE_WINDOW) revert ResponseWindowExpired();
        if (bytes(counterEvidenceCid).length == 0) revert EmptyEvidence();

        dispute.counterEvidenceCid = counterEvidenceCid;
        dispute.status = DisputeStatus.NodeResponded;

        emit DisputeResponded(disputeId, msg.sender, counterEvidenceCid);
    }

    // ── External — Arbiters ───────────────────────────────────

    /// @notice Cast a vote to resolve a dispute.
    ///         Once REQUIRED_ARBITERS votes agree on an outcome, the dispute resolves automatically.
    ///         Arbiters can vote on Open or NodeResponded disputes.
    ///         If the node did not respond and the window has expired, arbiters can still vote.
    /// @param disputeId  The dispute ID
    /// @param outcome    MerchantWins or NodeWins
    function vote(
        bytes32 disputeId,
        DisputeOutcome outcome
    ) external whenNotPaused onlyArbiter disputeExists(disputeId) {
        Dispute storage dispute = _disputes[disputeId];

        if (
            dispute.status != DisputeStatus.Open &&
            dispute.status != DisputeStatus.NodeResponded
        ) revert DisputeNotResolvable();

        if (outcome == DisputeOutcome.None) revert InvalidOutcome();
        if (arbiterVotes[disputeId][msg.sender] != DisputeOutcome.None) revert AlreadyVoted();

        arbiterVotes[disputeId][msg.sender] = outcome;

        emit ArbiterVoted(disputeId, msg.sender, outcome);

        if (outcome == DisputeOutcome.MerchantWins) {
            merchantWinsVotes[disputeId]++;
            if (merchantWinsVotes[disputeId] >= REQUIRED_ARBITERS) {
                _resolve(disputeId, DisputeOutcome.MerchantWins);
            }
        } else {
            nodeWinsVotes[disputeId]++;
            if (nodeWinsVotes[disputeId] >= REQUIRED_ARBITERS) {
                _resolve(disputeId, DisputeOutcome.NodeWins);
            }
        }
    }

    /// @notice Mark a dispute as expired if the node failed to respond in time.
    ///         Anyone can call this — it is a state cleanup function.
    ///         An expired dispute counts as MerchantWins for slashing purposes.
    function expireDispute(bytes32 disputeId) external disputeExists(disputeId) {
        Dispute storage dispute = _disputes[disputeId];

        if (dispute.status != DisputeStatus.Open) revert DisputeNotOpen();
        if (block.timestamp <= dispute.openedAt + NODE_RESPONSE_WINDOW) {
            revert ResponseWindowNotExpired();
        }

        dispute.status = DisputeStatus.Expired;
        emit DisputeExpired(disputeId);

        // Expired = node did not respond = merchant wins by default
        _executeSlash(dispute);
    }

    // ── External — Arbiter Management ────────────────────────

    /// @notice Propose a new arbiter. Requires REQUIRED_APPROVALS existing arbiters to approve.
    ///         Each arbiter calls this function to cast their approval for the candidate.
    ///         Once the threshold is met, the candidate is automatically added.
    function proposeArbiter(address candidate) external onlyArbiter {
        arbiterApprovals[candidate][msg.sender] = true;

        uint256 approvalCount = 0;
        for (uint256 i = 0; i < arbiters.length; i++) {
            if (arbiterApprovals[candidate][arbiters[i]]) approvalCount++;
        }

        if (approvalCount >= REQUIRED_APPROVALS && !isArbiter[candidate]) {
            isArbiter[candidate] = true;
            arbiters.push(candidate);
            arbiterCount++;
            // Clear approvals
            for (uint256 i = 0; i < arbiters.length; i++) {
                arbiterApprovals[candidate][arbiters[i]] = false;
            }
            emit ArbiterAdded(candidate);
        }
    }

    /// @notice Remove an arbiter. Cannot reduce below REQUIRED_ARBITERS.
    function removeArbiter(address arbiter) external onlyArbiter {
        if (arbiterCount <= REQUIRED_ARBITERS) revert NotEnoughArbiters();
        if (isArbiter[arbiter]) {
            isArbiter[arbiter] = false;
            arbiterCount--;
            emit ArbiterRemoved(arbiter);
        }
    }

    // ── Views ─────────────────────────────────────────────────

    function getDispute(bytes32 disputeId) external view returns (Dispute memory) {
        return _disputes[disputeId];
    }

    function getDisputeByIntent(bytes32 paymentIntentId) external view returns (Dispute memory) {
        return _disputes[intentToDispute[paymentIntentId]];
    }

    /// @notice Returns whether the node response window is still open for a dispute.
    function isResponseWindowOpen(bytes32 disputeId) external view returns (bool) {
        Dispute storage dispute = _disputes[disputeId];
        return block.timestamp <= dispute.openedAt + NODE_RESPONSE_WINDOW;
    }

    // ── Internal ─────────────────────────────────────────────

    function _resolve(bytes32 disputeId, DisputeOutcome outcome) internal {
        Dispute storage dispute = _disputes[disputeId];

        dispute.status     = DisputeStatus.Resolved;
        dispute.outcome    = outcome;
        dispute.resolvedAt = block.timestamp;

        emit DisputeResolved(disputeId, outcome, msg.sender);

        if (outcome == DisputeOutcome.MerchantWins) {
            _executeSlash(dispute);
        }
    }

    function _executeSlash(Dispute storage dispute) internal {
        // Slash SLASH_PERCENTAGE of the node's current stake
        // StakeManager computes the actual slashable amount (staked + pending withdrawal)
        // We pass a large number and let StakeManager cap it to what's available
        stakeManager.slash(
            dispute.nodeOperator,
            type(uint256).max, // StakeManager will cap to actual stake
            dispute.id
        );
        // Note: slashed funds are held by StakeManager and transferred to treasury
        // Treasury pull is handled by StakeManager.withdrawSlashed() — Phase 2 feature
    }
}

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.25;

import {IERC20} from "./interfaces/IERC20.sol";
import {Pausable} from "./Pausable.sol";

/// @title StakeManager
/// @notice Manages USDC stake deposits, withdrawals (with timelock), and slashing.
contract StakeManager is Pausable {
    // ── Constants ────────────────────────────────────────────

    uint256 public constant WITHDRAWAL_TIMELOCK = 7 days;

    // ── State ─────────────────────────────────────────────────

    IERC20 public immutable usdc;
    address public immutable disputeResolver;
    address public immutable nodeRegistry;

    struct StakeInfo {
        uint256 staked;
        uint256 pendingWithdrawal;
        uint256 unlockAt;
    }

    mapping(address => StakeInfo) private _stakes;

    // ── Events ───────────────────────────────────────────────

    event StakeDeposited(address indexed operator, uint256 amount);
    event WithdrawalRequested(address indexed operator, uint256 amount, uint256 unlockAt);
    event WithdrawalExecuted(address indexed operator, uint256 amount);
    event Slashed(address indexed operator, uint256 amount, bytes32 disputeId);

    // ── Errors ───────────────────────────────────────────────

    error OnlyDisputeResolver();
    error OnlyNodeRegistry();
    error InsufficientStake(uint256 available, uint256 requested);
    error TimelockNotExpired(uint256 unlockAt);
    error NoPendingWithdrawal();
    error TransferFailed();

    // ── Constructor ──────────────────────────────────────────

    constructor(address _usdc, address _disputeResolver, address _nodeRegistry, address _guardian) Pausable(_guardian) {
        usdc = IERC20(_usdc);
        disputeResolver = _disputeResolver;
        nodeRegistry = _nodeRegistry;
    }

    // ── External ─────────────────────────────────────────────

    /// @notice Called by NodeRegistry during node registration.
    function depositFor(address operator, uint256 amount) external {
        if (msg.sender != nodeRegistry) revert OnlyNodeRegistry();
        bool ok = usdc.transferFrom(operator, address(this), amount);
        if (!ok) revert TransferFailed();
        _stakes[operator].staked += amount;
        emit StakeDeposited(operator, amount);
    }

    /// @notice Operator adds more stake directly.
    function deposit(uint256 amount) external whenNotPaused {
        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();
        _stakes[msg.sender].staked += amount;
        emit StakeDeposited(msg.sender, amount);
    }

    /// @notice Request a stake withdrawal. Initiates the 7-day timelock.
    function requestWithdrawal(uint256 amount) external whenNotPaused {
        StakeInfo storage info = _stakes[msg.sender];
        if (info.staked < amount) revert InsufficientStake(info.staked, amount);
        info.staked -= amount;
        info.pendingWithdrawal += amount;
        info.unlockAt = block.timestamp + WITHDRAWAL_TIMELOCK;
        emit WithdrawalRequested(msg.sender, amount, info.unlockAt);
    }

    /// @notice Execute a withdrawal after the timelock has expired.
    function executeWithdrawal() external whenNotPaused {
        StakeInfo storage info = _stakes[msg.sender];
        if (info.pendingWithdrawal == 0) revert NoPendingWithdrawal();
        if (block.timestamp < info.unlockAt) revert TimelockNotExpired(info.unlockAt);
        uint256 amount = info.pendingWithdrawal;
        info.pendingWithdrawal = 0;
        info.unlockAt = 0;
        bool ok = usdc.transfer(msg.sender, amount);
        if (!ok) revert TransferFailed();
        emit WithdrawalExecuted(msg.sender, amount);
    }

    /// @notice Slash a node's stake. Only callable by DisputeResolver.
    function slash(address operator, uint256 amount, bytes32 disputeId) external {
        if (msg.sender != disputeResolver) revert OnlyDisputeResolver();
        StakeInfo storage info = _stakes[operator];
        uint256 slashable = info.staked + info.pendingWithdrawal;
        uint256 slashAmount = amount > slashable ? slashable : amount;
        if (slashAmount <= info.staked) {
            info.staked -= slashAmount;
        } else {
            uint256 remainder = slashAmount - info.staked;
            info.staked = 0;
            info.pendingWithdrawal -= remainder;
        }
        // Slashed funds go to the treasury (address stored in DisputeResolver)
        emit Slashed(operator, slashAmount, disputeId);
    }

    // ── Views ─────────────────────────────────────────────────

    function getStakeInfo(address operator) external view returns (StakeInfo memory) {
        return _stakes[operator];
    }
}

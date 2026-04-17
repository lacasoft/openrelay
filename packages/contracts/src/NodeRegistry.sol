// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.25;

import {IERC20} from "./interfaces/IERC20.sol";
import {IStakeManager} from "./interfaces/IStakeManager.sol";
import {Pausable} from "./Pausable.sol";

/// @title NodeRegistry
/// @notice Permissionless registry for OpenRelay node operators.
///         Any address can register by staking the minimum USDC amount.
contract NodeRegistry is Pausable {
    // ── Constants ────────────────────────────────────────────

    uint256 public constant MIN_STAKE = 100_000_000; // 100 USDC (6 decimals)

    // ── State ─────────────────────────────────────────────────

    IERC20 public immutable usdc;
    IStakeManager public immutable stakeManager;

    struct Node {
        address operator;
        string  endpoint;
        uint256 registeredAt;
        bool    active;
    }

    mapping(address => Node) private _nodes;
    address[] private _activeOperators;
    mapping(address => uint256) private _activeIndex;

    // ── Events ───────────────────────────────────────────────

    event NodeRegistered(address indexed operator, string endpoint, uint256 stake);
    event NodeUpdated(address indexed operator, string endpoint);
    event NodeDeactivated(address indexed operator);
    event NodeActivated(address indexed operator);

    // ── Errors ───────────────────────────────────────────────

    error AlreadyRegistered();
    error NotRegistered();
    error StakeTooLow(uint256 provided, uint256 minimum);
    error EmptyEndpoint();

    // ── Constructor ──────────────────────────────────────────

    constructor(address _usdc, address _stakeManager, address _guardian) Pausable(_guardian) {
        usdc = IERC20(_usdc);
        stakeManager = IStakeManager(_stakeManager);
    }

    // ── External ─────────────────────────────────────────────

    /// @notice Register as a node operator. Caller must have approved
    ///         stakeAmount of USDC to the StakeManager before calling.
    function register(string calldata endpoint, uint256 stakeAmount) external whenNotPaused {
        if (_nodes[msg.sender].registeredAt != 0) revert AlreadyRegistered();
        if (stakeAmount < MIN_STAKE) revert StakeTooLow(stakeAmount, MIN_STAKE);
        if (bytes(endpoint).length == 0) revert EmptyEndpoint();

        stakeManager.depositFor(msg.sender, stakeAmount);

        _nodes[msg.sender] = Node({
            operator:     msg.sender,
            endpoint:     endpoint,
            registeredAt: block.timestamp,
            active:       true
        });

        _activeIndex[msg.sender] = _activeOperators.length;
        _activeOperators.push(msg.sender);

        emit NodeRegistered(msg.sender, endpoint, stakeAmount);
    }

    /// @notice Update the node's endpoint URL.
    function updateEndpoint(string calldata endpoint) external {
        if (_nodes[msg.sender].registeredAt == 0) revert NotRegistered();
        if (bytes(endpoint).length == 0) revert EmptyEndpoint();

        _nodes[msg.sender].endpoint = endpoint;
        emit NodeUpdated(msg.sender, endpoint);
    }

    /// @notice Deactivate the node. Does not release stake.
    function deactivate() external whenNotPaused {
        if (_nodes[msg.sender].registeredAt == 0) revert NotRegistered();
        _nodes[msg.sender].active = false;
        _removeFromActive(msg.sender);
        emit NodeDeactivated(msg.sender);
    }

    /// @notice Reactivate a previously deactivated node.
    function activate() external {
        if (_nodes[msg.sender].registeredAt == 0) revert NotRegistered();
        _nodes[msg.sender].active = true;
        _activeIndex[msg.sender] = _activeOperators.length;
        _activeOperators.push(msg.sender);
        emit NodeActivated(msg.sender);
    }

    // ── Views ─────────────────────────────────────────────────

    function getNode(address operator) external view returns (Node memory) {
        return _nodes[operator];
    }

    function getActiveNodes() external view returns (address[] memory) {
        return _activeOperators;
    }

    function isActive(address operator) external view returns (bool) {
        return _nodes[operator].active;
    }

    // ── Internal ─────────────────────────────────────────────

    function _removeFromActive(address operator) internal {
        uint256 index = _activeIndex[operator];
        uint256 lastIndex = _activeOperators.length - 1;
        if (index != lastIndex) {
            address lastOperator = _activeOperators[lastIndex];
            _activeOperators[index] = lastOperator;
            _activeIndex[lastOperator] = index;
        }
        _activeOperators.pop();
        delete _activeIndex[operator];
    }
}

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {StakeManager} from "../src/StakeManager.sol";
import {Pausable} from "../src/Pausable.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract StakeManagerTest is Test {
    StakeManager stakeManager;
    MockUSDC     usdc;

    address operator        = makeAddr("operator");
    address disputeResolver = makeAddr("disputeResolver");
    address nodeRegistry    = makeAddr("nodeRegistry");
    address treasury        = makeAddr("treasury");
    address guardian        = makeAddr("guardian");

    uint256 constant STAKE        = 500_000_000; // 500 USDC
    uint256 constant TIMELOCK     = 7 days;

    function setUp() public {
        usdc         = new MockUSDC();
        stakeManager = new StakeManager(address(usdc), disputeResolver, nodeRegistry, guardian);

        usdc.mint(operator, 10_000 * 1e6); // 10,000 USDC
    }

    // ── depositFor (called by NodeRegistry) ───────────────────

    function test_DepositFor_Success() public {
        _depositViaRegistry(operator, STAKE);

        StakeManager.StakeInfo memory info = stakeManager.getStakeInfo(operator);
        assertEq(info.staked, STAKE);
    }

    function test_DepositFor_EmitsEvent() public {
        vm.startPrank(operator);
        usdc.approve(address(stakeManager), STAKE);
        vm.stopPrank();

        vm.expectEmit(true, false, false, true);
        emit StakeManager.StakeDeposited(operator, STAKE);

        vm.prank(nodeRegistry);
        stakeManager.depositFor(operator, STAKE);
    }

    function test_DepositFor_Revert_OnlyNodeRegistry() public {
        vm.prank(operator);
        usdc.approve(address(stakeManager), STAKE);

        vm.prank(operator); // not the registry
        vm.expectRevert(StakeManager.OnlyNodeRegistry.selector);
        stakeManager.depositFor(operator, STAKE);
    }

    // ── deposit (direct top-up) ───────────────────────────────

    function test_Deposit_Success() public {
        _depositViaRegistry(operator, STAKE);

        uint256 topUp = 100_000_000;
        vm.startPrank(operator);
        usdc.approve(address(stakeManager), topUp);
        stakeManager.deposit(topUp);
        vm.stopPrank();

        StakeManager.StakeInfo memory info = stakeManager.getStakeInfo(operator);
        assertEq(info.staked, STAKE + topUp);
    }

    // ── requestWithdrawal ─────────────────────────────────────

    function test_RequestWithdrawal_Success() public {
        _depositViaRegistry(operator, STAKE);

        vm.prank(operator);
        stakeManager.requestWithdrawal(STAKE);

        StakeManager.StakeInfo memory info = stakeManager.getStakeInfo(operator);
        assertEq(info.staked,            0);
        assertEq(info.pendingWithdrawal, STAKE);
        assertEq(info.unlockAt,          block.timestamp + TIMELOCK);
    }

    function test_RequestWithdrawal_EmitsEvent() public {
        _depositViaRegistry(operator, STAKE);

        vm.expectEmit(true, false, false, true);
        emit StakeManager.WithdrawalRequested(operator, STAKE, block.timestamp + TIMELOCK);

        vm.prank(operator);
        stakeManager.requestWithdrawal(STAKE);
    }

    function test_RequestWithdrawal_Revert_InsufficientStake() public {
        _depositViaRegistry(operator, STAKE);

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(StakeManager.InsufficientStake.selector, STAKE, STAKE + 1)
        );
        stakeManager.requestWithdrawal(STAKE + 1);
    }

    // ── executeWithdrawal ─────────────────────────────────────

    function test_ExecuteWithdrawal_AfterTimelock() public {
        _depositViaRegistry(operator, STAKE);

        vm.prank(operator);
        stakeManager.requestWithdrawal(STAKE);

        uint256 balanceBefore = usdc.balanceOf(operator);

        vm.warp(block.timestamp + TIMELOCK + 1);

        vm.prank(operator);
        stakeManager.executeWithdrawal();

        uint256 balanceAfter = usdc.balanceOf(operator);
        assertEq(balanceAfter - balanceBefore, STAKE);

        StakeManager.StakeInfo memory info = stakeManager.getStakeInfo(operator);
        assertEq(info.pendingWithdrawal, 0);
        assertEq(info.unlockAt,          0);
    }

    function test_ExecuteWithdrawal_Revert_TimelockNotExpired() public {
        _depositViaRegistry(operator, STAKE);

        vm.prank(operator);
        stakeManager.requestWithdrawal(STAKE);

        vm.warp(block.timestamp + TIMELOCK - 1); // one second before unlock

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(StakeManager.TimelockNotExpired.selector, block.timestamp + 1)
        );
        stakeManager.executeWithdrawal();
    }

    function test_ExecuteWithdrawal_Revert_NoPendingWithdrawal() public {
        _depositViaRegistry(operator, STAKE);

        vm.prank(operator);
        vm.expectRevert(StakeManager.NoPendingWithdrawal.selector);
        stakeManager.executeWithdrawal();
    }

    // ── slash ─────────────────────────────────────────────────

    function test_Slash_ReducesStake() public {
        _depositViaRegistry(operator, STAKE);

        bytes32 disputeId = keccak256("dispute-1");
        uint256 slashAmount = STAKE / 5; // 20%

        vm.prank(disputeResolver);
        stakeManager.slash(operator, slashAmount, disputeId);

        StakeManager.StakeInfo memory info = stakeManager.getStakeInfo(operator);
        assertEq(info.staked, STAKE - slashAmount);
    }

    function test_Slash_EmitsEvent() public {
        _depositViaRegistry(operator, STAKE);
        bytes32 disputeId = keccak256("dispute-1");

        vm.expectEmit(true, false, false, true);
        emit StakeManager.Slashed(operator, STAKE / 5, disputeId);

        vm.prank(disputeResolver);
        stakeManager.slash(operator, STAKE / 5, disputeId);
    }

    function test_Slash_CanReachIntoPendingWithdrawal() public {
        _depositViaRegistry(operator, STAKE);

        // Operator requests to withdraw half
        uint256 halfStake = STAKE / 2;
        vm.prank(operator);
        stakeManager.requestWithdrawal(halfStake);

        // Slash more than remaining staked — should eat into pending
        bytes32 disputeId = keccak256("dispute-big");

        vm.prank(disputeResolver);
        stakeManager.slash(operator, STAKE, disputeId); // slash full amount

        StakeManager.StakeInfo memory info = stakeManager.getStakeInfo(operator);
        assertEq(info.staked,            0);
        assertEq(info.pendingWithdrawal, 0);
    }

    function test_Slash_CapsAtAvailableStake() public {
        _depositViaRegistry(operator, STAKE);
        bytes32 disputeId = keccak256("dispute-cap");

        // Slash more than staked — should cap at staked amount
        vm.prank(disputeResolver);
        stakeManager.slash(operator, STAKE * 10, disputeId);

        StakeManager.StakeInfo memory info = stakeManager.getStakeInfo(operator);
        assertEq(info.staked, 0);
    }

    function test_Slash_Revert_OnlyDisputeResolver() public {
        _depositViaRegistry(operator, STAKE);

        vm.prank(operator);
        vm.expectRevert(StakeManager.OnlyDisputeResolver.selector);
        stakeManager.slash(operator, STAKE, bytes32(0));
    }

    // ── Fuzz ─────────────────────────────────────────────────

    function testFuzz_DepositAndWithdraw_FullCycle(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000 * 1e6); // 1 micro-USDC to 1M USDC

        usdc.mint(operator, amount);

        vm.startPrank(operator);
        usdc.approve(address(stakeManager), amount);
        vm.stopPrank();

        vm.prank(nodeRegistry);
        stakeManager.depositFor(operator, amount);

        vm.prank(operator);
        stakeManager.requestWithdrawal(amount);

        vm.warp(block.timestamp + TIMELOCK + 1);

        uint256 balBefore = usdc.balanceOf(operator);

        vm.prank(operator);
        stakeManager.executeWithdrawal();

        assertEq(usdc.balanceOf(operator) - balBefore, amount);
    }

    function testFuzz_Slash_NeverExceedsTotal(uint256 stakeAmount, uint256 slashAmount) public {
        stakeAmount = bound(stakeAmount, 1, 10_000 * 1e6);
        slashAmount = bound(slashAmount, 1, type(uint256).max / 2);

        usdc.mint(operator, stakeAmount);

        vm.startPrank(operator);
        usdc.approve(address(stakeManager), stakeAmount);
        vm.stopPrank();

        vm.prank(nodeRegistry);
        stakeManager.depositFor(operator, stakeAmount);

        vm.prank(disputeResolver);
        stakeManager.slash(operator, slashAmount, keccak256("fuzz-dispute"));

        StakeManager.StakeInfo memory info = stakeManager.getStakeInfo(operator);
        assertEq(info.staked + info.pendingWithdrawal, 0); // all gone if slash >= stake
    }

    // ── Pausable ──────────────────────────────────────────────

    function test_Pause_DepositRevertsWhenPaused() public {
        vm.prank(guardian);
        stakeManager.pause();

        vm.startPrank(operator);
        usdc.approve(address(stakeManager), STAKE);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        stakeManager.deposit(STAKE);
        vm.stopPrank();
    }

    function test_Pause_RequestWithdrawalRevertsWhenPaused() public {
        _depositViaRegistry(operator, STAKE);

        vm.prank(guardian);
        stakeManager.pause();

        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        stakeManager.requestWithdrawal(STAKE);
    }

    function test_Pause_ExecuteWithdrawalRevertsWhenPaused() public {
        _depositViaRegistry(operator, STAKE);

        vm.prank(operator);
        stakeManager.requestWithdrawal(STAKE);

        vm.warp(block.timestamp + TIMELOCK + 1);

        vm.prank(guardian);
        stakeManager.pause();

        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        stakeManager.executeWithdrawal();
    }

    function test_Pause_UnpauseRestoresOperations() public {
        vm.prank(guardian);
        stakeManager.pause();

        vm.prank(guardian);
        stakeManager.unpause();

        // deposit should work again
        vm.startPrank(operator);
        usdc.approve(address(stakeManager), STAKE);
        stakeManager.deposit(STAKE);
        vm.stopPrank();

        StakeManager.StakeInfo memory info = stakeManager.getStakeInfo(operator);
        assertEq(info.staked, STAKE);
    }

    // ── Helpers ───────────────────────────────────────────────

    function _depositViaRegistry(address op, uint256 amount) internal {
        vm.startPrank(op);
        usdc.approve(address(stakeManager), amount);
        vm.stopPrank();

        vm.prank(nodeRegistry);
        stakeManager.depositFor(op, amount);
    }
}

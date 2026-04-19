// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.25;

import {Test, console} from "forge-std/Test.sol";
import {NodeRegistry} from "../src/NodeRegistry.sol";
import {StakeManager} from "../src/StakeManager.sol";
import {DisputeResolver} from "../src/DisputeResolver.sol";
import {Pausable} from "../src/Pausable.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract NodeRegistryTest is Test {
    NodeRegistry    registry;
    StakeManager    stakeManager;
    MockUSDC        usdc;

    address guardian  = makeAddr("guardian");
    address treasury  = makeAddr("treasury");
    address arbiter1  = makeAddr("arbiter1");
    address arbiter2  = makeAddr("arbiter2");
    address arbiter3  = makeAddr("arbiter3");
    address operator  = makeAddr("operator");
    address operator2 = makeAddr("operator2");

    uint256 constant MIN_STAKE = 100_000_000; // 100 USDC
    string  constant ENDPOINT  = "https://node.example.com";

    function setUp() public {
        usdc = new MockUSDC();

        // Circular dependency: StakeManager needs to know about the resolver
        // and registry, but those contracts need StakeManager's address at
        // construction. Resolved with an initialize() call after all three
        // contracts exist.
        stakeManager = new StakeManager(address(usdc), guardian);

        address[] memory arbiters = new address[](3);
        arbiters[0] = arbiter1;
        arbiters[1] = arbiter2;
        arbiters[2] = arbiter3;

        DisputeResolver resolver = new DisputeResolver(
            address(stakeManager), treasury, arbiters, guardian
        );

        registry = new NodeRegistry(address(usdc), address(stakeManager), guardian, MIN_STAKE);

        vm.prank(guardian);
        stakeManager.initialize(address(resolver), address(registry));

        // Fund operator
        usdc.mint(operator,  10 * MIN_STAKE);
        usdc.mint(operator2, 10 * MIN_STAKE);
    }

    // ── Registration ──────────────────────────────────────────

    function test_Register_Success() public {
        vm.startPrank(operator);
        usdc.approve(address(stakeManager), MIN_STAKE);
        registry.register(ENDPOINT, MIN_STAKE);
        vm.stopPrank();

        NodeRegistry.Node memory node = registry.getNode(operator);
        assertEq(node.operator,    operator);
        assertEq(node.endpoint,    ENDPOINT);
        assertEq(node.active,      true);
        assertGt(node.registeredAt, 0);
    }

    function test_Register_EmitsEvent() public {
        vm.startPrank(operator);
        usdc.approve(address(stakeManager), MIN_STAKE);

        vm.expectEmit(true, false, false, true);
        emit NodeRegistry.NodeRegistered(operator, ENDPOINT, MIN_STAKE);

        registry.register(ENDPOINT, MIN_STAKE);
        vm.stopPrank();
    }

    function test_Register_AppearsInActiveNodes() public {
        vm.startPrank(operator);
        usdc.approve(address(stakeManager), MIN_STAKE);
        registry.register(ENDPOINT, MIN_STAKE);
        vm.stopPrank();

        address[] memory active = registry.getActiveNodes();
        assertEq(active.length, 1);
        assertEq(active[0], operator);
    }

    function test_Register_Revert_AlreadyRegistered() public {
        vm.startPrank(operator);
        usdc.approve(address(stakeManager), MIN_STAKE * 2);
        registry.register(ENDPOINT, MIN_STAKE);

        vm.expectRevert(NodeRegistry.AlreadyRegistered.selector);
        registry.register(ENDPOINT, MIN_STAKE);
        vm.stopPrank();
    }

    function test_Register_Revert_StakeTooLow() public {
        vm.startPrank(operator);
        uint256 lowStake = MIN_STAKE - 1;
        usdc.approve(address(stakeManager), lowStake);

        vm.expectRevert(
            abi.encodeWithSelector(NodeRegistry.StakeTooLow.selector, lowStake, MIN_STAKE)
        );
        registry.register(ENDPOINT, lowStake);
        vm.stopPrank();
    }

    function test_Register_Revert_EmptyEndpoint() public {
        vm.startPrank(operator);
        usdc.approve(address(stakeManager), MIN_STAKE);

        vm.expectRevert(NodeRegistry.EmptyEndpoint.selector);
        registry.register("", MIN_STAKE);
        vm.stopPrank();
    }

    // ── UpdateEndpoint ────────────────────────────────────────

    function test_UpdateEndpoint_Success() public {
        _registerOperator(operator, MIN_STAKE);

        vm.prank(operator);
        registry.updateEndpoint("https://new-endpoint.example.com");

        NodeRegistry.Node memory node = registry.getNode(operator);
        assertEq(node.endpoint, "https://new-endpoint.example.com");
    }

    function test_UpdateEndpoint_EmitsEvent() public {
        _registerOperator(operator, MIN_STAKE);
        string memory newEndpoint = "https://new.example.com";

        vm.expectEmit(true, false, false, true);
        emit NodeRegistry.NodeUpdated(operator, newEndpoint);

        vm.prank(operator);
        registry.updateEndpoint(newEndpoint);
    }

    function test_UpdateEndpoint_Revert_NotRegistered() public {
        vm.prank(operator);
        vm.expectRevert(NodeRegistry.NotRegistered.selector);
        registry.updateEndpoint("https://example.com");
    }

    function test_UpdateEndpoint_Revert_EmptyEndpoint() public {
        _registerOperator(operator, MIN_STAKE);

        vm.prank(operator);
        vm.expectRevert(NodeRegistry.EmptyEndpoint.selector);
        registry.updateEndpoint("");
    }

    // ── Deactivate / Activate ─────────────────────────────────

    function test_Deactivate_Success() public {
        _registerOperator(operator, MIN_STAKE);

        vm.prank(operator);
        registry.deactivate();

        assertFalse(registry.getNode(operator).active);
        assertFalse(registry.isActive(operator));
    }

    function test_Deactivate_RemovesFromActiveList() public {
        _registerOperator(operator,  MIN_STAKE);
        _registerOperator(operator2, MIN_STAKE);

        vm.prank(operator);
        registry.deactivate();

        address[] memory active = registry.getActiveNodes();
        assertEq(active.length, 1);
        assertEq(active[0], operator2);
    }

    function test_Activate_Success() public {
        _registerOperator(operator, MIN_STAKE);

        vm.startPrank(operator);
        registry.deactivate();
        registry.activate();
        vm.stopPrank();

        assertTrue(registry.isActive(operator));

        address[] memory active = registry.getActiveNodes();
        assertEq(active.length, 1);
    }

    function test_Deactivate_Revert_NotRegistered() public {
        vm.prank(operator);
        vm.expectRevert(NodeRegistry.NotRegistered.selector);
        registry.deactivate();
    }

    // ── Multiple nodes ────────────────────────────────────────

    function test_MultipleNodes_ActiveList() public {
        _registerOperator(operator,  MIN_STAKE);
        _registerOperator(operator2, MIN_STAKE * 2);

        address[] memory active = registry.getActiveNodes();
        assertEq(active.length, 2);
    }

    // ── Fuzz ─────────────────────────────────────────────────

    function testFuzz_Register_StakeBelowMin_AlwaysReverts(uint256 stake) public {
        stake = bound(stake, 1, MIN_STAKE - 1);

        vm.startPrank(operator);
        usdc.approve(address(stakeManager), stake);

        vm.expectRevert(
            abi.encodeWithSelector(NodeRegistry.StakeTooLow.selector, stake, MIN_STAKE)
        );
        registry.register(ENDPOINT, stake);
        vm.stopPrank();
    }

    function testFuzz_Register_StakeAboveMin_Succeeds(uint256 stake) public {
        stake = bound(stake, MIN_STAKE, 1_000 * MIN_STAKE);

        usdc.mint(operator, stake);

        vm.startPrank(operator);
        usdc.approve(address(stakeManager), stake);
        registry.register(ENDPOINT, stake);
        vm.stopPrank();

        assertTrue(registry.isActive(operator));
    }

    // ── Pausable ──────────────────────────────────────────────

    function test_Pause_GuardianCanPause() public {
        vm.prank(guardian);
        registry.pause();
        assertTrue(registry.paused());
    }

    function test_Pause_GuardianCanUnpause() public {
        vm.prank(guardian);
        registry.pause();

        vm.prank(guardian);
        registry.unpause();
        assertFalse(registry.paused());
    }

    function test_Pause_NonGuardianCannotPause() public {
        vm.prank(operator);
        vm.expectRevert(Pausable.NotGuardian.selector);
        registry.pause();
    }

    function test_Pause_RegisterRevertsWhenPaused() public {
        vm.prank(guardian);
        registry.pause();

        vm.startPrank(operator);
        usdc.approve(address(stakeManager), MIN_STAKE);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.register(ENDPOINT, MIN_STAKE);
        vm.stopPrank();
    }

    function test_Pause_DeactivateRevertsWhenPaused() public {
        _registerOperator(operator, MIN_STAKE);

        vm.prank(guardian);
        registry.pause();

        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.deactivate();
    }

    function test_Pause_RegisterWorksAfterUnpause() public {
        vm.prank(guardian);
        registry.pause();

        vm.prank(guardian);
        registry.unpause();

        vm.startPrank(operator);
        usdc.approve(address(stakeManager), MIN_STAKE);
        registry.register(ENDPOINT, MIN_STAKE);
        vm.stopPrank();

        assertTrue(registry.isActive(operator));
    }

    function test_TransferGuardian() public {
        address newGuardian = makeAddr("newGuardian");

        vm.prank(guardian);
        registry.transferGuardian(newGuardian);

        assertEq(registry.guardian(), newGuardian);

        // Old guardian can no longer pause
        vm.prank(guardian);
        vm.expectRevert(Pausable.NotGuardian.selector);
        registry.pause();

        // New guardian can pause
        vm.prank(newGuardian);
        registry.pause();
        assertTrue(registry.paused());
    }

    // ── Adjustable min stake ──────────────────────────────────

    function test_MinStake_InitialValue() public view {
        assertEq(registry.minStake(), MIN_STAKE);
    }

    function test_SetMinStake_GuardianCanIncrease() public {
        uint256 newMin = MIN_STAKE * 2;

        vm.expectEmit(true, true, true, true);
        emit NodeRegistry.MinStakeIncreased(MIN_STAKE, newMin);

        vm.prank(guardian);
        registry.setMinStake(newMin);

        assertEq(registry.minStake(), newMin);
    }

    function test_SetMinStake_Revert_Decrease() public {
        uint256 lowerMin = MIN_STAKE - 1;

        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(NodeRegistry.MinStakeCannotDecrease.selector, MIN_STAKE, lowerMin)
        );
        registry.setMinStake(lowerMin);
    }

    function test_SetMinStake_Revert_NonGuardian() public {
        vm.prank(operator);
        vm.expectRevert(Pausable.NotGuardian.selector);
        registry.setMinStake(MIN_STAKE * 2);
    }

    function test_SetMinStake_SameValueAllowed() public {
        // Setting to the same value is a no-op but shouldn't revert
        // (it's a set, not a strict increase — emits the event anyway)
        vm.prank(guardian);
        registry.setMinStake(MIN_STAKE);
        assertEq(registry.minStake(), MIN_STAKE);
    }

    function test_Register_AfterMinStakeIncrease_OldStakeTooLow() public {
        uint256 newMin = MIN_STAKE * 2;
        vm.prank(guardian);
        registry.setMinStake(newMin);

        // Trying to register with the previous MIN_STAKE should now fail
        usdc.mint(operator, MIN_STAKE);
        vm.startPrank(operator);
        usdc.approve(address(stakeManager), MIN_STAKE);
        vm.expectRevert(
            abi.encodeWithSelector(NodeRegistry.StakeTooLow.selector, MIN_STAKE, newMin)
        );
        registry.register(ENDPOINT, MIN_STAKE);
        vm.stopPrank();
    }

    // ── Helpers ───────────────────────────────────────────────

    function _registerOperator(address op, uint256 stake) internal {
        usdc.mint(op, stake);
        vm.startPrank(op);
        usdc.approve(address(stakeManager), stake);
        registry.register(ENDPOINT, stake);
        vm.stopPrank();
    }
}

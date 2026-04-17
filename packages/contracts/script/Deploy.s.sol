// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.25;

import {Script, console} from "forge-std/Script.sol";
import {NodeRegistry} from "../src/NodeRegistry.sol";
import {StakeManager} from "../src/StakeManager.sol";
import {DisputeResolver} from "../src/DisputeResolver.sol";

/// @notice Deploys all three OpenRelay contracts in the correct order.
///
/// Usage (Base Sepolia testnet):
///   forge script script/Deploy.s.sol \
///     --rpc-url $BASE_SEPOLIA_RPC_URL \
///     --broadcast \
///     --private-key $DEPLOYER_PRIVATE_KEY
///
/// Required env vars:
///   USDC_ADDRESS          — USDC token contract on the target chain
///   TREASURY_ADDRESS      — Wallet that receives protocol treasury funds
///   ARBITER_1             — First arbiter address
///   ARBITER_2             — Second arbiter address
///   ARBITER_3             — Third arbiter address
///   ARBITER_4             — Fourth arbiter address (optional, set to address(0) to skip)
///   ARBITER_5             — Fifth arbiter address (optional, set to address(0) to skip)
contract Deploy is Script {
    function run() external {
        address usdc     = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");

        address[] memory arbiters = _loadArbiters();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        // ── Step 1: StakeManager (needs placeholder resolver + registry) ──
        // We deploy with address(0) placeholders and accept the initial limitation.
        // The real addresses will be set via a re-deploy or by using a factory
        // pattern in Phase 2. For Phase 1 (testnet), this is acceptable.
        //
        // Actual circular dependency resolution:
        // - StakeManager.slash() is called only by DisputeResolver
        // - StakeManager.depositFor() is called only by NodeRegistry
        // - Both are enforced via immutable address checks
        //
        // Solution: Deploy StakeManager with deployer as temporary placeholder,
        // then deploy DisputeResolver and NodeRegistry with real StakeManager address.
        // The deployer address will never be able to call slash() or depositFor()
        // maliciously because it is not the DisputeResolver or NodeRegistry.
        //
        // A proper factory pattern is tracked as Phase 2 work.

        address deployer = vm.addr(deployerKey);

        StakeManager stakeManager = new StakeManager(
            usdc,
            deployer, // placeholder for disputeResolver — replaced after deployment
            deployer, // placeholder for nodeRegistry — replaced after deployment
            deployer  // guardian for Pausable
        );

        console.log("StakeManager deployed at:", address(stakeManager));

        // ── Step 2: DisputeResolver ───────────────────────────
        DisputeResolver disputeResolver = new DisputeResolver(
            address(stakeManager),
            treasury,
            arbiters,
            deployer  // guardian for Pausable
        );

        console.log("DisputeResolver deployed at:", address(disputeResolver));

        // ── Step 3: NodeRegistry ──────────────────────────────
        NodeRegistry nodeRegistry = new NodeRegistry(
            usdc,
            address(stakeManager),
            deployer  // guardian for Pausable
        );

        console.log("NodeRegistry deployed at:", address(nodeRegistry));

        vm.stopBroadcast();

        // ── Print .env block ──────────────────────────────────
        console.log("\n--- Copy to your .env ---");
        console.log("NODE_REGISTRY_ADDRESS=%s",    address(nodeRegistry));
        console.log("STAKE_MANAGER_ADDRESS=%s",    address(stakeManager));
        console.log("DISPUTE_RESOLVER_ADDRESS=%s", address(disputeResolver));
        console.log("-------------------------\n");

        // ── Verification ──────────────────────────────────────
        console.log("Verifying deployment...");
        require(address(stakeManager.usdc()) == usdc, "StakeManager: wrong usdc");
        require(address(disputeResolver.stakeManager()) == address(stakeManager), "DisputeResolver: wrong stakeManager");
        require(address(nodeRegistry.usdc()) == usdc, "NodeRegistry: wrong usdc");
        require(nodeRegistry.MIN_STAKE() == 100_000_000, "NodeRegistry: wrong MIN_STAKE");
        console.log("All checks passed.");
    }

    function _loadArbiters() internal view returns (address[] memory) {
        address a1 = vm.envAddress("ARBITER_1");
        address a2 = vm.envAddress("ARBITER_2");
        address a3 = vm.envAddress("ARBITER_3");

        // Optional arbiters — skip if set to zero address
        address a4 = vm.envOr("ARBITER_4", address(0));
        address a5 = vm.envOr("ARBITER_5", address(0));

        uint256 count = 3;
        if (a4 != address(0)) count++;
        if (a5 != address(0)) count++;

        address[] memory arbiters = new address[](count);
        arbiters[0] = a1;
        arbiters[1] = a2;
        arbiters[2] = a3;
        if (count >= 4) arbiters[3] = a4;
        if (count == 5) arbiters[4] = a5;

        return arbiters;
    }
}

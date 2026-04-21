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
///   TREASURY_ADDRESS      — Wallet that receives protocol treasury funds (immutable
///                           in DisputeResolver after deploy)
///   GUARDIAN_ADDRESS      — Wallet with pause/setMinStake authority on all three
///                           contracts. Rotatable post-deploy via Pausable.transferGuardian().
///                           Should be a wallet SEPARATE from the deployer.
///   ARBITER_1             — First arbiter address
///   ARBITER_2             — Second arbiter address
///   ARBITER_3             — Third arbiter address
///   ARBITER_4             — Fourth arbiter address (optional, set to address(0) to skip)
///   ARBITER_5             — Fifth arbiter address (optional, set to address(0) to skip)
contract Deploy is Script {
    function run() external {
        address usdc = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");

        address[] memory arbiters = _loadArbiters();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        // Sanity checks: roles that should NEVER collapse into the deployer.
        // Treasury and guardian must be separate wallets so that a deployer-key
        // compromise does not hand over treasury funds + pause authority.
        address deployerAddr = vm.addr(deployerKey);
        require(treasury != deployerAddr, "Deploy: TREASURY_ADDRESS == deployer (separate them)");
        require(guardian != deployerAddr, "Deploy: GUARDIAN_ADDRESS == deployer (separate them)");
        require(guardian != treasury, "Deploy: GUARDIAN_ADDRESS == TREASURY_ADDRESS (separate them)");

        vm.startBroadcast(deployerKey);

        // ── Circular dependency resolution ─────────────────────
        // StakeManager, DisputeResolver, and NodeRegistry have a circular
        // dependency:
        //   - NodeRegistry.register() calls StakeManager.depositFor()
        //   - DisputeResolver.vote() calls StakeManager.slash()
        // StakeManager gates those calls on msg.sender == nodeRegistry /
        // disputeResolver. We break the cycle with an initialization pattern:
        //   1. Deploy the three contracts with the deployer as *temporary*
        //      guardian so the deployer can call stakeManager.initialize()
        //      (which is gated by onlyGuardian).
        //   2. Call stakeManager.initialize(disputeResolver, nodeRegistry).
        //   3. Transfer guardianship on all three contracts to the real
        //      GUARDIAN_ADDRESS via Pausable.transferGuardian(). After this,
        //      the deployer has no authority over the protocol.
        // Final state: guardian = GUARDIAN_ADDRESS on all three. Deployer
        // only paid gas.

        // ── Step 1: StakeManager ───────────────────────────────
        StakeManager stakeManager = new StakeManager(
            usdc,
            deployerAddr // temporary guardian (transferred to real guardian below)
        );

        console.log("StakeManager deployed at:", address(stakeManager));

        // ── Step 2: DisputeResolver ───────────────────────────
        DisputeResolver disputeResolver = new DisputeResolver(
            address(stakeManager),
            treasury,
            arbiters,
            deployerAddr // temporary guardian
        );

        console.log("DisputeResolver deployed at:", address(disputeResolver));

        // ── Step 3: NodeRegistry ──────────────────────────────
        // Initial minStake: read from env var (defaults to 40 USDC for testnet).
        // Guardian can increase it later via setMinStake(). Recommended:
        //   testnet/early mainnet → 40 USDC (40_000_000)
        //   mature mainnet       → 100 USDC (100_000_000)
        uint256 initialMinStake = vm.envOr("MIN_STAKE_USDC_UNITS", uint256(40_000_000));

        NodeRegistry nodeRegistry = new NodeRegistry(
            usdc,
            address(stakeManager),
            deployerAddr, // temporary guardian
            initialMinStake
        );

        console.log("NodeRegistry deployed at:", address(nodeRegistry));

        // ── Step 4: Wire StakeManager to the real addresses ───
        stakeManager.initialize(address(disputeResolver), address(nodeRegistry));

        console.log("StakeManager initialized with resolver + registry");

        // ── Step 5: Transfer guardian to the real guardian ────
        // From this point on, only GUARDIAN_ADDRESS can pause or adjust minStake.
        // The deployer keeps no authority over the protocol.
        stakeManager.transferGuardian(guardian);
        disputeResolver.transferGuardian(guardian);
        nodeRegistry.transferGuardian(guardian);

        console.log("Guardianship transferred to:", guardian);

        vm.stopBroadcast();

        // ── Print .env block ──────────────────────────────────
        console.log("\n--- Copy to your .env ---");
        console.log("NODE_REGISTRY_ADDRESS=%s", address(nodeRegistry));
        console.log("STAKE_MANAGER_ADDRESS=%s", address(stakeManager));
        console.log("DISPUTE_RESOLVER_ADDRESS=%s", address(disputeResolver));
        console.log("-------------------------\n");

        // ── Verification ──────────────────────────────────────
        console.log("Verifying deployment...");
        require(address(stakeManager.usdc()) == usdc, "StakeManager: wrong usdc");
        require(address(disputeResolver.stakeManager()) == address(stakeManager), "DisputeResolver: wrong stakeManager");
        require(address(nodeRegistry.usdc()) == usdc, "NodeRegistry: wrong usdc");
        require(nodeRegistry.minStake() == initialMinStake, "NodeRegistry: wrong initial minStake");
        require(stakeManager.guardian() == guardian, "StakeManager: guardian not transferred");
        require(disputeResolver.guardian() == guardian, "DisputeResolver: guardian not transferred");
        require(nodeRegistry.guardian() == guardian, "NodeRegistry: guardian not transferred");
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

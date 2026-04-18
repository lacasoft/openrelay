# OpenRelay — Deploy Guide (Base Sepolia)

This guide covers the full process for deploying the OpenRelay contracts
(`NodeRegistry`, `StakeManager`, `DisputeResolver`) to **Base Sepolia testnet**.

> Phase 1 — Testnet. **Do not deploy to mainnet** until the external audit is complete.

---

## 1. Prerequisites

### Tooling

- **Foundry** installed and working:
  ```bash
  forge --version
  # forge 0.2.0 (or newer)
  ```
  If missing: `curl -L https://foundry.paradigm.xyz | bash && foundryup`

- **`forge-std` submodule** initialized:
  ```bash
  cd packages/contracts
  git submodule update --init --recursive
  ```

- **Contracts compiling and tests passing**:
  ```bash
  cd packages/contracts
  forge build
  forge test
  ```
  You should see all 87 tests green before proceeding.

### Funds

- An account with **Sepolia ETH** for gas. ~0.05 ETH is enough for the full
  3-contract deploy. Recommended faucets (verified):
  - **Alchemy** — https://www.alchemy.com/faucets/base-sepolia (0.1 ETH/day, requires free account)
  - **QuickNode** — https://faucet.quicknode.com/base/sepolia (0.025 ETH/day)
  - **Chainstack** — https://faucet.chainstack.com/base-sepolia-faucet
  - **Superchain (Optimism)** — https://app.optimism.io/faucet (supports Base Sepolia, requires wallet connect)
  - Always up-to-date official list: https://docs.base.org/chain/network-faucets

- **Base Sepolia USDC** (only if you'll test the full payment flow afterwards).
  Circle's official faucet:
  - https://faucet.circle.com/ → choose "Base Sepolia"

### Basescan API key (optional but recommended)

For automatic source code verification on the explorer:

- Create an account at https://basescan.org/ and generate a free API key at
  https://basescan.org/myapikey
- Copy the key — you'll use it as `BASESCAN_API_KEY` in `.env`

---

## 2. Prepare the `.env`

Copy `.env.example` to `.env` and fill in the deploy variables. The minimum
required block looks like this:

```bash
# === REQUIRED for deploy ===
DEPLOYER_PRIVATE_KEY=0x...                                      # Wallet funded with Sepolia ETH — NEVER use your main wallet
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org                   # Public RPC (or use your own dedicated RPC)
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e         # Official USDC on Base Sepolia (do not change)
TREASURY_ADDRESS=0x...                                          # Address that receives treasury fees (20% of protocol fee)

# === 3-of-5 multisig arbiters ===
ARBITER_1=0x...                                                 # Your signer wallet 1
ARBITER_2=0x...                                                 # Your signer wallet 2
ARBITER_3=0x...                                                 # Your signer wallet 3
# ARBITER_4 and ARBITER_5 are optional — omit them or leave as 0x0000000000000000000000000000000000000000

# === Basescan verification ===
BASESCAN_API_KEY=XXXX...                                        # From https://basescan.org/myapikey
```

### Important notes about `.env`

- **Generate a fresh wallet just for deploy.** If you have `cast`:
  ```bash
  cast wallet new
  ```
  This prints a private key and its address. Use **only** that wallet to
  deploy — never your personal wallet holding real mainnet funds.

- **Never commit the `.env`** to the repo. The file is already in
  `.gitignore`, but double-check before `git add`.

- **The 3 arbiters must be distinct addresses**, even though in Phase 1 they
  can all be controlled by you (generate 3 wallets with `cast wallet new`).
  They're placeholders until governance decentralizes.

- **`DEPLOYER_PRIVATE_KEY`** must start with `0x`.

- **Load the `.env` into your shell** before running commands:
  ```bash
  set -a && source .env && set +a
  ```
  (or use something like `direnv` if you prefer.)

---

## 3. Pre-deploy checklist

Before executing the deploy, verify:

- [ ] `.env` configured with all required vars
- [ ] Deployer wallet funded with ≥0.05 Sepolia ETH (check at https://sepolia.basescan.org/address/<YOUR_ADDRESS>)
- [ ] `forge build` passes without errors
- [ ] `forge test -vvv` passes (87/87)
- [ ] You have a Basescan API key (optional but recommended)
- [ ] `.env` is NOT committed to the repo (`git status` confirms)

---

## 4. Run the deploy

There are two ways to run the deploy. Both execute the same script
(`packages/contracts/script/Deploy.s.sol`).

### Option A — With Makefile (recommended)

From the repo root:

```bash
make deploy-sepolia
```

The target validates that the required env vars are defined before invoking
`forge script`. If any are missing, it aborts with a clear message.

### Option B — Manually

If you want to control each flag directly:

```bash
cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY
```

### What each flag does

- `--rpc-url` — the Base Sepolia endpoint (chain ID 84532).
- `--private-key` — signs deploy txs with the deployer wallet.
- `--broadcast` — without this flag, Foundry only simulates the deploy (dry-run). With it, txs are sent to the network.
- `--verify` — after deploying, submits the source code to Basescan for verification.
- `--etherscan-api-key` — the Basescan API key (Foundry reuses that flag name even for Base).

If you **don't have a Basescan API key**, omit `--verify` and
`--etherscan-api-key`. You can verify manually afterwards (see section 6).

### What to expect in the output

The script deploys the 3 contracts in order:

1. `StakeManager` — with `usdc` and `guardian` (deployer)
2. `DisputeResolver` — pointing at `StakeManager`, with the `treasury` and the arbiter array
3. `NodeRegistry` — pointing at `StakeManager`
4. Calls `stakeManager.initialize(disputeResolver, nodeRegistry)` to close the circular dependency

At the end it prints the 3 addresses and runs sanity-check assertions.

---

## 5. Save the addresses

The script finishes by printing a block ready to copy into `.env`:

```
--- Copy to your .env ---
NODE_REGISTRY_ADDRESS=0x...
STAKE_MANAGER_ADDRESS=0x...
DISPUTE_RESOLVER_ADDRESS=0x...
-------------------------
```

Copy those 3 lines into your `.env` (replacing the default zero values). The
API and Node read them at boot to connect to the contracts.

### Foundry artifacts

Foundry stores the full deploy record (txs, receipts, addresses) in:

```
packages/contracts/broadcast/Deploy.s.sol/84532/run-latest.json
```

Where `84532` is the Base Sepolia chain ID. Keep this file — it's the
reproducible evidence of the deploy and useful for future debugging.

---

## 6. Verify on Basescan

Once deployed, each contract is visible at:

```
https://sepolia.basescan.org/address/<CONTRACT_ADDRESS>
```

If you used `--verify` and it succeeded, you'll see the source code and the
"Read Contract" / "Write Contract" tabs available.

### Verify manually (if `--verify` failed)

```bash
cd packages/contracts

forge verify-contract <ADDRESS> src/NodeRegistry.sol:NodeRegistry \
  --chain base-sepolia \
  --etherscan-api-key $BASESCAN_API_KEY

forge verify-contract <ADDRESS> src/StakeManager.sol:StakeManager \
  --chain base-sepolia \
  --etherscan-api-key $BASESCAN_API_KEY

forge verify-contract <ADDRESS> src/DisputeResolver.sol:DisputeResolver \
  --chain base-sepolia \
  --etherscan-api-key $BASESCAN_API_KEY
```

If the contracts have constructor args, you may need to pass them with
`--constructor-args $(cast abi-encode "constructor(address,address)" <usdc> <guardian>)`.
The args are visible in `broadcast/Deploy.s.sol/84532/run-latest.json`.

---

## 7. Smoke test the network

Once deployed and with addresses in `.env`, run a smoke test on the full stack.

1. **Update `.env`** with the real addresses:
   ```bash
   NODE_REGISTRY_ADDRESS=0x...   # from the script output
   STAKE_MANAGER_ADDRESS=0x...
   DISPUTE_RESOLVER_ADDRESS=0x...
   ```

2. **Bring up the stack**:
   ```bash
   make up
   ```

3. **Initial seed** (creates merchant + API keys):
   ```bash
   make seed
   ```
   Save the API keys it prints — they are not shown again.

4. **Create a test payment intent**:
   ```bash
   curl -X POST http://localhost:3000/v1/intents \
     -H "Authorization: Bearer sk_test_XXXX" \
     -H "Content-Type: application/json" \
     -d '{"amount": "10.00", "currency": "USDC"}'
   ```
   You should receive a JSON with `id`, `status: "created"`, and the derived
   payment address.

5. **Check the logs**:
   ```bash
   make logs-api
   make logs-node
   ```
   Look for errors at startup (RPC connection, contract reads, etc.)

---

## 8. Troubleshooting

Common errors and how to fix them:

### `Insufficient funds`
The deployer wallet is out of Sepolia ETH. Use the faucets listed in section 1
and wait for the faucet tx to confirm before retrying.

### `nonce too low`
Nonce out of sync (happens if you sent txs from the same wallet in parallel).
Wait a few seconds and retry — Foundry re-reads the nonce.

### `execution reverted: NotGuardian`
`StakeManager.initialize()` was called from a wallet other than the deployer.
This shouldn't happen with the stock script since it uses the same
`DEPLOYER_PRIVATE_KEY` across all steps. If you hit it, make sure there's no
partial deploy from a prior run — redeploy from scratch.

### `forge: command not found`
Foundry is not on PATH. Run `foundryup` or reinstall:
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Basescan verify fails
- Check that `BASESCAN_API_KEY` is valid (copy it again from https://basescan.org/myapikey).
- Make sure the key is for **Basescan** (not Etherscan mainnet).
- If the contract already had a partial verification, it may reject. Wait 1-2 minutes and retry.

### `No source files found`
You're running `forge script` from the wrong directory. It must be from
`packages/contracts/`:
```bash
cd packages/contracts
```

### `ARBITER_1: environment variable not found`
The env var isn't loaded in your shell. Remember:
```bash
set -a && source .env && set +a
```

---

## 9. Next steps

After a successful deploy:

### Register your first node

To operate a relay node, first approve USDC to the `StakeManager`, then call
`NodeRegistry.register()` with the minimum stake (100 USDC = `100000000` with
6 decimals):

```bash
# 1. Approve USDC to the StakeManager
cast send $USDC_ADDRESS "approve(address,uint256)" \
  $STAKE_MANAGER_ADDRESS 100000000 \
  --private-key $NODE_OPERATOR_PRIVATE_KEY \
  --rpc-url $BASE_SEPOLIA_RPC_URL

# 2. Register the node
cast send $NODE_REGISTRY_ADDRESS "register(string,uint256)" \
  "http://localhost:4000" 100000000 \
  --private-key $NODE_OPERATOR_PRIVATE_KEY \
  --rpc-url $BASE_SEPOLIA_RPC_URL
```

### Publish the addresses to the community

Open a GitHub Issue with the `deployment` tag including:

- Chain: `Base Sepolia (84532)`
- Deploy block (from `run-latest.json`)
- Addresses of the 3 contracts (with Basescan links)
- Commit hash used for the deploy

That way others can point their nodes or dashboards at your deploy.

### Run the node daemon pointing at the deployed contracts

Update `.env` with `NODE_OPERATOR_ADDRESS` and `NODE_OPERATOR_PRIVATE_KEY`,
and relaunch the stack:

```bash
make restart-node
make logs-node
```

---

## 10. Security — important notes

- **Do NOT deploy to mainnet yet.** Contracts are pending external audit.
  Phase 1 is testnet-only.

- **The guardian can pause the contracts** (OpenZeppelin `Pausable` pattern).
  The guardian is the deployer wallet by default — rotate that key if you
  suspect compromise.

- **3-of-5 arbiter governance.** Adding a new arbiter requires `proposeArbiter()`
  followed by 3 approvals (from the existing arbiters). There is no bypass —
  plan the multisig composition before deploying.

- **`initialize()` can only be called ONCE.** If something fails between
  steps 1-3 of the deploy, the contracts end up in an unusable state (the
  `StakeManager` doesn't know who the `DisputeResolver` or `NodeRegistry` are).
  If that happens, redeploy from scratch — don't try to recover the partial deploy.

- **Don't reuse the deployer wallet for normal operations.** After the deploy,
  transfer the guardian role to a multisig (once one exists) and move any
  remaining funds to a separate wallet.

---

## References

- Deploy script: `packages/contracts/script/Deploy.s.sol`
- Foundry config: `packages/contracts/foundry.toml`
- Environment variables: `.env.example`
- Makefile target: `deploy-sepolia`
- Base Sepolia chain ID: `84532`
- Explorer: https://sepolia.basescan.org/

#!/usr/bin/env bash
#
# register-node-sepolia.sh
#
# Register an OpenRelay node on Base Sepolia testnet.
#
# Flow:
#   1. Load .env (all config comes from there)
#   2. Read minStake from NodeRegistry and USDC balance of the operator
#   3. Abort if balance < minStake (so no gas is wasted)
#   4. Approve StakeManager to pull minStake of USDC
#   5. Call NodeRegistry.register(endpoint, minStake)
#   6. Print tx hashes + Basescan links
#   7. Verify on-chain via NodeRegistry.getNode(operator)
#
# The script never prints the private key.
#
# All contract addresses and the operator identity are read from .env — this
# script is reusable by any operator and by future redeploys (just update .env).

set -euo pipefail

# ---------- Config ----------

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASESCAN_TX="https://sepolia.basescan.org/tx"
BASESCAN_ADDR="https://sepolia.basescan.org/address"

# ---------- Tooling ----------

export PATH="$HOME/.foundry/bin:$PATH"

if ! command -v cast >/dev/null 2>&1; then
  echo "ERROR: 'cast' (foundry) not found on PATH." >&2
  echo "       Install foundry: https://book.getfoundry.sh/getting-started/installation" >&2
  exit 1
fi

# ---------- Load .env ----------

if [[ ! -f "$REPO_ROOT/.env" ]]; then
  echo "ERROR: $REPO_ROOT/.env not found." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. "$REPO_ROOT/.env"
set +a

: "${BASE_SEPOLIA_RPC_URL:?BASE_SEPOLIA_RPC_URL must be set in .env}"
: "${NODE_ENDPOINT:?NODE_ENDPOINT must be set in .env (public URL of the node)}"
: "${NODE_OPERATOR_ADDRESS:?NODE_OPERATOR_ADDRESS must be set in .env}"
: "${NODE_OPERATOR_PRIVATE_KEY:?NODE_OPERATOR_PRIVATE_KEY must be set in .env}"
: "${NODE_REGISTRY_ADDRESS:?NODE_REGISTRY_ADDRESS must be set in .env (after deploy)}"
: "${STAKE_MANAGER_ADDRESS:?STAKE_MANAGER_ADDRESS must be set in .env (after deploy)}"
: "${USDC_ADDRESS:?USDC_ADDRESS must be set in .env}"

RPC="$BASE_SEPOLIA_RPC_URL"
ENDPOINT="$NODE_ENDPOINT"
OPERATOR="$NODE_OPERATOR_ADDRESS"
NODE_REGISTRY="$NODE_REGISTRY_ADDRESS"
STAKE_MANAGER="$STAKE_MANAGER_ADDRESS"
USDC="$USDC_ADDRESS"

# Guard: never publish a localhost URL on-chain. Immutable history — would look bad.
case "$ENDPOINT" in
  *localhost*|*127.0.0.1*|*0.0.0.0*)
    echo "ERROR: NODE_ENDPOINT ('$ENDPOINT') points to localhost." >&2
    echo "       Set NODE_ENDPOINT in .env to the public URL of your node before registering on-chain." >&2
    exit 1
    ;;
esac

# ---------- Helpers ----------

# Format a 6-decimal integer (USDC smallest units) as a decimal USDC amount.
fmt_usdc() {
  local raw="$1"
  # whole = raw / 1e6, frac = raw % 1e6 (zero-padded to 6)
  local whole frac
  whole=$(( raw / 1000000 ))
  frac=$(( raw % 1000000 ))
  printf "%d.%06d" "$whole" "$frac"
}

log() {
  printf "\n==> %s\n" "$*"
}

# ---------- 1. Read MIN_STAKE ----------

log "Reading NodeRegistry.minStake()"
MIN_STAKE_RAW="$(cast call "$NODE_REGISTRY" "minStake()(uint256)" --rpc-url "$RPC")"
# cast may print trailing info like "100000000 [1e8]"; keep only the leading integer.
MIN_STAKE_RAW="${MIN_STAKE_RAW%% *}"
echo "    MIN_STAKE = $MIN_STAKE_RAW ($(fmt_usdc "$MIN_STAKE_RAW") USDC)"

# ---------- 2. Read operator USDC balance ----------

log "Reading USDC balance of operator $OPERATOR"
BAL_RAW="$(cast call "$USDC" "balanceOf(address)(uint256)" "$OPERATOR" --rpc-url "$RPC")"
BAL_RAW="${BAL_RAW%% *}"
echo "    balance  = $BAL_RAW ($(fmt_usdc "$BAL_RAW") USDC)"

# ---------- 3. Guard: balance must be >= MIN_STAKE ----------

# Use bc for safe big-integer compare (values fit in 256-bit, but here they're
# small enough for shell arithmetic too — use bash arithmetic with care).
if ! awk -v a="$BAL_RAW" -v b="$MIN_STAKE_RAW" 'BEGIN { exit !(a+0 >= b+0) }'; then
  echo ""
  echo "BLOCKED: operator USDC balance ($(fmt_usdc "$BAL_RAW")) is less than MIN_STAKE ($(fmt_usdc "$MIN_STAKE_RAW"))." >&2
  echo "         No transactions sent. Get testnet USDC from https://faucet.circle.com/ (Base Sepolia)" >&2
  echo "         for address $OPERATOR and re-run this script." >&2
  exit 2
fi

# ---------- 4. Approve StakeManager ----------

log "USDC.approve(StakeManager=$STAKE_MANAGER, $MIN_STAKE_RAW)"
APPROVE_OUT="$(cast send "$USDC" \
  "approve(address,uint256)" \
  "$STAKE_MANAGER" \
  "$MIN_STAKE_RAW" \
  --rpc-url "$RPC" \
  --private-key "$NODE_OPERATOR_PRIVATE_KEY" \
  --json)"

APPROVE_TX="$(printf '%s' "$APPROVE_OUT" | sed -n 's/.*"transactionHash":"\(0x[0-9a-fA-F]\{64\}\)".*/\1/p')"
if [[ -z "$APPROVE_TX" ]]; then
  echo "ERROR: could not parse approve tx hash from cast output:" >&2
  echo "$APPROVE_OUT" >&2
  exit 3
fi
echo "    approve tx: $APPROVE_TX"
echo "    basescan:   $BASESCAN_TX/$APPROVE_TX"

# ---------- 5. Register the node ----------

log "NodeRegistry.register(\"$ENDPOINT\", $MIN_STAKE_RAW)"
REGISTER_OUT="$(cast send "$NODE_REGISTRY" \
  "register(string,uint256)" \
  "$ENDPOINT" \
  "$MIN_STAKE_RAW" \
  --rpc-url "$RPC" \
  --private-key "$NODE_OPERATOR_PRIVATE_KEY" \
  --json)"

REGISTER_TX="$(printf '%s' "$REGISTER_OUT" | sed -n 's/.*"transactionHash":"\(0x[0-9a-fA-F]\{64\}\)".*/\1/p')"
if [[ -z "$REGISTER_TX" ]]; then
  echo "ERROR: could not parse register tx hash from cast output:" >&2
  echo "$REGISTER_OUT" >&2
  exit 4
fi
echo "    register tx: $REGISTER_TX"
echo "    basescan:    $BASESCAN_TX/$REGISTER_TX"

# ---------- 6. Verify on-chain ----------

log "Verifying on-chain: NodeRegistry.getNode($OPERATOR)"
NODE_STATE="$(cast call "$NODE_REGISTRY" \
  "getNode(address)((address,string,uint256,bool,uint256))" \
  "$OPERATOR" \
  --rpc-url "$RPC")"
echo "    $NODE_STATE"

log "Done."
echo "  NodeRegistry: $BASESCAN_ADDR/$NODE_REGISTRY"
echo "  Operator:     $BASESCAN_ADDR/$OPERATOR"
echo "  Approve tx:   $BASESCAN_TX/$APPROVE_TX"
echo "  Register tx:  $BASESCAN_TX/$REGISTER_TX"

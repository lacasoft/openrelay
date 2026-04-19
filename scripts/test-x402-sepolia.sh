#!/usr/bin/env bash
# test-x402-sepolia.sh
# End-to-end test of x402 payment verification against Base Sepolia.
#
# Flow:
#   1. Verify prerequisites (stack running, wallet funded)
#   2. Send a real USDC transfer on-chain (0.001 USDC = 1000 units)
#   3. Build x402 payload with the tx hash
#   4. POST to /v1/x402/verify, expect 200
#   5. Replay the same request, expect 409 (SET NX replay protection)
#
# Requirements:
#   - .env at repo root with DEPLOYER_PRIVATE_KEY, BASE_SEPOLIA_RPC_URL
#   - Stack running (make up, make seed)
#   - /tmp/smoke-test-keys.txt with the seeded sk_live_* and pk_live_* keys
#   - Deployer wallet with:
#       - >= 1000 USDC units (0.001 USDC) on Base Sepolia
#       - >= 0.0001 ETH for gas on Base Sepolia
#
# Usage:
#   bash scripts/test-x402-sepolia.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
set -a; . ./.env; set +a
export PATH="$HOME/.foundry/bin:$PATH"

USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e
OPERATOR=0x063250650155518BE28989Ec41c597dC1d1eF05C
TRANSFER_AMOUNT=1000   # 0.001 USDC (USDC has 6 decimals)

# ── 1. Prerequisites ───────────────────────────────────────────

echo "→ Checking API health..."
if ! curl -s --max-time 5 http://localhost:3000/health | grep -q '"status"'; then
  echo "ERROR: API not responding at http://localhost:3000/health" >&2
  echo "       Run 'make up' first." >&2
  exit 1
fi

echo "→ Checking operator USDC balance on Base Sepolia..."
USDC_BALANCE=$(cast call "$USDC" "balanceOf(address)(uint256)" "$OPERATOR" --rpc-url "$BASE_SEPOLIA_RPC_URL" | awk '{print $1}')
if [ "$USDC_BALANCE" -lt "$TRANSFER_AMOUNT" ]; then
  echo "ERROR: Operator has $USDC_BALANCE USDC units; need at least $TRANSFER_AMOUNT" >&2
  echo "       Top up USDC via https://faucet.circle.com/ (Base Sepolia)." >&2
  exit 1
fi
echo "  USDC balance: $USDC_BALANCE units ($(echo "scale=6; $USDC_BALANCE/1000000" | bc) USDC)"

echo "→ Checking operator ETH balance..."
ETH_BALANCE=$(cast balance "$OPERATOR" --rpc-url "$BASE_SEPOLIA_RPC_URL" --ether)
echo "  ETH balance: $ETH_BALANCE ETH"

# ── 2. Obtain API key ──────────────────────────────────────────

if [ ! -f /tmp/smoke-test-keys.txt ]; then
  echo "→ Seeding a new merchant..."
  make seed 2>&1 | tee /tmp/smoke-test-keys.txt
fi

SK_KEY=$(grep -oE '"sk_live":"[^"]+' /tmp/smoke-test-keys.txt | head -1 | cut -d'"' -f4)
if [ -z "$SK_KEY" ]; then
  SK_KEY=$(grep -oE '"sk_test":"[^"]+' /tmp/smoke-test-keys.txt | head -1 | cut -d'"' -f4)
fi
if [ -z "$SK_KEY" ]; then
  echo "ERROR: Could not extract sk_ key from /tmp/smoke-test-keys.txt" >&2
  exit 1
fi
echo "  Using API key: ${SK_KEY:0:10}..."

# ── 3. Execute USDC transfer on-chain ──────────────────────────

echo "→ Sending USDC transfer (self-to-self)..."
TX_JSON=$(cast send "$USDC" "transfer(address,uint256)" "$OPERATOR" "$TRANSFER_AMOUNT" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --json)
TX_HASH=$(echo "$TX_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "  Tx hash: $TX_HASH"
echo "  Basescan: https://sepolia.basescan.org/tx/$TX_HASH"

echo "  Waiting 5s for block confirmation..."
sleep 5

# ── 4. Build x402 payload ──────────────────────────────────────

PAYLOAD_JSON="{\"tx_hash\":\"$TX_HASH\",\"amount\":$TRANSFER_AMOUNT,\"asset\":\"usdc\",\"network\":\"base\"}"
PAYLOAD_B64=$(echo -n "$PAYLOAD_JSON" | base64 -w 0)

# ── 5. First verification request (expect 200) ────────────────

echo ""
echo "→ Submitting x402 verification request..."
RESP1=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST http://localhost:3000/v1/x402/verify \
  -H "Authorization: Bearer $SK_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"payment\":\"$PAYLOAD_B64\",\"amount\":$TRANSFER_AMOUNT,\"chain\":\"base\"}")
CODE1=$(echo "$RESP1" | grep -oE "HTTP_CODE:[0-9]+" | cut -d: -f2)
BODY1=$(echo "$RESP1" | sed '$d')
echo "  HTTP: $CODE1"
echo "  Body: $BODY1" | python3 -m json.tool 2>/dev/null || echo "  Body: $BODY1"

if [ "$CODE1" != "200" ]; then
  echo "⚠️  First request expected 200 but got $CODE1" >&2
fi

# ── 6. Replay attempt (expect 409) ────────────────────────────

echo ""
echo "→ Replaying the same request (should be rejected)..."
RESP2=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST http://localhost:3000/v1/x402/verify \
  -H "Authorization: Bearer $SK_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"payment\":\"$PAYLOAD_B64\",\"amount\":$TRANSFER_AMOUNT,\"chain\":\"base\"}")
CODE2=$(echo "$RESP2" | grep -oE "HTTP_CODE:[0-9]+" | cut -d: -f2)
BODY2=$(echo "$RESP2" | sed '$d')
echo "  HTTP: $CODE2"
echo "  Body: $BODY2" | python3 -m json.tool 2>/dev/null || echo "  Body: $BODY2"

if [ "$CODE2" != "409" ]; then
  echo "⚠️  Replay expected 409 but got $CODE2" >&2
fi

# ── 7. Verdict ────────────────────────────────────────────────

echo ""
echo "═════════════════════════════════════════════════"
if [ "$CODE1" = "200" ] && [ "$CODE2" = "409" ]; then
  echo "✅ x402 end-to-end PASS"
  echo "   - Real USDC transfer verified on-chain via viem"
  echo "   - Replay protection (Redis SET NX) works"
else
  echo "❌ x402 end-to-end FAIL — see responses above"
fi
echo "═════════════════════════════════════════════════"

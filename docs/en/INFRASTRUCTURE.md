# OpenRelay Infrastructure Guide

*Everything you need to become a technical expert on OpenRelay. This document covers architecture, component internals, transaction lifecycle, economic model, security, deployment, and integration in full depth.*

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Component Map](#2-component-map)
3. [Settlement Layer](#3-settlement-layer)
4. [Smart Contract Layer](#4-smart-contract-layer)
5. [Routing Engine](#5-routing-engine)
6. [API Layer](#6-api-layer)
7. [Node Daemon](#7-node-daemon)
8. [SDK Layer](#8-sdk-layer)
9. [x402 Protocol](#9-x402-protocol)
10. [Transaction Lifecycle](#10-transaction-lifecycle)
11. [Economic Model](#11-economic-model)
12. [Security Model](#12-security-model)
13. [Node Operation Guide](#13-node-operation-guide)
14. [Merchant Integration Guide](#14-merchant-integration-guide)
15. [Deployment Guide](#15-deployment-guide)
16. [Comparative Analysis](#16-comparative-analysis)
17. [Invariants and Guarantees](#17-invariants-and-guarantees)

---

## 1. System Overview

OpenRelay is a five-layer payment routing system. Each layer has a single, well-defined responsibility and communicates with adjacent layers through documented interfaces.

```
┌──────────────────────────────────────────────────────────┐
│  SDK Layer                                               │
│  @openrelay/sdk (TS) · openrelay-python · openrelay-php  │
│  x402 middleware for Fastify · Next.js · Express         │
├──────────────────────────────────────────────────────────┤
│  API Layer                                               │
│  Fastify REST API · PostgreSQL · Redis                   │
│  Routing Engine · Webhook Delivery · Auth                │
├──────────────────────────────────────────────────────────┤
│  Routing Layer                                           │
│  Node discovery · Score computation · Intent assignment  │
├──────────────────────────────────────────────────────────┤
│  Protocol Layer (on-chain)                               │
│  NodeRegistry.sol · StakeManager.sol · DisputeResolver   │
├──────────────────────────────────────────────────────────┤
│  Settlement Layer                                        │
│  Base (USDC) · Lightning Network (BTC/sats)              │
└──────────────────────────────────────────────────────────┘
```

**The non-negotiable invariant across all layers:**
Funds flow directly from payer to merchant. No layer, component, or node holds funds at any point. Nodes observe, confirm, and earn fees from the settled amount — they are never in the fund path.

---

## 2. Component Map

### Package dependency graph

```
@openrelay/protocol
    ├── @openrelay/sdk (depends on protocol for types)
    ├── @openrelay/api (depends on protocol for types)
    └── @openrelay/node (depends on protocol for types)

@openrelay/contracts (Solidity — independent of TS packages)

@openrelay/dashboard (depends on sdk for client-side integration)
```

### Repository structure

```
openrelay/
├── packages/
│   ├── protocol/          # Shared types, constants, errors
│   │   └── src/
│   │       ├── types/
│   │       │   ├── payment-intent.ts   # PaymentIntent, CreatePaymentIntentParams
│   │       │   ├── node.ts             # NodeInfo, NodeScore, IntentAssignment
│   │       │   ├── webhook.ts          # WebhookEvent, DisputeEvent
│   │       │   └── x402.ts             # X402PaymentRequired, X402MiddlewareOptions
│   │       ├── constants.ts            # All protocol constants (fees, timeouts, etc.)
│   │       └── errors.ts               # OpenRelaySDKError, error codes
│   │
│   ├── contracts/         # Solidity smart contracts
│   │   ├── src/
│   │   │   ├── NodeRegistry.sol
│   │   │   ├── StakeManager.sol
│   │   │   ├── DisputeResolver.sol
│   │   │   └── interfaces/
│   │   ├── test/          # 58 Foundry tests + fuzz
│   │   └── script/        # Deploy.s.sol
│   │
│   ├── node/              # Node operator daemon
│   │   └── src/
│   │       ├── routes/    # /health, /info, /intents/assign, /intents/:id/settle
│   │       ├── services/  # registry verification
│   │       └── lib/       # config, hmac signing
│   │
│   ├── api/               # Merchant-facing REST API
│   │   └── src/
│   │       ├── routes/    # payment-intents, webhooks, x402, nodes
│   │       ├── services/  # routing engine
│   │       ├── middleware/ # auth (API key verification)
│   │       └── lib/       # config, db, redis, schema.sql
│   │
│   ├── sdk-js/            # @openrelay/sdk npm package
│   │   └── src/
│   │       ├── resources/ # PaymentIntents, Webhooks
│   │       ├── x402/      # x402 middleware
│   │       └── lib/       # HTTP client, types
│   │
│   └── dashboard/         # Merchant dashboard (Next.js — Phase 1)
│
├── infra/
│   ├── docker/
│   │   ├── docker-compose.yml
│   │   ├── Dockerfile.api
│   │   └── Dockerfile.node
│   └── k8s/               # Helm charts (Phase 2)
│
└── .github/
    └── workflows/
        ├── ci.yml          # PR validation
        └── release.yml     # npm + Docker publish
```

---

## 3. Settlement Layer

### 3.1 Why Base + USDC

Base is an L2 on Ethereum backed by Coinbase. It was selected as the primary settlement layer for three reasons:

**Fees.** Transactions on Base cost $0.001 to $0.005, making micropayments economically viable. On Ethereum mainnet, a $0.001 payment would cost $2–5 in gas. On Base, the gas cost is less than the payment.

**x402 ecosystem.** The x402 protocol (HTTP 402 Payment Required for machine-to-machine payments) was designed with Base as the primary chain. The reference implementation from x402.org targets Base Sepolia for testing.

**USDC liquidity.** Circle's USDC on Base has deep liquidity, is redeemable 1:1 for USD, and is the standard unit of account for business-to-business crypto transactions.

### 3.2 USDC contract address

```
Base mainnet:  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Base Sepolia:  0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

### 3.3 Amount representation

All USDC amounts in OpenRelay use 6-decimal micro-units:

```
1 USDC         = 1,000,000 micro-units
$10.00 USDC    = 10,000,000
$0.001 USDC    = 1,000
$100.00 USDC   = 100,000,000
```

**Never confuse units.** Every API endpoint, SDK method, and smart contract function uses micro-units. The only place human-readable amounts appear is in the merchant dashboard display layer.

### 3.4 Lightning Network

Lightning Network support (BTC/sats) is included in Phase 1 for BTC-denominated payments. The node daemon connects to an LND instance via gRPC. The node generates BOLT11 invoices on behalf of the merchant and monitors for payment. Confirmation is off-chain (Lightning) but the node records the settlement event on-chain via its activity log.

### 3.5 Chain confirmations required

| Chain | Confirmations | Typical time |
|---|---|---|
| Base | 1 | ~2 seconds |
| Ethereum mainnet (future) | 12 | ~2.5 minutes |
| Lightning | Off-chain | Instant |

---

## 4. Smart Contract Layer

Three non-upgradeable contracts on Base define all on-chain protocol rules.

### Design principles

- **Non-upgradeable:** No proxy patterns, no admin keys, no pause functions. What is audited is what runs. If a bug requires a fix, the correct response is a new deployment with an RFC-approved migration path.
- **Minimal surface:** Each contract does exactly one thing. No cross-concerns.
- **USDC-denominated:** All stake, fees, and slashing are in USDC. No protocol token.
- **Event-driven:** All state changes emit events. The off-chain routing engine and node daemon rely on event logs, not polling.

---

### 4.1 NodeRegistry.sol

**Responsibility:** Permissionless node registration and discovery.

**State:**
```solidity
mapping(address => Node) private _nodes;
address[] private _activeOperators;
```

**Key functions:**

`register(string endpoint, uint256 stakeAmount)`
- Callable by anyone with sufficient USDC approval
- Requires `stakeAmount >= MIN_STAKE` (100 USDC = 100,000,000)
- Calls `StakeManager.depositFor()` to transfer USDC
- Pushes operator to `_activeOperators`
- Emits `NodeRegistered`

`deactivate()`
- Removes operator from `_activeOperators`
- Does NOT release stake — must go through StakeManager
- Emits `NodeDeactivated`

`getActiveNodes() → address[]`
- Returns all active operator addresses
- Used by the routing engine to discover candidates

**Events the routing engine listens to:**
```
NodeRegistered(address indexed operator, string endpoint, uint256 stake)
NodeUpdated(address indexed operator, string endpoint)
NodeDeactivated(address indexed operator)
```

**Security invariants:**
- An address cannot register twice (checked via `registeredAt != 0`)
- Stake is held by StakeManager, not NodeRegistry — registry has no token balance
- `getActiveNodes()` is O(n) — acceptable for Phase 1, needs pagination in Phase 3

---

### 4.2 StakeManager.sol

**Responsibility:** USDC stake custody, withdrawal timelock, and slashing.

**State:**
```solidity
mapping(address => StakeInfo) private _stakes;

struct StakeInfo {
    uint256 staked;
    uint256 pendingWithdrawal;
    uint256 unlockAt;
}
```

**The withdrawal timelock:**

The 7-day timelock between `requestWithdrawal()` and `executeWithdrawal()` is the primary protection against node exit scams. Without it, a malicious node could:
1. Accept a large payment intent
2. Fail to route it properly
3. Immediately withdraw all stake before the merchant opens a dispute

With the timelock, the merchant has 7 days to open a dispute after settlement. The dispute window and the withdrawal timelock are intentionally equal — they create a closed system where a node cannot withdraw before a dispute can be resolved.

**Slashing mechanics:**

When `DisputeResolver` calls `slash(operator, amount, disputeId)`:
1. The function checks `staked + pendingWithdrawal` as the total slashable amount
2. It reduces `staked` first, then `pendingWithdrawal` if staked is insufficient
3. The slash amount is capped at the total available — slashing can never create negative balances
4. Slashed funds remain in the contract and are tracked for treasury withdrawal (Phase 2 feature)

**Access control:**
- `depositFor()` — only callable by `nodeRegistry` address (set at deploy, immutable)
- `slash()` — only callable by `disputeResolver` address (set at deploy, immutable)
- `deposit()`, `requestWithdrawal()`, `executeWithdrawal()` — callable by any registered operator

---

### 4.3 DisputeResolver.sol

**Responsibility:** Dispute adjudication and stake slashing decisions.

**Lifecycle:**

```
Open → NodeResponded → Resolved (MerchantWins or NodeWins)
Open → (48h passes without response) → Expired → Slashed
```

**Voting mechanics (Phase 1):**

Disputes are resolved by a 3-of-5 multisig. Each arbiter calls `vote(disputeId, outcome)`. When 3 votes for the same outcome accumulate, `_resolve()` is triggered automatically. This avoids requiring a separate execution step.

Key design choices:
- **Concurrent voting:** All 5 arbiters can vote in any order. The threshold triggers resolution automatically.
- **No vote changes:** Once an arbiter votes, their vote is immutable (checked via `arbiterVotes[disputeId][msg.sender] != None`).
- **Expired = MerchantWins:** If a node fails to respond within 48 hours, `expireDispute()` can be called by anyone. An expired dispute triggers slashing without arbiter votes. This prevents nodes from ignoring disputes to avoid slashing.

**Evidence storage:**

Evidence is stored as IPFS CIDs (content-addressed hashes), not as on-chain data. This keeps contract storage costs low while making evidence publicly auditable — anyone can retrieve the IPFS content for any dispute.

**Phase 3 migration:**

The multisig arbiters will be replaced by on-chain governance in Phase 3. The contract interface will not change — only the implementation of `vote()` will be updated via a new deployment with an RFC-approved migration.

---

### 4.4 Contract deployment order

Due to circular dependencies (Registry needs StakeManager, StakeManager needs Registry address), contracts are deployed in this order:

```
1. Deploy StakeManager (with deployer address as placeholder for both registry and resolver)
2. Deploy DisputeResolver (with real StakeManager address)
3. Deploy NodeRegistry (with real StakeManager address)
```

The placeholder addresses in StakeManager are never called maliciously — the deployer wallet has no special permissions in the contract logic. This is a known Phase 1 limitation with a documented migration path to a factory pattern in Phase 2.

---

## 5. Routing Engine

The routing engine is the most performance-sensitive component of the API layer. It runs inside `packages/api/src/services/routing.ts` and is invoked for every new payment intent.

### 5.1 Node score formula

```
Score = (uptime_weight   × 0.30)
      + (speed_weight    × 0.30)
      + (stake_weight    × 0.20)
      + (disputes_weight × 0.20)

Where:
  uptime_weight   = node.uptime_30d  (0.0–1.0, from /info endpoint)

  speed_weight    = 1 - (node.avg_settlement_ms / MAX_SETTLEMENT_MS)
                   MAX_SETTLEMENT_MS = 30,000ms
                   Capped at 0.0 (never negative)

  stake_weight    = min(node.stake / TARGET_STAKE, 1.0)
                   TARGET_STAKE = 10,000 USDC = 10,000,000,000 micro-units
                   A node with 100 USDC (minimum) has stake_weight = 0.01
                   A node with 10,000+ USDC has stake_weight = 1.0

  disputes_weight = disputes_won / max(disputes_total, 1)
                   New nodes with 0 disputes get disputes_weight = 1.0
                   (benefit of the doubt, corrected by uptime and stake)
```

**Interpretation:** The score weights uptime and speed equally at 30% each because reliability and performance are the primary merchant concerns. Stake (20%) reflects skin in the game — a node willing to stake more is economically aligned with good behavior. Dispute history (20%) is a trust signal that grows over time.

### 5.2 Hard filters (applied before scoring)

Nodes that fail any hard filter are excluded from routing regardless of score:

| Filter | Condition |
|---|---|
| On-chain registration | Not in NodeRegistry |
| Active flag | `active = false` in registry |
| Chain support | Does not list requested chain in `/health` |
| Capacity | `/health` returns `capacity < 0.1` |
| Latency | Round-trip to `/health` > 5 seconds |
| Dispute lock | Has open dispute in `Open` status |
| Merchant whitelist | Not in merchant's `node_whitelist` (if set) |
| Merchant blacklist | In merchant's `node_blacklist` (if set) |
| Minimum stake | Below merchant's `min_stake` preference |
| Minimum score | Below merchant's `min_score` preference |

### 5.3 Parallel racing algorithm

```typescript
async function routeIntent(intent, candidates): Promise<RouteResult | null> {
  // 1. Apply hard filters
  const eligible = candidates
    .filter(c => passesHardFilters(c, intent, merchantPrefs))
    .sort((a, b) => b.score - a.score)
    .slice(0, ROUTING_CANDIDATES)  // top 5

  if (eligible.length === 0) return null

  // 2. Race concurrent assignment requests
  const results = await Promise.allSettled(
    eligible.map(c => assignToNode(c.node.endpoint, intent))
  )

  // 3. Return first accepted response
  for (const result of results) {
    if (result.status === 'fulfilled') return result.value
  }

  return null  // all candidates rejected
}
```

**Why parallel, not sequential:** If the top-scored node is temporarily at capacity, sequential routing would wait for a timeout before trying the next candidate. Parallel racing accepts the first available response in ~3 seconds (the node assignment timeout), regardless of which candidate responds first.

**Rejection handling:** Nodes may reject an intent with `{ accepted: false, reason: 'at_capacity' }`. The routing engine accepts the next fulfilled result. If all 5 candidates reject, the intent stays in `CREATED` state and the SDK retries after 5 seconds.

### 5.4 Score caching

Scores are cached in Redis with a 60-second TTL. This means:
- Node scores are refreshed at most once per minute
- Stale scores persist for up to 60 seconds after a node changes status
- The routing engine does NOT re-fetch scores for every intent — it uses the cached value

The 60-second TTL is a deliberate balance between freshness and performance. At scale, re-computing scores for every intent from live node `/info` data would be prohibitively expensive.

---

## 6. API Layer

### 6.1 Tech stack

| Concern | Choice | Reason |
|---|---|---|
| Framework | Fastify 4 | 3× faster than Express. Native JSON schema validation. Better plugin system. |
| Database | PostgreSQL 16 | JSONB for metadata. Native TIMESTAMPTZ. ACID guarantees. |
| Cache | Redis 7 | Score caching. Rate limiting. x402 replay protection. |
| Validation | Zod | Runtime type safety at all API boundaries. |
| Auth | API key (Bearer) | Simplest viable auth for developer tooling. |

### 6.2 Authentication

Every API request (except health check) requires an `Authorization: Bearer <key>` header.

Key formats:
```
pk_live_xxx   Public key — read-only (GET endpoints)
sk_live_xxx   Secret key — full access (POST, DELETE)
pk_test_xxx   Public key — testnet
sk_test_xxx   Secret key — testnet
```

Keys are stored as bcrypt hashes in the `api_keys` table. The plaintext key is returned once at creation and never stored. If lost, the key must be regenerated.

### 6.3 Database schema summary

```sql
merchants           -- merchant accounts, wallet addresses, routing prefs
api_keys            -- hashed API keys with prefix metadata
payment_intents     -- full intent lifecycle with status machine
webhook_endpoints   -- registered webhook URLs with event subscriptions
webhook_deliveries  -- delivery attempts, retry state, response codes
disputes            -- dispute lifecycle with IPFS evidence CIDs
x402_payments_used  -- tx_hash uniqueness table for replay protection
```

The full schema is at `packages/api/src/lib/schema.sql`.

### 6.4 Rate limiting

Rate limiting is applied globally per API key via Redis:
- 100 requests per minute for standard keys
- Limit headers returned on every response (`X-RateLimit-Remaining`, etc.)
- 429 responses include `Retry-After` header

### 6.5 Webhook delivery

Webhooks are delivered with exponential backoff retry:

```
Attempt 1:   immediate
Attempt 2:   30 seconds
Attempt 3:   5 minutes
Attempt 4:   30 minutes
Attempt 5:   2 hours
Attempt 6:   12 hours
After 6 failures: marked as failed, no more retries
```

Webhook payloads are signed with HMAC-SHA256:
```
Header: OpenRelay-Signature: t=<timestamp>,v1=<hmac_hex>
HMAC input: <timestamp>.<payload_json>
```

Merchants verify signatures using `relay.webhooks.verify(payload, signature, secret)`.

---

## 7. Node Daemon

### 7.1 What a node does

A node daemon is an HTTP server that:
1. Registers on-chain in `NodeRegistry.sol` at startup
2. Exposes four routes: `/health`, `/info`, `/intents/assign`, `/intents/:id/settle`
3. Receives intent assignments from the routing engine
4. Monitors on-chain for USDC transfers matching assigned intents
5. Calls back to the API when settlement is confirmed
6. Maintains its own local store of assigned intents for auditing

### 7.2 Node routes in detail

**`GET /health`** — called by routing engine for scoring and liveness
```json
{
  "status": "ok",
  "version": "0.1.0",
  "operator": "0x...",
  "chains": ["base"],
  "capacity": 0.87
}
```
`capacity` is a float 0–1 representing available routing headroom. A node at capacity should return `capacity < 0.1` to be excluded from routing.

**`GET /info`** — called by routing engine for score computation
```json
{
  "operator": "0x...",
  "version": "0.1.0",
  "uptime_30d": 0.997,
  "avg_settlement_ms": 4200,
  "total_settled": 8432,
  "stake": "5000000000"
}
```
`stake` is returned as a string to avoid JavaScript BigInt precision issues.

**`POST /intents/assign`** — called by routing engine when assigning an intent
```json
// Request
{
  "intent_id": "pi_xxx",
  "amount": 10000000,
  "currency": "usdc",
  "chain": "base",
  "merchant_address": "0x...",
  "expires_at": 1718000000
}

// Response (accept)
{
  "accepted": true,
  "payment_address": "0x...",   // unique per intent
  "node_fee": 4000              // fee this node will earn
}

// Response (reject)
{
  "accepted": false,
  "reason": "at_capacity"
}
```

**`POST /intents/:id/settle`** — called by node's own chain watcher
```json
// Request (from node's chain watcher to itself, then propagated to API)
{
  "tx_hash": "0x...",
  "block_number": 12345678,
  "settled_at": 1718000000
}
```

### 7.3 HMAC request authentication

All requests from the routing engine to a node are authenticated with HMAC-SHA256:

```
Headers required:
  X-OpenRelay-Signature: sha256=<hmac_hex>
  X-OpenRelay-Timestamp: <unix_timestamp>

HMAC input: <timestamp>.<request_body>
```

The node rejects requests where:
- The signature does not match
- The timestamp is more than 5 minutes old (replay protection)

The HMAC secret is established when the node registers and is shared with the API layer. It is stored in the node's environment and never transmitted in plaintext.

### 7.4 Payment address uniqueness

**This is a critical security requirement.** Each intent must have a unique payment address. If the node reuses its operator wallet address for all intents, it becomes impossible to match on-chain transfers to specific intents — a malicious payer could send the wrong amount and claim they paid a different intent.

The correct implementation uses HD wallet derivation (BIP-32):
```
masterKey = deriveMasterKey(operatorPrivateKey)
intentAddress = deriveChild(masterKey, intentIndex)
```

Where `intentIndex` is a monotonically increasing counter persisted in the node's local store. This generates a unique address for each intent while all funds are still controlled by the operator's master key.

---

## 8. SDK Layer

### 8.1 Design philosophy

The SDK is designed to feel identical to Stripe's SDK for developers who have used Stripe. Same patterns: resource classes, async/await, webhook verification, error handling. The goal is zero friction for migration.

### 8.2 Request flow

```typescript
const relay = new OpenRelay({ apiKey: 'sk_live_xxx' })

// Creates a PaymentIntents resource instance
// All resource instances share the same HTTP client and config

await relay.paymentIntents.create(params)
// → POST https://api.openrelay.dev/v1/payment_intents
// → Authorization: Bearer sk_live_xxx
// → Content-Type: application/json
// → OpenRelay-Version: 0.1
```

### 8.3 Error handling

```typescript
try {
  const intent = await relay.paymentIntents.create({ ... })
} catch (e) {
  if (e instanceof OpenRelaySDKError) {
    console.log(e.code)    // 'invalid_api_key'
    console.log(e.message) // 'Missing or malformed Authorization header.'
    console.log(e.doc_url) // 'https://docs.openrelay.dev/errors/invalid_api_key'
  }
}
```

All API errors are instances of `OpenRelaySDKError`. Network errors (timeout, DNS failure) are re-thrown as standard `Error` instances — the SDK does not swallow network failures.

### 8.4 SDK for self-hosted vs. hosted

```typescript
// Self-hosted (points to your own API instance)
const relay = new OpenRelay({
  apiKey: 'sk_live_xxx',
  baseUrl: 'https://your-openrelay.example.com'
})

// Hosted network (default — uses OpenRelay's hosted API)
const relay = new OpenRelay({
  apiKey: 'sk_live_xxx'
  // baseUrl defaults to 'https://api.openrelay.dev'
})
```

---

## 9. x402 Protocol

### 9.1 What x402 is

x402 is an implementation of HTTP 402 Payment Required for machine-to-machine payments. It allows any HTTP server to require a micropayment before serving a response, and any HTTP client (including AI agents) to make that payment autonomously.

This is the payment primitive that makes AI agent economies possible. An agent that needs data from a premium API can pay for it without human intervention, credit cards, or subscriptions.

### 9.2 The x402 HTTP flow

```
Step 1 — Agent requests resource:
  GET /api/premium-data HTTP/1.1
  Host: merchant.example.com

Step 2 — Server responds with 402:
  HTTP/1.1 402 Payment Required
  Content-Type: application/json

  {
    "x402Version": 1,
    "accepts": [{
      "scheme": "exact",
      "network": "base",
      "maxAmountRequired": "1000",
      "resource": "https://merchant.example.com/api/premium-data",
      "description": "Premium data access",
      "mimeType": "application/json",
      "payTo": "0x...",              // merchant wallet on Base
      "maxTimeoutSeconds": 300,
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  // USDC
      "extra": { "name": "USDC", "version": "2" }
    }]
  }

Step 3 — Agent constructs and signs a USDC transfer on Base

Step 4 — Agent retries with payment proof:
  GET /api/premium-data HTTP/1.1
  Host: merchant.example.com
  X-PAYMENT: <base64_encoded_payment_payload>

Step 5 — Server verifies payment on-chain via OpenRelay API:
  POST /v1/x402/verify
  { "payment": "<X-PAYMENT value>", "amount": 1000, "chain": "base" }

Step 6 — Server serves the resource:
  HTTP/1.1 200 OK
  X-PAYMENT-RESPONSE: <verification_result>
  Content-Type: application/json

  { "data": "premium content" }
```

### 9.3 Replay protection

The x402 verification endpoint stores each verified `tx_hash` in the `x402_payments_used` PostgreSQL table. Subsequent requests with the same `tx_hash` are rejected with `402 Payment Required` — the agent must make a new on-chain payment.

This is also cached in Redis for performance: the first verification writes to both PostgreSQL and Redis. Subsequent checks hit Redis first. Redis TTL is 24 hours (longer than Base's finality window).

### 9.4 Micropayment thresholds

For payments under $0.01 USDC (10,000 micro-units), direct on-chain verification is preferred over routing through a node. The overhead of node assignment, routing, and confirmation is not justified for micropayments this small.

The SDK decides automatically:
```typescript
// amount < 10,000 → direct verification
// amount >= 10,000 → routed via node network
relay.x402.middleware({ price: 1000 })  // $0.001 → direct
relay.x402.middleware({ price: 50000 }) // $0.05  → routed
```

---

## 10. Transaction Lifecycle

### 10.1 Complete flow from SDK call to webhook

```
[Merchant code]
  relay.paymentIntents.create({ amount: 10_000_000, ... })
        │
        ▼
[POST /v1/payment_intents]   status: CREATED
  API validates request
  Generates ID: pi_xxx
  Stores in PostgreSQL
  Triggers routing engine async
        │
        ▼
[Routing Engine]              status: ROUTING
  Calls NodeRegistry.getActiveNodes() via viem
  Fetches /info from each active node
  Computes scores (or uses Redis cache)
  Applies hard filters
  Takes top 5 candidates
        │
        ▼
[Concurrent /intents/assign]  status: ROUTING → PENDING_PAYMENT
  5 concurrent HTTP requests to top candidate nodes
  First to respond with { accepted: true } wins
  Routing engine records: node_operator, payment_address
  Updates intent in PostgreSQL
  Returns payment_address to SDK caller
        │
        ▼
[SDK returns to merchant]
  intent.status = 'pending_payment'
  intent.payment_address = '0x...'   ← display this to payer
        │
        ▼ (payer action)
[Payer sends USDC on Base]
  USDC.transfer(payment_address, amount)
  OR: ERC-20 transferFrom via wallet UI
        │
        ▼
[Node's chain watcher detects transfer]  status: CONFIRMING
  Node monitors Base for transfers to its assigned payment_addresses
  Block confirmed (1 confirmation on Base)
  Node calls POST /intents/pi_xxx/settle
        │
        ▼
[API confirms settlement]     status: SETTLED
  Verifies tx_hash on Base via viem
  Updates intent status in PostgreSQL
  Calculates fee distribution:
    total_fee = amount × 0.0005
    node_fee = total_fee × 0.80
    treasury_fee = total_fee × 0.20
  Queues webhook delivery
        │
        ▼
[Webhook delivered to merchant]
  POST merchant's registered webhook URL
  Body: { id: 'evt_xxx', type: 'payment_intent.settled', data: { intent } }
  Signed with HMAC-SHA256
  Merchant fulfills order on verification
```

### 10.2 State machine transitions (canonical)

```
CREATED → ROUTING
  Triggered: immediately on creation
  Condition: routing engine invoked

ROUTING → PENDING_PAYMENT
  Triggered: node accepts assignment
  Condition: node responds { accepted: true }

ROUTING → CREATED (retry)
  Triggered: no nodes accept within 5 seconds
  Condition: all candidates rejected or timed out
  Behavior: SDK retries routing after 5s

PENDING_PAYMENT → CONFIRMING
  Triggered: on-chain transfer detected by node
  Condition: ≥1 Base confirmation

CONFIRMING → SETTLED
  Triggered: node calls /settle endpoint
  Condition: tx verification passes

CONFIRMING → FAILED
  Triggered: tx invalid or insufficient amount
  Condition: viem verification fails

Any state → EXPIRED
  Triggered: expires_at timestamp reached
  Condition: intent not in CONFIRMING or SETTLED

SETTLED → DISPUTED
  Triggered: merchant calls dispute endpoint
  Condition: within 7 days of settled_at
```

**These transitions are exhaustive and exclusive.** No transition exists outside this table. Any code that attempts an unlisted transition must be treated as a bug.

---

## 11. Economic Model

### 11.1 Fee flow per transaction

For a $100.00 USDC payment:

```
Payer sends:     $100.000000 USDC to payment_address

On-chain:        Payer → payment_address (node-controlled)
                 payment_address → merchant_wallet (automatic split)

Merchant receives: $99.950000 USDC
Node receives:     $00.040000 USDC (80% of 0.05% fee)
Treasury receives: $00.010000 USDC (20% of 0.05% fee)
```

For a $0.001 USDC x402 micropayment:
```
Total fee:     $0.0000005 (0.05% of $0.001)
Node receives: $0.0000004
Treasury:      $0.0000001
```

At this scale, fees are negligible — the micropayment use case is economically viable precisely because OpenRelay's percentage is small and there are no minimum fees.

### 11.2 Node profitability model

A node operator can estimate expected earnings:

```
monthly_volume    = transactions_per_day × avg_amount × 30
monthly_gross_fee = monthly_volume × 0.0005
node_earnings     = monthly_gross_fee × 0.80

Example: 1,000 tx/day, avg $50
  monthly_volume    = $1,500,000
  monthly_gross_fee = $750
  node_earnings     = $600/month in USDC
```

Costs for a basic node:
```
VPS (2 vCPU, 2GB RAM):  ~$20/month
Minimum stake (100 USDC): one-time, recoverable
Base gas for registration: ~$0.005
```

The profitability threshold is approximately 200 transactions/month at $10 average — well below what any active merchant would generate.

### 11.3 Treasury model

The treasury accumulates 20% of all protocol fees from the hosted network. Phase 1 usage:
- Security audits (required before mainnet)
- Contributor bounties
- Core development costs

In Phase 3, treasury allocation will be decided by on-chain governance. The current treasury balance will be publicly visible via a dashboard.

### 11.4 Self-hosted economics

A self-hosted merchant pays:
- Zero protocol fees
- VPS cost (~$20–40/month for API + node)
- Gas for contract interactions (registration: ~$0.005 on Base)

For merchants processing >$5,000/month, self-hosting saves more than the VPS costs within the first month.

---

## 12. Security Model

### 12.1 Threat model by actor

**Malicious node operator**

*Threat:* Route an intent, receive the payment_address, collect funds that should go to the merchant.
*Mitigation:* Funds go from payer directly to merchant wallet. The payment_address is a node-controlled address only to detect the incoming transfer — the node immediately forwards to the merchant minus the fee. A node that does not forward triggers a dispute and loses stake. Critically: the node cannot route to a different address — the `merchant_address` in the intent assignment comes from the API layer, not the node.

*Threat:* Collect assignment fee, then go offline before settlement.
*Mitigation:* 7-day stake withdrawal timelock. Merchant can open a dispute within 7 days. Unresponded disputes trigger automatic slashing via `expireDispute()`.

**Sybil attack (many fake nodes)**

*Threat:* Create hundreds of low-quality nodes to capture routing volume.
*Mitigation:* Minimum 100 USDC stake per node makes Sybil attacks costly ($100 per node). A node with minimum stake has `stake_weight = 0.01` — it would need very high uptime and speed to compete with well-staked nodes. At 100 fake nodes, the attack costs $10,000 in locked USDC.

**Merchant key compromise**

*Threat:* Attacker steals merchant's secret API key and creates payment intents pointing to their wallet.
*Mitigation:* The merchant wallet address is configured at the account level, not per-intent. A compromised API key cannot change the destination wallet — it can only create intents, view history, and register webhooks. Wallet changes require re-authentication.

**x402 replay attack**

*Threat:* Reuse a payment proof for multiple API calls.
*Mitigation:* Each `tx_hash` is stored in `x402_payments_used` on first use. Subsequent attempts with the same `tx_hash` are rejected. Redis caches recent hashes for performance. PostgreSQL is the durable store.

**HMAC key compromise**

*Threat:* Attacker intercepts node HMAC secret and forges routing requests.
*Mitigation:* HMAC secrets are per-node and rotatable without downtime. A compromised key affects only the node that shared it. Rotation invalidates all in-flight requests signed with the old key (5-minute window protection).

**Double-spend**

*Threat:* Payer submits a transaction, then attempts a chain reorganization to reverse it.
*Mitigation:* Base requires 1 confirmation before settlement is acknowledged. Base's L2 architecture makes reorganizations past 1 block extremely unlikely. For high-value transactions, merchants can configure higher confirmation requirements.

### 12.2 What is explicitly out of scope

- **Merchant key management** — the merchant's responsibility
- **Payer wallet security** — the payer's responsibility
- **KYC/AML compliance** — the merchant's responsibility under their jurisdiction
- **PCI DSS** — not applicable; no card data is processed

### 12.3 Smart contract invariants

These invariants must be preserved across all contract upgrades (deployments) and can be used by auditors to verify correctness:

1. `StakeManager.totalStaked() >= sum of all slashable amounts` — the contract never creates negative balances
2. `NodeRegistry.getActiveNodes()` never contains an address with `active = false`
3. `DisputeResolver`: a dispute can only be resolved once (checked via `status != Resolved && status != Expired`)
4. `StakeManager`: a withdrawal cannot be executed before `unlockAt` (timelock is strictly enforced)
5. `DisputeResolver`: an arbiter cannot vote twice on the same dispute

### 12.4 Audit requirements

All three contracts require full security audits before Base mainnet deployment:
- Static analysis (Slither, Mythril)
- Manual review by at least two independent security researchers
- Fuzzing with forge test --fuzz-runs 10000
- Economic attack simulation

Audit reports will be published at `/audits` in the repository. The community should treat any mainnet deployment without a published audit as untrustworthy.

---

## 13. Node Operation Guide

### 13.1 Minimum requirements

| Resource | Minimum | Recommended for production |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 512 MB | 2 GB |
| Storage | 10 GB SSD | 50 GB SSD |
| Network | 100 Mbps | 1 Gbps |
| Uptime SLA | 99% | 99.9% |
| USDC stake | 100 USDC | 1,000+ USDC |
| Base RPC | Public (rate limited) | Dedicated (Alchemy, QuickNode) |

### 13.2 Setup from zero

```bash
# 1. Clone the repository
git clone https://github.com/lacasoft/openrelay
cd openrelay

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env with:
#   NODE_OPERATOR_PRIVATE_KEY=your_wallet_private_key
#   NODE_ENDPOINT=https://your-node.example.com
#   NODE_HMAC_SECRET=random_secret_min_32_chars
#   BASE_RPC_URL=https://mainnet.base.org  (or dedicated RPC)
#   NODE_REGISTRY_ADDRESS=0x...  (from deployed contracts)
#   STAKE_MANAGER_ADDRESS=0x...

# 4. Approve USDC for staking
# Run from your wallet: USDC.approve(StakeManager, 100_000_000)

# 5. Register on-chain
# NodeRegistry.register("https://your-node.example.com", 100_000_000)

# 6. Start the node
pnpm --filter @openrelay/node start

# Or with Docker
docker run -p 4000:4000 --env-file .env ghcr.io/lacasoft/node:latest
```

### 13.3 HMAC key rotation

```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# 2. Update your node config (zero-downtime: both keys valid during rotation)
NODE_HMAC_SECRET=$NEW_SECRET

# 3. Notify the API layer (hosted) or update your self-hosted API
# The API layer will start signing with the new key
# Old requests (up to 5 minutes old) will still validate during transition

# 4. Restart node with new secret
```

### 13.4 Monitoring recommendations

Metrics to track:
- `uptime_pct` — 30-day rolling uptime percentage
- `avg_settlement_ms` — rolling average settlement time
- `intents_assigned` — intents received from routing engine
- `intents_settled` — intents successfully confirmed
- `intents_failed` — intents that could not be settled
- `disputes_open` — current open disputes (should be 0)
- `stake_balance` — current USDC stake (alert if approaching minimum)

Recommended alerting:
- `uptime_pct < 0.99` — investigate immediately (score impact)
- `disputes_open > 0` — respond within 48 hours or lose the dispute
- `stake_balance < 200_000_000` (200 USDC) — top up stake

### 13.5 Evidence preparation for disputes

If a merchant opens a dispute against your node, you have 48 hours to respond with counter-evidence. Maintain logs of:
- All intent assignments (intent_id, amount, merchant_address, assigned_at)
- All on-chain transactions (tx_hash, block_number, settled_at, amount)
- Node uptime logs
- Any error logs around the disputed time window

Package this as a JSON file and upload to IPFS. The IPFS CID is your counter-evidence.

---

## 14. Merchant Integration Guide

### 14.1 Self-hosted vs. hosted

| | Self-hosted | Community network |
|---|---|---|
| Setup time | 1–2 hours | 5 minutes |
| Monthly cost | ~$20–40 (VPS) | Fractions of a cent per tx |
| Protocol fees | 0% | 0.05% |
| Ops burden | Your team manages infra | None |
| Privacy | Full control | Transactions visible on-chain |
| Recommended for | >$50k/month volume or privacy requirements | Everyone else |

### 14.2 Routing preferences

```typescript
// Merchants can configure routing via API key settings
{
  routing: {
    mode: 'auto',           // 'auto' | 'whitelist' | 'blacklist'
    node_whitelist: [],     // only use these node operators
    node_blacklist: [],     // never use these node operators
    min_stake: 500_000_000, // minimum 500 USDC stake
    min_score: 0.8,         // minimum node score
  }
}
```

### 14.3 Webhook best practices

```typescript
// Always verify webhook signatures
app.post('/webhooks/openrelay', express.raw({ type: 'application/json' }), (req, res) => {
  let event
  try {
    event = relay.webhooks.verify(
      req.body.toString(),
      req.headers['openrelay-signature'],
      process.env.WEBHOOK_SECRET
    )
  } catch (e) {
    // Invalid signature — reject immediately
    return res.status(400).send('Invalid signature')
  }

  // Idempotency: use event.id to deduplicate
  if (await db.eventProcessed(event.id)) {
    return res.status(200).send('Already processed')
  }

  // Process the event
  switch (event.type) {
    case 'payment_intent.settled':
      await fulfillOrder(event.data.metadata.orderId)
      break
    case 'payment_intent.failed':
      await notifyCustomer(event.data.metadata.orderId, 'payment_failed')
      break
    case 'dispute.opened':
      await alertMerchantTeam(event.data)
      break
  }

  // Respond quickly — process async if needed
  res.status(200).send('OK')
})
```

**Critical:** OpenRelay retries webhooks up to 6 times. Without idempotency checks, you will process events multiple times.

### 14.4 SPEI / Oxxo Pay integration (Phase 2)

For Mexican merchants who need to accept cash payments:

```
Customer with cash → Oxxo Pay cashier → USDC on Base → OpenRelay PaymentIntent
```

This integration converts a physical cash payment at an Oxxo store or SPEI bank transfer into USDC deposited to the payment_address. The customer receives a payment code from the merchant's checkout, pays at the Oxxo counter, and the on-ramp provider handles the USDC minting on Base.

This is the mechanism that unlocks the 80% of Mexican transactions still in cash — without requiring the customer to have a crypto wallet.

---

## 15. Deployment Guide

### 15.1 Local development

```bash
# Full stack (API + Node + PostgreSQL + Redis)
docker compose -f infra/docker/docker-compose.yml up

# Individual packages in watch mode
pnpm --filter @openrelay/api dev
pnpm --filter @openrelay/node dev

# Smart contract development
cd packages/contracts
forge test -vvv
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
```

### 15.2 Testnet deployment (Base Sepolia)

```bash
# 1. Get testnet USDC
# Bridge from Ethereum Sepolia or use a faucet

# 2. Configure deployment .env
DEPLOYER_PRIVATE_KEY=0x...
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # Base Sepolia USDC
TREASURY_ADDRESS=0x...
ARBITER_1=0x...
ARBITER_2=0x...
ARBITER_3=0x...
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# 3. Deploy contracts
cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify

# 4. Copy output contract addresses to root .env
NODE_REGISTRY_ADDRESS=0x...
STAKE_MANAGER_ADDRESS=0x...
DISPUTE_RESOLVER_ADDRESS=0x...

# 5. Start API and Node with testnet config
docker compose -f infra/docker/docker-compose.yml up
```

### 15.3 Production deployment

For production deployment, additional considerations:

**Node daemon:**
- Run behind nginx with TLS (Let's Encrypt)
- Use a dedicated Base RPC (Alchemy, QuickNode, or self-hosted)
- Configure alerts for downtime and dispute events
- Store HMAC secret in a secrets manager (not in .env file)

**API layer:**
- PostgreSQL with automated backups (daily minimum)
- Redis with persistence enabled (AOF)
- Rate limiting tuned to expected traffic
- API keys stored as bcrypt hashes (never store plaintext)

**Monitoring:**
- Health check endpoint monitored externally (e.g., UptimeRobot)
- Alerting on settlement failures and dispute events
- PostgreSQL slow query log enabled

---

## 16. Comparative Analysis

### 16.1 OpenRelay vs. Stripe

| | OpenRelay | Stripe |
|---|---|---|
| Transaction fee | 0% (self-hosted) / 0.05% (network) | 2.9% + $0.30 |
| Minimum transaction | $0.000001 USDC | ~$0.50 (fees make smaller uneconomic) |
| Fiat support | No | Yes (Visa, MC, ACH) |
| Crypto support | USDC, BTC | Limited |
| Self-hostable | Yes | No |
| x402 (AI agents) | Native | No |
| Open source | Yes | No |
| Mexico coverage | Full | Limited (some products) |
| Setup time | 1–2 hours | 30 minutes |
| Compliance (KYC/AML) | Merchant responsibility | Stripe handles it |

**When to use Stripe:** When you need fiat (credit cards, bank transfers) or need someone else to handle compliance. Stripe and OpenRelay are complementary — many merchants should use both.

**When to use OpenRelay:** When you accept crypto, need zero fees, need micropayments, are building AI agent infrastructure, or are in a market where Stripe doesn't reach.

### 16.2 OpenRelay vs. BTCPay Server

| | OpenRelay | BTCPay Server |
|---|---|---|
| Primary asset | USDC (stablecoin) | BTC |
| x402 support | Native | No |
| Community network | Yes (node operators earn fees) | No (self-hosted only) |
| SDK DX | Stripe-like | More complex |
| LATAM focus | Explicit | General |
| Lightning | Yes (Phase 1) | Yes (mature) |
| Stablecoin support | Primary focus | Secondary |

BTCPay Server is the closest precedent to OpenRelay. OpenRelay is essentially "BTCPay Server for USDC and the AI agent era."

### 16.3 OpenRelay vs. Institutional alternatives (BlackRock, CoinShares products)

| | OpenRelay | Institutional |
|---|---|---|
| Ownership | Community / no one | Shareholders |
| Fees | 0–0.05% | TBD (typically 0.5–2%) |
| Censorable | No (permissionless nodes) | Yes (regulatory compliance) |
| Auditable | Fully (open source) | Partially |
| AI agent native | Yes | No |
| Regulatory clarity | Lower (merchant's problem) | Higher (institution handles) |
| Trust model | Protocol-enforced | Institution-enforced |

**The coexistence case:** OpenRelay is positioned to be the routing layer beneath institutional products, not to compete for institutional clients. A bank deploying a BlackRock crypto product needs payment routing — OpenRelay can provide that routing without the institution needing to control the rails.

---

## 17. Invariants and Guarantees

These are the properties that OpenRelay guarantees to all participants. They must be preserved across all protocol versions, implementations, and deployments.

### For merchants

1. Funds received in the merchant wallet are yours — no party can recall or freeze them after settlement
2. The dispute window is always exactly 7 days after settlement — this cannot be shortened by any node or arbiter
3. Your API key is never transmitted in logs or error messages — only the key prefix is stored for identification
4. Webhook signatures are computed over the exact payload — any modification invalidates the signature

### For node operators

1. Stake can only be slashed by `DisputeResolver` — no other contract or address can reduce your stake
2. Withdrawal timelock is exactly 7 days — this cannot be extended or shortened by any party
3. A dispute that is not responded to in 48 hours results in automatic slashing — you cannot avoid this by going offline
4. Your routing capacity is respected — if you return `capacity < 0.1`, the routing engine will not assign you new intents

### For payers

1. Payments go to the merchant wallet — not to a custodial account that could be frozen
2. x402 payments are verified on-chain — a server cannot claim payment was invalid for a confirmed on-chain transfer

### For the protocol

1. There is no admin key that can pause, upgrade, or modify the deployed contracts
2. The fee split (80/20 node/treasury) is encoded in the protocol and cannot be changed without a new deployment
3. The minimum stake (100 USDC) is a protocol constant that cannot be changed without a new contract deployment
4. All node registrations are permissionless — no whitelist committee can block a node from joining

---

*This document reflects the state of OpenRelay at v0.1. It is updated with every significant architectural decision.*

*For questions, open a GitHub discussion. For security issues, email security@openrelay.dev.*

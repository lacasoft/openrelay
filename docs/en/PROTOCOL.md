# OpenRelay Protocol Specification

**Version:** 0.1 (Draft)
**Status:** Work in Progress
**Authors:** OpenRelay Contributors

---

## Abstract

This document defines the OpenRelay Protocol — the rules, data structures, message formats, and state machines that govern how payment intents are created, routed, settled, and confirmed across the OpenRelay network.

Any implementation that conforms to this spec is a valid OpenRelay node. Any SDK that conforms to this spec can route through any compliant node. Compatibility is defined by this document, not by any reference implementation.

---

## Design Rationale

Before the technical specification, this section documents why the protocol is designed the way it is. Every decision has a reason. Understanding the reasons helps contributors make better changes.

### Why funds never pass through nodes

The most important protocol invariant. Nodes are observers and confirmers — they detect on-chain transfers and confirm them to the API layer. They never hold or intermediate funds.

This design was chosen because it eliminates an entire class of attacks: a malicious node cannot steal funds in transit, because funds are never in transit through the node. The attack surface is limited to: (a) a node lying about a settlement that did not happen (caught by dispute), or (b) a node going offline after assignment (caught by timelock + dispute).

Any protocol change that puts funds through nodes must be treated as a critical regression, not a feature.

### Why non-upgradeable contracts

Upgradeable contracts (proxy patterns) give someone — inevitably the deployer or a multisig — the power to change the rules after the fact. That power is incompatible with the trust model of a community protocol.

If a bug requires fixing, the correct response is: (1) disclose it, (2) pause the affected functionality via a community decision, (3) deploy new contracts, (4) migrate with community consent. This is slower than an upgrade. It is also trustworthy in a way that upgrades are not.

### Why permissionless nodes (not a whitelist)

A whitelist committee is a centralization vector. Whoever controls the whitelist controls the network. In the context of LATAM payment infrastructure, a whitelist controlled by the founding team could be pressured by regulators, acquired by an institution, or simply become a bottleneck as the team's priorities change.

Permissionless registration with economic incentives (stake, reputation, fees) achieves the same quality filtering without centralization. A node with bad behavior loses routing organically — no committee needed.

### Why USDC, not a protocol token

A protocol token creates a speculation layer on top of the payment layer. Every economic decision becomes entangled with token price dynamics. Contributors are incentivized to promote the token rather than build the product. Users are confused about whether they are using a payment system or a financial instrument.

USDC is boring. It is 1:1 with USD, redeemable by Circle, and accepted everywhere. Node operators earn boring USDC. The treasury accumulates boring USDC. This is the right kind of boring for payment infrastructure.

### Why the fee split is 80/20 (node/treasury)

Node operators do the work — they run infrastructure, maintain uptime, stake capital. They should receive the majority of fees. The 20% treasury allocation is the minimum needed to fund the ongoing work that nodes collectively benefit from: audits, SDK development, documentation, community growth.

If the treasury share were higher, operators would have less incentive to run nodes. If it were zero, the project would have no sustainable funding for public goods. 80/20 is the equilibrium that keeps both sides viable.

### Why x402 is first-class, not a plugin

The AI agent economy will need payment infrastructure. That infrastructure needs to work at micropayment scale ($0.001 per API call), at machine speed (no human approval flow), and across autonomous agents. HTTP 402 is the natural protocol for this — it is part of the HTTP standard, available in any language, and requires no new authentication protocol.

Making x402 a plugin would create a two-tier protocol: "real" payments and "AI payments." There is no technical or economic reason for this distinction. Both use USDC on Base. Both use the same settlement layer. Building x402 in from the start ensures that merchant integrations are x402-capable by default.

---

## Table of Contents

1. [Terminology](#1-terminology)
2. [Network Participants](#2-network-participants)
3. [Settlement Layer](#3-settlement-layer)
4. [On-Chain Protocol](#4-on-chain-protocol)
5. [Payment Intent Lifecycle](#5-payment-intent-lifecycle)
6. [Node Protocol](#6-node-protocol)
7. [Routing Algorithm](#7-routing-algorithm)
8. [x402 Extension](#8-x402-extension)
9. [Security Model](#9-security-model)
10. [Error Codes](#10-error-codes)
11. [Versioning](#11-versioning)

---

## 1. Terminology

| Term | Definition |
|---|---|
| **Merchant** | An entity that integrates OpenRelay to receive payments |
| **Payer** | The entity that initiates a payment (human or AI agent) |
| **Node** | A community-operated server that facilitates payment routing |
| **Node Operator** | The entity that runs and stakes a node |
| **Payment Intent** | A declared intention to pay a specific amount, with a defined lifecycle |
| **Settlement** | The on-chain transfer of funds from payer to merchant |
| **Routing** | The selection of an optimal node to facilitate a payment intent |
| **Stake** | USDC deposited by a node operator as collateral |
| **Score** | A public, on-chain reputation metric for a node |
| **Treasury** | The protocol-controlled fund for development and bounties |
| **x402** | The HTTP 402-based micropayment protocol for machine-to-machine payments |

---

## 2. Network Participants

### 2.1 Merchants

A merchant is any entity that has deployed the OpenRelay API (self-hosted or via the hosted network) and integrated the SDK into their product.

Merchants have:
- A merchant ID (`mid_xxx`) — globally unique, assigned at registration
- One or more API keys — `pk_live_xxx` (public) and `sk_live_xxx` (secret)
- A destination wallet address per supported chain
- Webhook endpoints registered for event delivery

Merchants interact with the network exclusively through the API layer. They have no direct protocol-level communication with nodes.

### 2.2 Payers

A payer is any entity that sends funds to complete a payment intent. Payers can be:

- **Human** — interacting via a checkout UI powered by the SDK
- **Agent** — an autonomous AI agent using the x402 extension (see Section 8)

Payers have no persistent identity in the protocol unless explicitly provided by the merchant via metadata.

### 2.3 Nodes

A node is a server registered on-chain that participates in payment routing. Nodes:

- Are registered via `NodeRegistry.sol` with a staked USDC deposit
- Expose a compliant HTTP API (see Section 6)
- Monitor on-chain settlement events
- Confirm payment completion back to the API layer
- **Never hold or custody funds at any point**

A node that is not registered on-chain MUST NOT be used by the routing engine.

### 2.4 Bootstrap Nodes

During Phase 1, the OpenRelay core team operates a set of bootstrap nodes. These nodes:

- Serve as the initial routing targets while the network grows
- Are registered on-chain identically to any other node — no special privileges
- Will be progressively replaced by community nodes as reputation builds
- Will be decommissioned transparently in Phase 3

Bootstrap node addresses are published in the repository and verifiable on-chain.

---

## 3. Settlement Layer

### 3.1 Supported Chains and Assets

| Chain | Asset | Chain ID | Status |
|---|---|---|---|
| Base | USDC | 8453 | Live (Phase 1) |
| Lightning Network | BTC (sats) | — | Live (Phase 1) |
| Polygon | USDC | 137 | Planned (Phase 2) |
| Solana | USDC | — | Planned (Phase 2) |

Base + USDC is the primary settlement layer. All protocol fees and stake are denominated in USDC on Base.

### 3.2 USDC on Base

```
USDC (Base mainnet):  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
USDC (Base Sepolia):  0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

All amounts in the protocol are denominated in USDC micro-units (6 decimal places). `1,000,000` = $1.00 USDC.

### 3.3 Fund Flow

**Funds flow directly from payer to merchant. Nodes never hold funds.**

```
Payer Wallet ──────────────────────────────► Merchant Wallet
                                                    ▲
Node (observes, confirms, earns fee from)  ─────────┘
                                        (fee deducted on-chain from transfer)
```

Fee split per transaction:
```
Amount = 1,000,000 (1.00 USDC)
Total fee = 500 (0.05% = 50 bps)
  └─ Node share (80%) = 400
  └─ Treasury (20%) = 100
Merchant receives = 999,500
```

---

## 4. On-Chain Protocol

Three smart contracts on Base define the protocol rules. All contracts are non-upgradeable. No admin keys. No pause functions.

### 4.1 NodeRegistry.sol

**Responsibility:** Node registration and discovery.

```solidity
struct Node {
    address operator;       // wallet that controls the node
    string  endpoint;       // HTTPS URL of the node API
    uint256 registeredAt;   // block timestamp of registration
    bool    active;         // operator-controlled active flag
}

function register(string calldata endpoint, uint256 stakeAmount) external;
function updateEndpoint(string calldata endpoint) external;
function deactivate() external;
function activate() external;
function getNode(address operator) external view returns (Node memory);
function getActiveNodes() external view returns (address[] memory);
```

**Minimum stake (`minStake`):** state variable on `NodeRegistry`, initialized at deploy time.
- **Mainnet:** 100 USDC (100,000,000 micro-units) — the protocol's anti-Sybil floor
- **Sepolia testnet:** 40 USDC (40,000,000 micro-units) — lowered initial value to ease onboarding with faucets

The guardian can raise `minStake` via `NodeRegistry.updateMinStake(uint256)` as the network matures. The contract **rejects decreases** — increase-only. This lets the Sybil floor rise without invalidating existing operators' stakes.

### 4.2 StakeManager.sol

**Responsibility:** Stake deposits, withdrawals, and slashing.

```solidity
struct StakeInfo {
    uint256 staked;
    uint256 pendingWithdrawal;
    uint256 unlockAt;
}

function depositFor(address operator, uint256 amount) external; // only NodeRegistry
function deposit(uint256 amount) external;
function requestWithdrawal(uint256 amount) external;
function executeWithdrawal() external;
function slash(address operator, uint256 amount, bytes32 disputeId) external; // only DisputeResolver
```

**Withdrawal timelock:** 7 days. Equal to the dispute window — creates a closed system where a node cannot withdraw before a dispute can be resolved.

### 4.3 DisputeResolver.sol

**Responsibility:** Dispute adjudication and stake slashing decisions.

```solidity
enum DisputeStatus  { Open, NodeResponded, Resolved, Expired }
enum DisputeOutcome { None, MerchantWins, NodeWins }

function openDispute(bytes32 paymentIntentId, address nodeOperator, string calldata evidenceCid) external;
function respondToDispute(bytes32 disputeId, string calldata counterEvidenceCid) external;
function vote(bytes32 disputeId, DisputeOutcome outcome) external; // only arbiters
function expireDispute(bytes32 disputeId) external; // anyone can call after 48h window
```

**Phase 1 arbitration:** 3-of-5 multisig held by the core team. Committed migration to on-chain governance in Phase 3.

**Node response window:** 48 hours from `openedAt`. After this window, anyone can call `expireDispute()`, which auto-slashes the node.

---

## 5. Payment Intent Lifecycle

### 5.1 States

```
CREATED ──► ROUTING ──► PENDING_PAYMENT ──► CONFIRMING ──► SETTLED
                │                                │
                │                                └──► FAILED
                └──────────────────────────────────► EXPIRED
                                                      CANCELLED
                                                      DISPUTED
```

### 5.2 Payment Intent Object

```typescript
interface PaymentIntent {
  id:              string           // "pi_" + 24 random chars
  merchant_id:     string           // "mid_" + 16 chars
  amount:          number           // in asset micro-units
  currency:        "usdc" | "btc"
  chain:           "base" | "lightning" | "polygon" | "auto"
  status:          PaymentIntentStatus
  node_operator:   string | null    // assigned node wallet address
  payer_address:   string | null    // filled when payer initiates
  tx_hash:         string | null    // on-chain tx hash
  fee_amount:      number           // protocol fee charged
  metadata:        Record<string, string>  // max 20 keys
  created_at:      number           // unix timestamp
  expires_at:      number           // unix timestamp (default: +30 min)
  settled_at:      number | null
}
```

### 5.3 Transition Rules

**CREATED → ROUTING** — triggered immediately on creation.

**ROUTING → PENDING_PAYMENT** — node responds with `{ accepted: true }`. Node's endpoint and payment address embedded in intent.

**ROUTING → CREATED (retry)** — no nodes accept within 5 seconds. SDK retries after 5 seconds.

**PENDING_PAYMENT → CONFIRMING** — on-chain transaction matching intent amount detected. Base: 1 confirmation required.

**CONFIRMING → SETTLED** — required confirmations reached. Node calls settlement endpoint. Webhook fires.

**Any → EXPIRED** — `expires_at` timestamp reached and intent not in CONFIRMING or SETTLED.

**SETTLED → DISPUTED** — merchant calls dispute endpoint within 7 days of `settled_at`.

---

## 6. Node Protocol

Every node MUST expose the following HTTP API. All endpoints use JSON. All requests from the routing engine are authenticated via HMAC-SHA256.

### 6.1 Authentication

```
X-OpenRelay-Signature: sha256=<hmac_hex>
X-OpenRelay-Timestamp: <unix_timestamp>

HMAC input: <timestamp>.<request_body>
Tolerance: 5 minutes
```

### 6.2 Required Endpoints

```
GET  /health           → { status, version, operator, chains, capacity }
GET  /info             → { operator, version, uptime_30d, avg_settlement_ms, total_settled, stake }
POST /intents/assign   → { accepted, payment_address?, node_fee?, reason? }
POST /intents/:id/settle → { confirmed }
```

### 6.3 Node Behavior Requirements

A conformant node MUST:
- Respond to `/health` within 2 seconds
- Respond to `/intents/assign` within 3 seconds
- Never use the same `payment_address` for multiple concurrent intents on the same chain
- Call `/intents/:id/settle` within 30 seconds of on-chain confirmation
- Maintain logs of all assigned intents for minimum 90 days
- Reject intent assignments when at capacity rather than accepting and failing

A conformant node MUST NOT:
- Act as an intermediary holding funds between payer and merchant
- Modify transaction amounts or metadata
- Accept intents for chains not listed in its `/health` response

---

## 7. Routing Algorithm

### 7.1 Node Score

```
Score = (uptime_weight × 0.30) + (speed_weight × 0.30)
      + (stake_weight × 0.20) + (disputes_weight × 0.20)

uptime_weight   = uptime_30d (0.0–1.0)
speed_weight    = 1 - (avg_settlement_ms / 30000), min 0
stake_weight    = min(node_stake / 10_000_000_000, 1.0)
disputes_weight = disputes_won / max(disputes_total, 1)
```

Scores cached in Redis, refreshed every 60 seconds.

### 7.2 Hard Filters

Applied before scoring. Nodes failing any filter are excluded regardless of score:
- Not registered on-chain
- `active = false`
- Does not support requested chain
- `capacity < 0.1`
- Round-trip to `/health` > 5 seconds
- Has open unresolved dispute
- Not in merchant whitelist (if set)
- In merchant blacklist (if set)
- Below merchant minimum stake/score (if set)

### 7.3 Selection

1. Apply hard filters
2. Sort remaining by score (descending)
3. Take top 5
4. Send concurrent `/intents/assign` requests to all 5
5. Accept first `{ accepted: true }` response
6. Cancel pending requests to remaining candidates

---

## 8. x402 Extension

### 8.1 Flow

```
Agent: GET /api/resource
Server: 402 Payment Required + { x402Version, accepts: [{ amount, asset, payTo }] }
Agent: constructs + signs on-chain payment
Agent: GET /api/resource + X-PAYMENT: <base64_payload>
Server: verifies on-chain → serves resource + X-PAYMENT-RESPONSE
```

### 8.2 SDK Middleware

```typescript
// Fastify
app.addHook('preHandler', relay.x402.middleware({
  price: 1000,        // $0.001 USDC
  currency: 'usdc',
  chain: 'base',
}))

// Next.js App Router
export const GET = relay.x402.handler({
  price: 1000,
  handler: async (req) => Response.json({ data: 'protected' })
})
```

### 8.3 Routing threshold

- Payments < $0.01 USDC (< 10,000 micro-units): direct on-chain verification
- Payments >= $0.01 USDC: routed via node network

---

## 9. Security Model

| Threat | Mitigation |
|---|---|
| Node steals funds | Funds never pass through nodes — payer-to-merchant always |
| Node routes to wrong address | Merchant address from API layer, not node |
| Node collects fee without settling | Dispute + stake slashing |
| Sybil attack | `minStake` of 100 USDC (mainnet) makes Sybil costly |
| Node exit scam | 7-day withdrawal timelock |
| Double-spend | On-chain confirmation required before SETTLED |
| x402 replay | tx_hash stored in x402_payments_used after first use |
| HMAC compromise | Per-node, rotatable; 5-minute timestamp tolerance |
| Stale requests | 5-minute timestamp window on HMAC verification |

---

## 10. Error Codes

### API Error Format

```json
{
  "error": {
    "code": "intent_expired",
    "message": "The payment intent has expired.",
    "param": null,
    "doc_url": "https://docs.openrelay.dev/errors/intent_expired"
  }
}
```

### Error Code Reference

| Code | HTTP | Description |
|---|---|---|
| `invalid_api_key` | 401 | API key malformed or revoked |
| `insufficient_permissions` | 403 | Secret key required |
| `intent_not_found` | 404 | Payment intent ID does not exist |
| `intent_expired` | 410 | Intent has passed `expires_at` |
| `intent_already_settled` | 409 | Cannot modify a settled intent |
| `no_nodes_available` | 503 | No nodes meet routing criteria |
| `chain_not_supported` | 400 | Requested chain not active |
| `amount_too_small` | 400 | Amount below chain minimum |
| `amount_too_large` | 400 | Amount exceeds node capacity |
| `invalid_webhook_url` | 400 | Webhook URL not reachable |
| `dispute_window_closed` | 409 | 7-day dispute window passed |
| `node_not_registered` | 403 | Node not in on-chain registry |

---

## 11. Versioning

### Protocol versioning

`MAJOR.MINOR` — breaking changes bump MAJOR, backwards-compatible additions bump MINOR.

Current version: `0.1`. The `0.x` series allows breaking changes with 30-day notice.

**v1.0 criteria:**
1. Contracts audited and deployed to Base mainnet
2. At least 10 independent community nodes active
3. SDK used in at least one production merchant deployment

### API versioning

URL prefix: `/v1/`. New API version will not be introduced before protocol v1.0.

---

## Appendix A — Webhook Events

| Event | Triggered When |
|---|---|
| `payment_intent.created` | Intent is first created |
| `payment_intent.pending` | Node assigned, awaiting payer |
| `payment_intent.confirming` | On-chain tx detected |
| `payment_intent.settled` | Full confirmation reached |
| `payment_intent.failed` | Settlement failed |
| `payment_intent.expired` | TTL reached without payment |
| `payment_intent.cancelled` | Cancelled before settlement |
| `dispute.opened` | Merchant opened a dispute |
| `dispute.resolved` | Dispute outcome reached |

---

## Appendix B — Minimum Node Requirements

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 512 MB | 2 GB |
| Disk | 10 GB SSD | 50 GB SSD |
| Network | 100 Mbps | 1 Gbps |
| Uptime SLA | 99% | 99.9% |
| USDC Stake | 100 USDC (mainnet) · 40 USDC (testnet) | 1,000+ USDC |

---

*This document is a living specification. Changes are proposed via GitHub issues tagged `spec`. Protocol changes require an RFC with minimum 7-day discussion period.*

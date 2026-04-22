# OpenRelay

**The open payment network. No fees. No gatekeepers. Built for LATAM.**

OpenRelay is an open-source, community-operated payment routing network. It gives developers the same experience as Stripe — a clean SDK, webhooks, payment intents, a merchant dashboard — without the 2.9% + $0.30 per transaction. Without asking anyone for permission. Without a company in the middle.

If you run your own nodeit, it costs nothing. If you use the community network, you pay fractions of a cent.

---

## 🚀 Current status

✅ **Contracts deployed on Base Sepolia** (testnet) — redeployed 2026-04-21 with
**role separation** (deployer, treasury, guardian, and nodeit operator on distinct wallets).
Source code verified on Basescan · initial `minStake`: 40 USDC on testnet
(100 USDC on mainnet; adjustable by guardian, increase-only).

| Contract | Address |
|----------|---------|
| `NodeRegistry` | [`0x2dFdF6151d6BF0156D28976F23823d3f1f9CB106`](https://sepolia.basescan.org/address/0x2dFdF6151d6BF0156D28976F23823d3f1f9CB106#code) |
| `StakeManager` | [`0xFf4e68652BC8C6b8de18a79C4D2FDDe0c9C9F517`](https://sepolia.basescan.org/address/0xFf4e68652BC8C6b8de18a79C4D2FDDe0c9C9F517#code) |
| `DisputeResolver` | [`0xAAB6E368767707e562Fb09dB2432F9a691B9915a`](https://sepolia.basescan.org/address/0xAAB6E368767707e562Fb09dB2432F9a691B9915a#code) |

**Roles (separate wallets):**

| Role | Wallet | Responsibility |
|---|---|---|
| Treasury | [`0x05CD...8261`](https://sepolia.basescan.org/address/0x05CDED242AFC9D7e60eC3049bD8bDccbbA078261) | Receives 20% of fees + slashed stake (**immutable**) |
| Guardian | [`0xbB51...7Ddf`](https://sepolia.basescan.org/address/0xbB514Eca8f39d0A3B8092B323282304709d17Ddf) | Emergency pause + `updateMinStake()` (rotatable) |
| Nodeit Operator (bootstrap) | [`0xf73e...5da4`](https://sepolia.basescan.org/address/0xf73e2E5a4493d8a4C28e6f88c14a396C82395da4) | Stakes USDC + signs daemon HMAC |

✅ **First bootstrap nodeit registered on-chain and running in production** since 2026-04-21 (block 40522829).
Operated by the core team during Phase 1 with the operator wallet **separated from the deployer**.
Daemon deployed on Fly.io (region `dfw`) — quick check: `curl https://nodeit.openrelay.site/health` → `200 OK`.

| Field | Value |
|---|---|
| Operator | [`0xf73e...5da4`](https://sepolia.basescan.org/address/0xf73e2E5a4493d8a4C28e6f88c14a396C82395da4) |
| Endpoint | [`https://nodeit.openrelay.site`](https://nodeit.openrelay.site/health) |
| Stake | 40 USDC (locked on-chain) |
| Register tx | [`0x399c...93ca`](https://sepolia.basescan.org/tx/0x399c077b7cdd19e99658ca69790ca985304be65b2fcc7cbe0aec8b54608893ca) |

Canonical source of addresses (for SDKs and dashboards):
[`packages/contracts/deployments/sepolia.json`](../../packages/contracts/deployments/sepolia.json).

🔜 External audit and mainnet deploy still pending.

---

## Why Now

In April 2026, two things happened in the same week:

**Mexico announced the elimination of cash.** 100% of gas stations and toll booths must accept digital payments by end of 2026. 80% of Mexican transactions are still in cash. The infrastructure to absorb that shift does not exist yet — or exists only in the form of platforms that charge merchants for every transaction, forever.

**BlackRock's CEO arrived at Mexico's Palacio Nacional.** Europe's largest crypto asset manager CoinShares ($6B under management, 34% of Europe's crypto ETP market share) listed on Nasdaq the same week under ticker CSHR.

Institutional capital is positioning itself to own the digital payment infrastructure of LATAM. With government contracts. Stock exchange listings. Regulatory frameworks.

OpenRelay is the community's answer to that positioning. Not in opposition — institutional crypto adoption benefits the ecosystem. But in parallel. Because when an institution builds payment rails, someone else owns them. When a community builds them, no one does.

> *"La pregunta no es si México se digitaliza. Eso ya está pasando.*
> *La pregunta es quién va a ser dueño de esa infraestructura."*

OpenRelay's answer: the community. Or no one. Depending on who runs nodeits.

→ Full context: [SOVEREIGNTY.md](./SOVEREIGNTY.md)

---

## What OpenRelay Is

> *On terminology:* the protocol defines a network of **nodes**. **`nodeit`** is the reference implementation — the open-source daemon shipped from this repo. Any compliant daemon can register as a node; ours is called `nodeit`. In this README I use "nodeit" because I'm talking about the concrete implementation; in `PROTOCOL.md` and `INFRASTRUCTURE.md` I use "node" because they describe the abstract protocol concept.

- A payment routing protocol with community-operated nodeits
- A Stripe-compatible SDK for JavaScript, Python, and PHP
- First-class support for x402 — native micropayments for AI agents
- A self-hostable stack with Docker Compose in one command
- USDC on Base as the primary settlement layer, Lightning Network for BTC
- A smart contract layer for nodeit registration, staking, and dispute resolution
- Built for LATAM — documentation, community, and support in Spanish and English

## What OpenRelay Is Not

- **A bank** — Funds go payer-to-merchant directly. OpenRelay never holds money.
- **A fiat gateway** — No Visa, Mastercard, or ACH. Stripe covers fiat; use both.
- **A token project** — No RELAY token. Nodeit operators earn USDC. No speculation.
- **Competition with institutions** — OpenRelay operates beneath institutional products as the routing layer no one controls.

---

## How It Works

```
Merchant integrates SDK
        │
        ▼
PaymentIntent created → Routing engine selects optimal nodeit
        │                (top 5 by score, concurrent race)
        ▼
Payer sends USDC directly to merchant wallet on Base
        │              (nodeit NEVER holds funds)
        ▼
Nodeit confirms on-chain settlement → Webhook fires
        │
        ▼
Nodeit reputation updated on-chain. Fee distributed automatically.
```

Nodeit operators stake USDC to join. Stake is their skin in the game. Good routing builds reputation. Bad routing loses stake. No committee decides who stays — the protocol does.

---

## Quick Start

**Self-hosted — zero fees**

```bash
git clone https://github.com/lacasoft/openrelay
cd openrelay
cp .env.example .env        # add your BASE_RPC_URL and wallet
docker compose -f infra/docker/docker-compose.yml up
```

**SDK integration**

```typescript
import { OpenRelay } from '@openrelay/sdk'

const relay = new OpenRelay({ apiKey: 'sk_live_xxx' })

// Create a payment — same DX as Stripe
const intent = await relay.paymentIntents.create({
  amount: 10_000_000,   // $10.00 USDC (6 decimals = 1 USDC)
  currency: 'usdc',
  chain: 'base',
  metadata: { orderId: 'order_123' }
})

// Webhook handler
app.post('/webhooks', (req) => {
  const event = relay.webhooks.verify(
    req.body,
    req.headers['openrelay-signature'],
    webhookSecret
  )
  if (event.type === 'payment_intent.settled') {
    fulfillOrder(event.data.metadata.orderId)
  }
})
```

**x402 — payments for AI agents**

```typescript
// Protect any endpoint with a micropayment — 3 lines
app.addHook('preHandler', relay.x402.middleware({
  price: 1000,        // $0.001 USDC per request
  currency: 'usdc',
  chain: 'base',
}))
```

Any HTTP client that speaks x402 — including AI agents using MCP — can pay and consume your endpoint autonomously. Stripe cannot support $0.001 transactions. OpenRelay can.

---

## Architecture

Five layers with strict separation of concerns:

| Layer | Responsibility | Technology |
|---|---|---|
| **Settlement** | On-chain money movement | Base (USDC), Lightning Network |
| **Protocol** | Nodeit rules, stake, disputes | Solidity + Foundry on Base |
| **Routing** | Nodeit discovery and selection | TypeScript daemon |
| **API** | Merchant interface | Fastify + PostgreSQL + Redis |
| **SDK** | Developer experience | TypeScript · Python · PHP |

Smart contracts are non-upgradeable. They include an emergency-pause function governed by a 3-of-5 multisig — not by a single key. In Phase 3, the guardian migrates to on-chain governance. What is audited is what runs.

→ Full architecture and technical deep-dive: [INFRASTRUCTURE.md](./INFRASTRUCTURE.md)
→ Protocol specification: [PROTOCOL.md](./PROTOCOL.md)

---

## Running a Nodeit

Anyone can run a nodeit. No whitelist. No application.

Requirements: stake the current `minStake` on-chain (100 USDC on mainnet · 40 USDC on Sepolia testnet; adjustable by guardian, increase-only), expose an HTTPS endpoint, maintain uptime. Reputation is computed publicly. Bad nodeits lose routing naturally. Nodeit operators earn 80% of the 0.05% protocol fee on every transaction they route, in USDC, on-chain.

**Running a nodeit in Mexico or Spain is a political act as much as a technical one.** Every community nodeit is infrastructure that no institution controls.

→ [INFRASTRUCTURE.md — Nodeit Operation](./INFRASTRUCTURE.md#node-operation)

---

## Primary Markets

**Mexico** — Launch market. Government-mandated digital transition creates urgent merchant demand. SPEI + Oxxo Pay on-ramp planned for Phase 2 to unlock the 80% of transactions still in cash.

**Spain** — Second market. Established crypto developer ecosystem. Gateway to the European-LATAM corridor. CoinShares and other institutional players create demand for a routing layer below the institutional products.

**LATAM** — Argentina, Colombia, Venezuela, Chile in Phase 2.

---

## Roadmap Summary

| Phase | Timeline | Key Deliverables |
|---|---|---|
| **Phase 1 — Foundation** | Months 1–4 | ✅ Base Sepolia deploy · ✅ JS SDK · ✅ First nodeit registered · First merchant |
| **Phase 2 — Network** | Months 4–10 | Permissionless nodeits · Python + PHP SDKs · Lightning · WooCommerce · SPEI on-ramp |
| **Phase 3 — Ecosystem** | Months 10–18 | Multi-chain · Go SDK · Institutional layer · On-chain governance |

→ Full roadmap with milestones: [ROADMAP.md](./ROADMAP.md)

---

## Contributing

Contributions in Spanish are welcomed equally to contributions in English. Issues, PRs, documentation, and community discussion can be in either language.

- **Ship code** — bugs, features, SDKs, plugins
- **Run a nodeit** — grow the network, earn fees in USDC
- **Write docs** — Spanish, English, Portuguese
- **Audit** — smart contracts need eyes
- **Spread the word** — in LATAM developer communities

→ [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## Governance

Maintained by the OpenRelay Foundation. Protocol changes go through public RFCs. Treasury (20% of hosted network fees) funds development, audits, and bounties. Financial reports are public.

---

## Security

Audit required before mainnet deployment. Reports published at `/audits`.
Vulnerabilities: **lacasoft.proyectos@gmail.com** — responsible disclosure with bounties.

---

## License

[Apache License 2.0](./LICENSE) — use it, modify it, self-host it, build on it commercially.

---

## Links

| Resource | URL |
|---|---|
| Documentation | docs.openrelay.dev |
| Hosted dashboard | app.openrelay.dev |
| GitHub | github.com/lacasoft |
| Discord | discord.openrelay.dev |
| npm SDK | @openrelay/sdk |
| x402 spec | x402.org |
| Security | lacasoft.proyectos@gmail.com |

---

*Built by the community. For LATAM and the Hispanic world. For everyone.*

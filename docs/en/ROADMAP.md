# OpenRelay Roadmap

> "La pregunta no es si el mundo se digitaliza. Eso ya está pasando.
> La pregunta es quién va a ser dueño de esa infraestructura."

---

## Why This Roadmap Exists

In April 2026, two things happened in the same week:

- BlackRock's CEO Larry Fink arrived at Mexico's Palacio Nacional, days after Mexico announced the elimination of cash — mandatory digital payments at 100% of gas stations and toll booths by end of 2026.
- CoinShares, Europe's largest crypto asset manager with $6B under management and 34% ETP market share, listed on Nasdaq under ticker CSHR.

These are not isolated events. They are preparation. Institutional capital is positioning itself — with government contracts, stock exchange listings, and regulatory frameworks — to own the digital payment infrastructure of the next decade.

OpenRelay's roadmap is a direct response to that positioning. Not in opposition — institutional adoption of crypto is net positive for the ecosystem. But in parallel. Because when an institution builds payment rails, someone else owns them. When a community builds payment rails, no one does.

The window to build community-owned infrastructure before institutional standards become entrenched is not years. It is months.

---

## Guiding Principles

**LATAM-first.** Mexico is the launch market. Spain is the second market. The rest of LATAM follows. The problem hurts most where Stripe charges more, reaches worse, and where the shift from cash to digital is being imposed by government mandate — not organic adoption.

**Under the institutions, not against them.** When a Mexican bank wants to offer USDC payments using BlackRock's IBIT ETF as collateral, it will need a payment routing layer. OpenRelay can be that layer. The institution will not want to build it. It will want to integrate it. OpenRelay must be ready.

**Speed over perfection.** The market is being defined now. A working v1 in the hands of real merchants in Mexico City matters more than a perfect v2 in a GitHub repo.

**Community is the moat.** The only durable competitive advantage over institutional alternatives is a community of node operators, contributors, and merchants that no single entity controls. Every roadmap decision must prioritize growing that community.

---

## Phase 1 — Foundation (Months 1–4)

**Goal:** Working protocol on Base Sepolia testnet. First SDK integration. First merchant. First community node.

### Technical Milestones

- [x] Smart contracts: `NodeRegistry.sol`, `StakeManager.sol`, `DisputeResolver.sol`
- [x] Foundry test suite: 58 tests + fuzz across all three contracts
- [x] Deploy script: `Deploy.s.sol` ready for Base Sepolia
- [x] Node daemon: Fastify HTTP API, routes scaffolded
- [x] REST API: payment intents, webhooks, x402 routes scaffolded
- [x] SDK JS: `@openrelay/sdk` with payment intents, webhooks, x402 middleware
- [x] Docker Compose: full self-hosted stack in one command
- [x] GitHub Actions CI: typecheck + test + build + Foundry
- [ ] **Deploy contracts to Base Sepolia** — next immediate step
- [ ] Wire routing engine to `NodeRegistry.sol` via viem
- [ ] Implement PostgreSQL persistence in API
- [ ] Wire HMAC signing in node daemon
- [ ] Unique payment address per intent (HD wallet derivation)
- [ ] x402 on-chain payment verification + replay protection
- [ ] Webhook delivery with retry queue

### Market Milestones

- [ ] First bootstrap node operational (team-operated)
- [ ] First merchant integration (self-hosted, Mexico)
- [ ] Public testnet announcement in Spanish-language developer communities
- [ ] Repository public on GitHub under `lacasoft`

### Community Milestones

- [ ] Discord server open
- [ ] First external contributor PR merged
- [ ] Node operator documentation complete in Spanish and English

---

## Phase 2 — Network (Months 4–10)

**Goal:** Permissionless node registration open to anyone. First community nodes in Mexico and Spain. Lightning Network support. On-ramp for cash users.

### Technical Milestones

- [ ] Permissionless node registration via `NodeRegistry.sol` on Base mainnet
- [ ] Full routing engine: on-chain node discovery, score caching, parallel racing
- [ ] Node reputation system: on-chain score visible via `/v1/nodes`
- [ ] Lightning Network support (BTC micropayments)
- [ ] Python SDK: `openrelay-python` on PyPI
- [ ] PHP SDK: `openrelay/openrelay` on Packagist
- [ ] Merchant dashboard: Next.js + shadcn/ui
- [ ] WooCommerce plugin (critical for Mexican merchant adoption)
- [ ] **SPEI / Oxxo Pay on-ramp integration** — converts cash to USDC at point of sale
  - Partners: Kueski, OpenPay, or similar Mexican fintech providers
  - This unlocks the 80% of Mexican transactions still in cash
  - Without this, OpenRelay only serves the banked minority
- [ ] Dispute resolution UI for merchants

### Market Milestones

- [ ] First community node in Mexico (non-team operator)
- [ ] First community node in Spain
- [ ] First WooCommerce store using OpenRelay in production
- [ ] Partnership announcement with at least one Mexican fintech for on-ramp

### Community Milestones

- [ ] First contributor bounty paid from treasury
- [ ] 10+ external contributors
- [ ] Community call cadence established (monthly, in Spanish)
- [ ] Node operator guide translated: Spanish, English, Portuguese

---

## Phase 3 — Ecosystem (Months 10–18)

**Goal:** Multi-chain. Go SDK for AI agents. Institutional compatibility layer. On-chain governance. Treasury self-sustaining.

### Technical Milestones

- [ ] Polygon USDC support
- [ ] Solana USDC support
- [ ] Go SDK: `github.com/lacasoft/openrelay-go`
  - Critical for AI agent infrastructure (MCP, autonomous agents)
  - This is the primary x402 consumer in 2026+
- [ ] **Institutional compatibility layer**
  - OpenRelay as routing layer for institutional products
  - Documented API for banks and asset managers to integrate
  - No custody, no KYC on OpenRelay side — institution handles that
- [ ] On-chain governance for protocol changes
  - Replaces multisig arbitration in `DisputeResolver.sol`
  - RFC process moves on-chain with contributor voting
- [ ] Public treasury dashboard
  - Real-time fee accumulation visible to anyone
  - Bounty allocation transparent and on-chain
- [ ] Core team exits bootstrap node operation
  - All routing handled by community nodes
  - Bootstrap nodes decommissioned transparently

### Market Milestones

- [ ] 10+ active community nodes on Base mainnet
- [ ] 3+ countries in LATAM with production merchants
- [ ] First institutional partner using OpenRelay as routing layer
- [ ] v1.0 declared (see criteria below)

### Community Milestones

- [ ] First governance vote on protocol change
- [ ] 50+ contributors across all packages
- [ ] Dedicated community nodes in MX, ES, AR, CO
- [ ] First developer conference talk about OpenRelay in Spanish

---

## v1.0 Declaration Criteria

Version 1.0 will be declared when all three conditions are simultaneously true:

1. Smart contracts audited by an independent firm and deployed to Base mainnet
2. At least 10 independent community nodes active on the network
3. SDK used in at least one production merchant deployment

These are public, verifiable, and non-negotiable. No version inflation.

---

## What Is Not On This Roadmap

**Fiat gateway.** Stripe processes Visa and Mastercard because it has banking licenses in 50 countries. OpenRelay will never have that — and does not need it. Merchants who need fiat should use Stripe for fiat and OpenRelay for crypto. These are complementary, not competitive.

**A protocol token.** There will never be a RELAY token. Node operators earn USDC. Contributors earn reputation and voice. Introducing a speculative token would corrupt the incentive structure and attract the wrong community.

**Upgradeability in the core contracts.** The three contracts are non-upgradeable by design. Any protocol change that requires contract modification goes through a full audit cycle and a new deployment — not an upgrade. This is a feature, not a limitation.

**KYC/AML compliance layer.** OpenRelay does not process identity. That is the merchant's responsibility under their jurisdiction. OpenRelay provides payment routing; compliance is upstream.

---

## The Urgency

The institutional positioning described above is not a future threat — it is a present reality. CoinShares is already on Nasdaq. BlackRock is already in Palacio Nacional. Mexico's cash elimination timeline is 2026.

Every month that OpenRelay does not have a working node network and at least one production merchant is a month where the institutional narrative becomes the only one available.

The community has the technical advantage — open source, zero fees, no gatekeepers. The institutions have the capital advantage — regulation, distribution, government relationships.

The only way the community wins is by moving faster than the institutions expect.

---

*This roadmap is a living document. Changes are proposed via GitHub issues tagged `roadmap`. Approved changes are merged with a version bump and a dated changelog entry.*

*Last updated: April 2026*

# OpenRelay — CLAUDE.md

## Project Overview
OpenRelay is an open-source, decentralized payment routing network built for LATAM. It enables merchants to accept USDC payments on Base L2 through a network of community-operated relay nodes.

**Version**: 0.0.1 (Phase 1 — Testnet)
**License**: Apache-2.0

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  Dashboard   │────▶│   REST API   │────▶│  Relay Nodes  │
│  (Next.js)   │     │  (Fastify)   │     │  (Fastify)    │
└─────────────┘     └──────┬───────┘     └───────┬───────┘
                           │                     │
                    ┌──────┴───────┐      ┌──────┴───────┐
                    │  PostgreSQL  │      │   SQLite     │
                    │  + Redis     │      │   (local)    │
                    └──────────────┘      └──────────────┘
                           │                     │
                    ┌──────┴─────────────────────┴───────┐
                    │     Smart Contracts (Base L2)       │
                    │  NodeRegistry · StakeManager ·      │
                    │  DisputeResolver                    │
                    └────────────────────────────────────┘
```

## Monorepo Structure

```
openrelay/
├── packages/
│   ├── api/          — REST API (Fastify + PostgreSQL + Redis) — Port 3000
│   ├── node/         — Relay node daemon (Fastify + SQLite) — Port 4000
│   ├── protocol/     — Shared types, constants, errors (TypeScript)
│   ├── sdk-js/       — JavaScript/TypeScript SDK (tsup dual ESM/CJS)
│   ├── sdk-python/   — Python SDK (httpx + pydantic, Python ≥3.11)
│   ├── sdk-php/      — PHP SDK (Guzzle, PHP ≥8.1)
│   ├── contracts/    — Solidity smart contracts (Foundry, Solc 0.8.25)
│   ├── dashboard/    — Merchant dashboard (Next.js 14) — Port 3001
│   └── docs/         — (empty placeholder)
├── infra/
│   ├── docker/       — Dockerfile.api, Dockerfile.node, Dockerfile.dashboard
│   └── k8s/          — (empty, planned)
├── scripts/          — (empty)
└── .github/workflows/ — ci.yml, release.yml
```

## Tech Stack

### Core Runtime & Build
- **Node.js** ≥20 (LTS)
- **pnpm** ≥9 (workspace monorepo manager)
- **Turborepo** 2.0 (build orchestration, task caching)
- **TypeScript** 5.5 (strict mode, ES2022 target, NodeNext module resolution)
- **Biome** 1.8 (linter + formatter — single quotes, no semicolons, 2-space indent, 100 char width)

### Backend
- **Fastify** 4.28 — REST API (packages/api) y Node daemon (packages/node)
- **PostgreSQL** 16 — Base de datos principal (via `postgres.js` 3.4, connection pool max 10)
- **Redis** 7 — Cache, rate limiting, replay protection (via `ioredis` 5.4)
- **SQLite** — Almacenamiento local del nodo (via `better-sqlite3` 9.6, WAL mode)
- **Zod** 3.23 — Validación de schemas
- **Pino** — Logging estructurado (via `pino-pretty` 11.2)
- **nanoid** 5.0 — Generación de IDs

### Blockchain / Web3
- **Solidity** 0.8.25 (EVM target: cancun, optimizer 200 runs)
- **Foundry / Forge** — Framework de smart contracts (build, test, deploy, fuzz)
- **Viem** 2.17 — Interacción con Base L2 / Ethereum
- **Base L2** — Red de settlement
- **USDC** — Token de pagos

### Frontend
- **Next.js** 14.2 (App Router, standalone output)
- **React** 18.3
- **React DOM** 18.3

### SDKs Multi-lenguaje
| SDK | Lenguaje | Versión mínima | Deps principales |
|-----|----------|----------------|-----------------|
| sdk-js | TypeScript | Node ≥20 | tsup 8.0 (dual ESM/CJS build) |
| sdk-python | Python | ≥3.11 | httpx ≥0.27, pydantic ≥2.7 |
| sdk-php | PHP | ≥8.1 | guzzlehttp/guzzle ^7.8 |

### Infraestructura & DevOps
- **Docker** + **Docker Compose** 3.9 (multi-stage builds, node:20-alpine)
- **GitHub Actions** — CI (typecheck, lint, test, contract test, build) + Release (npm publish, Docker push, GitHub Release)
- **GHCR** (GitHub Container Registry) — Imágenes Docker en releases
- **Kubernetes** — Planeado (infra/k8s/ vacío)
- **Makefile** — 30+ targets para orquestación local

### Testing
- **Vitest** 1.6 — Test runner JS/TS (configurado en api, node, sdk-js — sin tests escritos aún)
- **Foundry/Forge** — Tests de contratos (~240+ tests, incluye fuzz testing con 10000 runs)

### Seguridad & Middleware
- **@fastify/cors** 9.0 — CORS (actualmente origin: '*', pendiente restringir)
- **@fastify/rate-limit** 9.0 — Rate limiting (100 req/min por API key)
- **HMAC-SHA256** — Firma de requests API↔Node (tolerancia 5 min)
- **SHA-256** — Hashing de API keys en PostgreSQL
- **crypto.createHmac** — Webhook signing

## Key Commands

```bash
# Setup
pnpm install                    # Install all dependencies
make up                         # Docker Compose up (postgres, redis, api, node)
make seed                       # Bootstrap merchant + API keys

# Development
make dev-api                    # Hot-reload API
make dev-node                   # Hot-reload Node
pnpm build                      # Build all packages (via Turbo)
pnpm typecheck                  # Type check all packages

# Testing
pnpm test                       # Run vitest across packages
make contracts-test             # forge test -vvv
make contracts-test-fuzz        # forge test --fuzz-runs 10000

# Quality
pnpm lint                       # Biome check
make status                     # Health check endpoints
```

## Package Dependencies (internal)

```
protocol ← api, node, sdk-js, dashboard
sdk-js   ← dashboard
```

All internal dependencies use `workspace:*` protocol.

## API Authentication

- **Public key** (`pk_live_*` / `pk_test_*`): Read-only operations
- **Secret key** (`sk_live_*` / `sk_test_*`): Write operations (create intents, manage webhooks)
- Keys stored as SHA-256 hashes in PostgreSQL
- Internal API↔Node communication uses HMAC-SHA256 signatures

## Payment Intent Lifecycle

```
created → routing → pending_payment → confirming → settled
                         ↓
                  failed / expired / cancelled
```

## Fee Structure

- Protocol fee: 50 bps (0.5%)
- Node share: 80% of fee (40 bps)
- Treasury share: 20% of fee (10 bps)

## Environment

- `.env.example` has all required variables documented
- Docker Compose manages postgres, redis, api, node services
- Dashboard is optional (`--profile dashboard`)

## Phase 1 Limitations (Known TODOs)

- On-chain tx verification not implemented (x402 + settlement)
- Payment address derivation uses SHA-256 (not HD wallet)
- Chain watcher is simulated in dev mode
- Node registration verification disabled
- Arbiter governance is centralized (single-add, no multisig)
- Dashboard is a placeholder
- No unit tests for API/Node/SDK packages (only contract tests exist)

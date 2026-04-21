# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Deployed
- **Base Sepolia (testnet, 2026-04-21, block 40522124)**: Redeploy with
  **separated roles** (deployer, treasury, guardian, and node operator on four
  distinct wallets), addressing the pre-public audit finding C1. All three
  contracts source-verified on Basescan. The previous deploy (block 40408950)
  is orphaned — its registered node (operator `0x0632…F05C`) lives on the
  orphaned `NodeRegistry`. First bootstrap re-registration with the new
  operator wallet (`0xf73e…5da4`) is the next step. See
  `packages/contracts/deployments/sepolia.json` for current addresses and full
  deploy history.

  New contract addresses:
  - `NodeRegistry`    — `0x2dFdF6151d6BF0156D28976F23823d3f1f9CB106`
  - `StakeManager`    — `0xFf4e68652BC8C6b8de18a79C4D2FDDe0c9C9F517`
  - `DisputeResolver` — `0xAAB6E368767707e562Fb09dB2432F9a691B9915a`

  Role wallets:
  - Treasury  — `0x05CDED242AFC9D7e60eC3049bD8bDccbbA078261`
  - Guardian  — `0xbB514Eca8f39d0A3B8092B323282304709d17Ddf`
  - Operator  — `0xf73e2E5a4493d8a4C28e6f88c14a396C82395da4`

- **Base Sepolia (testnet, 2026-04-21, block 40514749)**: First OpenRelay node
  registered on-chain on the previous (now-orphaned) `NodeRegistry`. Bootstrap
  node with endpoint `https://nodeit.openrelay.site`, 40 USDC staked. Operator
  `0x063250650155518BE28989Ec41c597dC1d1eF05C`, register tx
  `0x42c170db7d754063bf03d7dd86f1e684c74c573d600c16e57a63b9fecf4937c6`.
  Historical record — this registry was superseded by the 2026-04-21 redeploy
  above.
- **Base Sepolia (testnet, 2026-04-19)**: Redeploy with adjustable `minStake`
  set to 40 USDC (from PR #14). All three contracts source-verified on
  Basescan. Block 40408950. Previous deploy (block 40395831, hardcoded
  100 USDC stake) is orphaned. See `packages/contracts/deployments/sepolia.json`
  for current addresses and historical context.

### Added
- Adjustable `minStake` on `NodeRegistry` — state variable set at deploy time,
  guardian can raise (never lower) via `setMinStake()`. Testnet default: 40 USDC.
  Preserves Sybil resistance while lowering early-adopter friction.
- On-chain USDC transfer verification via viem (x402 + settlements)
- HD wallet address derivation for secure payment address generation
- Real chain watcher with USDC Transfer event polling
- SSRF protection on webhook URL registration
- Persistent webhook delivery queue via Redis
- CORS origin restriction (configurable via CORS_ORIGIN env var)
- Timing-safe secret comparison for internal API
- HMAC tolerance window reduced to 60 seconds
- Fastify TypeScript type augmentation (eliminated all `any` casts)
- Structured Pino logging (replaced all console.log/warn/error)
- Named constants for all magic numbers
- Interval cleanup on shutdown (memory leak fix)
- 147 unit tests across API, Node, and SDK-JS packages
- Security scanning in CI pipeline (pnpm audit)
- Dependabot configuration for automated dependency updates
- Vitest coverage configuration (v8 provider)
- Docker non-root user in all containers
- .dockerignore for optimized builds
- Package-level README files
- Python SDK timestamp verification in webhooks
- PHP SDK explode safety and timestamp validation

### Fixed
- Docker Compose health checks (JSON grep pattern)
- Empty catch blocks now log errors
- SDK merchantWallet not forwarded in constructor
- SDK x402 middleware header access for Web Request objects

### Security
- CORS restricted from `*` to configurable origins
- crypto.timingSafeEqual for secret comparison
- Atomic Redis SETNX for x402 replay protection
- SSRF validation on webhook URLs (blocks private IPs)
- HMAC window reduced from 5 min to 60 seconds
- Docker containers run as non-root appuser
- hmac.compare_digest in Python SDK
- Timestamp freshness validation in PHP/Python SDKs

## [0.0.1] - 2026-04-04

### Added
- Initial monorepo setup with pnpm workspaces and Turborepo
- REST API with Fastify (merchant gateway)
- Node daemon for relay operations
- Shared protocol package (types, constants, errors)
- JavaScript/TypeScript SDK with x402 middleware
- Python SDK (httpx + pydantic)
- PHP SDK (Guzzle)
- Solidity smart contracts (NodeRegistry, StakeManager, DisputeResolver)
- Foundry test suite (~240+ tests with fuzz testing)
- Next.js merchant dashboard (Phase 1 placeholder)
- Docker Compose orchestration
- GitHub Actions CI/CD pipeline
- Comprehensive documentation (Whitepaper, Protocol, Infrastructure)

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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

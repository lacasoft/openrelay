# Contributing to OpenRelay

OpenRelay is built for the Hispanic developer community and the global open-source ecosystem equally. **Contributions in Spanish are welcomed as first-class citizens alongside contributions in English.** Issues, PRs, documentation, and community discussion can be in either language.

---

## Why Contribute Now

The window for building community-owned payment infrastructure before institutional standards are set is not measured in years. It is measured in months.

In April 2026, BlackRock entered Mexico's federal government tied to Mexico's mandatory digital payment transition. CoinShares listed on Nasdaq the same week. The institutional positioning is happening now. OpenRelay is the technical response — and it needs contributors now, not after the standards are defined.

A node you run today in Mexico City or Madrid is infrastructure that no institution controls. Code you ship today is the foundation that real merchants in 2026 will run on.

---

## Ways to Contribute

**Ship code** — bugs, features, SDKs, plugins. Check open issues labeled `good first issue` or `help wanted`.

**Run a node** — grow the network and earn routing fees in USDC. Every community node in LATAM or Spain matters. See [INFRASTRUCTURE.md](./INFRASTRUCTURE.md#13-node-operation-guide).

**Write documentation** — in Spanish, English, or Portuguese. The developer who can't read the docs can't use the protocol.

**Review and audit** — smart contracts need eyes. More reviewers means better security. Economic and logical analysis of the contracts is as valuable as Solidity expertise.

**WooCommerce / Shopify plugins** — the fastest path to merchant adoption in Mexico. High-impact Phase 2 contribution if you have PHP experience.

**SPEI / Oxxo Pay integration** — the on-ramp that unlocks the 80% of Mexican transactions still in cash. Critical if you have Mexican fintech API experience.

**Spread the word** — in LATAM developer communities (CDMX Dev, Wizeline, La Maquinista), Spanish tech Twitter, Spanish-language YouTube. OpenRelay exists only if developers know about it.

---

## Development Setup

**Requirements:** Node.js >= 20, pnpm >= 9, Foundry (`curl -L https://foundry.paradigm.xyz | bash`)

```bash
git clone https://github.com/lacasoft/openrelay
cd openrelay
pnpm install
cp .env.example .env
pnpm build
pnpm test
```

**Running locally**

```bash
docker compose -f infra/docker/docker-compose.yml up   # full stack
pnpm --filter @openrelay/api dev                        # API watch mode
pnpm --filter @openrelay/node dev                       # node watch mode
cd packages/contracts && forge test -vvv                # Solidity tests
```

---

## Making Changes

1. Fork the repository
2. Create a branch: `git checkout -b feat/your-feature` or `fix/your-bug`
3. Make your changes
4. Run `pnpm test` and `pnpm typecheck` — both must pass
5. Run `pnpm biome check .` — must pass with no violations
6. Commit with a clear message:

```
feat(sdk): add x402 middleware for Next.js
fix(routing): handle node rejection correctly
feat(sdk): agregar soporte para middleware de Fastify
fix(api): corregir manejo de errores en webhooks
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`

---

## Smart Contract Changes

- All changes must include tests in `packages/contracts/test/`
- Run `forge test -vvv` and `forge fmt --check` before opening a PR
- Any interface change requires an RFC first
- No upgradeability patterns, proxy patterns, or admin keys — non-negotiable
- Security-relevant changes require review from at least two maintainers

---

## Protocol Changes (RFC Process)

1. Open a GitHub issue with the `RFC` label
2. Discussion period: minimum 7 days
3. If consensus is reached, open a PR updating `PROTOCOL.md` and affected code
4. Smart contract interface changes require an independent audit before mainnet

---

## Code Style

[Biome](https://biomejs.dev/) for linting and formatting. No `any` without a comment. Zod for all external inputs. JSDoc with `@example` on all exported functions.

---

## Security Vulnerabilities

**security@openrelay.dev** — responsible disclosure, bounties for critical findings, 48-hour acknowledgment.

Do not open public issues for security vulnerabilities.

---

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.

---

*Si tienes preguntas en español, puedes abrir un issue en español o contactar al equipo en Discord. La comunidad hispanohablante es parte fundamental de este proyecto, no una traducción.*

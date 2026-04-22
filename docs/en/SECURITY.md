# Security Policy

*Versión en español: [SECURITY.md](../../SECURITY.md).*

OpenRelay is payment infrastructure. We take vulnerabilities seriously and welcome responsible disclosure.

## Reporting a vulnerability

**📧 security@openrelay.dev**

For sensitive reports, write to that email. If you prefer an encrypted channel, use the private [GitHub Security Advisories form](https://github.com/lacasoft/openrelay/security/advisories/new) — it reaches the same team and is end-to-end encrypted.

Do not open a public issue for a vulnerability until we have confirmed and patched it.

## What to include

- Description of the issue and potential impact (fund theft, DoS, privilege escalation, etc.)
- Reproducible steps — ideally a proof-of-concept or code snippet
- Affected version (commit SHA, release tag, or on-chain address if a contract)
- Your name or handle if you want public credit (optional)

Don't run destructive tests against live infrastructure (bootstrap nodes, hosted API). Run the stack locally to reproduce.

## Scope

**In scope:**

- Contracts in `packages/contracts/` (`NodeRegistry`, `StakeManager`, `DisputeResolver`, `Pausable`)
- REST API (`packages/api/`)
- Node daemon (`packages/node/`)
- SDKs (`packages/sdk-js`, `packages/sdk-python`, `packages/sdk-php`)
- Deploy and operation scripts (`scripts/`)
- CI/CD (`.github/workflows/`)

**Out of scope:**

- Private operator infrastructure (VPS, DNS, etc.) — operator's responsibility
- Physical or social-engineering attacks on team members
- Third-party dependency vulns already reported upstream (share the CVE and we'll prioritize the upgrade)
- Rate-limiting / DoS on public APIs — already protected at the infra layer; tell us if you see actual abuse

## SLA

- **Initial response:** within 72 hours (business hours, America/Mexico_City).
- **Triage + severity assigned:** within 7 days.
- **Fix or public roadmap:** within 14 days for HIGH/CRITICAL; best-effort for LOW/MEDIUM.
- **Advisory publication:** coordinated with you; typically 90 days post-fix.

## Recognition

OpenRelay does not yet have a formal bug bounty program with published amounts (we're early-stage, no significant treasury yet). What we do offer:

- **Public credit** in the CHANGELOG and on the advisory release page.
- **Discretionary bounty in USDC** from the treasury (20% of fees) for valid HIGH/CRITICAL reports, once treasury has sustained flow.
- **Hall of fame** in this document once the first report is resolved.

A formal bounty program with a payout table will be available in Phase 2 alongside the external audit.

## Supported versions

OpenRelay is in **Phase 1 (testnet)**. Only the latest `master` receives security fixes at this stage. Testnet deployments on Sepolia are verified on Basescan — see `packages/contracts/deployments/sepolia.json`.

| Version | Status | Security support |
|---|---|---|
| `master` (testnet v0.x) | Active | ✅ |
| Pre-`v0.1.0` versions | Pre-release | ❌ (use HEAD) |
| Mainnet | Pending external audit | N/A |

## Escalating to the on-chain guardian

The contracts on Base Sepolia have a **guardian** (`Pausable.guardian`) that can pause critical functions in case of an active exploit. The guardian address is published in `packages/contracts/deployments/sepolia.json`.

If you detect a **live active** exploit, in addition to emailing `security@openrelay.dev`, include "GUARDIAN-PAUSE" in the subject. We escalate to the guardian operator for an emergency pause while we coordinate the fix.

## What NOT to do

- Don't publicize the vulnerability on Twitter/X, Discord, Telegram, or forums until it's fixed.
- Don't open a public PR with the fix — send it by email or via GitHub Security Advisory, we coordinate a private fix and then merge.
- Don't exploit the vulnerability beyond what's needed to demonstrate it. If you accidentally moved funds, tell us — we'll work on recovery.

## No unnecessary legalese

We won't sue anyone for good-faith reporting that follows this policy. People who find and report vulnerabilities help the project. Treat us in good faith and we return it.

---

*This policy is revised every roadmap phase. Last updated: 2026-04-21.*

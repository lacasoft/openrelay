# Política de Seguridad

*English version: [docs/en/SECURITY.md](docs/en/SECURITY.md).*

OpenRelay es infraestructura de pagos. Tomamos las vulnerabilidades muy en serio y agradecemos la divulgación responsable.

## Reportar una vulnerabilidad

**📧 security@openrelay.dev**

Para reportes sensibles escribe a ese correo. Si prefieres canal encriptado, puedes usar el formulario privado de [GitHub Security Advisories](https://github.com/lacasoft/openrelay/security/advisories/new) — llega al mismo equipo y tiene cifrado extremo a extremo.

No abras un issue público para reportar una vulnerabilidad hasta que la hayamos confirmado y parcheado.

## Qué incluir en el reporte

- Descripción del issue y el impacto potencial (robo de fondos, DoS, escalada de privilegios, etc.)
- Pasos reproducibles — idealmente un proof-of-concept o un fragmento de código
- Versión afectada (commit SHA, tag de release, o dirección on-chain si es un contrato)
- Tu nombre o handle si quieres reconocimiento público (opcional)

No hagas pruebas destructivas contra infraestructura en vivo (nodos bootstrap, API alojada). Corre el stack local si necesitas reproducir.

## Scope

**Sí aplican:**

- Contratos en `packages/contracts/` (`NodeRegistry`, `StakeManager`, `DisputeResolver`, `Pausable`)
- API REST (`packages/api/`)
- Daemon del nodo (`packages/node/`)
- SDKs (`packages/sdk-js`, `packages/sdk-python`, `packages/sdk-php`)
- Scripts de deploy y operación (`scripts/`)
- CI/CD (`.github/workflows/`)

**No aplican:**

- Infraestructura privada de operadores de nodo (VPS, DNS, etc.) — es responsabilidad del operador
- Ataques físicos o de ingeniería social a personas del equipo
- Vulnerabilidades en dependencias de terceros ya reportadas upstream (pásanos el CVE y prioriizamos el upgrade)
- Rate-limiting/DoS de APIs públicas — ya están protegidas por la infra; avísanos si ves abuso real

## SLA

- **Respuesta inicial:** dentro de 72 horas (hábiles, America/Mexico_City).
- **Triage + severidad asignada:** dentro de 7 días.
- **Fix o roadmap público:** dentro de 14 días para HIGH/CRITICAL; mejor esfuerzo para LOW/MEDIUM.
- **Publicación del advisory:** coordinada contigo; típicamente 90 días post-fix.

## Reconocimiento

Hasta ahora OpenRelay no tiene un programa de bug bounty formal con montos publicados (somos early-stage, sin treasury significativo). Lo que sí ofrecemos:

- **Reconocimiento público** en el CHANGELOG y la página de releases del advisory.
- **Bounty discrecional en USDC** desde el treasury (20% de fees) para reportes de HIGH/CRITICAL válidos, una vez el treasury tenga flujo sostenido.
- **Hall of fame** en este documento una vez haya el primer reporte resuelto.

Un programa de bounty formal con tabla de pagos estará disponible en Phase 2 junto con la auditoría externa.

## Versiones soportadas

OpenRelay está en **Phase 1 (testnet)**. Solo la última versión del `master` branch recibe fixes de seguridad en esta etapa. Las deployadas a Sepolia están verificadas en Basescan — ver `packages/contracts/deployments/sepolia.json`.

| Versión | Estado | Soporte de seguridad |
|---|---|---|
| `master` (testnet v0.x) | Activa | ✅ |
| Versiones previas a `v0.1.0` | Pre-release | ❌ (use el HEAD) |
| Mainnet | Pendiente audit externa | N/A |

## Escalada al guardian on-chain

Los contratos en Base Sepolia tienen un **guardian** (`Pausable.guardian`) que puede pausar funciones críticas en caso de exploit activo. La dirección del guardian está publicada en `packages/contracts/deployments/sepolia.json`.

Si detectas un exploit **activo** en tiempo real, además de escribirnos a `security@openrelay.dev`, incluye la palabra "GUARDIAN-PAUSE" en el asunto. Escalamos al operador del guardian para una pausa de emergencia mientras coordinamos el fix.

## Qué NO hacer

- No publiques la vulnerabilidad en Twitter/X, Discord, Telegram ni foros hasta que esté corregida.
- No abras un pull request público con el fix — mándalo por email o por GitHub Security Advisory, coordinamos un fix privado y luego hacemos merge.
- No exploites la vulnerabilidad más allá de lo necesario para demostrarla. Si por error moviste fondos, dínoslo — trabajamos en la devolución.

## Sin legalese innecesario

No vamos a demandar a nadie por reportar un bug de buena fe siguiendo esta política. Gente que encuentra y reporta vulnerabilidades ayuda al proyecto. Trátenos con buena fe y la misma vuelve.

---

*Esta política se actualiza en cada fase del roadmap. Última revisión: 2026-04-21.*

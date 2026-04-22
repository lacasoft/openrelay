# OpenRelay — Reporte de Auditoría Integral

> **⚠️ Snapshot interno histórico — 2026-04-15**
>
> Este documento es una fotografía del estado del monorepo al **2026-04-15**, hecha durante Phase 1 por agentes de análisis automatizados, para guiar el trabajo de hardening previo al deploy.
>
> **La mayoría de los hallazgos P0/P1 listados aquí ya fueron corregidos** en la serie de commits que desembocó en el deploy a Sepolia (ver `CHANGELOG.md`, secciones `[Unreleased]` → Fixed / Security / Added). Por ejemplo: verificación on-chain de x402, CORS restringido, `crypto.timingSafeEqual`, tests en todos los paquetes, lockfile commiteado, HD wallet derivation, etc.
>
> Se mantiene bajo `docs/audits/` como **registro histórico** y para preservar el contexto de por qué se hicieron los cambios posteriores. No es la fuente de verdad del estado actual de seguridad — para eso ver `CHANGELOG.md` y `SECURITY.md`.
>
> Para auditorías externas formales pre-mainnet (pendientes), los reportes se publicarán en este mismo directorio con el naming `YYYY-MM-DD-<auditor>.md`.

---

**Fecha**: 2026-04-15
**Alcance**: Análisis completo del monorepo — estructura, código, seguridad, arquitectura, dependencias, DevOps
**Método**: 6 agentes de análisis paralelos escaneando todos los archivos fuente

---

## Resumen Ejecutivo

OpenRelay es un monorepo bien estructurado para una red de pagos descentralizada sobre Base L2 (USDC). La arquitectura es sólida con separación clara de responsabilidades. Sin embargo, el proyecto está en **Phase 1** con limitaciones críticas documentadas que **deben resolverse antes de producción/mainnet**.

### Scorecard General

| Dimensión | Score | Estado |
|-----------|-------|--------|
| Arquitectura | 85/100 | Sólida, buenos patterns |
| Seguridad | 45/100 | Vulnerabilidades críticas (Phase 1 TODOs) |
| Calidad de Código | 60/100 | Funcional pero con code smells |
| Testing | 25/100 | Solo contratos testeados, 0 tests en API/Node/SDK |
| DevOps/CI | 70/100 | Pipeline bueno, falta security scanning |
| Dependencias | 80/100 | Consistentes, sin lockfile |
| Documentación | 85/100 | Excelente documentación estratégica |
| Best Practices | 65/100 | Buenas bases, gaps en ejecución |

---

## 1. HALLAZGOS CRÍTICOS (P0 — Bloqueantes para producción)

### 1.1 Verificación de transacciones on-chain NO implementada
- **Archivos**: `packages/api/src/routes/x402.ts:42-47`, `packages/node/src/routes/intents.ts:111`
- **Problema**: Los pagos x402 y settlements de nodos NO se verifican contra la blockchain
- **Impacto**: Un atacante puede enviar pruebas de pago falsas y recibir servicios sin pagar
- **Severidad**: CRÍTICO — permite robo de fondos en mainnet

### 1.2 CORS abierto a todos los orígenes
- **Archivo**: `packages/api/src/index.ts:32`
- **Código**: `await app.register(cors, { origin: '*' })`
- **Impacto**: Cualquier sitio web puede hacer requests a la API, habilitando CSRF
- **Fix**: Restringir a dominios confiados en producción

### 1.3 Comparación de secretos vulnerable a timing attacks
- **Archivo**: `packages/api/src/routes/internal.ts:31`
- **Código**: `internalSecret !== configSecret` — comparación directa de strings
- **Fix**: Usar `crypto.timingSafeEqual()`

### 1.4 Zero tests en paquetes TypeScript
- **Paquetes afectados**: api, node, sdk-js, dashboard
- **Estado**: Vitest configurado pero **0 archivos de test** existen
- **Impacto**: CI pasa con 0 tests ejecutados — falsa confianza
- **Contratos**: Los smart contracts SÍ tienen ~240+ tests con Foundry (bien)

### 1.5 No existe lockfile (pnpm-lock.yaml)
- **Impacto**: Builds no reproducibles, Dockerfiles usan `--no-frozen-lockfile`
- **Fix**: Ejecutar `pnpm install` y commitear `pnpm-lock.yaml`

### 1.6 Derivación de direcciones de pago insegura
- **Archivo**: `packages/node/src/routes/intents.ts`
- **Problema**: Usa `SHA-256(operator:index)` en lugar de HD wallet derivation (BIP-32)
- **Impacto**: Colisiones de direcciones posibles, rotación de llaves imposible

### 1.7 Chain Watcher vacío en producción
- **Archivo**: `packages/node/src/services/watcher.ts`
- **Problema**: El watcher de producción no tiene implementación — solo dev mode auto-confirma después de 10s
- **Impacto**: Los settlements nunca se confirman en producción real

---

## 2. HALLAZGOS DE SEGURIDAD (P1 — Alta prioridad)

### 2.1 Secretos por defecto débiles
| Archivo | Variable | Valor por defecto |
|---------|----------|-------------------|
| `packages/api/src/lib/config.ts:7` | apiSecret | `'openrelay-dev-secret'` |
| `packages/node/src/lib/config.ts:6` | privateKey | `'0x0000...0000'` |
| `packages/node/src/lib/config.ts:8` | hmacSecret | `'openrelay-dev-hmac-secret-change-in-production'` |

**Riesgo**: Si se copian a producción sin cambiar, el sistema está completamente abierto.

### 2.2 Docker containers corriendo como root
- **Archivos**: Todos los Dockerfiles en `infra/docker/`
- **Problema**: No hay directiva `USER` — containers ejecutan como root
- **Fix**: Agregar `RUN adduser -D appuser && USER appuser`

### 2.3 Puertos de base de datos expuestos
- **Archivo**: `docker-compose.yml:29,45`
- **Problema**: PostgreSQL (5432) y Redis (6379) mapeados a todas las interfaces
- **Fix**: Remover port mappings en producción, usar networking interno

### 2.4 Credenciales de DB hardcodeadas en docker-compose
- **Archivo**: `docker-compose.yml:22-24`
- **Código**: `POSTGRES_USER: openrelay`, `POSTGRES_PASSWORD: openrelay`
- **Fix**: Usar `env_file` o Docker secrets

### 2.5 Webhook URLs sin validación de SSRF
- **Archivo**: `packages/api/src/routes/webhooks.ts:15`
- **Problema**: `z.string().url()` acepta cualquier URL incluyendo IPs internas (RFC1918)
- **Fix**: Validar dominio, bloquear rangos internos

### 2.6 Ventana HMAC de 5 minutos demasiado amplia
- **Archivo**: `packages/node/src/lib/hmac.ts:3`
- **Problema**: `TOLERANCE_MS = 5 * 60 * 1000` permite replay attacks durante 5 minutos
- **Fix**: Reducir a 30-60 segundos y trackear timestamps usados

### 2.7 No hay mecanismo de pausa/emergencia en smart contracts
- **Archivos**: Los 3 contratos (NodeRegistry, StakeManager, DisputeResolver)
- **Problema**: No hay circuit breaker ni Pausable
- **Fix**: Implementar OpenZeppelin Pausable

### 2.8 Gobernanza de árbitros centralizada
- **Archivo**: `packages/contracts/src/DisputeResolver.sol`
- **Problema**: `addArbiter()` puede ser llamado por cualquier árbitro individual
- **Impacto**: Un árbitro malicioso puede agregar confederados
- **Fix**: Requerir multisig 3-of-5 para agregar/remover árbitros

### 2.9 No hay security scanning en CI/CD
- **Archivo**: `.github/workflows/ci.yml`
- **Ausente**: CodeQL, Dependabot, Trivy, npm audit, SAST, secrets scanning
- **Fix**: Agregar GitHub Advanced Security + Dependabot

### 2.10 Race condition en protección anti-replay x402
- **Archivo**: `packages/api/src/routes/x402.ts:66-74`
- **Problema**: Check Redis → Check DB → Set Redis no es atómico
- **Impacto**: Dos requests simultáneos pueden pasar ambos checks

---

## 3. CALIDAD DE CÓDIGO

### 3.1 Type Safety — Uso excesivo de `any`
**15+ instancias** en API y Node packages. Patrón recurrente:
```typescript
const db = (req.server as any).db    // En todos los route handlers
const redis = (req.server as any).redis
```
**Fix**: Module augmentation de Fastify:
```typescript
declare module 'fastify' {
  interface FastifyInstance {
    db: PostgresClient
    redis: Redis
    config: AppConfig
  }
}
```

### 3.2 Error handling — Catch blocks vacíos
| Archivo | Línea | Problema |
|---------|-------|---------|
| `api/src/index.ts` | 59, 64 | `catch {}` silencia errores de DB/Redis |
| `api/src/routes/nodes.ts` | 27 | Catch devuelve array vacío sin logging |
| `api/src/routes/x402.ts` | 58 | Catch silencioso en decode |
| `sdk-js/src/x402/middleware.ts` | 102 | Verify retorna false sin contexto |

### 3.3 Fire-and-forget promises sin tracking
```typescript
// packages/api/src/routes/payment-intents.ts:62-64
setImmediate(() => {
  void triggerRouting(app, intent, req.merchantWallet)  // Si falla, nadie se entera
})
```
**4 instancias** en payment-intents.ts, internal.ts, webhook.ts, watcher.ts.
**Fix**: Job queue (Bull/BullMQ) o al menos logging de errores.

### 3.4 console.log en lugar de logger estructurado
- `packages/api/src/services/webhook.ts`: 4 instancias de `console.log/warn/error`
- `packages/node/src/services/watcher.ts:133`: `console.error`
- **Fix**: Usar `app.log` (Pino) en todas partes

### 3.5 Magic numbers hardcodeados
- Rate limit: `100` requests, `1 minute` (api/index.ts:36)
- Pool size: `10`, timeouts `20`, `10` (api/lib/db.ts:12-14)
- Redis retry: `3`, `3000` (api/lib/redis.ts:11-13)
- Webhook delays: `[0, 30_000, 300_000, ...]` (webhook.ts:14-16)
- Capacity: `MAX_CONCURRENT = 100` (node/routes/intents.ts:53)
- Confirmación: `10_000ms`, `3_000ms`, `5_000ms` (watcher.ts)

**Fix**: Extraer a constantes con nombre en config o `@openrelay/protocol`.

### 3.6 Memory leaks potenciales
- **Archivo**: `packages/node/src/services/watcher.ts:43-98`
- **Problema**: `setInterval()` sin referencia para cancelar en shutdown
- **Fix**: Guardar interval IDs y limpiar en `app.addHook('onClose', ...)`

### 3.7 Webhook retry recursivo sin bound
- **Archivo**: `packages/api/src/services/webhook.ts:45-91`
- **Problema**: `attemptDelivery()` se llama recursivamente con setTimeout
- **Fix**: Usar cola persistente (Redis list, BullMQ)

### 3.8 SDKs de PHP y Python con gaps
| Issue | PHP | Python |
|-------|-----|--------|
| Sin verificación de timestamp en webhooks | Si | Si |
| Timing attack en HMAC | N/A | Si (no usa `hmac.compare_digest`) |
| Sin retry logic | Si | Si |
| Error handling básico | Si | Si |

---

## 4. ARQUITECTURA

### 4.1 Fortalezas

- **Separación de paquetes**: Límites claros, sin imports cruzados indebidos
- **Protocol como single source of truth**: Tipos compartidos correctamente
- **Patrón middleware**: Auth → Rate limit → Route handlers bien implementado
- **Smart contracts bien diseñados**: Events, time-locks, custom errors (gas efficient)
- **SDKs multi-lenguaje**: API surface consistente JS/PHP/Python
- **HMAC signing**: Comunicación API↔Node segura
- **Build orchestration**: Turbo con dependencias topológicas correctas
- **Fee model transparente**: Split 80/20 claro

### 4.2 Problemas Arquitectónicos

**Constantes duplicadas entre capas**:
- Protocol TS: `PROTOCOL_FEE_BPS = 50`, `STAKE_WITHDRAWAL_TIMELOCK_DAYS = 7`
- Solidity: `WITHDRAWAL_TIMELOCK = 7 days`, `SLASH_PERCENTAGE = 20%`
- Node: Valores hardcodeados independientes
- **Riesgo**: Desincronización de parámetros entre capas

**Routing engine incompleto**:
- `services/routing.ts` define scoring pero nunca se llama
- Se usa bootstrap node hardcodeado como fallback
- Sin fallback si el bootstrap node falla → intent queda en ROUTING forever

**Estado "confirming" nunca se setea**:
- El lifecycle define `pending_payment → confirming → settled`
- Pero el código salta de `pending_payment` directo a `settled`

**Webhook delivery sin persistencia**:
- Retries viven en memoria (setTimeout)
- Si el proceso crashea, webhooks pendientes se pierden

**Iteración O(n) en NodeRegistry**:
- `_removeFromActive()` itera todo el array para encontrar y remover
- Con muchos nodos, puede exceder gas limit

---

## 5. DEPENDENCIAS & BUILD

### 5.1 Estado de Dependencias
- **Versiones consistentes**: Sin conflictos entre paquetes
- **workspace:* protocol**: Correcto en todas las referencias internas
- **Sin dependencias deprecadas** detectadas
- **Sin node_modules**: Dependencias no instaladas (necesita `pnpm install`)

### 5.2 Health checks de Docker rotos
- **Archivo**: `docker-compose.yml:91, 141`
- **Problema**: `grep -q 'ok'` busca texto plano pero endpoints devuelven JSON
- **Fix**: Cambiar a `grep -q '"status".*"ok"'`

### 5.3 Paquetes vacíos/huérfanos
- `packages/docs/` — Directorio vacío, sin contenido
- `scripts/` — Directorio vacío
- `infra/k8s/` — Directorio vacío (Kubernetes planeado)

### 5.4 Falta .dockerignore
- **Impacto**: Build contexts incluyen node_modules, .git, coverage
- **Fix**: Crear `.dockerignore` con exclusiones apropiadas

---

## 6. CI/CD & DEVOPS

### 6.1 Pipeline CI (Fortalezas)
- Jobs paralelos: Typecheck & Lint, Unit Tests, Contract Tests, Build Check
- Caché de dependencias pnpm
- Concurrency cancel-in-progress
- Foundry testing con `forge test -vvv`
- Release workflow con tags semánticos

### 6.2 Gaps en CI/CD
| Ausente | Impacto | Prioridad |
|---------|---------|-----------|
| Security scanning (SAST/DAST) | Vulnerabilidades no detectadas | Alta |
| Dependabot / npm audit | Deps vulnerables no actualizadas | Alta |
| Container scanning (Trivy) | Images con CVEs | Alta |
| Code coverage tracking | Sin métricas de calidad | Media |
| E2E tests | Sin validación end-to-end | Media |
| SBOM generation | Sin transparencia supply chain | Baja |
| Docker image signing | Sin verificación de integridad | Baja |

### 6.3 Documentación
**Excelente** documentación estratégica:
- README.md, WHITEPAPER.md, PROTOCOL.md, INFRASTRUCTURE.md (48KB!)
- SOVEREIGNTY.md, COMPLIANCE.md, ROADMAP.md, CONTRIBUTING.md
- Bilingüe (español/inglés)

**Ausente**:
- CHANGELOG.md
- READMEs por paquete individual
- OpenAPI/Swagger spec para REST API
- ADRs (Architecture Decision Records)

---

## 7. SMART CONTRACTS

### 7.1 Fortalezas
- ~240+ tests con Foundry incluyendo fuzz testing
- Custom errors (gas efficient vs require strings)
- Event emission en todos los cambios de estado
- Time-lock de 7 días para withdrawals
- Dispute resolution con ventana de 48h

### 7.2 Vulnerabilidades
| Issue | Contrato | Severidad |
|-------|----------|-----------|
| Sin Pausable/emergency stop | Todos | Alta |
| addArbiter sin multisig | DisputeResolver | Alta |
| O(n) array iteration | NodeRegistry._removeFromActive | Media |
| Sin ReentrancyGuard en withdrawals | StakeManager | Media-Baja |
| Slash afecta pendingWithdrawal | StakeManager | Media |
| Circular dependency en deploy | Deploy.s.sol | Baja |

---

## 8. PLAN DE REMEDIACIÓN PRIORIZADO

### P0 — Antes de CUALQUIER deployment a mainnet
1. Implementar verificación on-chain de transacciones (x402 + settlements via viem)
2. Implementar chain watcher real (viem event watching/polling)
3. Derivación de direcciones con HD wallet (BIP-32)
4. Corregir CORS — restringir orígenes
5. Usar `crypto.timingSafeEqual()` para comparación de secretos
6. Generar y commitear `pnpm-lock.yaml`
7. Agregar mecanismo Pausable a smart contracts

### P1 — Antes de launch público
1. Escribir tests unitarios para API, Node, SDK
2. Fix timing attacks en webhook verification (Python SDK)
3. Agregar security scanning a CI (CodeQL, Dependabot, Trivy)
4. Implementar webhook queue persistente (BullMQ/Redis)
5. Docker: non-root user, .dockerignore, remover port mappings de DB
6. Fix health checks de Docker Compose
7. Multisig para gobernanza de árbitros
8. Validación SSRF en webhook URLs
9. Reducir ventana HMAC a 30-60 segundos

### P2 — Mejoras de calidad
1. Eliminar `any` casts — module augmentation de Fastify
2. Extraer magic numbers a constantes con nombre
3. Reemplazar console.log con logger estructurado (Pino)
4. Agregar error handling a catch blocks vacíos
5. Limpiar setInterval leaks en watcher
6. Sincronizar constantes entre Protocol TS y Solidity
7. CHANGELOG.md + semantic versioning automation
8. OpenAPI spec para REST API
9. READMEs por paquete
10. Métricas y tracing (OpenTelemetry)

---

## 9. CONCLUSIÓN

OpenRelay tiene una **base arquitectónica excelente** con documentación estratégica de alta calidad y smart contracts bien testeados. Los patrones elegidos (monorepo pnpm+Turbo, Fastify, Viem, multi-SDK) son modernos y apropiados.

Sin embargo, el proyecto está en **Phase 1 con limitaciones críticas claramente documentadas** en el código (TODOs). Las vulnerabilidades más graves (verificación on-chain, derivación de direcciones, CORS) son Phase 1 placeholders que **deben implementarse antes de manejar fondos reales**.

La ausencia total de tests en los paquetes TypeScript es el gap más preocupante para la estabilidad del proyecto a mediano plazo.

**Recomendación**: No deployar a mainnet hasta completar todos los items P0 y P1 de este reporte.

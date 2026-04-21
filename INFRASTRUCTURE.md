# Guía de Infraestructura de OpenRelay

*Todo lo que necesitas para convertirte en un experto técnico en OpenRelay. Este documento cubre arquitectura, componentes internos, ciclo de vida de transacciones, modelo económico, seguridad, despliegue e integración en profundidad total.*

---

## Tabla de Contenidos

1. [Visión General del Sistema](#1-visión-general-del-sistema)
2. [Mapa de Componentes](#2-mapa-de-componentes)
3. [Settlement Layer](#3-settlement-layer)
4. [Capa de Smart Contracts](#4-capa-de-smart-contracts)
5. [Routing Engine](#5-routing-engine)
6. [Capa de API](#6-capa-de-api)
7. [Node Daemon](#7-node-daemon)
8. [Capa de SDK](#8-capa-de-sdk)
9. [Protocolo x402](#9-protocolo-x402)
10. [Ciclo de Vida de la Transacción](#10-ciclo-de-vida-de-la-transacción)
11. [Modelo Económico](#11-modelo-económico)
12. [Modelo de Seguridad](#12-modelo-de-seguridad)
13. [Guía de Operación de Node](#13-guía-de-operación-de-node)
14. [Guía de Integración para Comercios](#14-guía-de-integración-para-comercios)
15. [Guía de Despliegue](#15-guía-de-despliegue)
16. [Análisis Comparativo](#16-análisis-comparativo)
17. [Invariantes y Garantías](#17-invariantes-y-garantías)

---

## 1. Visión General del Sistema

OpenRelay es un sistema de routing de pagos de cinco capas. Cada capa tiene una única responsabilidad bien definida y se comunica con las capas adyacentes a través de interfaces documentadas.

```
┌──────────────────────────────────────────────────────────┐
│  SDK Layer                                               │
│  @openrelay/sdk (TS) · openrelay-python · openrelay-php  │
│  x402 middleware for Fastify · Next.js · Express         │
├──────────────────────────────────────────────────────────┤
│  API Layer                                               │
│  Fastify REST API · PostgreSQL · Redis                   │
│  Routing Engine · Webhook Delivery · Auth                │
├──────────────────────────────────────────────────────────┤
│  Routing Layer                                           │
│  Node discovery · Score computation · Intent assignment  │
├──────────────────────────────────────────────────────────┤
│  Protocol Layer (on-chain)                               │
│  NodeRegistry.sol · StakeManager.sol · DisputeResolver   │
├──────────────────────────────────────────────────────────┤
│  Settlement Layer                                        │
│  Base (USDC) · Lightning Network (BTC/sats)              │
└──────────────────────────────────────────────────────────┘
```

**La invariante no negociable a través de todas las capas:**
Los fondos fluyen directamente del payer al comercio. Ninguna capa, componente o node retiene fondos en ningún momento. Los nodes observan, confirman y ganan fees del monto liquidado — nunca están en la ruta de los fondos.

---

## 2. Mapa de Componentes

### Grafo de dependencias de paquetes

```
@openrelay/protocol
    ├── @openrelay/sdk (depends on protocol for types)
    ├── @openrelay/api (depends on protocol for types)
    └── @openrelay/node (depends on protocol for types)

@openrelay/contracts (Solidity — independent of TS packages)

@openrelay/dashboard (depends on sdk for client-side integration)
```

### Estructura del repositorio

```
openrelay/
├── packages/
│   ├── protocol/          # Shared types, constants, errors
│   │   └── src/
│   │       ├── types/
│   │       │   ├── payment-intent.ts   # PaymentIntent, CreatePaymentIntentParams
│   │       │   ├── node.ts             # NodeInfo, NodeScore, IntentAssignment
│   │       │   ├── webhook.ts          # WebhookEvent, DisputeEvent
│   │       │   └── x402.ts             # X402PaymentRequired, X402MiddlewareOptions
│   │       ├── constants.ts            # All protocol constants (fees, timeouts, etc.)
│   │       └── errors.ts               # OpenRelaySDKError, error codes
│   │
│   ├── contracts/         # Solidity smart contracts
│   │   ├── src/
│   │   │   ├── NodeRegistry.sol
│   │   │   ├── StakeManager.sol
│   │   │   ├── DisputeResolver.sol
│   │   │   └── interfaces/
│   │   ├── test/          # 58 Foundry tests + fuzz
│   │   └── script/        # Deploy.s.sol
│   │
│   ├── node/              # Node operator daemon
│   │   └── src/
│   │       ├── routes/    # /health, /info, /intents/assign, /intents/:id/settle
│   │       ├── services/  # registry verification
│   │       └── lib/       # config, hmac signing
│   │
│   ├── api/               # Merchant-facing REST API
│   │   └── src/
│   │       ├── routes/    # payment-intents, webhooks, x402, nodes
│   │       ├── services/  # routing engine
│   │       ├── middleware/ # auth (API key verification)
│   │       └── lib/       # config, db, redis, schema.sql
│   │
│   ├── sdk-js/            # @openrelay/sdk npm package
│   │   └── src/
│   │       ├── resources/ # PaymentIntents, Webhooks
│   │       ├── x402/      # x402 middleware
│   │       └── lib/       # HTTP client, types
│   │
│   └── dashboard/         # Merchant dashboard (Next.js — Phase 1)
│
├── infra/
│   ├── docker/
│   │   ├── docker-compose.yml
│   │   ├── Dockerfile.api
│   │   └── Dockerfile.node
│   └── k8s/               # Helm charts (Phase 2)
│
└── .github/
    └── workflows/
        ├── ci.yml          # PR validation
        └── release.yml     # npm + Docker publish
```

---

## 3. Settlement Layer

### 3.1 Por qué Base + USDC

Base es un L2 sobre Ethereum respaldado por Coinbase. Fue seleccionado como la settlement layer primaria por tres razones:

**Fees.** Las transacciones en Base cuestan entre $0.001 y $0.005, haciendo los micropagos económicamente viables. En Ethereum mainnet, un pago de $0.001 costaría entre $2–5 en gas. En Base, el costo de gas es menor que el pago.

**Ecosistema x402.** El protocolo x402 (HTTP 402 Payment Required para pagos máquina-a-máquina) fue diseñado con Base como el chain primario. La implementación de referencia de x402.org apunta a Base Sepolia para pruebas.

**Liquidez de USDC.** El USDC de Circle en Base tiene liquidez profunda, es redimible 1:1 por USD, y es la unidad de cuenta estándar para transacciones cripto business-to-business.

### 3.2 Dirección del contrato USDC

```
Base mainnet:  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Base Sepolia:  0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

### 3.3 Representación de montos

Todos los montos de USDC en OpenRelay usan micro-unidades de 6 decimales:

```
1 USDC         = 1,000,000 micro-units
$10.00 USDC    = 10,000,000
$0.001 USDC    = 1,000
$100.00 USDC   = 100,000,000
```

**Nunca confundir unidades.** Cada endpoint de API, método del SDK y función de smart contract usa micro-unidades. El único lugar donde aparecen montos legibles por humanos es en la capa de visualización del dashboard del comercio.

### 3.4 Lightning Network

El soporte para Lightning Network (BTC/sats) se incluye en la Fase 1 para pagos denominados en BTC. El node daemon se conecta a una instancia de LND vía gRPC. El node genera invoices BOLT11 en nombre del comercio y monitorea el pago. La confirmación es off-chain (Lightning) pero el node registra el evento de settlement on-chain vía su activity log.

### 3.5 Confirmaciones requeridas por chain

| Chain | Confirmaciones | Tiempo típico |
|---|---|---|
| Base | 1 | ~2 segundos |
| Ethereum mainnet (futuro) | 12 | ~2.5 minutos |
| Lightning | Off-chain | Instantáneo |

---

## 4. Capa de Smart Contracts

Tres contratos no actualizables en Base definen todas las reglas del protocolo on-chain.

### Estado del deploy

El primer deploy en testnet se completó el **2026-04-18 en Base Sepolia (chainId 84532)**. Los tres contratos están live y con código fuente verificado en Basescan. La fuente canónica de verdad para las direcciones desplegadas, el bloque, el hash del commit y los parámetros del constructor es `packages/contracts/deployments/sepolia.json` — ese JSON es lo que leen la API, el node daemon y cualquier integrador. Mainnet permanece bloqueado por la auditoría externa pendiente.

### Principios de diseño

- **No actualizables:** Sin patrones proxy, sin admin keys, sin funciones de pausa. Lo que se audita es lo que corre. Si un bug requiere una corrección, la respuesta correcta es un nuevo despliegue con una ruta de migración aprobada por RFC.
- **Superficie mínima:** Cada contrato hace exactamente una cosa. Sin preocupaciones cruzadas.
- **Denominado en USDC:** Todo el stake, fees y slashing son en USDC. Sin token de protocolo.
- **Orientado a eventos:** Todos los cambios de estado emiten eventos. El routing engine off-chain y el node daemon dependen de los event logs, no de polling.

---

### 4.1 NodeRegistry.sol

**Responsabilidad:** Registro y descubrimiento de nodes sin permisos.

**Estado:**
```solidity
mapping(address => Node) private _nodes;
address[] private _activeOperators;
```

**Funciones clave:**

`register(string endpoint, uint256 stakeAmount)`
- Invocable por cualquiera con suficiente aprobación de USDC
- Requiere `stakeAmount >= minStake` (100 USDC en mainnet · 40 USDC en Sepolia testnet — ajustable por guardian vía `updateMinStake`, solo incrementos)
- Llama a `StakeManager.depositFor()` para transferir USDC
- Hace push del operator a `_activeOperators`
- Emite `NodeRegistered`

`deactivate()`
- Remueve al operator de `_activeOperators`
- NO libera el stake — debe pasar por StakeManager
- Emite `NodeDeactivated`

`getActiveNodes() → address[]`
- Devuelve todas las direcciones de operators activos
- Usado por el routing engine para descubrir candidatos

**Eventos a los que el routing engine escucha:**
```
NodeRegistered(address indexed operator, string endpoint, uint256 stake)
NodeUpdated(address indexed operator, string endpoint)
NodeDeactivated(address indexed operator)
```

**Invariantes de seguridad:**
- Una dirección no puede registrarse dos veces (verificado vía `registeredAt != 0`)
- El stake lo retiene StakeManager, no NodeRegistry — el registry no tiene balance de tokens
- `getActiveNodes()` es O(n) — aceptable para la Fase 1, necesita paginación en la Fase 3

---

### 4.2 StakeManager.sol

**Responsabilidad:** Custodia de stake en USDC, timelock de retiro y slashing.

**Estado:**
```solidity
mapping(address => StakeInfo) private _stakes;

struct StakeInfo {
    uint256 staked;
    uint256 pendingWithdrawal;
    uint256 unlockAt;
}
```

**El timelock de retiro:**

El timelock de 7 días entre `requestWithdrawal()` y `executeWithdrawal()` es la protección principal contra exit scams de nodes. Sin él, un node malicioso podría:
1. Aceptar un payment intent grande
2. Fallar en enrutarlo apropiadamente
3. Retirar inmediatamente todo el stake antes de que el comercio abra una dispute

Con el timelock, el comercio tiene 7 días para abrir una dispute después del settlement. La ventana de dispute y el timelock de retiro son intencionalmente iguales — crean un sistema cerrado donde un node no puede retirar antes de que una dispute pueda resolverse.

**Mecánica de slashing:**

Cuando `DisputeResolver` llama a `slash(operator, amount, disputeId)`:
1. La función verifica `staked + pendingWithdrawal` como el monto total susceptible de slash
2. Reduce `staked` primero, luego `pendingWithdrawal` si staked es insuficiente
3. El monto del slash está limitado al total disponible — el slashing nunca puede crear balances negativos
4. Los fondos slasheados permanecen en el contrato y son rastreados para retiro al treasury (feature de Fase 2)

**Control de acceso:**
- `depositFor()` — solo invocable por la dirección `nodeRegistry` (configurada en el deploy, inmutable)
- `slash()` — solo invocable por la dirección `disputeResolver` (configurada en el deploy, inmutable)
- `deposit()`, `requestWithdrawal()`, `executeWithdrawal()` — invocables por cualquier operator registrado

---

### 4.3 DisputeResolver.sol

**Responsabilidad:** Adjudicación de disputes y decisiones de slashing de stake.

**Ciclo de vida:**

```
Open → NodeResponded → Resolved (MerchantWins or NodeWins)
Open → (48h passes without response) → Expired → Slashed
```

**Mecánica de votación (Fase 1):**

Las disputes se resuelven por un multisig 3-de-5. Cada arbiter llama a `vote(disputeId, outcome)`. Cuando se acumulan 3 votos por el mismo outcome, `_resolve()` se dispara automáticamente. Esto evita requerir un paso de ejecución separado.

Decisiones clave de diseño:
- **Votación concurrente:** Los 5 arbiters pueden votar en cualquier orden. El umbral dispara la resolución automáticamente.
- **Sin cambios de voto:** Una vez que un arbiter vota, su voto es inmutable (verificado vía `arbiterVotes[disputeId][msg.sender] != None`).
- **Expirada = MerchantWins:** Si un node falla en responder dentro de 48 horas, `expireDispute()` puede ser llamada por cualquiera. Una dispute expirada dispara slashing sin votos de arbiters. Esto previene que los nodes ignoren disputes para evitar el slashing.

**Almacenamiento de evidencia:**

La evidencia se almacena como IPFS CIDs (hashes direccionados por contenido), no como datos on-chain. Esto mantiene los costos de almacenamiento del contrato bajos mientras hace la evidencia públicamente auditable — cualquiera puede recuperar el contenido de IPFS para cualquier dispute.

**Migración de Fase 3:**

Los arbiters del multisig serán reemplazados por gobernanza on-chain en la Fase 3. La interfaz del contrato no cambiará — solo la implementación de `vote()` se actualizará vía un nuevo despliegue con una migración aprobada por RFC.

---

### 4.4 Orden de despliegue de contratos

Debido a dependencias circulares (Registry necesita StakeManager, StakeManager necesita la dirección de Registry), los contratos se despliegan en este orden:

```
1. Deploy StakeManager (with deployer address as placeholder for both registry and resolver)
2. Deploy DisputeResolver (with real StakeManager address)
3. Deploy NodeRegistry (with real StakeManager address)
```

Las direcciones placeholder en StakeManager nunca son invocadas maliciosamente — el wallet del deployer no tiene permisos especiales en la lógica del contrato. Esta es una limitación conocida de la Fase 1 con una ruta de migración documentada a un patrón factory en la Fase 2.

---

## 5. Routing Engine

El routing engine es el componente más sensible al rendimiento de la capa de API. Corre dentro de `packages/api/src/services/routing.ts` y se invoca para cada nuevo payment intent.

### 5.1 Fórmula del score del node

```
Score = (uptime_weight   × 0.30)
      + (speed_weight    × 0.30)
      + (stake_weight    × 0.20)
      + (disputes_weight × 0.20)

Where:
  uptime_weight   = node.uptime_30d  (0.0–1.0, from /info endpoint)

  speed_weight    = 1 - (node.avg_settlement_ms / MAX_SETTLEMENT_MS)
                   MAX_SETTLEMENT_MS = 30,000ms
                   Capped at 0.0 (never negative)

  stake_weight    = min(node.stake / TARGET_STAKE, 1.0)
                   TARGET_STAKE = 10,000 USDC = 10,000,000,000 micro-units
                   A node with 100 USDC (minimum) has stake_weight = 0.01
                   A node with 10,000+ USDC has stake_weight = 1.0

  disputes_weight = disputes_won / max(disputes_total, 1)
                   New nodes with 0 disputes get disputes_weight = 1.0
                   (benefit of the doubt, corrected by uptime and stake)
```

**Interpretación:** El score pondera el uptime y la velocidad igualmente al 30% cada uno porque la confiabilidad y el rendimiento son las preocupaciones primarias del comercio. El stake (20%) refleja skin in the game — un node dispuesto a hacer stake de más está económicamente alineado con el buen comportamiento. El historial de disputes (20%) es una señal de confianza que crece con el tiempo.

### 5.2 Filtros duros (aplicados antes del scoring)

Los nodes que fallan cualquier filtro duro son excluidos del routing sin importar el score:

| Filtro | Condición |
|---|---|
| Registro on-chain | No está en NodeRegistry |
| Flag activo | `active = false` en el registry |
| Soporte de chain | No lista el chain solicitado en `/health` |
| Capacidad | `/health` devuelve `capacity < 0.1` |
| Latencia | Round-trip a `/health` > 5 segundos |
| Bloqueo por dispute | Tiene dispute abierta en estado `Open` |
| Whitelist del comercio | No está en la `node_whitelist` del comercio (si está configurada) |
| Blacklist del comercio | Está en la `node_blacklist` del comercio (si está configurada) |
| Stake mínimo | Por debajo de la preferencia `min_stake` del comercio |
| Score mínimo | Por debajo de la preferencia `min_score` del comercio |

### 5.3 Algoritmo de racing paralelo

```typescript
async function routeIntent(intent, candidates): Promise<RouteResult | null> {
  // 1. Apply hard filters
  const eligible = candidates
    .filter(c => passesHardFilters(c, intent, merchantPrefs))
    .sort((a, b) => b.score - a.score)
    .slice(0, ROUTING_CANDIDATES)  // top 5

  if (eligible.length === 0) return null

  // 2. Race concurrent assignment requests
  const results = await Promise.allSettled(
    eligible.map(c => assignToNode(c.node.endpoint, intent))
  )

  // 3. Return first accepted response
  for (const result of results) {
    if (result.status === 'fulfilled') return result.value
  }

  return null  // all candidates rejected
}
```

**Por qué paralelo, no secuencial:** Si el node con mayor score está temporalmente al máximo de capacidad, el routing secuencial esperaría por un timeout antes de intentar el siguiente candidato. El racing paralelo acepta la primera respuesta disponible en ~3 segundos (el timeout de asignación de node), independientemente de qué candidato responde primero.

**Manejo de rechazos:** Los nodes pueden rechazar un intent con `{ accepted: false, reason: 'at_capacity' }`. El routing engine acepta el siguiente resultado resuelto. Si los 5 candidatos rechazan, el intent se queda en el estado `CREATED` y el SDK reintenta después de 5 segundos.

### 5.4 Cacheado de scores

Los scores se cachean en Redis con un TTL de 60 segundos. Esto significa:
- Los scores de los nodes se refrescan como máximo una vez por minuto
- Los scores obsoletos persisten hasta por 60 segundos después de que un node cambia de estado
- El routing engine NO re-obtiene los scores para cada intent — usa el valor cacheado

El TTL de 60 segundos es un balance deliberado entre la frescura y el rendimiento. A escala, re-computar scores para cada intent desde los datos en vivo de `/info` del node sería prohibitivamente costoso.

---

## 6. Capa de API

### 6.1 Stack tecnológico

| Preocupación | Elección | Razón |
|---|---|---|
| Framework | Fastify 4 | 3× más rápido que Express. Validación nativa de JSON schema. Mejor sistema de plugins. |
| Base de datos | PostgreSQL 16 | JSONB para metadata. TIMESTAMPTZ nativo. Garantías ACID. |
| Cache | Redis 7 | Cacheado de scores. Rate limiting. Protección contra replay de x402. |
| Validación | Zod | Seguridad de tipos en runtime en todos los bordes de la API. |
| Auth | API key (Bearer) | Auth más simple viable para tooling de desarrolladores. |

### 6.2 Autenticación

Cada request de API (excepto health check) requiere un header `Authorization: Bearer <key>`.

Formatos de key:
```
pk_live_xxx   Public key — read-only (GET endpoints)
sk_live_xxx   Secret key — full access (POST, DELETE)
pk_test_xxx   Public key — testnet
sk_test_xxx   Secret key — testnet
```

Las keys se almacenan como hashes bcrypt en la tabla `api_keys`. La key en texto plano se devuelve una sola vez al momento de la creación y nunca se almacena. Si se pierde, la key debe ser regenerada.

### 6.3 Resumen del schema de la base de datos

```sql
merchants           -- merchant accounts, wallet addresses, routing prefs
api_keys            -- hashed API keys with prefix metadata
payment_intents     -- full intent lifecycle with status machine
webhook_endpoints   -- registered webhook URLs with event subscriptions
webhook_deliveries  -- delivery attempts, retry state, response codes
disputes            -- dispute lifecycle with IPFS evidence CIDs
x402_payments_used  -- tx_hash uniqueness table for replay protection
```

El schema completo está en `packages/api/src/lib/schema.sql`.

### 6.4 Rate limiting

El rate limiting se aplica globalmente por API key vía Redis:
- 100 requests por minuto para keys estándar
- Headers de límite devueltos en cada respuesta (`X-RateLimit-Remaining`, etc.)
- Las respuestas 429 incluyen el header `Retry-After`

### 6.5 Entrega de webhooks

Los webhooks se entregan con reintento de backoff exponencial:

```
Attempt 1:   immediate
Attempt 2:   30 seconds
Attempt 3:   5 minutes
Attempt 4:   30 minutes
Attempt 5:   2 hours
Attempt 6:   12 hours
After 6 failures: marked as failed, no more retries
```

Los payloads de webhook se firman con HMAC-SHA256:
```
Header: OpenRelay-Signature: t=<timestamp>,v1=<hmac_hex>
HMAC input: <timestamp>.<payload_json>
```

Los comercios verifican las firmas usando `relay.webhooks.verify(payload, signature, secret)`.

---

## 7. Node Daemon

### 7.1 Qué hace un node

Un node daemon es un servidor HTTP que:
1. Se registra on-chain en `NodeRegistry.sol` al iniciarse
2. Expone cuatro rutas: `/health`, `/info`, `/intents/assign`, `/intents/:id/settle`
3. Recibe asignaciones de intents del routing engine
4. Monitorea on-chain transferencias de USDC que coincidan con los intents asignados
5. Hace callback a la API cuando el settlement se confirma
6. Mantiene su propio store local de intents asignados para auditoría

### 7.2 Rutas del node en detalle

**`GET /health`** — invocada por el routing engine para scoring y liveness
```json
{
  "status": "ok",
  "version": "0.1.0",
  "operator": "0x...",
  "chains": ["base"],
  "capacity": 0.87
}
```
`capacity` es un float de 0–1 que representa el margen disponible de routing. Un node al máximo de capacidad debe devolver `capacity < 0.1` para ser excluido del routing.

**`GET /info`** — invocada por el routing engine para el cómputo del score
```json
{
  "operator": "0x...",
  "version": "0.1.0",
  "uptime_30d": 0.997,
  "avg_settlement_ms": 4200,
  "total_settled": 8432,
  "stake": "5000000000"
}
```
`stake` se devuelve como string para evitar problemas de precisión con BigInt de JavaScript.

**`POST /intents/assign`** — invocada por el routing engine al asignar un intent
```json
// Request
{
  "intent_id": "pi_xxx",
  "amount": 10000000,
  "currency": "usdc",
  "chain": "base",
  "merchant_address": "0x...",
  "expires_at": 1718000000
}

// Response (accept)
{
  "accepted": true,
  "payment_address": "0x...",   // unique per intent
  "node_fee": 4000              // fee this node will earn
}

// Response (reject)
{
  "accepted": false,
  "reason": "at_capacity"
}
```

**`POST /intents/:id/settle`** — invocada por el chain watcher del propio node
```json
// Request (from node's chain watcher to itself, then propagated to API)
{
  "tx_hash": "0x...",
  "block_number": 12345678,
  "settled_at": 1718000000
}
```

### 7.3 Autenticación de requests con HMAC

Todas las requests del routing engine a un node se autentican con HMAC-SHA256:

```
Headers required:
  X-OpenRelay-Signature: sha256=<hmac_hex>
  X-OpenRelay-Timestamp: <unix_timestamp>

HMAC input: <timestamp>.<request_body>
```

El node rechaza requests cuando:
- La firma no coincide
- El timestamp tiene más de 5 minutos (protección contra replay)

El secret HMAC se establece cuando el node se registra y se comparte con la capa de API. Se almacena en el entorno del node y nunca se transmite en texto plano.

### 7.4 Unicidad de la payment address

**Este es un requisito crítico de seguridad.** Cada intent debe tener una payment address única. Si el node reutiliza la dirección de wallet de su operator para todos los intents, se vuelve imposible hacer match de las transferencias on-chain a intents específicos — un payer malicioso podría enviar el monto equivocado y reclamar que pagó un intent diferente.

La implementación correcta usa derivación de HD wallet (BIP-32):
```
masterKey = deriveMasterKey(operatorPrivateKey)
intentAddress = deriveChild(masterKey, intentIndex)
```

Donde `intentIndex` es un contador monotónicamente incremental persistido en el store local del node. Esto genera una dirección única para cada intent mientras todos los fondos siguen controlados por la master key del operator.

---

## 8. Capa de SDK

### 8.1 Filosofía de diseño

El SDK está diseñado para sentirse idéntico al SDK de Stripe para los desarrolladores que han usado Stripe. Los mismos patrones: clases de recurso, async/await, verificación de webhooks, manejo de errores. El objetivo es cero fricción para la migración.

### 8.2 Flujo de request

```typescript
const relay = new OpenRelay({ apiKey: 'sk_live_xxx' })

// Creates a PaymentIntents resource instance
// All resource instances share the same HTTP client and config

await relay.paymentIntents.create(params)
// → POST https://api.openrelay.dev/v1/payment_intents
// → Authorization: Bearer sk_live_xxx
// → Content-Type: application/json
// → OpenRelay-Version: 0.1
```

### 8.3 Manejo de errores

```typescript
try {
  const intent = await relay.paymentIntents.create({ ... })
} catch (e) {
  if (e instanceof OpenRelaySDKError) {
    console.log(e.code)    // 'invalid_api_key'
    console.log(e.message) // 'Missing or malformed Authorization header.'
    console.log(e.doc_url) // 'https://docs.openrelay.dev/errors/invalid_api_key'
  }
}
```

Todos los errores de API son instancias de `OpenRelaySDKError`. Los errores de red (timeout, fallo de DNS) se re-lanzan como instancias estándar de `Error` — el SDK no se traga los fallos de red.

### 8.4 SDK para self-hosted vs. hosted

```typescript
// Self-hosted (points to your own API instance)
const relay = new OpenRelay({
  apiKey: 'sk_live_xxx',
  baseUrl: 'https://your-openrelay.example.com'
})

// Hosted network (default — uses OpenRelay's hosted API)
const relay = new OpenRelay({
  apiKey: 'sk_live_xxx'
  // baseUrl defaults to 'https://api.openrelay.dev'
})
```

---

## 9. Protocolo x402

### 9.1 Qué es x402

x402 es una implementación de HTTP 402 Payment Required para pagos máquina-a-máquina. Permite que cualquier servidor HTTP requiera un micropago antes de servir una respuesta, y que cualquier cliente HTTP (incluyendo agentes de IA) haga ese pago autónomamente.

Este es el primitivo de pago que hace posibles las economías de agentes de IA. Un agente que necesita datos de una API premium puede pagar por ellos sin intervención humana, tarjetas de crédito ni suscripciones.

### 9.2 El flujo HTTP de x402

```
Step 1 — Agent requests resource:
  GET /api/premium-data HTTP/1.1
  Host: merchant.example.com

Step 2 — Server responds with 402:
  HTTP/1.1 402 Payment Required
  Content-Type: application/json

  {
    "x402Version": 1,
    "accepts": [{
      "scheme": "exact",
      "network": "base",
      "maxAmountRequired": "1000",
      "resource": "https://merchant.example.com/api/premium-data",
      "description": "Premium data access",
      "mimeType": "application/json",
      "payTo": "0x...",              // merchant wallet on Base
      "maxTimeoutSeconds": 300,
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  // USDC
      "extra": { "name": "USDC", "version": "2" }
    }]
  }

Step 3 — Agent constructs and signs a USDC transfer on Base

Step 4 — Agent retries with payment proof:
  GET /api/premium-data HTTP/1.1
  Host: merchant.example.com
  X-PAYMENT: <base64_encoded_payment_payload>

Step 5 — Server verifies payment on-chain via OpenRelay API:
  POST /v1/x402/verify
  { "payment": "<X-PAYMENT value>", "amount": 1000, "chain": "base" }

Step 6 — Server serves the resource:
  HTTP/1.1 200 OK
  X-PAYMENT-RESPONSE: <verification_result>
  Content-Type: application/json

  { "data": "premium content" }
```

### 9.3 Protección contra replay

El endpoint de verificación de x402 almacena cada `tx_hash` verificado en la tabla de PostgreSQL `x402_payments_used`. Las requests subsecuentes con el mismo `tx_hash` se rechazan con `402 Payment Required` — el agente debe hacer un nuevo pago on-chain.

Esto también se cachea en Redis para rendimiento: la primera verificación escribe tanto en PostgreSQL como en Redis. Las verificaciones subsecuentes pegan a Redis primero. El TTL de Redis es de 24 horas (más largo que la ventana de finalidad de Base).

### 9.4 Umbrales de micropagos

Para pagos menores a $0.01 USDC (10,000 micro-unidades), la verificación directa on-chain se prefiere sobre el routing a través de un node. El overhead de asignación de node, routing y confirmación no se justifica para micropagos tan pequeños.

El SDK decide automáticamente:
```typescript
// amount < 10,000 → direct verification
// amount >= 10,000 → routed via node network
relay.x402.middleware({ price: 1000 })  // $0.001 → direct
relay.x402.middleware({ price: 50000 }) // $0.05  → routed
```

---

## 10. Ciclo de Vida de la Transacción

### 10.1 Flujo completo desde la llamada del SDK hasta el webhook

```
[Merchant code]
  relay.paymentIntents.create({ amount: 10_000_000, ... })
        │
        ▼
[POST /v1/payment_intents]   status: CREATED
  API validates request
  Generates ID: pi_xxx
  Stores in PostgreSQL
  Triggers routing engine async
        │
        ▼
[Routing Engine]              status: ROUTING
  Calls NodeRegistry.getActiveNodes() via viem
  Fetches /info from each active node
  Computes scores (or uses Redis cache)
  Applies hard filters
  Takes top 5 candidates
        │
        ▼
[Concurrent /intents/assign]  status: ROUTING → PENDING_PAYMENT
  5 concurrent HTTP requests to top candidate nodes
  First to respond with { accepted: true } wins
  Routing engine records: node_operator, payment_address
  Updates intent in PostgreSQL
  Returns payment_address to SDK caller
        │
        ▼
[SDK returns to merchant]
  intent.status = 'pending_payment'
  intent.payment_address = '0x...'   ← display this to payer
        │
        ▼ (payer action)
[Payer sends USDC on Base]
  USDC.transfer(payment_address, amount)
  OR: ERC-20 transferFrom via wallet UI
        │
        ▼
[Node's chain watcher detects transfer]  status: CONFIRMING
  Node monitors Base for transfers to its assigned payment_addresses
  Block confirmed (1 confirmation on Base)
  Node calls POST /intents/pi_xxx/settle
        │
        ▼
[API confirms settlement]     status: SETTLED
  Verifies tx_hash on Base via viem
  Updates intent status in PostgreSQL
  Calculates fee distribution:
    total_fee = amount × 0.0005
    node_fee = total_fee × 0.80
    treasury_fee = total_fee × 0.20
  Queues webhook delivery
        │
        ▼
[Webhook delivered to merchant]
  POST merchant's registered webhook URL
  Body: { id: 'evt_xxx', type: 'payment_intent.settled', data: { intent } }
  Signed with HMAC-SHA256
  Merchant fulfills order on verification
```

### 10.2 Transiciones de la máquina de estados (canónicas)

```
CREATED → ROUTING
  Triggered: immediately on creation
  Condition: routing engine invoked

ROUTING → PENDING_PAYMENT
  Triggered: node accepts assignment
  Condition: node responds { accepted: true }

ROUTING → CREATED (retry)
  Triggered: no nodes accept within 5 seconds
  Condition: all candidates rejected or timed out
  Behavior: SDK retries routing after 5s

PENDING_PAYMENT → CONFIRMING
  Triggered: on-chain transfer detected by node
  Condition: ≥1 Base confirmation

CONFIRMING → SETTLED
  Triggered: node calls /settle endpoint
  Condition: tx verification passes

CONFIRMING → FAILED
  Triggered: tx invalid or insufficient amount
  Condition: viem verification fails

Any state → EXPIRED
  Triggered: expires_at timestamp reached
  Condition: intent not in CONFIRMING or SETTLED

SETTLED → DISPUTED
  Triggered: merchant calls dispute endpoint
  Condition: within 7 days of settled_at
```

**Estas transiciones son exhaustivas y exclusivas.** No existe transición fuera de esta tabla. Cualquier código que intente una transición no listada debe ser tratado como un bug.

---

## 11. Modelo Económico

### 11.1 Flujo de fees por transacción

Para un pago de $100.00 USDC:

```
Payer sends:     $100.000000 USDC to payment_address

On-chain:        Payer → payment_address (node-controlled)
                 payment_address → merchant_wallet (automatic split)

Merchant receives: $99.950000 USDC
Node receives:     $00.040000 USDC (80% of 0.05% fee)
Treasury receives: $00.010000 USDC (20% of 0.05% fee)
```

Para un micropago x402 de $0.001 USDC:
```
Total fee:     $0.0000005 (0.05% of $0.001)
Node receives: $0.0000004
Treasury:      $0.0000001
```

A esta escala, los fees son despreciables — el caso de uso de micropago es económicamente viable precisamente porque el porcentaje de OpenRelay es pequeño y no hay fees mínimos.

### 11.2 Modelo de rentabilidad del node

Un node operator puede estimar las ganancias esperadas:

```
monthly_volume    = transactions_per_day × avg_amount × 30
monthly_gross_fee = monthly_volume × 0.0005
node_earnings     = monthly_gross_fee × 0.80

Example: 1,000 tx/day, avg $50
  monthly_volume    = $1,500,000
  monthly_gross_fee = $750
  node_earnings     = $600/month in USDC
```

Costos para un node básico:
```
VPS (2 vCPU, 2GB RAM):  ~$20/month
Minimum stake (100 USDC mainnet · 40 USDC testnet): one-time, recoverable
Base gas for registration: ~$0.005
```

El umbral de rentabilidad es aproximadamente 200 transacciones/mes a $10 en promedio — muy por debajo de lo que cualquier comercio activo generaría.

### 11.3 Modelo del treasury

El treasury acumula el 20% de todos los protocol fees de la red hospedada. Uso en Fase 1:
- Auditorías de seguridad (requeridas antes de mainnet)
- Bounties para contribuidores
- Costos de desarrollo core

En la Fase 3, la asignación del treasury será decidida por gobernanza on-chain. El balance actual del treasury será públicamente visible vía un dashboard.

### 11.4 Economía del self-hosted

Un comercio self-hosted paga:
- Cero protocol fees
- Costo de VPS (~$20–40/mes por API + node)
- Gas para interacciones con contratos (registro: ~$0.005 en Base)

Para comercios procesando >$5,000/mes, el self-hosting ahorra más que los costos de VPS dentro del primer mes.

---

## 12. Modelo de Seguridad

### 12.1 Modelo de amenazas por actor

**Node operator malicioso**

*Amenaza:* Enrutar un intent, recibir la payment_address, cobrar fondos que deberían ir al comercio.
*Mitigación:* Los fondos van del payer directamente a la wallet del comercio. La payment_address es una dirección controlada por el node solo para detectar la transferencia entrante — el node la reenvía inmediatamente al comercio menos el fee. Un node que no reenvía dispara una dispute y pierde stake. Críticamente: el node no puede enrutar a una dirección diferente — la `merchant_address` en la asignación del intent proviene de la capa de API, no del node.

*Amenaza:* Cobrar el fee de asignación, luego irse offline antes del settlement.
*Mitigación:* Timelock de retiro de stake de 7 días. El comercio puede abrir una dispute dentro de los 7 días. Las disputes sin respuesta disparan slashing automático vía `expireDispute()`.

**Ataque Sybil (muchos nodes falsos)**

*Amenaza:* Crear cientos de nodes de baja calidad para capturar volumen de routing.
*Mitigación:* El stake mínimo de 100 USDC por node hace los ataques Sybil costosos ($100 por node). Un node con stake mínimo tiene `stake_weight = 0.01` — necesitaría uptime y velocidad muy altos para competir con nodes bien stakeados. En 100 nodes falsos, el ataque cuesta $10,000 en USDC bloqueado.

**Compromiso de la key del comercio**

*Amenaza:* El atacante roba la secret API key del comercio y crea payment intents apuntando a su wallet.
*Mitigación:* La dirección del wallet del comercio se configura a nivel de cuenta, no por intent. Una API key comprometida no puede cambiar la wallet de destino — solo puede crear intents, ver historial y registrar webhooks. Los cambios de wallet requieren re-autenticación.

**Ataque de replay de x402**

*Amenaza:* Reutilizar un payment proof para múltiples llamadas a la API.
*Mitigación:* Cada `tx_hash` se almacena en `x402_payments_used` en el primer uso. Los intentos subsecuentes con el mismo `tx_hash` se rechazan. Redis cachea hashes recientes para rendimiento. PostgreSQL es el store durable.

**Compromiso de la key HMAC**

*Amenaza:* El atacante intercepta el secret HMAC del node y forja requests de routing.
*Mitigación:* Los secrets HMAC son por-node y rotables sin downtime. Una key comprometida afecta solo al node que la compartió. La rotación invalida todas las requests en vuelo firmadas con la key vieja (protección de ventana de 5 minutos).

**Double-spend**

*Amenaza:* El payer envía una transacción, luego intenta una reorganización de chain para revertirla.
*Mitigación:* Base requiere 1 confirmación antes de que se reconozca el settlement. La arquitectura L2 de Base hace que las reorganizaciones más allá de 1 bloque sean extremadamente improbables. Para transacciones de alto valor, los comercios pueden configurar requisitos de confirmación más altos.

### 12.2 Qué está explícitamente fuera de alcance

- **Gestión de keys del comercio** — responsabilidad del comercio
- **Seguridad del wallet del payer** — responsabilidad del payer
- **Cumplimiento KYC/AML** — responsabilidad del comercio bajo su jurisdicción
- **PCI DSS** — no aplica; no se procesan datos de tarjeta

### 12.3 Invariantes de smart contracts

Estas invariantes deben preservarse a través de todas las actualizaciones de contratos (despliegues) y pueden ser usadas por auditores para verificar la corrección:

1. `StakeManager.totalStaked() >= sum of all slashable amounts` — el contrato nunca crea balances negativos
2. `NodeRegistry.getActiveNodes()` nunca contiene una dirección con `active = false`
3. `DisputeResolver`: una dispute solo puede ser resuelta una vez (verificado vía `status != Resolved && status != Expired`)
4. `StakeManager`: un retiro no puede ser ejecutado antes de `unlockAt` (el timelock se aplica estrictamente)
5. `DisputeResolver`: un arbiter no puede votar dos veces en la misma dispute

### 12.4 Requisitos de auditoría

Los tres contratos requieren auditorías de seguridad completas antes del despliegue en Base mainnet:
- Análisis estático (Slither, Mythril)
- Revisión manual por al menos dos investigadores de seguridad independientes
- Fuzzing con forge test --fuzz-runs 10000
- Simulación de ataques económicos

Los reportes de auditoría serán publicados en `/audits` en el repositorio. La comunidad debe tratar cualquier despliegue en mainnet sin una auditoría publicada como no confiable.

---

## 13. Guía de Operación de Node

### 13.1 Requisitos mínimos

| Recurso | Mínimo | Recomendado para producción |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 512 MB | 2 GB |
| Almacenamiento | 10 GB SSD | 50 GB SSD |
| Red | 100 Mbps | 1 Gbps |
| SLA de Uptime | 99% | 99.9% |
| Stake de USDC | 100 USDC (mainnet) · 40 USDC (testnet) | 1,000+ USDC |
| RPC de Base | Público (rate limited) | Dedicado (Alchemy, QuickNode) |

### 13.2 Configuración desde cero

```bash
# 1. Clone the repository
git clone https://github.com/lacasoft/openrelay
cd openrelay

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env with:
#   NODE_OPERATOR_PRIVATE_KEY=your_wallet_private_key
#   NODE_ENDPOINT=https://your-node.example.com
#   NODE_HMAC_SECRET=random_secret_min_32_chars
#   BASE_RPC_URL=https://mainnet.base.org  (or dedicated RPC)
#   NODE_REGISTRY_ADDRESS=0x...  (from deployed contracts)
#   STAKE_MANAGER_ADDRESS=0x...

# 4. Approve USDC for staking
# Run from your wallet: USDC.approve(StakeManager, 100_000_000)

# 5. Register on-chain
# NodeRegistry.register("https://your-node.example.com", 100_000_000)

# 6. Start the node
pnpm --filter @openrelay/node start

# Or with Docker
docker run -p 4000:4000 --env-file .env ghcr.io/lacasoft/node:latest
```

### 13.3 Rotación de key HMAC

```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# 2. Update your node config (zero-downtime: both keys valid during rotation)
NODE_HMAC_SECRET=$NEW_SECRET

# 3. Notify the API layer (hosted) or update your self-hosted API
# The API layer will start signing with the new key
# Old requests (up to 5 minutes old) will still validate during transition

# 4. Restart node with new secret
```

### 13.4 Recomendaciones de monitoreo

Métricas a rastrear:
- `uptime_pct` — porcentaje de uptime rolling de 30 días
- `avg_settlement_ms` — tiempo promedio rolling de settlement
- `intents_assigned` — intents recibidos del routing engine
- `intents_settled` — intents confirmados exitosamente
- `intents_failed` — intents que no pudieron ser liquidados
- `disputes_open` — disputes abiertas actuales (debería ser 0)
- `stake_balance` — stake actual de USDC (alertar si se acerca al mínimo)

Alertas recomendadas:
- `uptime_pct < 0.99` — investigar inmediatamente (impacto en score)
- `disputes_open > 0` — responder dentro de 48 horas o perder la dispute
- `stake_balance < 200_000_000` (200 USDC) — recargar stake

### 13.5 Preparación de evidencia para disputes

Si un comercio abre una dispute contra tu node, tienes 48 horas para responder con contra-evidencia. Mantén logs de:
- Todas las asignaciones de intents (intent_id, amount, merchant_address, assigned_at)
- Todas las transacciones on-chain (tx_hash, block_number, settled_at, amount)
- Logs de uptime del node
- Cualquier log de error alrededor de la ventana de tiempo disputada

Empaqueta esto como un archivo JSON y súbelo a IPFS. El CID de IPFS es tu contra-evidencia.

---

## 14. Guía de Integración para Comercios

### 14.1 Self-hosted vs. hosted

| | Self-hosted | Red comunitaria |
|---|---|---|
| Tiempo de setup | 1–2 horas | 5 minutos |
| Costo mensual | ~$20–40 (VPS) | Fracciones de centavo por tx |
| Protocol fees | 0% | 0.05% |
| Carga de ops | Tu equipo gestiona la infra | Ninguna |
| Privacidad | Control total | Transacciones visibles on-chain |
| Recomendado para | >$50k/mes de volumen o requisitos de privacidad | Todos los demás |

### 14.2 Preferencias de routing

```typescript
// Merchants can configure routing via API key settings
{
  routing: {
    mode: 'auto',           // 'auto' | 'whitelist' | 'blacklist'
    node_whitelist: [],     // only use these node operators
    node_blacklist: [],     // never use these node operators
    min_stake: 500_000_000, // minimum 500 USDC stake
    min_score: 0.8,         // minimum node score
  }
}
```

### 14.3 Mejores prácticas de webhooks

```typescript
// Always verify webhook signatures
app.post('/webhooks/openrelay', express.raw({ type: 'application/json' }), (req, res) => {
  let event
  try {
    event = relay.webhooks.verify(
      req.body.toString(),
      req.headers['openrelay-signature'],
      process.env.WEBHOOK_SECRET
    )
  } catch (e) {
    // Invalid signature — reject immediately
    return res.status(400).send('Invalid signature')
  }

  // Idempotency: use event.id to deduplicate
  if (await db.eventProcessed(event.id)) {
    return res.status(200).send('Already processed')
  }

  // Process the event
  switch (event.type) {
    case 'payment_intent.settled':
      await fulfillOrder(event.data.metadata.orderId)
      break
    case 'payment_intent.failed':
      await notifyCustomer(event.data.metadata.orderId, 'payment_failed')
      break
    case 'dispute.opened':
      await alertMerchantTeam(event.data)
      break
  }

  // Respond quickly — process async if needed
  res.status(200).send('OK')
})
```

**Crítico:** OpenRelay reintenta los webhooks hasta 6 veces. Sin verificaciones de idempotencia, procesarás los eventos múltiples veces.

### 14.4 Integración con SPEI / Oxxo Pay (Fase 2)

Para comercios mexicanos que necesitan aceptar pagos en efectivo:

```
Customer with cash → Oxxo Pay cashier → USDC on Base → OpenRelay PaymentIntent
```

Esta integración convierte un pago físico en efectivo en una tienda Oxxo o una transferencia bancaria SPEI en USDC depositado a la payment_address. El cliente recibe un código de pago del checkout del comercio, paga en la caja de Oxxo, y el proveedor de on-ramp maneja el minteo de USDC en Base.

Este es el mecanismo que desbloquea el 80% de las transacciones mexicanas que siguen en efectivo — sin requerir que el cliente tenga un wallet de cripto.

---

## 15. Guía de Despliegue

### 15.1 Desarrollo local

```bash
# Full stack (API + Node + PostgreSQL + Redis)
docker compose -f infra/docker/docker-compose.yml up

# Individual packages in watch mode
pnpm --filter @openrelay/api dev
pnpm --filter @openrelay/node dev

# Smart contract development
cd packages/contracts
forge test -vvv
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
```

### 15.2 Despliegue en testnet (Base Sepolia)

El deploy de referencia en Base Sepolia ya está live (2026-04-18) — las direcciones canónicas están en `packages/contracts/deployments/sepolia.json`. Los pasos a continuación son para operadores que quieren su propio deploy independiente en Sepolia; para solo conectar un node/API al deploy existente, lee ese JSON directamente.

```bash
# 1. Get testnet USDC
# Bridge from Ethereum Sepolia or use a faucet

# 2. Configure deployment .env
DEPLOYER_PRIVATE_KEY=0x...
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # Base Sepolia USDC
TREASURY_ADDRESS=0x...
ARBITER_1=0x...
ARBITER_2=0x...
ARBITER_3=0x...
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# 3. Deploy contracts
cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify

# 4. Copy output contract addresses to root .env
NODE_REGISTRY_ADDRESS=0x...
STAKE_MANAGER_ADDRESS=0x...
DISPUTE_RESOLVER_ADDRESS=0x...

# 5. Start API and Node with testnet config
docker compose -f infra/docker/docker-compose.yml up
```

### 15.3 Despliegue en producción

Para despliegue en producción, consideraciones adicionales:

**Node daemon:**
- Correr detrás de nginx con TLS (Let's Encrypt)
- Usar un RPC dedicado de Base (Alchemy, QuickNode, o self-hosted)
- Configurar alertas para downtime y eventos de dispute
- Almacenar el secret HMAC en un secrets manager (no en archivo .env)

**Capa de API:**
- PostgreSQL con backups automatizados (diario mínimo)
- Redis con persistencia habilitada (AOF)
- Rate limiting ajustado al tráfico esperado
- API keys almacenadas como hashes bcrypt (nunca almacenar texto plano)

**Monitoreo:**
- Endpoint de health check monitoreado externamente (p. ej., UptimeRobot)
- Alertas en fallos de settlement y eventos de dispute
- Log de queries lentas de PostgreSQL habilitado

---

## 16. Análisis Comparativo

### 16.1 OpenRelay vs. Stripe

| | OpenRelay | Stripe |
|---|---|---|
| Fee por transacción | 0% (self-hosted) / 0.05% (red) | 2.9% + $0.30 |
| Transacción mínima | $0.000001 USDC | ~$0.50 (los fees hacen antieconómicas las menores) |
| Soporte de fiat | No | Sí (Visa, MC, ACH) |
| Soporte de cripto | USDC, BTC | Limitado |
| Self-hosteable | Sí | No |
| x402 (agentes de IA) | Nativo | No |
| Código abierto | Sí | No |
| Cobertura en México | Completa | Limitada (algunos productos) |
| Tiempo de setup | 1–2 horas | 30 minutos |
| Cumplimiento (KYC/AML) | Responsabilidad del comercio | Stripe lo maneja |

**Cuándo usar Stripe:** Cuando necesitas fiat (tarjetas de crédito, transferencias bancarias) o necesitas que alguien más maneje el cumplimiento. Stripe y OpenRelay son complementarios — muchos comercios deberían usar ambos.

**Cuándo usar OpenRelay:** Cuando aceptas cripto, necesitas cero fees, necesitas micropagos, estás construyendo infraestructura de agentes de IA, o estás en un mercado donde Stripe no llega.

### 16.2 OpenRelay vs. BTCPay Server

| | OpenRelay | BTCPay Server |
|---|---|---|
| Activo primario | USDC (stablecoin) | BTC |
| Soporte de x402 | Nativo | No |
| Red comunitaria | Sí (los node operators ganan fees) | No (solo self-hosted) |
| DX del SDK | Tipo Stripe | Más complejo |
| Enfoque en LATAM | Explícito | General |
| Lightning | Sí (Fase 1) | Sí (maduro) |
| Soporte de stablecoin | Foco principal | Secundario |

BTCPay Server es el precedente más cercano a OpenRelay. OpenRelay es esencialmente "BTCPay Server para USDC y la era de los agentes de IA."

### 16.3 OpenRelay vs. Alternativas institucionales (productos de BlackRock, CoinShares)

| | OpenRelay | Institucional |
|---|---|---|
| Propiedad | Comunidad / nadie | Accionistas |
| Fees | 0–0.05% | Por determinar (típicamente 0.5–2%) |
| Censurable | No (nodes sin permisos) | Sí (cumplimiento regulatorio) |
| Auditable | Totalmente (código abierto) | Parcialmente |
| Nativo para agentes de IA | Sí | No |
| Claridad regulatoria | Menor (problema del comercio) | Mayor (la institución maneja) |
| Modelo de confianza | Impuesto por el protocolo | Impuesto por la institución |

**El caso de coexistencia:** OpenRelay está posicionado para ser la capa de routing debajo de los productos institucionales, no para competir por clientes institucionales. Un banco desplegando un producto cripto de BlackRock necesita routing de pagos — OpenRelay puede proporcionar ese routing sin que la institución necesite controlar los rieles.

---

## 17. Invariantes y Garantías

Estas son las propiedades que OpenRelay garantiza a todos los participantes. Deben preservarse a través de todas las versiones, implementaciones y despliegues del protocolo.

### Para comercios

1. Los fondos recibidos en el wallet del comercio son tuyos — ninguna parte puede recuperarlos o congelarlos después del settlement
2. La ventana de dispute es siempre exactamente 7 días después del settlement — esto no puede ser acortado por ningún node o arbiter
3. Tu API key nunca se transmite en logs o mensajes de error — solo el prefijo de la key se almacena para identificación
4. Las firmas de webhook se computan sobre el payload exacto — cualquier modificación invalida la firma

### Para node operators

1. El stake solo puede ser slasheado por `DisputeResolver` — ningún otro contrato o dirección puede reducir tu stake
2. El timelock de retiro es exactamente 7 días — esto no puede ser extendido o acortado por ninguna parte
3. Una dispute que no es respondida en 48 horas resulta en slashing automático — no puedes evitarlo yéndote offline
4. Tu capacidad de routing se respeta — si devuelves `capacity < 0.1`, el routing engine no te asignará nuevos intents

### Para payers

1. Los pagos van al wallet del comercio — no a una cuenta custodia que podría ser congelada
2. Los pagos de x402 se verifican on-chain — un servidor no puede reclamar que el pago fue inválido para una transferencia on-chain confirmada

### Para el protocolo

1. No existe admin key que pueda pausar, actualizar o modificar los contratos desplegados
2. El fee split (80/20 node/treasury) está codificado en el protocolo y no puede cambiarse sin un nuevo despliegue
3. El stake mínimo (`minStake`) es una variable de estado ajustable por el guardian vía `NodeRegistry.updateMinStake()`, pero el contrato **rechaza reducciones** — solo incrementos. Esto permite que la red aumente la barrera anti-Sybil conforme madura (valor inicial: 100 USDC en mainnet, 40 USDC en Sepolia testnet) sin invalidar a operadores ya registrados.
4. Todos los registros de nodes son sin permisos — ningún comité de whitelist puede bloquear a un node de unirse

---

*Este documento refleja el estado de OpenRelay en v0.1. Se actualiza con cada decisión arquitectónica significativa.*

*Para preguntas, abre una discusión en GitHub. Para problemas de seguridad, envía un email a security@openrelay.dev.*

# Especificación del Protocolo OpenRelay

**Versión:** 0.1 (Borrador)
**Estado:** Trabajo en progreso
**Autores:** Contribuidores de OpenRelay

---

## Resumen

Este documento define el Protocolo OpenRelay — las reglas, estructuras de datos, formatos de mensajes y máquinas de estado que rigen cómo se crean, enrutan, liquidan y confirman los payment intents a través de la red OpenRelay.

Cualquier implementación que se ajuste a esta especificación es un node OpenRelay válido. Cualquier SDK que se ajuste a esta especificación puede enrutar a través de cualquier node compatible. La compatibilidad se define por este documento, no por ninguna implementación de referencia.

---

## Justificación del Diseño

Antes de la especificación técnica, esta sección documenta por qué el protocolo está diseñado como está. Cada decisión tiene una razón. Entender las razones ayuda a los contribuidores a realizar mejores cambios.

### Por qué los fondos nunca pasan por los nodes

La invariante de protocolo más importante. Los nodes son observadores y confirmadores — detectan transferencias on-chain y las confirman a la capa de API. Nunca retienen ni intermedian fondos.

Este diseño fue elegido porque elimina toda una clase de ataques: un node malicioso no puede robar fondos en tránsito, porque los fondos nunca están en tránsito a través del node. La superficie de ataque se limita a: (a) un node mintiendo sobre una liquidación que no ocurrió (detectado por dispute), o (b) un node quedándose offline después de la asignación (detectado por timelock + dispute).

Cualquier cambio de protocolo que haga pasar fondos a través de los nodes debe tratarse como una regresión crítica, no como una feature.

### Por qué contratos no actualizables

Los contratos actualizables (patrones proxy) le dan a alguien — inevitablemente al deployer o a un multisig — el poder de cambiar las reglas después del hecho. Ese poder es incompatible con el modelo de confianza de un protocolo comunitario.

Si un bug requiere corrección, la respuesta correcta es: (1) divulgarlo, (2) pausar la funcionalidad afectada mediante una decisión comunitaria, (3) desplegar nuevos contratos, (4) migrar con consentimiento comunitario. Esto es más lento que una actualización. También es confiable de una manera que las actualizaciones no lo son.

### Por qué nodes sin permisos (no una whitelist)

Un comité de whitelist es un vector de centralización. Quien controle la whitelist controla la red. En el contexto de la infraestructura de pagos de LATAM, una whitelist controlada por el equipo fundador podría ser presionada por reguladores, adquirida por una institución, o simplemente convertirse en un cuello de botella a medida que cambian las prioridades del equipo.

El registro sin permisos con incentivos económicos (stake, reputación, fees) logra el mismo filtrado de calidad sin centralización. Un node con mal comportamiento pierde el routing orgánicamente — sin necesidad de comité.

### Por qué USDC, no un token de protocolo

Un token de protocolo crea una capa de especulación sobre la capa de pagos. Cada decisión económica queda enredada con la dinámica del precio del token. Los contribuidores son incentivados a promover el token en lugar de construir el producto. Los usuarios se confunden sobre si están usando un sistema de pagos o un instrumento financiero.

USDC es aburrido. Es 1:1 con USD, redimible por Circle, y aceptado en todas partes. Los operadores de nodes ganan USDC aburrido. El treasury acumula USDC aburrido. Este es el tipo correcto de aburrimiento para la infraestructura de pagos.

### Por qué el fee split es 80/20 (node/treasury)

Los operadores de nodes hacen el trabajo — corren la infraestructura, mantienen el uptime, apuestan capital. Deberían recibir la mayoría de los fees. La asignación del 20% al treasury es el mínimo necesario para financiar el trabajo continuo del que los nodes se benefician colectivamente: auditorías, desarrollo de SDK, documentación, crecimiento comunitario.

Si la parte del treasury fuera mayor, los operadores tendrían menos incentivo para correr nodes. Si fuera cero, el proyecto no tendría financiamiento sostenible para bienes públicos. 80/20 es el equilibrio que mantiene viables a ambos lados.

### Por qué x402 es de primera clase, no un plugin

La economía de agentes de IA necesitará infraestructura de pagos. Esa infraestructura necesita funcionar a escala de micropagos ($0.001 por llamada a API), a velocidad de máquina (sin flujo de aprobación humana), y entre agentes autónomos. HTTP 402 es el protocolo natural para esto — es parte del estándar HTTP, disponible en cualquier lenguaje, y no requiere un nuevo protocolo de autenticación.

Hacer de x402 un plugin crearía un protocolo de dos niveles: pagos "reales" y "pagos de IA". No hay razón técnica ni económica para esta distinción. Ambos usan USDC en Base. Ambos usan la misma settlement layer. Construir x402 desde el inicio asegura que las integraciones de comercios sean compatibles con x402 por defecto.

---

## Tabla de Contenidos

1. [Terminología](#1-terminología)
2. [Participantes de la Red](#2-participantes-de-la-red)
3. [Settlement Layer](#3-settlement-layer)
4. [Protocolo On-Chain](#4-protocolo-on-chain)
5. [Ciclo de Vida del Payment Intent](#5-ciclo-de-vida-del-payment-intent)
6. [Protocolo de Node](#6-protocolo-de-node)
7. [Algoritmo de Routing](#7-algoritmo-de-routing)
8. [Extensión x402](#8-extensión-x402)
9. [Modelo de Seguridad](#9-modelo-de-seguridad)
10. [Códigos de Error](#10-códigos-de-error)
11. [Versionado](#11-versionado)

---

## 1. Terminología

| Término | Definición |
|---|---|
| **Merchant** | Una entidad que integra OpenRelay para recibir pagos |
| **Payer** | La entidad que inicia un pago (humano o agente de IA) |
| **Node** | Un servidor operado por la comunidad que facilita el routing de pagos |
| **Node Operator** | La entidad que corre y apuesta stake en un node |
| **Payment Intent** | Una intención declarada de pagar un monto específico, con un ciclo de vida definido |
| **Settlement** | La transferencia on-chain de fondos del payer al comercio |
| **Routing** | La selección de un node óptimo para facilitar un payment intent |
| **Stake** | USDC depositado por un node operator como colateral |
| **Score** | Una métrica de reputación pública y on-chain para un node |
| **Treasury** | El fondo controlado por el protocolo para desarrollo y bounties |
| **x402** | El protocolo de micropagos basado en HTTP 402 para pagos máquina-a-máquina |

---

## 2. Participantes de la Red

### 2.1 Comercios

Un comercio es cualquier entidad que haya desplegado la API de OpenRelay (self-hosted o vía la red hospedada) e integrado el SDK en su producto.

Los comercios tienen:
- Un merchant ID (`mid_xxx`) — globalmente único, asignado al registrarse
- Una o más API keys — `pk_live_xxx` (pública) y `sk_live_xxx` (secreta)
- Una dirección de wallet de destino por cada chain soportado
- Webhook endpoints registrados para la entrega de eventos

Los comercios interactúan con la red exclusivamente a través de la capa de API. No tienen comunicación directa a nivel de protocolo con los nodes.

### 2.2 Payers

Un payer es cualquier entidad que envía fondos para completar un payment intent. Los payers pueden ser:

- **Humano** — interactuando a través de una UI de checkout impulsada por el SDK
- **Agente** — un agente de IA autónomo usando la extensión x402 (ver Sección 8)

Los payers no tienen identidad persistente en el protocolo a menos que sea proporcionada explícitamente por el comercio a través de metadata.

### 2.3 Nodes

Un node es un servidor registrado on-chain que participa en el routing de pagos. Los nodes:

- Se registran vía `NodeRegistry.sol` con un depósito de USDC en stake
- Exponen una API HTTP compatible (ver Sección 6)
- Monitorean eventos de settlement on-chain
- Confirman la finalización del pago de vuelta a la capa de API
- **Nunca retienen ni custodian fondos en ningún momento**

Un node que no está registrado on-chain NO DEBE ser usado por el routing engine.

### 2.4 Bootstrap Nodes

Durante la Fase 1, el core team de OpenRelay opera un conjunto de bootstrap nodes. Estos nodes:

- Sirven como los objetivos iniciales de routing mientras la red crece
- Están registrados on-chain de manera idéntica a cualquier otro node — sin privilegios especiales
- Serán reemplazados progresivamente por nodes comunitarios a medida que se construya la reputación
- Serán retirados transparentemente en la Fase 3

Las direcciones de los bootstrap nodes se publican en el repositorio y son verificables on-chain.

---

## 3. Settlement Layer

### 3.1 Chains y Activos Soportados

| Chain | Activo | Chain ID | Estado |
|---|---|---|---|
| Base | USDC | 8453 | En vivo (Fase 1) |
| Lightning Network | BTC (sats) | — | En vivo (Fase 1) |
| Polygon | USDC | 137 | Planeado (Fase 2) |
| Solana | USDC | — | Planeado (Fase 2) |

Base + USDC es la settlement layer principal. Todos los protocol fees y stake están denominados en USDC en Base.

### 3.2 USDC en Base

```
USDC (Base mainnet):  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
USDC (Base Sepolia):  0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

Todos los montos en el protocolo están denominados en micro-unidades de USDC (6 decimales). `1,000,000` = $1.00 USDC.

### 3.3 Flujo de Fondos

**Los fondos fluyen directamente del payer al comercio. Los nodes nunca retienen fondos.**

```
Payer Wallet ──────────────────────────────► Merchant Wallet
                                                    ▲
Node (observa, confirma, gana fee de)     ──────────┘
                                        (fee deducido on-chain de la transferencia)
```

Fee split por transacción:
```
Monto = 1,000,000 (1.00 USDC)
Fee total = 500 (0.05% = 50 bps)
  └─ Parte del node (80%) = 400
  └─ Treasury (20%) = 100
El comercio recibe = 999,500
```

---

## 4. Protocolo On-Chain

Tres smart contracts en Base definen las reglas del protocolo. Todos los contratos son no actualizables. Sin admin keys. Sin funciones de pausa.

### 4.1 NodeRegistry.sol

**Responsabilidad:** Registro y descubrimiento de nodes.

```solidity
struct Node {
    address operator;       // wallet that controls the node
    string  endpoint;       // HTTPS URL of the node API
    uint256 registeredAt;   // block timestamp of registration
    bool    active;         // operator-controlled active flag
}

function register(string calldata endpoint, uint256 stakeAmount) external;
function updateEndpoint(string calldata endpoint) external;
function deactivate() external;
function activate() external;
function getNode(address operator) external view returns (Node memory);
function getActiveNodes() external view returns (address[] memory);
```

**Stake mínimo (`minStake`):** variable de estado en `NodeRegistry`, inicializada en el deploy.
- **Mainnet:** 100 USDC (100,000,000 micro-unidades) — valor anti-Sybil del protocolo
- **Sepolia testnet:** 40 USDC (40,000,000 micro-unidades) — inicial reducido para facilitar onboarding con faucets

El guardian puede aumentar `minStake` vía `NodeRegistry.updateMinStake(uint256)` conforme la red madura. El contrato **rechaza reducciones** — solo incrementos. Esto permite subir la barrera anti-Sybil sin comprometer a operadores ya registrados (su stake existente sigue válido).

### 4.2 StakeManager.sol

**Responsabilidad:** Depósitos de stake, retiros y slashing.

```solidity
struct StakeInfo {
    uint256 staked;
    uint256 pendingWithdrawal;
    uint256 unlockAt;
}

function depositFor(address operator, uint256 amount) external; // only NodeRegistry
function deposit(uint256 amount) external;
function requestWithdrawal(uint256 amount) external;
function executeWithdrawal() external;
function slash(address operator, uint256 amount, bytes32 disputeId) external; // only DisputeResolver
```

**Timelock de retiro:** 7 días. Igual a la ventana de dispute — crea un sistema cerrado donde un node no puede retirar antes de que se pueda resolver una dispute.

### 4.3 DisputeResolver.sol

**Responsabilidad:** Adjudicación de disputes y decisiones de slashing de stake.

```solidity
enum DisputeStatus  { Open, NodeResponded, Resolved, Expired }
enum DisputeOutcome { None, MerchantWins, NodeWins }

function openDispute(bytes32 paymentIntentId, address nodeOperator, string calldata evidenceCid) external;
function respondToDispute(bytes32 disputeId, string calldata counterEvidenceCid) external;
function vote(bytes32 disputeId, DisputeOutcome outcome) external; // only arbiters
function expireDispute(bytes32 disputeId) external; // anyone can call after 48h window
```

**Arbitraje de Fase 1:** Multisig 3-de-5 manejado por el core team. Migración comprometida a gobernanza on-chain en la Fase 3.

**Ventana de respuesta del node:** 48 horas desde `openedAt`. Después de esta ventana, cualquiera puede llamar `expireDispute()`, que auto-slashea al node.

---

## 5. Ciclo de Vida del Payment Intent

### 5.1 Estados

```
CREATED ──► ROUTING ──► PENDING_PAYMENT ──► CONFIRMING ──► SETTLED
                │                                │
                │                                └──► FAILED
                └──────────────────────────────────► EXPIRED
                                                      CANCELLED
                                                      DISPUTED
```

### 5.2 Objeto Payment Intent

```typescript
interface PaymentIntent {
  id:              string           // "pi_" + 24 random chars
  merchant_id:     string           // "mid_" + 16 chars
  amount:          number           // in asset micro-units
  currency:        "usdc" | "btc"
  chain:           "base" | "lightning" | "polygon" | "auto"
  status:          PaymentIntentStatus
  node_operator:   string | null    // assigned node wallet address
  payer_address:   string | null    // filled when payer initiates
  tx_hash:         string | null    // on-chain tx hash
  fee_amount:      number           // protocol fee charged
  metadata:        Record<string, string>  // max 20 keys
  created_at:      number           // unix timestamp
  expires_at:      number           // unix timestamp (default: +30 min)
  settled_at:      number | null
}
```

### 5.3 Reglas de Transición

**CREATED → ROUTING** — disparada inmediatamente al crearse.

**ROUTING → PENDING_PAYMENT** — el node responde con `{ accepted: true }`. El endpoint del node y la payment address se incrustan en el intent.

**ROUTING → CREATED (reintento)** — ningún node acepta dentro de 5 segundos. El SDK reintenta después de 5 segundos.

**PENDING_PAYMENT → CONFIRMING** — transacción on-chain que coincide con el monto del intent detectada. Base: se requiere 1 confirmación.

**CONFIRMING → SETTLED** — confirmaciones requeridas alcanzadas. El node llama al endpoint de settlement. Se dispara el webhook.

**Cualquiera → EXPIRED** — se alcanza el timestamp `expires_at` y el intent no está en CONFIRMING o SETTLED.

**SETTLED → DISPUTED** — el comercio llama al endpoint de dispute dentro de los 7 días posteriores a `settled_at`.

---

## 6. Protocolo de Node

Cada node DEBE exponer la siguiente API HTTP. Todos los endpoints usan JSON. Todas las requests del routing engine se autentican vía HMAC-SHA256.

### 6.1 Autenticación

```
X-OpenRelay-Signature: sha256=<hmac_hex>
X-OpenRelay-Timestamp: <unix_timestamp>

HMAC input: <timestamp>.<request_body>
Tolerance: 5 minutes
```

### 6.2 Endpoints Requeridos

```
GET  /health           → { status, version, operator, chains, capacity }
GET  /info             → { operator, version, uptime_30d, avg_settlement_ms, total_settled, stake }
POST /intents/assign   → { accepted, payment_address?, node_fee?, reason? }
POST /intents/:id/settle → { confirmed }
```

### 6.3 Requisitos de Comportamiento del Node

Un node conforme DEBE:
- Responder a `/health` dentro de 2 segundos
- Responder a `/intents/assign` dentro de 3 segundos
- Nunca usar la misma `payment_address` para múltiples intents concurrentes en el mismo chain
- Llamar a `/intents/:id/settle` dentro de 30 segundos de la confirmación on-chain
- Mantener logs de todos los intents asignados por un mínimo de 90 días
- Rechazar asignaciones de intent cuando esté al máximo de capacidad en lugar de aceptar y fallar

Un node conforme NO DEBE:
- Actuar como intermediario reteniendo fondos entre el payer y el comercio
- Modificar los montos o metadata de las transacciones
- Aceptar intents para chains no listados en su respuesta `/health`

---

## 7. Algoritmo de Routing

### 7.1 Score del Node

```
Score = (uptime_weight × 0.30) + (speed_weight × 0.30)
      + (stake_weight × 0.20) + (disputes_weight × 0.20)

uptime_weight   = uptime_30d (0.0–1.0)
speed_weight    = 1 - (avg_settlement_ms / 30000), min 0
stake_weight    = min(node_stake / 10_000_000_000, 1.0)
disputes_weight = disputes_won / max(disputes_total, 1)
```

Los scores se cachean en Redis, refrescados cada 60 segundos.

### 7.2 Filtros Duros

Aplicados antes del scoring. Los nodes que fallan cualquier filtro son excluidos sin importar el score:
- No registrado on-chain
- `active = false`
- No soporta el chain solicitado
- `capacity < 0.1`
- Round-trip a `/health` > 5 segundos
- Tiene una dispute abierta sin resolver
- No está en la whitelist del comercio (si está configurada)
- Está en la blacklist del comercio (si está configurada)
- Por debajo del stake/score mínimo del comercio (si está configurado)

### 7.3 Selección

1. Aplicar filtros duros
2. Ordenar los restantes por score (descendente)
3. Tomar los 5 primeros
4. Enviar requests `/intents/assign` concurrentes a los 5
5. Aceptar la primera respuesta `{ accepted: true }`
6. Cancelar las requests pendientes a los candidatos restantes

---

## 8. Extensión x402

### 8.1 Flujo

```
Agent: GET /api/resource
Server: 402 Payment Required + { x402Version, accepts: [{ amount, asset, payTo }] }
Agent: constructs + signs on-chain payment
Agent: GET /api/resource + X-PAYMENT: <base64_payload>
Server: verifies on-chain → serves resource + X-PAYMENT-RESPONSE
```

### 8.2 Middleware del SDK

```typescript
// Fastify
app.addHook('preHandler', relay.x402.middleware({
  price: 1000,        // $0.001 USDC
  currency: 'usdc',
  chain: 'base',
}))

// Next.js App Router
export const GET = relay.x402.handler({
  price: 1000,
  handler: async (req) => Response.json({ data: 'protected' })
})
```

### 8.3 Umbral de routing

- Pagos < $0.01 USDC (< 10,000 micro-unidades): verificación directa on-chain
- Pagos >= $0.01 USDC: enrutados vía la red de nodes

---

## 9. Modelo de Seguridad

| Amenaza | Mitigación |
|---|---|
| Node roba fondos | Los fondos nunca pasan por los nodes — siempre payer-a-comercio |
| Node enruta a dirección equivocada | La dirección del comercio proviene de la capa de API, no del node |
| Node cobra fee sin liquidar | Dispute + slashing de stake |
| Ataque Sybil | `minStake` de 100 USDC (mainnet) hace que Sybil sea costoso |
| Node exit scam | Timelock de retiro de 7 días |
| Double-spend | Se requiere confirmación on-chain antes de SETTLED |
| Replay de x402 | tx_hash almacenado en x402_payments_used después del primer uso |
| Compromiso de HMAC | Por-node, rotable; tolerancia de timestamp de 5 minutos |
| Requests obsoletas | Ventana de timestamp de 5 minutos en la verificación HMAC |

---

## 10. Códigos de Error

### Formato de Error de API

```json
{
  "error": {
    "code": "intent_expired",
    "message": "The payment intent has expired.",
    "param": null,
    "doc_url": "https://docs.openrelay.dev/errors/intent_expired"
  }
}
```

### Referencia de Códigos de Error

| Código | HTTP | Descripción |
|---|---|---|
| `invalid_api_key` | 401 | API key malformada o revocada |
| `insufficient_permissions` | 403 | Se requiere secret key |
| `intent_not_found` | 404 | El ID del payment intent no existe |
| `intent_expired` | 410 | El intent ha pasado `expires_at` |
| `intent_already_settled` | 409 | No se puede modificar un intent liquidado |
| `no_nodes_available` | 503 | Ningún node cumple con los criterios de routing |
| `chain_not_supported` | 400 | El chain solicitado no está activo |
| `amount_too_small` | 400 | Monto por debajo del mínimo del chain |
| `amount_too_large` | 400 | Monto excede la capacidad del node |
| `invalid_webhook_url` | 400 | URL del webhook no alcanzable |
| `dispute_window_closed` | 409 | Ventana de dispute de 7 días ha pasado |
| `node_not_registered` | 403 | Node no está en el registro on-chain |

---

## 11. Versionado

### Versionado del protocolo

`MAJOR.MINOR` — los cambios breaking aumentan MAJOR, las adiciones retrocompatibles aumentan MINOR.

Versión actual: `0.1`. La serie `0.x` permite cambios breaking con 30 días de aviso.

**Criterios para v1.0:**
1. Contratos auditados y desplegados en Base mainnet
2. Al menos 10 nodes comunitarios independientes activos
3. SDK utilizado en al menos un despliegue de comercio en producción

### Versionado de API

Prefijo de URL: `/v1/`. La nueva versión de API no se introducirá antes de la v1.0 del protocolo.

---

## Apéndice A — Eventos de Webhook

| Evento | Disparado Cuando |
|---|---|
| `payment_intent.created` | El intent es creado por primera vez |
| `payment_intent.pending` | Node asignado, esperando al payer |
| `payment_intent.confirming` | Tx on-chain detectada |
| `payment_intent.settled` | Confirmación completa alcanzada |
| `payment_intent.failed` | El settlement falló |
| `payment_intent.expired` | TTL alcanzado sin pago |
| `payment_intent.cancelled` | Cancelado antes del settlement |
| `dispute.opened` | El comercio abrió una dispute |
| `dispute.resolved` | Resultado de la dispute alcanzado |

---

## Apéndice B — Requisitos Mínimos del Node

| Recurso | Mínimo | Recomendado |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 512 MB | 2 GB |
| Disco | 10 GB SSD | 50 GB SSD |
| Red | 100 Mbps | 1 Gbps |
| SLA de Uptime | 99% | 99.9% |
| Stake USDC | 100 USDC (mainnet) · 40 USDC (testnet) | 1,000+ USDC |

---

*Este documento es una especificación viva. Los cambios se proponen vía GitHub issues con la etiqueta `spec`. Los cambios de protocolo requieren un RFC con un período de discusión mínimo de 7 días.*

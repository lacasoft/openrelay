# OpenRelay

## White Paper v0.1

**Red abierta de pagos para el mundo hispanohablante**

_Abril 2026_

---

## Resumen Ejecutivo

OpenRelay es una red de enrutamiento de pagos de código abierto. Cualquiera puede operar un nodeit, cualquier comercio puede recibir pagos en USDC con cero comisiones, y los desarrolladores tienen una experiencia similar a Stripe: SDK limpios, webhooks, payment intents.

Lo que ofrecemos:

- **Autoalojado:** 0% comisión, solo tu infraestructura (~$20/mes)
- **Red comunitaria:** 0.05% por transacción (vs 2.9%+ de Stripe)
- **Soporte x402 nativo:** micropagos para agentes de IA desde $0.001
- **SDK en TS, Python, PHP:** la misma DX que ya conoces

No hay token especulativo. No custodiamos fondos. Los pagos van directo de cliente a comercio.

---

## 1. Por qué existe OpenRelay

### 1.1 Pagos digitales en América Latina hoy

América Latina está en plena digitalización de pagos. México, Colombia, Chile, Argentina y Brasil tienen políticas activas para reducir el uso de efectivo. Esto es una oportunidad enorme para construir infraestructura abierta.

Pero hoy las opciones son limitadas:

| Solución | Problema |
|----------|----------|
| Stripe | 2.9% + $0.30, no llega a todo LATAM |
| Mercado Pago, Clip, Conekta | Comisiones similares, ecosistemas cerrados |
| BTCPay Server | Excelente pero solo BTC, sin red de nodeits, DX más pesada |

No existe una opción que sea todo esto a la vez:

- Código abierto
- Comisiones casi cero
- Fácil de integrar como Stripe
- Con una red comunitaria de nodeits
- Que hable español como ciudadano de primera clase

Esa es la razón de OpenRelay.

### 1.2 Para quién es esto

- **Comercios** que quieren dejar de pagar 3% por cada venta
- **Desarrolladores** que quieren integrar pagos en minutos, no semanas
- **Operadores de nodeit** que quieren ganar USDC enrutando transacciones
- **Proyectos de IA** que necesitan micropagos máquina→máquina
- **Comunidades crypto** que quieren participar en infraestructura real

No necesitas ser experto en blockchain. Si sabes usar Stripe, sabes usar OpenRelay.

---

## 2. Qué hace OpenRelay

> **Sobre la terminología:** El protocolo OpenRelay define una red de **nodos** — servidores que facilitan el enrutamiento de pagos entre cliente y comercio. **`nodeit`** es la implementación de referencia: el daemon open source que estoy desarrollando. Cualquier daemon compatible con el protocolo puede registrarse en el `NodeRegistry`; el mío se llama `nodeit`. En el resto de este documento uso **nodeit** cuando hablo de una instancia concreta del software de referencia, y reservo *nodo* para las especificaciones técnicas del protocolo (ver `PROTOCOL.md`).

### 2.1 Modelo de pagos

OpenRelay es una capa de enrutamiento. No es un banco, no es un gateway fiat, no custodia dinero.

```
Cliente → (paga USDC directo) → Comercio
              ↑
              │
         Nodeit OpenRelay
    (observa, confirma, cobra fee)
```

El nodeit nunca toca los fondos. Solo confirma que la transacción ocurrió y avisa al comercio via webhook.

### 2.2 Dos formas de usarlo

**Autoalojado (0% comisión)**

- Corres tu propio nodeit + API
- Costo: ~$20-40/mes de VPS
- Ideal si mueves >$5,000/mes

**Red comunitaria (0.05% comisión)**

- Usas los nodeits de otros operadores
- Pagas 50 centavos por cada $1,000
- Ideal para empezar sin operar infraestructura

### 2.3 Incentivos para operadores de nodeit

Cualquiera puede operar un nodeit. Solo necesitas:

1. Depositar el `minStake` on-chain (**100 USDC en mainnet · 40 USDC en Sepolia testnet**). El stake es recuperable vía `StakeManager.withdraw()` con timelock de 7 días. El guardian puede aumentar `minStake` conforme la red madura — nunca reducirlo — sin afectar a operadores ya registrados.
2. Correr el software en un VPS (~$20/mes)
3. Mantener buen uptime y velocidad

**Ganas:** 80% del fee de cada transacción que enrutas (el 0.04% de 0.05%).
Con $1.5M de volumen mensual → ~$600/mes en USDC.

No hay token. No hay mining. Solo trabajo real por pago real.

---

## 3. Arquitectura técnica

### 3.1 Capas

```
┌─────────────────────────────────────────┐
│  SDK (TypeScript, Python, PHP)          │
├─────────────────────────────────────────┤
│  REST API (Fastify + Postgres + Redis)  │
├─────────────────────────────────────────┤
│  Motor de routing y reputación          │
├─────────────────────────────────────────┤
│  Contratos on-chain (Base)              │
│  - NodeRegistry                         │
│  - StakeManager                         │
│  - DisputeResolver                      │
├─────────────────────────────────────────┤
│  Settlement (USDC en Base)              │
└─────────────────────────────────────────┘
```

### 3.2 Contratos inteligentes

Tres contratos en Base:

- **NodeRegistry:** registro público de nodeits, cualquiera se registra con stake ≥ `minStake` (100 USDC mainnet · 40 USDC testnet; ajustable por guardian, solo incrementos)
- **StakeManager:** depósitos, retiros con timelock 7 días, slashing por disputas
- **DisputeResolver:** si un nodeit no responde en 48 horas, pierde stake automático. Árbitros gestionados por multisig 3-de-5

Los tres contratos incluyen:
- Guardian con capacidad de pausa de emergencia (ver sección 5.2)
- Eventos para indexación off-chain
- Custom errors para optimización de gas

**Sobre el guardian:** diseños anteriores del protocolo planteaban contratos "sin llaves de admin, sin pausa". En la práctica, un exploit descubierto post-deploy sin mecanismo de pausa significa pérdida total de fondos para los afectados. Elegimos el compromiso pragmático: hay pausa de emergencia, pero está gobernada por un multisig 3-de-5 — nunca por una llave única. En Fase 3, el guardian migra a gobernanza on-chain.

### 3.3 Flujo de una transacción

```javascript
// 1. El comercio crea un PaymentIntent
const intent = await openrelay.paymentIntents.create({
  amount: 5000,  // 50.00 USDC
  currency: 'USDC',
  webhookUrl: 'https://micomercio.com/webhook'
})

// 2. El motor asigna los 5 mejores nodeits según score
//    (uptime, velocidad, stake, historial)

// 3. El cliente paga directo al wallet del comercio
//    (el nodeit nunca intercepta los fondos)

// 4. El nodeit detecta la confirmación on-chain via viem

// 5. Webhook al comercio: status = 'settled'

// 6. El nodeit cobra su fee (0.04%), el treasury recibe 0.01%
```

### 3.4 Sistema de scoring

Cada nodeit tiene un score público:

```
Score = (uptime_30d × 0.30)
      + (velocidad_settlement × 0.30)
      + (stake × 0.20)
      + (ratio_disputes_ganados × 0.20)
```

Un nodeit con mal comportamiento pierde tráfico orgánicamente — sin que nadie lo expulse. Un nodeit con excelente historial gana más tráfico y más fees.

### 3.5 x402 — Pagos para agentes de IA

HTTP 402 es un estándar para pagos máquina→máquina. Un agente IA paga $0.001 y recibe datos.

**Primera petición sin pago:**

```http
GET /api/datos HTTP/1.1
Host: api.ejemplo.com
```

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "amount": 1000,
  "asset": "USDC",
  "payTo": "0x742d35Cc...",
  "chain": "base"
}
```

**Segunda petición con prueba de pago:**

```http
GET /api/datos HTTP/1.1
Host: api.ejemplo.com
X-PAYMENT: eyJ0eF9oYXNoIjoiMHgxMjM0Li4uIiwiY2hhaW4iOiJiYXNlIn0=
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{ "data": "..." }
```

Stripe no puede hacer micropagos de $0.001 (el fee mínimo lo hace inviable). Nosotros sí.

---

## 4. Economía

### 4.1 Comisiones

| Modalidad | Fee | Quién paga |
|-----------|-----|------------|
| Autoalojado | 0% | — |
| Red comunitaria | 0.05% (50 bps) | Comercio |

Distribución del 0.05%:

- **80%** → operador del nodeit (USDC)
- **20%** → treasury del protocolo

### 4.2 Economía del operador

Los ingresos del operador escalan con el volumen de la red. Dos escenarios:

**Escenario realista — Fase 1 (red nueva)**

```
Volumen mensual  = 1 comercio mediano × $50,000
Fee total        = $50,000 × 0.0005 = $25
Ingreso del nodeit = $25 × 0.80 = $20/mes en USDC

Resultado: cubre el VPS, no te hace rico. Es un experimento.
```

**Escenario maduro — Fase 2+ (red con tracción)**

```
Volumen mensual  = 1,000 tx/día × $50 promedio × 30 días = $1,500,000
Fee total        = $1,500,000 × 0.0005 = $750
Ingreso del nodeit = $750 × 0.80 = $600/mes en USDC

Resultado: ingreso real, no sueldo completo.
```

**Costos fijos para cualquier operador:**

```
VPS (2 vCPU, 2GB RAM):   ~$20/mes
Stake (100 USDC mainnet):  único, recuperable con timelock 7 días
                           (Sepolia testnet: 40 USDC)
Gas de registro en Base:  ~$0.005 (una sola vez)
```

Ser operador en Fase 1 es una apuesta a largo plazo: si crees que la red crece, te posicionas temprano. Si no, al menos cubres costos desde el primer comercio.

### 4.3 Comparación real

Comercio que procesa $50,000/mes:

| Plataforma | Comisión mensual | Ahorro anual vs Stripe |
|-----------|-----------------|----------------------|
| Stripe | ~$1,480 | — |
| OpenRelay (red) | $25 | $17,460 |
| OpenRelay (auto) | $0 + $30 VPS | $17,400 |

### 4.4 Treasury

El 20% del fee se acumula en el treasury y financia:

- Auditorías de seguridad
- Desarrollo core y bounties
- Costos operativos iniciales

En Fase 3, el treasury se gestiona por gobernanza on-chain.

---

## 5. Seguridad

### 5.1 Modelo de amenazas

| Amenaza | Mitigación |
|---------|------------|
| Nodeit roba fondos | Imposible — los fondos nunca pasan por nodeits |
| Nodeit cobra sin liquidar | Disputa + slashing del stake |
| Ataque Sybil | Stake mínimo 100 USDC |
| Exit scam | Timelock 7 días para retirar stake |
| Replay de pagos x402 | Redis `SET NX` + hash de tx en DB |
| Double-spend | Confirmación on-chain requerida |
| Llave HMAC comprometida | Por-nodeit, rotable sin downtime |

### 5.2 Mecanismos de protección

- **Pausa de emergencia:** Guardian puede pausar contratos si se detecta un exploit
- **Multisig para gobernanza:** Agregar árbitros requiere 3-de-5 aprobaciones
- **HMAC-SHA256:** Comunicación API↔Nodeit firmada con ventana de 60 segundos
- **Replay atómico:** Redis `SET NX` previene doble uso de transacciones x402
- **Rate limiting:** 100 req/min por API key con Redis
- **SSRF protection:** URLs de webhooks validadas contra rangos IP privados
- **Non-custodial:** El protocolo nunca tiene acceso a fondos de merchants o clientes

### 5.3 Auditorías requeridas

Antes de mainnet:

1. Tres contratos inteligentes — firma independiente
2. Daemon del nodeit — revisión HMAC e implementación de llaves
3. API — penetration test de autenticación y webhooks

Los reportes se publicarán en el repositorio público.

---

## 6. Gobernanza

### 6.1 Por fases

| Fase | Periodo | Quién gobierna |
|------|---------|---------------|
| 1 | Meses 1-4 | Fundación + multisig del equipo core |
| 2 | Meses 4-10 | Red permissionless + disputas automáticas |
| 3 | Mes 10+ | Gobernanza on-chain, equipo core sale |

### 6.2 Lo que no haremos

- **No habrá token RELAY.** No ICO, no IDO, no "community sale". Los operadores ganan USDC, no tokens especulativos.
- **No habrá fees ocultos.** El 0.05% es público, auditado, on-chain.
- **No venderemos datos.** OpenRelay no monetiza datos de transacciones.

---

## 7. Estado actual y limitaciones

### 7.1 Qué funciona hoy (v0.1)

- Los tres contratos inteligentes con ~240+ tests (unit + fuzz) pasando
- **Deploy en Base Sepolia live** con contratos verificados en Basescan (ver `packages/contracts/deployments/sepolia.json`)
- SDK JS/Python/PHP publicables, con tests
- REST API completa (payment intents, webhooks, x402) con 60+ tests
- Daemon del nodeit con verificación on-chain real via viem
- Derivación HD wallet para direcciones de pago únicas por intent
- Webhook queue persistente en Redis (tolerante a crashes)
- Docker Compose levanta el stack completo en un comando
- CI/CD con typecheck, tests, security audit, coverage

### 7.2 Qué no funciona todavía

Seamos honestos:

- **Deploy en Base Sepolia completo (testnet)** — addresses en `packages/contracts/deployments/sepolia.json`. Mainnet aún no: está bloqueado por auditoría externa pendiente.
- **No hay auditoría externa.** Es requisito obligatorio antes de mainnet. Presupuestado contra el treasury de Fase 2.
- **Solo USDC en Base.** No hay BTC/Lightning, ni Polygon, ni Solana hasta Fase 2+.
- **Sin on-ramps fiat.** SPEI y Oxxo Pay son Fase 2. Hoy el merchant necesita que el cliente ya tenga USDC.
- **Dashboard de merchant es placeholder.** En Fase 1 se opera via SDK y CLI. UI web viene en Fase 2.
- **Red comunitaria no existe aún.** En Fase 1 corres tu propio nodeit. La red permissionless abre en Fase 2.
- **Routing engine incompleto.** El scoring está especificado pero en Fase 1 se usa un bootstrap node simple.

Si estás evaluando OpenRelay para producción hoy: es viable en modo autoalojado para comercios técnicos que quieran pagos USDC directos, no para un reemplazo de Stripe todavía.

---

## 8. Hoja de ruta

### Fase 1 — Fundación (meses 1-4)

- ✅ Contratos + tests en Foundry (~240+ tests, fuzz testing)
- ✅ SDK JavaScript, Python, PHP
- ✅ Docker Compose para deploy local
- ✅ Verificación on-chain de pagos via viem
- ✅ Derivación HD wallet para direcciones de pago
- ✅ CI/CD con GitHub Actions
- ✅ Auditoría interna de seguridad (ver [`docs/audits/2026-04-15-internal-snapshot.md`](docs/audits/2026-04-15-internal-snapshot.md); auditoría externa pendiente antes de mainnet)
- ✅ Deploy en Base Sepolia — última versión 2026-04-21 con los 4 roles (deployer, treasury, guardian, operator) en wallets separadas. Ver [`packages/contracts/deployments/sepolia.json`](packages/contracts/deployments/sepolia.json) para el historial completo.
- ✅ Primer bootstrap node registrado on-chain y operativo en producción (Fly.io) — `https://nodeit.openrelay.site`
- ✅ Repositorio público en GitHub bajo `lacasoft/openrelay`
- 🔄 Primer comercio en producción (autoalojado)

### Fase 2 — Red (meses 4-10)

- Registro permissionless de nodeits en Base mainnet
- Motor de routing con reputación on-chain
- Plugin WooCommerce
- Dashboard de comercio (Next.js)
- Primeros nodeits comunitarios (México, España, Argentina)
- Integración SPEI / Oxxo Pay (efectivo → USDC)
- Lightning Network (BTC)

### Fase 3 — Ecosistema (meses 10-18)

- Multi-chain (Polygon, Solana)
- SDK Go para agentes IA
- Gobernanza on-chain
- Treasury autosustentable

### Criterios para v1.0

1. Auditoría completa desplegada en Base mainnet
2. ≥10 nodeits comunitarios independientes activos
3. SDK en producción en al menos un comercio real

---

## 9. Cómo participar

### Desarrolladores

```bash
git clone https://github.com/lacasoft/openrelay
cd openrelay
docker-compose up
```

### Comercios

```javascript
import { OpenRelay } from '@openrelay/sdk'

const client = new OpenRelay({ apiKey: 'sk_test_...' })
const intent = await client.paymentIntents.create({
  amount: 2500,  // 25.00 USDC
  currency: 'USDC'
})
```

### Operadores de nodeit

```bash
# Registrar nodeit on-chain (stake >= minStake: 100 USDC mainnet · 40 USDC testnet)
# Correr el daemon
npm run node:start
```

### Comunidad

- **Discord:** discusiones técnicas y soporte
- **GitHub:** issues y PRs
- **Traducciones** de documentación
- **Grupos locales** en LATAM y España

---

## Apéndice A — Stack técnico

| Componente | Tecnología | Razón |
|-----------|-----------|-------|
| Monorepo | Turborepo + pnpm | Estándar actual, cache de CI |
| Lenguaje | TypeScript 5.5 strict | Seguridad de tipos end-to-end |
| API | Fastify 4 | 3× más rápido que Express |
| Base de datos | PostgreSQL 16 | JSONB, ACID, probado en producción |
| Cache | Redis 7 | Rate limiting, replay protection |
| Blockchain | viem 2 | Type-safe, estándar para Base/EVM |
| Contratos | Solidity 0.8.25 + Foundry | Mejor DX de testing |
| Chain | Base (USDC) | Fees sub-centavo, ecosistema x402 |
| Linter | Biome | Linting y formato en una herramienta |
| Validación | Zod | Runtime type safety |
| Tests | Vitest + Foundry | Cobertura TS y Solidity |
| CI/CD | GitHub Actions | PR validation + releases |
| Contenedores | Docker + Compose | Deploy en un comando |

---

## Apéndice B — Constantes del protocolo

```
PROTOCOL_VERSION         = "0.1"
USDC_BASE_ADDRESS        = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
USDC_DECIMALS            = 6
minStake (mainnet)       = 100,000,000   (100 USDC) — initial value at deploy
minStake (Sepolia)       =  40,000,000   ( 40 USDC) — initial value at deploy
                           adjustable by guardian via NodeRegistry.updateMinStake(),
                           increase-only (never reduced).
PROTOCOL_FEE_BPS         = 50            (0.05%)
NODE_FEE_SHARE           = 0.80          (80% al nodeit)
TREASURY_FEE_SHARE       = 0.20          (20% al treasury)
DEFAULT_INTENT_TTL       = 1800          (30 minutos)
DISPUTE_WINDOW_DAYS      = 7
STAKE_WITHDRAWAL_DAYS    = 7
ROUTING_CANDIDATES       = 5
BASE_CONFIRMATIONS       = 1
NODE_RESPONSE_WINDOW     = 48 horas
SCORE_CACHE_TTL          = 60 segundos
```

---

## Apéndice C — Glosario

**Payment Intent** — La unidad fundamental de OpenRelay. Representa una intención de pago con un ciclo de vida definido: `created → routing → pending_payment → confirming → settled`.

**Nodo** — Concepto del protocolo: servidor registrado on-chain que facilita el enrutamiento de pagos. Observa transacciones y confirma settlements. Nunca custodia fondos. Ver `PROTOCOL.md` para la especificación técnica.

**Nodeit** — La implementación de referencia de un nodo OpenRelay. El daemon open source distribuido por este proyecto. Cualquier daemon compatible con el protocolo puede actuar como nodo; nuestro daemon se llama `nodeit` (ver `packages/node/` en el repo).

**Stake** — USDC depositado por un operador de nodeit como garantía económica de buen comportamiento.

**Slashing** — Reducción forzada del stake como consecuencia de perder un dispute.

**Score** — Métricas de reputación computadas públicamente (uptime, velocidad, stake, historial).

**x402** — Protocolo HTTP 402 Payment Required para pagos máquina-a-máquina entre agentes de IA.

**Settlement** — Confirmación on-chain de que los fondos llegaron al wallet del merchant.

**Treasury** — Fondo del protocolo (20% de fees) que financia desarrollo y auditorías.

**USDC** — USD Coin, stablecoin 1:1 con USD emitida por Circle. Asset de settlement primario.

---

## Contacto y recursos

| Recurso | Enlace |
|---------|--------|
| Repositorio | github.com/lacasoft/openrelay |
| Documentación | docs.openrelay.dev |
| Discord | discord.openrelay.dev |
| SDK npm | @openrelay/sdk |
| Protocolo x402 | x402.org |
| Seguridad | lacasoft.proyectos@gmail.com |

---

_Apache License 2.0 — construido por la comunidad, para el mundo hispanohablante y más allá._

_v0.1 — Abril 2026_

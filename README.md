# OpenRelay

**La red abierta de pagos. Sin comisiones. Sin intermediarios. Construida para LATAM y el mundo hispanohablante.**

OpenRelay es una red de enrutamiento de pagos de código abierto, operada por la comunidad. Ofrece a los desarrolladores la misma experiencia que Stripe — SDK limpio, webhooks, payment intents, dashboard de comercio — sin el 2.9% + $0.30 por transacción. Sin pedirle permiso a nadie. Sin una empresa en medio.

Si corres tu propio nodo, no cuesta nada. Si usas la red comunitaria, pagas fracciones de centavo.

---

## 🚀 Estado actual

✅ **Contratos desplegados en Base Sepolia** (testnet) desde 2026-04-18.
Código fuente verificado en Basescan · `minStake` inicial: 40 USDC.

| Contrato | Dirección |
|----------|-----------|
| `NodeRegistry` | [`0x15e742142CB23E6f5c1B20aAE13CDd49E6b68565`](https://sepolia.basescan.org/address/0x15e742142CB23E6f5c1B20aAE13CDd49E6b68565#code) |
| `StakeManager` | [`0xBbcE040401e4612337799bABCeE7860a9A0fcA84`](https://sepolia.basescan.org/address/0xBbcE040401e4612337799bABCeE7860a9A0fcA84#code) |
| `DisputeResolver` | [`0xb8d6D150D2567644D404b6Bd46c81cc749c0926D`](https://sepolia.basescan.org/address/0xb8d6D150D2567644D404b6Bd46c81cc749c0926D#code) |

Fuente canónica de direcciones (para SDKs y dashboards):
[`packages/contracts/deployments/sepolia.json`](packages/contracts/deployments/sepolia.json).

🔜 Auditoría externa y deploy a mainnet pendientes.

---

## Qué es OpenRelay

- Un protocolo de enrutamiento de pagos con nodos operados por la comunidad
- Un SDK compatible con Stripe para JavaScript, Python y PHP
- Soporte nativo para x402 — micropagos para agentes de IA
- Un stack autoalojable con Docker Compose en un solo comando
- USDC en Base como capa primaria de settlement, Lightning Network para BTC
- Una capa de smart contracts para registro de nodos, staking y resolución de disputas
- Documentación, comunidad y soporte en español e inglés

## Qué no es OpenRelay

- **Un banco** — Los fondos van directo del pagador al comercio. OpenRelay nunca custodia dinero.
- **Un gateway fiat** — No Visa, Mastercard ni ACH. Stripe cubre fiat; usa los dos si los necesitas.
- **Un proyecto de token** — No hay token RELAY. Los operadores de nodo ganan USDC. Sin especulación.
- **Una alternativa universal a Stripe** — Es una capa de enrutamiento USDC abierta. Úsala junto con las herramientas que ya conoces.

---

## Cómo funciona

```
Comercio integra el SDK
        │
        ▼
Se crea el PaymentIntent → El motor de routing selecciona el mejor nodo
        │                   (top 5 por score, ejecución concurrente)
        ▼
El pagador envía USDC directo al wallet del comercio en Base
        │              (el nodo NUNCA custodia fondos)
        ▼
El nodo confirma el settlement on-chain → Se dispara el webhook
        │
        ▼
Reputación del nodo actualizada on-chain. Comisión distribuida automáticamente.
```

Los operadores de nodo depositan stake en USDC para unirse. El stake es su garantía económica. Buen enrutamiento construye reputación. Mal enrutamiento pierde stake. Ningún comité decide quién participa — lo hace el protocolo.

---

## Quick Start

**Autoalojado — cero comisiones**

```bash
git clone https://github.com/lacasoft/openrelay
cd openrelay
cp .env.example .env        # agrega tu BASE_RPC_URL y wallet
docker compose -f infra/docker/docker-compose.yml up
```

**Integración con el SDK**

```typescript
import { OpenRelay } from '@openrelay/sdk'

const relay = new OpenRelay({ apiKey: 'sk_live_xxx' })

// Crear un pago — la misma DX que Stripe
const intent = await relay.paymentIntents.create({
  amount: 10_000_000,   // $10.00 USDC (6 decimales = 1 USDC)
  currency: 'usdc',
  chain: 'base',
  metadata: { orderId: 'order_123' }
})

// Handler del webhook
app.post('/webhooks', (req) => {
  const event = relay.webhooks.verify(
    req.body,
    req.headers['openrelay-signature'],
    webhookSecret
  )
  if (event.type === 'payment_intent.settled') {
    fulfillOrder(event.data.metadata.orderId)
  }
})
```

**x402 — pagos para agentes de IA**

```typescript
// Protege cualquier endpoint con un micropago — 3 líneas
app.addHook('preHandler', relay.x402.middleware({
  price: 1000,        // $0.001 USDC por request
  currency: 'usdc',
  chain: 'base',
}))
```

Cualquier cliente HTTP que hable x402 — incluyendo agentes de IA usando MCP — puede pagar y consumir tu endpoint de forma autónoma. Stripe no puede soportar transacciones de $0.001. OpenRelay sí.

---

## Arquitectura

Cinco capas con separación estricta de responsabilidades:

| Capa | Responsabilidad | Tecnología |
|---|---|---|
| **Settlement** | Movimiento de fondos on-chain | Base (USDC), Lightning Network |
| **Protocolo** | Reglas de nodo, stake, disputas | Solidity + Foundry en Base |
| **Routing** | Descubrimiento y selección de nodos | Daemon en TypeScript |
| **API** | Interfaz del comercio | Fastify + PostgreSQL + Redis |
| **SDK** | Experiencia del desarrollador | TypeScript · Python · PHP |

Los smart contracts incluyen pausa de emergencia gobernada por multisig 3-de-5 — no por una llave única. En Fase 3, el guardian migra a gobernanza on-chain. Lo que se audita es lo que corre.

→ Arquitectura completa y deep-dive técnico: [INFRASTRUCTURE.md](./INFRASTRUCTURE.md)
→ Especificación del protocolo: [PROTOCOL.md](./PROTOCOL.md)

---

## Correr un nodo

Cualquiera puede correr un nodo. Sin whitelist. Sin aplicación.

Requisitos: depositar 100 USDC de stake on-chain, exponer un endpoint HTTPS, mantener buen uptime. La reputación se computa públicamente. Los nodos malos pierden tráfico de forma natural. Los operadores de nodo ganan el 80% de la comisión del protocolo (0.05%) por cada transacción que enrutan, en USDC, on-chain.

Correr un nodo es una forma concreta de participar en la infraestructura. Cada nodo comunitario es una pieza más de una red que nadie controla en solitario.

→ [INFRASTRUCTURE.md — Operación de nodo](./INFRASTRUCTURE.md#node-operation)

---

## Mercados iniciales

**México** — Mercado de lanzamiento. Transición digital activa y demanda real de comercios que buscan alternativas a las comisiones tradicionales. On-ramp SPEI + Oxxo Pay planeado para Fase 2.

**España** — Segundo mercado. Ecosistema de desarrolladores crypto establecido. Puente natural del corredor Europa–LATAM.

**LATAM** — Argentina, Colombia, Chile y más en Fase 2.

---

## Hoja de ruta

| Fase | Periodo | Entregables clave |
|---|---|---|
| **Fase 1 — Fundación** | Meses 1–4 | Deploy en Base Sepolia · SDK JS · Primer comercio · Primer nodo |
| **Fase 2 — Red** | Meses 4–10 | Nodos permissionless · SDK Python y PHP · Lightning · WooCommerce · On-ramp SPEI |
| **Fase 3 — Ecosistema** | Meses 10–18 | Multi-chain · SDK Go · Gobernanza on-chain · Treasury autosustentable |

→ Hoja de ruta completa con milestones: [ROADMAP.md](./ROADMAP.md)

---

## Cómo contribuir

Las contribuciones en español son tan bienvenidas como las contribuciones en inglés. Issues, PRs, documentación y discusión comunitaria pueden ser en cualquiera de los dos idiomas.

- **Escribe código** — bugs, features, SDKs, plugins
- **Corre un nodo** — haz crecer la red, gana comisiones en USDC
- **Escribe documentación** — español, inglés, portugués
- **Audita** — los smart contracts necesitan más ojos
- **Difunde** — en comunidades de desarrolladores de LATAM y España

→ [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## Gobernanza

Mantenido por la OpenRelay Foundation. Los cambios al protocolo pasan por RFCs públicas. El treasury (20% de las comisiones de la red alojada) financia desarrollo, auditorías y bounties. Los reportes financieros son públicos.

---

## Seguridad

Auditoría externa requerida antes del deploy en mainnet. Los reportes se publicarán en `/audits`.
Vulnerabilidades: **security@openrelay.dev** — divulgación responsable con bounties.

---

## Licencia

[Apache License 2.0](./LICENSE) — úsalo, modifícalo, autoaloja, construye sobre él comercialmente.

---

## Enlaces

| Recurso | URL |
|---|---|
| Documentación | docs.openrelay.dev |
| Dashboard alojado | app.openrelay.dev |
| GitHub | github.com/lacasoft |
| Discord | discord.openrelay.dev |
| SDK npm | @openrelay/sdk |
| Especificación x402 | x402.org |
| Seguridad | security@openrelay.dev |

---

*Construido por la comunidad. Para LATAM, España y el mundo hispanohablante. Para todos.*

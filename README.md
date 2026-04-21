# OpenRelay

**La red abierta de pagos. Sin comisiones. Sin intermediarios. Construida para LATAM y el mundo hispanohablante.**

OpenRelay es una red de enrutamiento de pagos de código abierto, operada por la comunidad. Ofrece a los desarrolladores la misma experiencia que Stripe — SDK limpio, webhooks, payment intents, dashboard de comercio — sin el 2.9% + $0.30 por transacción. Sin pedirle permiso a nadie. Sin una empresa en medio.

Si corres tu propio nodo, no cuesta nada. Si usas la red comunitaria, pagas fracciones de centavo.

---

## 🚀 Estado actual

✅ **Contratos desplegados en Base Sepolia** (testnet) — redeploy 2026-04-21 con
**separación de roles** (deployer, treasury, guardian y node operator en wallets distintas).
Código fuente verificado en Basescan · `minStake` inicial: 40 USDC en testnet
(100 USDC en mainnet; ajustable por guardian, solo incrementos).

| Contrato | Dirección |
|----------|-----------|
| `NodeRegistry` | [`0x2dFdF6151d6BF0156D28976F23823d3f1f9CB106`](https://sepolia.basescan.org/address/0x2dFdF6151d6BF0156D28976F23823d3f1f9CB106#code) |
| `StakeManager` | [`0xFf4e68652BC8C6b8de18a79C4D2FDDe0c9C9F517`](https://sepolia.basescan.org/address/0xFf4e68652BC8C6b8de18a79C4D2FDDe0c9C9F517#code) |
| `DisputeResolver` | [`0xAAB6E368767707e562Fb09dB2432F9a691B9915a`](https://sepolia.basescan.org/address/0xAAB6E368767707e562Fb09dB2432F9a691B9915a#code) |

**Roles (wallets separadas):**

| Rol | Wallet | Responsabilidad |
|---|---|---|
| Treasury | [`0x05CD...8261`](https://sepolia.basescan.org/address/0x05CDED242AFC9D7e60eC3049bD8bDccbbA078261) | Recibe 20% de fees + stake slashado (**inmutable**) |
| Guardian | [`0xbB51...7Ddf`](https://sepolia.basescan.org/address/0xbB514Eca8f39d0A3B8092B323282304709d17Ddf) | Pausa de emergencia + `updateMinStake()` (rotable) |
| Node Operator (bootstrap) | [`0xf73e...5da4`](https://sepolia.basescan.org/address/0xf73e2E5a4493d8a4C28e6f88c14a396C82395da4) | Stakea USDC + firma HMAC del daemon |

✅ **Primer nodo bootstrap registrado on-chain** desde 2026-04-21 (bloque 40522829).
Operado por el equipo core durante Fase 1 con el operator wallet **separado del deployer**.

| Campo | Valor |
|---|---|
| Operator | [`0xf73e...5da4`](https://sepolia.basescan.org/address/0xf73e2E5a4493d8a4C28e6f88c14a396C82395da4) |
| Endpoint | `https://nodeit.openrelay.site` |
| Stake | 40 USDC (bloqueados on-chain) |
| Tx de registro | [`0x399c...93ca`](https://sepolia.basescan.org/tx/0x399c077b7cdd19e99658ca69790ca985304be65b2fcc7cbe0aec8b54608893ca) |

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

Requisitos: depositar el `minStake` on-chain (100 USDC en mainnet · 40 USDC en testnet Sepolia; ajustable por guardian, solo incrementos), exponer un endpoint HTTPS, mantener buen uptime. La reputación se computa públicamente. Los nodos malos pierden tráfico de forma natural. Los operadores de nodo ganan el 80% de la comisión del protocolo (0.05%) por cada transacción que enrutan, en USDC, on-chain.

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
| **Fase 1 — Fundación** | Meses 1–4 | ✅ Deploy en Base Sepolia · ✅ SDK JS · ✅ Primer nodo registrado · Primer comercio |
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

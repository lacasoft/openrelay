# OpenRelay — Guía de Setup

## Levantar el stack completo con un solo comando

```bash
# 1. Clona el repositorio
git clone https://github.com/lacasoft/openrelay
cd openrelay

# 2. Copia la configuración
cp .env.example .env

# 3. Levanta todo
docker compose up -d

# 4. Crea el primer merchant y API keys
make seed
```

Eso es todo. El stack levanta:
- **PostgreSQL 16** en `localhost:5432`
- **Redis 7** en `localhost:6379`
- **OpenRelay API** en `http://localhost:3000`
- **OpenRelay Node** en `http://localhost:4000`

---

## Verificar que todo funciona

```bash
# Estado de los servicios
make status

# Health del API
curl http://localhost:3000/health

# Health del nodo
curl http://localhost:4000/health

# Crear un payment intent de prueba (reemplaza con tu sk_test del seed)
curl -X POST http://localhost:3000/v1/payment_intents \
  -H "Authorization: Bearer sk_test_xxx" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000000, "currency": "usdc", "chain": "base", "metadata": {"order_id": "test-001"}}'
```

---

## Comandos útiles

```bash
make up          # Levanta el stack
make down        # Baja el stack
make seed        # Crea merchant + API keys (solo primera vez)
make logs        # Ver logs de todo
make logs-api    # Ver logs del API
make logs-node   # Ver logs del nodo
make status      # Estado y health checks
make restart     # Reiniciar servicios
make clean       # Borrar todo y empezar de nuevo ⚠️

# Desarrollo
make dev-api     # API en modo watch
make dev-node    # Nodo en modo watch
make test        # Tests TypeScript
make contracts   # Compilar + testear contratos Solidity

# Deploy en Base Sepolia
make deploy-testnet  # (requiere .env configurado)
```

---

## Configuración para producción

Edita tu `.env` y cambia al menos:

```bash
# ⚠️ Cambia SIEMPRE en producción
API_SECRET=genera-un-secreto-aleatorio-de-min-32-chars
NODE_HMAC_SECRET=otro-secreto-aleatorio-de-min-32-chars

# Usa un RPC dedicado (Alchemy, QuickNode)
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/TU_API_KEY

# Tu wallet real para recibir pagos
MERCHANT_WALLET=0xTU_WALLET_ADDRESS

# URL pública de tu nodo (necesita ser accesible desde internet)
NODE_ENDPOINT=https://node.tudominio.com
```

---

## Flujo completo con el SDK

```typescript
import { OpenRelay } from '@openrelay/sdk'

// Usa la sk_live que generó make seed
const relay = new OpenRelay({ apiKey: 'sk_live_xxx' })

// 1. Crear payment intent
const intent = await relay.paymentIntents.create({
  amount:   10_000_000,  // $10.00 USDC
  currency: 'usdc',
  chain:    'base',
  metadata: { orderId: 'order-123' }
})

console.log('Dirección de pago:', intent.payer_address)
// → El cliente envía USDC a esta dirección en Base

// 2. Verificar el pago vía webhook
app.post('/webhooks/openrelay', (req) => {
  const event = relay.webhooks.verify(
    req.body,
    req.headers['openrelay-signature'],
    'tu-webhook-secret'
  )

  if (event.type === 'payment_intent.settled') {
    console.log('✅ Pago confirmado:', event.data.id)
    fulfillOrder(event.data.metadata.orderId)
  }
})
```

---

## x402 para agentes de IA

```typescript
import Fastify from 'fastify'
import { OpenRelay } from '@openrelay/sdk'

const app   = Fastify()
const relay = new OpenRelay({ apiKey: 'sk_live_xxx' })

// Protege cualquier endpoint con un micropago
app.addHook('preHandler', relay.x402.middleware({
  price:       1000,    // $0.001 USDC por request
  currency:    'usdc',
  chain:       'base',
  description: 'Acceso a datos premium',
}))

app.get('/api/datos-premium', async () => {
  return { data: 'Datos que cuestan $0.001 por llamada' }
})

// Cualquier agente de IA que entienda x402 puede pagar y acceder
```

---

## Resolver problemas comunes

**"make seed: exec api node dist/scripts/seed.js: No such file"**
El API todavía está compilando. Espera 30 segundos y vuelve a intentar.

```bash
make logs-api  # Ver si el build terminó
make seed      # Volver a intentar
```

**"connection refused" en PostgreSQL**
El healthcheck no pasó. Espera y revisa los logs:

```bash
make logs-db
```

**Node registra 0x000... como operador**
Esperado en desarrollo local. Para un nodo real en testnet, configura `NODE_OPERATOR_ADDRESS` y `NODE_OPERATOR_PRIVATE_KEY` en `.env` con una wallet real de Base Sepolia.

---

## Estructura del proyecto

```
openrelay/
├── docker-compose.yml     ← stack completo
├── Makefile               ← todos los comandos
├── .env.example           ← copia a .env
├── packages/
│   ├── protocol/          ← tipos compartidos
│   ├── contracts/         ← contratos Solidity (Foundry)
│   ├── api/               ← REST API (Fastify + PostgreSQL)
│   ├── node/              ← daemon del nodo (SQLite local)
│   ├── sdk-js/            ← @openrelay/sdk (npm)
│   ├── sdk-python/        ← openrelay (PyPI)
│   └── sdk-php/           ← openrelay/openrelay (Packagist)
└── infra/docker/          ← Dockerfiles
```

---

Docs completos: [docs.openrelay.dev](https://docs.openrelay.dev)
Discord: [discord.openrelay.dev](https://discord.openrelay.dev)

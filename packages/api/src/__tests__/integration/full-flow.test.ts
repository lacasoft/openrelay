import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { createHash, timingSafeEqual } from 'node:crypto'

// ── Global mocks ──────────────────────────────────────────────────

const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) })
vi.stubGlobal('fetch', mockFetch)

// Mock auth middleware
vi.mock('../../middleware/auth', () => ({
  authenticate: vi.fn(async (req: any, reply: any) => {
    const mode = req.headers['x-test-auth-mode'] as string | undefined
    if (mode === 'sk') {
      req.merchantId = 'merchant_integ'
      req.merchantWallet = '0xIntegWallet'
      req.apiKeyPrefix = 'sk_live_'
      req.isSecretKey = true
    } else if (mode === 'pk') {
      req.merchantId = 'merchant_integ'
      req.merchantWallet = '0xIntegWallet'
      req.apiKeyPrefix = 'pk_live_'
      req.isSecretKey = false
    } else {
      return reply.status(401).send({ error: { code: 'invalid_api_key', message: 'Unauthorized' } })
    }
  }),
  requireSecretKey: vi.fn(async (req: any, reply: any) => {
    if (!req.isSecretKey) {
      return reply.status(403).send({
        error: { code: 'insufficient_permissions', message: 'Secret key required.' },
      })
    }
  }),
}))

// Mock repository
const mockIntentStore: Record<string, any> = {}
const mockWebhookStore: Record<string, any> = {}

vi.mock('../../lib/repository', () => ({
  findMerchantByApiKey: vi.fn(),
  insertPaymentIntent: vi.fn(async (_db: any, intent: any) => {
    mockIntentStore[intent.id] = intent
  }),
  getPaymentIntent: vi.fn(async (_db: any, id: string, merchantId: string) => {
    const intent = mockIntentStore[id]
    if (intent && intent.merchant_id === merchantId) return intent
    return null
  }),
  updatePaymentIntentStatus: vi.fn(async (_db: any, id: string, status: string, extra?: any) => {
    if (mockIntentStore[id]) {
      mockIntentStore[id].status = status
      if (extra) Object.assign(mockIntentStore[id], extra)
    }
  }),
  listPaymentIntents: vi.fn(async (_db: any, merchantId: string, limit: number, _startingAfter?: string) => {
    const intents = Object.values(mockIntentStore)
      .filter((i: any) => i.merchant_id === merchantId)
      .slice(0, limit)
    return { data: intents, has_more: intents.length >= limit }
  }),
  insertWebhookEndpoint: vi.fn(async (_db: any, params: any) => {
    mockWebhookStore[params.id] = params
  }),
  listWebhookEndpoints: vi.fn(async (_db: any, merchantId: string) => {
    return Object.values(mockWebhookStore)
      .filter((w: any) => w.merchant_id === merchantId && !w.deleted_at)
      .map((w: any) => ({ id: w.id, url: w.url, events: w.events }))
  }),
  markX402TxUsed: vi.fn(async (_db: any, txHash: string) => {
    return true // first time always succeeds
  }),
  getActiveWebhooksForEvent: vi.fn(),
}))

// Mock SSRF check
vi.mock('../../lib/ssrf', () => ({
  isPrivateUrl: vi.fn((url: string) => {
    return url.includes('localhost') || url.includes('127.0.0.1')
  }),
}))

// Mock chain module
vi.mock('../../lib/chain', () => ({
  createChainClient: vi.fn(() => ({})),
  verifyUsdcTransfer: vi.fn(async () => ({ valid: true })),
}))

// Mock errors
vi.mock('../../lib/errors', () => ({
  apiError: (code: string, message: string, param: string | null = null) => ({
    error: { code, message, param, doc_url: `https://docs.openrelay.dev/errors/${code}` },
  }),
}))

import { paymentIntentsRoute } from '../../routes/payment-intents.js'
import { webhooksRoute } from '../../routes/webhooks.js'
import { x402Route } from '../../routes/x402.js'
import { internalRoute } from '../../routes/internal.js'

// ── App setup ─────────────────────────────────────────────────────

let app: FastifyInstance

const mockConfig = {
  port: 3000,
  databaseUrl: 'postgresql://localhost/test',
  redisUrl: 'redis://localhost:6379',
  apiSecret: 'openrelay-dev-secret',
  corsOrigin: ['http://localhost:3000'],
  baseRpcUrl: 'https://sepolia.base.org',
  nodeRegistryAddress: '0x0000000000000000000000000000000000000000',
  stakeManagerAddress: '0x0000000000000000000000000000000000000000',
  disputeResolverAddress: '0x0000000000000000000000000000000000000000',
  usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
}

const mockRedis = {
  ping:   vi.fn().mockResolvedValue('PONG'),
  exists: vi.fn().mockResolvedValue(0),
  setex:  vi.fn().mockResolvedValue('OK'),
  set:    vi.fn().mockResolvedValue('OK'), // default: not-already-used (SET NX returns 'OK' on success)
  quit:   vi.fn(),
}

beforeAll(async () => {
  app = Fastify({ logger: false })

  // Mock db as a tagged template function
  const mockDb: any = vi.fn(async () => [])
  mockDb.end = vi.fn()

  app.decorate('db', mockDb)
  app.decorate('redis', mockRedis as any)
  app.decorate('config', mockConfig as any)

  app.register(paymentIntentsRoute, { prefix: '/v1' })
  app.register(webhooksRoute, { prefix: '/v1' })
  app.register(x402Route, { prefix: '/v1' })
  app.register(internalRoute, { prefix: '/v1' })

  // Health endpoint
  app.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    services: { postgres: true, redis: true },
  }))

  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  // Clear stores
  Object.keys(mockIntentStore).forEach(k => delete mockIntentStore[k])
  Object.keys(mockWebhookStore).forEach(k => delete mockWebhookStore[k])
  vi.clearAllMocks()
  mockFetch.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) })
})

function skHeaders() {
  return { 'x-test-auth-mode': 'sk' }
}

function pkHeaders() {
  return { 'x-test-auth-mode': 'pk' }
}

// ── Full payment intent flow ──────────────────────────────────────

describe('Full payment intent flow', () => {
  it('should create a payment intent and verify it is in "created" status', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: { amount: 50000, currency: 'usdc', chain: 'base' },
    })

    expect(createRes.statusCode).toBe(201)
    const created = createRes.json()
    expect(created.id).toMatch(/^pi_/)
    expect(created.status).toBe('created')
    expect(created.amount).toBe(50000)
    expect(created.merchant_id).toBe('merchant_integ')
  })

  it('should retrieve a created payment intent by ID', async () => {
    // Create first
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: { amount: 25000, currency: 'usdc', chain: 'base' },
    })
    const created = createRes.json()

    // Retrieve
    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/payment_intents/${created.id}`,
      headers: skHeaders(),
    })

    expect(getRes.statusCode).toBe(200)
    const retrieved = getRes.json()
    expect(retrieved.id).toBe(created.id)
    expect(retrieved.amount).toBe(25000)
  })

  it('should list payment intents with pagination', async () => {
    // Create two intents
    await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: { amount: 1000, currency: 'usdc', chain: 'base' },
    })
    await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: { amount: 2000, currency: 'usdc', chain: 'base' },
    })

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/payment_intents?limit=10',
      headers: skHeaders(),
    })

    expect(listRes.statusCode).toBe(200)
    const body = listRes.json()
    expect(body.data).toBeInstanceOf(Array)
    expect(body.data.length).toBe(2)
  })

  it('should cancel a payment intent', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: { amount: 3000, currency: 'usdc', chain: 'base' },
    })
    const created = createRes.json()

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/v1/payment_intents/${created.id}/cancel`,
      headers: skHeaders(),
    })

    expect(cancelRes.statusCode).toBe(200)
    const cancelled = cancelRes.json()
    expect(cancelled.status).toBe('cancelled')
  })
})

// ── Webhook endpoint CRUD ─────────────────────────────────────────

describe('Webhook endpoint CRUD', () => {
  it('should create a webhook endpoint', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: skHeaders(),
      payload: {
        url: 'https://example.com/webhooks',
        events: ['payment_intent.settled'],
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.id).toMatch(/^we_/)
    expect(body.url).toBe('https://example.com/webhooks')
    expect(body.events).toContain('payment_intent.settled')
    expect(body.secret).toMatch(/^whsec_/)
  })

  it('should list webhook endpoints', async () => {
    // Create one first
    await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: skHeaders(),
      payload: {
        url: 'https://example.com/hook1',
        events: ['payment_intent.settled'],
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/v1/webhooks',
      headers: skHeaders(),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toBeInstanceOf(Array)
    expect(body.data.length).toBeGreaterThanOrEqual(1)
  })

  it('should delete a webhook endpoint', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: skHeaders(),
      payload: {
        url: 'https://example.com/hook-delete',
        events: ['payment_intent.created'],
      },
    })
    const created = createRes.json()

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/webhooks/${created.id}`,
      headers: skHeaders(),
    })

    expect(deleteRes.statusCode).toBe(204)
  })

  it('should reject webhook creation with private URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: skHeaders(),
      payload: {
        url: 'http://localhost:8080/hook',
        events: ['payment_intent.settled'],
      },
    })

    // Zod refine rejects private URLs
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })
})

// ── x402 payment flow ─────────────────────────────────────────────

describe('x402 payment flow', () => {
  it('should verify a valid x402 payment', async () => {
    const paymentPayload = Buffer.from(JSON.stringify({
      tx_hash: '0xabc123',
      amount: 1000,
      asset: 'usdc',
      network: 'base',
    })).toString('base64')

    mockRedis.exists.mockResolvedValueOnce(0)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      headers: skHeaders(),
      payload: {
        payment: paymentPayload,
        amount: 1000,
        chain: 'base',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.verified).toBe(true)
    expect(body.tx_hash).toBe('0xabc123')
  })

  it('should reject invalid payment payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      headers: skHeaders(),
      payload: {
        payment: 'not-valid-base64!!!',
        amount: 1000,
        chain: 'base',
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe('invalid_payment_payload')
  })

  it('should reject insufficient payment', async () => {
    const paymentPayload = Buffer.from(JSON.stringify({
      tx_hash: '0xinsufficient',
      amount: 500,
      asset: 'usdc',
      network: 'base',
    })).toString('base64')

    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      headers: skHeaders(),
      payload: {
        payment: paymentPayload,
        amount: 1000,
        chain: 'base',
      },
    })

    expect(res.statusCode).toBe(402)
    const body = res.json()
    expect(body.error.code).toBe('insufficient_payment')
  })

  it('should reject already-used payment via Redis', async () => {
    const paymentPayload = Buffer.from(JSON.stringify({
      tx_hash: '0xreplay',
      amount: 1000,
      asset: 'usdc',
      network: 'base',
    })).toString('base64')

    // Atomic SET NX returns null if key already exists — simulates replay
    mockRedis.set.mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/x402/verify',
      headers: skHeaders(),
      payload: {
        payment: paymentPayload,
        amount: 1000,
        chain: 'base',
      },
    })

    expect(res.statusCode).toBe(409)
    const body = res.json()
    expect(body.error.code).toBe('x402_replay')
  })
})

// ── Internal settlement endpoint ──────────────────────────────────

describe('Internal settlement endpoint', () => {
  it('should reject requests without valid internal secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/internal/settle/pi_test123',
      payload: {
        tx_hash: '0xsettled',
        block_number: 1000,
        settled_at: Math.floor(Date.now() / 1000),
      },
    })

    expect(res.statusCode).toBe(403)
    const body = res.json()
    expect(body.error.code).toBe('forbidden')
  })
})

// ── Health endpoint ───────────────────────────────────────────────

describe('Health endpoint', () => {
  it('should return proper JSON with status and version', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('ok')
    expect(body.version).toBe('0.1.0')
    expect(body.services).toHaveProperty('postgres')
    expect(body.services).toHaveProperty('redis')
  })
})

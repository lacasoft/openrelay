import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'

// Mock fetch globally to prevent triggerRouting from making real HTTP requests
const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) })
vi.stubGlobal('fetch', mockFetch)

// Mock the auth middleware to avoid the sync preHandler issue with Fastify inject
vi.mock('../../middleware/auth', () => ({
  authenticate: vi.fn(async (req: any, _reply: any) => {
    // Simulate authentication by reading from a test header
    const mode = req.headers['x-test-auth-mode'] as string | undefined
    if (mode === 'sk') {
      req.merchantId = 'merchant_test'
      req.merchantWallet = '0xWalletAddr'
      req.apiKeyPrefix = 'sk_live_'
      req.isSecretKey = true
    } else if (mode === 'pk') {
      req.merchantId = 'merchant_test'
      req.merchantWallet = '0xWalletAddr'
      req.apiKeyPrefix = 'pk_live_'
      req.isSecretKey = false
    } else {
      return _reply.status(401).send({ error: { code: 'invalid_api_key', message: 'Unauthorized' } })
    }
  }),
  requireSecretKey: vi.fn(async (req: any, reply: any) => {
    if (!req.isSecretKey) {
      return reply.status(403).send({
        error: {
          code: 'insufficient_permissions',
          message: 'This action requires a secret API key (sk_live_xxx).',
          param: null,
          doc_url: 'https://docs.openrelay.dev/errors/insufficient_permissions',
        },
      })
    }
  }),
}))

// Mock the repository module
vi.mock('../../lib/repository', () => ({
  findMerchantByApiKey: vi.fn(),
  insertPaymentIntent: vi.fn(),
  getPaymentIntent: vi.fn(),
  updatePaymentIntentStatus: vi.fn(),
  listPaymentIntents: vi.fn(),
}))

import { paymentIntentsRoute } from '../../routes/payment-intents.js'
import {
  insertPaymentIntent,
  getPaymentIntent,
  updatePaymentIntentStatus,
  listPaymentIntents,
} from '../../lib/repository.js'

const mockedInsert = vi.mocked(insertPaymentIntent)
const mockedGet = vi.mocked(getPaymentIntent)
const mockedUpdate = vi.mocked(updatePaymentIntentStatus)
const mockedList = vi.mocked(listPaymentIntents)

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  app.decorate('db', {} as any)
  app.decorate('redis', {} as any)
  app.register(paymentIntentsRoute, { prefix: '/v1' })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) })
})

// Helper: inject with sk auth
function skHeaders() {
  return { 'x-test-auth-mode': 'sk' }
}

// Helper: inject with pk auth
function pkHeaders() {
  return { 'x-test-auth-mode': 'pk' }
}

describe('POST /v1/payment_intents', () => {
  it('should create a payment intent with valid body and sk_ key', async () => {
    mockedInsert.mockResolvedValueOnce(undefined)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: {
        amount: 1000,
        currency: 'usdc',
        chain: 'base',
        metadata: { orderId: 'order_123' },
      },
    })

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.id).toMatch(/^pi_/)
    expect(body.amount).toBe(1000)
    expect(body.currency).toBe('usdc')
    expect(body.chain).toBe('base')
    expect(body.status).toBe('created')
    expect(body.merchant_id).toBe('merchant_test')
    expect(body.metadata).toEqual({ orderId: 'order_123' })
    expect(body.fee_amount).toBeGreaterThan(0)
    expect(body.node_operator).toBeNull()
    expect(body.payer_address).toBeNull()
    expect(body.tx_hash).toBeNull()
    expect(body.settled_at).toBeNull()
  })

  it('should compute fee_amount based on PROTOCOL_FEE_BPS (50 bps = 0.5%)', async () => {
    mockedInsert.mockResolvedValueOnce(undefined)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: { amount: 10000, currency: 'usdc', chain: 'base' },
    })

    const body = response.json()
    // PROTOCOL_FEE_BPS = 50, so fee = floor(10000 * 50/10000) = floor(50) = 50
    expect(body.fee_amount).toBe(50)
  })

  it('should return 401 without authorization header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      payload: { amount: 1000, currency: 'usdc', chain: 'base' },
    })

    expect(response.statusCode).toBe(401)
  })

  it('should return 403 when using a public key (pk_live_)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: pkHeaders(),
      payload: { amount: 1000, currency: 'usdc', chain: 'base' },
    })

    expect(response.statusCode).toBe(403)
    const body = response.json()
    expect(body.error.code).toBe('insufficient_permissions')
  })

  it('should return error for invalid currency', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: { amount: 1000, currency: 'eth', chain: 'base' },
    })

    // zod parse error => unhandled => 500
    expect(response.statusCode).toBe(500)
  })

  it('should return error for negative amount', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: { amount: -100, currency: 'usdc', chain: 'base' },
    })

    // Zod will reject negative amount (z.number().int().positive())
    expect(response.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('should return error for zero amount', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: { amount: 0, currency: 'usdc', chain: 'base' },
    })

    expect(response.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('should return error when amount is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: { currency: 'usdc', chain: 'base' },
    })

    expect(response.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('should default expires_in to DEFAULT_INTENT_TTL_SECONDS (1800)', async () => {
    mockedInsert.mockResolvedValueOnce(undefined)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: { amount: 1000, currency: 'usdc', chain: 'base' },
    })

    const body = response.json()
    expect(body.expires_at - body.created_at).toBe(1800)
  })

  it('should accept custom expires_in', async () => {
    mockedInsert.mockResolvedValueOnce(undefined)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: { amount: 1000, currency: 'usdc', chain: 'base', expires_in: 3600 },
    })

    const body = response.json()
    expect(body.expires_at - body.created_at).toBe(3600)
  })

  it('should default metadata to empty object', async () => {
    mockedInsert.mockResolvedValueOnce(undefined)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: { amount: 1000, currency: 'usdc', chain: 'base' },
    })

    const body = response.json()
    expect(body.metadata).toEqual({})
  })

  it('should accept chain="auto"', async () => {
    mockedInsert.mockResolvedValueOnce(undefined)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents',
      headers: skHeaders(),
      payload: { amount: 1000, currency: 'usdc', chain: 'auto' },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().chain).toBe('auto')
  })
})

describe('GET /v1/payment_intents/:id', () => {
  it('should retrieve a payment intent by id', async () => {
    const mockIntent = {
      id: 'pi_existing123',
      merchant_id: 'merchant_test',
      amount: 5000,
      currency: 'usdc' as const,
      chain: 'base' as const,
      status: 'created' as const,
      node_operator: null,
      payer_address: null,
      tx_hash: null,
      fee_amount: 25,
      metadata: {},
      created_at: 1700000000,
      expires_at: 1700001800,
      settled_at: null,
    }
    mockedGet.mockResolvedValueOnce(mockIntent)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/payment_intents/pi_existing123',
      headers: skHeaders(),
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.id).toBe('pi_existing123')
    expect(body.amount).toBe(5000)
  })

  it('should return 404 for non-existent payment intent', async () => {
    mockedGet.mockResolvedValueOnce(null)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/payment_intents/pi_nonexistent',
      headers: skHeaders(),
    })

    expect(response.statusCode).toBe(404)
    const body = response.json()
    expect(body.error.code).toBe('intent_not_found')
    expect(body.error.param).toBe('id')
  })

  it('should work with public key (pk_live_) for read-only access', async () => {
    mockedGet.mockResolvedValueOnce({
      id: 'pi_read_test',
      merchant_id: 'merchant_test',
      amount: 2000,
      currency: 'usdc',
      chain: 'base',
      status: 'pending_payment',
      node_operator: null,
      payer_address: null,
      tx_hash: null,
      fee_amount: 10,
      metadata: {},
      created_at: 1700000000,
      expires_at: 1700001800,
      settled_at: null,
    })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/payment_intents/pi_read_test',
      headers: pkHeaders(),
    })

    expect(response.statusCode).toBe(200)
  })
})

describe('POST /v1/payment_intents/:id/cancel', () => {
  it('should cancel a created payment intent', async () => {
    mockedGet.mockResolvedValueOnce({
      id: 'pi_cancel_test',
      merchant_id: 'merchant_test',
      amount: 3000,
      currency: 'usdc',
      chain: 'base',
      status: 'created',
      node_operator: null,
      payer_address: null,
      tx_hash: null,
      fee_amount: 15,
      metadata: {},
      created_at: 1700000000,
      expires_at: 1700001800,
      settled_at: null,
    })
    mockedUpdate.mockResolvedValueOnce(undefined)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents/pi_cancel_test/cancel',
      headers: skHeaders(),
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.status).toBe('cancelled')
    expect(mockedUpdate).toHaveBeenCalledWith({}, 'pi_cancel_test', 'cancelled')
  })

  it('should return 409 when trying to cancel a settled intent', async () => {
    mockedGet.mockResolvedValueOnce({
      id: 'pi_settled',
      merchant_id: 'merchant_test',
      amount: 3000,
      currency: 'usdc',
      chain: 'base',
      status: 'settled',
      node_operator: '0xNode',
      payer_address: '0xPayer',
      tx_hash: '0xTx123',
      fee_amount: 15,
      metadata: {},
      created_at: 1700000000,
      expires_at: 1700001800,
      settled_at: 1700000500,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents/pi_settled/cancel',
      headers: skHeaders(),
    })

    expect(response.statusCode).toBe(409)
    const body = response.json()
    expect(body.error.code).toBe('intent_already_settled')
  })

  it('should return 404 when cancelling non-existent intent', async () => {
    mockedGet.mockResolvedValueOnce(null)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents/pi_nope/cancel',
      headers: skHeaders(),
    })

    expect(response.statusCode).toBe(404)
  })

  it('should return 403 when cancelling with a public key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents/pi_cancel_pk/cancel',
      headers: pkHeaders(),
    })

    expect(response.statusCode).toBe(403)
  })

  it('should allow cancelling intents in routing status', async () => {
    mockedGet.mockResolvedValueOnce({
      id: 'pi_routing',
      merchant_id: 'merchant_test',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      status: 'routing',
      node_operator: null,
      payer_address: null,
      tx_hash: null,
      fee_amount: 5,
      metadata: {},
      created_at: 1700000000,
      expires_at: 1700001800,
      settled_at: null,
    })
    mockedUpdate.mockResolvedValueOnce(undefined)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents/pi_routing/cancel',
      headers: skHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('cancelled')
  })

  it('should allow cancelling intents in pending_payment status', async () => {
    mockedGet.mockResolvedValueOnce({
      id: 'pi_pending',
      merchant_id: 'merchant_test',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      status: 'pending_payment',
      node_operator: '0xNode',
      payer_address: '0xPayer',
      tx_hash: null,
      fee_amount: 5,
      metadata: {},
      created_at: 1700000000,
      expires_at: 1700001800,
      settled_at: null,
    })
    mockedUpdate.mockResolvedValueOnce(undefined)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment_intents/pi_pending/cancel',
      headers: skHeaders(),
    })

    expect(response.statusCode).toBe(200)
  })
})

describe('GET /v1/payment_intents', () => {
  it('should list payment intents with default limit', async () => {
    mockedList.mockResolvedValueOnce({
      data: [
        {
          id: 'pi_list1',
          merchant_id: 'merchant_test',
          amount: 1000,
          currency: 'usdc',
          chain: 'base',
          status: 'created',
          node_operator: null,
          payer_address: null,
          tx_hash: null,
          fee_amount: 5,
          metadata: {},
          created_at: 1700000000,
          expires_at: 1700001800,
          settled_at: null,
        },
      ],
      has_more: false,
    })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/payment_intents',
      headers: skHeaders(),
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.data).toHaveLength(1)
    expect(body.has_more).toBe(false)
    expect(mockedList).toHaveBeenCalledWith({}, 'merchant_test', 10, undefined)
  })

  it('should respect limit query parameter', async () => {
    mockedList.mockResolvedValueOnce({ data: [], has_more: false })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/payment_intents?limit=5',
      headers: skHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(mockedList).toHaveBeenCalledWith({}, 'merchant_test', 5, undefined)
  })

  it('should cap limit at 100', async () => {
    mockedList.mockResolvedValueOnce({ data: [], has_more: false })

    await app.inject({
      method: 'GET',
      url: '/v1/payment_intents?limit=999',
      headers: skHeaders(),
    })

    expect(mockedList).toHaveBeenCalledWith({}, 'merchant_test', 100, undefined)
  })

  it('should pass starting_after for pagination', async () => {
    mockedList.mockResolvedValueOnce({ data: [], has_more: false })

    await app.inject({
      method: 'GET',
      url: '/v1/payment_intents?starting_after=pi_cursor123',
      headers: skHeaders(),
    })

    expect(mockedList).toHaveBeenCalledWith({}, 'merchant_test', 10, 'pi_cursor123')
  })
})

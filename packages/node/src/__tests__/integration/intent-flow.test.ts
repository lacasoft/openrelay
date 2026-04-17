import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { createHmac } from 'node:crypto'
import { initStore, type NodeStore } from '../../lib/store.js'
import { healthRoute, infoRoute } from '../../routes/health.js'

// Mock the chain-verify module to avoid real RPC calls
vi.mock('../../lib/chain-verify', () => ({
  createChainClient: vi.fn(() => null),
  verifyUsdcTransfer: vi.fn(async () => ({ valid: true })),
}))

// Mock viem for derivePaymentAddress
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal() as any
  return {
    ...actual,
    keccak256: actual.keccak256,
    toHex: actual.toHex,
  }
})

import { intentsRoute } from '../../routes/intents.js'

// ── Test fixtures ─────────────────────────────────────────────────

const HMAC_SECRET = 'test-hmac-secret-at-least-16-chars'

const mockConfig = {
  port: 4000,
  operatorAddress: '0xTestOperator1234567890abcdef1234567890ab',
  privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
  endpoint: 'http://localhost:4000',
  hmacSecret: HMAC_SECRET,
  baseRpcUrl: 'https://sepolia.base.org',
  nodeRegistryAddress: '0x0000000000000000000000000000000000000000',
  stakeManagerAddress: '0x0000000000000000000000000000000000000000',
  usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  dbPath: ':memory:',
}

let app: FastifyInstance
let store: NodeStore

function signBody(body: string, timestamp: number): string {
  return `sha256=${createHmac('sha256', HMAC_SECRET).update(`${timestamp}.${body}`).digest('hex')}`
}

function makeAssignRequest(intent: any) {
  const body = JSON.stringify(intent)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = signBody(body, timestamp)

  return {
    method: 'POST' as const,
    url: '/intents/assign',
    headers: {
      'content-type': 'application/json',
      'x-openrelay-signature': signature,
      'x-openrelay-timestamp': String(timestamp),
    },
    payload: intent,
  }
}

beforeAll(async () => {
  store = initStore(':memory:')
  app = Fastify({ logger: false })
  app.decorate('config', mockConfig)
  app.decorate('store', store)
  app.register(healthRoute)
  app.register(infoRoute)
  app.register(intentsRoute)
  await app.ready()
})

afterAll(async () => {
  await app.close()
  store.close()
})

beforeEach(() => {
  // Reset is not possible with SQLite in-memory without re-init,
  // so tests should use unique intent IDs
})

// ── Full intent assignment flow ───────────────────────────────────

describe('Full intent assignment flow', () => {
  it('should assign an intent and return a payment address', async () => {
    const intent = {
      intent_id: 'pi_flow_assign_001',
      amount: 10000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchantAddr',
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }

    const res = await app.inject(makeAssignRequest(intent))

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.accepted).toBe(true)
    expect(body.payment_address).toMatch(/^0x/)
    expect(body.node_fee).toBeTypeOf('number')
    expect(body.node_fee).toBeGreaterThan(0)
  })

  it('should store the assigned intent in SQLite', async () => {
    const intent = {
      intent_id: 'pi_flow_store_002',
      amount: 5000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchantAddr',
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }

    await app.inject(makeAssignRequest(intent))

    // Verify stored in SQLite
    const assignment = store.getAssignment('pi_flow_store_002')
    expect(assignment).toBeDefined()
    expect(assignment!.intent_id).toBe('pi_flow_store_002')
    expect(assignment!.amount).toBe(5000)
    expect(assignment!.status).toBe('assigned')
    expect(assignment!.payment_address).toMatch(/^0x/)
  })

  it('should reject expired intents', async () => {
    const intent = {
      intent_id: 'pi_flow_expired_003',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchantAddr',
      expires_at: Math.floor(Date.now() / 1000) - 100, // already expired
    }

    const res = await app.inject(makeAssignRequest(intent))

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.accepted).toBe(false)
    expect(body.reason).toBe('intent_expired')
  })

  it('should generate unique payment addresses per intent', async () => {
    const intent1 = {
      intent_id: 'pi_unique_addr_004',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchantAddr',
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }
    const intent2 = {
      intent_id: 'pi_unique_addr_005',
      amount: 2000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchantAddr',
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }

    const res1 = await app.inject(makeAssignRequest(intent1))
    const res2 = await app.inject(makeAssignRequest(intent2))

    const addr1 = res1.json().payment_address
    const addr2 = res2.json().payment_address
    expect(addr1).not.toBe(addr2)
  })
})

// ── Settlement notification flow ──────────────────────────────────

describe('Settlement notification flow', () => {
  it('should settle an assigned intent', async () => {
    // First assign
    const intent = {
      intent_id: 'pi_settle_006',
      amount: 8000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchantAddr',
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }

    const assignRes = await app.inject(makeAssignRequest(intent))
    expect(assignRes.json().accepted).toBe(true)

    // Then settle
    const settleRes = await app.inject({
      method: 'POST',
      url: '/intents/pi_settle_006/settle',
      payload: {
        tx_hash: '0xSettleTx123',
        block_number: 12345,
        settled_at: Math.floor(Date.now() / 1000),
      },
    })

    expect(settleRes.statusCode).toBe(200)
    const body = settleRes.json()
    expect(body.confirmed).toBe(true)

    // Verify stored state updated
    const assignment = store.getAssignment('pi_settle_006')
    expect(assignment!.status).toBe('settled')
    expect(assignment!.tx_hash).toBe('0xSettleTx123')
  })

  it('should return 404 for non-existent intent settlement', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/intents/pi_nonexistent_999/settle',
      payload: {
        tx_hash: '0xFake',
        block_number: 1,
        settled_at: Math.floor(Date.now() / 1000),
      },
    })

    expect(res.statusCode).toBe(404)
    const body = res.json()
    expect(body.confirmed).toBe(false)
    expect(body.error).toBe('intent_not_found')
  })
})

// ── Health check ──────────────────────────────────────────────────

describe('Health check returns proper data', () => {
  it('should return status ok with operator and chains', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('ok')
    expect(body.version).toBe('0.1.0')
    expect(body.operator).toBe(mockConfig.operatorAddress)
    expect(body.chains).toContain('base')
  })

  it('should return info endpoint with stats', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/info',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.operator).toBe(mockConfig.operatorAddress)
    expect(body.total_settled).toBeTypeOf('number')
    expect(body.avg_settlement_ms).toBeTypeOf('number')
    expect(body.uptime_30d).toBeGreaterThanOrEqual(0)
    expect(body.uptime_30d).toBeLessThanOrEqual(1)
  })
})

// ── HMAC verification on protected routes ─────────────────────────

describe('HMAC verification on protected routes', () => {
  it('should reject assignment with invalid HMAC signature', async () => {
    const intent = {
      intent_id: 'pi_hmac_bad_007',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchantAddr',
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }
    const body = JSON.stringify(intent)
    const timestamp = Math.floor(Date.now() / 1000)

    const res = await app.inject({
      method: 'POST',
      url: '/intents/assign',
      headers: {
        'content-type': 'application/json',
        'x-openrelay-signature': 'sha256=invalidsignature',
        'x-openrelay-timestamp': String(timestamp),
      },
      payload: intent,
    })

    expect(res.statusCode).toBe(401)
    const resBody = res.json()
    expect(resBody.accepted).toBe(false)
    expect(resBody.reason).toBe('invalid_signature')
  })

  it('should reject assignment with expired timestamp', async () => {
    const intent = {
      intent_id: 'pi_hmac_expired_008',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchantAddr',
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }
    const body = JSON.stringify(intent)
    const oldTimestamp = Math.floor(Date.now() / 1000) - 120 // 2 minutes ago (beyond 60s tolerance)
    const signature = signBody(body, oldTimestamp)

    const res = await app.inject({
      method: 'POST',
      url: '/intents/assign',
      headers: {
        'content-type': 'application/json',
        'x-openrelay-signature': signature,
        'x-openrelay-timestamp': String(oldTimestamp),
      },
      payload: intent,
    })

    expect(res.statusCode).toBe(401)
    const resBody = res.json()
    expect(resBody.accepted).toBe(false)
    expect(resBody.reason).toBe('invalid_signature')
  })

  it('should accept assignment with valid HMAC and fresh timestamp', async () => {
    const intent = {
      intent_id: 'pi_hmac_valid_009',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchantAddr',
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }

    const res = await app.inject(makeAssignRequest(intent))

    expect(res.statusCode).toBe(200)
    expect(res.json().accepted).toBe(true)
  })
})

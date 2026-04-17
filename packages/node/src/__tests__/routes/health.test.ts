import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { createHmac } from 'node:crypto'
import { healthRoute, infoRoute } from '../../routes/health.js'
import { initStore, type NodeStore } from '../../lib/store.js'

let app: FastifyInstance
let store: NodeStore

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

function authHeaders(): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', HMAC_SECRET)
    .update(`${timestamp}.`)
    .digest('hex')
  return {
    'x-openrelay-signature': `sha256=${signature}`,
    'x-openrelay-timestamp': String(timestamp),
  }
}

beforeAll(async () => {
  process.env['NODE_HMAC_SECRET'] = HMAC_SECRET
  store = initStore(':memory:')
  app = Fastify({ logger: false })
  app.decorate('config', mockConfig)
  app.decorate('store', store)
  app.register(healthRoute)
  app.register(infoRoute)
  await app.ready()
})

afterAll(async () => {
  await app.close()
  store.close()
})

describe('GET /health (public — minimal response for Docker healthcheck)', () => {
  it('should return status ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.status).toBe('ok')
  })

  it('should return version', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    const body = response.json()
    expect(body.version).toBe('0.1.0')
  })

  it('should NOT expose operator address (public endpoint)', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    const body = response.json()
    expect(body.operator).toBeUndefined()
  })
})

describe('GET /info (reduced response without HMAC)', () => {
  it('should return only status and version when unauthenticated', async () => {
    const response = await app.inject({ method: 'GET', url: '/info' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.status).toBe('ok')
    expect(body.version).toBe('0.1.0')
    expect(body.operator).toBeUndefined()
    expect(body.total_settled).toBeUndefined()
  })

  it('should reject invalid HMAC signature', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/info',
      headers: {
        'x-openrelay-signature': 'sha256=invalidsignature',
        'x-openrelay-timestamp': String(Math.floor(Date.now() / 1000)),
      },
    })
    expect(response.statusCode).toBe(403)
  })
})

describe('GET /info (authenticated via HMAC)', () => {
  it('should return operator address', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/info',
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.operator).toBe(mockConfig.operatorAddress)
  })

  it('should return version', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/info',
      headers: authHeaders(),
    })
    const body = response.json()
    expect(body.version).toBe('0.1.0')
  })

  it('should return uptime_30d between 0 and 1', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/info',
      headers: authHeaders(),
    })
    const body = response.json()
    expect(body.uptime_30d).toBeGreaterThanOrEqual(0)
    expect(body.uptime_30d).toBeLessThanOrEqual(1)
  })

  it('should return avg_settlement_ms as a number', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/info',
      headers: authHeaders(),
    })
    const body = response.json()
    expect(body.avg_settlement_ms).toBeTypeOf('number')
  })

  it('should return total_settled count', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/info',
      headers: authHeaders(),
    })
    const body = response.json()
    expect(body.total_settled).toBeTypeOf('number')
  })

  it('should return stake as a string', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/info',
      headers: authHeaders(),
    })
    const body = response.json()
    expect(body.stake).toBe('100000000')
  })

  it('should reflect settlement stats from the store', async () => {
    store.insertAssignment({
      intent_id: 'pi_info_test',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant',
      payment_address: '0xPayAddr',
      status: 'assigned',
      tx_hash: null,
      intent_index: store.getNextIndex(),
    })
    store.updateAssignment('pi_info_test', 'settled', '0xTxInfo')

    const response = await app.inject({
      method: 'GET',
      url: '/info',
      headers: authHeaders(),
    })
    const body = response.json()
    expect(body.total_settled).toBeGreaterThanOrEqual(1)
  })
})

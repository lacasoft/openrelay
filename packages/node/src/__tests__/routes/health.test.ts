import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { healthRoute, infoRoute } from '../../routes/health.js'
import { initStore, type NodeStore } from '../../lib/store.js'

let app: FastifyInstance
let store: NodeStore

const mockConfig = {
  port: 4000,
  operatorAddress: '0xTestOperator1234567890abcdef1234567890ab',
  privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
  endpoint: 'http://localhost:4000',
  hmacSecret: 'test-hmac-secret-at-least-16-chars',
  baseRpcUrl: 'https://sepolia.base.org',
  nodeRegistryAddress: '0x0000000000000000000000000000000000000000',
  stakeManagerAddress: '0x0000000000000000000000000000000000000000',
  dbPath: ':memory:',
}

beforeAll(async () => {
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

describe('GET /health', () => {
  it('should return status ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.status).toBe('ok')
  })

  it('should return version', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    const body = response.json()
    expect(body.version).toBe('0.1.0')
  })

  it('should return operator address', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    const body = response.json()
    expect(body.operator).toBe(mockConfig.operatorAddress)
  })

  it('should return supported chains', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    const body = response.json()
    expect(body.chains).toEqual(['base'])
  })

  it('should return capacity value', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    const body = response.json()
    expect(body.capacity).toBe(0.9)
    expect(body.capacity).toBeGreaterThan(0)
    expect(body.capacity).toBeLessThanOrEqual(1)
  })
})

describe('GET /info', () => {
  it('should return node info with operator address', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/info',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.operator).toBe(mockConfig.operatorAddress)
  })

  it('should return version', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/info',
    })

    const body = response.json()
    expect(body.version).toBe('0.1.0')
  })

  it('should return uptime_30d between 0 and 1', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/info',
    })

    const body = response.json()
    expect(body.uptime_30d).toBeGreaterThanOrEqual(0)
    expect(body.uptime_30d).toBeLessThanOrEqual(1)
  })

  it('should return avg_settlement_ms as a number', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/info',
    })

    const body = response.json()
    expect(body.avg_settlement_ms).toBeTypeOf('number')
  })

  it('should return total_settled count', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/info',
    })

    const body = response.json()
    expect(body.total_settled).toBeTypeOf('number')
    expect(body.total_settled).toBe(0) // no settlements in test store
  })

  it('should return stake as a string', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/info',
    })

    const body = response.json()
    expect(body.stake).toBe('100000000')
  })

  it('should reflect settlement stats from the store', async () => {
    // Insert and settle an assignment
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
    })

    const body = response.json()
    expect(body.total_settled).toBe(1)
  })
})

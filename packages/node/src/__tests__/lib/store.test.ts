import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type NodeStore, initStore } from '../../lib/store.js'

let store: NodeStore

beforeEach(() => {
  store = initStore(':memory:')
})

afterEach(() => {
  store.close()
})

describe('initStore', () => {
  it('should create the store without errors', () => {
    expect(store).toBeDefined()
    expect(store.getNextIndex).toBeTypeOf('function')
    expect(store.insertAssignment).toBeTypeOf('function')
    expect(store.getAssignment).toBeTypeOf('function')
    expect(store.getAssignmentByAddress).toBeTypeOf('function')
    expect(store.updateAssignment).toBeTypeOf('function')
    expect(store.getPendingAssignments).toBeTypeOf('function')
    expect(store.getStats).toBeTypeOf('function')
    expect(store.close).toBeTypeOf('function')
  })

  it('should initialize the intent counter to 0', () => {
    // First call to getNextIndex should return 1 (incremented from 0)
    const idx = store.getNextIndex()
    expect(idx).toBe(1)
  })
})

describe('getNextIndex', () => {
  it('should return sequential indices', () => {
    expect(store.getNextIndex()).toBe(1)
    expect(store.getNextIndex()).toBe(2)
    expect(store.getNextIndex()).toBe(3)
    expect(store.getNextIndex()).toBe(4)
  })

  it('should never return the same index twice', () => {
    const indices = new Set<number>()
    for (let i = 0; i < 100; i++) {
      indices.add(store.getNextIndex())
    }
    expect(indices.size).toBe(100)
  })
})

describe('insertAssignment and getAssignment', () => {
  it('should insert and retrieve an assignment', () => {
    const idx = store.getNextIndex()
    store.insertAssignment({
      intent_id: 'pi_test001',
      amount: 5000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant1',
      payment_address: '0xPayment1',
      status: 'assigned',
      tx_hash: null,
      intent_index: idx,
    })

    const result = store.getAssignment('pi_test001')
    expect(result).toBeDefined()
    expect(result?.intent_id).toBe('pi_test001')
    expect(result?.amount).toBe(5000)
    expect(result?.currency).toBe('usdc')
    expect(result?.chain).toBe('base')
    expect(result?.merchant_address).toBe('0xMerchant1')
    expect(result?.payment_address).toBe('0xPayment1')
    expect(result?.status).toBe('assigned')
    expect(result?.tx_hash).toBeNull()
    expect(result?.intent_index).toBe(idx)
    expect(result?.assigned_at).toBeTypeOf('number')
    expect(result?.assigned_at).toBeGreaterThan(0)
    expect(result?.settled_at).toBeNull()
  })

  it('should return undefined for non-existent assignment', () => {
    const result = store.getAssignment('pi_nonexistent')
    expect(result).toBeUndefined()
  })

  it('should store assigned_at as current unix timestamp', () => {
    const before = Math.floor(Date.now() / 1000)

    store.insertAssignment({
      intent_id: 'pi_timestamp',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant',
      payment_address: '0xPayment',
      status: 'assigned',
      tx_hash: null,
      intent_index: store.getNextIndex(),
    })

    const after = Math.floor(Date.now() / 1000)
    const result = store.getAssignment('pi_timestamp')

    expect(result?.assigned_at).toBeGreaterThanOrEqual(before)
    expect(result?.assigned_at).toBeLessThanOrEqual(after)
  })
})

describe('getAssignmentByAddress', () => {
  it('should find an assignment by payment address', () => {
    store.insertAssignment({
      intent_id: 'pi_addr_test',
      amount: 2000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant',
      payment_address: '0xUniquePayAddr',
      status: 'assigned',
      tx_hash: null,
      intent_index: store.getNextIndex(),
    })

    const result = store.getAssignmentByAddress('0xUniquePayAddr')
    expect(result).toBeDefined()
    expect(result?.intent_id).toBe('pi_addr_test')
  })

  it('should return undefined for non-existent address', () => {
    const result = store.getAssignmentByAddress('0xNonexistent')
    expect(result).toBeUndefined()
  })

  it('should only find assignments with status=assigned', () => {
    store.insertAssignment({
      intent_id: 'pi_settled_addr',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant',
      payment_address: '0xSettledAddr',
      status: 'assigned',
      tx_hash: null,
      intent_index: store.getNextIndex(),
    })

    // Now settle it
    store.updateAssignment('pi_settled_addr', 'settled', '0xTxHash')

    // Should NOT find it since status is no longer 'assigned'
    const result = store.getAssignmentByAddress('0xSettledAddr')
    expect(result).toBeUndefined()
  })
})

describe('updateAssignment', () => {
  it('should update status to settled', () => {
    store.insertAssignment({
      intent_id: 'pi_update1',
      amount: 3000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant',
      payment_address: '0xPayAddr',
      status: 'assigned',
      tx_hash: null,
      intent_index: store.getNextIndex(),
    })

    store.updateAssignment('pi_update1', 'settled', '0xTxHash123')

    const result = store.getAssignment('pi_update1')
    expect(result?.status).toBe('settled')
    expect(result?.tx_hash).toBe('0xTxHash123')
    expect(result?.settled_at).toBeTypeOf('number')
    expect(result?.settled_at).toBeGreaterThan(0)
  })

  it('should update status to failed without tx_hash', () => {
    store.insertAssignment({
      intent_id: 'pi_fail1',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant',
      payment_address: '0xPayAddr2',
      status: 'assigned',
      tx_hash: null,
      intent_index: store.getNextIndex(),
    })

    store.updateAssignment('pi_fail1', 'failed')

    const result = store.getAssignment('pi_fail1')
    expect(result?.status).toBe('failed')
    expect(result?.tx_hash).toBeNull()
    // settled_at should remain null for failed status
    expect(result?.settled_at).toBeNull()
  })

  it('should set settled_at only when status becomes settled', () => {
    store.insertAssignment({
      intent_id: 'pi_settle_time',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant',
      payment_address: '0xPayAddr3',
      status: 'assigned',
      tx_hash: null,
      intent_index: store.getNextIndex(),
    })

    // Update to expired (not settled)
    store.updateAssignment('pi_settle_time', 'expired')
    let result = store.getAssignment('pi_settle_time')
    expect(result?.settled_at).toBeNull()

    // Now settle it
    store.updateAssignment('pi_settle_time', 'settled', '0xTx')
    result = store.getAssignment('pi_settle_time')
    expect(result?.settled_at).not.toBeNull()
    expect(result?.settled_at).toBeGreaterThan(0)
  })

  it('should not overwrite existing tx_hash when not provided', () => {
    store.insertAssignment({
      intent_id: 'pi_keep_tx',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant',
      payment_address: '0xPayAddr4',
      status: 'assigned',
      tx_hash: null,
      intent_index: store.getNextIndex(),
    })

    store.updateAssignment('pi_keep_tx', 'settled', '0xOriginalTx')
    store.updateAssignment('pi_keep_tx', 'settled') // no tx_hash provided

    const result = store.getAssignment('pi_keep_tx')
    expect(result?.tx_hash).toBe('0xOriginalTx')
  })
})

describe('getPendingAssignments', () => {
  it('should return assignments older than the given threshold', async () => {
    store.insertAssignment({
      intent_id: 'pi_pending1',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant',
      payment_address: '0xPendAddr1',
      status: 'assigned',
      tx_hash: null,
      intent_index: store.getNextIndex(),
    })

    // With olderThanMs=0, everything is "older" (threshold is now)
    const pending = store.getPendingAssignments(0)
    expect(pending.length).toBeGreaterThanOrEqual(1)
    expect(pending.some((a) => a.intent_id === 'pi_pending1')).toBe(true)
  })

  it('should not return settled assignments', () => {
    store.insertAssignment({
      intent_id: 'pi_pend_settled',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant',
      payment_address: '0xPendAddr2',
      status: 'assigned',
      tx_hash: null,
      intent_index: store.getNextIndex(),
    })

    store.updateAssignment('pi_pend_settled', 'settled', '0xTx')

    const pending = store.getPendingAssignments(0)
    expect(pending.some((a) => a.intent_id === 'pi_pend_settled')).toBe(false)
  })

  it('should not return very recent assignments when olderThanMs is large', () => {
    store.insertAssignment({
      intent_id: 'pi_recent',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant',
      payment_address: '0xPendAddr3',
      status: 'assigned',
      tx_hash: null,
      intent_index: store.getNextIndex(),
    })

    // 1 hour in the future -- the cutoff will be well before now
    // Actually olderThanMs=3600000 means cutoff = (now - 3600) seconds ago
    // Since we just inserted, assigned_at is "now", so it's newer than cutoff
    // Wait... the query is: assigned_at <= cutoff, where cutoff = (Date.now() - olderThanMs) / 1000
    // So with olderThanMs = 1 hour = 3600000, cutoff = now - 3600 seconds
    // The assignment was just created (assigned_at ~ now), so now > cutoff => not returned
    const pending = store.getPendingAssignments(3_600_000)
    expect(pending.some((a) => a.intent_id === 'pi_recent')).toBe(false)
  })
})

describe('getStats', () => {
  it('should return zero stats on empty store', () => {
    const stats = store.getStats()
    expect(stats.total_settled).toBe(0)
    expect(stats.avg_settlement_ms).toBe(0)
    expect(stats.uptime_start).toBeTypeOf('number')
    expect(stats.uptime_start).toBeGreaterThan(0)
  })

  it('should count settled assignments', () => {
    store.insertAssignment({
      intent_id: 'pi_stats1',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant',
      payment_address: '0xAddr1',
      status: 'assigned',
      tx_hash: null,
      intent_index: store.getNextIndex(),
    })

    store.insertAssignment({
      intent_id: 'pi_stats2',
      amount: 2000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant',
      payment_address: '0xAddr2',
      status: 'assigned',
      tx_hash: null,
      intent_index: store.getNextIndex(),
    })

    store.updateAssignment('pi_stats1', 'settled', '0xTx1')
    store.updateAssignment('pi_stats2', 'settled', '0xTx2')

    const stats = store.getStats()
    expect(stats.total_settled).toBe(2)
  })

  it('should not count non-settled assignments in total_settled', () => {
    store.insertAssignment({
      intent_id: 'pi_nosettle',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      merchant_address: '0xMerchant',
      payment_address: '0xAddrX',
      status: 'assigned',
      tx_hash: null,
      intent_index: store.getNextIndex(),
    })

    store.updateAssignment('pi_nosettle', 'failed')

    const stats = store.getStats()
    expect(stats.total_settled).toBe(0)
  })

  it('should track uptime_start', () => {
    const stats = store.getStats()
    const now = Math.floor(Date.now() / 1000)

    // uptime_start should be close to now (within a few seconds)
    expect(Math.abs(stats.uptime_start - now)).toBeLessThan(5)
  })
})

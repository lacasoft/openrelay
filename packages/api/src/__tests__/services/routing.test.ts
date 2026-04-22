import type { NodeInfo } from '@openrelay/protocol'
import { MAX_SETTLEMENT_MS, TARGET_STAKE_USDC } from '@openrelay/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeScore } from '../../services/routing.js'

function makeNode(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return {
    operator: '0xOperator1',
    endpoint: 'http://node1.example.com',
    version: '0.1.0',
    chains: ['base'],
    capacity: 0.9,
    uptime_30d: 0.99,
    avg_settlement_ms: 5000,
    total_settled: 100,
    stake: TARGET_STAKE_USDC,
    ...overrides,
  }
}

describe('computeScore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  })

  it('should return a score between 0 and 1 for a typical node', () => {
    const node = makeNode()
    const result = computeScore(node, 5, 5)

    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
    expect(result.operator).toBe('0xOperator1')
  })

  it('should compute correct individual weight components', () => {
    const node = makeNode({
      uptime_30d: 0.95,
      avg_settlement_ms: 15000, // half of MAX_SETTLEMENT_MS (30000)
      stake: TARGET_STAKE_USDC / 2n,
    })

    const result = computeScore(node, 8, 10) // 80% disputes won

    // uptime_weight = 0.95
    expect(result.uptime_weight).toBeCloseTo(0.95, 5)

    // speed_weight = 1 - (15000 / 30000) = 0.5
    expect(result.speed_weight).toBeCloseTo(0.5, 5)

    // stake_weight = 0.5 (half of target)
    expect(result.stake_weight).toBeCloseTo(0.5, 5)

    // disputes_weight = 8/10 = 0.8
    expect(result.disputes_weight).toBeCloseTo(0.8, 5)

    // score = 0.95*0.30 + 0.5*0.30 + 0.5*0.20 + 0.8*0.20
    //       = 0.285 + 0.15 + 0.10 + 0.16 = 0.695
    expect(result.score).toBeCloseTo(0.695, 5)
  })

  it('should return perfect score for ideal node', () => {
    const node = makeNode({
      uptime_30d: 1.0,
      avg_settlement_ms: 0,
      stake: TARGET_STAKE_USDC,
    })

    const result = computeScore(node, 100, 100) // 100% disputes won

    expect(result.uptime_weight).toBe(1.0)
    expect(result.speed_weight).toBe(1.0)
    expect(result.stake_weight).toBe(1.0)
    expect(result.disputes_weight).toBe(1.0)
    expect(result.score).toBeCloseTo(1.0, 5)
  })

  it('should handle zero uptime', () => {
    const node = makeNode({ uptime_30d: 0.0 })
    const result = computeScore(node, 1, 1)

    expect(result.uptime_weight).toBe(0)
    // Score should be reduced due to zero uptime
    expect(result.score).toBeLessThan(1.0)
  })

  it('should cap speed_weight at 0 when latency exceeds MAX_SETTLEMENT_MS', () => {
    const node = makeNode({ avg_settlement_ms: MAX_SETTLEMENT_MS * 2 })
    const result = computeScore(node, 1, 1)

    // speed_weight = 1 - min(60000/30000, 1) = 1 - 1 = 0
    expect(result.speed_weight).toBe(0)
  })

  it('should cap stake_weight at 1 when stake exceeds TARGET_STAKE_USDC', () => {
    const node = makeNode({ stake: TARGET_STAKE_USDC * 5n })
    const result = computeScore(node, 1, 1)

    expect(result.stake_weight).toBe(1)
  })

  it('should handle zero disputes (no disputes = perfect dispute score)', () => {
    const node = makeNode()
    const result = computeScore(node, 0, 0)

    // When disputesTotal is 0, disputes_weight defaults to 1
    expect(result.disputes_weight).toBe(1)
  })

  it('should handle zero disputes won out of some total', () => {
    const node = makeNode()
    const result = computeScore(node, 0, 10)

    expect(result.disputes_weight).toBe(0)
  })

  it('should handle zero stake', () => {
    const node = makeNode({ stake: 0n })
    const result = computeScore(node, 1, 1)

    expect(result.stake_weight).toBe(0)
  })

  it('should include computed_at timestamp', () => {
    const node = makeNode()
    const result = computeScore(node, 1, 1)

    const expectedTimestamp = Math.floor(new Date('2026-01-15T12:00:00Z').getTime() / 1000)
    expect(result.computed_at).toBe(expectedTimestamp)
  })

  it('should correctly weigh all components at 30/30/20/20 split', () => {
    // All weights at exactly 0.5 for easy math
    const node = makeNode({
      uptime_30d: 0.5,
      avg_settlement_ms: MAX_SETTLEMENT_MS / 2, // speed_weight = 0.5
      stake: TARGET_STAKE_USDC / 2n, // stake_weight = 0.5
    })
    const result = computeScore(node, 1, 2) // 50% disputes

    // score = 0.5*0.30 + 0.5*0.30 + 0.5*0.20 + 0.5*0.20
    //       = 0.15 + 0.15 + 0.10 + 0.10 = 0.50
    expect(result.score).toBeCloseTo(0.5, 5)
  })

  it('should handle very small stake values', () => {
    const node = makeNode({ stake: 1n })
    const result = computeScore(node, 1, 1)

    expect(result.stake_weight).toBeCloseTo(1 / Number(TARGET_STAKE_USDC), 10)
    expect(result.stake_weight).toBeGreaterThan(0)
    expect(result.stake_weight).toBeLessThan(0.001)
  })

  it('should handle max settlement latency exactly at threshold', () => {
    const node = makeNode({ avg_settlement_ms: MAX_SETTLEMENT_MS })
    const result = computeScore(node, 1, 1)

    // speed_weight = 1 - min(30000/30000, 1) = 1 - 1 = 0
    expect(result.speed_weight).toBe(0)
  })
})

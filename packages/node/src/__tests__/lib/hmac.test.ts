import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signRequest, verifyRequest } from '../../lib/hmac.js'

const TEST_SECRET = 'test-hmac-secret-key-at-least-16'

describe('signRequest', () => {
  it('should generate a valid HMAC-SHA256 hex signature', () => {
    const body = '{"intent_id":"pi_test"}'
    const timestamp = 1700000000

    const result = signRequest(body, timestamp, TEST_SECRET)

    // Verify it matches a manually computed HMAC
    const expected = createHmac('sha256', TEST_SECRET).update(`${timestamp}.${body}`).digest('hex')

    expect(result).toBe(expected)
  })

  it('should return different signatures for different bodies', () => {
    const timestamp = 1700000000
    const sig1 = signRequest('{"a":1}', timestamp, TEST_SECRET)
    const sig2 = signRequest('{"a":2}', timestamp, TEST_SECRET)

    expect(sig1).not.toBe(sig2)
  })

  it('should return different signatures for different timestamps', () => {
    const body = '{"test":"data"}'
    const sig1 = signRequest(body, 1700000000, TEST_SECRET)
    const sig2 = signRequest(body, 1700000001, TEST_SECRET)

    expect(sig1).not.toBe(sig2)
  })

  it('should return different signatures for different secrets', () => {
    const body = '{"test":"data"}'
    const timestamp = 1700000000
    const sig1 = signRequest(body, timestamp, 'secret-aaaaaaaaaa')
    const sig2 = signRequest(body, timestamp, 'secret-bbbbbbbbbb')

    expect(sig1).not.toBe(sig2)
  })

  it('should return a 64-character hex string', () => {
    const result = signRequest('body', 123, TEST_SECRET)
    expect(result).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('verifyRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return true for a valid signature and recent timestamp', () => {
    const now = new Date('2026-01-15T12:00:00Z')
    vi.setSystemTime(now)

    const body = '{"intent_id":"pi_verify"}'
    const timestamp = Math.floor(now.getTime() / 1000) // current time in seconds
    const rawSig = signRequest(body, timestamp, TEST_SECRET)
    const signature = `sha256=${rawSig}`

    const result = verifyRequest(body, timestamp, signature, TEST_SECRET)
    expect(result).toBe(true)
  })

  it('should return true for a timestamp within the 60-second tolerance', () => {
    const now = new Date('2026-01-15T12:00:00Z')
    vi.setSystemTime(now)

    const body = '{"test":"tolerance"}'
    // 30 seconds ago (well within 60s tolerance)
    const timestamp = Math.floor(now.getTime() / 1000) - 30
    const rawSig = signRequest(body, timestamp, TEST_SECRET)
    const signature = `sha256=${rawSig}`

    const result = verifyRequest(body, timestamp, signature, TEST_SECRET)
    expect(result).toBe(true)
  })

  it('should return false for an expired timestamp (beyond 60-second tolerance)', () => {
    const now = new Date('2026-01-15T12:00:00Z')
    vi.setSystemTime(now)

    const body = '{"test":"expired"}'
    // 120 seconds ago (beyond 60s tolerance)
    const timestamp = Math.floor(now.getTime() / 1000) - 120
    const rawSig = signRequest(body, timestamp, TEST_SECRET)
    const signature = `sha256=${rawSig}`

    const result = verifyRequest(body, timestamp, signature, TEST_SECRET)
    expect(result).toBe(false)
  })

  it('should return false for a timestamp in the future beyond tolerance', () => {
    const now = new Date('2026-01-15T12:00:00Z')
    vi.setSystemTime(now)

    const body = '{"test":"future"}'
    // 120 seconds in the future
    const timestamp = Math.floor(now.getTime() / 1000) + 120
    const rawSig = signRequest(body, timestamp, TEST_SECRET)
    const signature = `sha256=${rawSig}`

    const result = verifyRequest(body, timestamp, signature, TEST_SECRET)
    expect(result).toBe(false)
  })

  it('should return false for an invalid signature', () => {
    const now = new Date('2026-01-15T12:00:00Z')
    vi.setSystemTime(now)

    const body = '{"test":"invalid"}'
    const timestamp = Math.floor(now.getTime() / 1000)

    const result = verifyRequest(body, timestamp, 'sha256=deadbeefdeadbeef', TEST_SECRET)
    expect(result).toBe(false)
  })

  it('should return false when signature is missing the sha256= prefix', () => {
    const now = new Date('2026-01-15T12:00:00Z')
    vi.setSystemTime(now)

    const body = '{"test":"noprefix"}'
    const timestamp = Math.floor(now.getTime() / 1000)
    const rawSig = signRequest(body, timestamp, TEST_SECRET)

    // Pass signature without the sha256= prefix
    const result = verifyRequest(body, timestamp, rawSig, TEST_SECRET)
    expect(result).toBe(false)
  })

  it('should return false when body has been tampered with', () => {
    const now = new Date('2026-01-15T12:00:00Z')
    vi.setSystemTime(now)

    const originalBody = '{"amount":1000}'
    const timestamp = Math.floor(now.getTime() / 1000)
    const rawSig = signRequest(originalBody, timestamp, TEST_SECRET)
    const signature = `sha256=${rawSig}`

    // Verify with tampered body
    const result = verifyRequest('{"amount":9999}', timestamp, signature, TEST_SECRET)
    expect(result).toBe(false)
  })

  it('should return false at exactly 61 seconds ago', () => {
    const now = new Date('2026-01-15T12:00:00Z')
    vi.setSystemTime(now)

    const body = '{"test":"boundary"}'
    // Exactly 61 seconds ago (just beyond 60s tolerance)
    const timestamp = Math.floor(now.getTime() / 1000) - 61
    const rawSig = signRequest(body, timestamp, TEST_SECRET)
    const signature = `sha256=${rawSig}`

    const result = verifyRequest(body, timestamp, signature, TEST_SECRET)
    expect(result).toBe(false)
  })

  it('should return true at exactly 59 seconds ago', () => {
    const now = new Date('2026-01-15T12:00:00Z')
    vi.setSystemTime(now)

    const body = '{"test":"within"}'
    const timestamp = Math.floor(now.getTime() / 1000) - 59
    const rawSig = signRequest(body, timestamp, TEST_SECRET)
    const signature = `sha256=${rawSig}`

    const result = verifyRequest(body, timestamp, signature, TEST_SECRET)
    expect(result).toBe(true)
  })
})

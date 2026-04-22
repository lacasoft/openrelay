import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the repository module before importing auth
vi.mock('../../lib/repository', () => ({
  findMerchantByApiKey: vi.fn(),
}))

import { findMerchantByApiKey } from '../../lib/repository.js'
import { authenticate, requireSecretKey } from '../../middleware/auth.js'

const mockedFindMerchant = vi.mocked(findMerchantByApiKey)

function makeMockRequest(headers: Record<string, string | undefined> = {}): any {
  return {
    headers,
    server: {
      db: {} as any,
    },
    merchantId: undefined as string | undefined,
    merchantWallet: undefined as string | undefined,
    apiKeyPrefix: undefined as string | undefined,
    isSecretKey: undefined as boolean | undefined,
  }
}

function makeMockReply(): any {
  const reply: any = {
    statusCode: 200,
    body: null,
  }
  reply.status = vi.fn((code: number) => {
    reply.statusCode = code
    return reply
  })
  reply.send = vi.fn((data: any) => {
    reply.body = data
    return reply
  })
  return reply
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

describe('authenticate middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when Authorization header is missing', async () => {
    const req = makeMockRequest({})
    const reply = makeMockReply()

    await authenticate(req, reply)

    expect(reply.status).toHaveBeenCalledWith(401)
    expect(reply.body.error.code).toBe('invalid_api_key')
    expect(reply.body.error.message).toContain('Missing or malformed')
  })

  it('should return 401 when Authorization header does not start with Bearer', async () => {
    const req = makeMockRequest({ authorization: 'Basic abc123' })
    const reply = makeMockReply()

    await authenticate(req, reply)

    expect(reply.status).toHaveBeenCalledWith(401)
    expect(reply.body.error.code).toBe('invalid_api_key')
  })

  it('should return 401 when API key has invalid prefix', async () => {
    const req = makeMockRequest({ authorization: 'Bearer invalid_prefix_key123' })
    const reply = makeMockReply()

    await authenticate(req, reply)

    expect(reply.status).toHaveBeenCalledWith(401)
    expect(reply.body.error.code).toBe('invalid_api_key')
    expect(reply.body.error.message).toContain('Invalid API key format')
  })

  it('should return 401 when API key is not found in database', async () => {
    const apiKey = 'pk_live_test1234567890abcdef'
    const req = makeMockRequest({ authorization: `Bearer ${apiKey}` })
    const reply = makeMockReply()

    mockedFindMerchant.mockResolvedValueOnce(null)

    await authenticate(req, reply)

    expect(mockedFindMerchant).toHaveBeenCalledWith({}, hashKey(apiKey))
    expect(reply.status).toHaveBeenCalledWith(401)
    expect(reply.body.error.code).toBe('invalid_api_key')
    expect(reply.body.error.message).toContain('Invalid or revoked')
  })

  it('should authenticate successfully with a valid pk_live_ key', async () => {
    const apiKey = 'pk_live_test1234567890abcdef'
    const req = makeMockRequest({ authorization: `Bearer ${apiKey}` })
    const reply = makeMockReply()

    mockedFindMerchant.mockResolvedValueOnce({
      merchant: {
        id: 'merchant_001',
        name: 'Test Merchant',
        email: 'test@example.com',
        wallet_address: '0xabc123',
        routing_mode: 'auto',
        min_node_stake: 0n,
        min_node_score: 0,
        created_at: new Date(),
      },
      key: {
        id: 'key_001',
        merchant_id: 'merchant_001',
        key_hash: hashKey(apiKey),
        key_prefix: 'pk_live_',
        label: null,
      },
    })

    await authenticate(req, reply)

    expect(req.merchantId).toBe('merchant_001')
    expect(req.merchantWallet).toBe('0xabc123')
    expect(req.apiKeyPrefix).toBe('pk_live_')
    expect(req.isSecretKey).toBe(false)
    // reply.status should NOT have been called for a successful auth
    expect(reply.status).not.toHaveBeenCalled()
  })

  it('should authenticate successfully with a valid sk_live_ key and set isSecretKey=true', async () => {
    const apiKey = 'sk_live_secret1234567890abcdef'
    const req = makeMockRequest({ authorization: `Bearer ${apiKey}` })
    const reply = makeMockReply()

    mockedFindMerchant.mockResolvedValueOnce({
      merchant: {
        id: 'merchant_002',
        name: 'Secret Merchant',
        email: 'secret@example.com',
        wallet_address: '0xdef456',
        routing_mode: 'auto',
        min_node_stake: 0n,
        min_node_score: 0,
        created_at: new Date(),
      },
      key: {
        id: 'key_002',
        merchant_id: 'merchant_002',
        key_hash: hashKey(apiKey),
        key_prefix: 'sk_live_',
        label: 'production',
      },
    })

    await authenticate(req, reply)

    expect(req.merchantId).toBe('merchant_002')
    expect(req.merchantWallet).toBe('0xdef456')
    expect(req.apiKeyPrefix).toBe('sk_live_')
    expect(req.isSecretKey).toBe(true)
  })

  it('should accept pk_test_ keys', async () => {
    const apiKey = 'pk_test_testkey1234567890'
    const req = makeMockRequest({ authorization: `Bearer ${apiKey}` })
    const reply = makeMockReply()

    mockedFindMerchant.mockResolvedValueOnce({
      merchant: {
        id: 'merchant_003',
        name: 'Test Mode Merchant',
        email: 'test@example.com',
        wallet_address: '0x111222',
        routing_mode: 'auto',
        min_node_stake: 0n,
        min_node_score: 0,
        created_at: new Date(),
      },
      key: {
        id: 'key_003',
        merchant_id: 'merchant_003',
        key_hash: hashKey(apiKey),
        key_prefix: 'pk_test_',
        label: null,
      },
    })

    await authenticate(req, reply)

    expect(req.merchantId).toBe('merchant_003')
    expect(req.isSecretKey).toBe(false)
  })

  it('should accept sk_test_ keys and set isSecretKey=true', async () => {
    const apiKey = 'sk_test_secrettest1234567890'
    const req = makeMockRequest({ authorization: `Bearer ${apiKey}` })
    const reply = makeMockReply()

    mockedFindMerchant.mockResolvedValueOnce({
      merchant: {
        id: 'merchant_004',
        name: 'Test Mode Secret',
        email: 'test@example.com',
        wallet_address: '0x333444',
        routing_mode: 'auto',
        min_node_stake: 0n,
        min_node_score: 0,
        created_at: new Date(),
      },
      key: {
        id: 'key_004',
        merchant_id: 'merchant_004',
        key_hash: hashKey(apiKey),
        key_prefix: 'sk_test_',
        label: null,
      },
    })

    await authenticate(req, reply)

    expect(req.isSecretKey).toBe(true)
  })

  it('should hash the API key with SHA-256 before looking it up', async () => {
    const apiKey = 'pk_live_uniquekey999'
    const expectedHash = hashKey(apiKey)
    const req = makeMockRequest({ authorization: `Bearer ${apiKey}` })
    const reply = makeMockReply()

    mockedFindMerchant.mockResolvedValueOnce(null)

    await authenticate(req, reply)

    expect(mockedFindMerchant).toHaveBeenCalledWith(expect.anything(), expectedHash)
  })

  it('should include doc_url in error responses', async () => {
    const req = makeMockRequest({})
    const reply = makeMockReply()

    await authenticate(req, reply)

    expect(reply.body.error.doc_url).toBe('https://docs.openrelay.dev/errors/invalid_api_key')
  })
})

describe('requireSecretKey middleware', () => {
  it('should return 403 when isSecretKey is false (public key)', () => {
    const req = makeMockRequest({}) as any
    req.isSecretKey = false
    const reply = makeMockReply()

    requireSecretKey(req, reply)

    expect(reply.status).toHaveBeenCalledWith(403)
    expect(reply.body.error.code).toBe('insufficient_permissions')
    expect(reply.body.error.message).toContain('secret API key')
  })

  it('should pass through when isSecretKey is true', async () => {
    const req = makeMockRequest({}) as any
    req.isSecretKey = true
    const reply = makeMockReply()

    const result = await requireSecretKey(req, reply)

    expect(reply.status).not.toHaveBeenCalled()
    expect(result).toBeUndefined()
  })

  it('should include doc_url in the 403 error', () => {
    const req = makeMockRequest({}) as any
    req.isSecretKey = false
    const reply = makeMockReply()

    requireSecretKey(req, reply)

    expect(reply.body.error.doc_url).toBe(
      'https://docs.openrelay.dev/errors/insufficient_permissions',
    )
  })
})

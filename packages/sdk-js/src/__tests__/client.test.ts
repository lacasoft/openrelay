import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { OpenRelay } from '../index.js'

function mockFetchResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  }
}

let client: OpenRelay

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  client = new OpenRelay({
    apiKey: 'sk_live_testkey1234567890',
    baseUrl: 'https://api.test.openrelay.dev',
    timeout: 5000,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('OpenRelay client initialization', () => {
  it('should throw when apiKey is not provided', () => {
    expect(() => new OpenRelay({ apiKey: '' })).toThrow('apiKey is required')
  })

  it('should use default baseUrl when not provided', () => {
    const c = new OpenRelay({ apiKey: 'sk_live_test123' })
    // We verify the default by making a request and checking the URL
    mockFetch.mockResolvedValueOnce(mockFetchResponse({ data: [], has_more: false }))

    void c.paymentIntents.list()

    // Allow the promise to resolve
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.openrelay.dev/v1/payment_intents'),
      expect.anything()
    )
  })

  it('should expose paymentIntents, webhooks, and x402 resources', () => {
    expect(client.paymentIntents).toBeDefined()
    expect(client.webhooks).toBeDefined()
    expect(client.x402).toBeDefined()
  })
})

describe('paymentIntents.create', () => {
  it('should send POST request to /v1/payment_intents with correct body', async () => {
    const mockIntent = {
      id: 'pi_abc123',
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      status: 'created',
      merchant_id: 'merchant_test',
      node_operator: null,
      payer_address: null,
      tx_hash: null,
      fee_amount: 5,
      metadata: { orderId: 'order_1' },
      created_at: 1700000000,
      expires_at: 1700001800,
      settled_at: null,
    }

    mockFetch.mockResolvedValueOnce(mockFetchResponse(mockIntent, 201))

    const result = await client.paymentIntents.create({
      amount: 1000,
      currency: 'usdc',
      chain: 'base',
      metadata: { orderId: 'order_1' },
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, opts] = mockFetch.mock.calls[0]!
    expect(url).toBe('https://api.test.openrelay.dev/v1/payment_intents')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Authorization']).toBe('Bearer sk_live_testkey1234567890')
    expect(opts.headers['Content-Type']).toBe('application/json')
    expect(opts.headers['OpenRelay-Version']).toBe('0.1')

    const sentBody = JSON.parse(opts.body)
    expect(sentBody.amount).toBe(1000)
    expect(sentBody.currency).toBe('usdc')
    expect(sentBody.chain).toBe('base')
    expect(sentBody.metadata).toEqual({ orderId: 'order_1' })

    expect(result.id).toBe('pi_abc123')
    expect(result.amount).toBe(1000)
  })

  it('should handle optional metadata and expires_in', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse({
      id: 'pi_minimal',
      amount: 500,
      currency: 'btc',
      chain: 'lightning',
      status: 'created',
    }, 201))

    await client.paymentIntents.create({
      amount: 500,
      currency: 'btc',
      chain: 'lightning',
    })

    const sentBody = JSON.parse(mockFetch.mock.calls[0]![1].body)
    expect(sentBody.amount).toBe(500)
    expect(sentBody.currency).toBe('btc')
    expect(sentBody.chain).toBe('lightning')
    // metadata should not be sent if not provided
    expect(sentBody.metadata).toBeUndefined()
  })
})

describe('paymentIntents.retrieve', () => {
  it('should send GET request to /v1/payment_intents/:id', async () => {
    const mockIntent = {
      id: 'pi_retrieve1',
      amount: 2000,
      currency: 'usdc',
      chain: 'base',
      status: 'pending_payment',
    }

    mockFetch.mockResolvedValueOnce(mockFetchResponse(mockIntent))

    const result = await client.paymentIntents.retrieve('pi_retrieve1')

    const [url, opts] = mockFetch.mock.calls[0]!
    expect(url).toBe('https://api.test.openrelay.dev/v1/payment_intents/pi_retrieve1')
    expect(opts.method).toBe('GET')
    expect(opts.body).toBeUndefined()
    expect(result.id).toBe('pi_retrieve1')
  })
})

describe('paymentIntents.cancel', () => {
  it('should send POST request to /v1/payment_intents/:id/cancel', async () => {
    const mockIntent = {
      id: 'pi_cancel1',
      amount: 3000,
      currency: 'usdc',
      chain: 'base',
      status: 'cancelled',
    }

    mockFetch.mockResolvedValueOnce(mockFetchResponse(mockIntent))

    const result = await client.paymentIntents.cancel('pi_cancel1')

    const [url, opts] = mockFetch.mock.calls[0]!
    expect(url).toBe('https://api.test.openrelay.dev/v1/payment_intents/pi_cancel1/cancel')
    expect(opts.method).toBe('POST')
    expect(result.status).toBe('cancelled')
  })
})

describe('paymentIntents.list', () => {
  it('should send GET request with pagination query params', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse({
      data: [],
      has_more: false,
    }))

    await client.paymentIntents.list({ limit: 25, starting_after: 'pi_cursor1' })

    const [url] = mockFetch.mock.calls[0]!
    expect(url).toContain('/v1/payment_intents?')
    expect(url).toContain('limit=25')
    expect(url).toContain('starting_after=pi_cursor1')
  })

  it('should send GET without query params when no options given', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse({
      data: [],
      has_more: false,
    }))

    await client.paymentIntents.list()

    const [url] = mockFetch.mock.calls[0]!
    expect(url).toBe('https://api.test.openrelay.dev/v1/payment_intents?')
  })

  it('should return data array and has_more flag', async () => {
    const mockData = {
      data: [
        { id: 'pi_1', amount: 100 },
        { id: 'pi_2', amount: 200 },
      ],
      has_more: true,
    }

    mockFetch.mockResolvedValueOnce(mockFetchResponse(mockData))

    const result = await client.paymentIntents.list({ limit: 2 })
    expect(result.data).toHaveLength(2)
    expect(result.has_more).toBe(true)
  })

  it('should handle limit-only param', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse({ data: [], has_more: false }))

    await client.paymentIntents.list({ limit: 50 })

    const [url] = mockFetch.mock.calls[0]!
    expect(url).toContain('limit=50')
    expect(url).not.toContain('starting_after')
  })
})

describe('error handling', () => {
  it('should throw the error object from API on non-OK response', async () => {
    const apiError = {
      error: {
        code: 'invalid_api_key',
        message: 'Invalid or revoked API key.',
        param: null,
        doc_url: 'https://docs.openrelay.dev/errors/invalid_api_key',
      },
    }

    mockFetch.mockResolvedValueOnce(mockFetchResponse(apiError, 401))

    await expect(client.paymentIntents.retrieve('pi_bad'))
      .rejects.toEqual(apiError.error)
  })

  it('should throw intent_not_found error on 404', async () => {
    const apiError = {
      error: {
        code: 'intent_not_found',
        message: 'No payment intent found.',
        param: 'id',
        doc_url: 'https://docs.openrelay.dev/errors/intent_not_found',
      },
    }

    mockFetch.mockResolvedValueOnce(mockFetchResponse(apiError, 404))

    await expect(client.paymentIntents.retrieve('pi_nonexistent'))
      .rejects.toMatchObject({ code: 'intent_not_found' })
  })

  it('should throw on network error from fetch', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'))

    await expect(client.paymentIntents.retrieve('pi_network_err'))
      .rejects.toThrow('Network failure')
  })
})

describe('timeout handling', () => {
  it('should create an AbortController with the configured timeout', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse({ id: 'pi_t' }))

    await client.paymentIntents.retrieve('pi_t')

    const [, opts] = mockFetch.mock.calls[0]!
    // The signal should be an AbortSignal
    expect(opts.signal).toBeDefined()
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it('should use default 30s timeout when not configured', async () => {
    const defaultClient = new OpenRelay({ apiKey: 'sk_live_default_timeout' })
    mockFetch.mockResolvedValueOnce(mockFetchResponse({ id: 'pi_def' }))

    await defaultClient.paymentIntents.retrieve('pi_def')

    const [, opts] = mockFetch.mock.calls[0]!
    expect(opts.signal).toBeDefined()
  })
})

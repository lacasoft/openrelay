import type { X402MiddlewareOptions, X402PaymentRequired } from '@openrelay/protocol'
import { USDC_BASE_ADDRESS } from '@openrelay/protocol'
import type { OpenRelayConfig } from '../lib/types'
import { request } from '../lib/types'

export class X402 {
  constructor(private config: OpenRelayConfig) {}

  /**
   * Returns a Fastify preHandler hook that requires x402 payment.
   *
   * @example
   * app.addHook('preHandler', relay.x402.middleware({
   *   price: 1000,       // $0.001 USDC
   *   currency: 'usdc',
   *   chain: 'base',
   * }))
   */
  middleware(opts: X402MiddlewareOptions): (req: Request, reply: Response) => Promise<Response | undefined> {
    return async (req: Request, _reply: Response): Promise<Response | undefined> => {
      const paymentHeader = req.headers instanceof Headers
        ? req.headers.get('x-payment')
        : (req.headers as Record<string, string>)['x-payment']

      if (!paymentHeader) {
        const body = this.buildPaymentRequired(opts, req.url)
        return new Response(JSON.stringify(body), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const valid = await this.verify(paymentHeader, opts)
      if (!valid) {
        return new Response(JSON.stringify({ error: 'Payment verification failed' }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Payment verified — request continues (middleware returns undefined)
      return undefined
    }
  }

  /**
   * Returns a Next.js App Router compatible handler that wraps a route with x402.
   *
   * @example
   * export const GET = relay.x402.handler({
   *   price: 1000,
   *   handler: async (req) => Response.json({ data: 'protected' })
   * })
   */
  handler(opts: X402MiddlewareOptions & { handler: (req: Request) => Promise<Response> }) {
    return async (req: Request): Promise<Response> => {
      const paymentHeader = req.headers instanceof Headers
        ? req.headers.get('x-payment')
        : (req.headers as unknown as Record<string, string>)['x-payment']

      if (!paymentHeader) {
        const body = this.buildPaymentRequired(opts, req.url)
        return new Response(JSON.stringify(body), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const valid = await this.verify(paymentHeader, opts)
      if (!valid) {
        return new Response(JSON.stringify({ error: 'Payment verification failed' }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return opts.handler(req)
    }
  }

  private buildPaymentRequired(opts: X402MiddlewareOptions, resource: string): X402PaymentRequired {
    return {
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: opts.chain === 'base' ? 'base' : opts.chain,
          maxAmountRequired: String(opts.price),
          resource,
          description: opts.description ?? 'API access',
          mimeType: 'application/json',
          payTo: this.config.merchantWallet ?? '',
          maxTimeoutSeconds: 300,
          asset: USDC_BASE_ADDRESS,
          extra: { name: 'USDC', version: '2' },
        },
      ],
    }
  }

  private async verify(paymentHeader: string, opts: X402MiddlewareOptions): Promise<boolean> {
    try {
      await request(this.config, {
        method: 'POST',
        path: '/x402/verify',
        body: { payment: paymentHeader, amount: opts.price, chain: opts.chain },
      })
      return true
    } catch {
      // Verification request failed (network error or non-2xx response) — treat as unverified
      return false
    }
  }
}

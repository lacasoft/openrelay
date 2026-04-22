import type { CreatePaymentIntentParams, PaymentIntent } from '@openrelay/protocol'
import type { OpenRelayConfig } from '../lib/types'
import { request } from '../lib/types'

export class PaymentIntents {
  constructor(private config: OpenRelayConfig) {}

  /**
   * Create a new payment intent.
   *
   * @example
   * const intent = await relay.paymentIntents.create({
   *   amount: 1000,      // $0.001000 USDC (6 decimals)
   *   currency: 'usdc',
   *   chain: 'base',
   *   metadata: { orderId: 'order_123' }
   * })
   */
  async create(params: CreatePaymentIntentParams): Promise<PaymentIntent> {
    return request<PaymentIntent>(this.config, {
      method: 'POST',
      path: '/payment_intents',
      body: params,
    })
  }

  /**
   * Retrieve a payment intent by ID.
   */
  async retrieve(id: string): Promise<PaymentIntent> {
    return request<PaymentIntent>(this.config, {
      method: 'GET',
      path: `/payment_intents/${id}`,
    })
  }

  /**
   * Cancel a payment intent (only valid before CONFIRMING state).
   */
  async cancel(id: string): Promise<PaymentIntent> {
    return request<PaymentIntent>(this.config, {
      method: 'POST',
      path: `/payment_intents/${id}/cancel`,
    })
  }

  /**
   * List payment intents for the authenticated merchant.
   */
  async list(params?: { limit?: number; starting_after?: string }): Promise<{
    data: PaymentIntent[]
    has_more: boolean
  }> {
    const qs = new URLSearchParams()
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.starting_after) qs.set('starting_after', params.starting_after)

    return request(this.config, {
      method: 'GET',
      path: `/payment_intents?${qs.toString()}`,
    })
  }
}

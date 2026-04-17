import { PaymentIntents } from './resources/payment-intents'
import { Webhooks } from './resources/webhooks'
import { X402 } from './x402/middleware'
import type { OpenRelayConfig } from './lib/types'

export class OpenRelay {
  private config: OpenRelayConfig

  readonly paymentIntents: PaymentIntents
  readonly webhooks: Webhooks
  readonly x402: X402

  constructor(config: OpenRelayConfig) {
    if (!config.apiKey) throw new Error('OpenRelay: apiKey is required')

    this.config = {
      baseUrl: config.baseUrl ?? 'https://api.openrelay.dev',
      apiKey: config.apiKey,
      timeout: config.timeout ?? 30_000,
      merchantWallet: config.merchantWallet,
    }

    this.paymentIntents = new PaymentIntents(this.config)
    this.webhooks = new Webhooks(this.config)
    this.x402 = new X402(this.config)
  }
}

export { OpenRelaySDKError } from '@openrelay/protocol'
export type {
  PaymentIntent,
  CreatePaymentIntentParams,
  WebhookEvent,
  X402MiddlewareOptions,
} from '@openrelay/protocol'

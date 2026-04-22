import { createHmac } from 'node:crypto'
import type { WebhookEvent } from '@openrelay/protocol'
import type { OpenRelayConfig } from '../lib/types'
import { request } from '../lib/types'

export class Webhooks {
  constructor(private config: OpenRelayConfig) {}

  async register(
    url: string,
    events: string[],
  ): Promise<{ id: string; url: string; secret: string }> {
    return request(this.config, {
      method: 'POST',
      path: '/webhooks',
      body: { url, events },
    })
  }

  /**
   * Verify a webhook payload signature.
   * Call this in your webhook handler to ensure the request is from OpenRelay.
   *
   * @example
   * const event = relay.webhooks.verify(rawBody, req.headers['openrelay-signature'], secret)
   */
  verify(payload: string, signature: string, secret: string): WebhookEvent {
    const parts = signature.split(',')
    const ts = parts.find((p) => p.startsWith('t='))?.slice(2)
    const sig = parts.find((p) => p.startsWith('v1='))?.slice(3)

    if (!ts || !sig) throw new Error('Invalid signature format')

    const expected = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex')

    if (expected !== sig) throw new Error('Signature verification failed')

    return JSON.parse(payload) as WebhookEvent
  }
}

import type { FastifyInstance } from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { updatePaymentIntentStatus, getPaymentIntent } from '../lib/repository'
import { deliverWebhook } from '../services/webhook'
import { apiError } from '../lib/errors'

const SettleSchema = z.object({
  tx_hash:     z.string().min(1),
  block_number: z.number().int().nonnegative(),
  settled_at:  z.number().int().positive(),
})

/**
 * Internal routes — called by the node daemon, not by merchants.
 * Protected by a shared HMAC secret, not by API keys.
 */
export async function internalRoute(app: FastifyInstance) {

  /**
   * POST /v1/internal/settle/:intentId
   * Called by the node watcher when a USDC transfer is confirmed on-chain.
   * Updates intent status → SETTLED and fires merchant webhooks.
   */
  app.post<{
    Params: { intentId: string }
    Body:   z.infer<typeof SettleSchema>
  }>('/internal/settle/:intentId', async (req, reply) => {
    // Verify the request comes from our node using the shared secret
    const internalSecret = req.headers['x-internal-secret'] as string | undefined
    const configSecret   = process.env['NODE_HMAC_SECRET'] ?? ''

    if (
      !internalSecret ||
      !configSecret ||
      internalSecret.length !== configSecret.length ||
      !timingSafeEqual(Buffer.from(internalSecret), Buffer.from(configSecret))
    ) {
      return reply.status(403).send(apiError('forbidden', 'Invalid or missing internal secret.'))
    }

    const { intentId } = req.params
    const params = SettleSchema.parse(req.body)
    const db     = req.server.db

    // Find the intent — we need merchant_id for webhooks
    // Internal endpoint doesn't have merchant context so we query directly
    const rows = await db`
      SELECT * FROM payment_intents WHERE id = ${intentId} LIMIT 1
    `

    const intentRow = rows[0]
    if (!intentRow) {
      return reply.status(404).send(apiError('intent_not_found', `No payment intent found with id ${intentId}.`, 'intentId'))
    }

    // Idempotency: ignore if already settled
    if (intentRow['status'] === 'settled') {
      return reply.send({ ok: true, already_settled: true })
    }

    // Update status in DB
    await updatePaymentIntentStatus(db, intentId, 'settled', {
      tx_hash:    params.tx_hash,
      settled_at: params.settled_at,
    })

    app.log.info({
      intent_id:    intentId,
      tx_hash:      params.tx_hash,
      block_number: params.block_number,
    }, 'Intent settled — firing webhooks')

    // Build full intent for webhook payload
    const rawMetadata = intentRow['metadata']
    const settledIntent = {
      ...intentRow,
      status:     'settled',
      tx_hash:    params.tx_hash,
      settled_at: params.settled_at,
      metadata:   typeof rawMetadata === 'string'
        ? JSON.parse(rawMetadata)
        : rawMetadata,
    }

    // Fire webhooks async — don't block the response
    void deliverWebhook({
      db,
      redis: req.server.redis,
      intentId,
      eventType:  'payment_intent.settled',
      merchantId: intentRow['merchant_id'] as string,
      data:       settledIntent,
    })

    return reply.send({ ok: true })
  })
}

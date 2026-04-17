import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { authenticate, requireSecretKey } from '../middleware/auth'
import {
  DEFAULT_INTENT_TTL_SECONDS,
  PROTOCOL_FEE_BPS,
} from '@openrelay/protocol'
import type { PaymentIntent } from '@openrelay/protocol'
import {
  insertPaymentIntent,
  getPaymentIntent,
  updatePaymentIntentStatus,
  listPaymentIntents,
} from '../lib/repository'
import { apiError } from '../lib/errors'

const CreateIntentSchema = z.object({
  amount:     z.number().int().positive(),
  currency:   z.enum(['usdc', 'btc']),
  chain:      z.enum(['base', 'lightning', 'polygon', 'auto']),
  metadata:   z.record(z.string()).optional().default({}),
  expires_in: z.number().int().positive().optional().default(DEFAULT_INTENT_TTL_SECONDS),
})

export async function paymentIntentsRoute(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // ── POST /v1/payment_intents ────────────────────────────────
  app.post<{ Body: z.infer<typeof CreateIntentSchema> }>(
    '/payment_intents',
    { preHandler: [requireSecretKey] },
    async (req, reply) => {
      const params = CreateIntentSchema.parse(req.body)
      const now    = Math.floor(Date.now() / 1000)
      const feeAmount = Math.floor(params.amount * (PROTOCOL_FEE_BPS / 10_000))

      const intent: PaymentIntent = {
        id:            `pi_${nanoid(24)}`,
        merchant_id:   req.merchantId,
        amount:        params.amount,
        currency:      params.currency,
        chain:         params.chain,
        status:        'created',
        node_operator: null,
        payer_address: null,
        tx_hash:       null,
        fee_amount:    feeAmount,
        metadata:      params.metadata,
        created_at:    now,
        expires_at:    now + params.expires_in,
        settled_at:    null,
      }

      const db = req.server.db
      await insertPaymentIntent(db, intent)

      // Trigger routing asynchronously — don't block the response
      setImmediate(() => {
        void triggerRouting(app, intent, req.merchantWallet)
      })

      return reply.status(201).send(intent)
    }
  )

  // ── GET /v1/payment_intents/:id ─────────────────────────────
  app.get<{ Params: { id: string } }>('/payment_intents/:id', async (req, reply) => {
    const db = req.server.db
    const intent = await getPaymentIntent(db, req.params.id, req.merchantId)
    if (!intent) {
      return reply.status(404).send(apiError(
        'intent_not_found',
        `No payment intent found with id ${req.params.id}.`,
        'id'
      ))
    }
    return reply.send(intent)
  })

  // ── POST /v1/payment_intents/:id/cancel ────────────────────
  app.post<{ Params: { id: string } }>(
    '/payment_intents/:id/cancel',
    { preHandler: [requireSecretKey] },
    async (req, reply) => {
      const db = req.server.db
      const intent = await getPaymentIntent(db, req.params.id, req.merchantId)
      if (!intent) {
        return reply.status(404).send(apiError('intent_not_found', `No payment intent found.`, 'id'))
      }
      const cancellable = ['created', 'routing', 'pending_payment']
      if (!cancellable.includes(intent.status)) {
        return reply.status(409).send(apiError(
          'intent_already_settled',
          `Cannot cancel an intent in ${intent.status} status.`
        ))
      }
      await updatePaymentIntentStatus(db, intent.id, 'cancelled')
      return reply.send({ ...intent, status: 'cancelled' })
    }
  )

  // ── GET /v1/payment_intents ─────────────────────────────────
  app.get<{ Querystring: { limit?: string; starting_after?: string } }>(
    '/payment_intents',
    async (req, reply) => {
      const limit = Math.min(Number(req.query.limit ?? 10), 100)
      const db = req.server.db
      const result = await listPaymentIntents(db, req.merchantId, limit, req.query.starting_after)
      return reply.send(result)
    }
  )
}

// ── Internal: trigger routing engine ──────────────────────────

async function triggerRouting(
  app: FastifyInstance,
  intent: PaymentIntent,
  merchantWallet: string
) {
  const db    = app.db
  const redis = app.redis

  try {
    await updatePaymentIntentStatus(db, intent.id, 'routing')

    // Get active nodes from cache or node list
    // Phase 1: uses bootstrap nodes from env
    // Phase 2: reads from NodeRegistry.sol via viem
    const bootstrapNode = process.env['BOOTSTRAP_NODE_ENDPOINT']
    if (!bootstrapNode) {
      app.log.warn({ intent_id: intent.id }, 'No bootstrap node configured — intent stays in ROUTING')
      return
    }

    // Send assignment request WITH HMAC signature
    const body      = JSON.stringify(intent)
    const timestamp = Math.floor(Date.now() / 1000)
    const hmacSecret = process.env['NODE_HMAC_SECRET'] ?? ''
    const { createHmac } = await import('node:crypto')
    const signature = createHmac('sha256', hmacSecret)
      .update(`${timestamp}.${body}`)
      .digest('hex')

    const res = await fetch(`${bootstrapNode}/intents/assign`, {
      method: 'POST',
      headers: {
        'Content-Type':          'application/json',
        'X-OpenRelay-Signature': `sha256=${signature}`,
        'X-OpenRelay-Timestamp': String(timestamp),
      },
      body,
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) throw new Error(`Node responded ${res.status}`)

    const assignment = await res.json() as { accepted: boolean; payment_address?: string }
    if (!assignment.accepted) {
      app.log.warn({ intent_id: intent.id }, 'Bootstrap node rejected intent')
      return
    }

    await updatePaymentIntentStatus(db, intent.id, 'pending_payment', {
      node_operator: bootstrapNode,
      payer_address: assignment.payment_address,
    })

    app.log.info({ intent_id: intent.id, payment_address: assignment.payment_address }, 'Intent routed')
  } catch (err) {
    app.log.error({ intent_id: intent.id, err }, 'Routing failed')
  }
}

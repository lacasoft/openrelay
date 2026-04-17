import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { createHash } from 'node:crypto'
import { authenticate, requireSecretKey } from '../middleware/auth'
import { insertWebhookEndpoint, listWebhookEndpoints } from '../lib/repository'
import { isPrivateUrl } from '../lib/ssrf'

const SUPPORTED_EVENTS = [
  'payment_intent.created', 'payment_intent.pending', 'payment_intent.confirming',
  'payment_intent.settled', 'payment_intent.failed', 'payment_intent.expired',
  'payment_intent.cancelled', 'dispute.opened', 'dispute.resolved',
] as const

const RegisterSchema = z.object({
  url:    z.string().url().refine(url => !isPrivateUrl(url), { message: 'Private/internal URLs are not allowed' }),
  events: z.array(z.enum(SUPPORTED_EVENTS)).min(1),
})

export async function webhooksRoute(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // ── POST /v1/webhooks ───────────────────────────────────────
  app.post<{ Body: z.infer<typeof RegisterSchema> }>(
    '/webhooks',
    { preHandler: [requireSecretKey] },
    async (req, reply) => {
      const params = RegisterSchema.parse(req.body)

      // Generate signing secret — returned once, never stored plaintext
      const secret      = `whsec_${nanoid(32)}`
      const secretHash  = createHash('sha256').update(secret).digest('hex')
      const id          = `we_${nanoid(16)}`

      const db = req.server.db
      await insertWebhookEndpoint(db, {
        id,
        merchant_id: req.merchantId,
        url:         params.url,
        secret_hash: secretHash,
        events:      params.events,
      })

      return reply.status(201).send({
        id,
        url:        params.url,
        events:     params.events,
        secret,                        // only time plaintext secret is returned
        created_at: Math.floor(Date.now() / 1000),
      })
    }
  )

  // ── GET /v1/webhooks ────────────────────────────────────────
  app.get('/webhooks', async (req, reply) => {
    const db = req.server.db
    const endpoints = await listWebhookEndpoints(db, req.merchantId)
    return reply.send({ data: endpoints, has_more: false })
  })

  // ── DELETE /v1/webhooks/:id ─────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/webhooks/:id',
    { preHandler: [requireSecretKey] },
    async (req, reply) => {
      const db = req.server.db
      await db`
        UPDATE webhook_endpoints
        SET deleted_at = NOW()
        WHERE id = ${req.params.id} AND merchant_id = ${req.merchantId}
      `
      return reply.status(204).send()
    }
  )
}

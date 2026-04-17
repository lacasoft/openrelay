import type { FastifyInstance } from 'fastify'
import { verifyRequest } from '../lib/hmac'

export async function healthRoute(app: FastifyInstance) {
  app.get('/health', async () => {
    return {
      status:  'ok',
      version: '0.1.0',
    }
  })
}

export async function infoRoute(app: FastifyInstance) {
  app.get('/info', async (req, reply) => {
    const config = app.config

    // If HMAC signature is present, verify it; if absent, return reduced response
    const signature = req.headers['x-openrelay-signature'] as string | undefined
    const timestamp = req.headers['x-openrelay-timestamp'] as string | undefined
    const hmacSecret = process.env['NODE_HMAC_SECRET'] ?? ''

    if (!signature || !timestamp) {
      // No credentials — return minimal public info only
      return reply.send({ status: 'ok', version: '0.1.0' })
    }

    // Verify HMAC signature
    const body = '' // GET requests have no body
    const isValid = verifyRequest(body, Number(timestamp), signature, hmacSecret)
    if (!isValid) {
      return reply.status(403).send({ error: { code: 'forbidden', message: 'Invalid HMAC signature.', param: null, doc_url: 'https://docs.openrelay.dev/errors/forbidden' } })
    }

    // Authenticated — return full operator details
    const store  = app.store
    const stats  = store.getStats()

    const now = Math.floor(Date.now() / 1000)
    const uptimeSeconds = now - stats.uptime_start
    const uptime30d     = Math.min(uptimeSeconds / (30 * 24 * 3600), 1)

    return reply.send({
      operator:          config.operatorAddress,
      version:           '0.1.0',
      uptime_30d:        Number(uptime30d.toFixed(4)),
      avg_settlement_ms: stats.avg_settlement_ms,
      total_settled:     stats.total_settled,
      stake:             '100000000',   // TODO Phase 2: read from StakeManager.sol
    })
  })
}

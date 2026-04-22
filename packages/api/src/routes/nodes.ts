import type { FastifyInstance } from 'fastify'
import { apiError } from '../lib/errors'
import { authenticate } from '../middleware/auth'

export async function nodesRoute(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  /**
   * GET /v1/nodes
   * Returns active nodes with their current scores.
   * Phase 1: reads from env bootstrap nodes.
   * Phase 2: reads from NodeRegistry.sol via viem + augments with Redis scores.
   */
  app.get('/nodes', async (_, reply) => {
    const bootstrapEndpoint = process.env.BOOTSTRAP_NODE_ENDPOINT

    if (!bootstrapEndpoint) {
      return reply.send({ data: [], total: 0 })
    }

    try {
      const res = await fetch(`${bootstrapEndpoint}/info`, { signal: AbortSignal.timeout(3000) })
      const info = (await res.json()) as Record<string, unknown>
      return reply.send({
        data: [{ ...info, endpoint: bootstrapEndpoint, score: 1.0, is_bootstrap: true }],
        total: 1,
      })
    } catch (err) {
      app.log.error({ err }, 'failed to list nodes')
      return reply.status(502).send(apiError('node_unavailable', 'Bootstrap node is unreachable.'))
    }
  })

  /**
   * GET /v1/nodes/:operator
   * Returns details for a specific node operator address.
   */
  app.get<{ Params: { operator: string } }>('/nodes/:operator', async (req, reply) => {
    return reply
      .status(404)
      .send(
        apiError(
          'node_not_registered',
          `No node found for operator ${req.params.operator}.`,
          'operator',
        ),
      )
  })
}

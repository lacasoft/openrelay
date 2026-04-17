import type { Config } from '../lib/config'
import type { NodeStore } from '../lib/store'

declare module 'fastify' {
  interface FastifyInstance {
    config: Config
    store: NodeStore
  }
}

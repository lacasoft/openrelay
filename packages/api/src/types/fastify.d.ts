import type { Redis } from 'ioredis'
import type { Sql } from 'postgres'
import type { AppConfig } from '../lib/config'

declare module 'fastify' {
  interface FastifyInstance {
    db: Sql
    redis: Redis
    config: AppConfig
  }

  interface FastifyRequest {
    merchantId: string
    merchantWallet: string
    apiKeyPrefix: string
    isSecretKey: boolean
  }
}

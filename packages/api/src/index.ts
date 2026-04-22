import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'
import { loadConfig } from './lib/config'
import { buildDb } from './lib/db'
import { buildRedis } from './lib/redis'
import { internalRoute } from './routes/internal'
import { nodesRoute } from './routes/nodes'
import { paymentIntentsRoute } from './routes/payment-intents'
import { webhooksRoute } from './routes/webhooks'
import { x402Route } from './routes/x402'
import { startWebhookWorker } from './services/webhook'

const RATE_LIMIT_MAX = 100
const RATE_LIMIT_WINDOW = '1 minute'

const config = loadConfig()
const db = buildDb(config.databaseUrl)
const redis = buildRedis(config.redisUrl)

const isDev = process.env.NODE_ENV !== 'production'
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    ...(isDev && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  },
})

// ── Decorators (inject db + redis into all routes) ────────────
app.decorate('db', db)
app.decorate('redis', redis)
app.decorate('config', config)

async function main() {
  // ── Plugins ───────────────────────────────────────────────────
  await app.register(cors, { origin: config.corsOrigin })

  await app.register(rateLimit, {
    redis,
    max: RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW,
    keyGenerator: (req) => {
      const auth = req.headers.authorization ?? ''
      return auth.slice(7, 23) // use key prefix for rate limiting, not full key
    },
  })

  // ── Routes ────────────────────────────────────────────────────
  app.register(paymentIntentsRoute, { prefix: '/v1' })
  app.register(webhooksRoute, { prefix: '/v1' })
  app.register(x402Route, { prefix: '/v1' })
  app.register(nodesRoute, { prefix: '/v1' })
  app.register(internalRoute, { prefix: '/v1' }) // node → API callbacks

  // ── Health ────────────────────────────────────────────────────
  app.get('/health', async () => {
    let dbOk = false
    let redisOk = false

    try {
      await db`SELECT 1`
      dbOk = true
    } catch (err) {
      app.log.debug({ err }, 'health check: db unreachable')
    }

    try {
      await redis.ping()
      redisOk = true
    } catch (err) {
      app.log.debug({ err }, 'health check: redis unreachable')
    }

    return {
      status: dbOk && redisOk ? 'ok' : 'degraded',
      version: '0.1.0',
      services: { postgres: dbOk, redis: redisOk },
    }
  })

  // ── Webhook retry worker ─────────────────────────────────────
  const webhookWorker = startWebhookWorker(redis, db)

  // ── Graceful shutdown ─────────────────────────────────────────
  const shutdown = async () => {
    app.log.info('Shutting down...')
    webhookWorker.stop()
    await app.close()
    await db.end()
    await redis.quit()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  // ── Start ─────────────────────────────────────────────────────
  await app.listen({ port: config.port, host: '0.0.0.0' })
  app.log.info(`OpenRelay API v0.1.0 — port ${config.port}`)
}

main().catch((err) => {
  app.log.error(err)
  process.exit(1)
})

import { createHmac } from 'node:crypto'
import { pino } from 'pino'
import type { Sql } from 'postgres'
import type Redis from 'ioredis'
import type { PaymentIntent } from '@openrelay/protocol'
import { getActiveWebhooksForEvent } from '../lib/repository'

const logger = pino({ name: 'webhook' })

interface DeliveryOptions {
  db:         Sql
  redis:      Redis
  intentId:   string
  eventType:  string
  merchantId: string
  data:       PaymentIntent | Record<string, unknown>
}

interface WebhookJob {
  endpoint:  { id: string; url: string; secret_hash: string }
  payload:   string
  attempt:   number
}

const MAX_ATTEMPTS  = 6
const RETRY_DELAYS  = [30_000, 300_000, 1_800_000, 7_200_000, 43_200_000]
// Delays:           30s     5min     30min      2h         12h

const PENDING_KEY = 'webhook:pending'
const RETRY_KEY   = 'webhook:retry'

const RETRY_POLL_INTERVAL_MS = 5_000

/**
 * Fires a webhook event to all registered endpoints for the merchant.
 * Persists jobs in Redis so retries survive process crashes.
 * Non-blocking: schedules retries via Redis sorted set, never throws.
 */
export async function deliverWebhook(opts: DeliveryOptions): Promise<void> {
  const { db, redis, eventType, merchantId, data } = opts

  const endpoints = await getActiveWebhooksForEvent(db, merchantId, eventType)
  if (endpoints.length === 0) return

  const eventId  = `evt_${Date.now().toString(36)}`
  const payload  = JSON.stringify({
    id:      eventId,
    type:    eventType,
    created: Math.floor(Date.now() / 1000),
    data,
  })

  for (const endpoint of endpoints) {
    const job: WebhookJob = { endpoint, payload, attempt: 0 }

    // Push to pending list for immediate processing
    await redis.lpush(PENDING_KEY, JSON.stringify(job))
  }

  // Process pending jobs immediately (callers use `void deliverWebhook(...)` to avoid blocking)
  await processPendingQueue(redis)
}

/**
 * Process all jobs in the pending queue (immediate delivery attempts).
 */
async function processPendingQueue(redis: Redis): Promise<void> {
  let raw: string | null
  while ((raw = await redis.rpop(PENDING_KEY)) !== null) {
    try {
      const job: WebhookJob = JSON.parse(raw)
      await attemptDelivery(redis, job)
    } catch (err) {
      logger.error({ err, raw }, 'Failed to process pending webhook job')
    }
  }
}

/**
 * Attempt to deliver a single webhook job.
 * On failure, schedules a retry in the Redis sorted set.
 */
async function attemptDelivery(redis: Redis, job: WebhookJob): Promise<void> {
  const { endpoint, payload, attempt } = job

  if (attempt >= MAX_ATTEMPTS) {
    logger.error({ endpoint_id: endpoint.id, attempts: MAX_ATTEMPTS }, 'Endpoint failed after max attempts')
    return
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', endpoint.secret_hash)
    .update(`${timestamp}.${payload}`)
    .digest('hex')

  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type':          'application/json',
        'OpenRelay-Signature':   `t=${timestamp},v1=${signature}`,
        'OpenRelay-Webhook-Id':  endpoint.id,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    })

    if (res.ok) {
      logger.info({ url: endpoint.url, attempt: attempt + 1 }, 'Webhook delivered')
      return
    }

    logger.warn({ url: endpoint.url, status: res.status }, 'Webhook endpoint responded with error — scheduling retry')
  } catch (err) {
    logger.warn({ url: endpoint.url, err }, 'Webhook endpoint unreachable — scheduling retry')
  }

  // Schedule retry in sorted set with score = next retry timestamp (ms)
  const delayIndex = Math.min(attempt, RETRY_DELAYS.length - 1)
  const delay = RETRY_DELAYS[delayIndex] ?? 30_000
  const retryAt = Date.now() + delay
  const retryJob: WebhookJob = { endpoint, payload, attempt: attempt + 1 }
  await redis.zadd(RETRY_KEY, retryAt, JSON.stringify(retryJob))
}

/**
 * Process retry queue: picks up jobs whose scheduled time has passed.
 */
async function processRetryQueue(redis: Redis): Promise<void> {
  const now = Date.now()

  // Fetch all jobs due for retry (score <= now)
  const dueJobs = await redis.zrangebyscore(RETRY_KEY, 0, now)

  for (const raw of dueJobs) {
    // Atomically remove from sorted set — only process if removal succeeds (avoids double-processing)
    const removed = await redis.zrem(RETRY_KEY, raw)
    if (removed === 0) continue

    try {
      const job: WebhookJob = JSON.parse(raw)
      await attemptDelivery(redis, job)
    } catch (err) {
      logger.error({ err, raw }, 'Failed to process retry webhook job')
    }
  }
}

/**
 * Starts the webhook retry worker.
 * Polls the Redis retry sorted set on an interval for due jobs.
 * Also drains any pending jobs left from a previous crash.
 */
export function startWebhookWorker(redis: Redis, _db: Sql): { stop: () => void } {
  logger.info('Webhook retry worker started')

  // Drain any pending jobs left from a previous crash
  void processPendingQueue(redis)

  const interval = setInterval(() => {
    void processRetryQueue(redis)
  }, RETRY_POLL_INTERVAL_MS)

  return {
    stop() {
      clearInterval(interval)
      logger.info('Webhook retry worker stopped')
    },
  }
}

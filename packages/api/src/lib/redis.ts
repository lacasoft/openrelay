import Redis from 'ioredis'

const REDIS_MAX_RETRIES = 3
const REDIS_RETRY_DELAY_MS = 3000

/**
 * Creates a Redis client configured for the OpenRelay API.
 *
 * @example
 * const redis = buildRedis(process.env.REDIS_URL)
 */
export function buildRedis(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: REDIS_MAX_RETRIES,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 100, REDIS_RETRY_DELAY_MS),
  })
}

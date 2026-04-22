import postgres from 'postgres'

const DB_POOL_MAX = 10
const DB_IDLE_TIMEOUT = 20
const DB_MAX_LIFETIME = 10

/**
 * Creates a postgres.js SQL client.
 *
 * @example
 * const db = buildDb(process.env.DATABASE_URL)
 * const rows = await db`SELECT 1`
 */
export function buildDb(url: string) {
  return postgres(url, {
    max: DB_POOL_MAX,
    idle_timeout: DB_IDLE_TIMEOUT,
    connect_timeout: DB_MAX_LIFETIME,
    onnotice: () => {}, // suppress NOTICE messages
  })
}

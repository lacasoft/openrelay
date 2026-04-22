/**
 * OpenRelay seed script
 * Creates the first merchant account with API keys.
 * Run via: docker compose exec api node dist/scripts/seed.js
 * Or:      make seed
 */
import { createHash, randomBytes } from 'node:crypto'
import { pino } from 'pino'
import postgres from 'postgres'

const logger = pino({ name: 'seed' })

const db = postgres(
  process.env.DATABASE_URL ?? 'postgresql://openrelay:openrelay@localhost:5432/openrelay',
)

function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`
}

function generateApiKey(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`
}

async function seed() {
  logger.info('OpenRelay Seed Script')

  // Check if already seeded
  const existing = await db`SELECT COUNT(*) as count FROM merchants`
  if (Number(existing[0]?.count) > 0) {
    logger.warn(
      'Merchant already exists. Seed has already been executed. To start over: make clean && make up && make seed',
    )
    await db.end()
    return
  }

  // Generate merchant
  const merchantId = generateId('mid')
  const walletAddress = process.env.MERCHANT_WALLET ?? '0x0000000000000000000000000000000000000000'

  await db`
    INSERT INTO merchants (id, name, email, wallet_address, routing_mode)
    VALUES (
      ${merchantId},
      ${'Mi Primer Negocio'},
      ${'admin@example.com'},
      ${walletAddress},
      ${'auto'}
    )
  `

  // Generate API keys
  const skLive = generateApiKey('sk_live')
  const pkLive = generateApiKey('pk_live')
  const skTest = generateApiKey('sk_test')
  const pkTest = generateApiKey('pk_test')

  const keys = [
    { key: skLive, prefix: 'sk_live', label: 'Default secret key (live)' },
    { key: pkLive, prefix: 'pk_live', label: 'Default public key (live)' },
    { key: skTest, prefix: 'sk_test', label: 'Default secret key (test)' },
    { key: pkTest, prefix: 'pk_test', label: 'Default public key (test)' },
  ]

  for (const { key, prefix, label } of keys) {
    await db`
      INSERT INTO api_keys (id, merchant_id, key_hash, key_prefix, label)
      VALUES (
        ${generateId('key')},
        ${merchantId},
        ${createHash('sha256').update(key).digest('hex')},
        ${prefix},
        ${label}
      )
    `
  }

  logger.info({ merchant_id: merchantId, wallet: walletAddress }, 'Merchant created successfully')
  logger.info(
    {
      sk_live: skLive,
      pk_live: pkLive,
      sk_test: skTest,
      pk_test: pkTest,
    },
    'API keys generated (store them now — they will not be shown again)',
  )
  logger.info('Next step: integrate the SDK into your project. Docs: https://docs.openrelay.dev')

  await db.end()
}

seed().catch((err) => {
  logger.error({ err }, 'Seed failed')
  process.exit(1)
})

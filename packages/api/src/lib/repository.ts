import type { PaymentIntent, PaymentIntentStatus } from '@openrelay/protocol'
import type { Sql } from 'postgres'

// ── Merchants ──────────────────────────────────────────────────

export interface Merchant {
  id: string
  name: string
  email: string
  wallet_address: string
  routing_mode: string
  min_node_stake: bigint
  min_node_score: number
  created_at: Date
}

export interface ApiKey {
  id: string
  merchant_id: string
  key_hash: string
  key_prefix: string
  label: string | null
}

export async function findMerchantByApiKey(
  db: Sql,
  keyHash: string,
): Promise<{ merchant: Merchant; key: ApiKey } | null> {
  const rows = await db`
    SELECT
      m.id, m.name, m.email, m.wallet_address, m.routing_mode,
      m.min_node_stake, m.min_node_score, m.created_at,
      k.id as key_id, k.key_hash, k.key_prefix, k.label
    FROM api_keys k
    JOIN merchants m ON m.id = k.merchant_id
    WHERE k.key_hash = ${keyHash}
      AND k.revoked_at IS NULL
    LIMIT 1
  `
  if (rows.length === 0) return null
  const row = rows[0]
  if (!row) return null
  return {
    merchant: {
      id: row.id,
      name: row.name,
      email: row.email,
      wallet_address: row.wallet_address,
      routing_mode: row.routing_mode,
      min_node_stake: BigInt(row.min_node_stake),
      min_node_score: Number(row.min_node_score),
      created_at: row.created_at,
    },
    key: {
      id: row.key_id,
      merchant_id: row.id,
      key_hash: row.key_hash,
      key_prefix: row.key_prefix,
      label: row.label,
    },
  }
}

export async function createMerchant(
  db: Sql,
  params: { id: string; name: string; email: string; wallet_address: string },
): Promise<Merchant> {
  const rows = await db`
    INSERT INTO merchants (id, name, email, wallet_address)
    VALUES (${params.id}, ${params.name}, ${params.email}, ${params.wallet_address})
    RETURNING *
  `
  const row = rows[0]
  if (!row) throw new Error('INSERT RETURNING returned no rows')
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    wallet_address: row.wallet_address,
    routing_mode: row.routing_mode,
    min_node_stake: BigInt(row.min_node_stake),
    min_node_score: Number(row.min_node_score),
    created_at: row.created_at,
  } as Merchant
}

export async function createApiKey(
  db: Sql,
  params: { id: string; merchant_id: string; key_hash: string; key_prefix: string; label?: string },
): Promise<void> {
  await db`
    INSERT INTO api_keys (id, merchant_id, key_hash, key_prefix, label)
    VALUES (${params.id}, ${params.merchant_id}, ${params.key_hash}, ${params.key_prefix}, ${params.label ?? null})
  `
}

// ── Payment Intents ────────────────────────────────────────────

export async function insertPaymentIntent(db: Sql, intent: PaymentIntent): Promise<void> {
  await db`
    INSERT INTO payment_intents (
      id, merchant_id, amount, currency, chain, status,
      node_operator, payer_address, tx_hash, fee_amount,
      metadata, created_at, expires_at, settled_at
    ) VALUES (
      ${intent.id},
      ${intent.merchant_id},
      ${intent.amount},
      ${intent.currency},
      ${intent.chain},
      ${intent.status},
      ${intent.node_operator},
      ${intent.payer_address},
      ${intent.tx_hash},
      ${intent.fee_amount},
      ${JSON.stringify(intent.metadata)},
      to_timestamp(${intent.created_at}),
      to_timestamp(${intent.expires_at}),
      ${intent.settled_at ? `to_timestamp(${intent.settled_at})` : null}
    )
  `
}

export async function getPaymentIntent(
  db: Sql,
  id: string,
  merchantId: string,
): Promise<PaymentIntent | null> {
  const rows = await db`
    SELECT * FROM payment_intents
    WHERE id = ${id} AND merchant_id = ${merchantId}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return null
  return rowToIntent(row)
}

export async function updatePaymentIntentStatus(
  db: Sql,
  id: string,
  status: PaymentIntentStatus,
  extra: Partial<{
    node_operator: string
    payer_address: string
    tx_hash: string
    settled_at: number
  }> = {},
): Promise<void> {
  await db`
    UPDATE payment_intents SET
      status = ${status},
      node_operator  = COALESCE(${extra.node_operator ?? null}, node_operator),
      payer_address  = COALESCE(${extra.payer_address ?? null}, payer_address),
      tx_hash        = COALESCE(${extra.tx_hash ?? null}, tx_hash),
      settled_at     = COALESCE(to_timestamp(${extra.settled_at ?? null}), settled_at)
    WHERE id = ${id}
  `
}

export async function listPaymentIntents(
  db: Sql,
  merchantId: string,
  limit: number,
  startingAfter?: string,
): Promise<{ data: PaymentIntent[]; has_more: boolean }> {
  let rows: Awaited<ReturnType<typeof db>>
  if (startingAfter) {
    rows = await db`
      SELECT * FROM payment_intents
      WHERE merchant_id = ${merchantId}
        AND created_at < (
          SELECT created_at FROM payment_intents WHERE id = ${startingAfter}
        )
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
    `
  } else {
    rows = await db`
      SELECT * FROM payment_intents
      WHERE merchant_id = ${merchantId}
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
    `
  }
  const has_more = rows.length > limit
  const data = rows.slice(0, limit).map(rowToIntent)
  return { data, has_more }
}

// ── Webhook Endpoints ──────────────────────────────────────────

export async function insertWebhookEndpoint(
  db: Sql,
  params: {
    id: string
    merchant_id: string
    url: string
    secret_hash: string
    events: string[]
  },
): Promise<void> {
  await db`
    INSERT INTO webhook_endpoints (id, merchant_id, url, secret_hash, events)
    VALUES (${params.id}, ${params.merchant_id}, ${params.url}, ${params.secret_hash}, ${params.events})
  `
}

export async function listWebhookEndpoints(
  db: Sql,
  merchantId: string,
): Promise<{ id: string; url: string; events: string[] }[]> {
  const rows = await db`
    SELECT id, url, events FROM webhook_endpoints
    WHERE merchant_id = ${merchantId} AND deleted_at IS NULL
    ORDER BY created_at DESC
  `
  return rows.map((row) => ({
    id: row.id as string,
    url: row.url as string,
    events: row.events as string[],
  }))
}

export async function getActiveWebhooksForEvent(
  db: Sql,
  merchantId: string,
  eventType: string,
): Promise<{ id: string; url: string; secret_hash: string }[]> {
  const rows = await db`
    SELECT id, url, secret_hash FROM webhook_endpoints
    WHERE merchant_id = ${merchantId}
      AND deleted_at IS NULL
      AND ${eventType} = ANY(events)
  `
  return rows.map((row) => ({
    id: row.id as string,
    url: row.url as string,
    secret_hash: row.secret_hash as string,
  }))
}

// ── x402 Replay Protection ─────────────────────────────────────

export async function markX402TxUsed(db: Sql, txHash: string, chain: string): Promise<boolean> {
  try {
    await db`
      INSERT INTO x402_payments_used (tx_hash, chain)
      VALUES (${txHash}, ${chain})
    `
    return true
  } catch {
    // Unique constraint violation = already used
    return false
  }
}

// ── Internal helpers ───────────────────────────────────────────

function rowToIntent(row: Record<string, unknown>): PaymentIntent {
  return {
    id: row.id as string,
    merchant_id: row.merchant_id as string,
    amount: Number(row.amount),
    currency: row.currency as 'usdc' | 'btc',
    chain: row.chain as 'base' | 'lightning',
    status: row.status as PaymentIntentStatus,
    node_operator: (row.node_operator as string | null) ?? null,
    payer_address: (row.payer_address as string | null) ?? null,
    tx_hash: (row.tx_hash as string | null) ?? null,
    fee_amount: Number(row.fee_amount),
    metadata:
      typeof row.metadata === 'string'
        ? JSON.parse(row.metadata)
        : (row.metadata as Record<string, string>),
    created_at: Math.floor(new Date(row.created_at as string).getTime() / 1000),
    expires_at: Math.floor(new Date(row.expires_at as string).getTime() / 1000),
    settled_at: row.settled_at
      ? Math.floor(new Date(row.settled_at as string).getTime() / 1000)
      : null,
  }
}

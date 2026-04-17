import type { FastifyRequest, FastifyReply } from 'fastify'
import { createHash } from 'node:crypto'
import { findMerchantByApiKey } from '../lib/repository'
import { apiError } from '../lib/errors'

/**
 * Authenticates requests using Bearer API keys.
 * Hashes the key with SHA-256 and looks it up in the database.
 * Attaches merchant context to the request for use in route handlers.
 *
 * @example
 * app.addHook('preHandler', authenticate)
 */
export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers['authorization']
  if (!auth?.startsWith('Bearer ')) {
    return reply.status(401).send(apiError('invalid_api_key', 'Missing or malformed Authorization header.'))
  }

  const apiKey = auth.slice(7)
  const validPrefixes = ['pk_live_', 'sk_live_', 'pk_test_', 'sk_test_']
  if (!validPrefixes.some(p => apiKey.startsWith(p))) {
    return reply.status(401).send(apiError('invalid_api_key', 'Invalid API key format.'))
  }

  const keyHash = createHash('sha256').update(apiKey).digest('hex')
  const db = req.server.db
  const result = await findMerchantByApiKey(db, keyHash)

  if (!result) {
    return reply.status(401).send(apiError('invalid_api_key', 'Invalid or revoked API key.'))
  }

  req.merchantId     = result.merchant.id
  req.merchantWallet = result.merchant.wallet_address
  req.apiKeyPrefix   = result.key.key_prefix
  req.isSecretKey    = result.key.key_prefix.startsWith('sk_')
}

export function requireSecretKey(req: FastifyRequest, reply: FastifyReply) {
  if (!req.isSecretKey) {
    return reply.status(403).send(apiError(
      'insufficient_permissions',
      'This action requires a secret API key (sk_live_xxx).'
    ))
  }
  return
}

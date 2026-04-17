import type { FastifyInstance } from 'fastify'
import type { IntentAssignmentRequest, IntentAssignmentResponse } from '@openrelay/protocol'
import { PROTOCOL_FEE_BPS, NODE_FEE_SHARE } from '@openrelay/protocol'
import { verifyRequest } from '../lib/hmac'
import { createChainClient, verifyUsdcTransfer, type ChainClient } from '../lib/chain-verify'
import { keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

/**
 * Derives a unique, deterministic payment address for each intent.
 * Uses keccak256(operatorPrivateKey + intentIndex) as a child private key,
 * then derives the corresponding Ethereum address via viem.
 * This is cryptographically secure: keccak256 of private key material + index
 * produces a unique, unpredictable child key per intent.
 */
function derivePaymentAddress(operatorPrivateKey: string, intentIndex: number): `0x${string}` {
  const seed = keccak256(
    toHex(new Uint8Array([
      ...Buffer.from(operatorPrivateKey.slice(2), 'hex'),
      ...Buffer.from(intentIndex.toString()),
    ])),
  )
  const account = privateKeyToAccount(seed as `0x${string}`)
  return account.address
}

export async function intentsRoute(app: FastifyInstance) {
  const config = app.config
  const store  = app.store

  // Create chain client for on-chain verification (null in dev mode)
  const isDevMode = config.nodeRegistryAddress === '0x0000000000000000000000000000000000000000'
  const chainClient: ChainClient | null = isDevMode
    ? null
    : createChainClient(config.baseRpcUrl, config.baseRpcUrl.includes('sepolia'))

  // ── POST /intents/assign ─────────────────────────────────────
  app.post<{ Body: IntentAssignmentRequest }>(
    '/intents/assign',
    async (req, reply): Promise<IntentAssignmentResponse> => {
      // Verify HMAC signature
      const signature = req.headers['x-openrelay-signature'] as string | undefined
      const timestamp = Number(req.headers['x-openrelay-timestamp'] ?? '0')
      const body      = JSON.stringify(req.body)

      if (signature && config.hmacSecret) {
        const valid = verifyRequest(body, timestamp, signature, config.hmacSecret)
        if (!valid) {
          reply.status(401)
          return { accepted: false, reason: 'invalid_signature' }
        }
      }

      const intent = req.body

      // Reject expired intents
      if (intent.expires_at < Math.floor(Date.now() / 1000)) {
        return { accepted: false, reason: 'intent_expired' }
      }

      // Check capacity (Phase 1: simple in-memory count)
      // Phase 2: read from store and compute real capacity
      const MAX_CONCURRENT = 100
      const assigned = (store.getStats().total_settled) // placeholder
      if (assigned >= MAX_CONCURRENT) {
        return { accepted: false, reason: 'at_capacity' }
      }

      // Generate unique payment address for this intent via HD-style derivation
      const intentIndex      = store.getNextIndex()
      const paymentAddress   = derivePaymentAddress(config.privateKey, intentIndex)

      // Calculate fee this node will earn
      const totalFee = Math.floor(intent.amount * (PROTOCOL_FEE_BPS / 10_000))
      const nodeFee  = Math.floor(totalFee * NODE_FEE_SHARE)

      // Persist assignment
      store.insertAssignment({
        intent_id:        intent.intent_id,
        amount:           intent.amount,
        currency:         intent.currency,
        chain:            intent.chain,
        merchant_address: intent.merchant_address,
        payment_address:  paymentAddress,
        status:           'assigned',
        tx_hash:          null,
        intent_index:     intentIndex,
      })

      app.log.info({
        intent_id: intent.intent_id,
        amount:    intent.amount,
        currency:  intent.currency,
        address:   paymentAddress,
      }, 'Intent assigned')

      return {
        accepted:        true,
        payment_address: paymentAddress,
        node_fee:        nodeFee,
      }
    }
  )

  // ── POST /intents/:id/settle ─────────────────────────────────
  app.post<{
    Params: { id: string }
    Body: { tx_hash: string; block_number: number; settled_at: number }
  }>(
    '/intents/:id/settle',
    async (req, reply) => {
      const { id } = req.params
      const { tx_hash, block_number } = req.body

      const assignment = store.getAssignment(id)
      if (!assignment) {
        reply.status(404)
        return { confirmed: false, error: 'intent_not_found' }
      }

      // Verify the transaction on-chain via viem (skipped in dev mode)
      if (chainClient) {
        const verification = await verifyUsdcTransfer(
          chainClient,
          tx_hash as `0x${string}`,
          assignment.payment_address,
          assignment.amount,
          config.usdcAddress,
        )
        if (!verification.valid) {
          reply.status(400)
          return { confirmed: false, error: 'chain_verification_failed', reason: verification.reason }
        }
      }

      store.updateAssignment(id, 'settled', tx_hash)

      app.log.info({
        intent_id:    id,
        tx_hash:      tx_hash,
        block_number: block_number,
      }, 'Settlement confirmed')

      return { confirmed: true }
    }
  )
}

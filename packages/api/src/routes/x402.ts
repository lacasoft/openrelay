import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { markX402TxUsed } from '../lib/repository'
import { createChainClient, verifyUsdcTransfer, type ChainClient } from '../lib/chain'
import { apiError } from '../lib/errors'

const VerifySchema = z.object({
  payment: z.string().min(1),
  amount:  z.number().int().positive(),
  chain:   z.enum(['base', 'lightning']),
})

export async function x402Route(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  const config = app.config
  const isTestnet = config.nodeRegistryAddress === '0x0000000000000000000000000000000000000000'
  const chainClient: ChainClient = createChainClient(config.baseRpcUrl, isTestnet)

  /**
   * POST /v1/x402/verify
   * Verifies an x402 payment has been made on-chain.
   * Called by the SDK middleware after receiving X-PAYMENT header.
   * Implements replay protection via tx_hash uniqueness.
   */
  app.post<{ Body: z.infer<typeof VerifySchema> }>(
    '/x402/verify',
    async (req, reply) => {
      const { payment, amount, chain } = VerifySchema.parse(req.body)

      let txHash: string
      let amountReceived: number

      try {
        // Decode the base64 payment payload
        const decoded = Buffer.from(payment, 'base64').toString('utf-8')
        const payload = JSON.parse(decoded) as {
          tx_hash: string
          amount: number
          asset: string
          network: string
        }

        txHash         = payload.tx_hash
        amountReceived = payload.amount

        // Verify the transaction on-chain via viem
        if (chain === 'base') {
          const verification = await verifyUsdcTransfer(
            chainClient,
            txHash as `0x${string}`,
            req.merchantWallet,
            amount,
            config.usdcAddress,
          )

          if (!verification.valid) {
            return reply.status(402).send(apiError('chain_verification_failed', verification.reason ?? 'On-chain verification failed'))
          }
        }

        // Validate amount received meets requirement
        if (amountReceived < amount) {
          return reply.status(402).send(apiError('insufficient_payment', `Required ${amount} but received ${amountReceived}.`, 'amount'))
        }

      } catch (err) {
        req.log.warn({ err }, 'invalid x402 payload')
        return reply.status(400).send(apiError('invalid_payment_payload', 'Could not decode or parse the payment payload.'))
      }

      // Replay protection — atomic SET NX to prevent TOCTOU race
      const db    = req.server.db
      const redis = req.server.redis

      const redisKey = `x402:used:${txHash}`
      const wasSet = await redis.set(redisKey, '1', 'EX', 86400, 'NX')
      if (!wasSet) {
        // Already used — replay attempt
        return reply.status(409).send(apiError('x402_replay', 'Transaction already used'))
      }

      // Check DB as secondary persistent store
      const isNew = await markX402TxUsed(db, txHash, chain)
      if (!isNew) {
        return reply.status(409).send(apiError('x402_replay', 'Transaction already used'))
      }

      app.log.info({ tx_hash: txHash, amount: amountReceived, chain }, 'x402 payment verified')

      return reply.send({
        verified:        true,
        tx_hash:         txHash,
        amount_received: amountReceived,
      })
    }
  )
}

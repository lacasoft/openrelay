import { createPublicClient, http, parseAbiItem } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { pino } from 'pino'
import type { FastifyBaseLogger } from 'fastify'
import type { Config } from '../lib/config'
import type { NodeStore } from '../lib/store'

const logger = pino({ name: 'watcher' })

interface WatcherContext {
  config: Config
  store:  NodeStore
  logger: FastifyBaseLogger
}

/**
 * Chain watcher — polls Base for USDC transfers to assigned payment addresses.
 * When a matching transfer is detected, calls the settlement endpoint.
 *
 * Phase 1: polls every 5 seconds using eth_getLogs.
 * Phase 2: replaces with event subscription via viem watchContractEvent.
 *
 * @example
 * startChainWatcher({ config, store, logger: app.log })
 */
export function startChainWatcher({ config, store, logger }: WatcherContext): () => void {
  const isDevMode = config.nodeRegistryAddress === '0x0000000000000000000000000000000000000000'
  const intervals: NodeJS.Timeout[] = []

  if (isDevMode) {
    logger.warn('[watcher] Contracts not configured — chain watcher in simulation mode')
    logger.warn('[watcher] Settlements will be auto-confirmed after 10s (dev only)')
    startSimulatedWatcher({ store, logger }, intervals)
    return () => intervals.forEach(id => clearInterval(id))
  }

  // Production mode: real on-chain watching via viem
  logger.info('[watcher] Chain watcher started (production mode)')
  startPollingWatcher({ config, store, logger }, intervals)
  return () => intervals.forEach(id => clearInterval(id))
}

/**
 * Development simulation: auto-confirms assigned intents after 10 seconds.
 * Makes local development work without real Base transactions.
 */
function startSimulatedWatcher({ store, logger }: Pick<WatcherContext, 'store' | 'logger'>, intervals: NodeJS.Timeout[]) {
  const CONFIRM_AFTER_MS = 10_000 // 10 seconds in dev
  const TICK_INTERVAL_MS = 3_000  // check every 3 seconds

  intervals.push(setInterval(() => {
    try {
      // Find assigned intents older than CONFIRM_AFTER_MS that haven't settled
      const pending = store.getPendingAssignments(CONFIRM_AFTER_MS)

      for (const assignment of pending) {
        const fakeTxHash = `0xdev_${assignment.intent_id.slice(-8)}_${Date.now().toString(16)}`

        store.updateAssignment(assignment.intent_id, 'settled', fakeTxHash)

        logger.info({
          intent_id: assignment.intent_id,
          tx_hash:   fakeTxHash,
          mode:      'simulated',
        }, '[watcher] Settlement simulated (dev mode)')

        // Notify the API layer about the settlement
        void notifyApiSettlement(assignment.intent_id, fakeTxHash, 0)
      }
    } catch (err) {
      logger.error({ err }, '[watcher] Simulation tick error')
    }
  }, TICK_INTERVAL_MS))
}

/**
 * Production polling watcher: polls Base RPC for USDC Transfer events
 * targeting assigned payment addresses via viem getLogs.
 */
function startPollingWatcher({ config, store, logger }: WatcherContext, intervals: NodeJS.Timeout[]) {
  const POLL_INTERVAL_MS = 5_000

  const isTestnet = config.baseRpcUrl.includes('sepolia')
  const client = createPublicClient({
    chain: isTestnet ? baseSepolia : base,
    transport: http(config.baseRpcUrl),
  })

  const transferEvent = parseAbiItem(
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  )

  let lastCheckedBlock = 0n

  intervals.push(setInterval(async () => {
    try {
      const latestBlock = await client.getBlockNumber()

      // On first tick, only look back a small window to avoid scanning the entire chain
      if (lastCheckedBlock === 0n) {
        lastCheckedBlock = latestBlock > 100n ? latestBlock - 100n : 0n
      }

      // Nothing new to check
      if (latestBlock <= lastCheckedBlock) return

      const fromBlock = lastCheckedBlock + 1n
      const toBlock = latestBlock

      logger.debug({ fromBlock: Number(fromBlock), toBlock: Number(toBlock) }, '[watcher] Polling blocks')

      const logs = await client.getLogs({
        address: config.usdcAddress as `0x${string}`,
        event: transferEvent,
        fromBlock,
        toBlock,
      })

      for (const log of logs) {
        const toAddress = log.args.to
        if (!toAddress) continue

        // Check if this transfer is to one of our assigned payment addresses
        const assignment = store.getAssignmentByAddress(toAddress)
        if (!assignment) continue

        const txHash = log.transactionHash
        const blockNumber = Number(log.blockNumber)

        logger.info({
          intent_id:    assignment.intent_id,
          tx_hash:      txHash,
          block_number: blockNumber,
          amount:       log.args.value?.toString(),
          to:           toAddress,
        }, '[watcher] USDC transfer detected — settling intent')

        store.updateAssignment(assignment.intent_id, 'settled', txHash)

        void notifyApiSettlement(assignment.intent_id, txHash, blockNumber)
      }

      lastCheckedBlock = toBlock
    } catch (err) {
      logger.error({ err }, '[watcher] Poll error')
    }
  }, POLL_INTERVAL_MS))
}

/**
 * Notifies the API layer that an intent has been settled.
 * The API then updates the DB status and fires the merchant webhook.
 */
async function notifyApiSettlement(
  intentId: string,
  txHash: string,
  blockNumber: number
): Promise<void> {
  const apiUrl = process.env['API_INTERNAL_URL'] ?? 'http://api:3000'
  const hmacSecret = process.env['NODE_HMAC_SECRET'] ?? ''

  try {
    const body      = JSON.stringify({ tx_hash: txHash, block_number: blockNumber, settled_at: Math.floor(Date.now() / 1000) })
    const timestamp = Math.floor(Date.now() / 1000)

    const { createHmac } = await import('node:crypto')
    const signature = createHmac('sha256', hmacSecret)
      .update(`${timestamp}.${body}`)
      .digest('hex')

    await fetch(`${apiUrl}/v1/internal/settle/${intentId}`, {
      method: 'POST',
      headers: {
        'Content-Type':           'application/json',
        'X-OpenRelay-Signature':  `sha256=${signature}`,
        'X-OpenRelay-Timestamp':  String(timestamp),
        'X-Internal-Secret':      hmacSecret,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    logger.error({ err }, 'Failed to notify API of settlement')
  }
}

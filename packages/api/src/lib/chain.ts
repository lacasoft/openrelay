import { createPublicClient, http, parseAbi } from 'viem'
import { base, baseSepolia } from 'viem/chains'

const USDC_TRANSFER_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])

/** Transfer(address,address,uint256) topic0 */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export function createChainClient(rpcUrl: string, isTestnet = true) {
  return createPublicClient({
    chain: isTestnet ? baseSepolia : base,
    transport: http(rpcUrl),
  })
}

export type ChainClient = ReturnType<typeof createChainClient>

/**
 * Verifies that a transaction hash corresponds to a real USDC transfer
 * with the expected recipient and minimum amount.
 */
export async function verifyUsdcTransfer(
  client: ChainClient,
  txHash: `0x${string}`,
  expectedTo: string,
  expectedAmountUsdc: number,
  usdcAddress: string,
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash })

    if (receipt.status !== 'success') {
      return { valid: false, reason: 'transaction_failed' }
    }

    // Find USDC Transfer event in logs
    const transferLog = receipt.logs.find(
      log =>
        log.address.toLowerCase() === usdcAddress.toLowerCase() &&
        log.topics[0] === TRANSFER_TOPIC,
    )

    if (!transferLog) {
      return { valid: false, reason: 'no_usdc_transfer_found' }
    }

    // Decode the Transfer event — topics[2] is the `to` address (zero-padded to 32 bytes)
    const to = `0x${transferLog.topics[2]?.slice(26)}`.toLowerCase()
    const value = BigInt(transferLog.data)

    // USDC has 6 decimals
    const expectedAmount = BigInt(Math.round(expectedAmountUsdc * 1e6))

    if (to !== expectedTo.toLowerCase()) {
      return { valid: false, reason: 'wrong_recipient' }
    }

    if (value < expectedAmount) {
      return { valid: false, reason: 'insufficient_amount' }
    }

    return { valid: true }
  } catch {
    return { valid: false, reason: 'verification_failed' }
  }
}

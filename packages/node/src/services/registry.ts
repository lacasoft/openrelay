import type { Config } from '../lib/config'

/**
 * Verifies the node is registered on-chain in NodeRegistry.sol.
 * Phase 1: logs a warning if contracts not deployed yet.
 * Phase 2: uses viem to call NodeRegistry.getNode(operatorAddress).
 *
 * @example
 * await verifyRegistration(config)
 */
export async function verifyRegistration(config: Config): Promise<void> {
  const isZeroAddress = config.nodeRegistryAddress === '0x0000000000000000000000000000000000000000'

  if (isZeroAddress) {
    console.warn('[registry] ⚠️  NODE_REGISTRY_ADDRESS not configured.')
    console.warn('[registry] ⚠️  Running in local dev mode — on-chain verification skipped.')
    console.warn('[registry] ⚠️  Deploy contracts to Base Sepolia and set NODE_REGISTRY_ADDRESS.')
    return
  }

  // TODO Phase 2: implement viem call
  // const publicClient = createPublicClient({ chain: base, transport: http(config.baseRpcUrl) })
  // const node = await publicClient.readContract({
  //   address: config.nodeRegistryAddress as Address,
  //   abi: NodeRegistryABI,
  //   functionName: 'getNode',
  //   args: [config.operatorAddress as Address],
  // })
  // if (!node.active) throw new Error('Node not registered or inactive on-chain')

  console.log(`[registry] Operator: ${config.operatorAddress}`)
  console.log(`[registry] Registry: ${config.nodeRegistryAddress}`)
}

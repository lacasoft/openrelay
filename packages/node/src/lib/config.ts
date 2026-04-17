import { z } from 'zod'

const ConfigSchema = z.object({
  port:            z.coerce.number().default(4000),
  operatorAddress: z.string().default('0x0000000000000000000000000000000000000000'),
  privateKey:      z.string().default('0x0000000000000000000000000000000000000000000000000000000000000000'),
  endpoint:        z.string().default('http://localhost:4000'),
  hmacSecret:      z.string().min(16).default('openrelay-dev-hmac-secret-change-in-production'),
  baseRpcUrl:      z.string().url().default('https://sepolia.base.org'),
  nodeRegistryAddress:  z.string().default('0x0000000000000000000000000000000000000000'),
  stakeManagerAddress:  z.string().default('0x0000000000000000000000000000000000000000'),
  usdcAddress:     z.string().default('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
  dbPath:          z.string().default(':memory:'),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(): Config {
  return ConfigSchema.parse({
    port:            process.env['PORT'],
    operatorAddress: process.env['NODE_OPERATOR_ADDRESS'],
    privateKey:      process.env['NODE_OPERATOR_PRIVATE_KEY'],
    endpoint:        process.env['NODE_ENDPOINT'],
    hmacSecret:      process.env['NODE_HMAC_SECRET'],
    baseRpcUrl:      process.env['BASE_RPC_URL'],
    nodeRegistryAddress: process.env['NODE_REGISTRY_ADDRESS'],
    stakeManagerAddress: process.env['STAKE_MANAGER_ADDRESS'],
    usdcAddress:     process.env['USDC_ADDRESS'],
    dbPath:          process.env['DB_PATH'],
  })
}

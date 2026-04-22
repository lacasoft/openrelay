import { z } from 'zod'

const ConfigSchema = z.object({
  port: z.coerce.number().default(3000),
  databaseUrl: z.string().url(),
  redisUrl: z.string().url(),
  apiSecret: z.string().min(16).default('openrelay-dev-secret'),
  corsOrigin: z
    .string()
    .default('http://localhost:3000,http://localhost:3001')
    .transform((s) => s.split(',').map((o) => o.trim())),
  baseRpcUrl: z.string().url().default('https://sepolia.base.org'),
  nodeRegistryAddress: z.string().default('0x0000000000000000000000000000000000000000'),
  stakeManagerAddress: z.string().default('0x0000000000000000000000000000000000000000'),
  disputeResolverAddress: z.string().default('0x0000000000000000000000000000000000000000'),
  usdcAddress: z.string().default('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
  bootstrapNodeEndpoint: z.string().optional(),
})

export type Config = z.infer<typeof ConfigSchema>
export type AppConfig = Config

export function loadConfig(): Config {
  return ConfigSchema.parse({
    port: process.env.API_PORT,
    databaseUrl:
      process.env.DATABASE_URL ?? 'postgresql://openrelay:openrelay@localhost:5432/openrelay',
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    apiSecret: process.env.API_SECRET,
    baseRpcUrl: process.env.BASE_RPC_URL,
    nodeRegistryAddress: process.env.NODE_REGISTRY_ADDRESS,
    stakeManagerAddress: process.env.STAKE_MANAGER_ADDRESS,
    disputeResolverAddress: process.env.DISPUTE_RESOLVER_ADDRESS,
    usdcAddress: process.env.USDC_ADDRESS,
    corsOrigin: process.env.CORS_ORIGIN,
    bootstrapNodeEndpoint: process.env.BOOTSTRAP_NODE_ENDPOINT,
  })
}

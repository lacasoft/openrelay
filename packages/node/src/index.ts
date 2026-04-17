import Fastify from 'fastify'
import { healthRoute, infoRoute } from './routes/health'
import { intentsRoute }           from './routes/intents'
import { loadConfig }             from './lib/config'
import { initStore }              from './lib/store'
import { verifyRegistration }     from './services/registry'
import { startChainWatcher }      from './services/watcher'

const config = loadConfig()
const store  = initStore(config.dbPath)

const app = Fastify({
  logger: {
    level: process.env['LOG_LEVEL'] ?? 'info',
    transport: process.env['NODE_ENV'] !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
})

app.decorate('store',  store)
app.decorate('config', config)

app.register(healthRoute)
app.register(infoRoute)
app.register(intentsRoute)

const shutdown = async () => {
  app.log.info('Shutting down node daemon...')
  await app.close()
  store.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT',  shutdown)

async function start() {
  await verifyRegistration(config)

  await app.listen({ port: config.port, host: '0.0.0.0' })
  app.log.info(`OpenRelay Node v0.1.0`)
  app.log.info(`Operator: ${config.operatorAddress}`)
  app.log.info(`Endpoint: ${config.endpoint}`)

  // Start monitoring on-chain for settlements
  const stopWatcher = startChainWatcher({ config, store, logger: app.log })
  app.addHook('onClose', () => stopWatcher())
}

start().catch((err) => {
  app.log.error(err)
  process.exit(1)
})

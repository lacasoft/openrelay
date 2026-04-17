# @openrelay/sdk

OpenRelay JavaScript/TypeScript SDK -- the Stripe-compatible payment SDK for the open web.

## Installation

```bash
npm install @openrelay/sdk
```

## Usage

```typescript
import { OpenRelay } from '@openrelay/sdk'

const relay = new OpenRelay({ apiKey: 'your-api-key' })

const payment = await relay.payments.create({
  amount: 1000,
  currency: 'usd',
})
```

## Development

```bash
pnpm dev        # Watch mode (cjs + esm + dts)
pnpm build      # Build with tsup
pnpm test       # Run unit tests
pnpm typecheck  # Type-check without emitting
```

# @openrelay/node

OpenRelay node daemon -- runs a community routing node in the open payment network.

## Development

```bash
pnpm dev        # Start dev server with hot reload
pnpm build      # Compile TypeScript to dist/
pnpm start      # Run compiled output
pnpm test       # Run unit tests
pnpm typecheck  # Type-check without emitting
```

## Environment

The node connects to the API and requires a configured operator wallet. See `docker-compose.yml` in the repo root for the full list of environment variables.

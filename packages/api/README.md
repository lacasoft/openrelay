# @openrelay/api

OpenRelay REST API -- the merchant-facing gateway for the open payment network.

## Development

```bash
pnpm dev        # Start dev server with hot reload
pnpm build      # Compile TypeScript to dist/
pnpm start      # Run compiled output
pnpm test       # Run unit tests
pnpm typecheck  # Type-check without emitting
pnpm seed       # Seed the database
```

## Environment

Requires PostgreSQL and Redis. See `docker-compose.yml` in the repo root for a ready-made stack.

Copy `.env.example` (if present) or set the variables listed in `docker-compose.yml` under the `api` service.

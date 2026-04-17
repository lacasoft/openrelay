-- OpenRelay initial schema
-- Run with: pnpm db:migrate

-- ── Merchants ─────────────────────────────────────────────────

CREATE TABLE merchants (
  id              TEXT PRIMARY KEY,           -- mid_xxx
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  wallet_address  TEXT NOT NULL,              -- where funds land
  routing_mode    TEXT NOT NULL DEFAULT 'auto',
  min_node_stake  BIGINT DEFAULT 0,
  min_node_score  NUMERIC(4,3) DEFAULT 0.0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── API Keys ──────────────────────────────────────────────────

CREATE TABLE api_keys (
  id          TEXT PRIMARY KEY,               -- key_xxx
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,           -- bcrypt hash of the actual key
  key_prefix  TEXT NOT NULL,                  -- pk_live_ or sk_live_
  label       TEXT,
  last_used   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_merchant ON api_keys(merchant_id);
CREATE INDEX idx_api_keys_prefix   ON api_keys(key_prefix);

-- ── Payment Intents ───────────────────────────────────────────

CREATE TABLE payment_intents (
  id              TEXT PRIMARY KEY,           -- pi_xxx
  merchant_id     TEXT NOT NULL REFERENCES merchants(id),
  amount          BIGINT NOT NULL,            -- micro-units
  currency        TEXT NOT NULL,              -- usdc | btc
  chain           TEXT NOT NULL,              -- base | lightning | auto
  status          TEXT NOT NULL DEFAULT 'created',
  node_operator   TEXT,                       -- assigned node wallet
  payer_address   TEXT,
  tx_hash         TEXT,
  fee_amount      BIGINT NOT NULL DEFAULT 0,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  settled_at      TIMESTAMPTZ
);

CREATE INDEX idx_intents_merchant ON payment_intents(merchant_id);
CREATE INDEX idx_intents_status   ON payment_intents(status);
CREATE INDEX idx_intents_tx_hash  ON payment_intents(tx_hash);

-- ── Webhook Endpoints ─────────────────────────────────────────

CREATE TABLE webhook_endpoints (
  id          TEXT PRIMARY KEY,               -- we_xxx
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  secret_hash TEXT NOT NULL,                  -- for signature verification
  events      TEXT[] NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_webhooks_merchant ON webhook_endpoints(merchant_id);

-- ── Webhook Deliveries ────────────────────────────────────────

CREATE TABLE webhook_deliveries (
  id              TEXT PRIMARY KEY,
  endpoint_id     TEXT NOT NULL REFERENCES webhook_endpoints(id),
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | delivered | failed
  attempt_count   INT NOT NULL DEFAULT 0,
  last_attempted  TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deliveries_endpoint ON webhook_deliveries(endpoint_id);
CREATE INDEX idx_deliveries_status   ON webhook_deliveries(status);

-- ── Disputes ──────────────────────────────────────────────────

CREATE TABLE disputes (
  id                  TEXT PRIMARY KEY,       -- dsp_xxx
  payment_intent_id   TEXT NOT NULL REFERENCES payment_intents(id),
  merchant_id         TEXT NOT NULL REFERENCES merchants(id),
  node_operator       TEXT NOT NULL,
  evidence_cid        TEXT NOT NULL,          -- IPFS CID
  counter_evidence_cid TEXT,
  status              TEXT NOT NULL DEFAULT 'open',
  outcome             TEXT,                   -- merchant_wins | node_wins
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);

CREATE INDEX idx_disputes_intent   ON disputes(payment_intent_id);
CREATE INDEX idx_disputes_merchant ON disputes(merchant_id);
CREATE INDEX idx_disputes_node     ON disputes(node_operator);

-- ── x402 Replay Protection ────────────────────────────────────

CREATE TABLE x402_payments_used (
  tx_hash     TEXT PRIMARY KEY,
  chain       TEXT NOT NULL,
  used_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

import Database from 'better-sqlite3'

export interface IntentAssignment {
  intent_id:        string
  amount:           number
  currency:         string
  chain:            string
  merchant_address: string
  payment_address:  string
  status:           'assigned' | 'settled' | 'failed' | 'expired'
  tx_hash:          string | null
  assigned_at:      number
  settled_at:       number | null
  intent_index:     number
}

export interface NodeStore {
  getNextIndex:           () => number
  insertAssignment:       (a: Omit<IntentAssignment, 'assigned_at' | 'settled_at'>) => void
  getAssignment:          (intentId: string) => IntentAssignment | undefined
  getAssignmentByAddress: (paymentAddress: string) => IntentAssignment | undefined
  updateAssignment:       (intentId: string, status: string, txHash?: string) => void
  getPendingAssignments:  (olderThanMs: number) => IntentAssignment[]
  getStats:               () => { total_settled: number; avg_settlement_ms: number; uptime_start: number }
  close:                  () => void
}

export function initStore(dbPath: string): NodeStore {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS intent_assignments (
      intent_id         TEXT PRIMARY KEY,
      amount            INTEGER NOT NULL,
      currency          TEXT NOT NULL,
      chain             TEXT NOT NULL,
      merchant_address  TEXT NOT NULL,
      payment_address   TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'assigned',
      tx_hash           TEXT,
      assigned_at       INTEGER NOT NULL,
      settled_at        INTEGER,
      intent_index      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assignments_address ON intent_assignments(payment_address);
    CREATE INDEX IF NOT EXISTS idx_assignments_status ON intent_assignments(status, assigned_at);
    CREATE TABLE IF NOT EXISTS node_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO node_meta (key, value) VALUES ('intent_counter', '0');
    INSERT OR IGNORE INTO node_meta (key, value) VALUES ('uptime_start', CAST(strftime('%s', 'now') AS TEXT));
  `)

  const getNextIndex = (): number => {
    const row = db.prepare(`
      UPDATE node_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
      WHERE key = 'intent_counter'
      RETURNING CAST(value AS INTEGER) as idx
    `).get() as { idx: number }
    return row.idx
  }

  const insertAssignment = (a: Omit<IntentAssignment, 'assigned_at' | 'settled_at'>) => {
    db.prepare(`
      INSERT INTO intent_assignments
        (intent_id, amount, currency, chain, merchant_address,
         payment_address, status, tx_hash, assigned_at, settled_at, intent_index)
      VALUES (@intent_id, @amount, @currency, @chain, @merchant_address,
              @payment_address, @status, @tx_hash, @assigned_at, @settled_at, @intent_index)
    `).run({ ...a, tx_hash: a.tx_hash ?? null, assigned_at: Math.floor(Date.now() / 1000), settled_at: null })
  }

  const getAssignment = (intentId: string) =>
    db.prepare('SELECT * FROM intent_assignments WHERE intent_id = ?').get(intentId) as IntentAssignment | undefined

  const getAssignmentByAddress = (paymentAddress: string) =>
    db.prepare(`SELECT * FROM intent_assignments WHERE payment_address = ? AND status = 'assigned'`)
      .get(paymentAddress) as IntentAssignment | undefined

  const updateAssignment = (intentId: string, status: string, txHash?: string) => {
    db.prepare(`
      UPDATE intent_assignments
      SET status = ?, tx_hash = COALESCE(?, tx_hash),
          settled_at = CASE WHEN ? = 'settled' THEN CAST(strftime('%s','now') AS INTEGER) ELSE settled_at END
      WHERE intent_id = ?
    `).run(status, txHash ?? null, status, intentId)
  }

  const getPendingAssignments = (olderThanMs: number): IntentAssignment[] => {
    const cutoff = Math.floor((Date.now() - olderThanMs) / 1000)
    return db.prepare(`SELECT * FROM intent_assignments WHERE status = 'assigned' AND assigned_at <= ?`
    ).all(cutoff) as IntentAssignment[]
  }

  const getStats = () => {
    const s = db.prepare(`
      SELECT COUNT(*) as total, AVG(CAST(settled_at - assigned_at AS REAL)) * 1000 as avg_ms
      FROM intent_assignments WHERE status = 'settled'
    `).get() as { total: number; avg_ms: number | null }
    const m = db.prepare(`SELECT value FROM node_meta WHERE key = 'uptime_start'`).get() as { value: string }
    return { total_settled: Number(s.total ?? 0), avg_settlement_ms: Math.round(s.avg_ms ?? 0), uptime_start: Number(m.value) }
  }

  return { getNextIndex, insertAssignment, getAssignment, getAssignmentByAddress, updateAssignment, getPendingAssignments, getStats, close: () => db.close() }
}

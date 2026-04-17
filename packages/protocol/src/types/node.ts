export interface NodeInfo {
  operator: string
  endpoint: string
  version: string
  chains: string[]
  capacity: number
  uptime_30d: number
  avg_settlement_ms: number
  total_settled: number
  stake: bigint
}

export interface NodeScore {
  operator: string
  score: number
  uptime_weight: number
  speed_weight: number
  stake_weight: number
  disputes_weight: number
  computed_at: number
}

export interface IntentAssignmentRequest {
  intent_id: string
  amount: number
  currency: string
  chain: string
  merchant_address: string
  expires_at: number
}

export interface IntentAssignmentResponse {
  accepted: boolean
  payment_address?: string
  node_fee?: number
  reason?: string
}

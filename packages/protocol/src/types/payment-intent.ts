export type Chain = 'base' | 'lightning' | 'polygon' | 'solana'
export type Currency = 'usdc' | 'btc'

export type PaymentIntentStatus =
  | 'created'
  | 'routing'
  | 'pending_payment'
  | 'confirming'
  | 'settled'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'disputed'

export interface PaymentIntent {
  id: string
  merchant_id: string
  amount: number
  currency: Currency
  chain: Chain | 'auto'
  status: PaymentIntentStatus
  node_operator: string | null
  payer_address: string | null
  tx_hash: string | null
  fee_amount: number
  metadata: Record<string, string>
  created_at: number
  expires_at: number
  settled_at: number | null
}

export interface CreatePaymentIntentParams {
  amount: number
  currency: Currency
  chain: Chain | 'auto'
  metadata?: Record<string, string>
  expires_in?: number
}

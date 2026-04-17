export type OpenRelayErrorCode =
  | 'invalid_api_key'
  | 'insufficient_permissions'
  | 'intent_not_found'
  | 'intent_expired'
  | 'intent_already_settled'
  | 'no_nodes_available'
  | 'chain_not_supported'
  | 'amount_too_small'
  | 'amount_too_large'
  | 'invalid_webhook_url'
  | 'dispute_window_closed'
  | 'node_not_registered'

export interface OpenRelayError {
  code: OpenRelayErrorCode
  message: string
  param: string | null
  doc_url: string
}

export class OpenRelaySDKError extends Error {
  code: OpenRelayErrorCode
  param: string | null
  doc_url: string
  constructor(error: OpenRelayError) {
    super(error.message)
    this.name = 'OpenRelaySDKError'
    this.code = error.code
    this.param = error.param
    this.doc_url = error.doc_url
  }
}

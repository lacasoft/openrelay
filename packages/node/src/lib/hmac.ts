import { createHmac } from 'node:crypto'

// 60-second tolerance balances clock skew with replay attack mitigation.
// Shorter than the previous 5-minute window to reduce the replay window.
const TOLERANCE_MS = 60 * 1000 // 60 seconds

export function signRequest(body: string, timestamp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function verifyRequest(
  body: string,
  timestamp: number,
  signature: string,
  secret: string
): boolean {
  if (Math.abs(Date.now() - timestamp * 1000) > TOLERANCE_MS) return false
  return signature === `sha256=${signRequest(body, timestamp, secret)}`
}

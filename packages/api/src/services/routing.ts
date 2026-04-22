import type {
  IntentAssignmentRequest,
  IntentAssignmentResponse,
  NodeInfo,
  NodeScore,
} from '@openrelay/protocol'
import {
  MAX_SETTLEMENT_MS,
  NODE_ASSIGN_TIMEOUT_MS,
  ROUTING_CANDIDATES,
  TARGET_STAKE_USDC,
} from '@openrelay/protocol'

/**
 * Compute a routing score for a node.
 * Score = (uptime * 0.30) + (speed * 0.30) + (stake * 0.20) + (disputes * 0.20)
 */
export function computeScore(
  node: NodeInfo,
  disputesWon: number,
  disputesTotal: number,
): NodeScore {
  const uptime_weight = node.uptime_30d
  const speed_weight = 1 - Math.min(node.avg_settlement_ms / MAX_SETTLEMENT_MS, 1)
  const stake_weight = Math.min(Number(node.stake) / Number(TARGET_STAKE_USDC), 1)
  const disputes_weight = disputesTotal > 0 ? disputesWon / disputesTotal : 1

  const score =
    uptime_weight * 0.3 + speed_weight * 0.3 + stake_weight * 0.2 + disputes_weight * 0.2

  return {
    operator: node.operator,
    score,
    uptime_weight,
    speed_weight,
    stake_weight,
    disputes_weight,
    computed_at: Math.floor(Date.now() / 1000),
  }
}

/**
 * Select and contact the best available node for an intent.
 *
 * Strategy: take the top ROUTING_CANDIDATES nodes by score, send
 * concurrent assignment requests, accept the first positive response.
 * This minimizes latency while providing automatic fallback.
 */
export async function routeIntent(
  intent: IntentAssignmentRequest,
  candidates: Array<{ node: NodeInfo; score: NodeScore }>,
  minScore = 0,
  minStake = 0n,
): Promise<{ operator: string; response: IntentAssignmentResponse } | null> {
  // Apply hard filters
  const eligible = candidates
    .filter((c) => c.score.score >= minScore)
    .filter((c) => c.node.stake >= minStake)
    .filter((c) => c.node.chains.includes(intent.chain))
    .filter((c) => c.node.capacity >= 0.1)
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, ROUTING_CANDIDATES)

  if (eligible.length === 0) return null

  // Race concurrent assignment requests
  const results = await Promise.allSettled(
    eligible.map(async ({ node, score }) => {
      const res = await assignToNode(node.endpoint, intent)
      if (!res.accepted) throw new Error(`Node ${score.operator} rejected`)
      return { operator: score.operator, response: res }
    }),
  )

  for (const result of results) {
    if (result.status === 'fulfilled') return result.value
  }

  return null
}

async function assignToNode(
  endpoint: string,
  intent: IntentAssignmentRequest,
): Promise<IntentAssignmentResponse> {
  const timestamp = Math.floor(Date.now() / 1000)
  const body = JSON.stringify(intent)
  const hmacSecret = process.env.NODE_HMAC_SECRET ?? ''

  const { createHmac } = await import('node:crypto')
  const signature = createHmac('sha256', hmacSecret).update(`${timestamp}.${body}`).digest('hex')

  const res = await fetch(`${endpoint}/intents/assign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OpenRelay-Signature': `sha256=${signature}`,
      'X-OpenRelay-Timestamp': String(timestamp),
    },
    body,
    signal: AbortSignal.timeout(NODE_ASSIGN_TIMEOUT_MS),
  })

  if (!res.ok) throw new Error(`Node responded ${res.status}`)
  return res.json() as Promise<IntentAssignmentResponse>
}

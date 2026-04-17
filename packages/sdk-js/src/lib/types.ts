export interface OpenRelayConfig {
  apiKey: string
  baseUrl?: string
  timeout?: number
  merchantWallet?: string   // wallet address that receives payments (required for x402)
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  body?: unknown
}

export async function request<T>(config: OpenRelayConfig, opts: RequestOptions): Promise<T> {
  const url = `${config.baseUrl}/v1${opts.path}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeout ?? 30_000)

  const res = await fetch(url, {
    method: opts.method,
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'OpenRelay-Version': '0.1',
    },
    ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer))

  const data = (await res.json()) as { error?: unknown } & Record<string, unknown>

  if (!res.ok) {
    // Server returns { error: OpenRelayError }
    throw data.error
  }

  return data as T
}

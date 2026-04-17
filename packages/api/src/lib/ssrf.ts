import { isIP } from 'node:net'

/**
 * Checks whether a URL points to a private/internal network address.
 * Used to prevent SSRF attacks on webhook registration.
 */
export function isPrivateUrl(urlStr: string): boolean {
  let hostname: string
  try {
    const parsed = new URL(urlStr)
    hostname = parsed.hostname
  } catch {
    return true // malformed URLs are rejected
  }

  // Strip IPv6 brackets
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1)
  }

  // IPv6 checks
  if (hostname === '::1') return true
  if (hostname.toLowerCase().startsWith('fc') || hostname.toLowerCase().startsWith('fd')) {
    return true // fc00::/7
  }

  // IPv4 checks
  if (isIP(hostname) === 4) {
    return isPrivateIPv4(hostname)
  }

  // Hostname-based checks
  const lower = hostname.toLowerCase()
  if (
    lower === 'localhost' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true
  }

  return false
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4) return true

  const a = parts[0]
  const b = parts[1]
  if (a === undefined || b === undefined) return true

  // 127.0.0.0/8 — loopback
  if (a === 127) return true
  // 10.0.0.0/8 — private
  if (a === 10) return true
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true
  // 169.254.0.0/16 — link-local
  if (a === 169 && b === 254) return true
  // 0.0.0.0
  if (a === 0) return true

  return false
}

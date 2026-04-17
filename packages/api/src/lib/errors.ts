/**
 * Shared error response helper.
 * All API error responses must follow a consistent format:
 * { error: { code, message, param, doc_url } }
 */
export function apiError(code: string, message: string, param: string | null = null) {
  return {
    error: {
      code,
      message,
      param,
      doc_url: `https://docs.openrelay.dev/errors/${code}`,
    },
  }
}

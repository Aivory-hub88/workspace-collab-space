/**
 * Client-side collab credential accessor (browser only).
 *
 * The collab engine requires a credential on every WS upgrade (`?token=`)
 * and HTTP call (`Authorization: Bearer`). This module reads it from a
 * configurable browser session — by default the `workspace_auth` JSON
 * (`{access_token}`) or the plain `workspace_token` key. Override
 * `setTokenProvider()` to plug in any session store.
 */

export type TokenProvider = () => string | null

function defaultProvider(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const direct = localStorage.getItem('workspace_token')
    if (direct) return direct
    const raw = localStorage.getItem('workspace_auth')
    if (raw) {
      const s = JSON.parse(raw)
      if (s?.access_token) return s.access_token
    }
  } catch {
    /* ignore malformed session */
  }
  return null
}

let provider: TokenProvider = defaultProvider

/** Override where browser credentials come from. */
export function setTokenProvider(p: TokenProvider): void {
  provider = p
}

export function collabToken(): string | null {
  return provider()
}

export function collabAuthHeaders(): Record<string, string> {
  const token = collabToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function collabWsParams(): Record<string, string> {
  const token = collabToken()
  return token ? { token } : {}
}

/**
 * WebSocket base URL for the collab engine. Override with
 * NEXT_PUBLIC_COLLAB_WS_URL; otherwise localhost in dev and the same
 * host's /yjs path in production.
 */
export function collabWsUrl(): string {
  if (typeof window === "undefined") return ""
  const fromEnv = process.env.NEXT_PUBLIC_COLLAB_WS_URL
  if (fromEnv) return fromEnv
  const host = window.location.hostname
  if (host === "localhost" || host === "127.0.0.1") return "ws://localhost:3200"
  return `wss://${window.location.host}/yjs`
}

/** Clear browser credentials after the server rejects the current session. */
export function clearClientAuthSession(): void {
  if (typeof window === "undefined") return
  for (const key of ["workspace_auth", "workspace_token", "workspace_user_id"]) {
    localStorage.removeItem(key)
  }
  for (const key of ["ws_access_token", "ws_session_token", "ws_user"]) {
    document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax`
  }
  window.dispatchEvent(new Event("workspace:logout"))
}

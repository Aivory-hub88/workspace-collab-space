/**
 * Workspace API authZ shared by the /api/workspace routes.
 *
 * Two credential kinds are accepted, mirroring what the collab engine verifies:
 *   - user: an HS256 JWT (Bearer header or the ws_access_token /
 *     ws_session_token cookies). The same token is forwarded to the collab
 *     engine so
 *     IT enforces per-doc RBAC; this API only gates the endpoint.
 *   - service: `X-Service-Token` equal to COLLAB_SERVICE_TOKEN. Used by
 *     agent-originated, server-side calls (workers → this API). Client
 *     asserted `X-Agent-Type` is NEVER trusted here — collab only honours it
 *     when the request also carries the service token.
 *
 * When collab is unreachable the legacy pg fallback must NOT silently bypass
 * authZ, so `authorizeDocFallback` re-checks ownership before serving pg rows.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserWithToken, type AuthUser } from '@/lib/authProvider'
import { query } from '@/lib/db'

export type WorkspaceCredential =
  | { kind: 'user'; user: AuthUser; token: string }
  | { kind: 'service'; token: string }

/** Resolve the caller's workspace credential, or null when unauthenticated. */
export function workspaceCredential(request: NextRequest): WorkspaceCredential | null {
  const serviceToken = process.env.COLLAB_SERVICE_TOKEN
  const supplied = request.headers.get('x-service-token')
  if (serviceToken && supplied && supplied === serviceToken) {
    return { kind: 'service', token: supplied }
  }
  const authed = getAuthUserWithToken(request)
  if (authed) return { kind: 'user', user: authed.user, token: authed.token }
  return null
}

/** Headers to forward to the collab engine so it enforces its own per-doc RBAC. */
export function collabAuthHeaders(cred: WorkspaceCredential): Record<string, string> {
  return cred.kind === 'service'
    ? { 'X-Service-Token': cred.token }
    : { Authorization: `Bearer ${cred.token}` }
}

/**
 * Coarse fallback check used ONLY when collab is unreachable (pg fallback).
 * Collab remains the authoritative per-doc RBAC enforcer while it is up; this
 * re-checks ownership from the legacy pg row so a collab outage can't turn
 * into an authorization bypass. New/ownerless docs fall back open (the first
 * authorized writer claims them) to match collab's own new-doc rule.
 */
export async function authorizeDocFallback(
  cred: WorkspaceCredential,
  id: string,
): Promise<boolean> {
  if (cred.kind === 'service') return true
  if (cred.user.account_type === 'admin' || cred.user.account_type === 'superadmin') return true
  try {
    const r = await query(
      'SELECT owner FROM dashboard.workspace_docs WHERE id = $1 OR id = $2',
      [`workspace:${id}`, id],
    )
    if (r.rows.length === 0) return true // new doc — first writer claims owner
    return r.rows.some((row) => row.owner === cred.user.user_id)
  } catch {
    return false
  }
}

export function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

export function forbidden() {
  return NextResponse.json({ error: 'forbidden' }, { status: 403 })
}
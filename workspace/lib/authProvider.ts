import type { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'

/**
 * Pluggable identity for the workspace engine.
 *
 * The engine never assumes a specific identity provider. It needs exactly
 * two things, both with reference implementations in this file:
 *
 * 1. Request authentication — HS256 JWT (`{user_id|sub, email?, account_type?}`),
 *    accepted from `Authorization: Bearer` or the `ws_access_token` /
 *    `ws_session_token` cookies. Bring any issuer that signs such tokens
 *    (set JWT_SECRET to the shared secret).
 * 2. User directory — resolving user ids to emails/names for the sharing UI.
 *    The default is a null directory (id-only mode); point
 *    `setUserDirectory()` at a real store, or create the opt-in
 *    `workspace_users` table (see schema note in the README) and set
 *    `USER_DIRECTORY=pg`.
 */

export interface AuthUser {
  user_id: string
  email?: string
  account_type?: string
}

/** Returns the verified user, or null when the request carries no valid token. */
export function getAuthUser(request: NextRequest): AuthUser | null {
  return getAuthUserWithToken(request)?.user ?? null
}

/** Like `getAuthUser`, but also returns the raw JWT (forwarded to the collab engine). */
export function getAuthUserWithToken(
  request: NextRequest,
): { user: AuthUser; token: string } | null {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET env var is required — refusing to verify tokens against a default secret')
  }

  const bearer = request.headers.get('authorization')
  const candidates = [
    bearer?.startsWith('Bearer ') ? bearer.slice('Bearer '.length) : null,
    request.cookies.get('ws_access_token')?.value ?? null,
    request.cookies.get('ws_session_token')?.value ?? null,
  ].filter((t): t is string => Boolean(t))

  for (const token of candidates) {
    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] })
      if (typeof payload !== 'object' || payload === null) continue
      const p = payload as Record<string, unknown>
      const userId = typeof p.user_id === 'string' && p.user_id
        ? p.user_id
        : typeof p.sub === 'string' && p.sub ? p.sub : null
      if (!userId) continue
      return {
        user: {
          user_id: userId,
          email: typeof p.email === 'string' ? p.email : undefined,
          account_type: typeof p.account_type === 'string' ? p.account_type : undefined,
        },
        token,
      }
    } catch {
      // This candidate didn't verify — try the next one.
    }
  }
  return null
}

export interface DirectoryUser {
  id: string
  email?: string | null
  name?: string | null
}

export interface UserDirectory {
  findByEmail(email: string): Promise<DirectoryUser | null>
  describe(userId: string): Promise<{ email: string | null; name: string | null }>
}

const nullDirectory: UserDirectory = {
  findByEmail: async () => null,
  describe: async () => ({ email: null, name: null }),
}

let directory: UserDirectory = nullDirectory

/** Override the user directory (e.g. with a Postgres-backed implementation). */
export function setUserDirectory(d: UserDirectory): void {
  directory = d
}

export function getUserDirectory(): UserDirectory {
  return directory
}

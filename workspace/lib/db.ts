/**
 * Postgres pool for the dashboard's own storage routes (avry-postgres).
 *
 * - Node runtime only — every route file importing this must declare
 *   `export const runtime = 'nodejs'`.
 * - No fallback credentials: a missing DATABASE_URL throws at first use —
 *   better a loud 500 than quiet traffic to a default host.
 * - Lazy module singleton, stashed on globalThis so Next dev hot-reload
 *   doesn't leak one pool per recompile.
 * - connectionTimeoutMillis is deliberately low: a PG outage must degrade
 *   the client to its localStorage fallback, not hang page loads.
 */
import { Pool, type QueryResult } from 'pg'

const globalForPg = globalThis as unknown as { __avryPgPool?: Pool }

function getPool(): Pool {
  if (!globalForPg.__avryPgPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL env var is required — refusing to fall back to a default host')
    }
    const pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
    })
    pool.on('error', (err) => {
      console.error('[lib/db] Unexpected error on idle client:', err)
    })
    globalForPg.__avryPgPool = pool
  }
  return globalForPg.__avryPgPool
}

export async function query(text: string, params?: unknown[]): Promise<QueryResult> {
  return getPool().query(text, params)
}

/**
 * Run statements on a single pooled client inside BEGIN/COMMIT (ROLLBACK on
 * throw). Required for read-modify-write cycles like the Yjs blob merge —
 * without a row lock, concurrent PUTs from two tabs interleave (both read
 * the same base, last writer silently drops the other's diff).
 */
export async function withTransaction<T>(fn: (tx: (text: string, params?: unknown[]) => Promise<QueryResult>) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query("BEGIN")
    try {
      const out = await fn((text, params) => client.query(text, params))
      await client.query("COMMIT")
      return out
    } catch (e) {
      try {
        await client.query("ROLLBACK")
      } catch {}
      throw e
    }
  } finally {
    client.release()
  }
}

import { NextRequest, NextResponse } from "next/server"
import * as Y from "yjs"
import { query, withTransaction } from "@/lib/db"
import { workspaceCredential, collabAuthHeaders, authorizeDocFallback, unauthorized, forbidden } from "@/lib/workspaceAuth"
import { checkAgentAccess } from "@/lib/workspaceAccess"
import { canonicalRoomId, legacyDocId, mergeYjsUpdates } from "@/lib/workspaceDoc"

export const runtime = "nodejs"

const COLLAB_URL = process.env.COLLAB_URL || "http://aivory-collab:3200"

async function collabFetch(id: string, cred: ReturnType<typeof workspaceCredential>, init?: RequestInit): Promise<Response | null> {
  if (!cred) return null
  try {
    const res = await fetch(`${COLLAB_URL}/api/workspace/${encodeURIComponent(id)}/doc`, {
      ...init,
      headers: { ...collabAuthHeaders(cred), ...(init?.headers || {}) },
      // 2s timeout via AbortSignal
      signal: AbortSignal.timeout(2000),
    } as RequestInit)
    return res
  } catch {
    return null
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  // Agent gate (read) — covers the pg-fallback path; collab enforces too.
  if (await checkAgentAccess(id, cred, req.headers.get("x-agent-type"), 'read')) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  // collab first (y-octo) — it enforces per-doc RBAC; forward its verdict
  const collab = await collabFetch(id, cred)
  if (collab) {
    if (collab.status === 401 || collab.status === 403) {
      return NextResponse.json({ error: "forbidden" }, { status: collab.status })
    }
    if (collab.ok) {
      const buf = await collab.arrayBuffer()
      return new NextResponse(buf as unknown as BodyInit, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Source": "collab" },
      })
    }
  }
  // collab down — pg BYTEA fallback, but only for still-authorized callers.
  // Read the canonical room row first, then merge the legacy bare-id snapshot
  // so a fallback read never serves a partial half of a split-brain doc.
  if (!(await authorizeDocFallback(cred, id))) return forbidden()
  try {
    const r = await query("SELECT id, yjs_update FROM dashboard.workspace_docs WHERE id = $1 OR id = $2", [
      canonicalRoomId(id),
      legacyDocId(id),
    ])
    if (r.rows.length === 0) return new NextResponse(null, { status: 404 })
    const byId = new Map<string, Buffer>(r.rows.map((row) => [row.id as string, row.yjs_update as Buffer]))
    const merged = mergeYjsUpdates([byId.get(canonicalRoomId(id)) ?? null, byId.get(legacyDocId(id)) ?? null])
    if (!merged) return new NextResponse(null, { status: 404 })
    return new NextResponse(merged as unknown as BodyInit, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Source": "pg" },
    })
  } catch (e) {
    console.error("[workspace/doc GET]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const buf = await req.arrayBuffer()
  if (!buf.byteLength) return NextResponse.json({ error: 'empty' }, { status: 400 })
  // Bound a single write: the row is append-merged below, so a runaway
  // client must not be able to bloat it without limit.
  if (buf.byteLength > 20_000_000) return NextResponse.json({ error: 'too large' }, { status: 413 })
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const agentType = req.headers.get("x-agent-type") || req.headers.get("X-Agent-Type") || "user"
  // Agent gate (write) — covers the pg-fallback merge below; collab enforces too.
  if (await checkAgentAccess(id, cred, req.headers.get("x-agent-type"), 'write')) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const upd = Buffer.from(buf)
  // Validate BEFORE touching storage: a corrupt update must 400, never poison
  // the stored blob (mergeYjsUpdates would otherwise silently skip it and
  // we'd ACK garbage as persisted).
  try {
    const probe = new Y.Doc()
    Y.applyUpdate(probe, new Uint8Array(upd))
    probe.destroy()
  } catch {
    return NextResponse.json({ error: 'invalid yjs update' }, { status: 400 })
  }
  // proxy to collab (y-octo) — it enforces RBAC + rejects viewer writes
  const collabRes = await collabFetch(id, cred, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream", "X-Agent-Type": agentType },
    body: buf as unknown as BodyInit,
  })
  if (collabRes && (collabRes.status === 401 || collabRes.status === 403)) {
    return NextResponse.json({ error: "forbidden" }, { status: collabRes.status })
  }
  // collab down — pg fallback write is still gated (never a bypass)
  if (!collabRes?.ok && !(await authorizeDocFallback(cred, id))) {
    return forbidden()
  }

  try {
    // MERGE, never replace: the same room is written by partial-slice peers
    // (comments/database share `workspace:{id}`) and by concurrent tabs. A
    // plain overwrite lets a small comments-only PUT wipe editor content (and
    // vice versa) and drops one tab's diff on interleave. CRDT union under a
    // row lock is commutative-safe for all writers, full-state or diff alike.
    const merged = await withTransaction(async (tx) => {
      const cur = await tx(`SELECT yjs_update FROM dashboard.workspace_docs WHERE id = $1 FOR UPDATE`, [id])
      const stored = (cur.rows[0]?.yjs_update as Buffer | null) ?? null
      const out = mergeYjsUpdates([stored, upd])
      if (!out) throw new Error("merge failed")
      await tx(
        `INSERT INTO dashboard.workspace_docs (id, yjs_update, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET yjs_update = EXCLUDED.yjs_update, updated_at = now()`,
        [id, out],
      )
      return out
    })
    // Best-effort history snapshot (throttled: at most one per minute, deduped by size).
    // Snapshots stay FULL-state (merged union) so any one of them restores standalone.
    try {
      const last = await query(`SELECT octet_length(yjs_update) as bytes, created_at FROM dashboard.workspace_doc_history WHERE doc_id = $1 ORDER BY created_at DESC LIMIT 1`, [id])
      const lastBytes = last.rows[0] ? Number(last.rows[0].bytes) : -1
      const lastAt = last.rows[0]?.created_at ? new Date(last.rows[0].created_at as string).getTime() : 0
      const nowMs = Date.now()
      if (merged.length !== lastBytes && nowMs - lastAt > 60_000) {
        const actorId = cred?.kind === 'user' ? cred.user.user_id : 'service'
        await query(`INSERT INTO dashboard.workspace_doc_history (doc_id, yjs_update, actor_id) VALUES ($1,$2,$3)`, [id, merged, actorId])
        // Retention cap: keep the newest 50 snapshots per doc so the table
        // can't grow without bound on long-lived active docs.
        try {
          await query(
            `DELETE FROM dashboard.workspace_doc_history WHERE doc_id = $1 AND id NOT IN (SELECT id FROM dashboard.workspace_doc_history WHERE doc_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50)`,
            [id],
          )
        } catch {}
      }
    } catch {}
  } catch (e) {
    console.error("[workspace/doc PUT pg]", e)
    // if collab succeeded, still return success even if pg fails
    if (collabRes?.ok) {
      return NextResponse.json({ id, updated_at: new Date().toISOString(), bytes: buf.byteLength, source: "collab" })
    }
    return NextResponse.json({ error: "db" }, { status: 500 })
  }

  if (collabRes?.ok) {
    return NextResponse.json({ id, updated_at: new Date().toISOString(), bytes: buf.byteLength, source: "collab+pg", agentType })
  }
  return NextResponse.json({ id, updated_at: new Date().toISOString(), bytes: buf.byteLength, source: "pg", agentType })
}
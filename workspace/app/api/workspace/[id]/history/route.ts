import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { workspaceCredential, unauthorized, forbidden } from '@/lib/workspaceAuth'
import { getDocRole } from '@/lib/workspaceAccess'

export const runtime = 'nodejs'

// GET /api/workspace/[id]/history — list last 20 versions (reader)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const role = await getDocRole(cred, id)
  if (!role) return forbidden()
  try {
    const r = await query(`SELECT id, doc_id, octet_length(yjs_update) as bytes, actor_id, created_at FROM dashboard.workspace_doc_history WHERE doc_id = $1 ORDER BY created_at DESC LIMIT 20`, [id])
    return NextResponse.json({ history: r.rows })
  } catch (e) {
    console.error('[history GET]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}

// POST /api/workspace/[id]/history — save current snapshot (writer, called from client after PUT)
// Body: { yjs_b64?: string } but we just snapshot current yjs_update from workspace_docs as new history row
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const role = await getDocRole(cred, id)
  if (!role) return forbidden()
  // Only writer can snapshot; but allow any reader to trigger snapshot of current state (idempotent)
  const actorId = cred.kind === 'user' ? cred.user.user_id : 'service'
  try {
    // Copy current yjs_update as a history version (if not duplicate of last)
    const cur = await query(`SELECT yjs_update FROM dashboard.workspace_docs WHERE id = $1 OR id = $2 LIMIT 1`, [`workspace:${id}`, id])
    const yjs = cur.rows[0]?.yjs_update as Buffer | null
    if (!yjs || yjs.length === 0) return NextResponse.json({ ok: true, empty: true })
    // Dedupe: skip if last history has same length (cheap)
    const last = await query(`SELECT octet_length(yjs_update) as bytes FROM dashboard.workspace_doc_history WHERE doc_id = $1 ORDER BY created_at DESC LIMIT 1`, [id])
    if (last.rows[0] && Number(last.rows[0].bytes) === yjs.length) {
      return NextResponse.json({ ok: true, deduped: true })
    }
    const ins = await query(`INSERT INTO dashboard.workspace_doc_history (doc_id, yjs_update, actor_id) VALUES ($1,$2,$3) RETURNING id, created_at`, [id, yjs, actorId])
    return NextResponse.json({ ok: true, id: ins.rows[0].id })
  } catch (e) {
    console.error('[history POST]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}

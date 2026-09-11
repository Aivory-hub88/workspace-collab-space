import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { workspaceCredential, unauthorized, forbidden } from '@/lib/workspaceAuth'
import { getDocRole, canWrite } from '@/lib/workspaceAccess'

export const runtime = 'nodejs'

// POST /api/workspace/[id]/history/[historyId]/restore — restore yjs_update from history (writer)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; historyId: string }> }) {
  const { id, historyId } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const role = await getDocRole(cred, id)
  if (!canWrite(role)) return forbidden()
  try {
    const r = await query(`SELECT yjs_update FROM dashboard.workspace_doc_history WHERE id = $1 AND doc_id = $2 LIMIT 1`, [historyId, id])
    if (!r.rows[0]) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const yjs = r.rows[0].yjs_update as Buffer
    // Overwrite both rows (bare + workspace: prefix) — keep them in sync
    await query(`UPDATE dashboard.workspace_docs SET yjs_update = $2, updated_at = now() WHERE id = ANY($1::text[])`, [[id, `workspace:${id}`], yjs])
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[history restore]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}

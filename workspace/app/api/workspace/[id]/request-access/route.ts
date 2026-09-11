import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { workspaceCredential, unauthorized, forbidden } from '@/lib/workspaceAuth'
import { getDocRole } from '@/lib/workspaceAccess'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  if (cred.kind !== 'user') return NextResponse.json({ error: 'user auth required' }, { status: 401 })
  const role = await getDocRole(cred, id)
  if (role) return NextResponse.json({ error: 'already has access', role }, { status: 400 })
  let body: { role?: string } = {}
  try {
    body = await req.json()
  } catch {}
  const roleRequested = (body.role ?? 'viewer').toString() as 'viewer' | 'editor'
  if (!['viewer', 'editor'].includes(roleRequested)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 })
  }
  const requestId = `req-${Math.random().toString(36).slice(2, 10)}`
  try {
    // workspace_id from doc row
    const r = await query('SELECT workspace_id FROM dashboard.workspace_docs WHERE id = $1 OR id = $2 LIMIT 1', [
      `workspace:${id}`,
      id,
    ])
    const workspaceId = r.rows[0]?.workspace_id ?? 'default'
    await query(
      `INSERT INTO dashboard.workspace_access_requests (id, doc_id, workspace_id, requester_id, requester_email, role_requested, status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending')
       ON CONFLICT DO NOTHING`,
      [requestId, id, workspaceId, cred.user.user_id, cred.user.email ?? null, roleRequested],
    )
    // if unique violation on pending, return existing
    const existing = await query(
      `SELECT id, status FROM dashboard.workspace_access_requests WHERE doc_id=$1 AND requester_id=$2 AND status='pending' ORDER BY created_at DESC LIMIT 1`,
      [id, cred.user.user_id],
    )
    return NextResponse.json({ ok: true, request: existing.rows[0] ?? { id: requestId, status: 'pending' } })
  } catch (e) {
    console.error('[request-access]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}

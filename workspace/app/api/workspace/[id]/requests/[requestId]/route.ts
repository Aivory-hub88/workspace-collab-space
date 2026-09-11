import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { workspaceCredential, unauthorized, forbidden } from '@/lib/workspaceAuth'

export const runtime = 'nodejs'

async function isDocManager(docId: string, cred: any): Promise<boolean> {
  if (cred.kind === 'service') return true
  if (cred.user.account_type === 'admin' || cred.user.account_type === 'superadmin') return true
  const r = await query('SELECT owner FROM dashboard.workspace_docs WHERE id=$1 OR id=$2', [
    `workspace:${docId}`,
    docId,
  ])
  const row = r.rows.find((x: any) => x.id === `workspace:${docId}`) ?? r.rows[0]
  return !!row && row.owner === cred.user.user_id
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  if (!(await isDocManager(id, cred))) return forbidden()
  let body: { action?: string; role?: string } = {}
  try {
    body = await req.json()
  } catch {}
  const action = (body.action ?? '').toString()
  if (!['approve', 'deny'].includes(action)) return NextResponse.json({ error: 'action must be approve|deny' }, { status: 400 })
  try {
    const r = await query('SELECT * FROM dashboard.workspace_access_requests WHERE id=$1 AND doc_id=$2', [
      requestId,
      id,
    ])
    if (r.rows.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const reqRow = r.rows[0]
    if (reqRow.status !== 'pending') return NextResponse.json({ error: 'already decided' }, { status: 400 })
    const actorId = cred.kind === 'service' ? 'service' : cred.user.user_id
    if (action === 'deny') {
      await query(
        `UPDATE dashboard.workspace_access_requests SET status='denied', decided_at=now(), decided_by=$1 WHERE id=$2`,
        [actorId, requestId],
      )
      return NextResponse.json({ ok: true, status: 'denied' })
    }
    // approve -> grant doc ACL + mark approved
    const role = (body.role ?? reqRow.role_requested).toString()
    if (!['viewer', 'editor'].includes(role)) return NextResponse.json({ error: 'invalid role' }, { status: 400 })
    await query(
      `INSERT INTO dashboard.workspace_doc_acl (doc_id, user_id, role, granted_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT (doc_id, user_id) DO UPDATE SET role=EXCLUDED.role`,
      [id, reqRow.requester_id, role, actorId],
    )
    await query(
      `UPDATE dashboard.workspace_access_requests SET status='approved', decided_at=now(), decided_by=$1 WHERE id=$2`,
      [actorId, requestId],
    )
    return NextResponse.json({ ok: true, status: 'approved', role })
  } catch (e) {
    console.error('[requests patch]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}

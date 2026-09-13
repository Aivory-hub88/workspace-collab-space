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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  if (!(await isDocManager(id, cred))) return forbidden()
  try {
    const r = await query(
      `SELECT r.id, r.doc_id, r.requester_id, r.requester_email, r.role_requested, r.status, r.created_at, u.email as user_email, u.full_name
       FROM dashboard.workspace_access_requests r
       LEFT JOIN identity.users u ON u.id = r.requester_id
       WHERE r.doc_id = $1 ORDER BY r.created_at DESC`,
      [id],
    )
    return NextResponse.json({ doc_id: id, requests: r.rows })
  } catch (e) {
    console.error('[requests list]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}

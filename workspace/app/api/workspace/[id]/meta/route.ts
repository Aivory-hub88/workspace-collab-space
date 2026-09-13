import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { workspaceCredential, unauthorized, forbidden } from '@/lib/workspaceAuth'
import { getDocRole } from '@/lib/workspaceAccess'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const role = await getDocRole(cred, id)
  if (!role) return forbidden()
  try {
    const r = await query(
      `SELECT id, workspace_id, owner, title, mode, favorite, icon, cover_url, tags, props, created_at, updated_at, deleted_at FROM dashboard.workspace_docs WHERE id = $1 OR id = $2 LIMIT 2`,
      [`workspace:${id}`, id],
    )
    const row = r.rows.find((x: any) => x.id === `workspace:${id}`) ?? r.rows[0] ?? null
    let ownerEmail: string | null = null
    let ownerName: string | null = null
    if (row?.owner) {
      const u = await query('SELECT email, full_name FROM identity.users WHERE id = $1', [row.owner])
      ownerEmail = u.rows[0]?.email ?? null
      ownerName = u.rows[0]?.full_name ?? null
    }
    // pending request by me?
    let myRequest: any = null
    if (cred.kind === 'user') {
      const rq = await query(
        `SELECT id, status, role_requested, created_at FROM dashboard.workspace_access_requests
         WHERE doc_id = $1 AND requester_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [id, cred.user.user_id],
      )
      myRequest = rq.rows[0] ?? null
    }
    return NextResponse.json({
      id,
      workspace_id: row?.workspace_id ?? 'default',
      owner: row?.owner ?? null,
      ownerEmail,
      ownerName,
      title: row?.title ?? id,
      mode: 'page',
      favorite: row?.favorite === true,
      icon: typeof row?.icon === 'string' && row.icon ? row.icon : null,
      cover_url: typeof row?.cover_url === 'string' && row.cover_url ? row.cover_url : null,
      tags: Array.isArray(row?.tags) ? row.tags : [],
      props: row?.props && typeof row.props === 'object' ? row.props : {},
      created_at: row?.created_at ?? null,
      updated_at: row?.updated_at ?? null,
      deleted_at: row?.deleted_at ?? null,
      myRole: role,
      myRequest,
    })
  } catch (e) {
    console.error('[workspace meta]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}

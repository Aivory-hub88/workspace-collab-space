import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { workspaceCredential, unauthorized } from '@/lib/workspaceAuth'
import { getDocRole } from '@/lib/workspaceAccess'
import { recordWorkspaceActivity } from '@/lib/workspaceActivity'

export const runtime = 'nodejs'

function newId(): string {
  return `doc-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

export async function GET(req: NextRequest) {
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const showTrash = req.nextUrl.searchParams.get('trash') === '1'
  try {
    const r = await query(
      `SELECT id, workspace_id, owner, title, mode, favorite, deleted_at, updated_at, octet_length(yjs_update) as bytes
       FROM dashboard.workspace_docs WHERE deleted_at IS ${showTrash ? 'NOT NULL' : 'NULL'} ORDER BY updated_at DESC LIMIT 100`,
    )
    const visible: any[] = []
    for (const row of r.rows) {
      const bare = (row.id as string).replace(/^workspace:/, '').replace(/^db:/, '')
      // skip the room-keyed dupe if bare also exists? keep both but dedupe by bare
      const role = await getDocRole(cred, bare)
      if (role) {
        visible.push({
          id: bare,
          roomKey: row.id,
          workspace_id: row.workspace_id,
          owner: row.owner,
          title: row.title ?? bare,
          mode: 'page',
          favorite: row.favorite === true,
          deleted_at: row.deleted_at ?? null,
          updated_at: row.updated_at,
          bytes: Number(row.bytes ?? 0),
          myRole: role,
        })
      }
    }
    // dedupe by bare id keep first (most recent)
    const seen = new Set<string>()
    const deduped = visible.filter((v) => {
      if (seen.has(v.id)) return false
      seen.add(v.id)
      return true
    })
    return NextResponse.json({ docs: deduped })
  } catch (e) {
    console.error('[workspace list]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  if (cred.kind !== 'user' && cred.kind !== 'service') return unauthorized()
  const userId = cred.kind === 'service' ? 'service' : cred.user.user_id
  let body: { title?: string; id?: string; workspace_id?: string } = {}
  try {
    body = await req.json()
  } catch {}
  const id = (body.id ?? newId()).toString().slice(0, 64).replace(/[^a-zA-Z0-9-_]/g, '-')
  const title = (body.title ?? 'Untitled').toString().slice(0, 200)
  const workspaceId = (body.workspace_id ?? 'default').toString().slice(0, 64)
  try {
    await query(
      `INSERT INTO dashboard.workspace_docs (id, workspace_id, owner, title, yjs_update, updated_at)
       VALUES ($1, $2, $3, $4, ''::bytea, now())
       ON CONFLICT (id) DO NOTHING`,
      [id, workspaceId, userId, title],
    )
    // also ensure room-keyed row for collab lazy-load
    await query(
      `INSERT INTO dashboard.workspace_docs (id, workspace_id, owner, title, yjs_update, updated_at)
       VALUES ($1, $2, $3, $4, ''::bytea, now())
       ON CONFLICT (id) DO NOTHING`,
      [`workspace:${id}`, workspaceId, userId, title],
    )
    await recordWorkspaceActivity({
      docId: id,
      credential: cred,
      action: 'page.created',
      summary: `Created page “${title}”`,
      targetType: 'page',
      targetId: id,
    })
    return NextResponse.json({ id, title, workspace_id: workspaceId, owner: userId }, { status: 201 })
  } catch (e) {
    console.error('[workspace create]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}

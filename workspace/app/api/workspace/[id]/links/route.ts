import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { workspaceCredential, unauthorized, forbidden } from '@/lib/workspaceAuth'
import { getDocRole, canWrite } from '@/lib/workspaceAccess'

export const runtime = 'nodejs'

// GET /api/workspace/[id]/links — list outgoing + incoming (any reader)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const role = await getDocRole(cred, id)
  if (!role) return forbidden()
  try {
    const out = await query(`SELECT src, dst, created_at FROM dashboard.workspace_doc_links WHERE src = $1 ORDER BY created_at DESC`, [id])
    const inc = await query(`SELECT src, dst, created_at FROM dashboard.workspace_doc_links WHERE dst = $1 ORDER BY created_at DESC`, [id])
    return NextResponse.json({ outgoing: out.rows, incoming: inc.rows })
  } catch (e) {
    console.error('[links GET]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}

// POST /api/workspace/[id]/links { dst } — link this doc -> dst (writer)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const role = await getDocRole(cred, id)
  if (!canWrite(role)) return forbidden()
  let body: { dst?: unknown } = {}
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }
  const dst = body.dst?.toString().trim().slice(0, 64) ?? ""
  if (!dst) return NextResponse.json({ error: 'dst required' }, { status: 400 })
  if (dst === id) return NextResponse.json({ error: 'cannot link to self' }, { status: 400 })
  // Target must exist and be readable (prevents linking to private docs you can't see)
  const targetRole = await getDocRole(cred, dst)
  if (!targetRole) return NextResponse.json({ error: 'target not found' }, { status: 404 })
  const userId = cred.kind === 'user' ? cred.user.user_id : 'service'
  try {
    await query(`INSERT INTO dashboard.workspace_doc_links (src, dst, created_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [id, dst, userId])
    return NextResponse.json({ ok: true, src: id, dst })
  } catch (e) {
    console.error('[links POST]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}

// DELETE /api/workspace/[id]/links { dst } — unlink (writer, owner of src)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const role = await getDocRole(cred, id)
  if (!canWrite(role)) return forbidden()
  let body: { dst?: unknown } = {}
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }
  const dst = body.dst?.toString().trim() ?? ""
  if (!dst) return NextResponse.json({ error: 'dst required' }, { status: 400 })
  try {
    await query(`DELETE FROM dashboard.workspace_doc_links WHERE src = $1 AND dst = $2`, [id, dst])
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[links DELETE]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}

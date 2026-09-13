import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { workspaceCredential, unauthorized, forbidden } from "@/lib/workspaceAuth"
import { canManageDoc } from "@/lib/workspaceAccess"

export const runtime = "nodejs"

const ROLES = new Set(["editor", "viewer"])

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const userId = cred.kind === "service" ? undefined : cred.user.user_id
  const accountType = cred.kind === "service" ? "superadmin" : cred.user.account_type
  if (!(await canManageDoc(id, accountType, userId))) return forbidden()
  try {
    const r = await query(
      `SELECT a.doc_id, a.user_id, a.role, a.granted_by, a.created_at, u.email, u.full_name
       FROM dashboard.workspace_doc_acl a
       LEFT JOIN identity.users u ON u.id = a.user_id
       WHERE a.doc_id = $1 ORDER BY a.created_at`,
      [id],
    )
    return NextResponse.json({ doc_id: id, grants: r.rows })
  } catch (e) {
    console.error("[workspace/acl GET]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const actor = cred.kind === "service" ? undefined : cred.user.user_id
  const accountType = cred.kind === "service" ? "superadmin" : cred.user.account_type
  if (!(await canManageDoc(id, accountType, actor))) return forbidden()

  let body: { email?: string; role?: string; userId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const role = (body.role ?? "viewer").toString()
  if (!ROLES.has(role)) return NextResponse.json({ error: "invalid role (editor|viewer)" }, { status: 400 })

  let targetId = body.userId?.toString().trim()
  if (!targetId) {
    const email = (body.email ?? "").toString().trim().toLowerCase()
    if (!email) return NextResponse.json({ error: "email or userId required" }, { status: 400 })
    try {
      const r = await query("SELECT id FROM identity.users WHERE lower(email) = $1", [email])
      if (r.rows.length === 0) return NextResponse.json({ error: "user not found" }, { status: 404 })
      targetId = r.rows[0].id as string
    } catch {
      return NextResponse.json({ error: "db" }, { status: 500 })
    }
  }

  try {
    await query(
      `INSERT INTO dashboard.workspace_doc_acl (doc_id, user_id, role, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (doc_id, user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by`,
      [id, targetId, role, actor ?? "service"],
    )
    return NextResponse.json({ doc_id: id, user_id: targetId, role })
  } catch (e) {
    console.error("[workspace/acl POST]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}
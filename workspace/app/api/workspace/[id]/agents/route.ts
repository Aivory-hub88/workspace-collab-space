import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { workspaceCredential, unauthorized, forbidden } from "@/lib/workspaceAuth"
import { canManageDoc, isKnownAgentType, AGENT_DISPLAY_NAMES } from "@/lib/workspaceAccess"
import { recordWorkspaceActivity } from "@/lib/workspaceActivity"

export const runtime = "nodejs"

const ROLES = new Set(["editor", "viewer"])

// GET /api/workspace/[id]/agents — list invited agents (owner/manage only)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const userId = cred.kind === "service" ? undefined : cred.user.user_id
  const accountType = cred.kind === "service" ? "superadmin" : cred.user.account_type
  if (!(await canManageDoc(id, accountType, userId))) return forbidden()
  try {
    const r = await query(
      `SELECT doc_id, agent_type, role, granted_by, created_at
       FROM dashboard.workspace_agent_acl WHERE doc_id = $1 ORDER BY created_at`,
      [id],
    )
    const agents = r.rows.map((row) => ({
      ...row,
      display_name: AGENT_DISPLAY_NAMES[row.agent_type as string] ?? row.agent_type,
    }))
    return NextResponse.json({ doc_id: id, agents })
  } catch (e) {
    console.error("[workspace/agents GET]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

// POST /api/workspace/[id]/agents { agentType, role } — invite agent (owner/manage only)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const actor = cred.kind === "service" ? undefined : cred.user.user_id
  const accountType = cred.kind === "service" ? "superadmin" : cred.user.account_type
  if (!(await canManageDoc(id, accountType, actor))) return forbidden()

  let body: { agentType?: string; role?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const agentType = (body.agentType ?? "").toString().trim()
  if (!isKnownAgentType(agentType)) {
    return NextResponse.json({ error: "unknown agentType" }, { status: 400 })
  }
  const role = (body.role ?? "editor").toString()
  if (!ROLES.has(role)) return NextResponse.json({ error: "invalid role (editor|viewer)" }, { status: 400 })

  try {
    await query(
      `INSERT INTO dashboard.workspace_agent_acl (doc_id, agent_type, role, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (doc_id, agent_type) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by`,
      [id, agentType, role, actor],
    )
    await recordWorkspaceActivity({
      docId: id,
      credential: cred,
      agentType: actor ?? "system",
      action: "agent.invited",
      summary: `Invited agent ${AGENT_DISPLAY_NAMES[agentType] ?? agentType} as ${role}`,
      targetType: "agent",
      targetId: agentType,
      metadata: { role },
    })
    return NextResponse.json({ doc_id: id, agent_type: agentType, role })
  } catch (e) {
    console.error("[workspace/agents POST]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

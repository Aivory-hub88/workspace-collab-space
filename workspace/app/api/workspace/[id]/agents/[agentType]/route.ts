import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { workspaceCredential, unauthorized, forbidden } from "@/lib/workspaceAuth"
import { canManageDoc, isKnownAgentType, AGENT_DISPLAY_NAMES } from "@/lib/workspaceAccess"
import { recordWorkspaceActivity } from "@/lib/workspaceActivity"

export const runtime = "nodejs"

// DELETE /api/workspace/[id]/agents/[agentType] — revoke agent (owner/manage only)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; agentType: string }> },
) {
  const { id, agentType } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const actor = cred.kind === "service" ? undefined : cred.user.user_id
  const accountType = cred.kind === "service" ? "superadmin" : cred.user.account_type
  if (!(await canManageDoc(id, accountType, actor))) return forbidden()
  if (!isKnownAgentType(agentType)) {
    return NextResponse.json({ error: "unknown agentType" }, { status: 400 })
  }

  try {
    await query("DELETE FROM dashboard.workspace_agent_acl WHERE doc_id = $1 AND agent_type = $2", [id, agentType])
    await recordWorkspaceActivity({
      docId: id,
      credential: cred,
      agentType: actor ?? "system",
      action: "agent.revoked",
      summary: `Revoked agent ${AGENT_DISPLAY_NAMES[agentType] ?? agentType}`,
      targetType: "agent",
      targetId: agentType,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[workspace/agents DELETE]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

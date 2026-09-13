import { query } from "@/lib/db"
import { parseMentions } from "@/lib/workspaceDbModel"
import type { WorkspaceCredential } from "@/lib/workspaceAuth"
import { recordWorkspaceActivity } from "@/lib/workspaceActivity"

/**
 * Mention fan-out (Fase 4b): @agent / @email tokens in written text become
 * inbox rows. Comments append (each comment is new); descriptions sync
 * (delete-then-insert per row so edits don't duplicate the inbox).
 */

type MentionInput = {
  docId: string
  rowId?: string
  credential: WorkspaceCredential
  agentType?: string
  source: "comment" | "description"
  text: string
}

function actorOf(credential: WorkspaceCredential, agentType: string) {
  if (credential.kind === "service") {
    const name = agentType !== "user" ? agentType.replace(/_/g, " ") : "agent"
    return { actorType: "agent", actorId: agentType, actorName: name }
  }
  return {
    actorType: "user",
    actorId: credential.user.user_id,
    actorName: credential.user.email ?? credential.user.user_id,
  }
}

async function workspaceOf(docId: string): Promise<string> {
  try {
    const r = await query(`SELECT workspace_id FROM dashboard.workspace_docs WHERE id = $1 OR id = $2 LIMIT 1`, [
      docId,
      `workspace:${docId}`,
    ])
    return (r.rows[0]?.workspace_id as string | undefined) ?? "default"
  } catch {
    return "default"
  }
}

export async function recordCommentMentions(input: MentionInput): Promise<void> {
  const { docId, rowId, credential, source, text } = input
  const agentType = input.agentType ?? "user"
  const { agents, emails } = parseMentions(text)
  if (agents.length === 0 && emails.length === 0) return
  try {
    const workspaceId = await workspaceOf(docId)
    const actor = actorOf(credential, agentType)
    const excerpt = text.trim().slice(0, 200)
    const labels: string[] = []
    for (const a of agents) {
      await query(
        `INSERT INTO dashboard.workspace_mentions
          (workspace_id, doc_id, row_id, actor_type, actor_id, actor_name, mentioned_kind, mentioned_id, source, excerpt)
         VALUES ($1,$2,$3,$4,$5,$6,'agent',$7,$8,$9)`,
        [workspaceId, docId, rowId ?? null, actor.actorType, actor.actorId, actor.actorName, a, source, excerpt],
      )
      labels.push(`@${a}`)
    }
    for (const e of emails) {
      await query(
        `INSERT INTO dashboard.workspace_mentions
          (workspace_id, doc_id, row_id, actor_type, actor_id, actor_name, mentioned_kind, mentioned_id, source, excerpt)
         VALUES ($1,$2,$3,$4,$5,$6,'user',$7,$8,$9)`,
        [workspaceId, docId, rowId ?? null, actor.actorType, actor.actorId, actor.actorName, e, source, excerpt],
      )
      labels.push(`@${e}`)
    }
    await recordWorkspaceActivity({
      docId,
      credential,
      agentType,
      action: "mention",
      summary: `${actor.actorName} mentioned ${labels.join(", ")}`,
      targetType: rowId ? "database-row" : "page",
      targetId: rowId,
      metadata: { agents, emails, source },
    })
  } catch (e) {
    console.error("[workspace mentions]", e)
  }
}

/** Replace description-source mentions for a row with a fresh parse. */
export async function syncDescriptionMentions(input: MentionInput): Promise<void> {
  try {
    await query(
      `DELETE FROM dashboard.workspace_mentions WHERE doc_id = $1 AND row_id = $2 AND source = 'description'`,
      [input.docId, input.rowId ?? null],
    )
  } catch (e) {
    console.error("[workspace mentions sync]", e)
    return
  }
  await recordCommentMentions({ ...input, source: "description" })
}

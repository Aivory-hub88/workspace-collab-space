import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { workspaceCredential, authorizeDocFallback, unauthorized, forbidden } from "@/lib/workspaceAuth"
import { getDocRole, canRead, getAgentDocRole, isKnownAgentType } from "@/lib/workspaceAccess"
import { projectMemberDocs, legacyDocId } from "@/lib/workspaceDoc"
import { loadDbDoc, rowsFromDbDoc, getWipLimits, WorkspaceDenied, type DbRow } from "@/lib/workspaceDb"

export const runtime = "nodejs"

// Aggregate caps: the board unions member databases server-side, so bound
// both dimensions to keep one request from fanning out over the workspace.
const MAX_MEMBER_DOCS = 20
const MAX_ROWS_PER_DOC = 200

type BoardDoc = {
  doc_id: string
  title: string
  wip: Record<string, number>
  rows: Array<DbRow & { doc_id: string }>
}

// GET /api/workspace/projects/[id]/board — union of member-doc databases.
// A project is a doc with props.isProject + props.projectDocs (member ids).
// Every member is gated individually: docs the caller can't read are skipped
// (never 403 the whole board because of one private doc).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const agent = req.headers.get("x-agent-type") ?? undefined
  const assertedAgent = cred.kind === "service" && isKnownAgentType(agent) ? agent : undefined

  const canReadDoc = async (docId: string): Promise<boolean> => {
    if (cred.kind === "service") {
      if (!assertedAgent) return true
      return canRead(await getAgentDocRole(docId, assertedAgent))
    }
    return canRead(await getDocRole(cred, docId))
  }

  try {
    // Project doc row (bare or room-keyed).
    const pr = await query(
      `SELECT id, title, props, workspace_id FROM dashboard.workspace_docs
       WHERE id = $1 OR id = $2 LIMIT 2`,
      [`workspace:${id}`, id],
    )
    const prowid = pr.rows.find((r) => r.id === `workspace:${id}`) ?? pr.rows[0]
    const props = (prowid?.props ?? {}) as Record<string, unknown>
    if (!prowid || props.isProject !== true) {
      return NextResponse.json({ error: "not a project" }, { status: 404 })
    }
    if (!(await canReadDoc(id))) return forbidden()

    let members = projectMemberDocs(props)
    if (members.length === 0) {
      // No members pinned yet: fall back to sibling docs in the same workspace.
      try {
        const sib = await query(
          `SELECT id FROM dashboard.workspace_docs
           WHERE workspace_id = $1 AND deleted_at IS NULL LIMIT $2`,
          [prowid.workspace_id ?? "default", MAX_MEMBER_DOCS + 1],
        )
        members = sib.rows
          .map((r) => legacyDocId(r.id as string))
          .filter((m: string) => !m.startsWith("room:"))
          .slice(0, MAX_MEMBER_DOCS)
      } catch {
        members = []
      }
    }
    members = members.slice(0, MAX_MEMBER_DOCS)

    // Titles for member docs (both key forms, one round-trip).
    const keys = members.flatMap((m) => [`workspace:${m}`, m])
    let titles = new Map<string, string>()
    if (keys.length > 0) {
      try {
        const tr = await query(`SELECT id, title FROM dashboard.workspace_docs WHERE id = ANY($1::text[])`, [keys])
        for (const row of tr.rows) titles.set(legacyDocId(row.id as string), (row.title as string) ?? legacyDocId(row.id as string))
      } catch {}
    }

    const allowPg = cred.kind === "service" ? true : await authorizeDocFallback(cred, id)
    const docs: BoardDoc[] = []
    for (const m of members) {
      if (!(await canReadDoc(m))) continue
      try {
        const doc = await loadDbDoc(m, cred, assertedAgent, allowPg)
        const rows = rowsFromDbDoc(doc)
          .slice(0, MAX_ROWS_PER_DOC)
          .map((r) => ({ ...r, doc_id: m }))
        docs.push({ doc_id: m, title: titles.get(m) ?? m, wip: await getWipLimits(m), rows })
      } catch (e) {
        if (e instanceof WorkspaceDenied) continue // collab denied → skip, keep board partial
        throw e
      }
    }
    const totalRows = docs.reduce((n, d) => n + d.rows.length, 0)
    return NextResponse.json({
      project_id: legacyDocId(id),
      title: (prowid.title as string) ?? legacyDocId(id),
      room: `workspace:room:${legacyDocId(id)}`,
      docs,
      totalRows,
    })
  } catch (e) {
    console.error("[workspace/projects board GET]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

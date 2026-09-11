import { NextRequest, NextResponse } from "next/server"
import * as Y from "yjs"
import { workspaceCredential, authorizeDocFallback, unauthorized, forbidden } from "@/lib/workspaceAuth"
import { checkAgentAccess } from "@/lib/workspaceAccess"
import {
  WorkspaceDenied,
  loadDbDoc,
  saveDbDoc,
  parseDbRow,
  MAX_COMMENTS_PER_ROW,
  MAX_COMMENT_LEN,
} from "@/lib/workspaceDb"
import { recordWorkspaceActivity } from "@/lib/workspaceActivity"

export const runtime = "nodejs"

// Threaded row comments (same Yjs `database` row maps the client uses).
// Append-only via POST — no full-array replace, so concurrent commenters
// can't clobber each other (last-writer-wins only applies per map key,
// and we merge server-side under the doc lock of load → save).

function authorOf(cred: NonNullable<ReturnType<typeof workspaceCredential>>, agentType: string): string {
  if (cred.kind === "service") return agentType !== "user" ? agentType : "agent"
  return cred.user.email ?? cred.user.user_id
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const { id, rowId } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const agent = req.headers.get("x-agent-type")
  if (await checkAgentAccess(id, cred, agent, 'read')) return forbidden()
  try {
    const allowPg = cred.kind === "service" ? true : await authorizeDocFallback(cred, id)
    const doc = await loadDbDoc(id, cred, agent ?? undefined, allowPg)
    const m = doc
      .getArray<Y.Map<unknown>>("database")
      .toArray()
      .find((x) => (x.get("id") as string) === rowId)
    if (!m) return NextResponse.json({ error: "not found" }, { status: 404 })
    return NextResponse.json({ id: rowId, comments: parseDbRow(m).comments })
  } catch (e) {
    if (e instanceof WorkspaceDenied) return NextResponse.json({ error: "forbidden" }, { status: e.status })
    console.error("[workspace/comments GET]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const { id, rowId } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const assertedAgent = req.headers.get("x-agent-type") || req.headers.get("X-Agent-Type")
  if (await checkAgentAccess(id, cred, assertedAgent, 'write')) return forbidden()
  const agentType = assertedAgent || "user"
  let body: { text?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_COMMENT_LEN) : ""
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 })

  try {
    const allowPg = cred.kind === "service" ? true : await authorizeDocFallback(cred, id)
    const doc = await loadDbDoc(id, cred, agentType, allowPg)
    const arr = doc.getArray<Y.Map<unknown>>("database")
    const m = arr.toArray().find((x) => (x.get("id") as string) === rowId)
    if (!m) return NextResponse.json({ error: "not found" }, { status: 404 })
    const row = parseDbRow(m)
    if (row.comments.length >= MAX_COMMENTS_PER_ROW) {
      return NextResponse.json({ error: "comments-full" }, { status: 409 })
    }
    const comment = {
      id: `c-${Date.now().toString(36)}`,
      text,
      author: authorOf(cred, agentType).slice(0, 100),
      at: new Date().toISOString(),
    }
    doc.transact(() => {
      m.set("comments", [...row.comments, comment])
    }, agentType)
    await saveDbDoc(id, doc, cred, agentType)
    await recordWorkspaceActivity({
      docId: id,
      credential: cred,
      agentType,
      action: "database.row_commented",
      summary: `Commented on task ${rowId}`,
      targetType: "database-row",
      targetId: rowId,
    })
    return NextResponse.json({ id: comment.id, comment }, { status: 201 })
  } catch (e) {
    if (e instanceof WorkspaceDenied) return NextResponse.json({ error: "forbidden" }, { status: e.status })
    console.error("[workspace/comments POST]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

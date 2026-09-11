import { NextRequest, NextResponse } from "next/server"
import * as Y from "yjs"
import { workspaceCredential, authorizeDocFallback, unauthorized, forbidden } from "@/lib/workspaceAuth"
import { checkAgentAccess } from "@/lib/workspaceAccess"
import {
  WorkspaceDenied,
  loadDbDoc,
  saveDbDoc,
  rowsFromDbDoc,
  getWipLimits,
  wipExceeded,
} from "@/lib/workspaceDb"
import { recordWorkspaceActivity } from "@/lib/workspaceActivity"

export const runtime = "nodejs"

// Dedicated status-move endpoint (Fase 3).
// Why not plain PATCH: drag-and-drop clients need one atomic "move card"
// call with the WIP verdict inline (409 wip-exceeded) instead of a generic
// field patch. Single purpose, same Yjs `database` array as everything else.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const { id, rowId } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const assertedAgent = req.headers.get("x-agent-type") || req.headers.get("X-Agent-Type")
  if (await checkAgentAccess(id, cred, assertedAgent, 'write')) return forbidden()
  const agentType = assertedAgent || "user"

  let body: { status?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const status = typeof body.status === "string" ? body.status.slice(0, 16) : ""
  if (!status) return NextResponse.json({ error: "status required" }, { status: 400 })

  try {
    const allowPg = cred.kind === "service" ? true : await authorizeDocFallback(cred, id)
    const doc = await loadDbDoc(id, cred, agentType, allowPg)
    const arr = doc.getArray<Y.Map<unknown>>("database")
    const idx = arr.toArray().findIndex((m) => (m.get("id") as string) === rowId)
    if (idx < 0) return NextResponse.json({ error: "not found" }, { status: 404 })
    const m = arr.get(idx) as Y.Map<unknown>
    const from = (m.get("status") as string) ?? "Todo"
    if (from === status) return NextResponse.json({ id: rowId, status, moved: false })
    const limited = wipExceeded(rowsFromDbDoc(doc), status, await getWipLimits(id), rowId)
    if (limited !== null) {
      return NextResponse.json({ error: "wip-exceeded", limit: limited }, { status: 409 })
    }
    doc.transact(() => m.set("status", status), agentType)
    await saveDbDoc(id, doc, cred, agentType)
    await recordWorkspaceActivity({
      docId: id,
      credential: cred,
      agentType,
      action: "database.row_moved",
      summary: `Moved task ${rowId} from ${from} to ${status}`,
      targetType: "database-row",
      targetId: rowId,
      metadata: { from, to: status },
    })
    return NextResponse.json({ id: rowId, status, moved: true, from })
  } catch (e) {
    if (e instanceof WorkspaceDenied) return NextResponse.json({ error: "forbidden" }, { status: e.status })
    console.error("[workspace/move POST]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from "next/server"
import * as Y from "yjs"
import { workspaceCredential, authorizeDocFallback, unauthorized, forbidden } from "@/lib/workspaceAuth"
import { checkAgentAccess } from "@/lib/workspaceAccess"
import {
  WorkspaceDenied,
  loadDbDoc,
  saveDbDoc,
  rowsFromDbDoc,
  parseDbRow,
  getWipLimits,
  getFieldDefs,
  cleanCells,
  wipExceeded,
  withResolvedRollups,
  MAX_DESCRIPTION_LEN,
} from "@/lib/workspaceDb"
import { recordWorkspaceActivity } from "@/lib/workspaceActivity"
import { syncDescriptionMentions } from "@/lib/workspaceMentions"
import { getAutomationRules, runStatusAutomations } from "@/lib/workspaceAutomations"
import { indexRow, removeRowIndex, rowText, workspaceOf } from "@/lib/workspaceIndex"

export const runtime = "nodejs"

const SCALAR_FIELDS = new Set(["title", "status", "priority", "assignee", "due", "description"])

function cleanPatch(patch: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (!SCALAR_FIELDS.has(k) || typeof v !== "string") continue
    const cap = k === "title" ? 200 : k === "description" ? MAX_DESCRIPTION_LEN : k === "assignee" ? 100 : k === "due" ? 20 : 16
    out[k] = v.slice(0, cap)
  }
  if (out.priority !== undefined && out.priority !== "Low" && out.priority !== "Med" && out.priority !== "High") {
    out.priority = "Med"
  }
  return out
}

async function allowPg(cred: NonNullable<ReturnType<typeof workspaceCredential>>, id: string): Promise<boolean> {
  return cred.kind === "service" ? true : authorizeDocFallback(cred, id)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const { id, rowId } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const assertedAgent = req.headers.get("x-agent-type") || req.headers.get("X-Agent-Type")
  if (await checkAgentAccess(id, cred, assertedAgent, 'write')) return forbidden()
  const agentType = assertedAgent || "user"
  let patch: Record<string, unknown>
  try {
    patch = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const clean = cleanPatch(patch)
  const hasCells = patch.cells !== undefined
  if (Object.keys(clean).length === 0 && !hasCells) return NextResponse.json({ error: "nothing to update" }, { status: 400 })

  try {
    const doc = await loadDbDoc(id, cred, agentType, await allowPg(cred, id))
    const arr = doc.getArray<Y.Map<unknown>>("database")
    const idx = arr.toArray().findIndex((m) => (m.get("id") as string) === rowId)
    if (idx < 0) return NextResponse.json({ error: "not found" }, { status: 404 })
    // WIP gate (F2-4): moving into a full column is rejected, not queued.
    if (clean.status !== undefined) {
      const limited = wipExceeded(rowsFromDbDoc(doc), clean.status, await getWipLimits(id), rowId)
      if (limited !== null) {
        return NextResponse.json({ error: "wip-exceeded", limit: limited }, { status: 409 })
      }
    }
    const m = arr.get(idx) as Y.Map<unknown>
    const prevStatus = (m.get("status") as string) ?? "Todo"
    // Custom cells merge (never replace): concurrent editors on different
    // fields must not clobber each other. Defs load BEFORE the transaction
    // (yrs transactions are sync-only, no awaits inside).
    let mergedCells: Record<string, string | number | boolean | string[]> | null = null
    if (patch.cells !== undefined) {
      mergedCells = { ...parseDbRow(m).cells, ...cleanCells(patch.cells, await getFieldDefs(id)) }
    }
    doc.transact(() => {
      for (const [k, v] of Object.entries(clean)) m.set(k, v)
      if (mergedCells) m.set("cells", mergedCells)
    }, agentType)
    const actorName = cred.kind === "service" ? agentType.replace(/_/g, " ") : (cred.user.email ?? cred.user.user_id)
    const automated = await runStatusAutomations({
      doc,
      rowId,
      prevStatus,
      wipLimits: await getWipLimits(id),
      actorName,
      origin: agentType,
      getRules: () => getAutomationRules(id),
    })
    await saveDbDoc(id, doc, cred, agentType)
    await recordWorkspaceActivity({
      docId: id,
      credential: cred,
      agentType,
      action: "database.row_updated",
      summary: `Updated task ${rowId}`,
      targetType: "database-row",
      targetId: rowId,
      metadata: clean,
    })
    if (automated.length > 0) {
      await recordWorkspaceActivity({
        docId: id,
        credential: cred,
        agentType,
        action: "database.automation",
        summary: `Automation ran on task ${rowId}: ${automated.map((a) => a.ruleName).join(", ")}`,
        targetType: "database-row",
        targetId: rowId,
        metadata: { applied: automated },
      })
    }
    const updated = parseDbRow(arr.get(idx) as Y.Map<unknown>)
    const [resolved] = await withResolvedRollups([updated], await getFieldDefs(id), cred, agentType, await allowPg(cred, id))
    if (clean.description !== undefined) {
      await syncDescriptionMentions({ docId: id, rowId, credential: cred, agentType, source: "description", text: clean.description })
    }
    // Semantic reindex on text-affecting edits (best-effort, non-blocking).
    if (clean.title !== undefined || clean.description !== undefined || clean.assignee !== undefined) {
      const fresh = parseDbRow(arr.get(idx) as Y.Map<unknown>)
      void indexRow(id, rowId, await workspaceOf(id), rowText(fresh)).catch(() => {})
    }
    return NextResponse.json({ id: rowId, patched: clean, ...(mergedCells ? { cells: mergedCells } : {}), rollups: resolved?.cells ?? {} })
  } catch (e) {
    if (e instanceof WorkspaceDenied) return NextResponse.json({ error: "forbidden" }, { status: e.status })
    console.error("[workspace/database PATCH]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const { id, rowId } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const assertedAgent = req.headers.get("x-agent-type") || req.headers.get("X-Agent-Type")
  if (await checkAgentAccess(id, cred, assertedAgent, 'write')) return forbidden()
  const agentType = assertedAgent || "user"
  try {
    const doc = await loadDbDoc(id, cred, agentType, await allowPg(cred, id))
    const arr = doc.getArray<Y.Map<unknown>>("database")
    const idx = arr.toArray().findIndex((m) => (m.get("id") as string) === rowId)
    if (idx < 0) return NextResponse.json({ error: "not found" }, { status: 404 })
    doc.transact(() => arr.delete(idx, 1), agentType)
    await saveDbDoc(id, doc, cred, agentType)
    void removeRowIndex(id, rowId).catch(() => {})
    await recordWorkspaceActivity({
      docId: id,
      credential: cred,
      agentType,
      action: "database.row_deleted",
      summary: `Deleted task ${rowId}`,
      targetType: "database-row",
      targetId: rowId,
    })
    return NextResponse.json({ ok: true, id: rowId })
  } catch (e) {
    if (e instanceof WorkspaceDenied) return NextResponse.json({ error: "forbidden" }, { status: e.status })
    console.error("[workspace/database DELETE]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

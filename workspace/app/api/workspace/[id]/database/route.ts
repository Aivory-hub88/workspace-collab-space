import { NextRequest, NextResponse } from "next/server"
import * as Y from "yjs"
import { workspaceCredential, authorizeDocFallback, unauthorized, forbidden } from "@/lib/workspaceAuth"
import { checkAgentAccess } from "@/lib/workspaceAccess"
import {
  WorkspaceDenied,
  loadDbDoc,
  saveDbDoc,
  rowsFromDbDoc,
  newDbRowId,
  dbRowToYMap,
  getWipLimits,
  getFieldDefs,
  cleanCells,
  wipExceeded,
  withResolvedRollups,
  MAX_DESCRIPTION_LEN,
  type DbRow,
} from "@/lib/workspaceDb"
import { recordWorkspaceActivity } from "@/lib/workspaceActivity"
import { indexRow, rowText, workspaceOf } from "@/lib/workspaceIndex"
import { getAutomationRules, runStatusAutomations } from "@/lib/workspaceAutomations"

export const runtime = "nodejs"

function cleanRowInput(body: Partial<DbRow>): Omit<DbRow, "id" | "comments" | "cells"> {
  const status = (body.status ?? "Todo").toString().slice(0, 16)
  const priority = body.priority === "Low" || body.priority === "High" ? body.priority : "Med"
  return {
    title: (body.title ?? "Untitled").toString().slice(0, 200),
    status,
    priority,
    assignee: (body.assignee ?? "").toString().slice(0, 100),
    due: (body.due ?? "").toString().slice(0, 20),
    description: (body.description ?? "").toString().slice(0, MAX_DESCRIPTION_LEN),
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const agent = req.headers.get("x-agent-type")
  // Agent gate: invited agents read per their grant; revoked/unknown agents 403
  // (also covers the pg-fallback path when collab is down).
  if (await checkAgentAccess(id, cred, agent, 'read')) return forbidden()
  try {
    const allowPg = cred.kind === "service" ? true : await authorizeDocFallback(cred, id)
    const doc = await loadDbDoc(id, cred, agent ?? undefined, allowPg)
    const rows = await withResolvedRollups(rowsFromDbDoc(doc), await getFieldDefs(id), cred, agent ?? undefined, allowPg)
    return NextResponse.json({ id, rows })
  } catch (e) {
    if (e instanceof WorkspaceDenied) return NextResponse.json({ error: "forbidden" }, { status: e.status })
    console.error("[workspace/database GET]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const assertedAgent = req.headers.get("x-agent-type") || req.headers.get("X-Agent-Type")
  // Agent gate: only invited editor+ agents may write (also covers pg fallback).
  if (await checkAgentAccess(id, cred, assertedAgent, 'write')) return forbidden()
  let body: Partial<DbRow>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const agentType = assertedAgent || (body.assignee ?? "").toString().slice(0, 100) || "user"

  try {
    const allowPg = cred.kind === "service" ? true : await authorizeDocFallback(cred, id)
    const doc = await loadDbDoc(id, cred, agentType, allowPg)
    const rows = rowsFromDbDoc(doc)
    // WIP gate (F2-4): creating into a full column is rejected, not queued.
    const limited = wipExceeded(rows, (body.status ?? "Todo").toString().slice(0, 16), await getWipLimits(id))
    if (limited !== null) {
      return NextResponse.json({ error: "wip-exceeded", limit: limited }, { status: 409 })
    }
    const newRow: DbRow = {
      id: newDbRowId(),
      ...cleanRowInput(body),
      comments: [],
      cells: cleanCells(body.cells, await getFieldDefs(id)),
    }
    doc.transact(() => doc.getArray<Y.Map<unknown>>("database").push([dbRowToYMap(newRow)]), agentType)
    const actorName = cred.kind === "service" ? agentType.replace(/_/g, " ") : (cred.user.email ?? cred.user.user_id)
    const automated = await runStatusAutomations({
      doc,
      rowId: newRow.id,
      prevStatus: null,
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
      action: 'database.row_created',
      summary: `Created task “${newRow.title}”`,
      targetType: 'database-row',
      targetId: newRow.id,
      metadata: { status: newRow.status, priority: newRow.priority, assignee: newRow.assignee, due: newRow.due },
    })
    if (automated.length > 0) {
      await recordWorkspaceActivity({
        docId: id,
        credential: cred,
        agentType,
        action: 'database.automation',
        summary: `Automation ran on task ${newRow.id}: ${automated.map((a) => a.ruleName).join(", ")}`,
        targetType: 'database-row',
        targetId: newRow.id,
        metadata: { applied: automated },
      })
    }
    const [resolved] = await withResolvedRollups([newRow], await getFieldDefs(id), cred, agentType, allowPg)
    // Semantic index (best-effort, never blocks the response).
    void indexRow(id, newRow.id, await workspaceOf(id), rowText(newRow)).catch(() => {})
    return NextResponse.json({ id: newRow.id, row: resolved ?? newRow, agentType }, { status: 201 })
  } catch (e) {
    if (e instanceof WorkspaceDenied) return NextResponse.json({ error: "forbidden" }, { status: e.status })
    console.error("[workspace/database POST]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

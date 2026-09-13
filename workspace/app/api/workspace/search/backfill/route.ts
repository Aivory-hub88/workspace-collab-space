import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { workspaceCredential, authorizeDocFallback, unauthorized, forbidden } from "@/lib/workspaceAuth"
import { getDocRole, canWrite } from "@/lib/workspaceAccess"
import { checkAgentAccess } from "@/lib/workspaceAccess"
import { loadDbDoc, rowsFromDbDoc, WorkspaceDenied } from "@/lib/workspaceDb"
import { embeddingsConfigured } from "@/lib/embeddings"
import { indexRow, rowText, workspaceOf } from "@/lib/workspaceIndex"

export const runtime = "nodejs"

// Backfill semantic chunks for one doc (Fase 4c2): (re)indexes up to 200
// rows missing embeddings. Requires write access — indexing reads full row
// text. Without an embedding key this is a no-op explaining itself.

const MAX_BACKFILL_ROWS = 200

export async function POST(req: NextRequest) {
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  let body: { docId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const docId = typeof body.docId === "string" ? body.docId.trim().slice(0, 64) : ""
  if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 })
  const agent = req.headers.get("x-agent-type") ?? undefined
  if (await checkAgentAccess(docId, cred, agent, "write")) return forbidden()
  if (cred.kind === "user" && !canWrite(await getDocRole(cred, docId))) return forbidden()

  if (!embeddingsConfigured()) {
    return NextResponse.json({ error: "embeddings not configured", indexed: 0, skipped: 0 }, { status: 503 })
  }
  try {
    const allowPg = cred.kind === "service" ? true : await authorizeDocFallback(cred, docId)
    const doc = await loadDbDoc(docId, cred, agent ?? undefined, allowPg)
    const rows = rowsFromDbDoc(doc).slice(0, MAX_BACKFILL_ROWS)
    const ws = await workspaceOf(docId)
    let indexed = 0
    let skipped = 0
    try {
      const existing = await query(`SELECT row_id FROM dashboard.workspace_chunks WHERE doc_id = $1`, [docId])
      const done = new Set(existing.rows.map((r) => r.row_id as string))
      for (const r of rows) {
        if (done.has(r.id)) {
          skipped++
          continue
        }
        if (await indexRow(docId, r.id, ws, rowText(r))) indexed++
        else skipped++
      }
    } catch {
      return NextResponse.json({ error: "db" }, { status: 500 })
    }
    return NextResponse.json({ doc_id: docId, indexed, skipped })
  } catch (e) {
    if (e instanceof WorkspaceDenied) return NextResponse.json({ error: "forbidden" }, { status: e.status })
    console.error("[workspace/search backfill]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

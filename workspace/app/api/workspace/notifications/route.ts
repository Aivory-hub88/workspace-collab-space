import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { workspaceCredential, unauthorized } from "@/lib/workspaceAuth"
import { isKnownAgentType, canReadDocId } from "@/lib/workspaceAccess"

export const runtime = "nodejs"

// Notification inbox (Fase 4b): mentions of the caller (agent type or user
// email/id), unread = created after the reader's watermark. Mention rows
// whose doc the caller can no longer read are skipped, never leaked.

type Reader = { kind: "agent" | "user"; id: string }

function readerOf(req: NextRequest, cred: NonNullable<ReturnType<typeof workspaceCredential>>): Reader | null {
  if (cred.kind === "service") {
    const agent = req.headers.get("x-agent-type") || req.headers.get("X-Agent-Type") || req.nextUrl.searchParams.get("agent")
    if (!isKnownAgentType(agent)) return null
    return { kind: "agent", id: agent }
  }
  const email = cred.user.email?.toLowerCase()
  return { kind: "user", id: email || cred.user.user_id }
}

async function watermark(reader: Reader): Promise<string> {
  try {
    const r = await query(
      `SELECT read_at FROM dashboard.workspace_mention_reads WHERE reader_kind = $1 AND reader_id = $2`,
      [reader.kind, reader.id],
    )
    return (r.rows[0]?.read_at as string | undefined) ?? new Date(0).toISOString()
  } catch {
    return new Date(0).toISOString()
  }
}

export async function GET(req: NextRequest) {
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const reader = readerOf(req, cred)
  if (!reader) return NextResponse.json({ error: "agent required (X-Agent-Type)" }, { status: 400 })
  try {
    const since = await watermark(reader)
    // Users match by email or user id (either form may have been mentioned).
    const allIds = [...new Set([reader.id, ...(cred.kind === "user" ? [cred.user.user_id] : [])])]
    const r = await query(
      `SELECT id, workspace_id, doc_id, row_id, actor_type, actor_id, actor_name,
              mentioned_kind, mentioned_id, source, excerpt, created_at
       FROM dashboard.workspace_mentions
       WHERE mentioned_kind = $1 AND mentioned_id = ANY($2::text[]) AND created_at > $3
       ORDER BY created_at DESC LIMIT 50`,
      [reader.kind, allIds, since],
    )
    const mentions = []
    for (const m of r.rows) {
      const docId = m.doc_id as string
      const ok = await canReadDocId(cred, docId, reader.kind === "agent" ? reader.id : undefined).catch(() => false)
      if (ok) mentions.push(m)
    }
    return NextResponse.json({ reader, unread: mentions.length, read_at: since, mentions })
  } catch (e) {
    console.error("[workspace/notifications GET]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

// POST /api/workspace/notifications { markRead: true } — advance watermark.
export async function POST(req: NextRequest) {
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const reader = readerOf(req, cred)
  if (!reader) return NextResponse.json({ error: "agent required (X-Agent-Type)" }, { status: 400 })
  let body: { markRead?: unknown } = {}
  try {
    body = await req.json()
  } catch {}
  if (body.markRead !== true) return NextResponse.json({ error: "markRead required" }, { status: 400 })
  try {
    await query(
      `INSERT INTO dashboard.workspace_mention_reads (reader_kind, reader_id, read_at)
       VALUES ($1, $2, now())
       ON CONFLICT (reader_kind, reader_id) DO UPDATE SET read_at = now()`,
      [reader.kind, reader.id],
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[workspace/notifications POST]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
}

import * as Y from "yjs"
import { query } from "@/lib/db"
import { canonicalRoomId, legacyDocId, mergeYjsUpdates } from "@/lib/workspaceDoc"
import { collabAuthHeaders, type WorkspaceCredential } from "@/lib/workspaceAuth"
import { canReadDocId } from "@/lib/workspaceAccess"
import { computeRollups, parseFieldDefs, type FieldDef, type CellValue } from "@/lib/workspaceDbModel"

// Re-exported so existing importers keep working; the pure model lives in
// workspaceDbModel.ts (client-safe: no pg/node imports, see its header).
export {
  parseFieldDefs,
  cleanCells,
  readCells,
  MAX_FIELDS_PER_DOC,
  MAX_FIELD_OPTIONS,
  MAX_CELL_TEXT,
  type FieldDef,
  type FieldType,
  type CellValue,
} from "@/lib/workspaceDbModel"
import { cleanCells, readCells } from "@/lib/workspaceDbModel"

/**
 * Shared database-row plane (Fase 2 Opsi C).
 *
 * Single source of truth for the task Row model so the REST routes
 * (`database`, `database/[rowId]`, `database/[rowId]/comments`,
 * `projects/[id]/board`) never drift lossy again: the client already
 * stores description + threaded comments in the same Yjs `database` array.
 */

export type DbRowComment = { id: string; text: string; author: string; at: string }
export type DbRow = {
  id: string
  title: string
  status: string
  priority: "Low" | "Med" | "High"
  assignee: string
  due: string
  description: string
  comments: DbRowComment[]
  cells: Record<string, CellValue>
}

export const MAX_COMMENTS_PER_ROW = 100
export const MAX_COMMENT_LEN = 500
export const MAX_DESCRIPTION_LEN = 4000
const VALID_PRIORITIES = new Set(["Low", "Med", "High"])

/** Field definitions for a doc (empty when none configured). */
export async function getFieldDefs(docId: string): Promise<FieldDef[]> {
  try {
    const r = await query(`SELECT props FROM dashboard.workspace_docs WHERE id = $1 OR id = $2 LIMIT 1`, [
      `workspace:${docId}`,
      docId,
    ])
    const props = r.rows[0]?.props as Record<string, unknown> | undefined
    return parseFieldDefs(props?.dbFields)
  } catch {
    return []
  }
}

const COLLAB_URL = process.env.COLLAB_URL || "http://aivory-collab:3200"

export class WorkspaceDenied extends Error {
  status: number
  constructor(status: number) {
    super("denied")
    this.status = status
  }
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback
}

export function parseDbRow(m: Y.Map<unknown>): DbRow {
  const rawComments = m.get("comments")
  let comments: DbRowComment[] = []
  if (Array.isArray(rawComments)) {
    comments = (rawComments as unknown[])
      .filter(
        (c): c is DbRowComment =>
          !!c && typeof c === "object" && typeof (c as DbRowComment).id === "string" && typeof (c as DbRowComment).text === "string",
      )
      .slice(0, MAX_COMMENTS_PER_ROW) as DbRowComment[]
  }
  const priority = str(m.get("priority"), "Med")
  return {
    id: str(m.get("id")),
    title: str(m.get("title")),
    status: str(m.get("status"), "Todo"),
    priority: (VALID_PRIORITIES.has(priority) ? priority : "Med") as DbRow["priority"],
    assignee: str(m.get("assignee")),
    due: str(m.get("due")),
    description: str(m.get("description")).slice(0, MAX_DESCRIPTION_LEN),
    comments,
    cells: readCells(m.get("cells")),
  }
}

export function rowsFromDbDoc(doc: Y.Doc): DbRow[] {
  return doc.getArray<Y.Map<unknown>>("database").toArray().map(parseDbRow)
}

export function newDbRowId(): string {
  return Math.random().toString(36).slice(2, 8)
}

export function dbRowToYMap(r: DbRow): Y.Map<unknown> {
  const m = new Y.Map<unknown>()
  m.set("id", r.id)
  m.set("title", r.title)
  m.set("status", r.status)
  m.set("priority", r.priority)
  m.set("assignee", r.assignee)
  m.set("due", r.due)
  m.set("description", r.description)
  m.set("comments", r.comments)
  m.set("cells", r.cells)
  return m
}

async function collabFetch(
  id: string,
  cred: WorkspaceCredential,
  agentType: string | undefined,
  init?: RequestInit,
): Promise<Response | null> {
  const headers: Record<string, string> = { ...collabAuthHeaders(cred), ...(init?.headers as Record<string, string> | undefined) }
  if (agentType) headers["X-Agent-Type"] = agentType
  try {
    return (await fetch(`${COLLAB_URL}/api/workspace/${encodeURIComponent(id)}/doc`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(2000),
    } as RequestInit)) as Response
  } catch {
    return null
  }
}

/** Load the database Y.Doc: collab first (authoritative RBAC), pg merge fallback.
 * When collab is unreachable the pg fallback serves ONLY if `allowPgFallback`
 * (callers: authorizeDocFallback for users, checkAgentAccess for agents) —
 * otherwise a collab outage must not turn into an auth bypass. */
export async function loadDbDoc(
  id: string,
  cred: WorkspaceCredential,
  agentType?: string,
  allowPgFallback = false,
): Promise<Y.Doc> {
  const doc = new Y.Doc()
  const res = await collabFetch(id, cred, agentType)
  if (res && (res.status === 401 || res.status === 403)) throw new WorkspaceDenied(res.status)
  if (res?.ok) {
    const buf = await res.arrayBuffer()
    if (buf.byteLength > 0) Y.applyUpdate(doc, new Uint8Array(buf))
    return doc
  }
  if (!allowPgFallback) throw new WorkspaceDenied(403)
  const r = await query("SELECT id, yjs_update FROM dashboard.workspace_docs WHERE id = $1 OR id = $2", [
    canonicalRoomId(id),
    legacyDocId(id),
  ])
  if (r.rows.length > 0) {
    const byId = new Map<string, Buffer>(r.rows.map((row) => [row.id as string, row.yjs_update as Buffer]))
    const merged = mergeYjsUpdates([byId.get(canonicalRoomId(id)) ?? null, byId.get(legacyDocId(id)) ?? null])
    if (merged) Y.applyUpdate(doc, new Uint8Array(merged))
  }
  return doc
}

/**
 * Persist the database Y.Doc: collab PUT first (its 401/403 verdict wins and
 * must NOT leak into pg), then pg upsert of the merged state.
 */
export async function saveDbDoc(id: string, doc: Y.Doc, cred: WorkspaceCredential, agentType = "user"): Promise<void> {
  const upd = Buffer.from(Y.encodeStateAsUpdate(doc))
  const res = await collabFetch(id, cred, agentType, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: upd as unknown as BodyInit,
  })
  if (res && (res.status === 401 || res.status === 403)) throw new WorkspaceDenied(res.status)
  await query(
    `INSERT INTO dashboard.workspace_docs (id, yjs_update, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (id) DO UPDATE SET yjs_update = EXCLUDED.yjs_update, updated_at = now()`,
    [id, upd],
  )
}

/** WIP limits from the doc's pg props (`props.dbWip`, same shape the client persists). */
export async function getWipLimits(docId: string): Promise<Record<string, number>> {
  try {
    const r = await query(`SELECT props FROM dashboard.workspace_docs WHERE id = $1 OR id = $2 LIMIT 1`, [
      `workspace:${docId}`,
      docId,
    ])
    const props = r.rows[0]?.props as Record<string, unknown> | undefined
    const raw = props?.dbWip
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = typeof v === "number" ? Math.floor(v) : parseInt(String(v ?? ""), 10)
      if (k && Number.isFinite(n) && n >= 1 && n <= 50) out[k.slice(0, 16)] = n
    }
    return out
  } catch {
    return {}
  }
}

/**
 * WIP gate (F2-4): moving/creating into `status` is rejected when the column
 * already holds `limit` rows. Returns the offending limit or null.
 */
export function wipExceeded(rows: DbRow[], status: string, limits: Record<string, number>, excludeId?: string): number | null {
  const limit = limits[status]
  if (limit === undefined) return null
  const count = rows.filter((r) => r.status === status && r.id !== excludeId).length
  return count + 1 > limit ? limit : null
}

/**
 * Resolve rollup cells for rows (Fase 4a): loads each distinct target doc
 * once (gated per doc — unreadable targets resolve to null, never leak),
 * computes via the pure computeRollups, and injects values into the rows'
 * cells for the response. Never persisted here; storage stays raw links.
 */
export async function withResolvedRollups(
  rows: DbRow[],
  defs: FieldDef[],
  cred: WorkspaceCredential,
  agentType?: string,
  allowPgFallback = false,
): Promise<DbRow[]> {
  const needTargets = new Set<string>()
  for (const d of defs) {
    if (d.type !== "rollup" || !d.relationFieldId) continue
    const rel = defs.find((x) => x.id === d.relationFieldId && x.type === "relation")
    if (rel?.targetDocId) needTargets.add(rel.targetDocId)
  }
  if (needTargets.size === 0 || rows.length === 0) return rows
  const cache = new Map<string, DbRow[] | null>()
  for (const t of needTargets) {
    if (!(await canReadDocId(cred, t, agentType))) {
      cache.set(t, null)
      continue
    }
    try {
      const doc = await loadDbDoc(t, cred, agentType, allowPgFallback)
      cache.set(t, rowsFromDbDoc(doc))
    } catch {
      cache.set(t, null)
    }
  }
  const computed = computeRollups(rows, defs, (docId) => cache.get(docId) ?? null)
  if (Object.keys(computed).length === 0) return rows
  // Nulls (unreadable links) are omitted from cells — renderers show empty.
  return rows.map((r) => {
    const c = computed[r.id]
    if (!c) return r
    const cells: DbRow["cells"] = { ...r.cells }
    for (const [k, v] of Object.entries(c)) {
      if (v === null) delete cells[k]
      else cells[k] = v
    }
    return { ...r, cells }
  })
}

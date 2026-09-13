/**
 * Pure database-row model (Fase 3b) — CLIENT-SAFE, no server imports.
 *
 * Separated from lib/workspaceDb.ts (which pulls pg via lib/db) so client
 * components can share validation without dragging node builtins into the
 * browser bundle (Turbopack build failure otherwise).
 */

export type FieldType = "text" | "number" | "select" | "multi" | "checkbox" | "date" | "url" | "relation" | "rollup"
export type RollupOp = "count" | "donePct" | "sum"
export type FieldDef = {
  id: string
  name: string
  type: FieldType
  options: string[]
  /** relation: bare target doc id whose rows can be linked. */
  targetDocId?: string
  /** rollup: id of the relation field in THIS doc to aggregate over. */
  relationFieldId?: string
  /** rollup: aggregation to compute. */
  rollupOp?: RollupOp
  /** rollup sum: custom number field id in the TARGET doc to total. */
  rollupFieldId?: string
}
export type CellValue = string | number | boolean | string[]

const VALID_FIELD_TYPES: ReadonlySet<string> = new Set(["text", "number", "select", "multi", "checkbox", "date", "url", "relation", "rollup"])
const VALID_ROLLUP_OPS: ReadonlySet<string> = new Set(["count", "donePct", "sum"])
export const MAX_FIELDS_PER_DOC = 20
export const MAX_FIELD_OPTIONS = 20
export const MAX_CELL_TEXT = 500
export const MAX_LINKS_PER_CELL = 50

function cleanDocId(v: unknown): string {
  if (typeof v !== "string") return ""
  return v.trim().replace(/^workspace:(room:|db:)?/, "").slice(0, 64)
}

/** Validate raw props.dbFields into clean definitions (used by REST + PATCH). */
export function parseFieldDefs(raw: unknown): FieldDef[] {
  if (!Array.isArray(raw)) return []
  const out: FieldDef[] = []
  const seen = new Set<string>()
  for (const v of raw.slice(0, MAX_FIELDS_PER_DOC)) {
    if (!v || typeof v !== "object") continue
    const r = v as Record<string, unknown>
    const id = typeof r.id === "string" ? r.id.slice(0, 16) : ""
    if (!id || seen.has(id)) continue
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 24) : ""
    if (!name) continue
    let type: FieldType = typeof r.type === "string" && VALID_FIELD_TYPES.has(r.type) ? (r.type as FieldType) : "text"
    let options: string[] = []
    if ((type === "select" || type === "multi") && Array.isArray(r.options)) {
      for (const o of r.options.slice(0, MAX_FIELD_OPTIONS)) {
        if (typeof o !== "string") continue
        const t = o.trim().slice(0, 24)
        if (t && !options.includes(t)) options.push(t)
      }
    }
    // Relation needs a target doc; rollup needs a sibling relation + valid op.
    // Invalid configs degrade to text (column stays visible, no data loss).
    let targetDocId: string | undefined
    let relationFieldId: string | undefined
    let rollupOp: RollupOp | undefined
    let rollupFieldId: string | undefined
    if (type === "relation") {
      targetDocId = cleanDocId(r.targetDocId) || undefined
      if (!targetDocId) type = "text"
    }
    if (type === "rollup") {
      const rel = typeof r.relationFieldId === "string" ? r.relationFieldId.slice(0, 16) : ""
      const op = typeof r.rollupOp === "string" && VALID_ROLLUP_OPS.has(r.rollupOp) ? (r.rollupOp as RollupOp) : null
      const relOk = out.some((d) => d.id === rel && d.type === "relation")
      if (!rel || !relOk || !op) {
        type = "text"
      } else {
        relationFieldId = rel
        rollupOp = op
        if (op === "sum") {
          rollupFieldId = typeof r.rollupFieldId === "string" ? r.rollupFieldId.slice(0, 16) : undefined
        }
      }
    }
    seen.add(id)
    const def: FieldDef = { id, name, type, options }
    if (targetDocId) def.targetDocId = targetDocId
    if (relationFieldId) def.relationFieldId = relationFieldId
    if (rollupOp) def.rollupOp = rollupOp
    if (rollupFieldId) def.rollupFieldId = rollupFieldId
    out.push(def)
  }
  return out
}

function cleanCellValue(def: FieldDef, v: unknown): CellValue | undefined {
  switch (def.type) {
    case "text":
    case "url":
      return typeof v === "string" ? v.slice(0, MAX_CELL_TEXT) : undefined
    case "number": {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
      return Number.isFinite(n) ? n : undefined
    }
    case "date":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined
    case "checkbox":
      return typeof v === "boolean" ? v : undefined
    case "select":
      return typeof v === "string" && def.options.includes(v) ? v : undefined
    case "multi": {
      const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : []
      const kept = arr.filter((x): x is string => typeof x === "string" && def.options.includes(x)).slice(0, MAX_FIELD_OPTIONS)
      return kept
    }
    case "relation": {
      // Linked row ids in the target doc. Validated as opaque ids here;
      // existence + readability resolve at read time (rollups, pickers).
      const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : []
      const kept = arr
        .filter((x): x is string => typeof x === "string" && x.trim() !== "")
        .map((x) => x.trim().slice(0, 64))
        .slice(0, MAX_LINKS_PER_CELL)
      return kept
    }
    case "rollup":
      // Computed server-side on read; client values are never stored.
      return undefined
  }
}

/** Validate a client-supplied cells object against defs; unknown fields dropped. */
export function cleanCells(cells: unknown, defs: FieldDef[]): Record<string, CellValue> {
  if (!cells || typeof cells !== "object" || Array.isArray(cells)) return {}
  const out: Record<string, CellValue> = {}
  const src = cells as Record<string, unknown>
  for (const def of defs) {
    if (!(def.id in src)) continue
    const c = cleanCellValue(def, src[def.id])
    if (c !== undefined) out[def.id] = c
  }
  return out
}

/** Read-time passthrough for stored cells (validation happens on write). */
export function readCells(v: unknown): Record<string, CellValue> {  if (!v || typeof v !== "object" || Array.isArray(v)) return {}
  const out: Record<string, CellValue> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val.slice(0, MAX_CELL_TEXT)
    else if (typeof val === "number" && Number.isFinite(val)) out[k] = val
    else if (typeof val === "boolean") out[k] = val
    else if (Array.isArray(val)) out[k] = val.filter((x): x is string => typeof x === "string").slice(0, MAX_FIELD_OPTIONS)
  }
  return out
}

/** Minimal row shape for rollup computation (server DbRow satisfies this). */
export type RollupSubject = {
  id: string
  status: string
  cells: Record<string, CellValue>
}

function linkedIds(cells: Record<string, CellValue>, fieldId: string): string[] {
  const v = cells[fieldId]
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string")
  return []
}

/**
 * Compute rollup values (pure): for every rollup def, aggregate over the
 * rows linked through its relation field. `getTargetRows` returns the
 * target doc's rows the caller is allowed to read, or null when unreadable
 * (those links resolve to null, never to leaked data).
 * Returns { rowId: { fieldId: value } }; null = nothing readable linked.
 */
export function computeRollups(
  rows: RollupSubject[],
  defs: FieldDef[],
  getTargetRows: (docId: string) => RollupSubject[] | null,
): Record<string, Record<string, number | null>> {
  const out: Record<string, Record<string, number | null>> = {}
  const rollups = defs.filter((d) => d.type === "rollup" && d.relationFieldId && d.rollupOp)
  if (rollups.length === 0) return out
  const relTarget = new Map<string, string>()
  for (const d of defs) {
    if (d.type === "relation" && d.targetDocId) relTarget.set(d.id, d.targetDocId)
  }
  const cache = new Map<string, RollupSubject[] | null>()
  const targetOf = (docId: string): RollupSubject[] | null => {
    if (!cache.has(docId)) cache.set(docId, getTargetRows(docId))
    return cache.get(docId) ?? null
  }
  for (const row of rows) {
    const cell: Record<string, number | null> = {}
    let touched = false
    for (const def of rollups) {
      const relId = def.relationFieldId as string
      const targetDoc = relTarget.get(relId)
      if (!targetDoc) continue
      const links = linkedIds(row.cells, relId)
      if (links.length === 0) continue
      const readable = targetOf(targetDoc)
      if (!readable) {
        cell[def.id] = null
        touched = true
        continue
      }
      const byId = new Map(readable.map((r) => [r.id, r]))
      const linked = links.map((id) => byId.get(id)).filter((r): r is RollupSubject => !!r)
      if (linked.length === 0) continue
      if (def.rollupOp === "count") {
        cell[def.id] = linked.length
      } else if (def.rollupOp === "donePct") {
        cell[def.id] = Math.round((linked.filter((r) => r.status === "Done").length / linked.length) * 100)
      } else if (def.rollupOp === "sum" && def.rollupFieldId) {
        let total = 0
        for (const r of linked) {
          const v = r.cells[def.rollupFieldId as string]
          const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
          if (Number.isFinite(n)) total += n
        }
        cell[def.id] = total
      }
      touched = true
    }
    if (touched) out[row.id] = cell
  }
  return out
}

/** Known Cerveau agents for @mention resolution (display name + type id). */
export const MENTIONABLE_AGENTS: ReadonlyArray<{ type: string; names: string[] }> = [
  { type: "autonomous", names: ["geno", "autonomous"] },
  { type: "customer_service", names: ["teo", "customer_service", "customer-service"] },
  { type: "leads_qualifier", names: ["lex", "leads_qualifier", "leads-qualifier"] },
  { type: "finance_invoice_ops", names: ["finn", "finance_invoice_ops", "finance-invoice-ops"] },
  { type: "office_assistant", names: ["ofira", "office_assistant", "office-assistant"] },
]

export type ParsedMentions = { agents: string[]; emails: string[] }

/**
 * Parse @mentions from free text (pure): @Geno/@autonomous → agent type,
 * @user@example.com → user email. Case-insensitive, deduped, capped.
 */
export function parseMentions(text: unknown): ParsedMentions {
  if (typeof text !== "string" || text.length === 0) return { agents: [], emails: [] }
  const agents = new Set<string>()
  const emails = new Set<string>()
  const emailRe = /@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g
  let m: RegExpExecArray | null
  while ((m = emailRe.exec(text)) !== null) {
    if (emails.size < 20) emails.add(m[1].toLowerCase())
  }
  const stripped = text.replace(emailRe, " ")
  const tokenRe = /@([A-Za-z][A-Za-z0-9_-]*)/g
  while ((m = tokenRe.exec(stripped)) !== null) {
    const tok = m[1].toLowerCase()
    const hit = MENTIONABLE_AGENTS.find((a) => a.names.includes(tok))
    if (hit && agents.size < 20) agents.add(hit.type)
  }
  return { agents: [...agents], emails: [...emails] }
}

export type DueFilter = "All" | "Overdue" | "Today" | "This week" | "Next 7 days" | "No date";
export const DUE_FILTERS: DueFilter[] = ["All", "Overdue", "Today", "This week", "Next 7 days", "No date"];

function isoDaysFrom(todayISO: string, delta: number): string {
  const d = new Date(`${todayISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function weekStartISO(todayISO: string): string {
  const d = new Date(`${todayISO}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Relative due-date predicate (pure; todayISO = YYYY-MM-DD). */
export function matchesDueFilter(due: string, status: string, filter: string, todayISO: string): boolean {
  switch (filter) {
    case "Overdue":
      return !!due && due < todayISO && status !== "Done";
    case "Today":
      return due === todayISO;
    case "This week": {
      const start = weekStartISO(todayISO);
      const end = isoDaysFrom(start, 6);
      return !!due && due >= start && due <= end;
    }
    case "Next 7 days": {
      const end = isoDaysFrom(todayISO, 7);
      return !!due && due >= todayISO && due <= end;
    }
    case "No date":
      return !due;
    default:
      return true;
  }
}

export type AutomationRule = {
  id: string
  name: string
  whenStatus: string
  setAssignee?: string
  addComment?: string
  moveTo?: string
}

export const MAX_AUTOMATIONS = 20
const AUTOMATION_STATUSES: ReadonlySet<string> = new Set(["Todo", "Doing", "Done"])

/** Validate raw props.dbAutomations (used by REST + PATCH). */
export function parseAutomationRules(raw: unknown): AutomationRule[] {
  if (!Array.isArray(raw)) return []
  const out: AutomationRule[] = []
  const seen = new Set<string>()
  for (const v of raw.slice(0, MAX_AUTOMATIONS)) {
    if (!v || typeof v !== "object") continue
    const r = v as Record<string, unknown>
    const id = typeof r.id === "string" ? r.id.slice(0, 32) : ""
    if (!id || seen.has(id)) continue
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 40) : ""
    if (!name) continue
    const whenStatus = typeof r.whenStatus === "string" ? r.whenStatus.slice(0, 16) : ""
    if (!AUTOMATION_STATUSES.has(whenStatus)) continue
    const rule: AutomationRule = { id, name, whenStatus }
    if (typeof r.setAssignee === "string" && r.setAssignee.trim()) {
      rule.setAssignee = r.setAssignee.trim().slice(0, 100)
    }
    if (typeof r.addComment === "string" && r.addComment.trim()) {
      rule.addComment = r.addComment.trim().slice(0, 500)
    }
    if (typeof r.moveTo === "string" && AUTOMATION_STATUSES.has(r.moveTo) && r.moveTo !== whenStatus) {
      rule.moveTo = r.moveTo
    }
    if (rule.setAssignee === undefined && rule.addComment === undefined && rule.moveTo === undefined) continue
    seen.add(id)
    out.push(rule)
  }
  return out
}

/** Rules whose trigger matches a move into `next` (prev null = creation). */
export function matchRules(rules: AutomationRule[], prevStatus: string | null, nextStatus: string): AutomationRule[] {
  if (prevStatus === nextStatus) return []
  return rules.filter((r) => r.whenStatus === nextStatus)
}

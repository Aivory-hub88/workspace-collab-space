/**
 * Pure database-row model (Fase 3b) — CLIENT-SAFE, no server imports.
 *
 * Separated from lib/workspaceDb.ts (which pulls pg via lib/db) so client
 * components can share validation without dragging node builtins into the
 * browser bundle (Turbopack build failure otherwise).
 */

export type FieldType = "text" | "number" | "select" | "multi" | "checkbox" | "date" | "url"
export type FieldDef = { id: string; name: string; type: FieldType; options: string[] }
export type CellValue = string | number | boolean | string[]

const VALID_FIELD_TYPES: ReadonlySet<string> = new Set(["text", "number", "select", "multi", "checkbox", "date", "url"])
export const MAX_FIELDS_PER_DOC = 20
export const MAX_FIELD_OPTIONS = 20
export const MAX_CELL_TEXT = 500

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
    const type = typeof r.type === "string" && VALID_FIELD_TYPES.has(r.type) ? (r.type as FieldType) : "text"
    let options: string[] = []
    if ((type === "select" || type === "multi") && Array.isArray(r.options)) {
      for (const o of r.options.slice(0, MAX_FIELD_OPTIONS)) {
        if (typeof o !== "string") continue
        const t = o.trim().slice(0, 24)
        if (t && !options.includes(t)) options.push(t)
      }
    }
    seen.add(id)
    out.push({ id, name, type, options })
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
export function readCells(v: unknown): Record<string, CellValue> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {}
  const out: Record<string, CellValue> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val.slice(0, MAX_CELL_TEXT)
    else if (typeof val === "number" && Number.isFinite(val)) out[k] = val
    else if (typeof val === "boolean") out[k] = val
    else if (Array.isArray(val)) out[k] = val.filter((x): x is string => typeof x === "string").slice(0, MAX_FIELD_OPTIONS)
  }
  return out
}

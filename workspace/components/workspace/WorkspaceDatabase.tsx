"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import * as Y from "yjs"
import { WebsocketProvider } from "y-websocket"
import { Table, Kanban, Plus, GripVertical, Calendar, User, Search, ArrowUpNarrowWide, BookmarkPlus, Trash2, Upload, LayoutTemplate, Zap } from "lucide-react"
import { collabAuthHeaders, collabWsParams, collabWsUrl } from "@/lib/collabClient"
import { readCells, computeRollups, DUE_FILTERS, matchesDueFilter, parseAutomationRules, type FieldDef, type CellValue, type AutomationRule } from "@/lib/workspaceDbModel"

type RowComment = { id: string; text: string; author: string; at: string }
type Row = { id: string; title: string; status: string; priority: "Low" | "Med" | "High"; assignee: string; due: string; description: string; comments: RowComment[]; cells: Record<string, CellValue> }

const STATUSES = ["Todo", "Doing", "Done"] as const
const PRIORITIES = ["Low", "Med", "High"] as const

// Invitable Cerveau agents (must match KNOWN_AGENT_TYPES server-side).
// Stored as the agent_type string so ACL, skills, and filters agree.
const AGENT_ASSIGNEES = [
  { value: "autonomous", label: "Geno" },
  { value: "customer_service", label: "Teo" },
  { value: "leads_qualifier", label: "Lex" },
  { value: "finance_invoice_ops", label: "Finn" },
  { value: "office_assistant", label: "Ofira" },
] as const

function assigneeLabel(v: string): string {
  const hit = AGENT_ASSIGNEES.find((a) => a.value === v)
  return hit ? `${hit.label} (agent)` : v
}

const STATUS_DOT: Record<string, string> = {
  Todo: "bg-white/40",
  Doing: "bg-amber-400",
  Done: "bg-emerald-400",
}

function uid() {
  return Math.random().toString(36).slice(2, 8)
}

function yMapFromRow(r: Row): Y.Map<unknown> {
  const m = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(r)) m.set(k, v)
  if (!m.has("cells")) m.set("cells", {})
  return m
}

function toRows(arr: Y.Array<Y.Map<unknown>>): Row[] {
  return arr.toArray().map((m) => {
    const rawComments = m.get("comments")
    let comments: RowComment[] = []
    if (Array.isArray(rawComments)) {
      comments = (rawComments as unknown[]).filter((c): c is RowComment => !!c && typeof c === "object" && typeof (c as RowComment).id === "string" && typeof (c as RowComment).text === "string").slice(0, 100) as RowComment[]
    }
    return {
      id: (m.get("id") as string) ?? uid(),
      title: (m.get("title") as string) ?? "",
      status: (m.get("status") as string) ?? "Todo",
      priority: (m.get("priority") as Row["priority"]) ?? "Med",
      assignee: (m.get("assignee") as string) ?? "",
      due: (m.get("due") as string) ?? "",
      description: (m.get("description") as string) ?? "",
      comments,
      cells: readCells(m.get("cells")),
    }
  })
}

/** Inline editor for one custom-field cell (table + drawer share it). */
function CellEditor({
  def,
  value,
  readOnly,
  onChange,
  relationRows,
  onEnsureRelationRows,
}: {
  def: FieldDef
  value: CellValue | undefined
  readOnly: boolean
  onChange: (v: CellValue | undefined) => void
  relationRows?: Array<{ id: string; title: string; status: string }>
  onEnsureRelationRows?: () => void
}) {
  const str = typeof value === "string" ? value : ""
  if (def.type === "relation") {
    const linked = Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []
    const titleOf = (id: string) => relationRows?.find((r) => r.id === id)?.title || id
    return (
      <span className="flex min-w-0 flex-col gap-1" onFocus={onEnsureRelationRows} onClick={onEnsureRelationRows}>
        {linked.length === 0 ? (
          <span className="text-[12px] text-white/25">{readOnly ? "—" : "Pick rows…"}</span>
        ) : (
          linked.map((id) => (
            <span key={id} className="group/rel inline-flex max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/70">
              <span className="min-w-0 flex-1 truncate">{titleOf(id)}</span>
              {!readOnly && (
                <button
                  onClick={() => onChange(linked.filter((x) => x !== id).length ? linked.filter((x) => x !== id) : undefined)}
                  title="Unlink"
                  className="shrink-0 rounded text-white/25 opacity-0 hover:text-red-300 group-hover/rel:opacity-100"
                >
                  ✕
                </button>
              )}
            </span>
          ))
        )}
        {!readOnly && relationRows && relationRows.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const id = e.target.value
              if (id && !linked.includes(id)) onChange([...linked, id].slice(0, 50))
              e.target.selectedIndex = 0
            }}
            className="w-full rounded-full border border-dashed border-white/15 bg-transparent px-2 py-1 text-[11px] text-white/50 outline-none"
            title={def.targetDocId ? `Link rows from ${def.targetDocId}` : "Link rows"}
          >
            <option value="">+ Link…</option>
            {relationRows
              .filter((r) => !linked.includes(r.id))
              .slice(0, 50)
              .map((r) => (
                <option key={r.id} value={r.id}>{r.title || "Untitled"}</option>
              ))}
          </select>
        )}
      </span>
    )
  }
  if (def.type === "rollup") {
    if (typeof value !== "number") {
      return <span className="text-[12px] text-white/25">—</span>
    }
    if (def.rollupOp === "donePct") {
      return (
        <span className="flex min-w-[90px] items-center gap-1.5" title={`${value}% done`}>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
            <span className="block h-full rounded-full bg-emerald-400" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
          </span>
          <span className="text-[11px] font-medium text-white/60">{value}%</span>
        </span>
      )
    }
    return <span className="text-[13px] font-medium tabular-nums text-white/75">{value}</span>
  }
  if (def.type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={value === true}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border border-white/20 bg-transparent accent-white disabled:opacity-50"
      />
    )
  }
  if (def.type === "select") {
    return (
      <select
        value={str}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="max-w-full rounded-full border bg-surface-2 px-2.5 py-1 text-[12px] text-white/70 outline-none disabled:opacity-60"
      >
        <option value="">—</option>
        {def.options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    )
  }
  if (def.type === "multi") {
    const cur = Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []
    const toggle = (o: string) => {
      const next = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]
      onChange(next.length ? next : undefined)
    }
    return (
      <span className="flex flex-wrap gap-1">
        {def.options.map((o) => {
          const on = cur.includes(o)
          return (
            <button
              key={o}
              disabled={readOnly}
              onClick={() => toggle(o)}
              className={`rounded-full border px-2 py-0.5 text-[11px] disabled:opacity-50 ${on ? "border-white/40 bg-white/[0.12] text-white/85" : "border-white/10 bg-transparent text-white/40 hover:text-white/70"}`}
            >
              {o}
            </button>
          )
        })}
        {def.options.length === 0 && <span className="text-[11px] text-white/25">no options</span>}
      </span>
    )
  }
  if (def.type === "number") {
    return (
      <input
        type="number"
        value={typeof value === "number" ? value : ""}
        disabled={readOnly}
        onChange={(e) => {
          const t = e.target.value
          onChange(t === "" ? undefined : Number(t))
        }}
        placeholder="—"
        className="w-full bg-transparent text-[13px] text-white/70 placeholder:text-white/25 outline-none disabled:opacity-60"
      />
    )
  }
  if (def.type === "date") {
    return (
      <input
        type="date"
        value={str}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="bg-transparent text-[13px] text-white/60 outline-none disabled:opacity-60"
      />
    )
  }
  if (def.type === "url") {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <input
          value={str}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value.trim() ? e.target.value.slice(0, 500) : undefined)}
          placeholder="https://…"
          className="w-full min-w-0 bg-transparent text-[13px] text-white/60 placeholder:text-white/25 outline-none disabled:opacity-60"
        />
        {str && (
          <a href={str} target="_blank" rel="noreferrer" title="Open link" className="shrink-0 text-[12px] text-white/35 hover:text-white/70">↗</a>
        )}
      </span>
    )
  }
  return (
    <input
      value={str}
      disabled={readOnly}
      onChange={(e) => onChange(e.target.value ? e.target.value.slice(0, 500) : undefined)}
      placeholder="—"
      className="w-full bg-transparent text-[13px] text-white/60 placeholder:text-white/25 outline-none disabled:opacity-60"
    />
  )
}

function PriorityPill({ p }: { p: Row["priority"] }) {  const cls =
    p === "High"
      ? "bg-red-500/10 text-red-300 border-red-500/20"
      : p === "Med"
        ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
        : "bg-white/[0.06] text-white/45 border-white/10"
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{p}</span>
}

function isOverdue(r: Row): boolean {
  return !!r.due && r.status !== "Done" && r.due < new Date().toISOString().slice(0, 10)
}

type HistoryItem = {
  id: string
  actor_type: string
  actor_id: string
  actor_name: string
  action: string
  summary: string
  created_at: string
}

/** Per-row history from the workspace activity log (created/moved/commented…). */
function RowHistory({ docId, rowId }: { docId: string; rowId: string }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null)
  useEffect(() => {
    let alive = true
    setItems(null)
    fetch(`/api/workspace/${docId}/activity?targetType=database-row&targetId=${encodeURIComponent(rowId)}`, {
      headers: collabAuthHeaders(),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive) setItems(Array.isArray(j?.activities) ? j.activities : [])
      })
      .catch(() => {
        if (alive) setItems([])
      })
    return () => {
      alive = false
    }
  }, [docId, rowId])
  if (items === null || items.length === 0) return null
  return (
    <div className="mt-6 border-t border-line pt-4">
      <div className="text-[11px] uppercase tracking-wider text-white/30">History · {items.length}</div>
      <div className="mt-2 flex flex-col gap-1.5">
        {items.slice(0, 10).map((h) => (
          <div key={h.id} className="rounded-xl bg-white/[0.02] px-3 py-2">
            <div className="text-[12px] leading-snug text-white/60">{h.summary}</div>
            <div className="mt-0.5 text-[10px] text-white/25">
              {h.actor_name || h.actor_id} · {h.action} ·{" "}
              {new Date(h.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusPill({ s }: { s: string }) {
  const cls =
    s === "Doing"
      ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
      : s === "Done"
        ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
        : "bg-white/[0.06] text-white/50 border-white/10"
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s] ?? "bg-white/40"}`} />
      {s}
    </span>
  )
}

function DonutByStatus({ rows }: { rows: Row[] }) {
  const total = rows.length || 1
  const counts: Record<string, number> = { Todo: 0, Doing: 0, Done: 0 }
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
  const segments = [
    { label: "Todo", value: counts.Todo, color: "#6b7280" },
    { label: "Doing", value: counts.Doing, color: "#f59e0b" },
    { label: "Done", value: counts.Done, color: "#10b981" },
  ]
  let acc = 0
  const r = 32
  const C = 2 * Math.PI * r
  return (
    <div className="flex items-center gap-4">
      <svg width={88} height={88} viewBox="0 0 88 88" className="shrink-0">
        <circle cx={44} cy={44} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={12} />
        {segments.map((s) => {
          const len = total ? (s.value / total) * C : 0
          const dash = `${len} ${C - len}`
          const offset = -acc * C
          acc += s.value / total
          return <circle key={s.label} cx={44} cy={44} r={r} fill="none" stroke={s.color} strokeWidth={12} strokeDasharray={dash} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 44 44)" opacity={s.value ? 1 : 0.15} />
        })}
        <text x={44} y={44} textAnchor="middle" dy="0.35em" fontSize={14} fontWeight={700} fill="rgba(255,255,255,0.85)">{rows.length}</text>
      </svg>
      <div className="flex flex-col gap-1.5">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-2 text-[11px] text-white/60">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label} <span className="text-white/30">· {s.value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function BarsByPriority({ rows }: { rows: Row[] }) {
  const counts: Record<string, number> = { High: 0, Med: 0, Low: 0 }
  for (const r of rows) counts[r.priority] = (counts[r.priority] ?? 0) + 1
  const max = Math.max(1, ...Object.values(counts))
  const items: Array<{ label: string; value: number; color: string }> = [
    { label: "High", value: counts.High, color: "#ef4444" },
    { label: "Med", value: counts.Med, color: "#f59e0b" },
    { label: "Low", value: counts.Low, color: "rgba(255,255,255,0.45)" },
  ]
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          <span className="w-10 text-[11px] text-white/40">{it.label}</span>
          <div className="flex-1 rounded-full bg-white/[0.06] p-0.5">
            <div className="h-2 rounded-full transition-all" style={{ width: `${(it.value / max) * 100}%`, background: it.color }} />
          </div>
          <span className="w-6 text-right text-[11px] text-white/60">{it.value}</span>
        </div>
      ))}
    </div>
  )
}

type SavedView = {
  id: string
  name: string
  kind: "table" | "kanban" | "calendar"
  statusFilter: string
  priorityFilter: string
  q: string
  sortField: string
  sortDir: "asc" | "desc"
  dueFilter?: string
}

type DbTemplate = {
  id: string
  name: string
  title: string
  status: string
  priority: "Low" | "Med" | "High"
  assignee: string
  due: string
  description: string
}

// Built-in starter templates for the gallery (stateless — always available).
const BUILT_IN_TEMPLATES: DbTemplate[] = [
  { id: "builtin-bug", name: "Bug report", title: "", status: "Todo", priority: "High", assignee: "", due: "", description: "Steps to reproduce:\n1. \n2. \n\nExpected:\n\nActual:" },
  { id: "builtin-sprint", name: "Sprint task", title: "", status: "Todo", priority: "Med", assignee: "", due: "", description: "Goal:\n\nAcceptance criteria:\n- " },
  { id: "builtin-action", name: "Meeting action", title: "", status: "Todo", priority: "Med", assignee: "", due: "", description: "Context:\n\nOwner:\n\nDeadline:" },
  { id: "builtin-spike", name: "Research spike", title: "", status: "Todo", priority: "Low", assignee: "", due: "", description: "Question:\n\nTimebox:\n\nFindings:\n" },
]

export default function WorkspaceDatabase({ docId, readOnly = false }: { docId: string; readOnly?: boolean }) {
  const docRef = useRef<Y.Doc | null>(null)
  const yRowsRef = useRef<Y.Array<Y.Map<unknown>> | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [view, setView] = useState<"table" | "kanban" | "calendar">("table")
  const [statusFilter, setStatusFilter] = useState<string>("All")
  const [priorityFilter, setPriorityFilter] = useState<string>("All")
  const [dueFilter, setDueFilter] = useState<string>("All")
  const [hideEmpty, setHideEmpty] = useState(false)
  const [q, setQ] = useState("")
  const [sortField, setSortField] = useState<string>("title")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [viewsLoaded, setViewsLoaded] = useState(false)
  const [savingView, setSavingView] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState("")
  const [ready, setReady] = useState(false)
  // Kanban depth: per-column WIP limits (persisted in pg props.dbWip) +
  // inline quick-add with the column's status (the old footer button always
  // created Todo rows, even inside Done).
  const [wip, setWip] = useState<Record<string, number>>({})
  const [quickStatus, setQuickStatus] = useState<string | null>(null)
  const [quickTitle, setQuickTitle] = useState("")
  // Board grouping: status (default kanban) | assignee (workload) | priority.
  // Session-only; saved views keep controlling filters/sort.
  const [groupBy, setGroupBy] = useState<"status" | "assignee" | "priority">("status")
  // Table assignee cell is display-first ("Geno (agent)"); click to edit.
  const [editingAssigneeId, setEditingAssigneeId] = useState<string | null>(null)
  const [assigneeDraft, setAssigneeDraft] = useState("")
  // Swimlanes (status board only): second dimension splitting columns into lanes.
  const [laneBy, setLaneBy] = useState<"none" | "assignee" | "priority">("none")
  const [quickLane, setQuickLane] = useState<string | null>(null)
  // CSV import (via REST so WIP limits + activity apply per row).
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement | null>(null)
  // Transient action notice (WIP blocks, import summary). Auto-clears.
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(t)
  }, [notice])
  const readOnlyRef = useRef(readOnly)
  useEffect(() => {
    readOnlyRef.current = readOnly
  }, [readOnly])
  // Load persisted saved views + row templates from pg props.
  const [templates, setTemplates] = useState<DbTemplate[]>([])
  const [showGallery, setShowGallery] = useState(false)
  // Custom fields (Fase 3b): definitions in pg props.dbFields, values in row cells.
  const [fields, setFields] = useState<FieldDef[]>([])
  const [showFields, setShowFields] = useState(false)
  const [newFieldName, setNewFieldName] = useState("")
  const [newFieldType, setNewFieldType] = useState<FieldDef["type"]>("text")
  const [newFieldOptions, setNewFieldOptions] = useState("")
  const [newFieldTarget, setNewFieldTarget] = useState("")
  const [newFieldRelation, setNewFieldRelation] = useState("")
  const [newFieldOp, setNewFieldOp] = useState<"count" | "donePct" | "sum">("count")
  const [newFieldNumber, setNewFieldNumber] = useState("")
  // Automations (Fase 4e): status-entry rules in pg props.dbAutomations.
  const [automations, setAutomations] = useState<AutomationRule[]>([])
  const [showAutomations, setShowAutomations] = useState(false)
  const [newRuleName, setNewRuleName] = useState("")
  const [newRuleWhen, setNewRuleWhen] = useState("Done")
  const [newRuleAssignee, setNewRuleAssignee] = useState("")
  const [newRuleComment, setNewRuleComment] = useState("")
  const [newRuleMoveTo, setNewRuleMoveTo] = useState("")
  // Target-doc rows for relation pickers (cached per doc; read-gated server-side).
  const [targetRows, setTargetRows] = useState<Record<string, Row[]>>({})
  const targetLoading = useRef<Set<string>>(new Set())

  const ensureTargetRows = (targetDocId: string | undefined) => {
    if (!targetDocId || targetRows[targetDocId] || targetLoading.current.has(targetDocId)) return
    targetLoading.current.add(targetDocId)
    fetch(`/api/workspace/${targetDocId}/database`, { headers: collabAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (Array.isArray(j?.rows)) setTargetRows((prev) => ({ ...prev, [targetDocId]: j.rows as Row[] }))
      })
      .catch(() => {})
      .finally(() => {
        targetLoading.current.delete(targetDocId)
      })
  }

  // Preload relation targets when fields (or doc) change so pickers show titles.
  useEffect(() => {
    for (const f of fields) {
      if (f.type === "relation" && f.targetDocId) ensureTargetRows(f.targetDocId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, fields])

  // Display rows: stored rows + locally computed rollups (same pure function
  // the server uses, over readable target caches). Ids stable, writes still
  // go through updateRow on stored state.
  const displayRows: Row[] = useMemo(() => {
    if (fields.every((f) => f.type !== "rollup")) return rows
    const computed = computeRollups(rows, fields, (id) => targetRows[id] ?? null)
    if (Object.keys(computed).length === 0) return rows
    // Nulls (unreadable links) are omitted — the cell renders as empty.
    return rows.map((r) => {
      const c = computed[r.id]
      if (!c) return r
      const cells: Row["cells"] = { ...r.cells }
      for (const [k, v] of Object.entries(c)) {
        if (v === null) delete cells[k]
        else cells[k] = v
      }
      return { ...r, cells }
    })
  }, [rows, fields, targetRows])

  // Drawer row resolves against display rows (local rollups included); all
  // edits address stored state by stable id via updateRow/updateCell.
  const selectedRow = selectedId ? displayRows.find((r) => r.id === selectedId) ?? null : null
  useEffect(() => {
    let alive = true
    fetch(`/api/workspace/${docId}/meta`, { headers: collabAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return
        const props = j.props as Record<string, unknown> | undefined
        const raw = props?.dbViews
        if (Array.isArray(raw)) {
          const cleaned = raw
            .filter((v): v is SavedView => !!v && typeof v === "object" && typeof (v as SavedView).id === "string" && typeof (v as SavedView).name === "string")
            .slice(0, 10) as SavedView[]
          setSavedViews(cleaned)
        }
        const rawTpl = props?.dbTemplates
        if (Array.isArray(rawTpl)) {
          const cleanedTpl = rawTpl
            .filter((t): t is DbTemplate => !!t && typeof t === "object" && typeof (t as DbTemplate).id === "string" && typeof (t as DbTemplate).name === "string")
            .slice(0, 10) as DbTemplate[]
          setTemplates(cleanedTpl)
        }
        const rawWip = props?.dbWip
        if (rawWip && typeof rawWip === "object" && !Array.isArray(rawWip)) {
          const cleanedWip: Record<string, number> = {}
          for (const [k, v] of Object.entries(rawWip as Record<string, unknown>).slice(0, 10)) {
            const n = typeof v === "number" ? Math.floor(v) : parseInt(String(v ?? ""), 10)
            if (k && Number.isFinite(n) && n >= 1 && n <= 50) cleanedWip[k.slice(0, 16)] = n
          }
          setWip(cleanedWip)
        }
        const rawFields = props?.dbFields
        if (Array.isArray(rawFields)) {
          const cleanedFields = rawFields
            .filter(
              (f): f is FieldDef =>
                !!f &&
                typeof f === "object" &&
                typeof (f as FieldDef).id === "string" &&
                typeof (f as FieldDef).name === "string",
            )
            .slice(0, 20)
          setFields(cleanedFields)
        }
        setAutomations(parseAutomationRules(props?.dbAutomations))
        setViewsLoaded(true)
      })
      .catch(() => { if (alive) setViewsLoaded(true) })
    return () => { alive = false }
  }, [docId])

  const persistFields = async (next: FieldDef[]) => {
    setFields(next)
    try {
      await fetch(`/api/workspace/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...collabAuthHeaders() },
        body: JSON.stringify({ props: { dbFields: next } }),
      })
    } catch {}
  }

  const persistAutomations = async (next: AutomationRule[]) => {
    setAutomations(next)
    try {
      await fetch(`/api/workspace/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...collabAuthHeaders() },
        body: JSON.stringify({ props: { dbAutomations: next } }),
      })
    } catch {}
  }

  const addAutomation = () => {
    if (readOnlyRef.current || automations.length >= 20) return
    const name = newRuleName.trim().slice(0, 40)
    if (!name || !["Todo", "Doing", "Done"].includes(newRuleWhen)) return
    const rule: AutomationRule = { id: `auto-${uid()}`, name, whenStatus: newRuleWhen }
    const assignee = newRuleAssignee.trim().slice(0, 100)
    if (assignee) rule.setAssignee = assignee
    const comment = newRuleComment.trim().slice(0, 500)
    if (comment) rule.addComment = comment
    if (newRuleMoveTo && ["Todo", "Doing", "Done"].includes(newRuleMoveTo) && newRuleMoveTo !== newRuleWhen) {
      rule.moveTo = newRuleMoveTo
    }
    if (rule.setAssignee === undefined && rule.addComment === undefined && rule.moveTo === undefined) return
    void persistAutomations([...automations, rule])
    setNewRuleName("")
    setNewRuleAssignee("")
    setNewRuleComment("")
    setNewRuleMoveTo("")
  }

  const removeAutomation = (ruleId: string) => {
    if (readOnlyRef.current) return
    void persistAutomations(automations.filter((r) => r.id !== ruleId))
  }

  const addField = () => {
    if (readOnlyRef.current || fields.length >= 20) return
    const name = newFieldName.trim().slice(0, 24)
    if (!name) return
    const options =
      newFieldType === "select" || newFieldType === "multi"
        ? newFieldOptions.split(",").map((o) => o.trim().slice(0, 24)).filter(Boolean).filter((o, i, a) => a.indexOf(o) === i).slice(0, 20)
        : []
    const def: FieldDef = { id: `f-${uid()}`, name, type: newFieldType, options }
    if (newFieldType === "relation") {
      const target = newFieldTarget.trim().replace(/^workspace:(room:|db:)?/, "").slice(0, 64)
      if (!target) return
      def.targetDocId = target
    }
    if (newFieldType === "rollup") {
      const rel = fields.find((f) => f.id === newFieldRelation && f.type === "relation")
      if (!rel || (newFieldOp !== "count" && newFieldOp !== "donePct" && newFieldOp !== "sum")) return
      def.relationFieldId = rel.id
      def.rollupOp = newFieldOp
      if (newFieldOp === "sum") {
        const numField = newFieldNumber.trim().slice(0, 16)
        if (!numField) return
        def.rollupFieldId = numField
      }
    }
    void persistFields([...fields, def])
    setNewFieldName("")
    setNewFieldOptions("")
    setNewFieldTarget("")
    setNewFieldRelation("")
    setNewFieldNumber("")
  }

  const removeField = (fieldId: string) => {
    if (readOnlyRef.current) return
    void persistFields(fields.filter((f) => f.id !== fieldId))
  }

  const updateCell = (rowId: string, fieldId: string, value: CellValue | undefined) => {
    if (readOnlyRef.current) return
    const row = rows.find((r) => r.id === rowId)
    if (!row) return
    const cells = { ...row.cells }
    if (value === undefined) delete cells[fieldId]
    else cells[fieldId] = value
    updateRow(rowId, { cells })
  }

  const persistTemplates = async (next: DbTemplate[]) => {
    setTemplates(next)
    try {
      await fetch(`/api/workspace/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...collabAuthHeaders() },
        body: JSON.stringify({ props: { dbTemplates: next } }),
      })
    } catch {}
  }

  const useTemplate = (tpl: DbTemplate) => {
    if (readOnlyRef.current) return
    const yRows = yRowsRef.current
    const doc = docRef.current
    if (!yRows || !doc) return
    const r: Row = { id: uid(), title: tpl.title, status: tpl.status, priority: tpl.priority, assignee: tpl.assignee, due: tpl.due, description: tpl.description, comments: [], cells: {} }
    doc.transact(() => yRows.push([yMapFromRow(r)]), "user")
  }

  const persistViews = async (next: SavedView[]) => {
    setSavedViews(next)
    try {
      await fetch(`/api/workspace/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...collabAuthHeaders() },
        body: JSON.stringify({ props: { dbViews: next } }),
      })
    } catch {}
  }

  const persistWip = async (next: Record<string, number>) => {
    setWip(next)
    try {
      await fetch(`/api/workspace/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...collabAuthHeaders() },
        body: JSON.stringify({ props: { dbWip: next } }),
      })
    } catch {}
  }

  const editWipLimit = (status: string) => {
    if (readOnlyRef.current) return
    const cur = wip[status]
    const ans = window.prompt(`WIP limit for ${status} (1–50, empty = none)`, cur ? String(cur) : "")
    if (ans === null) return
    const next = { ...wip }
    if (!ans.trim()) {
      delete next[status]
    } else {
      const n = parseInt(ans.trim(), 10)
      if (!Number.isFinite(n) || n < 1 || n > 50) return
      next[status] = n
    }
    void persistWip(next)
  }

  const applyView = (v: SavedView) => {
    setActiveViewId(v.id)
    setView(v.kind)
    setStatusFilter(v.statusFilter)
    setPriorityFilter(v.priorityFilter)
    setQ(v.q)
    setSortField(v.sortField)
    setSortDir(v.sortDir)
    setDueFilter(typeof v.dueFilter === "string" && (DUE_FILTERS as string[]).includes(v.dueFilter) ? v.dueFilter : "All")
  }

  const saveCurrentAsView = async () => {
    if (savingView || readOnly) return
    const name = window.prompt("View name", `View ${savedViews.length + 1}`)
    if (!name || !name.trim()) return
    setSavingView(true)
    const next: SavedView = {
      id: `view-${Date.now().toString(36)}`,
      name: name.trim().slice(0, 24),
      kind: view,
      statusFilter,
      priorityFilter,
      q: q.slice(0, 64),
      sortField,
      sortDir,
      dueFilter,
    }
    await persistViews([...savedViews, next])
    setActiveViewId(next.id)
    setSavingView(false)
  }

  const deleteView = async (id: string) => {
    if (readOnly) return
    const next = savedViews.filter((v) => v.id !== id)
    await persistViews(next)
    if (activeViewId === id) setActiveViewId(null)
  }

  // v2: POC-era cached updates were stale demo text; server is source of truth
  const storageKey = `workspace:db:v2:${docId}`
  const agentOrigin = () => (typeof window !== "undefined" ? (localStorage.getItem("workspace:agentType") || "user") : "user")

  useEffect(() => {
    const doc = new Y.Doc()
    const yRows = doc.getArray<Y.Map<unknown>>("database")
    docRef.current = doc
    yRowsRef.current = yRows
    let alive = true
    let putTimer: ReturnType<typeof setTimeout> | null = null
    // Same storm discipline as the page editor: incremental diffs off the
    // last ACKed state vector (server merges), at most one timer + one
    // in-flight PUT, trailing flush for mid-flight edits.
    let putInFlight = false
    let putDirty = false
    let lastSV: Uint8Array | null = null
    let putCount = 0

    const saved = localStorage.getItem(storageKey)
    if (saved) {
      try {
        Y.applyUpdate(doc, Uint8Array.from(JSON.parse(saved) as number[]))
      } catch {}
    }

    const runPut = () => {
      putTimer = null
      if (!alive || putInFlight) return
      putCount++
      const wantFull = !lastSV || putCount % 25 === 0
      let body: Uint8Array
      try {
        body = wantFull ? Y.encodeStateAsUpdate(doc) : Y.encodeStateAsUpdate(doc, lastSV!)
      } catch {
        return
      }
      if (!wantFull && body.byteLength <= 32) return
      putInFlight = true
      putDirty = false
      fetch(`/api/workspace/${docId}/doc`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", ...collabAuthHeaders() }, body: body as unknown as BodyInit })
        .then((r) => {
          if (!alive) return
          if (r.ok) {
            try {
              lastSV = Y.encodeStateVector(doc)
            } catch {}
          } else if (r.status === 400) {
            lastSV = null
          }
        })
        .catch(() => {})
        .finally(() => {
          putInFlight = false
          if (alive && putDirty) schedulePut()
        })
    }

    const schedulePut = () => {
      if (readOnlyRef.current) return
      putDirty = true
      if (putTimer || putInFlight) return
      putTimer = setTimeout(runPut, 2000)
    }

    const obs = () => {
      if (!alive) return
      setRows(toRows(yRows))
      try {
        const upd = Y.encodeStateAsUpdate(doc)
        localStorage.setItem(storageKey, JSON.stringify(Array.from(upd)))
      } catch {}
      schedulePut()
    }
    // Deep observation: card moves / drawer edits / comments all mutate
    // NESTED row maps (m.set), which a shallow array observe never fires
    // for — the board then neither re-renders nor schedules its persist
    // PUT (the "drop doesn't move the card" bug). Every Yjs mutation must
    // flow to the UI.
    yRows.observeDeep(obs)

    // databases start empty — never seed demo rows; server is the source of truth
    fetch(`/api/workspace/${docId}/doc`, { headers: collabAuthHeaders() })
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => {
        if (!alive) return
        if (buf && buf.byteLength > 0) Y.applyUpdate(doc, new Uint8Array(buf))
        setRows(toRows(yRows))
        setReady(true)
      })
      .catch(() => {
        if (!alive) return
        setRows(toRows(yRows))
        setReady(true)
      })

    const wsUrl = collabWsUrl()
    let provider: WebsocketProvider | null = null
    try {
      provider = new WebsocketProvider(wsUrl, `workspace:db:${docId}`, doc, { connect: true, params: collabWsParams() })
      const agentType = typeof window !== "undefined" ? (localStorage.getItem("workspace:agentType") || "user") : "user"
      const userId = typeof window !== "undefined" ? (localStorage.getItem("workspace:userId") || "anon") : "anon"
      const color = agentType === "user" ? "#7c3aed" : agentType.includes("leads") ? "#f59e0b" : "#10b981"
      const name = agentType === "user" ? "You" : agentType.replace(/_/g, " ")
      provider.awareness.setLocalStateField("user", { name, color, agentType, userId })
    } catch {}

    return () => {
      alive = false
      if (putTimer) clearTimeout(putTimer)
      yRows.unobserveDeep(obs)
      provider?.destroy()
      doc.destroy()
    }
  }, [docId, storageKey])

  const guard = () => !readOnlyRef.current

  const addRow = () => {
    if (!guard()) return
    const yRows = yRowsRef.current
    const doc = docRef.current
    if (!yRows || !doc) return
    const r: Row = { id: uid(), title: "", status: "Todo", priority: "Med", assignee: "", due: "", description: "", comments: [], cells: {} }
    doc.transact(() => yRows.push([yMapFromRow(r)]), agentOrigin())
  }

  const quickAddRow = () => {
    if (!guard() || !quickStatus) return
    const title = quickTitle.trim().slice(0, 100)
    if (!title) return
    const yRows = yRowsRef.current
    const doc = docRef.current
    if (!yRows || !doc) return
    const extra: Partial<Row> =
      groupBy === "status"
        ? {
            status: quickStatus,
            // Swimlane carry-over: new cards inherit the lane they were added in.
            ...(laneBy === "assignee" && quickLane !== null ? { assignee: quickLane } : {}),
            ...(laneBy === "priority" && quickLane !== null ? { priority: quickLane as Row["priority"] } : {}),
          }
        : groupBy === "assignee"
          ? { status: "Todo", assignee: quickStatus }
          : { status: "Todo", priority: quickStatus as Row["priority"] }
    const r: Row = { id: uid(), title, status: "Todo", priority: "Med", assignee: "", due: "", description: "", comments: [], cells: {}, ...extra }
    doc.transact(() => yRows.push([yMapFromRow(r)]), agentOrigin())
    setQuickTitle("")
    setQuickStatus(null)
    setQuickLane(null)
  }

  // Swimlane partition for the status board (assignee lanes incl. Unassigned).
  const swimlanes = (): Array<{ key: string; label: string }> => {
    if (laneBy === "assignee") {
      const names = Array.from(new Set(filtered.map((r) => r.assignee.trim()).filter(Boolean))).sort().slice(0, 8)
      return [...names.map((n) => ({ key: n, label: assigneeLabel(n) })), { key: "", label: "Unassigned" }]
    }
    if (laneBy === "priority") return [...PRIORITIES].reverse().map((p) => ({ key: p, label: `${p} priority` }))
    return [{ key: "", label: "" }]
  }

  const laneOf = (r: Row): string => {
    if (laneBy === "assignee") return r.assignee.trim()
    if (laneBy === "priority") return r.priority
    return ""
  }

  const groupKeyOf = (r: Row): string => {
    if (groupBy === "assignee") return r.assignee.trim()
    if (groupBy === "priority") return r.priority
    return r.status
  }

  const boardColumns = (): Array<{ key: string; label: string }> => {
    if (groupBy === "assignee") {
      const names = Array.from(new Set(rows.map((r) => r.assignee.trim()).filter(Boolean))).sort().slice(0, 8)
      return [...names.map((n) => ({ key: n, label: assigneeLabel(n) })), { key: "", label: "Unassigned" }]
    }
    if (groupBy === "priority") return [...PRIORITIES].reverse().map((p) => ({ key: p, label: `${p} priority` }))
    return STATUSES.map((s) => ({ key: s, label: s }))
  }

  const dropPatch = (key: string): Partial<Row> => {
    if (groupBy === "assignee") return { assignee: key }
    if (groupBy === "priority") return { priority: key as Row["priority"] }
    return { status: key }
  }

  const deleteRow = (id: string) => {
    if (!guard()) return
    const yRows = yRowsRef.current
    const doc = docRef.current
    if (!yRows || !doc) return
    const idx = toRows(yRows).findIndex((x) => x.id === id)
    if (idx < 0) return
    doc.transact(() => yRows.delete(idx, 1), agentOrigin())
  }

  const updateRow = (id: string, patch: Partial<Row>) => {
    if (!guard()) return
    const yRows = yRowsRef.current
    const doc = docRef.current
    if (!yRows || !doc) return
    const idx = toRows(yRows).findIndex((x) => x.id === id)
    if (idx < 0) return
    const m = yRows.get(idx) as Y.Map<unknown>
    doc.transact(() => {
      for (const [k, v] of Object.entries(patch)) m.set(k, v)
    }, agentOrigin())
  }

  const onDropKanban = (e: React.DragEvent, key: string) => {
    const id = e.dataTransfer.getData("text/plain")
    if (!id) return
    // WIP pre-check (mirrors the server 409 gate): block the drop locally
    // with a notice instead of writing a move the server would reject.
    if (groupBy === "status") {
      const limit = wip[key]
      if (limit !== undefined) {
        const count = rows.filter((r) => r.status === key && r.id !== id).length
        if (count + 1 > limit) {
          setNotice(`WIP limit reached for ${key} (${limit}) — finish something first.`)
          return
        }
      }
    }
    updateRow(id, dropPatch(key))
  }

  // Calendar drag: drop a card on a day to (re)schedule it. Same Yjs path
  // as the date input — no server round-trip needed for the move itself.
  const onDropDay = (e: React.DragEvent, iso: string) => {
    e.preventDefault()
    const id = e.dataTransfer.getData("text/plain")
    if (!id || !guard()) return
    const row = rows.find((r) => r.id === id)
    if (!row || row.due === iso) return
    updateRow(id, { due: iso })
  }

  const onDropUndated = (e: React.DragEvent) => {
    e.preventDefault()
    const id = e.dataTransfer.getData("text/plain")
    if (!id || !guard()) return
    const row = rows.find((r) => r.id === id)
    if (!row || !row.due) return
    updateRow(id, { due: "" })
  }

  const addComment = () => {
    if (!selectedRow || !commentDraft.trim() || readOnlyRef.current) return
    const author = (typeof window !== "undefined" ? localStorage.getItem("workspace:userId") || localStorage.getItem("workspace:agentType") || "You" : "You") as string
    const next = [...selectedRow.comments, { id: `c-${Date.now().toString(36)}`, text: commentDraft.trim().slice(0, 500), author, at: new Date().toISOString() }]
    updateRow(selectedRow.id, { comments: next } as unknown as Partial<Row>)
    setCommentDraft("")
  }

  /** Minimal CSV parser (quotes + embedded commas/newlines). Returns rows of cells. */
  const parseCsv = (text: string): string[][] => {
    const rows: string[][] = []
    let cur: string[] = []
    let cell = ""
    let quoted = false
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"'
            i++
          } else {
            quoted = false
          }
        } else {
          cell += ch
        }
      } else if (ch === '"') {
        quoted = true
      } else if (ch === ",") {
        cur.push(cell)
        cell = ""
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++
        cur.push(cell)
        cell = ""
        if (cur.length > 1 || cur[0].trim() !== "") rows.push(cur)
        cur = []
      } else {
        cell += ch
      }
    }
    cur.push(cell)
    if (cur.length > 1 || cur[0].trim() !== "") rows.push(cur)
    return rows
  }

  const importCsv = async (file: File) => {
    if (importing || readOnlyRef.current) return
    setImporting(true)
    setNotice(null)
    try {
      const text = await file.text()
      const parsed = parseCsv(text).slice(0, 201)
      if (parsed.length === 0) {
        setNotice("CSV is empty.")
        return
      }
      const KNOWN = new Set(["title", "status", "priority", "assignee", "due", "description"])
      const first = parsed[0].map((c) => c.trim().toLowerCase())
      const hasHeader = first.includes("title")
      const idx: Record<string, number> = {}
      if (hasHeader) {
        first.forEach((h, i) => {
          if (KNOWN.has(h) && idx[h] === undefined) idx[h] = i
        })
      } else {
        ;["title", "status", "priority", "assignee", "due", "description"].forEach((h, i) => {
          idx[h] = i
        })
      }
      const body = hasHeader ? parsed.slice(1) : parsed
      let ok = 0
      let skipped = 0
      for (const cells of body.slice(0, 200)) {
        const at = (k: string) => (idx[k] !== undefined ? (cells[idx[k]] ?? "").trim() : "")
        const title = at("title")
        if (!title && !at("description")) {
          skipped++
          continue
        }
        try {
          const r = await fetch(`/api/workspace/${docId}/database`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...collabAuthHeaders() },
            body: JSON.stringify({
              title: title.slice(0, 200) || "Untitled",
              status: at("status") || "Todo",
              priority: ["Low", "Med", "High"].includes(at("priority")) ? at("priority") : "Med",
              assignee: at("assignee").slice(0, 100),
              due: at("due").slice(0, 20),
              description: at("description").slice(0, 4000),
            }),
          })
          if (r.ok) ok++
          else skipped++
        } catch {
          skipped++
        }
      }
      setNotice(`Imported ${ok} task${ok === 1 ? "" : "s"}${skipped ? ` · ${skipped} skipped` : ""}.`)
    } catch {
      setNotice("Could not read that CSV file.")
    }
    setImporting(false)
  }

  const baseFiltered = displayRows.filter((r) => {
    const statusOk = statusFilter === "All" || r.status === statusFilter
    const prioOk = priorityFilter === "All" || r.priority === priorityFilter
    const needle = q.trim().toLowerCase()
    const searchOk = !needle || r.title.toLowerCase().includes(needle) || r.assignee.toLowerCase().includes(needle) || r.id.toLowerCase().includes(needle)
    const dueOk = dueFilter === "All" || matchesDueFilter(r.due, r.status, dueFilter, new Date().toISOString().slice(0, 10))
    return statusOk && prioOk && searchOk && dueOk
  })

  const priorityRank: Record<string, number> = { High: 3, Med: 2, Low: 1 }
  const statusRank: Record<string, number> = { Todo: 0, Doing: 1, Done: 2 }
  const filtered = [...baseFiltered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1
    if (sortField === "priority") return (priorityRank[a.priority] - priorityRank[b.priority]) * dir
    if (sortField === "status") return (statusRank[a.status] - statusRank[b.status]) * dir
    if (sortField === "due") return ((a.due || "") < (b.due || "") ? -1 : (a.due || "") > (b.due || "") ? 1 : 0) * dir
    if (sortField === "assignee") return a.assignee.localeCompare(b.assignee) * dir
    // title default
    return a.title.localeCompare(b.title) * dir
  })

  // Calendar helpers (current month)
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDow = new Date(year, month, 1).getDay()
  const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric" })
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  return (
    <div className="mx-auto w-full max-w-[900px]">
      {/* Assignee picker suggestions: invited Cerveau agents + free text */}
      <datalist id={`workspace-assignees-${docId}`}>
        {AGENT_ASSIGNEES.map((a) => (
          <option key={a.value} value={a.value}>{`${a.label} (agent)`}</option>
        ))}
      </datalist>
      {/* Saved views tabs — AppFlowy-style: “All” + user saved views (persisted in pg props.dbViews) */}
      {viewsLoaded && (
        <div className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => { setActiveViewId(null); setView("table"); setStatusFilter("All"); setPriorityFilter("All"); setDueFilter("All"); setQ(""); setSortField("title"); setSortDir("asc") }}
            className={`shrink-0 rounded-full border px-3 py-1 text-[12px] ${activeViewId === null ? "border-white bg-white text-black" : "border-line bg-white/[0.04] text-white/50 hover:text-white/80"}`}
          >
            All
          </button>
          {savedViews.map((v) => (
            <span key={v.id} className={`group inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-[12px] ${activeViewId === v.id ? "border-white bg-white text-black" : "border-line bg-white/[0.04] text-white/50 hover:text-white/80"}`}>
              <button onClick={() => applyView(v)} className="max-w-[120px] truncate text-left">
                {v.name}
              </button>
              {!readOnly && (
                <button onClick={() => deleteView(v.id)} title="Delete view" className="rounded-full p-0.5 opacity-40 hover:bg-black/10 group-hover:opacity-80">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
          {!readOnly && (
            <button
              onClick={saveCurrentAsView}
              disabled={savingView || savedViews.length >= 10}
              title={savedViews.length >= 10 ? "Max 10 views" : "Save current filters as a view"}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-white/15 bg-transparent px-3 py-1 text-[12px] text-white/40 hover:text-white/70 disabled:opacity-30"
            >
              <BookmarkPlus className="h-3 w-3" /> Save view
            </button>
          )}
        </div>
      )}

      {/* Insights — lightweight SVG charts (no extra deps): donut by status + bars by priority */}
      {notice && (
        <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-[12px] text-amber-200">
          {notice}
        </div>
      )}
      {rows.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-white/[0.025] p-4">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/30">By status</div>
            <DonutByStatus rows={rows} />
          </div>
          <div className="rounded-2xl border border-line bg-white/[0.025] p-4">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/30">By priority</div>
            <BarsByPriority rows={rows} />
            <div className="mt-3 text-[11px] text-white/25">{rows.filter((r) => !r.due).length} without due date · {rows.filter((r) => r.due && new Date(r.due) < new Date(new Date().toISOString().slice(0,10))).length} overdue</div>
          </div>
        </div>
      )}

      {/* Header — database title + view switcher */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-full bg-white/[0.04] p-1">
              <button
                onClick={() => { setView("table"); setActiveViewId(null) }}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${view === "table" ? "bg-white text-black shadow-sm" : "text-white/50 hover:text-white/80"}`}
              >
                <Table className="h-3.5 w-3.5" />
                Table
              </button>
              <button
                onClick={() => { setView("kanban"); setActiveViewId(null) }}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${view === "kanban" ? "bg-white text-black shadow-sm" : "text-white/50 hover:text-white/80"}`}
              >
                <Kanban className="h-3.5 w-3.5" />
                Board
              </button>
              <button
                onClick={() => { setView("calendar"); setActiveViewId(null) }}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${view === "calendar" ? "bg-white text-black shadow-sm" : "text-white/50 hover:text-white/80"}`}
              >
                <Calendar className="h-3.5 w-3.5" />
                Calendar
              </button>
            </div>
            <span className="text-[12px] text-white/25">{filtered.length}/{rows.length}</span>
            {!ready && <span className="text-[11px] text-white/25">Loading…</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 rounded-full border border-line bg-white/[0.04] px-3 py-1.5">
              <Search className="h-3.5 w-3.5 text-white/30" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-[110px] bg-transparent text-[12px] text-white/70 placeholder:text-white/25 outline-none" />
            </label>
            <div className="flex items-center gap-1 rounded-full bg-white/[0.04] p-1">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent px-2 py-1 text-[12px] text-white/60 outline-none"
              >
                <option value="All">All status</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span className="text-white/10">|</span>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="bg-transparent px-2 py-1 text-[12px] text-white/60 outline-none"
              >
                <option value="All">All priority</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <span className="text-white/10">|</span>
              <select
                value={dueFilter}
                onChange={(e) => setDueFilter(e.target.value)}
                title="Filter by due date"
                className="bg-transparent px-2 py-1 text-[12px] text-white/60 outline-none"
              >
                {DUE_FILTERS.map((d) => (
                  <option key={d} value={d}>{d === "All" ? "All dates" : d}</option>
                ))}
              </select>
              <span className="text-white/10">|</span>
              <select value={sortField} onChange={(e) => setSortField(e.target.value)} className="bg-transparent px-2 py-1 text-[12px] text-white/60 outline-none">
                <option value="title">Title</option>
                <option value="status">Status</option>
                <option value="priority">Priority</option>
                <option value="due">Due</option>
                <option value="assignee">Assignee</option>
              </select>
              <button onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")} title={sortDir === "asc" ? "Ascending" : "Descending"} className="rounded-full bg-white/[0.06] p-1 text-white/50 hover:text-white/80">
                <ArrowUpNarrowWide className={`h-3.5 w-3.5 transition ${sortDir === "desc" ? "rotate-180" : ""}`} />
              </button>
            </div>
            {!readOnly && templates.length > 0 && (
              <select
                onChange={(e) => {
                  const tpl = templates.find((t) => t.id === e.target.value)
                  if (tpl) useTemplate(tpl)
                  e.target.selectedIndex = 0
                }}
                defaultValue=""
                className="rounded-full border border-line bg-white/[0.04] px-3 py-2 text-[12px] text-white/60 outline-none"
                title="Use template"
              >
                <option value="">Template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
            {!readOnly && (
              <button
                onClick={() => setShowGallery(true)}
                title="Browse task templates"
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.04] px-4 py-2 text-[12.5px] font-medium text-white/70 hover:bg-white/[0.08] hover:text-white"
              >
                <LayoutTemplate className="h-3.5 w-3.5" />
                Gallery
              </button>
            )}
            {!readOnly && (
              <>
                <button
                  onClick={() => setShowFields((v) => !v)}
                  title="Manage custom fields"
                  className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-[12.5px] font-medium ${showFields ? "border-white bg-white text-black" : "border-line bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"}`}
                >
                  Fields{fields.length ? ` · ${fields.length}` : ""}
                </button>
                <button
                  onClick={() => setShowAutomations((v) => !v)}
                  title="Automate: when a card enters a status, assign, comment, or move it"
                  className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-[12.5px] font-medium ${showAutomations ? "border-white bg-white text-black" : "border-line bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"}`}
                >
                  <Zap className="h-3.5 w-3.5" />
                  Automate{automations.length ? ` · ${automations.length}` : ""}
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void importCsv(f)
                    e.target.value = ""
                  }}
                />
                <button
                  onClick={() => importRef.current?.click()}
                  disabled={importing}
                  title="Import tasks from CSV (title,status,priority,assignee,due,description)"
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.04] px-4 py-2 text-[12.5px] font-medium text-white/70 hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {importing ? "Importing…" : "Import"}
                </button>
                <button
                  onClick={addRow}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[12.5px] font-medium text-black shadow-sm transition hover:bg-white/90"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {showFields && !readOnly && (
        <div className="mb-4 rounded-2xl border border-line bg-white/[0.025] p-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/30">
            Custom fields · {fields.length}/20
          </div>
          {fields.length > 0 && (
            <div className="mb-3 flex flex-col gap-1.5">
              {fields.map((f) => (
                <div key={f.id} className="group flex items-center justify-between gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2">
                  <span className="min-w-0 truncate text-[12px] text-white/70">
                    {f.name}{" "}
                    <span className="text-white/25">
                      · {f.type}
                      {f.type === "relation" && f.targetDocId ? ` → ${f.targetDocId}` : ""}
                      {f.type === "rollup" && f.relationFieldId ? ` · ${f.rollupOp}` : ""}
                      {f.options.length ? ` · ${f.options.join(", ")}` : ""}
                    </span>
                  </span>
                  <button onClick={() => removeField(f.id)} title="Delete field (values stay on rows but hide)" className="shrink-0 rounded px-1.5 py-0.5 text-[12px] text-white/20 opacity-0 hover:text-red-300 group-hover:opacity-100">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addField() }}
              placeholder="Field name"
              className="w-[160px] rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/80 placeholder:text-white/30 outline-none"
            />
            <select value={newFieldType} onChange={(e) => setNewFieldType(e.target.value as FieldDef["type"])} className="rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/70 outline-none">
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="select">Select</option>
              <option value="multi">Multi-select</option>
              <option value="checkbox">Checkbox</option>
              <option value="date">Date</option>
              <option value="url">URL</option>
              <option value="relation">Relation</option>
              <option value="rollup">Rollup</option>
            </select>
            {(newFieldType === "select" || newFieldType === "multi") && (
              <input
                value={newFieldOptions}
                onChange={(e) => setNewFieldOptions(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addField() }}
                placeholder="Options, comma separated"
                className="w-[220px] rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/80 placeholder:text-white/30 outline-none"
              />
            )}
            {newFieldType === "relation" && (
              <input
                value={newFieldTarget}
                onChange={(e) => setNewFieldTarget(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addField() }}
                placeholder="Target doc id"
                className="w-[180px] rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/80 placeholder:text-white/30 outline-none"
              />
            )}
            {newFieldType === "rollup" && (
              <>
                <select
                  value={newFieldRelation}
                  onChange={(e) => setNewFieldRelation(e.target.value)}
                  className="rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/70 outline-none"
                  title="Relation to aggregate"
                >
                  <option value="">Relation…</option>
                  {fields
                    .filter((f) => f.type === "relation")
                    .map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                </select>
                <select
                  value={newFieldOp}
                  onChange={(e) => setNewFieldOp(e.target.value as "count" | "donePct" | "sum")}
                  className="rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/70 outline-none"
                  title="Aggregation"
                >
                  <option value="count">Count</option>
                  <option value="donePct">% Done</option>
                  <option value="sum">Sum</option>
                </select>
                {newFieldOp === "sum" && (
                  <input
                    value={newFieldNumber}
                    onChange={(e) => setNewFieldNumber(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addField() }}
                    placeholder="Number field id in target"
                    className="w-[180px] rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/80 placeholder:text-white/30 outline-none"
                  />
                )}
              </>
            )}
            <button onClick={addField} disabled={!newFieldName.trim() || fields.length >= 20} className="rounded-full bg-white px-4 py-1.5 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-40">
              Add field
            </button>
          </div>
        </div>
      )}

      {showAutomations && !readOnly && (
        <div className="mb-4 rounded-2xl border border-line bg-white/[0.025] p-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/30">
            Automations · {automations.length}/20
          </div>
          <div className="mb-3 text-[12px] leading-relaxed text-white/35">
            When a card enters a status, assign it, comment, or move it on. Chained moves never re-trigger.
          </div>
          {automations.length > 0 && (
            <div className="mb-3 flex flex-col gap-1.5">
              {automations.map((r) => (
                <div key={r.id} className="group flex items-center justify-between gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2">
                  <span className="min-w-0 truncate text-[12px] text-white/70">
                    {r.name}{" "}
                    <span className="text-white/25">
                      · on {r.whenStatus}
                      {r.setAssignee ? ` → ${r.setAssignee}` : ""}
                      {r.addComment ? " + comment" : ""}
                      {r.moveTo ? ` → ${r.moveTo}` : ""}
                    </span>
                  </span>
                  <button onClick={() => removeAutomation(r.id)} title="Delete automation" className="shrink-0 rounded px-1.5 py-0.5 text-[12px] text-white/20 opacity-0 hover:text-red-300 group-hover:opacity-100">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newRuleName}
              onChange={(e) => setNewRuleName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addAutomation() }}
              placeholder="Rule name"
              className="w-[160px] rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/80 placeholder:text-white/30 outline-none"
            />
            <span className="text-[12px] text-white/30">when entering</span>
            <select value={newRuleWhen} onChange={(e) => setNewRuleWhen(e.target.value)} className="rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/70 outline-none">
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <input
              value={newRuleAssignee}
              onChange={(e) => setNewRuleAssignee(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addAutomation() }}
              placeholder="Assign to (optional)"
              list={`workspace-assignees-${docId}`}
              className="w-[160px] rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/80 placeholder:text-white/30 outline-none"
            />
            <input
              value={newRuleComment}
              onChange={(e) => setNewRuleComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addAutomation() }}
              placeholder="Comment (optional)"
              className="w-[200px] rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/80 placeholder:text-white/30 outline-none"
            />
            <select
              value={newRuleMoveTo}
              onChange={(e) => setNewRuleMoveTo(e.target.value)}
              title="Move to (optional)"
              className="rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/70 outline-none"
            >
              <option value="">No move</option>
              {STATUSES.filter((s) => s !== newRuleWhen).map((s) => (
                <option key={s} value={s}>Move to {s}</option>
              ))}
            </select>
            <button onClick={addAutomation} disabled={!newRuleName.trim() || automations.length >= 20} className="rounded-full bg-white px-4 py-1.5 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-40">
              Add rule
            </button>
          </div>
        </div>
      )}

      {ready && rows.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-white/10 py-14 text-center">
          <div className="text-[13px] text-white/40">{readOnly ? "No rows yet." : "No rows yet — add the first one."}</div>
          {!readOnly && (
            <button
              onClick={addRow}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-[12.5px] font-medium text-black hover:bg-white/90"
            >
              <Plus className="h-3.5 w-3.5" />
              Add row
            </button>
          )}
        </div>
      ) : view === "table" ? (
        <div className="overflow-hidden rounded-[14px] border border-line bg-surface-1">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line bg-white/[0.02]">
                  <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-white/30">Title</th>
                  <th className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-widest text-white/30">Status</th>
                  <th className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-widest text-white/30">Priority</th>
                  <th className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-widest text-white/30">Assignee</th>
                  <th className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-widest text-white/30">Due</th>
                  {fields.map((f) => (
                    <th key={f.id} className="max-w-[180px] truncate px-3 py-2.5 text-[11px] font-medium uppercase tracking-widest text-white/30" title={`${f.name} · ${f.type}`}>{f.name}</th>
                  ))}
                  <th className="px-2 py-2.5 text-[11px] font-medium uppercase tracking-widest text-white/30"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((r) => (
                  <tr key={r.id} className="group hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-3.5 w-3.5 shrink-0 text-white/15 opacity-0 group-hover:opacity-100" />
                        <input
                          value={r.title}
                          disabled={readOnly}
                          onChange={(e) => updateRow(r.id, { title: e.target.value })}
                          placeholder="Untitled"
                          className="w-full bg-transparent text-[13.5px] text-white/85 placeholder:text-white/25 outline-none disabled:opacity-80"
                        />
                        {!readOnly && (
                          <button
                            onClick={() => deleteRow(r.id)}
                            title="Delete row"
                            className="shrink-0 rounded px-1.5 py-0.5 text-white/20 opacity-0 hover:bg-white/[0.06] hover:text-white/60 group-hover:opacity-100"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={r.status}
                        disabled={readOnly}
                        onChange={(e) => updateRow(r.id, { status: e.target.value })}
                        className="rounded-full border bg-surface-2 px-2.5 py-1 text-[12px] text-white/70 outline-none disabled:opacity-60"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <PriorityPill p={r.priority} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <User className="h-3 w-3 shrink-0 text-white/25" />
                        {editingAssigneeId === r.id ? (
                          <input
                            autoFocus
                            value={assigneeDraft}
                            list={`workspace-assignees-${docId}`}
                            disabled={readOnly}
                            onChange={(e) => setAssigneeDraft(e.target.value)}
                            onBlur={() => {
                              updateRow(r.id, { assignee: assigneeDraft.trim().slice(0, 100) })
                              setEditingAssigneeId(null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                updateRow(r.id, { assignee: assigneeDraft.trim().slice(0, 100) })
                                setEditingAssigneeId(null)
                              }
                              if (e.key === "Escape") setEditingAssigneeId(null)
                            }}
                            placeholder="—"
                            className="w-full bg-transparent text-[13px] text-white/80 placeholder:text-white/25 outline-none disabled:opacity-80"
                          />
                        ) : (
                          <button
                            disabled={readOnly}
                            onClick={() => {
                              if (readOnly) return
                              setAssigneeDraft(r.assignee)
                              setEditingAssigneeId(r.id)
                            }}
                            title={readOnly ? undefined : "Click to change assignee"}
                            className={`min-w-0 flex-1 truncate text-left text-[13px] ${r.assignee ? "text-white/60" : "text-white/25"} ${readOnly ? "" : "hover:text-white/85"}`}
                          >
                            {r.assignee ? assigneeLabel(r.assignee) : "—"}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3 w-3 text-white/25" />
                        <input
                          type="date"
                          value={r.due}
                          disabled={readOnly}
                          onChange={(e) => updateRow(r.id, { due: e.target.value })}
                          className="bg-transparent text-[13px] text-white/60 outline-none disabled:opacity-60"
                        />
                      </div>
                    </td>
                    {fields.map((f) => (
                      <td key={f.id} className="max-w-[180px] px-3 py-3">
                        <CellEditor def={f} value={r.cells[f.id]} readOnly={readOnly} onChange={(v) => updateCell(r.id, f.id, v)} relationRows={f.targetDocId ? targetRows[f.targetDocId] : undefined} onEnsureRelationRows={() => ensureTargetRows(f.targetDocId)} />
                      </td>
                    ))}
                    <td className="px-2 py-3 text-right">
                      <button onClick={() => setSelectedId(r.id)} title="Open row detail" className="rounded-full bg-white/[0.06] px-2 py-1 text-[11px] text-white/50 hover:bg-white/[0.10] hover:text-white/80">
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!readOnly && (
            <button
              onClick={addRow}
              className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-[13px] text-white/40 hover:bg-white/[0.02] hover:text-white/60"
            >
              <Plus className="h-3.5 w-3.5" />
              New row
            </button>
          )}
        </div>
      ) : view === "kanban" ? (
        <>
          <div className="mb-3 flex items-center gap-1 rounded-full bg-white/[0.04] p-1 self-start">
            {(["status", "assignee", "priority"] as const).map((g) => (
              <button
                key={g}
                onClick={() => { setGroupBy(g); setQuickStatus(null); setQuickTitle(""); setQuickLane(null) }}
                title={g === "status" ? "Group by status" : g === "assignee" ? "Group by assignee (workload)" : "Group by priority"}
                className={`rounded-full px-3 py-1 text-[12px] font-medium capitalize transition ${groupBy === g ? "bg-white text-black" : "text-white/40 hover:text-white/70"}`}
              >
                {g === "assignee" ? "Workload" : g}
              </button>
            ))}
          </div>
          {groupBy === "status" && (
          <div className="mb-3 flex items-center gap-1 self-start rounded-full bg-white/[0.04] p-1">
            {(["none", "assignee", "priority"] as const).map((l) => (
              <button
                key={l}
                onClick={() => { setLaneBy(l); setQuickStatus(null); setQuickTitle(""); setQuickLane(null) }}
                title={l === "none" ? "No swimlanes" : l === "assignee" ? "Swimlanes by assignee" : "Swimlanes by priority"}
                className={`rounded-full px-3 py-1 text-[12px] transition ${laneBy === l ? "bg-white font-medium text-black" : "text-white/40 hover:text-white/70"}`}
              >
                {l === "none" ? "No lanes" : l === "assignee" ? "Assignee lanes" : "Priority lanes"}
              </button>
            ))}
          </div>
          )}
          <div className="mb-3 flex items-center gap-2 self-start">
            <button
              onClick={() => setHideEmpty((v) => !v)}
              title="Hide empty columns (slim drop zones remain)"
              className={`rounded-full border px-3 py-1 text-[12px] transition ${hideEmpty ? "border-white bg-white font-medium text-black" : "border-line bg-white/[0.04] text-white/40 hover:text-white/70"}`}
            >
              Hide empty
            </button>
          </div>
          {swimlanes().map((lane) => {
            const laneRows = laneBy === "none" || groupBy !== "status" ? filtered : filtered.filter((r) => laneOf(r) === lane.key)
            return (
            <div key={lane.key || "__all__"} className={laneBy !== "none" && groupBy === "status" ? "mb-5 last:mb-0" : ""}>
              {laneBy !== "none" && groupBy === "status" && (
                <div className="mb-2 flex items-center gap-2 px-1">
                  {laneBy === "assignee" ? <User className="h-3 w-3 text-white/40" /> : null}
                  <span className="text-[12px] font-medium text-white/60">{lane.label || "Unassigned"}</span>
                  <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-white/40">{laneRows.length}</span>
                </div>
              )}
          <div className="grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2">
          {boardColumns().map(({ key: s, label }) => {
            const inCol = laneRows.filter((r) => groupKeyOf(r) === s)
            const limit = groupBy === "status" ? wip[s] : undefined
            const over = limit !== undefined && inCol.length > limit
            // Hide-empty: collapse zero-card columns to a slim drop zone so
            // cards can still be dragged in and WIP state stays visible.
            if (hideEmpty && inCol.length === 0) {
              return (
                <div
                  key={s || "__unassigned__"}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDropKanban(e, s)}
                  title={`Drop here for ${label}`}
                  className="flex min-w-[64px] flex-col items-center gap-2 rounded-[14px] border border-dashed border-white/10 bg-transparent p-2"
                >
                  <span className="truncate text-[10px] font-medium uppercase tracking-wider text-white/25" style={{ writingMode: "vertical-rl" }}>{label}</span>
                  {!readOnly && (
                    quickStatus === s && (laneBy === "none" || groupBy !== "status" || quickLane === lane.key) ? (
                      <div className="flex w-full flex-col gap-1.5 rounded-[12px] border border-white/15 bg-white/[0.03] p-2">
                        <input
                          autoFocus
                          value={quickTitle}
                          onChange={(e) => setQuickTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") quickAddRow()
                            if (e.key === "Escape") { setQuickStatus(null); setQuickTitle(""); setQuickLane(null) }
                          }}
                          placeholder={`New…`}
                          className="w-full bg-transparent px-1 py-1 text-[12px] text-white/80 placeholder:text-white/25 outline-none"
                        />
                        <button onClick={quickAddRow} disabled={!quickTitle.trim()} className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-black hover:bg-white/90 disabled:opacity-40">
                          Add
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setQuickStatus(s); setQuickTitle(""); setQuickLane(lane.key) }}
                        title={`Add in ${label}`}
                        className="rounded-full bg-white/[0.06] p-1 text-white/40 hover:text-white/70"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    )
                  )}
                </div>
              )
            }
            return (
            <div
              key={s || "__unassigned__"}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDropKanban(e, s)}
              className={`min-w-[220px] rounded-[14px] border p-3 ${over ? "border-amber-500/30 bg-amber-500/[0.03]" : "border-line bg-white/[0.02]"}`}
            >
              <div className="mb-3 flex items-center gap-2 px-1">
                {groupBy === "status" ? (
                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
                ) : groupBy === "assignee" ? (
                  <User className="h-3 w-3 text-white/40" />
                ) : null}
                <span className="truncate text-[12px] font-medium uppercase tracking-wider text-white/60">{label}</span>
                {groupBy === "status" ? (
                <button
                  onClick={() => editWipLimit(s)}
                  title={limit ? `WIP limit ${limit} — click to change` : "Set WIP limit"}
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${over ? "bg-amber-500/15 text-amber-300" : "bg-white/[0.06] text-white/40 hover:text-white/70"}`}
                >
                  {inCol.length}{limit ? `/${limit}` : ""}
                </button>
                ) : (
                <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-white/40">
                  {inCol.length}
                </span>
                )}
                {over && <span className="text-[10px] font-medium uppercase tracking-wider text-amber-300/80">over wip</span>}
              </div>
              <div className="flex flex-col gap-2.5">
                {inCol.map((r) => (
                    <div
                      key={r.id}
                      draggable={!readOnly}
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}
                      className="group cursor-grab rounded-[12px] border border-line bg-surface-1 p-4 shadow-sm transition hover:border-white/10 active:cursor-grabbing"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => setSelectedId(r.id)} className="min-w-0 flex-1 text-left text-[13.5px] font-medium leading-snug text-white/85 hover:text-white">
                          {r.title || "Untitled"}
                        </button>
                        <span className="flex shrink-0 items-center gap-1">
                          <button onClick={() => setSelectedId(r.id)} title="Open detail" className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/50 opacity-0 hover:bg-white/[0.10] group-hover:opacity-100">Open</button>
                          {!readOnly && (
                            <button
                              onClick={() => deleteRow(r.id)}
                              title="Delete card"
                              className="shrink-0 rounded px-1 text-[12px] text-white/20 opacity-0 hover:text-white/60 group-hover:opacity-100"
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <PriorityPill p={r.priority} />
                        {groupBy !== "status" && <StatusPill s={r.status} />}
                        {r.assignee && groupBy !== "assignee" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/50">
                            <User className="h-3 w-3" />
                            {assigneeLabel(r.assignee)}
                          </span>
                        )}
                      </div>
                      {r.due && (
                        <div className={`mt-2 flex items-center gap-1 text-[11px] ${isOverdue(r) ? "font-medium text-red-300" : "text-white/35"}`}>
                          <Calendar className="h-3 w-3" />
                          {new Date(r.due).toLocaleDateString("en-GB")}
                          {isOverdue(r) && <span className="uppercase tracking-wider">· overdue</span>}
                        </div>
                      )}
                    </div>
                  ))}
                {!readOnly && (
                  quickStatus === s && (laneBy === "none" || groupBy !== "status" || quickLane === lane.key) ? (
                    <div className="flex items-center gap-1.5 rounded-[12px] border border-white/15 bg-white/[0.03] p-2">
                      <input
                        autoFocus
                        value={quickTitle}
                        onChange={(e) => setQuickTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") quickAddRow()
                          if (e.key === "Escape") { setQuickStatus(null); setQuickTitle(""); setQuickLane(null) }
                        }}
                        placeholder={`New in ${s || "Unassigned"}…`}
                        className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-[12px] text-white/80 placeholder:text-white/25 outline-none"
                      />
                      <button onClick={quickAddRow} disabled={!quickTitle.trim()} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-black hover:bg-white/90 disabled:opacity-40">
                        Add
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setQuickStatus(s); setQuickTitle(""); setQuickLane(lane.key) }}
                      className="flex items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-white/10 py-2.5 text-[12px] text-white/30 hover:border-white/15 hover:bg-white/[0.02] hover:text-white/50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      New
                    </button>
                  )
                )}
              </div>
            </div>
          )
          })}
          </div>
            </div>
            )
          })}
        </>
      ) : (
        <div className="rounded-[14px] border border-line bg-surface-1 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-medium text-white/80">{monthName}</span>
            <span className="text-[11px] text-white/30">{filtered.filter((r) => r.due).length} dated</span>
          </div>
          <div className="grid grid-cols-7 gap-1 text-[11px]">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="py-1 text-center font-medium uppercase tracking-wider text-white/25">
                {d}
              </div>
            ))}
            {Array.from({ length: firstDow === 0 ? 6 : firstDow - 1 }).map((_, i) => (
              <div key={`e-${i}`} className="h-[88px] rounded-[10px] bg-transparent" />
            ))}
            {days.map((d) => {
              const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
              const items = filtered.filter((r) => r.due === iso)
              return (
                <div
                  key={d}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDropDay(e, iso)}
                  className="min-h-[88px] rounded-[10px] border border-line bg-white/[0.02] p-1.5"
                >
                  <div className="text-[11px] font-medium text-white/40">{d}</div>
                  <div className="mt-1 flex flex-col gap-1">
                    {items.map((r) => (
                      <div
                        key={r.id}
                        draggable={!readOnly}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}
                        onClick={() => setSelectedId(r.id)}
                        title="Open row detail"
                        className="truncate rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-black hover:bg-white/85"
                      >
                        {r.title || "Untitled"}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          {filtered.filter((r) => !r.due).length > 0 && (
            <div
              className="mt-4 border-t border-line pt-3"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDropUndated}
            >
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/30">Undated — drop here to unschedule</div>
              <div className="flex flex-wrap gap-1.5">
                {filtered
                  .filter((r) => !r.due)
                  .map((r) => (
                    <span
                      key={r.id}
                      draggable={!readOnly}
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}
                      onClick={() => setSelectedId(r.id)}
                      title="Open row detail"
                      className="cursor-grab rounded-full border border-line bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/[0.08] active:cursor-grabbing"
                    >
                      {r.title || "Untitled"}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Row detail drawer — AppFlowy-style: click a row/card to edit description & thread comments */}
      {selectedRow && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[2px]" onClick={() => setSelectedId(null)}>
          <div onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-[420px] flex-col border-l border-line bg-[#1a1a18] shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-[12px] font-medium uppercase tracking-wider text-white/40">Row detail</span>
              <button onClick={() => setSelectedId(null)} className="rounded-full bg-white/[0.06] px-3 py-1 text-[12px] text-white/60 hover:bg-white/[0.10]">Close</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <label className="block text-[11px] uppercase tracking-wider text-white/30">Title</label>
              <input
                value={selectedRow.title}
                disabled={readOnly}
                onChange={(e) => updateRow(selectedRow.id, { title: e.target.value })}
                placeholder="Untitled"
                className="mt-1 w-full rounded-xl border border-line bg-white/[0.04] px-3 py-2 text-[13px] text-white/85 outline-none placeholder:text-white/25 disabled:opacity-60"
              />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-white/30">Status</span>
                  <select value={selectedRow.status} disabled={readOnly} onChange={(e) => updateRow(selectedRow.id, { status: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-white/[0.04] px-2.5 py-2 text-[12px] text-white/70 outline-none disabled:opacity-60">
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-white/30">Priority</span>
                  <select value={selectedRow.priority as string} disabled={readOnly} onChange={(e) => updateRow(selectedRow.id, { priority: e.target.value as Row["priority"] })} className="mt-1 w-full rounded-xl border border-line bg-white/[0.04] px-2.5 py-2 text-[12px] text-white/70 outline-none disabled:opacity-60">
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-white/30">Assignee</span>
                  <input value={selectedRow.assignee} disabled={readOnly} list={`workspace-assignees-${docId}`} onChange={(e) => updateRow(selectedRow.id, { assignee: e.target.value })} placeholder="—" className="mt-1 w-full rounded-xl border border-line bg-white/[0.04] px-3 py-2 text-[12px] text-white/60 outline-none placeholder:text-white/25 disabled:opacity-60" />
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-white/30">Due</span>
                  <input type="date" value={selectedRow.due} disabled={readOnly} onChange={(e) => updateRow(selectedRow.id, { due: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-white/[0.04] px-3 py-2 text-[12px] text-white/60 outline-none disabled:opacity-60" />
                </label>
              </div>
              <label className="mt-4 block">
                <span className="text-[11px] uppercase tracking-wider text-white/30">Description</span>
                <textarea value={selectedRow.description} disabled={readOnly} onChange={(e) => updateRow(selectedRow.id, { description: e.target.value })} placeholder="Add details…" rows={4} className="mt-1 w-full rounded-xl border border-line bg-white/[0.04] px-3 py-2 text-[13px] text-white/70 outline-none placeholder:text-white/25 disabled:opacity-60" />
              </label>

              {fields.length > 0 && (
                <div className="mt-4">
                  <span className="text-[11px] uppercase tracking-wider text-white/30">Custom fields</span>
                  <div className="mt-2 flex flex-col gap-2.5">
                    {fields.map((f) => (
                      <label key={f.id} className="block rounded-xl border border-line bg-white/[0.02] px-3 py-2">
                        <span className="mb-1 block text-[11px] text-white/40">{f.name} <span className="text-white/20">· {f.type}</span></span>
                        <CellEditor def={f} value={selectedRow.cells[f.id]} readOnly={readOnly} onChange={(v) => updateCell(selectedRow.id, f.id, v)} relationRows={f.targetDocId ? targetRows[f.targetDocId] : undefined} onEnsureRelationRows={() => ensureTargetRows(f.targetDocId)} />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 border-t border-line pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-white/30">Comments · {selectedRow.comments.length}</span>
                  {!readOnly && selectedRow.comments.length > 0 && <span className="text-[11px] text-white/20">Newest last</span>}
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  {selectedRow.comments.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 py-6 text-center text-[12px] text-white/30">No comments yet.</div>
                  ) : (
                    selectedRow.comments.map((c) => (
                      <div key={c.id} className="rounded-xl border border-line bg-white/[0.03] px-3 py-2.5">
                        <div className="flex items-center justify-between text-[11px] text-white/30">
                          <span className="font-medium text-white/50">{c.author}</span>
                          <span>{new Date(c.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <div className="mt-1 text-[12px] leading-relaxed text-white/75">{c.text}</div>
                      </div>
                    ))
                  )}
                </div>
                {!readOnly && (
                  <div className="mt-3 flex items-center gap-2">
                    <input value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addComment() } }} placeholder="Write a comment…" className="flex-1 rounded-full border border-line bg-white/[0.04] px-3 py-2 text-[12px] text-white/80 placeholder:text-white/25 outline-none" />
                    <button onClick={addComment} disabled={!commentDraft.trim()} className="rounded-full bg-white px-4 py-2 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-40">Send</button>
                  </div>
                )}
                <RowHistory docId={docId} rowId={selectedRow.id} />
                {!readOnly && (
                  <button
                    onClick={async () => {
                      const name = window.prompt("Template name", selectedRow.title ? `${selectedRow.title} template` : "My template")
                      if (!name || !name.trim()) return
                      const tpl: DbTemplate = { id: `tpl-${Date.now().toString(36)}`, name: name.trim().slice(0, 24), title: selectedRow.title, status: selectedRow.status, priority: selectedRow.priority, assignee: selectedRow.assignee, due: selectedRow.due, description: selectedRow.description }
                      await persistTemplates([...templates, tpl].slice(0, 10))
                    }}
                    className="mt-4 w-full rounded-full border border-violet-500/20 bg-violet-500/10 py-2 text-[12px] text-violet-300 hover:bg-violet-500/15"
                  >
                    Save as template
                  </button>
                )}
                {!readOnly && templates.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[11px] uppercase tracking-wider text-white/30">Templates · {templates.length}</div>
                    <div className="mt-1.5 flex flex-col gap-1">
                      {templates.map((t) => (
                        <div key={t.id} className="flex items-center justify-between rounded-xl border border-line bg-white/[0.03] px-3 py-2">
                          <span className="truncate text-[12px] text-white/70">{t.name}</span>
                          <span className="flex items-center gap-1">
                            <button onClick={() => useTemplate(t)} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-black hover:bg-white/90">Use</button>
                            <button
                              onClick={async () => {
                                const next = templates.filter((x) => x.id !== t.id)
                                await persistTemplates(next)
                              }}
                              className="rounded-full p-1 text-white/30 hover:bg-white/[0.06] hover:text-white/60"
                              title="Delete template"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!readOnly && (
                  <button onClick={() => { if (confirm("Delete this row?")) { deleteRow(selectedRow.id); setSelectedId(null) } }} className="mt-4 w-full rounded-full border border-red-500/20 bg-red-500/10 py-2 text-[12px] text-red-300 hover:bg-red-500/15">Delete row</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Template gallery — starters plus saved customs. Save customs from any row's drawer. */}
      {showGallery && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onClick={() => setShowGallery(false)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[80vh] w-full max-w-[560px] overflow-y-auto rounded-2xl border border-line bg-[#1a1a18] p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-medium text-white/85">Template gallery</span>
              <button onClick={() => setShowGallery(false)} className="rounded-full bg-white/[0.06] px-3 py-1 text-[12px] text-white/60 hover:bg-white/[0.10]">Close</button>
            </div>
            <div className="mt-4 text-[11px] font-medium uppercase tracking-wider text-white/30">Starters</div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {BUILT_IN_TEMPLATES.map((t) => (
                <div key={t.id} className="rounded-xl border border-line bg-white/[0.02] p-3">
                  <div className="text-[13px] font-medium text-white/80">{t.name}</div>
                  <div className="mt-0.5 text-[11px] text-white/30">{t.priority} priority · {t.status}</div>
                  <button
                    onClick={() => { useTemplate(t); setShowGallery(false) }}
                    className="mt-2.5 w-full rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-black hover:bg-white/90"
                  >
                    Use template
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-5 text-[11px] font-medium uppercase tracking-wider text-white/30">Yours · {templates.length}</div>
            {templates.length === 0 ? (
              <div className="mt-2 rounded-xl border border-dashed border-white/10 py-5 text-center text-[12px] text-white/30">
                No custom templates — open any row and “Save as template”.
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-1.5">
                {templates.map((t) => (
                  <div key={t.id} className="group flex items-center justify-between gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-white/70">{t.name}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => { useTemplate(t); setShowGallery(false) }}
                        className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black hover:bg-white/90"
                      >
                        Use
                      </button>
                      <button
                        onClick={() => { void persistTemplates(templates.filter((x) => x.id !== t.id)) }}
                        title="Delete template"
                        className="rounded px-1.5 py-0.5 text-[12px] text-white/20 opacity-0 hover:text-red-300 group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

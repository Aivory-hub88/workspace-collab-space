"use client"

import { useState, useEffect } from "react"
import { Tag, X, Plus, Calendar, User, Clock, FileText, Eye, LayoutTemplate, ChevronDown, ChevronUp, Minimize2 } from "lucide-react"

export type DocTag = { id: string; label: string; color: string }
export type DocProps = { isJournal?: boolean; isTemplate?: boolean; pageWidth?: "standard" | "full"; isProject?: boolean; projectDocs?: string[] }

const TAG_COLORS: Record<string, string> = {
  gray: "bg-white/10 text-white/60 border-white/15",
  blue: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  yellow: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  red: "bg-red-500/15 text-red-300 border-red-500/25",
  purple: "bg-violet-500/15 text-violet-300 border-violet-500/25",
  pink: "bg-pink-500/15 text-pink-300 border-pink-500/25",
  orange: "bg-orange-500/15 text-orange-300 border-orange-500/25",
}

const COLOR_OPTIONS: Array<{ value: string; dot: string }> = [
  { value: "gray", dot: "bg-white/40" },
  { value: "blue", dot: "bg-sky-400" },
  { value: "green", dot: "bg-emerald-400" },
  { value: "yellow", dot: "bg-amber-400" },
  { value: "red", dot: "bg-red-400" },
  { value: "purple", dot: "bg-violet-400" },
  { value: "pink", dot: "bg-pink-400" },
  { value: "orange", dot: "bg-orange-400" },
]

function formatDate(value: string | null) {
  if (!value) return "—"
  try {
    return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  } catch {
    return "—"
  }
}

export default function WorkspaceProperties({
  docId,
  tags,
  props,
  createdAt,
  updatedAt,
  ownerName,
  ownerEmail,
  canWrite,
  onPatch,
  collapsible = false,
  defaultCollapsed = false,
}: {
  docId: string
  tags: DocTag[]
  props: DocProps
  createdAt: string | null
  updatedAt: string | null
  ownerName: string | null
  ownerEmail: string | null
  canWrite: boolean
  onPatch: (patch: { tags?: DocTag[]; props?: DocProps }) => Promise<void>
  collapsible?: boolean
  defaultCollapsed?: boolean
}) {
  void docId
  const [newTag, setNewTag] = useState("")
  const [newColor, setNewColor] = useState("gray")
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [tagsOpen, setTagsOpen] = useState(true)
  const [metaOpen, setMetaOpen] = useState(true)
  const [flagsOpen, setFlagsOpen] = useState(true)

  useEffect(() => {
    setCollapsed(defaultCollapsed)
  }, [defaultCollapsed])

  const addTag = async () => {
    const label = newTag.trim().slice(0, 24)
    if (!label || busy || !canWrite) return
    setBusy(true)
    const next = [...tags, { id: `tag-${Date.now().toString(36)}`, label, color: newColor }]
    await onPatch({ tags: next })
    setNewTag("")
    setBusy(false)
  }

  const removeTag = async (id: string) => {
    if (busy || !canWrite) return
    setBusy(true)
    await onPatch({ tags: tags.filter((t) => t.id !== id) })
    setBusy(false)
  }

  const toggleProp = async (key: keyof DocProps, value: unknown) => {
    if (busy || !canWrite) return
    setBusy(true)
    // Delta only — server merges atomically via COALESCE(props,'{}') || patch.
    // Sending {...props, [key]: value} would overwrite sibling flags with stale
    // values when the parent meta is outdated (the Properties revert bug).
    await onPatch({ props: { [key]: value } as DocProps })
    setBusy(false)
  }

  return (
    <div className="mx-auto w-full max-w-[960px] rounded-2xl border border-line bg-white/[0.025] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={() => collapsible && setCollapsed((v) => !v)}
          className={`flex items-center gap-2 text-[12px] font-medium ${collapsible ? "hover:text-white/80 text-white/50" : "text-white/50"} ${collapsible ? "cursor-pointer" : ""}`}
          title={collapsible ? (collapsed ? "Expand properties" : "Minimize for larger canvas") : undefined}
        >
          <FileText className="h-3.5 w-3.5" /> Properties
          {collapsible && (collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
        </button>
        <span className="flex items-center gap-2 text-[11px] text-white/25">
          <span>{tags.length} tags · {props.isJournal ? "Journal" : "Page"}</span>
          {collapsible && !collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              title="Minimize properties — larger canvas"
              className="inline-flex items-center gap-1 rounded-full border border-line bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/40 hover:bg-white/[0.08] hover:text-white/70"
            >
              <Minimize2 className="h-3 w-3" /> Minimize
            </button>
          )}
        </span>
      </div>
      {collapsed ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-white/30">
          {tags.length > 0 ? tags.slice(0, 3).map((t) => (
            <span key={t.id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${TAG_COLORS[t.color] ?? TAG_COLORS.gray}`}>{t.label}</span>
          )) : <span className="text-white/25">No tags</span>}
          <span className="mx-1 text-white/15">·</span>
          <span>{props.isJournal ? "Journal" : "Page"}</span>
          <span className="text-white/15">·</span>
          <span>{props.isTemplate ? "Template" : "No template"}</span>
          <button onClick={() => setCollapsed(false)} className="ml-2 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-black hover:bg-white/90">Expand</button>
        </div>
      ) : (
        <>
          {/* Tags — collapsible sub-section */}
          <div className="mt-3">
            <button
              onClick={() => setTagsOpen((v) => !v)}
              className="mb-1.5 flex cursor-pointer items-center gap-1.5 text-[11px] uppercase tracking-wider text-white/30 hover:text-white/60"
            >
              <Tag className="h-3 w-3" /> Tags
              {tagsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {!tagsOpen && tags.length > 0 && <span className="normal-case text-white/25">· {tags.length}</span>}
            </button>
            {tagsOpen && (
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((t) => (
                <span key={t.id} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${TAG_COLORS[t.color] ?? TAG_COLORS.gray}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${COLOR_OPTIONS.find((c) => c.value === t.color)?.dot ?? "bg-white/40"}`} />
                  {t.label}
                  {canWrite && (
                    <button onClick={() => removeTag(t.id)} className="ml-0.5 rounded-full p-0.5 hover:bg-white/10">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              {canWrite ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addTag() }}
                    placeholder="New tag"
                    className="w-[120px] rounded-full border border-line bg-white/[0.04] px-3 py-1 text-[11px] text-white/80 placeholder:text-white/25 outline-none"
                  />
                  <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-line bg-white/[0.04] p-1">
                    {COLOR_OPTIONS.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => setNewColor(c.value)}
                        title={c.value}
                        className={`h-5 w-5 rounded-full border ${newColor === c.value ? "border-white/50" : "border-transparent"} flex items-center justify-center`}
                      >
                        <span className={`h-3 w-3 rounded-full ${c.dot}`} />
                      </button>
                    ))}
                  </span>
                  <button onClick={addTag} disabled={!newTag.trim() || busy} className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black hover:bg-white/90 disabled:opacity-40">
                    <Plus className="h-3 w-3 inline" /> Add
                  </button>
                </span>
              ) : tags.length === 0 ? (
                <span className="text-[11px] text-white/25">No tags</span>
              ) : null}
            </div>
            )}
          </div>

          <button
            onClick={() => setMetaOpen((v) => !v)}
            className="mt-4 flex w-full cursor-pointer items-center gap-1.5 border-t border-line pt-3 text-[11px] uppercase tracking-wider text-white/30 hover:text-white/60"
          >
            <Clock className="h-3 w-3" /> Dates & owner
            {metaOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {metaOpen && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex items-center gap-2 text-[11px] text-white/40">
              <Calendar className="h-3 w-3" />
              <span className="uppercase tracking-wider">Created</span>
              <span className="text-white/60">{formatDate(createdAt)}</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/40">
              <Clock className="h-3 w-3" />
              <span className="uppercase tracking-wider">Updated</span>
              <span className="text-white/60">{formatDate(updatedAt)}</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/40">
              <User className="h-3 w-3" />
              <span className="uppercase tracking-wider">By</span>
              <span className="truncate text-white/60">{ownerName ?? ownerEmail ?? "—"}</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/40">
              <Eye className="h-3 w-3" />
              <span className="uppercase tracking-wider">Width</span>
              <button
                onClick={() => toggleProp("pageWidth", props.pageWidth === "full" ? "standard" : "full")}
                disabled={!canWrite}
                className="rounded-full border border-line bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/60 hover:bg-white/[0.08] disabled:opacity-50"
              >
                {props.pageWidth === "full" ? "Full" : "Standard"}
              </button>
            </div>
          </div>
          )}

          <button
            onClick={() => setFlagsOpen((v) => !v)}
            className="mt-3 flex w-full cursor-pointer items-center gap-1.5 border-t border-line pt-3 text-[11px] uppercase tracking-wider text-white/30 hover:text-white/60"
          >
            <LayoutTemplate className="h-3 w-3" /> Journal · Template · Width
            {flagsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {flagsOpen && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => toggleProp("isJournal", !props.isJournal)}
              disabled={!canWrite}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${props.isJournal ? "bg-amber-500/15 text-amber-300 border-amber-500/25" : "border-line bg-white/[0.04] text-white/40 hover:bg-white/[0.08] disabled:opacity-50"}`}
            >
              <Calendar className="h-3 w-3" /> Journal {props.isJournal ? "on" : "off"}
            </button>
            <button
              onClick={() => toggleProp("isTemplate", !props.isTemplate)}
              disabled={!canWrite}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${props.isTemplate ? "bg-violet-500/15 text-violet-300 border-violet-500/25" : "border-line bg-white/[0.04] text-white/40 hover:bg-white/[0.08] disabled:opacity-50"}`}
            >
              <LayoutTemplate className="h-3 w-3" /> Template {props.isTemplate ? "on" : "off"}
            </button>
          </div>
          )}
        </>
      )}
    </div>
  )
}

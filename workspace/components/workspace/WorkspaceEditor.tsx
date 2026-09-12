"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { FormEvent, KeyboardEvent } from "react"
import Link from "next/link"
import * as Y from "yjs"
import { WebsocketProvider } from "y-websocket"
import { Check, CheckSquare, CloudOff, Code2, GripVertical, Heading1, Heading2, Heading3, List, ListOrdered, LoaderCircle, Minus, MoreHorizontal, Plus, Quote, Table2, Tag, Trash2, Type } from "lucide-react"
import { collabAuthHeaders, collabWsParams, collabWsUrl } from "@/lib/collabClient"

type BlockType = "h1" | "h2" | "h3" | "p" | "todo" | "bullet" | "numbered" | "quote" | "code" | "divider" | "database"
type Block = { id: string; type: BlockType; text: string; checked?: boolean }
type DbRow = { id: string; title: string; status: string }
type SlashState = { idx: number; query: string } | null
type SaveState = "saved" | "saving" | "offline"

const BLOCK_TYPES: Array<{ type: BlockType; label: string; hint: string; group: string; Icon: typeof Type }> = [
  { type: "p", label: "Text", hint: "Just start writing", group: "Text", Icon: Type },
  { type: "h1", label: "Heading 1", hint: "Big section heading", group: "Style", Icon: Heading1 },
  { type: "h2", label: "Heading 2", hint: "Medium section heading", group: "Style", Icon: Heading2 },
  { type: "h3", label: "Heading 3", hint: "Small section heading", group: "Style", Icon: Heading3 },
  { type: "quote", label: "Quote", hint: "Capture a quote", group: "Style", Icon: Quote },
  { type: "code", label: "Code Block", hint: "Code snippet", group: "Style", Icon: Code2 },
  { type: "divider", label: "Divider", hint: "Visual separator", group: "Style", Icon: Minus },
  { type: "todo", label: "To-do", hint: "Track a task", group: "List", Icon: CheckSquare },
  { type: "bullet", label: "Bulleted list", hint: "Simple bullet list", group: "List", Icon: List },
  { type: "numbered", label: "Numbered list", hint: "Ordered list", group: "List", Icon: ListOrdered },
  { type: "database", label: "Table", hint: "Database table view", group: "Database", Icon: Table2 },
]

// Uncontrolled contentEditable — syncs from Yjs only when not focused
function BlockContent({
  block,
  readOnly,
  onInput,
  onKeyDown,
  onContextMenu,
}: {
  block: Block
  readOnly: boolean
  onInput: (e: FormEvent<HTMLDivElement>) => void
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Don't clobber while user is typing
    if (document.activeElement === el) {
      // Only patch if remote text differs and local caret isn't at risk
      // For local edits block.text already equals innerText so skip
      if (el.textContent !== block.text) {
        // Keep if user just typed "/" trigger — let slash logic handle clearing
        if (el.textContent !== `/${block.text}`) return
      } else return
    }
    if (el.textContent !== block.text) el.textContent = block.text
  }, [block.text])

  // initial mount
  useLayoutEffect(() => {
    if (ref.current && ref.current.textContent !== block.text) ref.current.textContent = block.text
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={ref}
      id={`block-${block.id}`}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      onInput={onInput}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      data-placeholder={block.text === "" ? (block.type === "h1" ? "What are you working on?" : block.type === "h3" ? "Heading 3" : block.type === "todo" ? "To-do" : "Start writing...  '/' for commands") : undefined}
      className={`relative w-full rounded-lg px-2 py-1.5 outline-none empty:before:text-white/25 empty:before:content-[attr(data-placeholder)] focus:bg-white/[0.03] ${block.checked ? "text-white/30 line-through" : ""} ${blockClass(block.type)}`}
    />
  )
}

function uid() {
  return Math.random().toString(36).slice(2, 8)
}

function toDbRows(dbArray: Y.Array<Y.Map<unknown>>): DbRow[] {
  return dbArray.toArray().map((map) => ({
    id: (map.get("id") as string) ?? uid(),
    title: (map.get("title") as string) ?? "",
    status: (map.get("status") as string) ?? "Todo",
  }))
}

function statusPill(status: string) {
  const s = status.toLowerCase()
  if (s === "done") return "bg-emerald-500/15 text-emerald-300"
  if (s === "in progress" || s === "doing") return "bg-sky-500/15 text-sky-300"
  return "bg-amber-500/15 text-amber-300"
}

function DatabaseEmbed({ rows, docId }: { rows: DbRow[]; docId: string }) {
  const preview = rows.slice(0, 4)
  return (
    <div className="w-full rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12px] font-medium text-white/70">
          <Table2 className="h-3.5 w-3.5" />Table
        </div>
        <Link href={`/workspace/${docId}?view=database`} className="text-[11px] text-white/35 hover:text-white/70">
          Open data →
        </Link>
      </div>
      {preview.length === 0 ? (
        <div className="py-3 text-center text-[12px] text-white/30">No records yet — open data to add one.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {preview.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
              <span className="truncate text-[12px] text-white/75">{row.title || "Untitled"}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusPill(row.status)}`}>{row.status}</span>
            </div>
          ))}
        </div>
      )}
      {rows.length > preview.length && <div className="mt-1.5 text-[11px] text-white/25">+{rows.length - preview.length} more</div>}
    </div>
  )
}

function yMapFromBlock(block: Block): Y.Map<unknown> {
  const map = new Y.Map<unknown>()
  map.set("id", block.id)
  map.set("type", block.type)
  map.set("text", block.text)
  if (block.checked !== undefined) map.set("checked", block.checked)
  return map
}

function toBlocks(yArray: Y.Array<Y.Map<unknown>>): Block[] {
  return yArray.toArray().map((map) => ({
    id: (map.get("id") as string) ?? uid(),
    type: (map.get("type") as BlockType) ?? "p",
    text: (map.get("text") as string) ?? "",
    checked: map.get("checked") as boolean | undefined,
  }))
}

function isLegacyPrototypeContent(blocks: Block[]) {
  const text = blocks.map((block) => block.text).join("\n")
  return text.includes("Yjs Doc active") && (text.includes("Try typing") || text.includes("Agents can create rows"))
}

function blockClass(type: BlockType) {
  if (type === "h1") return "text-[30px] font-semibold leading-tight text-white/90"
  if (type === "h2") return "text-[21px] font-medium leading-tight text-white/85"
  if (type === "h3") return "text-[17px] font-semibold leading-tight text-white/80"
  if (type === "quote") return "border-l-2 border-white/15 pl-4 italic text-white/60"
  if (type === "code") return "rounded-lg bg-white/[0.06] font-mono text-[13px] text-white/75 px-3 py-2"
  if (type === "divider") return "py-2 text-white/10"
  if (type === "bullet") return "pl-5 text-[14px] leading-relaxed text-white/80 before:absolute before:ml-[-17px] before:mt-[8px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-white/40 before:content-['']"
  if (type === "numbered") return "pl-5 text-[14px] leading-relaxed text-white/80 list-decimal"
  if (type === "database") return "rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[13px] text-white/60"
  return "text-[14px] leading-relaxed text-white/80"
}

export default function WorkspaceEditor({ docId, readOnly = false, onTextChange, registerImport }: { docId: string; readOnly?: boolean; onTextChange?: (text: string) => void; registerImport?: (fn: (blocks: Array<{ type: BlockType; text: string; checked?: boolean }>) => number) => void }) {
  const docRef = useRef<Y.Doc | null>(null)
  const yArrayRef = useRef<Y.Array<Y.Map<unknown>> | null>(null)
  const providerRef = useRef<WebsocketProvider | null>(null)
  const readOnlyRef = useRef(readOnly)
  const onTextChangeRef = useRef(onTextChange)
  useEffect(() => {
    onTextChangeRef.current = onTextChange
  }, [onTextChange])
  const [blocks, setBlocks] = useState<Block[]>([])
  const [dbRows, setDbRows] = useState<DbRow[]>([])
  const [slash, setSlash] = useState<SlashState>(null)
  const [openMenu, setOpenMenu] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  // Start honest: nothing is confirmed on the server yet, so never claim
  // "Saved" before the first verified round-trip (the old initial "saved"
  // made local-only cache look persisted).
  const [saveState, setSaveState] = useState<SaveState>("saving")

  useEffect(() => {
    readOnlyRef.current = readOnly
  }, [readOnly])

  const storageKey = `workspace:yjs:v3:${docId}`
  const agentOrigin = () => (typeof window !== "undefined" ? localStorage.getItem("workspace:agentType") || "user" : "user")

  useEffect(() => {
    const doc = new Y.Doc()
    const yArray = doc.getArray<Y.Map<unknown>>("blocks")
    docRef.current = doc
    yArrayRef.current = yArray
    let alive = true
    let putTimer: ReturnType<typeof setTimeout> | null = null

    const saved = localStorage.getItem(storageKey)
    if (saved) {
      try {
        Y.applyUpdate(doc, Uint8Array.from(JSON.parse(saved) as number[]))
      } catch {}
    }

    const schedulePut = () => {
      if (readOnlyRef.current) return
      if (putTimer) clearTimeout(putTimer)
      setSaveState("saving")
      putTimer = setTimeout(() => {
        const update = Y.encodeStateAsUpdate(doc)
        fetch(`/api/workspace/${docId}/doc`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream", ...collabAuthHeaders() },
          body: update as unknown as BodyInit,
        })
          .then((response) => {
            if (!alive) return
            setSaveState(response.ok ? "saved" : "offline")
          })
          .catch(() => {
            if (alive) setSaveState("offline")
          })
      }, 500)
    }

    const clearLegacyPrototype = () => {
      if (readOnlyRef.current || !isLegacyPrototypeContent(toBlocks(yArray))) return false
      doc.transact(() => {
        yArray.delete(0, yArray.length)
        yArray.push([
          yMapFromBlock({ id: uid(), type: "h1", text: "" }),
          yMapFromBlock({ id: uid(), type: "p", text: "" }),
        ])
      }, agentOrigin())
      return true
    }

    const dbArray = doc.getArray<Y.Map<unknown>>("database")
    const observer = () => {
      if (!alive) return
      const next = toBlocks(yArray)
      setBlocks(next)
      setDbRows(toDbRows(dbArray))
      try {
        onTextChangeRef.current?.(next.map((b) => b.text).filter(Boolean).join("\n").slice(0, 6000))
      } catch {}
      try {
        localStorage.setItem(storageKey, JSON.stringify(Array.from(Y.encodeStateAsUpdate(doc))))
      } catch {}
      schedulePut()
    }
    yArray.observe(observer)
    const dbObserver = () => {
      if (!alive) return
      setDbRows(toDbRows(dbArray))
    }
    dbArray.observe(dbObserver)

    fetch(`/api/workspace/${docId}/doc`, { headers: collabAuthHeaders() })
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((buffer) => {
        if (!alive) return
        const serverEmpty = !buffer || buffer.byteLength === 0
        if (!serverEmpty) Y.applyUpdate(doc, new Uint8Array(buffer as ArrayBuffer))
        const legacy = isLegacyPrototypeContent(toBlocks(yArray))
        if (legacy) clearLegacyPrototype()
        if (yArray.length === 0 && !readOnlyRef.current) {
          doc.transact(() => {
            yArray.push([yMapFromBlock({ id: uid(), type: "h1", text: "" })])
            yArray.push([yMapFromBlock({ id: uid(), type: "p", text: "" })])
          }, agentOrigin())
        }
        const next = legacy && readOnlyRef.current ? [] : toBlocks(yArray)
        setBlocks(next)
        setDbRows(toDbRows(dbArray))
        try {
          onTextChangeRef.current?.(next.map((b) => b.text).filter(Boolean).join("\n").slice(0, 6000))
        } catch {}
        setReady(true)
        // Rescue stranded local cache: content that only exists in this
        // browser (server has no record) previously never uploaded, while the
        // badge claimed "Saved". Push the merged state so the server converges.
        if (!readOnlyRef.current && serverEmpty && yArray.length > 0) schedulePut()
        else if (alive) setSaveState(serverEmpty && !readOnlyRef.current ? "saving" : "saved")
      })
      .catch(() => {
        if (!alive) return
        const legacy = isLegacyPrototypeContent(toBlocks(yArray))
        if (legacy) clearLegacyPrototype()
        if (yArray.length === 0 && !readOnlyRef.current) {
          doc.transact(() => yArray.push([yMapFromBlock({ id: uid(), type: "p", text: "" })]), agentOrigin())
        }
        const next = legacy && readOnlyRef.current ? [] : toBlocks(yArray)
        setBlocks(next)
        setDbRows(toDbRows(dbArray))
        try {
          onTextChangeRef.current?.(next.map((b) => b.text).filter(Boolean).join("\n").slice(0, 6000))
        } catch {}
        setReady(true)
        // Server unreachable: try the rescue PUT (fails honestly to Offline),
        // otherwise admit we cannot verify persistence.
        if (!readOnlyRef.current && yArray.length > 0) schedulePut()
        else if (alive) setSaveState("offline")
      })

    const wsUrl = collabWsUrl()
    try {
      const provider = new WebsocketProvider(wsUrl, `workspace:${docId}`, doc, { connect: true, params: collabWsParams() })
      providerRef.current = provider
      const agentType = typeof window !== "undefined" ? localStorage.getItem("workspace:agentType") || "user" : "user"
      const userId = typeof window !== "undefined" ? localStorage.getItem("workspace:userId") || "anon" : "anon"
      const color = agentType === "user" ? "#7c3aed" : agentType.includes("leads") ? "#f59e0b" : "#10b981"
      provider.awareness.setLocalStateField("user", { name: agentType === "user" ? "You" : agentType.replace(/_/g, " "), color, agentType, userId })
    } catch {}

    return () => {
      alive = false
      if (putTimer) clearTimeout(putTimer)
      yArray.unobserve(observer)
      dbArray.unobserve(dbObserver)
      providerRef.current?.destroy()
      doc.destroy()
    }
  }, [docId, storageKey])

  const guard = () => !readOnlyRef.current

  // Markdown/file import entry point (registered to the parent once the doc
  // is live). Appends blocks — or replaces the untouched starter content.
  // Returns the number of blocks inserted.
  const importBlocks = (incoming: Array<{ type: BlockType; text: string; checked?: boolean }>): number => {
    if (!guard() || incoming.length === 0) return 0
    const yArray = yArrayRef.current
    const doc = docRef.current
    if (!yArray || !doc) return 0
    const current = toBlocks(yArray)
    const isStarter = current.length > 0 && current.every((b) => b.text === "")
    const maps = incoming.slice(0, 500).map((b) =>
      yMapFromBlock({
        id: uid(),
        type: b.type,
        text: b.text.slice(0, 2000),
        ...(b.type === "todo" ? { checked: b.checked === true } : {}),
      }),
    )
    if (maps.length === 0) return 0
    doc.transact(() => {
      if (isStarter) yArray.delete(0, yArray.length)
      yArray.push(maps)
    }, agentOrigin())
    return maps.length
  }

  const importRef = useRef(importBlocks)
  importRef.current = importBlocks
  useEffect(() => {
    registerImport?.((blocks) => importRef.current(blocks))
  }, [registerImport, docId])

  const update = (index: number, patch: Partial<Block>) => {
    if (!guard()) return
    const yArray = yArrayRef.current
    const doc = docRef.current
    if (!yArray || !doc || !yArray.get(index)) return
    const map = yArray.get(index) as Y.Map<unknown>
    doc.transact(() => {
      for (const [key, value] of Object.entries(patch)) map.set(key, value)
    }, agentOrigin())
  }

  const focusBlock = (id: string) => setTimeout(() => document.getElementById(`block-${id}`)?.focus(), 10)

  const addAfter = (index: number, type: BlockType = "p") => {
    if (!guard()) return
    const yArray = yArrayRef.current
    const doc = docRef.current
    if (!yArray || !doc) return
    const next: Block = { id: uid(), type, text: "", ...(type === "todo" ? { checked: false } : {}) }
    doc.transact(() => yArray.insert(index + 1, [yMapFromBlock(next)]), agentOrigin())
    focusBlock(next.id)
  }

  const remove = (index: number) => {
    if (!guard()) return
    const yArray = yArrayRef.current
    const doc = docRef.current
    if (!yArray || !doc || yArray.length <= 1) return
    const previousId = index > 0 ? ((yArray.get(index - 1)?.get("id") as string) ?? "") : ""
    doc.transact(() => yArray.delete(index, 1), agentOrigin())
    if (previousId) focusBlock(previousId)
  }

  const selectType = (index: number, type: BlockType) => {
    if (type === "divider") {
      update(index, { type, text: "—" })
    } else if (type === "database") {
      // Inline live table preview (same Y.Doc `database` array as the Data
      // view), so picking Table visibly inserts something.
      update(index, { type: "database", text: "" })
    } else {
      const curText = blocks[index]?.text ?? ""
      const cleaned = curText.startsWith("/") ? "" : curText
      update(index, { type, text: cleaned, ...(type === "todo" ? { checked: false } : {}) })
    }
    setSlash(null)
    setOpenMenu(null)
    focusBlock(blocks[index]?.id ?? "")
  }

  const onInput = (index: number, event: FormEvent<HTMLDivElement>) => {
    const text = (event.currentTarget.textContent ?? "").replace(/\u00a0/g, " ")
    // Don't include trailing newline browsers add
    const clean = text.replace(/\n$/, "")
    update(index, { text: clean })
    if (!readOnly && clean.startsWith("/")) setSlash({ idx: index, query: clean.slice(1) })
    else if (slash?.idx === index) setSlash(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (readOnly) return
    const current = blocks[index]
    if (event.key === "Escape") {
      setSlash(null)
      setOpenMenu(null)
      return
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (slash?.idx === index) {
        // Pick first filtered option on Enter
        const first = BLOCK_TYPES.filter((b) => b.label.toLowerCase().includes(slash.query.trim().toLowerCase()))[0]
        if (first) selectType(index, first.type)
        else {
          update(index, { text: "" })
          setSlash(null)
        }
      } else addAfter(index, current.type === "h1" || current.type === "h2" || current.type === "h3" ? "p" : current.type)
      return
    }
    if (event.key === "Backspace") {
      const el = event.currentTarget as HTMLDivElement
      const isEmpty = (el.textContent ?? "").trim() === "" && current.text === ""
      if (isEmpty) {
        event.preventDefault()
        remove(index)
      }
    }
    if (event.key === "/" && (event.currentTarget.textContent ?? "") === "") {
      // Open slash immediately
      setSlash({ idx: index, query: "" })
    }
  }

  // Grouped slash menu
  const visibleSlashGroups = (() => {
    if (!slash) return []
    const q = slash.query.trim().toLowerCase()
    const filtered = q ? BLOCK_TYPES.filter((b) => b.label.toLowerCase().includes(q) || b.group.toLowerCase().includes(q)) : BLOCK_TYPES
    const groups = new Map<string, typeof BLOCK_TYPES>()
    for (const b of filtered) {
      if (!groups.has(b.group)) groups.set(b.group, [])
      groups.get(b.group)!.push(b)
    }
    return Array.from(groups.entries())
  })()
  const isStarter = blocks.length === 2 && blocks[0]?.type === "h1" && blocks[1]?.type === "p" && blocks.every((block) => block.text === "")

  const saveLabel = saveState === "saving" ? "Saving" : saveState === "offline" ? "Offline" : "Saved"
  const SaveIcon = saveState === "saving" ? LoaderCircle : saveState === "offline" ? CloudOff : Check

  if (!ready) return <div className="mx-auto w-full max-w-[720px] py-12 text-center text-[13px] text-white/30">Loading page…</div>

  if (blocks.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[720px] py-8">
        {readOnly ? (
          <div className="py-12 text-center text-[13px] text-white/30">This page is empty.</div>
        ) : (
          <button onClick={() => addAfter(-1)} className="w-full rounded-xl border border-dashed border-white/10 py-10 text-[13px] text-white/35 hover:border-white/20 hover:bg-white/[0.02] hover:text-white/60">
            Start writing
            <span className="mt-1 block text-[12px] text-white/25">Press Enter for a new block or / for commands</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[780px] lg:pl-[52px]">
      <div className="mb-8 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-white/25">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-white/50" />
          {isStarter ? "Start here" : "Your page"}
        </div>
        <div className="flex items-center gap-1.5 normal-case tracking-normal text-white/30">
          <SaveIcon className={`h-3.5 w-3.5 ${saveState === "saving" ? "animate-spin" : ""}`} />
          {saveLabel}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {blocks.map((block, index) => (
          <div key={block.id} className="group relative flex items-start gap-1">
            {!readOnly && (
              <div className="absolute -left-[58px] top-1 hidden items-center gap-0.5 group-hover:flex">
                <button onClick={() => addAfter(index)} title="Add block" className="rounded p-1 text-white/25 hover:bg-white/[0.06] hover:text-white/75"><Plus className="h-4 w-4" /></button>
                <button onClick={() => setOpenMenu(openMenu === index ? null : index)} title="Block type" className="rounded p-1 text-white/25 hover:bg-white/[0.06] hover:text-white/75"><GripVertical className="h-4 w-4" /></button>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                {block.type === "todo" && (
                  <input
                    type="checkbox"
                    checked={!!block.checked}
                    disabled={readOnly}
                    onChange={(event) => update(index, { checked: event.target.checked })}
                    className="mt-2 h-4 w-4 shrink-0 rounded border border-white/20 bg-transparent accent-white"
                  />
                )}
                {block.type === "database" ? (
                  <DatabaseEmbed rows={dbRows} docId={docId} />
                ) : (
                  <BlockContent
                    block={block}
                    readOnly={readOnly}
                    onInput={(e) => onInput(index, e)}
                    onKeyDown={(e) => onKeyDown(e, index)}
                    onContextMenu={(e) => {
                      if (readOnly) return
                      e.preventDefault()
                      setOpenMenu(openMenu === index ? null : index)
                    }}
                  />
                )}
              </div>
              {block.type === "divider" && <div className="mt-1 h-px w-full bg-white/10" />}
              {!readOnly && slash?.idx === index && visibleSlashGroups.length > 0 && (
                <div className="mt-1 w-full max-w-[360px] rounded-xl border border-line bg-[#2c2c29] p-1.5 shadow-2xl">
                  {visibleSlashGroups.map(([group, items]) => (
                    <div key={group} className="mb-1 last:mb-0">
                      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-white/25">{group}</div>
                      {items.map(({ type, label, hint, Icon }) => (
                        <button key={type} onMouseDown={(e) => e.preventDefault()} onClick={() => selectType(index, type)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/[0.07]">
                          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-white/65"><Icon className="h-3.5 w-3.5" /></span>
                          <span className="min-w-0"><span className="block text-[12px] text-white/80">{label}</span><span className="block text-[10px] text-white/30">{hint}</span></span>
                        </button>
                      ))}
                    </div>
                  ))}
                  <div className="mt-1 border-t border-white/5 px-2 py-1 text-[10px] text-white/20">Tip: type / then heading, todo, table…</div>
                </div>
              )}
              {!readOnly && openMenu === index && (
                <div className="absolute left-0 top-8 z-10 w-[260px] rounded-xl border border-line bg-[#2c2c29] p-1.5 shadow-2xl">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-white/25">Turn into</div>
                  {BLOCK_TYPES.map(({ type, label, Icon }) => (
                    <button key={type} onClick={() => selectType(index, type)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12px] text-white/65 hover:bg-white/[0.07] hover:text-white/90">
                      <Icon className="h-3.5 w-3.5" />{label}
                    </button>
                  ))}
                  <button onClick={() => remove(index)} className="mt-1 flex w-full items-center gap-2 border-t border-line px-2 py-2 text-left text-[12px] text-red-300/70 hover:text-red-200"><Trash2 className="h-3.5 w-3.5" />Delete block</button>
                </div>
              )}
            </div>
            {!readOnly && <button onContextMenu={(e)=>{e.preventDefault(); setOpenMenu(openMenu===index?null:index)}} onClick={() => setOpenMenu(openMenu === index ? null : index)} title="More block actions (right-click)" className="mt-1 rounded p-1 text-white/0 group-hover:text-white/25 hover:bg-white/[0.06] hover:text-white/70"><MoreHorizontal className="h-4 w-4" /></button>}
          </div>
        ))}
      </div>
      {!readOnly && <button onClick={() => addAfter(blocks.length - 1)} className="mt-5 flex items-center gap-2 px-2 text-[12px] text-white/25 hover:text-white/55"><Plus className="h-3.5 w-3.5" />New block</button>}
      {isStarter && !readOnly && (
        <div className="mt-10 rounded-2xl border border-line bg-white/[0.025] p-5">
          <div className="text-[13px] font-medium text-white/70">Start with a simple idea</div>
          <div className="mt-1 text-[12px] text-white/35">Choose a starting point, or just begin typing above.</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => focusBlock(blocks[0].id)} className="rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/60 hover:bg-white/[0.08] hover:text-white/85">Write a note</button>
            <button onClick={() => selectType(1, "todo")} className="rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/60 hover:bg-white/[0.08] hover:text-white/85">Make a task</button>
            <button onClick={() => addAfter(1, "h2")} className="rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/60 hover:bg-white/[0.08] hover:text-white/85">Add a section</button>
          </div>
        </div>
      )}
    </div>
  )
}

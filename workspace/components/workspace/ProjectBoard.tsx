"use client"

import { useCallback, useEffect, useState } from "react"
import { Calendar, Plus, User, X } from "lucide-react"
import { collabAuthHeaders } from "@/lib/collabClient"

type AggRow = {
  id: string
  doc_id: string
  title: string
  status: string
  priority: "Low" | "Med" | "High"
  assignee: string
  due: string
  description: string
}

type AggDoc = {
  doc_id: string
  title: string
  wip: Record<string, number>
  rows: AggRow[]
}

type BoardData = {
  project_id: string
  title: string
  room: string
  docs: AggDoc[]
  totalRows: number
}

const COLUMNS = ["Todo", "Doing", "Done"] as const

function isOverdue(due: string, status: string): boolean {
  return !!due && status !== "Done" && due < new Date().toISOString().slice(0, 10)
}

export default function ProjectBoard({
  projectId,
  members,
  canWrite,
  onMembersChange,
}: {
  projectId: string
  members: string[]
  canWrite: boolean
  onMembersChange: (members: string[]) => Promise<boolean>
}) {
  const [data, setData] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [addDoc, setAddDoc] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/workspace/projects/${projectId}/board`, { headers: collabAuthHeaders() })
      if (r.ok) {
        setData(await r.json())
      } else if (r.status === 404) {
        setError("Not a project yet — flag this doc as a project first.")
      } else {
        setError("Could not load the project board.")
      }
    } catch {
      setError("Could not connect to your workspace. Please try again.")
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load, members.join(",")])

  const moveCard = async (row: AggRow, status: string) => {
    if (!canWrite || movingId || row.status === status) return
    setMovingId(row.id)
    setError(null)
    try {
      const r = await fetch(`/api/workspace/${row.doc_id}/database/${row.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...collabAuthHeaders() },
        body: JSON.stringify({ status }),
      })
      if (r.ok) {
        await load()
      } else if (r.status === 409) {
        const j = await r.json().catch(() => ({}))
        setError(j.error === "wip-exceeded" ? `WIP limit reached (${j.limit}) — finish something first.` : "This move was rejected.")
      } else {
        setError("This card could not be moved.")
      }
    } catch {
      setError("Could not connect to your workspace. Please try again.")
    }
    setMovingId(null)
  }

  const addMember = async () => {
    const bare = addDoc.trim().replace(/^workspace:(room:)?/, "")
    if (!bare || members.includes(bare)) return
    if (await onMembersChange([...members, bare])) setAddDoc("")
  }

  const removeMember = async (docId: string) => {
    await onMembersChange(members.filter((m) => m !== docId))
  }

  const allRows = (data?.docs ?? []).flatMap((d) => d.rows)

  return (
    <div className="mx-auto w-full max-w-[960px]">
      {/* Member docs */}
      <div className="mb-4 rounded-2xl border border-line bg-white/[0.025] p-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/30">
          Member docs · {members.length}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {members.length === 0 && <span className="text-[12px] text-white/30">No member docs — showing sibling docs.</span>}
          {members.map((m) => (
            <span key={m} className="group inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.04] px-2.5 py-1 text-[12px] text-white/60">
              {data?.docs.find((d) => d.doc_id === m)?.title ?? m}
              {canWrite && (
                <button onClick={() => removeMember(m)} title="Remove from project" className="rounded text-white/25 hover:text-red-300">
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
        {canWrite && (
          <div className="mt-3 flex gap-2">
            <input
              value={addDoc}
              onChange={(e) => setAddDoc(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void addMember() }}
              placeholder="Doc id to add"
              className="w-[200px] rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/80 placeholder:text-white/30 outline-none"
            />
            <button onClick={addMember} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-black hover:bg-white/90">
              <Plus className="h-3.5 w-3.5" /> Add doc
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-8 text-center text-[12px] text-white/30">Loading board…</div>
      ) : error ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-200">
          {error}{" "}
          <button onClick={load} className="underline underline-offset-4">Try again</button>
        </div>
      ) : (
        <>
          <div className="mb-3 text-[11px] text-white/30">{allRows.length} tasks across {data?.docs.length ?? 0} docs</div>
          <div className="grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2">
            {COLUMNS.map((col) => {
              const inCol = allRows.filter((r) => r.status === col)
              return (
                <div
                  key={col}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const raw = e.dataTransfer.getData("text/plain")
                    if (!raw) return
                    try {
                      const { doc_id, row_id } = JSON.parse(raw) as { doc_id: string; row_id: string }
                      const row = allRows.find((r) => r.id === row_id && r.doc_id === doc_id)
                      if (row) void moveCard(row, col)
                    } catch {}
                  }}
                  className="min-w-[220px] rounded-[14px] border border-line bg-white/[0.02] p-3"
                >
                  <div className="mb-3 flex items-center gap-2 px-1">
                    <span className="text-[12px] font-medium uppercase tracking-wider text-white/60">{col}</span>
                    <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-white/40">{inCol.length}</span>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {inCol.map((r) => (
                      <div
                        key={`${r.doc_id}:${r.id}`}
                        draggable={canWrite && !movingId}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ doc_id: r.doc_id, row_id: r.id }))}
                        className="cursor-grab rounded-[12px] border border-line bg-surface-1 p-4 shadow-sm transition hover:border-white/10 active:cursor-grabbing"
                      >
                        <div className="text-[13.5px] font-medium leading-snug text-white/85">{r.title || "Untitled"}</div>
                        <div className="mt-1 text-[11px] text-white/30">{data?.docs.find((d) => d.doc_id === r.doc_id)?.title ?? r.doc_id}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {r.assignee && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/50">
                              <User className="h-3 w-3" />{r.assignee}
                            </span>
                          )}
                          {r.due && (
                            <span className={`inline-flex items-center gap-1 text-[11px] ${isOverdue(r.due, r.status) ? "font-medium text-red-300" : "text-white/35"}`}>
                              <Calendar className="h-3 w-3" />{new Date(r.due).toLocaleDateString("en-GB")}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {inCol.length === 0 && <div className="py-4 text-center text-[11px] text-white/20">Drop cards here</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

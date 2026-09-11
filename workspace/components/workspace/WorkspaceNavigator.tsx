"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { FileText, Plus, Search, Trash2 } from "lucide-react"
import { collabAuthHeaders } from "@/lib/collabClient"

type DocItem = {
  id: string
  title: string
  updated_at: string | null
  myRole: string
}

export default function WorkspaceNavigator({ currentId }: { currentId: string }) {
  const router = useRouter()
  const [docs, setDocs] = useState<DocItem[]>([])
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch("/api/workspace", { headers: collabAuthHeaders() })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (alive) setDocs(payload?.docs ?? [])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [currentId])

  const createDocument = async () => {
    if (creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...collabAuthHeaders() },
        body: JSON.stringify({ title: "Untitled" }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload.id) router.push(`/workspace/${payload.id}`)
      else setCreateError(response.status === 401 ? "Sign in required" : "Could not create page")
    } catch { setCreateError("Could not create page") }
    setCreating(false)
  }

  const removeDoc = async (event: React.MouseEvent, docId: string) => {
    event.preventDefault()
    event.stopPropagation()
    if (deletingId) return
    setDeletingId(docId)
    try {
      const response = await fetch(`/api/workspace/${docId}`, { method: "DELETE", headers: collabAuthHeaders() })
      if (response.ok) {
        setDocs((prev) => prev.filter((doc) => doc.id !== docId))
        // The active page is gone — back to the list, never a dead doc.
        if (docId === currentId) router.push("/workspace")
      } else {
        setCreateError(response.status === 401 ? "Sign in required" : "Could not delete page")
      }
    } catch {
      setCreateError("Could not delete page")
    }
    setDeletingId(null)
    setConfirmDeleteId(null)
  }

  const filtered = docs.filter((doc) => {
    const needle = query.trim().toLowerCase()
    return !needle || doc.title.toLowerCase().includes(needle) || doc.id.toLowerCase().includes(needle)
  })

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-line bg-black/10 lg:min-h-0 lg:w-[232px] lg:overflow-hidden lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/35">My pages</div>
          <div className="mt-1 text-[12px] text-white/55">Notes, tasks, and ideas</div>
        </div>
        <button
          onClick={createDocument}
          disabled={creating}
          title="Create a new page"
          className="rounded-lg p-1.5 text-white/35 hover:bg-white/[0.06] hover:text-white/80 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <label className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-line bg-white/[0.03] px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-white/25" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a page"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-white/75 outline-none placeholder:text-white/25"
        />
      </label>
      {createError && <div className="mx-3 mb-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">{createError}</div>}
      <nav className="flex max-h-[180px] flex-row gap-1 overflow-x-auto px-3 pb-3 lg:min-h-0 lg:max-h-none lg:flex-col lg:overflow-y-auto lg:pb-4">
        {filtered.map((doc) => (
          <div
            key={doc.id}
            className={`group/navrow flex min-w-[170px] items-center gap-1 rounded-lg px-2.5 py-2 transition lg:min-w-0 ${
              doc.id === currentId ? "bg-white/[0.08] text-white/90" : "text-white/45 hover:bg-white/[0.04] hover:text-white/75"
            }`}
          >
            <Link
              href={`/workspace/${doc.id}`}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span className="min-w-0 flex-1 truncate text-[12px]">{doc.title || doc.id}</span>
              {doc.id === currentId && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/70" />}
            </Link>
            {doc.myRole === "owner" && (
              confirmDeleteId === doc.id ? (
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={(event) => removeDoc(event, doc.id)}
                    disabled={deletingId === doc.id}
                    title="Confirm delete"
                    className="rounded bg-red-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {deletingId === doc.id ? "…" : "Yes"}
                  </button>
                  <button
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setConfirmDeleteId(null)
                    }}
                    title="Cancel"
                    className="rounded px-1 py-0.5 text-[10px] text-white/50 hover:text-white/80"
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setConfirmDeleteId(doc.id)
                  }}
                  title="Delete this page"
                  className="shrink-0 rounded p-1 text-white/25 opacity-0 hover:bg-white/[0.06] hover:text-red-300 focus:opacity-100 group-hover/navrow:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )
            )}
          </div>
        ))}
        {filtered.length === 0 && <div className="px-2.5 py-3 text-[11px] text-white/25">No pages found</div>}
      </nav>
    </aside>
  )
}

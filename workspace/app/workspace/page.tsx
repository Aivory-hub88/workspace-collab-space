"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { clearClientAuthSession, collabAuthHeaders } from "@/lib/collabClient"
import { getMarketingUrl } from "@/lib/config"
import WorkspaceBell from "@/components/workspace/WorkspaceBell"

type DocItem = { id: string; title: string; workspace_id: string; owner: string | null; updated_at: string | null; myRole: string }
type SearchHit = { kind: "doc" | "row"; doc_id: string; doc_title: string; row_id?: string; title: string; snippet: string }

export default function WorkspacePage() {
  const [docs, setDocs] = useState<DocItem[]>([])
  const [trashDocs, setTrashDocs] = useState<DocItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showTrash, setShowTrash] = useState(false)
  const [trashLoading, setTrashLoading] = useState(false)
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const router = useRouter()
  const loginUrl = `${getMarketingUrl()}/login`

  // Unified search (docs + task rows, server-ranked) — debounced.
  useEffect(() => {
    const needle = q.trim()
    if (needle.length < 2) {
      setHits(null)
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/workspace/search?q=${encodeURIComponent(needle)}&limit=8`, { headers: collabAuthHeaders() })
        if (r.ok) {
          const j = await r.json()
          setHits(Array.isArray(j.hits) ? j.hits : [])
        } else {
          setHits(null)
        }
      } catch {
        setHits(null)
      }
      setSearching(false)
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  const goHit = (h: SearchHit) => {
    setHits(null)
    router.push(h.kind === "row" ? `/workspace/${h.doc_id}?view=database` : `/workspace/${h.doc_id}`)
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    setAuthRequired(false)
    try {
      const r = await fetch('/api/workspace', { headers: collabAuthHeaders() })
      if (r.ok) {
        const j = await r.json()
        setDocs(j.docs ?? [])
        setAuthRequired(false)
      } else if (r.status === 401) {
        clearClientAuthSession()
        setAuthRequired(true)
        setError('Your session has expired. Sign in again to continue.')
      } else setError('We could not load your pages. Please try again.')
    } catch { setError('We could not connect to your workspace. Please try again.') }
    setLoading(false)
  }

  const loadTrash = async () => {
    setTrashLoading(true)
    try {
      const r = await fetch('/api/workspace?trash=1', { headers: collabAuthHeaders() })
      if (r.ok) {
        const j = await r.json()
        setTrashDocs(j.docs ?? [])
      }
    } catch {}
    setTrashLoading(false)
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [])
  useEffect(() => { if (showTrash) void loadTrash() }, [showTrash])

  const create = async (asProject = false) => {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const r = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...collabAuthHeaders() },
        body: JSON.stringify({ title: title.trim() || (asProject ? 'Untitled project' : 'Untitled') }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.id) {
        if (asProject) {
          try {
            await fetch(`/api/workspace/${j.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', ...collabAuthHeaders() },
              body: JSON.stringify({ props: { isProject: true, projectDocs: [] } }),
            })
          } catch {}
          router.push(`/workspace/${j.id}?view=board`)
        } else {
          router.push(`/workspace/${j.id}`)
        }
      }
      else if (r.status === 401) {
        setAuthRequired(true)
        setError('Your session has expired. Sign in again to create a page.')
      } else setError(j.error === 'db' ? 'Your page could not be created. Please try again.' : 'Your page could not be created.')
    } catch { setError('We could not connect to your workspace. Please try again.') }
    setCreating(false)
  }

  const removeDoc = async (docId: string) => {
    if (deletingId) return
    setDeletingId(docId)
    try {
      const r = await fetch(`/api/workspace/${docId}`, { method: 'DELETE', headers: collabAuthHeaders() })
      if (r.ok) {
        setDocs((prev) => prev.filter((d) => d.id !== docId))
        if (showTrash) void loadTrash()
      } else {
        setError(r.status === 401 ? 'Your session has expired. Sign in again.' : 'This page could not be deleted.')
      }
    } catch {
      setError('We could not connect to your workspace. Please try again.')
    }
    setDeletingId(null)
    setConfirmDeleteId(null)
  }

  const restoreDoc = async (docId: string) => {
    if (deletingId) return
    setDeletingId(docId)
    try {
      const r = await fetch(`/api/workspace/${docId}`, { method: 'POST', headers: collabAuthHeaders() })
      if (r.ok) {
        setTrashDocs((prev) => prev.filter((d) => d.id !== docId))
        await load()
      } else setError('Could not restore page.')
    } catch { setError('We could not connect to your workspace. Please try again.') }
    setDeletingId(null)
  }

  const hardDeleteDoc = async (docId: string) => {
    if (deletingId) return
    if (!confirm("Permanently delete this page? This cannot be undone.")) return
    setDeletingId(docId)
    try {
      const r = await fetch(`/api/workspace/${docId}?hard=1`, { method: 'DELETE', headers: collabAuthHeaders() })
      if (r.ok) setTrashDocs((prev) => prev.filter((d) => d.id !== docId))
      else setError('Could not permanently delete.')
    } catch { setError('We could not connect to your workspace. Please try again.') }
    setDeletingId(null)
  }

  const filtered = docs.filter((d) => {
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    return (d.title || '').toLowerCase().includes(needle) || d.id.toLowerCase().includes(needle)
  })

  const roleBadge = (role: string) =>
    role === 'owner'
      ? 'bg-emerald-500/15 text-emerald-300'
      : role === 'editor'
        ? 'bg-sky-500/15 text-sky-300'
        : 'bg-amber-500/15 text-amber-300'

  return (
    <div className="flex h-full w-full flex-col bg-surface-1">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-black/10 px-6">
        <span className="shrink-0 text-[13px] font-medium leading-none text-white/80">My workspace</span>
        <div className="relative flex min-w-0 flex-1 items-center justify-end gap-2">
          <WorkspaceBell />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits && hits.length > 0) goHit(hits[0])
              if (e.key === "Escape") setHits(null)
            }}
            placeholder="Search docs & tasks"
            className="hidden w-[160px] rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/80 placeholder:text-white/30 outline-none sm:block"
          />
          {hits !== null && (
            <div className="absolute right-0 top-full z-30 mt-2 w-[320px] rounded-2xl border border-line bg-[#1e1e1c] p-2 shadow-2xl">
              {searching ? (
                <div className="px-3 py-3 text-center text-[12px] text-white/30">Searching…</div>
              ) : hits.length === 0 ? (
                <div className="px-3 py-3 text-center text-[12px] text-white/30">No matches for “{q.trim()}”.</div>
              ) : (
                hits.map((h, i) => (
                  <button
                    key={`${h.kind}:${h.doc_id}:${h.row_id ?? ""}:${i}`}
                    onClick={() => goHit(h)}
                    className="w-full rounded-xl px-3 py-2 text-left hover:bg-white/[0.06]"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${h.kind === "row" ? "bg-sky-500/15 text-sky-300" : "bg-white/[0.08] text-white/60"}`}>
                        {h.kind === "row" ? "task" : "page"}
                      </span>
                      <span className="truncate text-[12px] font-medium text-white/80">{h.title}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-white/35">{h.doc_title}{h.snippet && h.snippet !== h.title ? ` · ${h.snippet}` : ""}</div>
                  </button>
                ))
              )}
            </div>
          )}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create() }}
            placeholder="Page title"
            className="w-[140px] rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/80 placeholder:text-white/30 outline-none sm:w-[180px]"
          />
          <button onClick={() => create()} disabled={creating} className="shrink-0 rounded-full bg-white px-4 py-1.5 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-50">
             {creating ? 'Creating…' : 'New page'}
          </button>
          <button onClick={() => create(true)} disabled={creating} title="Create a project board across docs" className="shrink-0 rounded-full border border-line bg-white/[0.04] px-4 py-1.5 text-[12px] font-medium text-white/70 hover:bg-white/[0.08] hover:text-white disabled:opacity-50">
             New project
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[860px] flex-1 overflow-y-auto bg-black/10 px-8 py-8">
        <div className="mb-4 flex items-center gap-2">
          <button onClick={() => setShowTrash(false)} className={`rounded-full px-3 py-1.5 text-[12px] ${!showTrash ? "bg-white text-black" : "bg-white/[0.06] text-white/50"}`}>Pages</button>
          <button onClick={() => setShowTrash(true)} className={`rounded-full px-3 py-1.5 text-[12px] ${showTrash ? "bg-white text-black" : "bg-white/[0.06] text-white/50"}`}>Trash {trashDocs.length ? `· ${trashDocs.length}` : ""}</button>
        </div>
        {!showTrash ? (
        <div className="rounded-[16px] border border-line bg-white/[0.03] p-6">
           <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-white/80">Your pages</h2>
             <span className="text-[11px] text-white/30">{loading ? 'loading…' : `${filtered.length} of ${docs.length}`}</span>
            </div>

           {error && (
             <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-200">
               <span>{error}</span>
               {authRequired ? (
                 <a href={loginUrl} className="rounded-full bg-white px-3 py-1.5 text-[11px] font-medium text-black">Sign in</a>
               ) : (
                 <button onClick={load} className="rounded-full border border-white/20 px-3 py-1.5 text-[11px] text-white/75 hover:bg-white/[0.08]">Try again</button>
               )}
             </div>
           )}

           {loading ? (
            <div className="py-8 text-center text-[12px] text-white/30">Loading…</div>
          ) : docs.length === 0 ? (
            <div className="py-8 text-center">
               <div className="text-[13px] text-white/40">Nothing here yet</div>
               <div className="mt-2 text-[11px] text-white/25">Create a page for a note, task list, or idea.</div>
              <div className="mt-4 flex justify-center">
                 <button onClick={() => create()} className="rounded-full bg-white px-4 py-2 text-[12px] font-medium text-black">Create your first page</button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-white/30">No documents match “{q.trim()}”.</div>
            ) : (
            <div className="flex flex-col gap-1">
              {filtered.map((d) => (
                <div
                  key={d.id}
                  className="group flex items-center justify-between rounded-xl border border-transparent bg-white/[0.02] px-4 py-3 hover:border-line hover:bg-white/[0.04]"
                >
                  <Link href={`/workspace/${d.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-white/80">{d.title || d.id}</div>
                    <div className="mt-0.5 text-[11px] text-white/30">
                      {d.updated_at ? new Date(d.updated_at).toLocaleDateString() : '—'}
                    </div>
                  </Link>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-wider ${roleBadge(d.myRole)}`}>
                      {d.myRole}
                    </span>
                    {d.myRole === 'owner' && (
                      confirmDeleteId === d.id ? (
                        <span className="flex items-center gap-1">
                          <button
                            onClick={() => removeDoc(d.id)}
                            disabled={deletingId === d.id}
                            className="rounded-full bg-red-500/90 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-red-500 disabled:opacity-50"
                          >
                            {deletingId === d.id ? '…' : 'Move to trash'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-full px-2 py-1 text-[10px] text-white/50 hover:text-white/80"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(d.id)}
                          title="Move to trash"
                          className="rounded-full p-1.5 text-white/25 opacity-0 hover:bg-white/[0.06] hover:text-red-300 focus:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        ) : (
        <div className="rounded-[16px] border border-line bg-white/[0.03] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[13px] font-medium text-white/80">Trash</h2>
            <span className="text-[11px] text-white/30">{trashLoading ? 'loading…' : `${trashDocs.length} items`}</span>
          </div>
          {trashDocs.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-white/30">Trash is empty.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {trashDocs.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-xl border border-line bg-white/[0.02] px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-white/60">{d.title || d.id}</div>
                    <div className="mt-0.5 text-[11px] text-white/25">{d.updated_at ? new Date(d.updated_at).toLocaleDateString() : '—'} · {d.myRole}</div>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-1.5">
                    <button onClick={() => restoreDoc(d.id)} disabled={deletingId === d.id} className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black hover:bg-white/90 disabled:opacity-40">Restore</button>
                    <button onClick={() => hardDeleteDoc(d.id)} disabled={deletingId === d.id} className="rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-500/15 disabled:opacity-40">Delete forever</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  )
}

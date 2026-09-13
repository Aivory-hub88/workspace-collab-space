"use client"

import { useParams, useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import WorkspaceEditor from "@/components/workspace/WorkspaceEditor"
import WorkspaceDatabase from "@/components/workspace/WorkspaceDatabase"
import ProjectBoard from "@/components/workspace/ProjectBoard"
import WorkspaceProperties, { type DocTag, type DocProps } from "@/components/workspace/WorkspaceProperties"
import WorkspaceBacklinks from "@/components/workspace/WorkspaceBacklinks"
import WorkspacePageComments from "@/components/workspace/WorkspacePageComments"
import WorkspaceHistory from "@/components/workspace/WorkspaceHistory"
import SharingPanel from "@/components/workspace/SharingPanel"
import WorkspaceNavigator from "@/components/workspace/WorkspaceNavigator"
import { clearClientAuthSession, collabAuthHeaders } from "@/lib/collabClient"
import { getMarketingUrl } from "@/lib/config"
import { parseMarkdown, type ImportedBlock } from "@/lib/markdownImport"
import { useWorkspaceContext } from "@/contexts/WorkspaceContext"
import { Share2, Star, Trash2, Download, FileDown, Presentation, Upload } from "lucide-react"

type Meta = {
  id: string
  workspace_id: string
  owner: string | null
  ownerEmail: string | null
  ownerName: string | null
  title: string
  mode: "page"
  favorite: boolean
  icon: string | null
  cover_url: string | null
  tags: DocTag[]
  props: DocProps
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
  myRole: string | null
  myRequest: { id: string; status: string; role_requested: string } | null
}

export default function WorkspaceDocPage() {
  const params = useParams()
  const search = useSearchParams()
  const router = useRouter()
  const id = (params?.id as string) ?? "demo"
  const view = search.get("view") === "database" ? "database" : search.get("view") === "board" ? "board" : "page"

  const [meta, setMeta] = useState<Meta | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'locked' | 'unauth'>('loading')
  const [reqRole, setReqRole] = useState<'viewer' | 'editor'>('viewer')
  const [reqMsg, setReqMsg] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showSharing, setShowSharing] = useState(false)
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [aiDocText, setAiDocText] = useState("")
  const [showExport, setShowExport] = useState(false)
  const [present, setPresent] = useState(false)
  // Markdown import plumbing: the editor registers its importer once live.
  const importFnRef = useRef<((blocks: ImportedBlock[]) => number) | null>(null)
  const importFileRef = useRef<HTMLInputElement | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const handleImportFile = async (f: File | undefined) => {
    if (!f || !canWrite) return
    setImportMsg(null)
    try {
      const text = await f.text()
      const blocks = parseMarkdown(text).slice(0, 500)
      if (blocks.length === 0) {
        setImportMsg("No importable content found.")
        return
      }
      const fn = importFnRef.current
      if (!fn) {
        setImportMsg("Editor is still loading — try again in a moment.")
        return
      }
      const n = fn(blocks)
      setImportMsg(`Imported ${n} block${n === 1 ? "" : "s"} from ${f.name}.`)
    } catch {
      setImportMsg("Could not read that file.")
    }
  }
  const loginUrl = `${getMarketingUrl()}/login`
  const { setActiveWorkspaceId } = useWorkspaceContext()

  const loadMeta = async () => {
    try {
      const r = await fetch(`/api/workspace/${id}/meta`, { headers: collabAuthHeaders() })
       if (r.status === 401) { clearClientAuthSession(); setStatus('unauth'); return }
      if (r.status === 403) { setStatus('locked');
        const j = await r.json().catch(()=>({}))
        // try to still get owner info via 403 body? fallback
        return
      }
      if (r.ok) {
        const j = (await r.json()) as Meta
        // Pre-migration servers omit favorite/tags/props/icon — default, never crash.
        setMeta({
          ...j,
          mode: "page",
          favorite: (j as Meta).favorite === true,
          icon: typeof (j as Meta).icon === "string" && (j as Meta).icon ? (j as Meta).icon : null,
          cover_url: typeof (j as Meta).cover_url === "string" && (j as Meta).cover_url ? (j as Meta).cover_url : null,
          tags: Array.isArray((j as Meta).tags) ? (j as Meta).tags : [],
          props: (j as Meta).props && typeof (j as Meta).props === "object" ? (j as Meta).props : {},
          created_at: (j as Meta).created_at ?? null,
          updated_at: (j as Meta).updated_at ?? null,
          deleted_at: (j as Meta).deleted_at ?? null,
        })
        setStatus('ok')
      } else setStatus('locked')
    } catch { setStatus('locked') }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadMeta() }, [id])

  useEffect(() => {
    if (status === 'ok') setActiveWorkspaceId(id)
  }, [id, setActiveWorkspaceId, status])

  // for locked, fetch owner info via separate? meta already 403, so need owner via other means
  // we show generic locked; request access still works
  const requestAccess = async () => {
    setReqMsg(null)
    const r = await fetch(`/api/workspace/${id}/request-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...collabAuthHeaders() },
      body: JSON.stringify({ role: reqRole }),
    })
    const j = await r.json().catch(()=>({}))
    if (r.ok) { setReqMsg('Request sent — owner will review'); loadMeta() }
    else setReqMsg(j.error ?? 'failed')
  }

  if (status === 'loading') {
    return <div className="flex h-full items-center justify-center bg-surface-1 text-[13px] text-white/30">Loading…</div>
  }
  if (status === 'unauth') {
    return (
      <div className="flex h-full w-full flex-col bg-surface-1">
        <div className="flex h-12 items-center border-b border-line px-6 text-[13px] text-white/40">Workspace / {id}</div>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-[520px] rounded-2xl border border-line bg-white/[0.03] p-8 text-center">
            <div className="text-[15px] font-medium text-white/80">Sign in required</div>
            <div className="mt-2 text-[13px] leading-relaxed text-white/40">Please sign in to view this workspace document.</div>
            <a href={loginUrl} className="mt-6 inline-block rounded-full bg-white px-5 py-2 text-[13px] font-medium text-black">Go to login</a>
          </div>
        </div>
      </div>
    )
  }
  if (status === 'locked') {
    const pending = meta?.myRequest?.status === 'pending'
    return (
      <div className="flex h-full w-full flex-col bg-surface-1">
        <div className="flex h-12 items-center justify-between border-b border-line px-6">
          <div className="flex items-center gap-2">
            <Link href="/workspace" className="text-[13px] text-white/40 hover:text-white/70">Workspace</Link>
            <span className="text-white/20">/</span>
            <span className="text-[13px] font-medium text-white/80">{id}</span>
          </div>
          <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-300">No access</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-8">
          <div className="w-full max-w-[520px] rounded-2xl border border-line bg-white/[0.03] p-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-300">◨</div>
            <div className="mt-3 text-[15px] font-medium text-white/80">You don’t have access to this doc</div>
            <div className="mt-2 text-[13px] leading-relaxed text-white/40">
              {meta?.ownerEmail ? <>Owner: <span className="text-white/70">{meta.ownerName ?? meta.ownerEmail}</span> — request access below</> : 'Ask the owner to invite you, or request access.'}
            </div>
            {pending ? (
              <div className="mt-6 rounded-xl bg-amber-500/10 px-4 py-3 text-[12px] text-amber-200">Request pending — {meta?.myRequest?.role_requested} access awaiting approval</div>
            ) : (
              <div className="mt-6 flex items-center justify-center gap-2">
                <select value={reqRole} onChange={e=>setReqRole(e.target.value as any)} className="rounded-full border border-line bg-white/[0.04] px-3 py-2 text-[12px] text-white/70">
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                </select>
                <button onClick={requestAccess} className="rounded-full bg-white px-5 py-2 text-[13px] font-medium text-black hover:bg-white/90">Request access</button>
              </div>
            )}
            {reqMsg && <div className="mt-3 text-[11px] text-white/50">{reqMsg}</div>}
            <div className="mt-6">
              <Link href="/workspace" className="text-[12px] text-white/30 underline-offset-4 hover:underline">← Back to workspace</Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const isOwner = meta?.myRole === 'owner'
  const canWrite = meta?.myRole === 'owner' || meta?.myRole === 'editor'
  const isTrashed = !!meta?.deleted_at
  const isProject = meta?.props?.isProject === true
  const projectMembers = Array.isArray(meta?.props?.projectDocs)
    ? (meta?.props?.projectDocs as string[]).filter((m) => typeof m === "string")
    : []

  const saveProjectMembers = async (next: string[]): Promise<boolean> => {
    if (!canWrite) return false
    try {
      const r = await fetch(`/api/workspace/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...collabAuthHeaders() },
        body: JSON.stringify({ props: { isProject: true, projectDocs: next.slice(0, 50) } }),
      })
      if (!r.ok) return false
      const j = await r.json().catch(() => ({}))
      setMeta((m) => (m ? { ...m, props: { ...(m.props ?? {}), ...(j.props ?? { isProject: true, projectDocs: next }) } } : m))
      return true
    } catch {
      return false
    }
  }

  const flagAsProject = async () => {
    if (!canWrite || busy) return
    setBusy(true)
    await saveProjectMembers(projectMembers)
    setBusy(false)
  }

  const saveTitle = async () => {
    const t = titleDraft.trim()
    if (!t || busy) { setEditingTitle(false); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/workspace/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...collabAuthHeaders() },
        body: JSON.stringify({ title: t }),
      })
      if (r.ok) {
        const j = await r.json()
        setMeta((m) => (m ? { ...m, title: j.title } : m))
      }
    } catch {}
    setBusy(false)
    setEditingTitle(false)
  }

  const focusBigTitle = () => {
    if (!canWrite) return
    setTitleDraft(meta?.title ?? id)
    setEditingTitle(true)
    setTimeout(() => document.getElementById("aivory-big-title")?.focus(), 10)
  }

  const toggleFavorite = async () => {
    if (!canWrite || busy || !meta) return
    const next = !meta.favorite
    setMeta({ ...meta, favorite: next })
    try {
      const r = await fetch(`/api/workspace/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...collabAuthHeaders() },
        body: JSON.stringify({ favorite: next }),
      })
      if (!r.ok) setMeta((m) => (m ? { ...m, favorite: !next } : m))
    } catch {
      setMeta((m) => (m ? { ...m, favorite: !next } : m))
    }
  }

  const patchMeta = async (patch: { tags?: DocTag[]; props?: DocProps; icon?: string | null }) => {
    if (!canWrite) return
    const prev = meta
    if (patch.tags) setMeta((m) => (m ? { ...m, tags: patch.tags! } : m))
    if (patch.props) setMeta((m) => (m ? { ...m, props: { ...(m?.props ?? {}), ...patch.props } as DocProps } : m))
    if (patch.icon !== undefined) setMeta((m) => (m ? { ...m, icon: patch.icon ?? null } : m))
    try {
      const r = await fetch(`/api/workspace/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...collabAuthHeaders() },
        body: JSON.stringify(patch),
      })
      if (!r.ok) {
        const body = await r.text().catch(() => "")
        console.error(`[workspace patch failed] PATCH /api/workspace/${id} → ${r.status} ${body.slice(0, 300)}`)
        setMeta(prev)
        return
      }
      // Reconcile with merged server truth (props come back merged via ||).
      const j = await r.json().catch(() => ({}))
      setMeta((m) => {
        if (!m) return m
        const next = { ...m }
        if (j.tags !== undefined) next.tags = j.tags
        if (j.props !== undefined) next.props = { ...(m.props ?? {}), ...j.props }
        if (j.icon !== undefined) next.icon = j.icon
        return next
      })
    } catch (e) {
      console.error(`[workspace patch failed] PATCH /api/workspace/${id} threw`, e)
      setMeta(prev)
    }
  }

  const removeDoc = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch(`/api/workspace/${id}`, { method: 'DELETE', headers: collabAuthHeaders() })
      if (r.ok) router.push('/workspace')
    } catch {}
    setBusy(false)
    setConfirmDelete(false)
  }

  const restoreDoc = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch(`/api/workspace/${id}`, { method: 'POST', headers: collabAuthHeaders() })
      if (r.ok) {
        const j = await r.json().catch(() => ({}))
        void j
        await loadMeta()
      }
    } catch {}
    setBusy(false)
  }

  return (
    <div className="flex h-full w-full flex-col bg-surface-1">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-black/10 px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/workspace" className="shrink-0 text-[13px] text-white/40 hover:text-white/70">
            Workspace
          </Link>
          <span className="shrink-0 text-white/20">/</span>
          {view === "page" ? (
            // Write view: the Big Title above the editor is the rename surface
            // (single PATCH path); the breadcrumb just jumps to it.
            <button
              onClick={focusBigTitle}
              title={canWrite ? "Rename" : undefined}
              className={`truncate text-[13px] font-medium text-white/80 ${canWrite ? "hover:text-white" : ""}`}
            >
              {meta?.title ?? id}
            </button>
          ) : editingTitle ? (
            <input
              value={titleDraft}
              autoFocus
              disabled={busy}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
              className="w-[220px] rounded-lg border border-line bg-white/[0.04] px-2 py-1 text-[13px] text-white/85 outline-none"
            />
          ) : (
            <button
              onClick={() => { if (canWrite) { setTitleDraft(meta?.title ?? id); setEditingTitle(true) } }}
              title={canWrite ? "Rename" : undefined}
              className={`truncate text-[13px] font-medium text-white/80 ${canWrite ? "hover:text-white" : ""}`}
            >
              {meta?.title ?? id}
            </button>
          )}
          <span className="ml-1 shrink-0 rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-white/40">{meta?.myRole}</span>
           {!canWrite && <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-300">view only</span>}
           <div className="ml-3 flex shrink-0 items-center gap-1 rounded-full bg-white/[0.04] p-1">
            <Link
              href={`/workspace/${id}`}
              className={`rounded-full px-3 py-1 text-[12px] ${view === "page" ? "bg-white text-black" : "text-white/40 hover:text-white/70"}`}
            >
               Write
            </Link>
            <Link
              href={`/workspace/${id}?view=database`}
              className={`rounded-full px-3 py-1 text-[12px] ${view === "database" ? "bg-white text-black" : "text-white/40 hover:text-white/70"}`}
            >
               Data
            </Link>
            {isProject && (
              <Link
                href={`/workspace/${id}?view=board`}
                className={`rounded-full px-3 py-1 text-[12px] ${view === "board" ? "bg-white text-black" : "text-white/40 hover:text-white/70"}`}
              >
                 Board
              </Link>
            )}
          </div>
         </div>
          <div className="flex shrink-0 items-center gap-2">

            {view === "page" && canWrite && (
              <>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".md,.markdown,text/markdown"
                  className="hidden"
                  onChange={(e) => {
                    void handleImportFile(e.target.files?.[0])
                    e.target.value = ""
                  }}
                />
                <button
                  onClick={() => importFileRef.current?.click()}
                  title="Import Markdown file"
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] text-white/35 hover:bg-white/[0.06] hover:text-white/80"
                >
                  <Upload className="h-3.5 w-3.5" /> Import
                </button>
              </>
            )}
            <div className="relative">
              <button
                onClick={() => setShowExport((v) => !v)}
                title="Export"
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] ${showExport ? "bg-white/[0.1] text-white/85" : "text-white/35 hover:bg-white/[0.06] hover:text-white/80"}`}
              >
                <Download className="h-3.5 w-3.5" /> Export
              </button>
              {showExport && (
                <div className="absolute right-0 top-full z-20 mt-2 w-[200px] rounded-2xl border border-line bg-[#1e1e1c] p-2 shadow-2xl">
                  <button
                    onClick={() => {
                      const md = `# ${meta?.title ?? "Untitled"}\n\n${aiDocText || "_No content yet_"}\n\n---\nTags: ${(meta?.tags ?? []).map((t) => t.label).join(", ") || "—"}\n`
                      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement("a")
                      a.href = url
                      a.download = `${(meta?.title ?? id).replace(/[^a-z0-9-_ ]/gi, "_")}.md`
                      a.click()
                      URL.revokeObjectURL(url)
                      setShowExport(false)
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] text-white/70 hover:bg-white/[0.06] hover:text-white"
                  >
                    <FileDown className="h-3.5 w-3.5" /> Markdown (.md)
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const { default: jsPDF } = await import("jspdf")
                        const doc = new jsPDF({ unit: "pt", format: "a4" })
                        const title = meta?.title ?? "Untitled"
                        const margin = 40
                        let y = margin
                        doc.setFontSize(18)
                        doc.text(title, margin, y)
                        y += 18
                        if (meta?.icon) { doc.setFontSize(22); doc.text(meta.icon, margin, y); y += 20 }
                        doc.setFontSize(10)
                        doc.setTextColor(110)
                        const lines: string[] = doc.splitTextToSize(aiDocText || "No content yet.", 515)
                        for (const line of lines.slice(0, 80)) {
                          if (y > 800) { doc.addPage(); y = margin }
                          doc.text(line, margin, y)
                          y += 13
                        }
                        doc.save(`${title.replace(/[^a-z0-9-_ ]/gi, "_")}.pdf`)
                      } catch (e) { console.error(e) }
                      setShowExport(false)
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] text-white/70 hover:bg-white/[0.06] hover:text-white"
                  >
                    <FileDown className="h-3.5 w-3.5" /> PDF (.pdf)
                  </button>
                  <button
                    onClick={() => { setPresent(true); setShowExport(false) }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] text-white/70 hover:bg-white/[0.06] hover:text-white"
                  >
                    <Presentation className="h-3.5 w-3.5" /> Present
                  </button>
                </div>
              )}
            </div>
            {canWrite && (
              <button
                onClick={toggleFavorite}
                title={meta?.favorite ? "Unstar" : "Star"}
                className={`rounded-full p-2 ${meta?.favorite ? "text-amber-300" : "text-white/35 hover:bg-white/[0.06] hover:text-white/80"}`}
              >
                <Star className={`h-3.5 w-3.5 ${meta?.favorite ? "fill-current" : ""}`} />
              </button>
            )}
            <button
             onClick={() => setShowSharing((open) => !open)}
             aria-expanded={showSharing}
             className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] ${showSharing ? "bg-white/[0.1] text-white/85" : "text-white/40 hover:bg-white/[0.06] hover:text-white/80"}`}
           >
             <Share2 className="h-3.5 w-3.5" />
             Share
           </button>
           {isOwner && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)} title="Delete this page" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-white/35 hover:bg-white/[0.06] hover:text-red-300">
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}
          {isOwner && confirmDelete && (
            <>
              <span className="text-[12px] text-white/50">Delete this doc?</span>
              <button onClick={removeDoc} disabled={busy} className="rounded-full bg-red-500/90 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-500 disabled:opacity-50">
                Confirm
              </button>
              <button onClick={() => setConfirmDelete(false)} className="rounded-full px-3 py-1.5 text-[12px] text-white/50 hover:text-white/80">
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
      {isTrashed && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-500/10 px-6 py-3 text-[12px] text-amber-200">
          <span>This page is in trash — it’s hidden from the list until restored.</span>
          <span className="flex items-center gap-2">
            <button onClick={restoreDoc} disabled={busy} className="rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-50">Restore</button>
            <Link href="/workspace" className="text-[11px] text-amber-200/70 underline">Back to workspace</Link>
          </span>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <WorkspaceNavigator currentId={id} />
        <div className="min-w-0 flex-1 overflow-y-auto bg-black/10 px-8 py-8 lg:px-10 xl:px-12">
          {view === "page" && (
            <>
              {meta?.cover_url && (
                <div className="mx-auto mb-3 w-full max-w-[960px] overflow-hidden rounded-2xl border border-line">
                  <img src={meta.cover_url} alt="Cover" className="h-[200px] w-full object-cover" />
                </div>
              )}
              {canWrite && meta?.cover_url && (
                <div className="mx-auto mb-3 flex w-full max-w-[960px] items-center gap-2">
                  <button
                    onClick={async () => {
                      try {
                        const r = await fetch(`/api/workspace/${id}/cover`, { method: "DELETE", headers: collabAuthHeaders() })
                        if (r.ok) setMeta((m) => (m ? { ...m, cover_url: null } : m))
                      } catch {}
                    }}
                    className="rounded-full border border-line bg-white/[0.04] px-3 py-1 text-[11px] text-white/40 hover:bg-white/[0.08]"
                  >
                    Remove cover
                  </button>
                </div>
              )}
              <div className="mx-auto mb-2 w-full max-w-[960px]">
                <div className="flex items-start gap-3">
                  <div className="shrink-0">
                    {meta?.icon ? (
                      <button onClick={() => canWrite && setShowIconPicker((v) => !v)} title={canWrite ? "Change icon" : undefined} className="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-white/[0.04] text-[26px] hover:bg-white/[0.08]">
                        {meta.icon}
                      </button>
                    ) : canWrite ? (
                      <button onClick={() => setShowIconPicker((v) => !v)} title="Add icon" className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-white/15 text-white/30 hover:bg-white/[0.04] hover:text-white/60">
                        🙂
                      </button>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    {editingTitle ? (
                      <input
                        id="aivory-big-title"
                        value={titleDraft}
                        autoFocus
                        disabled={busy}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onBlur={saveTitle}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveTitle()
                          if (e.key === 'Escape') setEditingTitle(false)
                        }}
                        placeholder="Untitled"
                        className="w-full bg-transparent text-[32px] font-bold leading-tight text-white/90 outline-none placeholder:text-white/20"
                      />
                    ) : canWrite ? (
                      <button onClick={focusBigTitle} title="Rename" className="block w-full truncate text-left text-[32px] font-bold leading-tight text-white/90 hover:text-white">
                        {meta?.title || "Untitled"}
                      </button>
                    ) : (
                      <div className="truncate text-[32px] font-bold leading-tight text-white/90">{meta?.title || "Untitled"}</div>
                    )}
                  </div>
                </div>
                {showIconPicker && canWrite && (
                  <div className="mt-3 flex flex-wrap gap-1.5 rounded-2xl border border-line bg-[#1e1e1c] p-3">
                    {["📄","✨","📌","🔥","💡","📚","🎯","🚀","🧠","💼","🌟","📝","🗂️","🔖","✅","❌"].map((emoji) => (
                      <button key={emoji} onClick={() => { patchMeta({ icon: emoji }); setShowIconPicker(false) }} className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent bg-white/[0.04] text-[20px] hover:bg-white/[0.08]">
                        {emoji}
                      </button>
                    ))}
                    <button onClick={() => { patchMeta({ icon: null }); setShowIconPicker(false) }} className="rounded-full border border-line bg-white/[0.04] px-3 py-1 text-[11px] text-white/50 hover:bg-white/[0.08]">Remove</button>
                  </div>
                )}
              </div>
              <div className="mx-auto mb-4 w-full max-w-[960px]">
                <WorkspaceProperties
                  docId={id}
                  tags={meta?.tags ?? []}
                  props={meta?.props ?? {}}
                  createdAt={meta?.created_at ?? null}
                  updatedAt={meta?.updated_at ?? null}
                  ownerName={meta?.ownerName ?? null}
                  ownerEmail={meta?.ownerEmail ?? null}
                  canWrite={canWrite}
                  onPatch={patchMeta}
                  collapsible={view === "page"}
                  defaultCollapsed={false}
                />
              </div>
            </>
          )}

          {view === "board" ? (
            isProject ? (
              <ProjectBoard
                projectId={id}
                members={projectMembers}
                canWrite={canWrite}
                onMembersChange={saveProjectMembers}
              />
            ) : (
              <div className="mx-auto w-full max-w-[960px] rounded-2xl border border-line bg-white/[0.03] p-8 text-center">
                <div className="text-[15px] font-medium text-white/80">Not a project yet</div>
                <div className="mt-2 text-[13px] leading-relaxed text-white/40">
                  Flag this doc as a project to union task boards across member docs.
                </div>
                {canWrite ? (
                  <button onClick={flagAsProject} disabled={busy} className="mt-6 rounded-full bg-white px-5 py-2 text-[13px] font-medium text-black hover:bg-white/90 disabled:opacity-50">
                    {busy ? "Saving…" : "Flag as project"}
                  </button>
                ) : (
                  <div className="mt-4 text-[12px] text-white/30">Ask an editor to flag it.</div>
                )}
              </div>
            )
          ) : view === "database" ? (
            <WorkspaceDatabase docId={id} readOnly={!canWrite} />
          ) : (
            <>
              {importMsg && (
                <div className="mx-auto mb-4 w-full max-w-[960px] rounded-xl border border-line bg-white/[0.04] px-4 py-2.5 text-[12px] text-white/60">
                  {importMsg}
                </div>
              )}
              <WorkspaceEditor docId={id} readOnly={!canWrite} onTextChange={setAiDocText} registerImport={(fn) => { importFnRef.current = fn }} />
            </>
          )}
          {view === "page" && (
            <>
              <div className="mx-auto mt-4 w-full max-w-[960px]">
                <WorkspaceBacklinks docId={id} canWrite={canWrite} defaultCollapsed={false} />
              </div>
              <div className="mx-auto mt-4 w-full max-w-[960px]">
                <WorkspacePageComments docId={id} canWrite={canWrite} defaultCollapsed={false} />
              </div>
              <div className="mx-auto mt-4 w-full max-w-[960px]">
                <WorkspaceHistory docId={id} canWrite={canWrite} defaultCollapsed={false} />
              </div>
            </>
          )}
          {!canWrite && (
            <div className="mx-auto mt-6 max-w-[720px] rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-200">
              You have viewer access — this document is read-only.
            </div>
          )}
        </div>
        {showSharing && (
          <div className="w-full shrink-0 overflow-y-auto border-t border-line p-4 lg:w-[360px] lg:max-w-[360px] lg:border-l lg:border-t-0">
            <SharingPanel docId={id} isOwner={!!isOwner} />
            {meta?.ownerEmail && (
              <div className="mt-3 text-[11px] text-white/30">Owner: {meta.ownerName ?? meta.ownerEmail}</div>
            )}
          </div>
        )}
      </div>
      {present && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#0f0f0e] p-8">
          <div className="mx-auto flex w-full max-w-[860px] items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-white/30">Present — {meta?.title ?? id}</span>
            <button onClick={() => setPresent(false)} className="rounded-full bg-white px-4 py-2 text-[12px] font-medium text-black">Exit</button>
          </div>
          <div className="mx-auto mt-8 w-full max-w-[720px] flex-1 overflow-y-auto">
            <div className="text-[40px] font-bold leading-tight text-white/90">{meta?.icon ? `${meta.icon} ` : ""}{meta?.title ?? "Untitled"}</div>
            <div className="mt-6 whitespace-pre-wrap text-[16px] leading-relaxed text-white/70">{aiDocText || "No content yet."}</div>
            {(meta?.tags ?? []).length > 0 && <div className="mt-6 flex flex-wrap gap-1.5">{(meta?.tags ?? []).map((t) => <span key={t.id} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/50">{t.label}</span>)}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

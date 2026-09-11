"use client"

import { useEffect, useState } from "react"
import { Clock, RotateCcw, History, LoaderCircle } from "lucide-react"
import { collabAuthHeaders } from "@/lib/collabClient"
import WorkspaceCollapsible from "./WorkspaceCollapsible"

type Hist = { id: string; doc_id: string; bytes: number; actor_id: string | null; created_at: string }

export default function WorkspaceHistory({ docId, canWrite, defaultCollapsed = false }: { docId: string; canWrite: boolean; defaultCollapsed?: boolean }) {
  const [items, setItems] = useState<Hist[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/workspace/${docId}/history`, { headers: collabAuthHeaders() })
      if (r.ok) {
        const j = await r.json()
        setItems(j.history ?? [])
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => { void load() }, [docId])

  const restore = async (hid: string) => {
    if (!canWrite || restoring) return
    if (!confirm("Restore this version? Current content will be replaced.")) return
    setRestoring(hid)
    try {
      const r = await fetch(`/api/workspace/${docId}/history/${hid}`, { method: "POST", headers: collabAuthHeaders() })
      if (r.ok) {
        // Force reload to re-fetch Yjs update from pg/collab
        window.location.reload()
      }
    } catch {}
    setRestoring(null)
  }

  const snapshotNow = async () => {
    try {
      await fetch(`/api/workspace/${docId}/history`, { method: "POST", headers: collabAuthHeaders() })
      await load()
    } catch {}
  }

  return (
    <WorkspaceCollapsible
      title="History"
      icon={<History className="h-3.5 w-3.5" />}
      summary={`· ${items.length} versions · auto every 60s`}
      defaultCollapsed={defaultCollapsed}
      right={canWrite ? (
        <button onClick={(e) => { e.stopPropagation(); void snapshotNow() }} className="rounded-full border border-line bg-white/[0.04] px-3 py-1 text-[11px] text-white/50 hover:bg-white/[0.08]">Snapshot now</button>
      ) : undefined}
    >
      {loading ? (
        <div className="text-[11px] text-white/25">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-6 text-center text-[11px] text-white/25">No history yet — edits are snapshotted automatically.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {items.map((h) => (
            <div key={h.id} className="flex items-center justify-between rounded-xl border border-line bg-white/[0.03] px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] text-white/50">
                <Clock className="h-3 w-3" />
                {new Date(h.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                <span className="text-white/25">· {h.bytes} bytes</span>
                {h.actor_id && <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/40">{h.actor_id.slice(0, 8)}</span>}
              </div>
              {canWrite && (
                <button
                  onClick={() => restore(String(h.id))}
                  disabled={restoring === String(h.id)}
                  className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black hover:bg-white/90 disabled:opacity-40"
                >
                  {restoring === String(h.id) ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Restore
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </WorkspaceCollapsible>
  )
}

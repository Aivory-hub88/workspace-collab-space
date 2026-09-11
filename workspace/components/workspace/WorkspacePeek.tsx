"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { collabAuthHeaders } from "@/lib/collabClient"

export function PeekableDocLink({ docId, children, className }: { docId: string; children: React.ReactNode; className?: string }) {
  const [peek, setPeek] = useState<{ title: string; updated_at: string | null; ownerName: string | null } | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    fetch(`/api/workspace/${docId}/meta`, { headers: collabAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return
        if (j) setPeek({ title: j.title ?? docId, updated_at: j.updated_at ?? null, ownerName: j.ownerName ?? j.ownerEmail ?? null })
        setLoading(false)
      })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open, docId])

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Link href={`/workspace/${docId}`} className={className}>
        {children}
      </Link>
      {open && (
        <span className="absolute left-0 top-full z-20 mt-2 w-[280px] rounded-xl border border-line bg-[#1e1e1c] p-3 shadow-2xl">
          {loading ? (
            <span className="text-[11px] text-white/30">Loading…</span>
          ) : peek ? (
            <>
              <div className="truncate text-[12px] font-medium text-white/80">{peek.title || docId}</div>
              <div className="mt-1 text-[11px] text-white/30">
                {peek.updated_at ? new Date(peek.updated_at).toLocaleDateString() : "—"}
                {peek.ownerName ? ` · ${peek.ownerName}` : ""}
              </div>
              <div className="mt-2 text-[11px] text-violet-300/70">Click to open →</div>
            </>
          ) : (
            <span className="text-[11px] text-white/30">No preview</span>
          )}
        </span>
      )}
    </span>
  )
}

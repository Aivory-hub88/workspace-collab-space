"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell } from "lucide-react"
import { collabAuthHeaders } from "@/lib/collabClient"

type Mention = {
  id: number
  doc_id: string
  row_id: string | null
  actor_type: string
  actor_id: string | null
  actor_name: string | null
  mentioned_kind: string
  mentioned_id: string
  source: string
  excerpt: string
  created_at: string
}

/** Notification bell: unread @mentions of the current user, with mark-read. */
export default function WorkspaceBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<Mention[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (withItems: boolean) => {
    try {
      const r = await fetch("/api/workspace/notifications", { headers: collabAuthHeaders() })
      if (!r.ok) return
      const j = await r.json()
      setUnread(j.unread ?? 0)
      if (withItems) setItems(j.mentions ?? [])
    } catch {}
  }, [])

  useEffect(() => {
    void refresh(false)
    const t = setInterval(() => {
      if (!document.hidden) void refresh(open)
    }, 60000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next) {
      setLoading(true)
      await refresh(true)
      setLoading(false)
    }
  }

  const markRead = async () => {
    try {
      const r = await fetch("/api/workspace/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...collabAuthHeaders() },
        body: JSON.stringify({ markRead: true }),
      })
      if (r.ok) {
        setUnread(0)
        setItems([])
      }
    } catch {}
  }

  const openMention = (m: Mention) => {
    setOpen(false)
    router.push(`/workspace/${m.doc_id}`)
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={toggle}
        title="Notifications"
        aria-expanded={open}
        className={`relative rounded-full p-2 ${open ? "bg-white/[0.1] text-white/85" : "text-white/40 hover:bg-white/[0.06] hover:text-white/80"}`}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-black">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[340px] rounded-2xl border border-line bg-[#1e1e1c] p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[12px] font-medium text-white/70">Mentions · {unread} unread</span>
            {unread > 0 && (
              <button onClick={markRead} className="text-[11px] text-white/40 underline-offset-4 hover:text-white/70 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {loading ? (
            <div className="py-6 text-center text-[12px] text-white/30">Loading…</div>
          ) : items.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-white/30">No unread mentions.</div>
          ) : (
            <div className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto">
              {items.map((m) => (
                <button
                  key={m.id}
                  onClick={() => openMention(m)}
                  className="rounded-xl border border-line bg-white/[0.03] px-3 py-2.5 text-left hover:bg-white/[0.06]"
                >
                  <div className="text-[12px] text-white/80">
                    <span className="font-medium">{m.actor_name || m.actor_id || "Someone"}</span>
                    <span className="text-white/40"> mentioned you{m.row_id ? " on a task" : ""} · {m.doc_id}</span>
                  </div>
                  {m.excerpt && <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-white/50">“{m.excerpt}”</div>}
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-white/25">
                    {new Date(m.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

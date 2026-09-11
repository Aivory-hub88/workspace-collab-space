"use client"

import { useEffect, useRef, useState } from "react"
import * as Y from "yjs"
import { WebsocketProvider } from "y-websocket"
import { MessageCircle, Send, Trash2 } from "lucide-react"
import { collabAuthHeaders, collabWsParams, collabWsUrl } from "@/lib/collabClient"
import WorkspaceCollapsible from "./WorkspaceCollapsible"

type PageComment = { id: string; text: string; author: string; at: string }

function uid() {
  return Math.random().toString(36).slice(2, 8)
}

export default function WorkspacePageComments({ docId, canWrite, defaultCollapsed = false }: { docId: string; canWrite: boolean; defaultCollapsed?: boolean }) {
  const docRef = useRef<Y.Doc | null>(null)
  const yCommentsRef = useRef<Y.Array<Y.Map<unknown>> | null>(null)
  const [comments, setComments] = useState<PageComment[]>([])
  const [draft, setDraft] = useState("")
  const [ready, setReady] = useState(false)

  const canWriteRef = useRef(canWrite)
  useEffect(() => { canWriteRef.current = canWrite }, [canWrite])

  useEffect(() => {
    const doc = new Y.Doc()
    const yComments = doc.getArray<Y.Map<unknown>>("page-comments")
    docRef.current = doc
    yCommentsRef.current = yComments
    let alive = true

    const toComments = (): PageComment[] =>
      yComments.toArray().map((m) => ({
        id: (m.get("id") as string) ?? uid(),
        text: (m.get("text") as string) ?? "",
        author: (m.get("author") as string) ?? "Unknown",
        at: (m.get("at") as string) ?? new Date().toISOString(),
      }))

    const obs = () => {
      if (!alive) return
      setComments(toComments())
    }
    yComments.observe(obs)

    // Use same room as page doc so comments co-locate with page (single doc per page)
    // The editor also uses workspace:${docId}; sharing the same Yjs room means comments
    // land in the same `yjs_update` blob (pg-backed) and sync live.
    fetch(`/api/workspace/${docId}/doc`, { headers: collabAuthHeaders() })
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => {
        if (!alive) return
        if (buf && buf.byteLength > 0) {
          try { Y.applyUpdate(doc, new Uint8Array(buf)) } catch {}
        }
        setComments(toComments())
        setReady(true)
      })
      .catch(() => { if (alive) { setComments(toComments()); setReady(true) } })

    // Also hook websocket for live sync (same room as editor)
    let provider: WebsocketProvider | null = null
    try {
      const wsUrl = collabWsUrl()
      provider = new WebsocketProvider(wsUrl, `workspace:${docId}`, doc, { connect: true, params: collabWsParams() })
    } catch {}

    // Persist comments back to pg whenever they change (debounced via editor's own PUT? we do our own)
    let putTimer: ReturnType<typeof setTimeout> | null = null
    const schedulePut = () => {
      if (canWriteRef.current === false) return
      if (putTimer) clearTimeout(putTimer)
      putTimer = setTimeout(() => {
        const upd = Y.encodeStateAsUpdate(doc)
        fetch(`/api/workspace/${docId}/doc`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", ...collabAuthHeaders() }, body: upd as unknown as BodyInit }).catch(() => {})
      }, 600)
    }
    const putObs = () => { if (alive) schedulePut() }
    yComments.observe(putObs)

    return () => {
      alive = false
      if (putTimer) clearTimeout(putTimer)
      yComments.unobserve(obs)
      yComments.unobserve(putObs)
      provider?.destroy()
      doc.destroy()
    }
  }, [docId])

  const add = () => {
    const text = draft.trim().slice(0, 800)
    if (!text || !canWrite) return
    const yComments = yCommentsRef.current
    const doc = docRef.current
    if (!yComments || !doc) return
    const author = (typeof window !== "undefined" ? localStorage.getItem("workspace:userId") || localStorage.getItem("workspace:agentType") || "You" : "You") as string
    const m = new Y.Map<unknown>()
    m.set("id", `pc-${Date.now().toString(36)}`)
    m.set("text", text)
    m.set("author", author)
    m.set("at", new Date().toISOString())
    doc.transact(() => yComments.push([m]), author)
    setDraft("")
  }

  const remove = (id: string) => {
    const yComments = yCommentsRef.current
    const doc = docRef.current
    if (!yComments || !doc || !canWrite) return
    const idx = yComments.toArray().findIndex((m) => (m.get("id") as string) === id)
    if (idx < 0) return
    doc.transact(() => yComments.delete(idx, 1), "user")
  }

  return (
    <WorkspaceCollapsible
      title="Page comments"
      icon={<MessageCircle className="h-3.5 w-3.5" />}
      summary={`· ${comments.length} · Yjs-native, live`}
      defaultCollapsed={defaultCollapsed}
    >
      {!ready ? (
        <div className="text-[11px] text-white/25">Loading…</div>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-2">
            {comments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 py-6 text-center text-[11px] text-white/25">No comments yet — start the thread.</div>
            ) : (
              comments.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-2 rounded-xl border border-line bg-white/[0.03] px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px] text-white/30">
                      <span className="font-medium text-white/50">{c.author}</span>
                      <span>{new Date(c.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-white/75">{c.text}</div>
                  </div>
                  {canWrite && (
                    <button onClick={() => remove(c.id)} className="shrink-0 rounded-full p-1 text-white/20 hover:bg-white/[0.06] hover:text-white/50">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add() } }}
              placeholder={canWrite ? "Write a comment… (Enter to send)" : "View only"}
              disabled={!canWrite}
              className="flex-1 rounded-full border border-line bg-white/[0.04] px-3 py-2 text-[12px] text-white/80 placeholder:text-white/25 outline-none disabled:opacity-50"
            />
            <button onClick={add} disabled={!draft.trim() || !canWrite} className="inline-flex items-center gap-1 rounded-full bg-white px-4 py-2 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-40">
              <Send className="h-3.5 w-3.5" /> Send
            </button>
          </div>
        </>
      )}
    </WorkspaceCollapsible>
  )
}

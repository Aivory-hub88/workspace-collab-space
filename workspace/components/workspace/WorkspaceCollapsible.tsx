"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ChevronDown, ChevronUp, Minimize2 } from "lucide-react"

/** Shared collapsible shell for all workspace panels (incl. Edgeless canvas space). */
export default function WorkspaceCollapsible({
  title,
  icon,
  summary,
  collapsible = true,
  defaultCollapsed = false,
  right,
  children,
}: {
  title: string
  icon: ReactNode
  summary?: string
  collapsible?: boolean
  defaultCollapsed?: boolean
  right?: ReactNode
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  useEffect(() => {
    setCollapsed(defaultCollapsed)
  }, [defaultCollapsed])

  return (
    <div className="mx-auto w-full max-w-[960px] rounded-2xl border border-line bg-white/[0.025] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={() => collapsible && setCollapsed((v) => !v)}
          className={`flex items-center gap-2 text-[12px] font-medium text-white/50 ${collapsible ? "cursor-pointer hover:text-white/80" : ""}`}
          title={collapsible ? (collapsed ? `Expand ${title}` : `Minimize ${title} — larger canvas`) : undefined}
        >
          {icon} {title}
          {collapsible && (collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
        </button>
        <span className="flex items-center gap-2 text-[11px] text-white/25">
          {summary && <span>{summary}</span>}
          {right}
          {collapsible && !collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              title={`Minimize ${title} — larger canvas`}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/40 hover:bg-white/[0.08] hover:text-white/70"
            >
              <Minimize2 className="h-3 w-3" /> Minimize
            </button>
          )}
          {collapsible && collapsed && (
            <button
              onClick={() => setCollapsed(false)}
              className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-black hover:bg-white/90"
            >
              Expand
            </button>
          )}
        </span>
      </div>
      {!collapsed && <div className="mt-3">{children}</div>}
    </div>
  )
}

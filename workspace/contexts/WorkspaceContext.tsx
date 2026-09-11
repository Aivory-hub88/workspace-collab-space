"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"

const STORAGE_KEY = "workspace:active"
const EVENT_NAME = "workspace:active-change"

type WorkspaceContextValue = {
  activeWorkspaceId: string | null
  setActiveWorkspaceId: (id: string | null) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem(STORAGE_KEY),
  )

  useEffect(() => {
    const onWorkspaceChange = () => setActiveWorkspaceIdState(localStorage.getItem(STORAGE_KEY))
    window.addEventListener(EVENT_NAME, onWorkspaceChange)
    window.addEventListener("storage", onWorkspaceChange)
    return () => {
      window.removeEventListener(EVENT_NAME, onWorkspaceChange)
      window.removeEventListener("storage", onWorkspaceChange)
    }
  }, [])

  const value = useMemo<WorkspaceContextValue>(() => ({
    activeWorkspaceId,
    setActiveWorkspaceId: (id) => {
      setActiveWorkspaceIdState(id)
      if (id) localStorage.setItem(STORAGE_KEY, id)
      else localStorage.removeItem(STORAGE_KEY)
      window.dispatchEvent(new Event(EVENT_NAME))
    },
  }), [activeWorkspaceId])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspaceContext() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error("useWorkspaceContext must be used inside WorkspaceProvider")
  return context
}

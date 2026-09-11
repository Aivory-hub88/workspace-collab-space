import type { Metadata } from "next"
import { WorkspaceProvider } from "@/contexts/WorkspaceContext"
import "@/styles/globals.css"

export const metadata: Metadata = {
  title: "Workspace",
  description: "Project boards, task databases, and agent collaboration rooms",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-screen overflow-hidden bg-[#353531]">
        <WorkspaceProvider>
          <main className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto">{children}</main>
        </WorkspaceProvider>
      </body>
    </html>
  )
}

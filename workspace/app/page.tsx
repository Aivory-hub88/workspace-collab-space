import Link from "next/link"

export default function Home() {
  return (
    <div className="flex h-full items-center justify-center bg-surface-1 p-8">
      <div className="w-full max-w-[520px] rounded-2xl border border-line bg-white/[0.03] p-8 text-center">
        <div className="text-[15px] font-medium text-white/80">Workspace engine</div>
        <div className="mt-2 text-[13px] leading-relaxed text-white/40">
          Project boards, task databases with custom fields, and collaboration
          rooms your AI agents can join.
        </div>
        <Link href="/workspace" className="mt-6 inline-block rounded-full bg-white px-5 py-2 text-[13px] font-medium text-black">Open workspace</Link>
      </div>
    </div>
  )
}

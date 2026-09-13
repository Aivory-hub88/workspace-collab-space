"use client"

import { useEffect, useState } from 'react'
import { collabAuthHeaders } from '@/lib/collabClient'

type AclRow = { user_id: string; role: string; email?: string; full_name?: string }
type AgentRow = { agent_type: string; display_name?: string; role: string; granted_by?: string }
type ReqRow = { id: string; requester_id: string; requester_email?: string; user_email?: string; full_name?: string; role_requested: string; status: string; created_at: string }

const AGENT_OPTIONS = [
  { type: 'autonomous', name: 'Geno' },
  { type: 'customer_service', name: 'Teo' },
  { type: 'leads_qualifier', name: 'Lex' },
  { type: 'finance_invoice_ops', name: 'Finn' },
  { type: 'office_assistant', name: 'Ofira' },
]

export default function SharingPanel({ docId, isOwner }: { docId: string; isOwner: boolean }) {
  const [tab, setTab] = useState<'people' | 'agents'>('people')
  const [acl, setAcl] = useState<AclRow[]>([])
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [requests, setRequests] = useState<ReqRow[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer')
  const [agentType, setAgentType] = useState(AGENT_OPTIONS[0].type)
  const [agentRole, setAgentRole] = useState<'viewer' | 'editor'>('editor')
  const [msg, setMsg] = useState<string | null>(null)

  const load = async () => {
    try {
      const r1 = await fetch(`/api/workspace/${docId}/acl`, { headers: collabAuthHeaders() })
      if (r1.ok) {
        const j = await r1.json()
        setAcl(j.grants ?? [])
      }
    } catch {}
    try {
      const r3 = await fetch(`/api/workspace/${docId}/agents`, { headers: collabAuthHeaders() })
      if (r3.ok) {
        const j = await r3.json()
        setAgents(j.agents ?? [])
      }
    } catch {}
    if (isOwner) {
      try {
        const r2 = await fetch(`/api/workspace/${docId}/requests`, { headers: collabAuthHeaders() })
        if (r2.ok) {
          const j = await r2.json()
          setRequests((j.requests ?? []).filter((x: ReqRow) => x.status === 'pending'))
        }
      } catch {}
    }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [docId])

  const invite = async () => {
    if (!email.trim()) return
    setMsg(null)
    const r = await fetch(`/api/workspace/${docId}/acl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...collabAuthHeaders() },
      body: JSON.stringify({ email: email.trim(), role }),
    })
    const j = await r.json().catch(() => ({}))
    if (r.ok) {
      setMsg(`Invited ${email} as ${role}`)
      setEmail('')
      load()
    } else setMsg(j.error ?? 'failed')
  }

  const inviteAgent = async () => {
    setMsg(null)
    const r = await fetch(`/api/workspace/${docId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...collabAuthHeaders() },
      body: JSON.stringify({ agentType, role: agentRole }),
    })
    const j = await r.json().catch(() => ({}))
    if (r.ok) {
      setMsg(`Invited agent ${agentType} as ${agentRole}`)
      load()
    } else setMsg(j.error ?? 'failed')
  }

  const removeAgent = async (type: string) => {
    const r = await fetch(`/api/workspace/${docId}/agents/${type}`, {
      method: 'DELETE',
      headers: collabAuthHeaders(),
    })
    if (r.ok) load()
  }

  const act = async (reqId: string, action: 'approve' | 'deny') => {
    const r = await fetch(`/api/workspace/${docId}/requests/${reqId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...collabAuthHeaders() },
      body: JSON.stringify({ action }),
    })
    if (r.ok) load()
  }

  const removeGrant = async (userId: string) => {
    const r = await fetch(`/api/workspace/${docId}/acl/${userId}`, {
      method: 'DELETE',
      headers: collabAuthHeaders(),
    })
    if (r.ok) load()
  }

  if (!isOwner) {
    return (
      <div className="rounded-xl bg-white/[0.08] p-4">
        <div className="text-[12px] font-medium text-white/70">Shared with</div>
        <div className="mt-2 text-[12px] text-white/40">
          {acl.length === 0 && agents.length === 0
            ? 'Only owner has access'
            : `${acl.length} collaborator(s)${agents.length ? ` · ${agents.length} agent(s)` : ''}`}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-line bg-white/[0.03] p-4">
       <div className="flex items-center justify-between">
         <div className="text-[13px] font-medium text-white/80">Share this page</div>
         <div className="flex items-center gap-1 rounded-full bg-white/[0.04] p-1">
           <button
             onClick={() => setTab('people')}
             className={`rounded-full px-3 py-1 text-[12px] ${tab === 'people' ? 'bg-white text-black' : 'text-white/40 hover:text-white/70'}`}
           >
             People
           </button>
           <button
             onClick={() => setTab('agents')}
             className={`rounded-full px-3 py-1 text-[12px] ${tab === 'agents' ? 'bg-white text-black' : 'text-white/40 hover:text-white/70'}`}
           >
             Agents{agents.length ? ` · ${agents.length}` : ''}
           </button>
         </div>
       </div>
      {tab === 'people' ? (
      <>
      <div className="mt-3 flex flex-col gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') invite() }}
          placeholder="email@aivory.id"
          className="w-full rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/80 placeholder:text-white/30 outline-none"
        />
        <div className="flex gap-2">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as any)}
            className="flex-1 rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/70"
          >
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
          </select>
          <button onClick={invite} className="flex-1 rounded-full bg-white px-4 py-1.5 text-[12px] font-medium text-black hover:bg-white/90">
            Invite
          </button>
        </div>
      </div>
      {msg && <div className="mt-2 text-[11px] text-white/50">{msg}</div>}

      <div className="mt-4">
        <div className="text-[11px] font-medium uppercase tracking-wider text-white/30">Access</div>
        <div className="mt-2 flex flex-col gap-1">
          {acl.length === 0 ? (
            <div className="text-[12px] text-white/30">No additional collaborators</div>
          ) : (
            acl.map((a) => (
              <div key={a.user_id} className="group flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-3 py-2">
                <span className="min-w-0 truncate text-[12px] text-white/70">{a.email ?? a.user_id}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">{a.role}</span>
                  <button
                    onClick={() => removeGrant(a.user_id)}
                    title="Remove access"
                    className="rounded px-1 text-[12px] text-white/20 opacity-0 hover:text-red-300 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {requests.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-white/30">Requests</div>
          <div className="mt-2 flex flex-col gap-1">
            {requests.map((rq) => (
              <div key={rq.id} className="flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
                <span className="text-[12px] text-white/80">
                  {rq.user_email ?? rq.requester_email ?? rq.requester_id} wants {rq.role_requested}
                </span>
                <span className="flex gap-1">
                  <button onClick={() => act(rq.id, 'approve')} className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black">Approve</button>
                  <button onClick={() => act(rq.id, 'deny')} className="rounded-full border border-white/20 px-3 py-1 text-[11px] text-white/70">Deny</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      </>
      ) : (
      <>
      <div className="mt-1 text-[12px] leading-relaxed text-white/35">
        Invite a Cerveau agent to this room. Editors can create/edit tasks,
        viewers read only. Revoking cuts access immediately.
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex flex-col gap-2">
          <select
            value={agentType}
            onChange={(e) => setAgentType(e.target.value)}
            className="w-full rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/70"
          >
            {AGENT_OPTIONS.map((a) => (
              <option key={a.type} value={a.type}>{a.name} · {a.type}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <select
              value={agentRole}
              onChange={(e) => setAgentRole(e.target.value as any)}
              className="flex-1 rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/70"
            >
              <option value="editor">editor</option>
              <option value="viewer">viewer</option>
            </select>
            <button onClick={inviteAgent} className="shrink-0 rounded-full bg-white px-4 py-1.5 text-[12px] font-medium text-black hover:bg-white/90">
              Invite
            </button>
          </div>
        </div>
      </div>
      {msg && <div className="mt-2 text-[11px] text-white/50">{msg}</div>}

      <div className="mt-4">
        <div className="text-[11px] font-medium uppercase tracking-wider text-white/30">Agents in this room</div>
        <div className="mt-2 flex flex-col gap-1">
          {agents.length === 0 ? (
            <div className="text-[12px] text-white/30">No agents invited yet</div>
          ) : (
            agents.map((a) => (
              <div key={a.agent_type} className="group flex items-center justify-between gap-2 rounded-lg bg-violet-500/[0.07] px-3 py-2">
                <span className="min-w-0 truncate text-[12px] text-white/70">
                  {a.display_name ?? a.agent_type}
                  <span className="ml-1.5 text-white/25">{a.agent_type}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">{a.role}</span>
                  <button
                    onClick={() => removeAgent(a.agent_type)}
                    title="Revoke agent access"
                    className="rounded px-1 text-[12px] text-white/20 opacity-0 hover:text-red-300 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
      </>
      )}
    </div>
  )
}

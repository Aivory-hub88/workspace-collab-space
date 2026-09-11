import { query } from '@/lib/db'
import type { WorkspaceCredential } from '@/lib/workspaceAuth'

export type DocRole = 'owner' | 'editor' | 'viewer' | null

/** Cerveau agent types that can be invited to a doc (Fase 1 Opsi C). */
export const KNOWN_AGENT_TYPES = [
  'autonomous',
  'customer_service',
  'leads_qualifier',
  'finance_invoice_ops',
  'office_assistant',
] as const

export type KnownAgentType = (typeof KNOWN_AGENT_TYPES)[number]

export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  autonomous: 'Geno',
  customer_service: 'Teo',
  leads_qualifier: 'Lex',
  finance_invoice_ops: 'Finn',
  office_assistant: 'Ofira',
}

export function isKnownAgentType(v: unknown): v is KnownAgentType {
  return typeof v === 'string' && (KNOWN_AGENT_TYPES as readonly string[]).includes(v)
}

/** Role granted to an agent on a doc, or null when not invited / revoked. */
export async function getAgentDocRole(docId: string, agentType: string): Promise<DocRole> {
  if (!isKnownAgentType(agentType)) return null
  try {
    const r = await query(
      'SELECT role FROM dashboard.workspace_agent_acl WHERE doc_id = $1 AND agent_type = $2',
      [docId, agentType],
    )
    const role = r.rows[0]?.role as string | undefined
    if (role === 'editor' || role === 'viewer') return role
    return null
  } catch {
    return null
  }
}

/**
 * Owner-or-admin gate shared by the acl + agents management routes.
 * Mirrors the closed-by-default model: service creds and admins bypass,
 * otherwise only the doc owner may manage grants.
 */
export async function canManageDoc(docId: string, accountType?: string, userId?: string): Promise<boolean> {
  if (accountType === 'admin' || accountType === 'superadmin') return true
  if (!userId) return false
  try {
    const r = await query(
      `SELECT 1 FROM dashboard.workspace_docs WHERE (id = $1 OR id = $2) AND owner = $3`,
      [`workspace:${docId}`, docId, userId],
    )
    return (r.rowCount ?? 0) > 0
  } catch {
    return false
  }
}

export async function getDocRole(
  cred: WorkspaceCredential,
  docId: string,
): Promise<DocRole> {
  if (cred.kind === 'service') return 'owner'
  const userId = cred.user.user_id
  if (cred.user.account_type === 'admin' || cred.user.account_type === 'superadmin') return 'owner'
  const roomKey = `workspace:${docId}`
  const rows = await query(
    'SELECT id, owner, workspace_id FROM dashboard.workspace_docs WHERE id = $1 OR id = $2',
    [roomKey, docId],
  )
  const row = rows.rows.find((r: any) => r.id === roomKey) ?? rows.rows[0]
  if (!row) return 'editor' // new doc claimable
  if (row.owner === userId) return 'owner'
  if (!row.owner) return 'editor' // ownerless claimable
  const workspaceId: string = row.workspace_id || 'default'
  // doc ACL wins
  const acl = await query(
    'SELECT role FROM dashboard.workspace_doc_acl WHERE doc_id = $1 AND user_id = $2',
    [docId, userId],
  )
  if (acl.rows.length > 0) {
    const r = acl.rows[0].role as string
    if (r === 'editor' || r === 'viewer' || r === 'owner') return r as DocRole
  }
  const mem = await query(
    'SELECT role FROM dashboard.workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  )
  if (mem.rows.length > 0) {
    const r = mem.rows[0].role as string
    if (r === 'owner' || r === 'editor') return 'editor'
    if (r === 'viewer') return 'viewer'
  }
  return null
}

export function canRead(role: DocRole): boolean {
  return role !== null
}
export function canWrite(role: DocRole): boolean {
  return role === 'owner' || role === 'editor'
}

/**
 * Agent gate for service-credential calls (Cerveau → dashboard → collab).
 * Client-asserted agent types are only meaningful with a service credential;
 * user credentials and unasserted service calls keep legacy behavior (null =
 * allowed, enforcement happens in getDocRole / collab as before).
 * Returns 'forbidden' when an invited-and-checked agent lacks the access.
 */
export async function checkAgentAccess(
  docId: string,
  cred: WorkspaceCredential,
  agentType: string | null | undefined,
  need: 'read' | 'write',
): Promise<null | 'forbidden'> {
  if (cred.kind !== 'service' || !isKnownAgentType(agentType)) return null
  const role = await getAgentDocRole(docId, agentType)
  if (need === 'write' ? !canWrite(role) : !canRead(role)) return 'forbidden'
  return null
}

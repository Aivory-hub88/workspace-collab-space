/**
 * Route-level tests for the agent-invite API (Fase 1 Opsi C).
 * DB + serverAuth are mocked: no Postgres, no real session needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { queryMock, authUser } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  authUser: { current: null as null | { user: { user_id: string; account_type: string; email: string }; token: string } },
}))

vi.mock('@/lib/db', () => ({ query: queryMock }))

vi.mock('@/lib/authProvider', () => ({
  getAuthUserWithToken: () => authUser.current,
}))

import { GET, POST } from './route'
import { isKnownAgentType, AGENT_DISPLAY_NAMES } from '@/lib/workspaceAccess'

process.env.COLLAB_SERVICE_TOKEN = 'test-service-token'

const svc = { 'x-service-token': 'test-service-token' }

function postReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/workspace/doc-1/agents', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function getReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/workspace/doc-1/agents', { headers })
}

function ownerDb() {
  queryMock.mockImplementation((sql: string) => {
    if (typeof sql === 'string' && sql.includes('FROM dashboard.workspace_agent_acl')) {
      return Promise.resolve({ rows: [], rowCount: 0 })
    }
    if (typeof sql === 'string' && sql.includes('FROM dashboard.workspace_docs')) {
      return Promise.resolve({ rows: [{ owner: 'owner-1', workspace_id: 'default' }], rowCount: 1 })
    }
    return Promise.resolve({ rows: [], rowCount: 1 })
  })
}

beforeEach(() => {
  queryMock.mockReset()
  authUser.current = null
  ownerDb()
})

describe('agent type registry', () => {
  it('accepts the 5 Cerveau types and rejects anything else', () => {
    for (const t of ['autonomous', 'customer_service', 'leads_qualifier', 'finance_invoice_ops', 'office_assistant']) {
      expect(isKnownAgentType(t)).toBe(true)
    }
    expect(isKnownAgentType('user')).toBe(false)
    expect(isKnownAgentType('gpt-4')).toBe(false)
    expect(isKnownAgentType(undefined)).toBe(false)
  })

  it('has a display name for every known type', () => {
    for (const t of ['autonomous', 'customer_service', 'leads_qualifier', 'finance_invoice_ops', 'office_assistant']) {
      expect(AGENT_DISPLAY_NAMES[t]).toBeTruthy()
    }
  })
})

describe('POST /api/workspace/[id]/agents', () => {
  it('returns 401 with no credential at all', async () => {
    const res = await POST(postReq({ agentType: 'leads_qualifier', role: 'editor' }), {
      params: Promise.resolve({ id: 'doc-1' }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects unknown agentType with 400', async () => {
    const res = await POST(postReq({ agentType: 'clippy', role: 'editor' }, svc), {
      params: Promise.resolve({ id: 'doc-1' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/unknown agentType/)
  })

  it('rejects invalid role with 400', async () => {
    const res = await POST(postReq({ agentType: 'leads_qualifier', role: 'owner' }, svc), {
      params: Promise.resolve({ id: 'doc-1' }),
    })
    expect(res.status).toBe(400)
  })

  it('invites a known agent and writes the ACL row', async () => {
    const res = await POST(postReq({ agentType: 'leads_qualifier', role: 'editor' }, svc), {
      params: Promise.resolve({ id: 'doc-1' }),
    })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j).toMatchObject({ doc_id: 'doc-1', agent_type: 'leads_qualifier', role: 'editor' })
    const insert = queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO dashboard.workspace_agent_acl'))
    expect(insert).toBeTruthy()
    expect(insert?.[1]).toEqual(['doc-1', 'leads_qualifier', 'editor', undefined])
  })

  it('denies a non-owner user with 403', async () => {
    authUser.current = {
      user: { user_id: 'intruder', account_type: 'member', email: 'x@aivory.id' },
      token: 'user-token',
    }
    queryMock.mockImplementation((sql: string) => {
      // No row where this user is owner → canManageDoc denies.
      if (typeof sql === 'string' && sql.includes('FROM dashboard.workspace_docs')) {
        return Promise.resolve({ rows: [], rowCount: 0 })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    })
    const res = await POST(postReq({ agentType: 'leads_qualifier', role: 'editor' }), {
      params: Promise.resolve({ id: 'doc-1' }),
    })
    expect(res.status).toBe(403)
  })

  it('lets the doc owner invite via user session', async () => {
    authUser.current = {
      user: { user_id: 'owner-1', account_type: 'member', email: 'owner@aivory.id' },
      token: 'user-token',
    }
    const res = await POST(postReq({ agentType: 'office_assistant', role: 'viewer' }), {
      params: Promise.resolve({ id: 'doc-1' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ agent_type: 'office_assistant', role: 'viewer' })
  })
})

describe('GET /api/workspace/[id]/agents', () => {
  it('lists invited agents with display names', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('FROM dashboard.workspace_agent_acl')) {
        return Promise.resolve({
          rows: [{ doc_id: 'doc-1', agent_type: 'leads_qualifier', role: 'editor', granted_by: 'owner-1' }],
          rowCount: 1,
        })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    })
    const res = await GET(getReq(svc), { params: Promise.resolve({ id: 'doc-1' }) })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.agents).toHaveLength(1)
    expect(j.agents[0]).toMatchObject({ agent_type: 'leads_qualifier', display_name: 'Lex' })
  })
})

/**
 * Route-level tests for unified search (Fase 4c): trigram title matches,
 * decoded row matches, per-doc read gates, empty query short-circuit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as Y from 'yjs'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('@/lib/db', () => ({ query: queryMock }))

vi.mock('@/lib/authProvider', () => ({ getAuthUserWithToken: () => null }))

import { GET } from './route'

process.env.COLLAB_SERVICE_TOKEN = 'test-service-token'

const svc = { 'x-service-token': 'test-service-token', 'x-agent-type': 'leads_qualifier' }

function rowsBytes(): Buffer {
  const doc = new Y.Doc()
  const arr = doc.getArray<Y.Map<unknown>>('database')
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    m.set('id', 'r0')
    m.set('title', 'Ship the launch checklist')
    m.set('status', 'Todo')
    m.set('priority', 'High')
    m.set('assignee', '')
    m.set('due', '')
    m.set('description', 'coordinate with marketing')
    m.set('comments', [])
    m.set('cells', {})
    arr.push([m])
  })
  return Buffer.from(Y.encodeStateAsUpdate(doc))
}

beforeEach(() => {
  queryMock.mockReset()
  queryMock.mockImplementation((sql: string, params: unknown[]) => {
    if (sql.includes('similarity(title')) {
      return Promise.resolve({
        rows: [
          { id: 'workspace:doc-launch', title: 'Product Launch Plan' },
          { id: 'workspace:doc-private', title: 'Launch Secrets' },
        ],
      })
    }
    if (sql.includes('SELECT id, yjs_update')) {
      return Promise.resolve({ rows: [{ id: 'workspace:doc-launch', yjs_update: rowsBytes() }] })
    }
    if (sql.includes('SELECT props')) {
      return Promise.resolve({ rows: [{ props: {} }] })
    }
    // Agent granted on doc-launch only — doc-private must be filtered out.
    if (sql.includes('FROM dashboard.workspace_agent_acl')) {
      const granted = (params[0] as string) === 'doc-launch'
      return Promise.resolve(granted ? { rows: [{ role: 'editor' }] } : { rows: [] })
    }
    if (sql.includes('FROM dashboard.workspace_docs')) {
      return Promise.resolve({ rows: [{ id: 'workspace:doc-launch', owner: 'owner-1', workspace_id: 'default' }] })
    }
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }),
  )
})

describe('GET /api/workspace/search', () => {
  it('returns docs and rows ranked title-first', async () => {
    const req = new NextRequest('http://localhost/api/workspace/search?q=launch&limit=10', { headers: svc })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.q).toBe('launch')
    expect(j.semantic).toBe(false)
    const kinds = j.hits.map((h: { kind: string }) => h.kind)
    expect(kinds[0]).toBe('doc')
    expect(kinds).toContain('row')
    expect(j.hits.every((h: { doc_id: string }) => h.doc_id !== 'doc-private')).toBe(true)
  })

  it('short-circuits empty queries', async () => {
    const req = new NextRequest('http://localhost/api/workspace/search?q=a', { headers: svc })
    const res = await GET(req)
    expect((await res.json()).hits).toEqual([])
    expect(queryMock).not.toHaveBeenCalled()
  })
})

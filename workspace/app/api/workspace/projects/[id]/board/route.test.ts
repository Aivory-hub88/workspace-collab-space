/**
 * Route-level tests for the project board aggregate (Fase 2 F2-3).
 * Collab is mocked down (fetch → 404) so the pg-fallback path is exercised;
 * per-doc read gates are verified via an agent with a single grant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as Y from 'yjs'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('@/lib/db', () => ({ query: queryMock }))

vi.mock('@/lib/authProvider', () => ({ getAuthUserWithToken: () => null }))

import { GET } from './route'

process.env.COLLAB_SERVICE_TOKEN = 'test-service-token'

const svc = { 'x-service-token': 'test-service-token' }
const svcAgent = { ...svc, 'x-agent-type': 'leads_qualifier' }

function dbBytes(rows: Array<{ id: string; title: string; status: string }>): Buffer {
  const doc = new Y.Doc()
  const arr = doc.getArray<Y.Map<unknown>>('database')
  doc.transact(() => {
    for (const r of rows) {
      const m = new Y.Map<unknown>()
      m.set('id', r.id)
      m.set('title', r.title)
      m.set('status', r.status)
      m.set('priority', 'Med')
      m.set('assignee', '')
      m.set('due', '')
      m.set('description', '')
      m.set('comments', [])
      arr.push([m])
    }
  })
  return Buffer.from(Y.encodeStateAsUpdate(doc))
}

const BYTES_A = dbBytes([
  { id: 'ra1', title: 'Task A1', status: 'Todo' },
  { id: 'ra2', title: 'Task A2', status: 'Doing' },
])
const BYTES_B = dbBytes([{ id: 'rb1', title: 'Task B1', status: 'Done' }])

function baseQuery(sql: string, params: unknown[]) {
  const p0 = params[0] as string
  if (sql.includes('SELECT id, title, props, workspace_id')) {
    return Promise.resolve({
      rows: [
        {
          id: 'workspace:proj-1',
          title: 'Project One',
          props: { isProject: true, projectDocs: ['doc-a', 'doc-b', 'doc-private'] },
          workspace_id: 'default',
        },
      ],
    })
  }
  if (sql.includes('SELECT id, title') && sql.includes('ANY')) {
    return Promise.resolve({
      rows: [
        { id: 'workspace:doc-a', title: 'Doc A' },
        { id: 'workspace:doc-b', title: 'Doc B' },
      ],
    })
  }
  if (sql.includes('SELECT id, yjs_update')) {
    const map: Record<string, Buffer> = { 'workspace:doc-a': BYTES_A, 'workspace:doc-b': BYTES_B }
    const bytes = map[p0]
    return Promise.resolve(bytes ? { rows: [{ id: p0, yjs_update: bytes }] } : { rows: [] })
  }
  if (sql.includes('SELECT props')) {
    return Promise.resolve({ rows: [{ props: {} }] })
  }
  if (sql.includes('workspace_agent_acl')) {
    const [docId, agentType] = params as string[]
    // agent granted on the project + doc-a only
    if (agentType === 'leads_qualifier' && (docId === 'proj-1' || docId === 'doc-a')) {
      return Promise.resolve({ rows: [{ role: 'editor' }] })
    }
    return Promise.resolve({ rows: [] })
  }
  return Promise.resolve({ rows: [], rowCount: 0 })
}

beforeEach(() => {
  queryMock.mockReset()
  queryMock.mockImplementation(baseQuery)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }),
  )
})

function getReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/workspace/projects/proj-1/board', { headers })
}

describe('GET /api/workspace/projects/[id]/board', () => {
  it('returns 401 without credential', async () => {
    const res = await GET(getReq(), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(401)
  })

  it('unions member databases with doc ids attached', async () => {
    const res = await GET(getReq(svc), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.project_id).toBe('proj-1')
    expect(j.room).toBe('workspace:room:proj-1')
    expect(j.totalRows).toBe(3)
    const allIds = j.docs.flatMap((d: { rows: { id: string }[] }) => d.rows.map((r) => r.id)).sort()
    expect(allIds).toEqual(['ra1', 'ra2', 'rb1'])
    const docIds = new Set(j.docs.flatMap((d: { rows: { doc_id: string }[] }) => d.rows.map((r) => r.doc_id)))
    expect(docIds).toEqual(new Set(['doc-a', 'doc-b']))
  })

  it('skips member docs the agent cannot read', async () => {
    const res = await GET(getReq(svcAgent), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.docs.map((d: { doc_id: string }) => d.doc_id)).toEqual(['doc-a'])
    expect(j.totalRows).toBe(2)
  })

  it('returns 404 for a doc that is not flagged as a project', async () => {
    queryMock.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('SELECT id, title, props, workspace_id')) {
        return Promise.resolve({ rows: [{ id: 'workspace:plain', title: 'Plain', props: {}, workspace_id: 'default' }] })
      }
      return baseQuery(sql, params)
    })
    const res = await GET(getReq(svc), { params: Promise.resolve({ id: 'plain' }) })
    expect(res.status).toBe(404)
  })
})

describe('project self-inclusion', () => {
  it('includes the project doc when pinned as its own member', async () => {
    // member rows for solo: reuse doc-a bytes via param remap
    queryMock.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('SELECT id, title, props, workspace_id')) {
        return Promise.resolve({
          rows: [
            {
              id: 'workspace:solo',
              title: 'Solo Project',
              props: { isProject: true, projectDocs: ['solo'] },
              workspace_id: 'default',
            },
          ],
        })
      }
      if (sql.includes('SELECT id, yjs_update') && (params[0] as string).endsWith('solo')) {
        return Promise.resolve({ rows: [{ id: 'workspace:solo', yjs_update: BYTES_A }] })
      }
      if (sql.includes('SELECT id, title') && sql.includes('ANY')) {
        return Promise.resolve({ rows: [{ id: 'workspace:solo', title: 'Solo Project' }] })
      }
      return baseQuery(sql, params)
    })
    const res = await GET(getReq(svc), { params: Promise.resolve({ id: 'solo' }) })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.docs.map((d: { doc_id: string }) => d.doc_id)).toEqual(['solo'])
    expect(j.totalRows).toBe(2)
  })
})

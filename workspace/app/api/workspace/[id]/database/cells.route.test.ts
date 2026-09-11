/**
 * Route-level tests for custom-field cells (Fase 3b): POST stores validated
 * cells, PATCH merges them without clobbering sibling fields.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as Y from 'yjs'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('@/lib/db', () => ({ query: queryMock }))

vi.mock('@/lib/authProvider', () => ({ getAuthUserWithToken: () => null }))

import { POST } from './route'
import { PATCH } from './[rowId]/route'

process.env.COLLAB_SERVICE_TOKEN = 'test-service-token'

const svc = { 'x-service-token': 'test-service-token' }
const DEFS = [
  { id: 'f-team', name: 'Team', type: 'select', options: ['A', 'B'] },
  { id: 'f-tags', name: 'Tags', type: 'multi', options: ['x', 'y'] },
]

function dbBytes(): Buffer {
  const doc = new Y.Doc()
  const arr = doc.getArray<Y.Map<unknown>>('database')
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    m.set('id', 'r0')
    m.set('title', 'Card')
    m.set('status', 'Todo')
    m.set('priority', 'Med')
    m.set('assignee', '')
    m.set('due', '')
    m.set('description', '')
    m.set('comments', [])
    m.set('cells', { 'f-team': 'A' })
    arr.push([m])
  })
  return Buffer.from(Y.encodeStateAsUpdate(doc))
}

beforeEach(() => {
  queryMock.mockReset()
  queryMock.mockImplementation((sql: string) => {
    if (sql.includes('SELECT id, yjs_update')) {
      return Promise.resolve({ rows: [{ id: 'workspace:doc-1', yjs_update: dbBytes() }] })
    }
    if (sql.includes('SELECT props')) {
      return Promise.resolve({ rows: [{ props: { dbFields: DEFS } }] })
    }
    if (sql.includes('SELECT workspace_id')) {
      return Promise.resolve({ rows: [] })
    }
    return Promise.resolve({ rows: [], rowCount: 1 })
  })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: { method?: string }) =>
      init?.method === 'PUT'
        ? Promise.resolve({ ok: true, status: 200 })
        : Promise.resolve({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }),
    ),
  )
})

describe('custom cells REST round-trip', () => {
  it('POST stores validated cells, dropping off-option values', async () => {
    const req = new NextRequest('http://localhost/api/workspace/doc-1/database', {
      method: 'POST',
      body: JSON.stringify({
        title: 'With cells',
        cells: { 'f-team': 'B', 'f-tags': ['x', 'zzz'], ghost: 1 },
      }),
      headers: { 'Content-Type': 'application/json', ...svc },
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'doc-1' }) })
    expect(res.status).toBe(201)
    expect((await res.json()).row.cells).toEqual({ 'f-team': 'B', 'f-tags': ['x'] })
  })

  it('PATCH merges cells without clobbering siblings', async () => {
    const req = new NextRequest('http://localhost/api/workspace/doc-1/database/r0', {
      method: 'PATCH',
      body: JSON.stringify({ cells: { 'f-tags': ['y'] } }),
      headers: { 'Content-Type': 'application/json', ...svc },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'doc-1', rowId: 'r0' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).cells).toEqual({ 'f-team': 'A', 'f-tags': ['y'] })
  })
})

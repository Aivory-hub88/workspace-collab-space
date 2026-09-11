/**
 * Route-level tests for WIP enforcement (Fase 2 F2-4) on the database
 * collection route. Collab mocked down → pg path with Yjs-built rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as Y from 'yjs'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('@/lib/db', () => ({ query: queryMock }))

vi.mock('@/lib/authProvider', () => ({ getAuthUserWithToken: () => null }))

import { POST } from './route'

process.env.COLLAB_SERVICE_TOKEN = 'test-service-token'

const svc = { 'x-service-token': 'test-service-token' }

function dbBytes(statuses: string[]): Buffer {
  const doc = new Y.Doc()
  const arr = doc.getArray<Y.Map<unknown>>('database')
  doc.transact(() => {
    statuses.forEach((status, i) => {
      const m = new Y.Map<unknown>()
      m.set('id', `r${i}`)
      m.set('title', `Task ${i}`)
      m.set('status', status)
      m.set('priority', 'Med')
      m.set('assignee', '')
      m.set('due', '')
      m.set('description', '')
      m.set('comments', [])
      arr.push([m])
    })
  })
  return Buffer.from(Y.encodeStateAsUpdate(doc))
}

beforeEach(() => {
  queryMock.mockReset()
  queryMock.mockImplementation((sql: string) => {
    if (sql.includes('SELECT id, yjs_update')) {
      return Promise.resolve({ rows: [{ id: 'workspace:doc-1', yjs_update: dbBytes(['Todo']) }] })
    }
    if (sql.includes('SELECT props')) {
      return Promise.resolve({ rows: [{ props: { dbWip: { Todo: 1 } } }] })
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

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/workspace/doc-1/database', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...svc },
  })
}

describe('POST /api/workspace/[id]/database WIP gate', () => {
  it('rejects creating into a full column with 409', async () => {
    const res = await POST(postReq({ title: 'Overflow', status: 'Todo' }), {
      params: Promise.resolve({ id: 'doc-1' }),
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('wip-exceeded')
  })

  it('allows creating into a column with headroom', async () => {
    const res = await POST(postReq({ title: 'Fine', status: 'Doing' }), {
      params: Promise.resolve({ id: 'doc-1' }),
    })
    expect(res.status).toBe(201)
  })
})

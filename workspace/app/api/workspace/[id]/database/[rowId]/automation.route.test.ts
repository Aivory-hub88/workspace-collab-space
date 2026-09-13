/**
 * Automation trigger test (Fase 4e): moving into a ruled status assigns,
 * comments, and optionally chains one WIP-gated move — exactly once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as Y from 'yjs'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('@/lib/db', () => ({ query: queryMock }))

vi.mock('@/lib/authProvider', () => ({ getAuthUserWithToken: () => null }))

import { POST as movePOST } from './move/route'

process.env.COLLAB_SERVICE_TOKEN = 'test-service-token'

const svc = { 'x-service-token': 'test-service-token' }

const RULES = [
  { id: 'auto-1', name: 'Welcome', whenStatus: 'Doing', setAssignee: 'lex', addComment: 'go go' },
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
    m.set('cells', {})
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
      return Promise.resolve({ rows: [{ props: { dbAutomations: RULES } }] })
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

describe('move triggers automations', () => {
  it('assigns + comments and reports applied', async () => {
    const res = await movePOST(
      new NextRequest('http://localhost/api/workspace/doc-1/database/r0/move', {
        method: 'POST',
        body: JSON.stringify({ status: 'Doing' }),
        headers: { 'Content-Type': 'application/json', ...svc },
      }),
      { params: Promise.resolve({ id: 'doc-1', rowId: 'r0' }) },
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.automated).toHaveLength(1)
    expect(j.automated[0]).toMatchObject({ ruleId: 'auto-1', ruleName: 'Welcome' })
    const activity = queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO dashboard.workspace_activity'))
    expect(activity).toBeTruthy()
  })

  it('does not trigger when status is unchanged', async () => {
    const res = await movePOST(
      new NextRequest('http://localhost/api/workspace/doc-1/database/r0/move', {
        method: 'POST',
        body: JSON.stringify({ status: 'Todo' }),
        headers: { 'Content-Type': 'application/json', ...svc },
      }),
      { params: Promise.resolve({ id: 'doc-1', rowId: 'r0' }) },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).moved).toBe(false)
  })
})

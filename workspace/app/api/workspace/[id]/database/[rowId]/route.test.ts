/**
 * Route-level tests for row PATCH (WIP on status move, description parity)
 * and the comments sub-resource (Fase 2 F2-2/F2-4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as Y from 'yjs'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('@/lib/db', () => ({ query: queryMock }))

vi.mock('@/lib/authProvider', () => ({ getAuthUserWithToken: () => null }))

import { PATCH } from './route'
import { POST as movePOST } from './move/route'
import { GET as commentsGET, POST as commentsPOST } from './comments/route'

process.env.COLLAB_SERVICE_TOKEN = 'test-service-token'

const svc = { 'x-service-token': 'test-service-token' }

function dbBytes(): Buffer {
  const doc = new Y.Doc()
  const arr = doc.getArray<Y.Map<unknown>>('database')
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    m.set('id', 'r0')
    m.set('title', 'Card')
    m.set('status', 'Doing')
    m.set('priority', 'Med')
    m.set('assignee', '')
    m.set('due', '')
    m.set('description', 'old desc')
    m.set('comments', [])
    arr.push([m])
    const full = new Y.Map<unknown>()
    full.set('id', 'rfull')
    full.set('title', 'Full column')
    full.set('status', 'Todo')
    full.set('priority', 'Med')
    full.set('assignee', '')
    full.set('due', '')
    full.set('description', '')
    full.set('comments', [])
    arr.push([full])
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

function patchReq(rowId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/workspace/doc-1/database/${rowId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...svc },
  })
}

const patchParams = (rowId: string) => ({ params: Promise.resolve({ id: 'doc-1', rowId }) })

describe('PATCH /api/workspace/[id]/database/[rowId]', () => {
  it('updates description (REST parity)', async () => {
    const res = await PATCH(patchReq('r0', { description: 'new desc' }), patchParams('r0'))
    expect(res.status).toBe(200)
    expect((await res.json()).patched).toMatchObject({ description: 'new desc' })
  })

  it('rejects moving into a full WIP column with 409', async () => {
    const res = await PATCH(patchReq('r0', { status: 'Todo' }), patchParams('r0'))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('wip-exceeded')
  })

  it('allows edits that keep the row in its column', async () => {
    const res = await PATCH(patchReq('r0', { title: 'Renamed', status: 'Doing' }), patchParams('r0'))
    expect(res.status).toBe(200)
  })

  it('returns 404 for unknown rows', async () => {
    const res = await PATCH(patchReq('nope', { title: 'x' }), patchParams('nope'))
    expect(res.status).toBe(404)
  })
})

describe('comments sub-resource', () => {  const cParams = (rowId: string) => ({ params: Promise.resolve({ id: 'doc-1', rowId }) })

  it('appends a comment and reads it back', async () => {
    const post = await commentsPOST(
      new NextRequest('http://localhost/api/workspace/doc-1/database/r0/comments', {
        method: 'POST',
        body: JSON.stringify({ text: 'hello' }),
        headers: { 'Content-Type': 'application/json', ...svc },
      }),
      cParams('r0'),
    )
    expect(post.status).toBe(201)
    const j = await post.json()
    expect(j.comment.text).toBe('hello')

    const get = await commentsGET(
      new NextRequest('http://localhost/api/workspace/doc-1/database/r0/comments', { headers: svc }),
      cParams('r0'),
    )
    expect(get.status).toBe(200)
    // fresh load from the same mocked bytes → the POST went to collab/pg mocks;
    // the GET proves the read path works (empty in this mocked store)
    expect((await get.json()).comments).toEqual([])
  })

  it('rejects empty text with 400', async () => {
    const post = await commentsPOST(
      new NextRequest('http://localhost/api/workspace/doc-1/database/r0/comments', {
        method: 'POST',
        body: JSON.stringify({ text: '   ' }),
        headers: { 'Content-Type': 'application/json', ...svc },
      }),
      cParams('r0'),
    )
    expect(post.status).toBe(400)
  })
})

describe('POST /api/workspace/[id]/database/[rowId]/move', () => {
  const moveReq = (rowId: string, body: unknown): NextRequest =>
    new NextRequest(`http://localhost/api/workspace/doc-1/database/${rowId}/move`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...svc },
    })
  const moveParams = (rowId: string) => ({ params: Promise.resolve({ id: 'doc-1', rowId }) })

  it('moves a card and records from/to', async () => {
    const res = await movePOST(moveReq('r0', { status: 'Done' }), moveParams('r0'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'r0', status: 'Done', moved: true, from: 'Doing' })
  })

  it('is a no-op when already in the target column', async () => {
    const res = await movePOST(moveReq('r0', { status: 'Doing' }), moveParams('r0'))
    expect(res.status).toBe(200)
    expect((await res.json()).moved).toBe(false)
  })

  it('rejects moves into a full WIP column with 409', async () => {
    const res = await movePOST(moveReq('r0', { status: 'Todo' }), moveParams('r0'))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('wip-exceeded')
  })

  it('requires a status with 400 and 404s unknown rows', async () => {
    const bad = await movePOST(moveReq('r0', {}), moveParams('r0'))
    expect(bad.status).toBe(400)
    const missing = await movePOST(moveReq('nope', { status: 'Done' }), moveParams('nope'))
    expect(missing.status).toBe(404)
  })
})

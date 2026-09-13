/**
 * Backfill without an embedding key degrades to an explicit 503 (Fase 4c2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('@/lib/db', () => ({ query: queryMock }))

vi.mock('@/lib/authProvider', () => ({ getAuthUserWithToken: () => null }))

import { POST } from './route'

process.env.COLLAB_SERVICE_TOKEN = 'test-service-token'

const svc = { 'x-service-token': 'test-service-token' }

beforeEach(() => {
  queryMock.mockReset()
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 })
})

describe('POST /api/workspace/search/backfill', () => {
  it('requires a docId with 400', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/workspace/search/backfill', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json', ...svc },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 503 with counts when embeddings are unconfigured', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/workspace/search/backfill', {
        method: 'POST',
        body: JSON.stringify({ docId: 'doc-1' }),
        headers: { 'Content-Type': 'application/json', ...svc },
      }),
    )
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'embeddings not configured', indexed: 0, skipped: 0 })
  })
})

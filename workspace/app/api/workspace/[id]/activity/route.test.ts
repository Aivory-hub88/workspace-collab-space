/**
 * Activity feed filters (Fase 3 F3-2): ?targetType=&targetId= narrows the
 * feed to one row's history for the drawer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('@/lib/db', () => ({ query: queryMock }))

vi.mock('@/lib/authProvider', () => ({ getAuthUserWithToken: () => null }))

import { GET } from './route'

process.env.COLLAB_SERVICE_TOKEN = 'test-service-token'

const svc = { 'x-service-token': 'test-service-token' }

beforeEach(() => {
  queryMock.mockReset()
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 })
})

describe('GET /api/workspace/[id]/activity', () => {
  it('filters by target when asked', async () => {
    const req = new NextRequest(
      'http://localhost/api/workspace/doc-1/activity?targetType=database-row&targetId=r0',
      { headers: svc },
    )
    const res = await GET(req, { params: Promise.resolve({ id: 'doc-1' }) })
    expect(res.status).toBe(200)
    const sql = String(queryMock.mock.calls[0][0])
    expect(sql).toContain('target_type')
    expect(sql).toContain('target_id')
    expect(queryMock.mock.calls[0][1]).toEqual(['doc-1', 'database-row', 'r0'])
    expect(await res.json()).toEqual({ activities: [] })
  })

  it('returns the full feed without filters', async () => {
    const req = new NextRequest('http://localhost/api/workspace/doc-1/activity', { headers: svc })
    const res = await GET(req, { params: Promise.resolve({ id: 'doc-1' }) })
    expect(res.status).toBe(200)
    expect(queryMock.mock.calls[0][1]).toEqual(['doc-1'])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, dynamic } from './route'
import { POPNIX_ROADS_URL } from '@/lib/roadFlood'

const ROADS_BODY = JSON.stringify({
  summary: { latest: '2026-10-05 14:10:00', stale: false, scrape_failing: false },
  roads: [
    { code: 'A', kind: 1, grp: 1, name: 'ถ.ทดสอบ', road: null, district: 'บางบอน', dir: null, lat: 13.7, lng: 100.5,
      depth: 15, measured_at: '2026-10-05 14:05:00', level: 'flood', since: null },
    { code: 'B', kind: 1, grp: 1, name: 'ถ.แห้ง', lat: 13.71, lng: 100.51, depth: 0, measured_at: '2026-10-05 14:05:00', level: 'dry' },
  ],
})

const fetchMock = vi.fn()
let errorSpy: ReturnType<typeof vi.spyOn>

function call(qs = '') {
  return GET(new NextRequest('http://localhost/api/road-events' + qs))
}
function upstream(status: number, body = ROADS_BODY) {
  fetchMock.mockResolvedValue(new Response(body, { status }))
}

beforeEach(() => {
  fetchMock.mockReset()
  upstream(200)
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T14:13:00+07:00'))
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GET /api/road-events', () => {
  it('ประกาศ dynamic = force-dynamic', () => {
    expect(dynamic).toBe('force-dynamic')
  })

  it('ต้นทางปกติ → 200 + snapshot + header cache ของ CDN/browser', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.snapshot.points.map((p: { code: string }) => p.code)).toEqual(['A'])
    expect(body.snapshot.sample).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(POPNIX_ROADS_URL)
    expect(res.headers.get('vercel-cdn-cache-control')).toBe('max-age=300, stale-while-revalidate=600')
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
  })

  describe('ต้นทางล้ม → 502 + no-store + log', () => {
    it.each([
      ['timeout', () => fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'))],
      ['HTTP 500', () => upstream(500)],
      ['JSON เสีย', () => upstream(200, 'not json')],
      ['roads ว่าง', () => upstream(200, JSON.stringify({ summary: {}, roads: [] }))],
    ])('%s', async (_name, arrange) => {
      arrange()
      const res = await call()
      expect(res.status).toBe(502)
      expect((await res.json()).ok).toBe(false)
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(res.headers.get('vercel-cdn-cache-control')).toBeNull()
      expect(errorSpy).toHaveBeenCalled()
    })
  })

  it.each([['?x=1'], ['?sample=1&x=1'], ['?sample=2']])('query ที่ไม่รองรับ %s → 400 ไม่เรียกต้นทาง', async (qs) => {
    const res = await call(qs)
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('production + ?sample=1 → 400 ไม่เรียกต้นทาง', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await call('?sample=1')
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('dev + ?sample=1 → ข้อมูลตัวอย่าง (sample: true) ไม่เรียกต้นทาง ไม่ cache', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await call('?sample=1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.snapshot.sample).toBe(true)
    expect(body.snapshot.points.length).toBeGreaterThan(0)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

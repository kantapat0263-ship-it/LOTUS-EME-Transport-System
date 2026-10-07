import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/firebase/admin', () => ({ getAdminDb: vi.fn() }))

import { getAdminDb } from '@/firebase/admin'
import { GET } from './route'

const fetchMock = vi.fn()
const adminMock = vi.mocked(getAdminDb)
let records: Map<string, Record<string, unknown>>
let failedWrite: string | undefined

function fakeDb() {
  const apply = (path: string, data: Record<string, unknown>) => {
    if (path === failedWrite) throw new Error('synthetic write failure')
    records.set(path, { ...records.get(path), ...data })
  }
  const reference = (path: string) => ({
    path,
    get: async () => ({ exists: records.has(path), data: () => records.get(path) }),
    set: async (data: Record<string, unknown>) => apply(path, data),
  })
  return {
    collection: (name: string) => ({ doc: (id: string) => reference(`${name}/${id}`) }),
    runTransaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const writes: { path: string; data: Record<string, unknown> }[] = []
      const result = await callback({
        get: (ref: ReturnType<typeof reference>) => ref.get(),
        set: (ref: ReturnType<typeof reference>, data: Record<string, unknown>) => {
          writes.push({ path: ref.path, data })
        },
      })
      if (writes.some(write => write.path === failedWrite)) throw new Error('synthetic commit failure')
      for (const write of writes) apply(write.path, write.data)
      return result
    },
  } as unknown as ReturnType<typeof getAdminDb>
}

const call = (authorization: string | null = 'Bearer synthetic-cron-secret') => GET(
  new NextRequest('http://localhost/api/cron/update-diesel-price', {
    headers: authorization ? { authorization } : {},
  }),
)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-06T23:00:00Z'))
  vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret')
  vi.stubEnv('DIESEL_PRICE_SOURCE_URL', 'https://gasprice.kapook.com/gasprice.php')
  records = new Map([['companySettings/default', { dieselPrice: 32.5, companyName: 'Synthetic company' }]])
  failedWrite = undefined
  adminMock.mockReset().mockReturnValue(fakeDb())
  fetchMock.mockReset().mockResolvedValue(new Response('<p>ดีเซล B7 33.00</p>'))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('diesel cron maintenance', () => {
  it('rejects a missing cron secret before fetching prices or opening the database', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const response = await call(null)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, error: 'not-configured' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(adminMock).not.toHaveBeenCalled()
    expect(records.get('companySettings/default')?.dieselPrice).toBe(32.5)
  })

  it.each([null, 'Bearer wrong-secret', 'Basic synthetic-cron-secret'])('rejects unauthorized calls with %s', async authorization => {
    const response = await call(authorization)
    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(adminMock).not.toHaveBeenCalled()
  })

  it('writes the Thai calendar day for the 06:00 Thai cron invocation', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    expect(records.get('dieselPriceHistory/2026-10-07')).toMatchObject({ date: '2026-10-07', price: 33 })
    expect(records.has('dieselPriceHistory/2026-10-06')).toBe(false)
  })

  it.each(['companySettings/default', 'dieselPriceHistory/2026-10-07'])('does not partially save a price update when %s cannot be committed', async path => {
    failedWrite = path
    const response = await call()
    expect(records.get('companySettings/default')?.dieselPrice).toBe(32.5)
    expect(records.has('dieselPriceHistory/2026-10-07')).toBe(false)
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ ok: false, error: 'write-failed' })
  })

  it('finishes a stalled source request within 15 seconds and records the kept price', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('Price source timed out', 'TimeoutError')), ms)
      return controller.signal
    })
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    let response: Awaited<ReturnType<typeof GET>> | undefined
    const pending = call().then(value => { response = value })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(response).toBeDefined()
    await pending
    expect(await response!.json()).toMatchObject({ ok: false, status: 'skipped', keptPrice: 32.5 })
    expect(records.get('companySettings/default')).toEqual({ dieselPrice: 32.5, companyName: 'Synthetic company' })
    expect(records.get('dieselPriceHistory/2026-10-07')).toMatchObject({ status: 'skipped', price: 32.5, fetchedPrice: null, changed: false })
  })

  it('keeps the configured source and saves a matching price/history without overwriting other settings', async () => {
    const response = await call()
    expect(await response.json()).toEqual({ ok: true, status: 'updated', price: 33, previous: 32.5, changed: true })
    expect(fetchMock.mock.calls[0][0]).toBe('https://gasprice.kapook.com/gasprice.php')
    expect(records.get('companySettings/default')).toMatchObject({ dieselPrice: 33, companyName: 'Synthetic company', fuelSettingsUpdatedBy: 'auto:diesel-cron' })
    expect(records.get('dieselPriceHistory/2026-10-07')).toMatchObject({ price: 33, fetchedPrice: 33, previousPrice: 32.5, changed: true, status: 'updated', source: 'https://gasprice.kapook.com/gasprice.php' })
  })

  it('records an unchanged price without touching fuel-settings timestamps', async () => {
    const settings = { dieselPrice: 33, fuelSettingsUpdatedBy: 'dispatcher', companyName: 'Synthetic company' }
    records.set('companySettings/default', settings)
    failedWrite = 'companySettings/default'
    const response = await call()
    expect(await response.json()).toMatchObject({ ok: true, price: 33, previous: 33, changed: false })
    expect(records.get('companySettings/default')).toEqual(settings)
    expect(records.get('dieselPriceHistory/2026-10-07')).toMatchObject({ price: 33, previousPrice: 33, changed: false })
  })

  it.each(['parse-miss', 'HTTP-error'])('keeps the existing price and records skipped for %s', async failure => {
    fetchMock.mockResolvedValue(failure === 'parse-miss'
      ? new Response('<p>No fuel prices available</p>')
      : new Response('Provider unavailable', { status: 502 }))
    const response = await call()
    expect(await response.json()).toMatchObject({ ok: false, status: 'skipped', keptPrice: 32.5 })
    expect(records.get('companySettings/default')).toEqual({ dieselPrice: 32.5, companyName: 'Synthetic company' })
    expect(records.get('dieselPriceHistory/2026-10-07')).toMatchObject({ price: 32.5, fetchedPrice: null, previousPrice: 32.5, changed: false, status: 'skipped' })
    expect(records.get('dieselPriceHistory/2026-10-07')?.note).toBe(failure === 'parse-miss' ? 'parse-miss' : 'fetch-error: source HTTP 502')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'
import { saveTripCoordinates, syncCoordinatesWithDistance } from './tripCoordinateSyncClient'
import type { CoordinateSyncCommand } from './tripCoordinateSync'

const command: CoordinateSyncCommand = { operationId: '3039f251-3995-4e97-bde5-18e401c6f3bd', tripId: 't1', baseline: 'snapshot', selections: [{ stopIndex: 0, siteId: 's1', latitude: 14, longitude: 101 }] }
const user = { getIdToken: async () => 'local-test-token' } as User
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('coordinate save client', () => {
  it('uses staff ID token and preserves the operation when an uncertain save is retried', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('network lost')).mockResolvedValueOnce(new Response(JSON.stringify({ updatedStops: 1, replayed: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(saveTripCoordinates(user, command)).rejects.toThrow('network lost')
    await expect(saveTripCoordinates(user, command)).resolves.toEqual({ updatedStops: 1 })
    expect(fetcher.mock.calls[0][0]).toBe('/api/trips/sync-coordinates')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer local-test-token' }, cache: 'no-store', body: JSON.stringify(command) })
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body)
  })
  it('surfaces a stale-preview error without automatic retries', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'พิกัดเปลี่ยน กรุณาโหลดใหม่' }), { status: 409 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(saveTripCoordinates(user, command)).rejects.toThrow('พิกัดเปลี่ยน')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects an incomplete success response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    await expect(saveTripCoordinates(user, command)).rejects.toThrow('ยังยืนยันผล')
  })
  it('times out token acquisition without sending a late mutation', async () => {
    vi.useFakeTimers()
    let resolveToken!: (token: string) => void
    const slowUser = { getIdToken: () => new Promise<string>(resolve => { resolveToken = resolve }) } as User
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const result = expect(saveTripCoordinates(slowUser, command)).rejects.toThrow('ยังยืนยันผล')
    await vi.advanceTimersByTimeAsync(45_000)
    await result
    resolveToken('late')
    await Promise.resolve()
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('ซิงก์พิกัด + คิด กม. ใหม่ (ผู้ใช้กำหนด 2026-10-19: ตรงกันทุกอย่าง)', () => {
  const trip = { id: 't1', stops: [{ siteId: 's1', siteName: 'A', order: 1, lat: 13, lng: 100 }, { siteId: 's2', siteName: 'B', order: 2, lat: 14.2, lng: 100.6 }] } as any
  const plan = { km: 120, minutes: 90, fuelCost: 360 }
  const arrange = (opts: { plan?: unknown; saveFails?: boolean; managed?: boolean } = {}) => {
    const computePlan = vi.fn().mockResolvedValue(opts.plan ?? plan)
    const sync = vi.fn().mockResolvedValue({ updatedStops: 1 })
    const saveDistance = opts.saveFails ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue(undefined)
    const run = () => syncCoordinatesWithDistance({ trip: opts.managed ? { ...trip, queueLink: { bookingId: 'b' } } : trip, command, computePlan, sync, saveDistance })
    return { run, computePlan, sync, saveDistance }
  }
  it('คิดระยะจากพิกัดชุดใหม่ (ตาม stopIndex) ก่อนซิงก์ แล้วบันทึก กม.', async () => {
    const { run, computePlan, sync, saveDistance } = arrange()
    expect(await run()).toEqual({ status: 'synced', updatedStops: 1, distance: 'saved', plan })
    expect(computePlan.mock.calls[0][0].map((s: any) => [s.lat, s.lng])).toEqual([[14, 101], [14.2, 100.6]])
    expect(sync.mock.invocationCallOrder[0]).toBeLessThan(saveDistance.mock.invocationCallOrder[0])
    expect(saveDistance).toHaveBeenCalledWith(plan)
  })
  it('คิดระยะไม่ได้ = ยังไม่ซิงก์อะไรเลย (ผู้ใช้เลือก)', async () => {
    const { run, sync, saveDistance } = arrange({ plan: 'failed' })
    expect(await run()).toEqual({ status: 'plan-failed' })
    expect(sync).not.toHaveBeenCalled()
    expect(saveDistance).not.toHaveBeenCalled()
  })
  it('ซิงก์แล้วบันทึก กม. ล้ม = แจ้งแยก พร้อมผลระยะไว้กดบันทึกซ้ำ (ไม่บอกว่าสำเร็จเฉย ๆ)', async () => {
    expect(await arrange({ saveFails: true }).run()).toEqual({ status: 'synced', updatedStops: 1, distance: 'save-failed', plan })
  })
  it('ไม่มีพิกัดให้คิด / ทริปคิวต่อเนื่อง = ซิงก์พิกัดอย่างเดียว ไม่แตะ กม.', async () => {
    const noCoords = arrange({ plan: 'no-coords' })
    expect(await noCoords.run()).toEqual({ status: 'synced', updatedStops: 1, distance: 'skipped', plan: null })
    expect(noCoords.saveDistance).not.toHaveBeenCalled()
    const managed = arrange({ managed: true })
    expect(await managed.run()).toMatchObject({ status: 'synced', distance: 'skipped' })
    expect(managed.computePlan).not.toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'
import { saveTripCoordinates } from './tripCoordinateSyncClient'
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

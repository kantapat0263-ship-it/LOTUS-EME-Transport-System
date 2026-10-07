import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoadFloodSnapshot } from '@/lib/roadFlood'

const harness = vi.hoisted(() => ({
  values: [] as unknown[],
  effect: null as null | (() => (() => void) | void),
}))
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = harness.values.length
    harness.values.push(typeof initial === 'function' ? initial() : initial)
    return [harness.values[index], (value: unknown) => { harness.values[index] = value }]
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => (() => void) | void) => { harness.effect = effect },
}))
import { useRoadFlood } from './use-road-flood'

const POLL = 5 * 60_000
const fetchMock = vi.fn()
let cleanup: (() => void) | void
const snapshot: RoadFloodSnapshot = {
  fetchedAt: Date.parse('2026-10-07T09:00:00+07:00'), sourceLatest: null, sourceStale: false,
  points: [], usable: 1, offline: 0, assessable: 1, invalid: 0,
}
const response = () => ({ ok: true, json: async () => ({ ok: true, snapshot }) })
function pending(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  })
}
function FloodHookHarness(enabled = true) {
  useRoadFlood(enabled)
  cleanup = harness.effect?.()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(snapshot.fetchedAt)
  harness.values = []
  harness.effect = null
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useRoadFlood request lifetime', () => {
  it('a stalled connection times out and the next poll can retry', async () => {
    fetchMock.mockImplementationOnce((_: string, init: RequestInit) => pending(init.signal as AbortSignal))
      .mockResolvedValue(response())
    FloodHookHarness()
    expect(harness.values[1]).toBe('loading')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(harness.values[1]).toBe('error')
    await vi.advanceTimersByTimeAsync(POLL - 30_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(harness.values[0]).toEqual(snapshot)
    expect(harness.values[1]).toBe('ready')
  })

  it('a stalled body keeps the previous snapshot, reports failure, then recovers', async () => {
    fetchMock.mockResolvedValueOnce(response())
      .mockImplementationOnce(async (_: string, init: RequestInit) => ({
        ok: true, json: () => pending(init.signal as AbortSignal),
      }))
      .mockResolvedValue(response())
    FloodHookHarness()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(POLL + 30_000)
    expect(harness.values[0]).toEqual(snapshot)
    expect(harness.values[1]).toBe('ready')
    expect(harness.values[2]).toBe(true)
    await vi.advanceTimersByTimeAsync(POLL - 30_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(harness.values[2]).toBe(false)
  })

  it('closing the layer aborts without reporting a failure or leaving poll timers', async () => {
    fetchMock.mockImplementation((_: string, init: RequestInit) => pending(init.signal as AbortSignal))
    FloodHookHarness()
    cleanup?.()
    cleanup = undefined
    await vi.advanceTimersByTimeAsync(POLL * 2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(harness.values[1]).toBe('loading')
    expect(harness.values[2]).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a closed layer makes no request', () => {
    FloodHookHarness(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

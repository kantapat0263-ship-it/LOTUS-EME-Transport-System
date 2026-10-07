import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  refs: 0, states: 0, effects: [] as Array<() => unknown>,
  map: { fitBounds: vi.fn(), getZoom: () => 10, setZoom: vi.fn() },
  marker: vi.fn(),
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: (initial: unknown) => ({ current: harness.refs++ === 1 ? harness.map : initial }),
  useState: (initial: unknown) => [harness.states++ === 0 ? true : initial, vi.fn()],
  useMemo: (fn: () => unknown) => fn(),
  useEffect: (effect: () => unknown) => { harness.effects.push(effect) },
}))
vi.mock('@/hooks/use-road-flood', () => ({ useRoadFlood: () => ({ snapshot: null, phase: 'idle', lastFailed: false, now: 0 }) }))
vi.mock('./useFloodMarkers', () => ({ useFloodMarkers: vi.fn() }))
import { TrackingMap } from './TrackingMap'

beforeEach(() => {
  harness.refs = 0; harness.states = 0; harness.effects = []; harness.marker.mockClear()
  vi.stubGlobal('google', { maps: {
    Marker: class { constructor(options: unknown) { harness.marker(options) } setMap() {} },
    LatLngBounds: class { extend() {} },
    SymbolPath: { CIRCLE: 0 },
    event: { addListenerOnce: vi.fn(), removeListener: vi.fn() },
  } })
})
afterEach(() => vi.unstubAllGlobals())

describe('TrackingMap stop classifications', () => {
  it('renders permitted rest gray, job orange and review red', () => {
    TrackingMap({ apiKey: 'test-only', stops: [], trail: [], stopEvents: [
      { lat: 13.7, lng: 100.5, durationMin: 30, nearJob: false, kind: 'rest' },
      { lat: 13.7, lng: 100.5, durationMin: 40, nearJob: false, kind: 'lunch' },
      { lat: 13.7, lng: 100.5, durationMin: 20, nearJob: true, kind: 'job' },
      { lat: 13.7, lng: 100.5, durationMin: 25, nearJob: false, kind: 'review' },
    ] })
    harness.effects.forEach(effect => effect())
    const markers = harness.marker.mock.calls.map(([options]) => options)
    expect(markers.map(marker => marker.icon.fillColor)).toEqual(['#6b7280', '#6b7280', '#d98a00', '#d64027'])
    expect(markers[0].title).toContain('พักหลังขับต่อเนื่อง')
    expect(markers[1].title).toContain('พักเที่ยง')
    expect(markers[3].title).toContain('รอตรวจสอบ')
  })
})

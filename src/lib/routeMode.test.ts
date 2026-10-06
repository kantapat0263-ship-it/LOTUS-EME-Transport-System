import { describe, it, expect } from 'vitest'
import { routePlan, tripRouteMode, ROUTE_MODES } from './routeMode'

const office = 'O'
const pts = ['A', 'B', 'C']

describe('routeMode: รูปแบบเส้นทางของทริป', () => {
  it('ค่าเริ่มต้น/ค่าแปลก = ไป-กลับ', () => {
    expect(tripRouteMode({})).toBe('round')
    expect(tripRouteMode({ routeMode: 'xyz' })).toBe('round')
    expect(tripRouteMode(null)).toBe('round')
    expect(tripRouteMode({ routeMode: 'outbound' })).toBe('outbound')
    expect(tripRouteMode({ routeMode: 'return' })).toBe('return')
  })

  it('มีตัวเลือกครบ 3 แบบ ไป-กลับมาก่อน', () => {
    expect(ROUTE_MODES.map((m) => m.value)).toEqual(['round', 'outbound', 'return'])
  })

  it('ไป-กลับ: คลัง → ทุกจุด → คลัง', () => {
    expect(routePlan('round', office, pts)).toEqual({ origin: 'O', destination: 'O', waypoints: ['A', 'B', 'C'] })
  })

  it('ไปอย่างเดียว: คลัง → ทุกจุด จบที่จุดสุดท้าย', () => {
    expect(routePlan('outbound', office, pts)).toEqual({ origin: 'O', destination: 'C', waypoints: ['A', 'B'] })
    expect(routePlan('outbound', office, ['A'])).toEqual({ origin: 'O', destination: 'A', waypoints: [] })
  })

  it('กลับอย่างเดียว: เริ่มจากจุดแรก → จุดที่เหลือ → คลัง', () => {
    expect(routePlan('return', office, pts)).toEqual({ origin: 'A', destination: 'O', waypoints: ['B', 'C'] })
    expect(routePlan('return', office, ['A'])).toEqual({ origin: 'A', destination: 'O', waypoints: [] })
  })

  it('ไม่มีจุดที่มีพิกัด → null (คิดระยะไม่ได้)', () => {
    expect(routePlan('round', office, [])).toBeNull()
  })
})

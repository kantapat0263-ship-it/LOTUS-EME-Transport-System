import { describe, it, expect } from 'vitest'
import { floodInfoReducer, INITIAL_FLOOD_INFO, type FloodInfoEvent } from './floodInfoState'

/** พับ reducer ทีละ event — คืน state สุดท้าย + effect ของ event สุดท้าย */
function run(events: FloodInfoEvent[]) {
  let state = INITIAL_FLOOD_INFO
  let effect = floodInfoReducer(state, { type: 'reset' }).effect
  for (const ev of events) ({ state, effect } = floodInfoReducer(state, ev))
  return { state, effect }
}
const hover = (code: string): FloodInfoEvent => ({ type: 'hoverMarker', code })
const leave = (code: string): FloodInfoEvent => ({ type: 'leaveMarker', code })
const click = (code: string): FloodInfoEvent => ({ type: 'clickMarker', code })
const fired = (code: string): FloodInfoEvent => ({ type: 'timerFired', code })

describe('floodInfoReducer', () => {
  it('ชี้หมุด → เปิดแบบไม่เลื่อนแผนที่', () => {
    const { state, effect } = run([hover('A')])
    expect(effect.open).toEqual({ code: 'A', autoPan: false })
    expect(effect.clearTimer).toBe(true)
    expect(state.openCode).toBe('A')
  })

  it('มีจุดค้างอยู่ → ชี้จุดอื่นไม่เปิดทับ', () => {
    const { state, effect } = run([click('A'), hover('B')])
    expect(effect.open).toBeNull()
    expect(state.openCode).toBe('A')
  })

  it('ออกจากหมุด → ตั้ง timer ปิด · ค้างอยู่ไม่ตั้ง', () => {
    expect(run([hover('A'), leave('A')]).effect.startTimer).toBe('A')
    expect(run([click('A'), leave('A')]).effect.startTimer).toBeNull()
  })

  it('pointer เข้ากล่อง → ยกเลิก timer และ timer ที่หลุดมาไม่ปิด', () => {
    const entered = run([hover('A'), leave('A'), { type: 'enterContent' }])
    expect(entered.effect.clearTimer).toBe(true)
    expect(entered.state.pointerInContent).toBe(true)
    const late = run([hover('A'), leave('A'), { type: 'enterContent' }, fired('A')])
    expect(late.effect.close).toBe(false)
    expect(late.state.openCode).toBe('A')
  })

  it('pointer ออกจากกล่อง → ตั้ง timer ปิด', () => {
    expect(run([hover('A'), { type: 'enterContent' }, { type: 'leaveContent' }]).effect.startTimer).toBe('A')
  })

  it('timer ของ A ไม่ปิดกล่อง B (ชี้ A แล้วรีบไป B)', () => {
    const { state, effect } = run([hover('A'), leave('A'), hover('B'), fired('A')])
    expect(effect.close).toBe(false)
    expect(state.openCode).toBe('B')
  })

  it('timer ครบโดยไม่มีอะไรมาขัด → ปิด', () => {
    const { state, effect } = run([hover('A'), leave('A'), fired('A')])
    expect(effect.close).toBe(true)
    expect(state).toEqual(INITIAL_FLOOD_INFO)
  })

  it('คลิก/แตะ → เปิดค้าง และยอมให้แผนที่เลื่อนให้กล่องอยู่ในจอ', () => {
    const { state, effect } = run([click('A')])
    expect(effect.open).toEqual({ code: 'A', autoPan: true })
    expect(effect.clearTimer).toBe(true)
    expect(state.pinned).toBe(true)
  })

  it('กด X → ปิดและล้างสถานะ', () => {
    const { state, effect } = run([click('A'), { type: 'closeClick' }])
    expect(effect.close).toBe(true)
    expect(state).toEqual(INITIAL_FLOOD_INFO)
  })

  it('สร้างหมุดใหม่: กล่องค้างที่จุดยังอยู่ → เปิดต่อแบบไม่เลื่อนแผนที่ · จุดหายไป → ปิด', () => {
    const kept = run([click('A'), { type: 'rebuild', visibleCodes: ['A', 'B'] }])
    expect(kept.effect.open).toEqual({ code: 'A', autoPan: false })
    expect(kept.state.pinned).toBe(true)
    const gone = run([click('A'), { type: 'rebuild', visibleCodes: ['B'] }])
    expect(gone.effect.close).toBe(true)
    expect(gone.state).toEqual(INITIAL_FLOOD_INFO)
  })

  it('สร้างหมุดใหม่ขณะกล่อง hover (ไม่ค้าง) → ปิดเสมอ', () => {
    const { state, effect } = run([hover('A'), { type: 'rebuild', visibleCodes: ['A'] }])
    expect(effect.close).toBe(true)
    expect(state).toEqual(INITIAL_FLOOD_INFO)
  })

  it('reset (ปิดชั้น/ออกโหมด/unmount) → ปิด ล้าง timer ล้างสถานะ', () => {
    const { state, effect } = run([click('A'), { type: 'reset' }])
    expect(effect.close).toBe(true)
    expect(effect.clearTimer).toBe(true)
    expect(state).toEqual(INITIAL_FLOOD_INFO)
  })
})

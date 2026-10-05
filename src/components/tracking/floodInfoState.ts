/**
 * สถานะกล่องรายละเอียดของหมุดน้ำท่วม (InfoWindow ตัวเดียว) — reducer ล้วน ไม่แตะ google/DOM จึงทดสอบได้
 * คนเรียก (useFloodMarkers) ทำตาม effect: เปิด/ปิดกล่อง และตั้ง/ล้าง timer ปิด 300 ms
 * กติกา (spec ข้อ 8): ชี้ = เปิดชั่วคราว · คลิก/แตะ = ค้าง · timer ปิดเฉพาะจุดเดียวกับตอนตั้ง · สร้างหมุดใหม่: ค้างเปิดต่อ/hover ปิด
 */

export interface FloodInfoState {
  openCode: string | null
  pinned: boolean
  pointerInContent: boolean
  timerFor: string | null
}

export const INITIAL_FLOOD_INFO: FloodInfoState = { openCode: null, pinned: false, pointerInContent: false, timerFor: null }

export type FloodInfoEvent =
  | { type: 'hoverMarker'; code: string }
  | { type: 'leaveMarker'; code: string }
  | { type: 'enterContent' }
  | { type: 'leaveContent' }
  | { type: 'clickMarker'; code: string }
  | { type: 'timerFired'; code: string }
  | { type: 'closeClick' }
  | { type: 'rebuild'; visibleCodes: string[] }
  | { type: 'reset' }

export interface FloodInfoEffect {
  open: { code: string; autoPan: boolean } | null
  close: boolean
  startTimer: string | null
  clearTimer: boolean
}

const NONE: FloodInfoEffect = { open: null, close: false, startTimer: null, clearTimer: false }
const closed = { state: INITIAL_FLOOD_INFO, effect: { ...NONE, close: true, clearTimer: true } }

export function floodInfoReducer(state: FloodInfoState, event: FloodInfoEvent): { state: FloodInfoState; effect: FloodInfoEffect } {
  const stay = { state, effect: NONE }
  const armTimer = (code: string) => ({ state: { ...state, timerFor: code }, effect: { ...NONE, startTimer: code } })

  switch (event.type) {
    case 'hoverMarker':
      if (state.pinned) return stay
      return {
        state: { openCode: event.code, pinned: false, pointerInContent: false, timerFor: null },
        effect: { ...NONE, open: { code: event.code, autoPan: false }, clearTimer: true },
      }
    case 'leaveMarker':
      if (state.pinned || state.openCode !== event.code) return stay
      return armTimer(event.code)
    case 'enterContent':
      return { state: { ...state, pointerInContent: true, timerFor: null }, effect: { ...NONE, clearTimer: true } }
    case 'leaveContent':
      if (state.pinned || !state.openCode) return { state: { ...state, pointerInContent: false }, effect: NONE }
      return { state: { ...state, pointerInContent: false, timerFor: state.openCode }, effect: { ...NONE, startTimer: state.openCode } }
    case 'clickMarker':
      return {
        state: { openCode: event.code, pinned: true, pointerInContent: false, timerFor: null },
        effect: { ...NONE, open: { code: event.code, autoPan: true }, clearTimer: true },
      }
    case 'timerFired':
      if (state.pinned || state.pointerInContent || state.timerFor !== event.code || state.openCode !== event.code) return stay
      return closed
    case 'closeClick':
    case 'reset':
      return closed
    case 'rebuild':
      if (!state.openCode) return stay
      if (state.pinned && event.visibleCodes.includes(state.openCode)) {
        return { state, effect: { ...NONE, open: { code: state.openCode, autoPan: false } } }
      }
      return closed
  }
}

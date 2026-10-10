import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { LAUNCH_SCRIPT, RELAUNCH_EVENT, RELAUNCH_MESSAGE } from './launchFocus'

const manifest = JSON.parse(readFileSync(new URL('../../public/manifest.json', import.meta.url), 'utf8'))

type Consumer = (params: { targetURL?: string }) => void

/**
 * รันสคริปต์ inline ตัวจริงกับ window จำลอง
 * Chrome/Edge มี window.launchQueue จริงแบบอ่านอย่างเดียว (assign ตรงๆ ไม่มีผล) → จำลองด้วย Object.defineProperty
 */
function boot({ queue = true, setConsumer = true } = {}) {
  let now = 0
  let consumer: Consumer | null = null
  const listeners: Record<string, (() => void)[]> = {}
  const dispatched: { type: string; detail: unknown }[] = []
  const win = {
    addEventListener: (type: string, fn: () => void) => {
      ;(listeners[type] ||= []).push(fn)
    },
    dispatchEvent: (e: { type: string; detail: unknown }) => {
      dispatched.push(e)
      return true
    },
  } as Record<string, unknown>
  if (queue) {
    Object.defineProperty(win, 'launchQueue', {
      configurable: true,
      value: setConsumer ? { setConsumer: (c: Consumer) => (consumer = c) } : {},
    })
  }
  class FakeCustomEvent {
    constructor(
      readonly type: string,
      init?: { detail?: unknown }
    ) {
      this.detail = init?.detail
    }
    detail: unknown
  }
  const perf = { now: () => now }
  new Function('window', 'performance', 'CustomEvent', LAUNCH_SCRIPT)(win, perf, FakeCustomEvent)
  return {
    win,
    dispatched,
    at: (t: number) => (now = t),
    load: (t: number) => {
      now = t
      for (const fn of listeners.load ?? []) fn()
    },
    launch: (t: number, targetURL = 'https://lotus-eme-transport-system.vercel.app/') => {
      now = t
      consumer?.({ targetURL })
    },
    hasConsumer: () => consumer !== null,
  }
}

describe('LAUNCH_SCRIPT (inline ใน <head> — รันก่อน React)', () => {
  it('เปิดครั้งแรก: LaunchParams ของการเปิดที่สร้างหน้าต่างนี้ (มาก่อน load) → ไม่แจ้ง', () => {
    const s = boot()
    expect(s.hasConsumer()).toBe(true)
    s.launch(50)
    s.load(800)
    expect(s.dispatched).toEqual([])
    expect(s.win.__lotusRelaunches).toBeUndefined()
  })

  it('reload: Chromium ส่งค่า launch ล่าสุดซ้ำหลัง load ไม่นาน (ภายใน 1000 ms) → ไม่แจ้ง', () => {
    const s = boot()
    s.load(1000)
    s.launch(1999)
    expect(s.dispatched).toEqual([])
  })

  it('กดไอคอนซ้ำหลังโหลดเกิน 1 วินาที → ยิง event + เก็บในคิว (React มารับ)', () => {
    const s = boot()
    s.load(1000)
    s.launch(5000, 'https://lotus-eme-transport-system.vercel.app/')
    expect(s.dispatched).toEqual([
      expect.objectContaining({ type: RELAUNCH_EVENT, detail: { targetURL: 'https://lotus-eme-transport-system.vercel.app/' } }),
    ])
    expect(s.win.__lotusRelaunches).toEqual(['https://lotus-eme-transport-system.vercel.app/'])
  })

  it('กดซ้ำหลายครั้ง → แจ้งทุกครั้ง', () => {
    const s = boot()
    s.load(1000)
    s.launch(3000)
    s.launch(9000)
    expect(s.dispatched).toHaveLength(2)
  })

  it('ไม่มี launchQueue (Firefox/Safari/มือถือ) → ไม่มี error ไม่ทำอะไร', () => {
    expect(() => boot({ queue: false })).not.toThrow()
    expect(() => boot({ queue: true, setConsumer: false })).not.toThrow()
  })
})

describe('manifest.json', () => {
  it('มี launch_handler แบบ focus-existing (ดึงหน้าต่างเดิม ไม่โหลดหน้าใหม่ทับงานที่กรอกค้าง)', () => {
    expect(manifest.launch_handler).toEqual({ client_mode: ['focus-existing', 'auto'] })
    expect(JSON.stringify(manifest.launch_handler)).not.toContain('navigate-existing')
  })

  it('ไม่มี shortcuts → การกดซ้ำมีแค่กรณี "อยู่หน้าเดิม" (ถ้าจะเพิ่ม shortcuts ต้องออกแบบการพาไปหน้าอื่น + กันฟอร์มค้างก่อน)', () => {
    expect(manifest.shortcuts).toBeUndefined()
  })

  it('ข้อความใช้ชื่อแอปจาก manifest', () => {
    expect(RELAUNCH_MESSAGE).toBe(`ระบบ ${manifest.name} เปิดอยู่แล้ว — ใช้หน้าต่างนี้ได้เลย`)
  })
})

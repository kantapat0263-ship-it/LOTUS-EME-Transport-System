import { afterEach, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'
import { fetchContinuousQueues, runContinuousQueueCommand } from './continuousQueueClient'

const user = { getIdToken: async () => 'test-token' } as User
afterEach(() => { vi.unstubAllGlobals() })

it('ส่งคำสั่งพร้อมตัวตนและ operationId แล้วรอผล server ก่อนสำเร็จ', async () => {
  const command = { action: 'complete-day' as const, bookingId: 'B1', date: '2026-10-06', operationId: 'op-123456' }
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ bookingId: 'B1', tripIds: ['T1'] })))
  vi.stubGlobal('fetch', fetch)
  expect(await runContinuousQueueCommand(user, command)).toEqual({ bookingId: 'B1', tripIds: ['T1'] })
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token')
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(command)
})

it('เก็บข้อผิดพลาดของ server ให้คนจัดรถเห็นและไม่คืนผลสำเร็จ', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'รถมีคิวแล้ว กรุณาเลือกวันอื่น' }), { status: 409 })))
  await expect(runContinuousQueueCommand(user, { action: 'complete-day', bookingId: 'B1', date: '2026-10-06', operationId: 'op-123456' })).rejects.toThrow('รถมีคิวแล้ว กรุณาเลือกวันอื่น')
})

it('ไม่ยอมให้ข้อมูลคนละวันกลายเป็นผลว่างที่ดูเหมือนรถว่าง', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ date: '2026-10-07', notices: [], bookings: [] }))))
  await expect(fetchContinuousQueues(user, '2026-10-06')).rejects.toThrow('ข้อมูลคิวไม่ตรงกับวันที่เลือก')
})

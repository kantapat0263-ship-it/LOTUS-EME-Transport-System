import type { User } from 'firebase/auth'
import type { QueueCommand, QueueCommandResult, QueueSnapshot } from '@/types/continuous-queue'

async function request(user: User, path: string, init: RequestInit, signal?: AbortSignal): Promise<any> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(abort, 45_000)
  try {
    const aborted = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(new Error('ตรวจหรือบันทึกคิวไม่สำเร็จ กรุณาโหลดคิวใหม่ก่อนลองอีกครั้ง'))
      else controller.signal.addEventListener('abort', () => reject(new Error('ตรวจหรือบันทึกคิวไม่สำเร็จ กรุณาโหลดคิวใหม่ก่อนลองอีกครั้ง')), { once: true })
    })
    const run = async () => {
      const token = await user.getIdToken()
      if (controller.signal.aborted) throw new Error('ยกเลิกการตรวจคิวแล้ว')
      const response = await fetch(`/api/continuous-queues${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(typeof json?.error === 'string' ? json.error : 'ตรวจหรือบันทึกคิวไม่ได้ กรุณาลองใหม่')
      if (!json || typeof json !== 'object') throw new Error('ได้รับข้อมูลคิวไม่ครบ กรุณาโหลดคิวใหม่')
      return json
    }
    return await Promise.race([run(), aborted])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

export async function runContinuousQueueCommand(user: User, command: QueueCommand): Promise<QueueCommandResult> {
  const result = await request(user, '', { method: 'POST', body: JSON.stringify(command) })
  if (typeof result.bookingId !== 'string' || !Array.isArray(result.tripIds) || result.tripIds.some((id: unknown) => typeof id !== 'string')) throw new Error('ได้รับผลบันทึกคิวไม่ครบ กรุณาโหลดคิวใหม่ก่อนส่งซ้ำ')
  return result
}

export async function fetchContinuousQueues(user: User, date: string, signal?: AbortSignal): Promise<QueueSnapshot> {
  const result = await request(user, `?date=${encodeURIComponent(date)}`, { method: 'GET' }, signal)
  if (result.date !== date) throw new Error('ข้อมูลคิวไม่ตรงกับวันที่เลือก')
  if (!Array.isArray(result.notices) || !Array.isArray(result.bookings) || result.notices.some((notice: any) => notice?.date !== date || typeof notice.driverName !== 'string' || typeof notice.siteName !== 'string' || typeof notice.effectiveSiteName !== 'string' || typeof notice.startDate !== 'string' || typeof notice.endDate !== 'string' || typeof notice.borrowedDriver !== 'boolean' || typeof notice.borrowedVehicle !== 'boolean')) throw new Error('ได้รับข้อมูลคิวไม่ครบ กรุณาโหลดคิวใหม่')
  return result
}

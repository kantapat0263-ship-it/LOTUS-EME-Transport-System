import type { User } from 'firebase/auth'
import type { StopReviewCommand } from '@/server/weeklyStopValidation'
import type { WeeklyStopReport } from './driverStopSummary'
async function request<T>(user: Pick<User, 'getIdToken'>, suffix: string, body: unknown): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('เกินเวลารอ กรุณาลองรายการเดิมอีกครั้งหรือโหลดรายงานเพื่อตรวจผล')) }, 45_000) })
  try {
    return await Promise.race([timeout, (async () => {
      const token = await user.getIdToken()
      if (controller.signal.aborted) throw new Error('เกินเวลารอ')
      const response = await fetch(`/api/reports/weekly-stops${suffix}`, { method: 'POST', body: JSON.stringify(body), cache: 'no-store', signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'ยังยืนยันผลไม่ได้ กรุณาโหลดรายงาน')
      return data as T
    })()])
  } finally { if (timer) clearTimeout(timer) }
}
export const loadWeeklyStopReport = (user: Pick<User, 'getIdToken'>, weekStart: string) => request<WeeklyStopReport>(user, '', { weekStart })
export const submitStopReview = (user: Pick<User, 'getIdToken'>, command: StopReviewCommand) => request<{ version: number; replayed?: boolean }>(user, '/review', command)

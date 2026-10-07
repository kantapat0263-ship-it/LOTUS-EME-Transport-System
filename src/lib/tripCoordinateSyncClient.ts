import type { User } from 'firebase/auth'
import type { CoordinateSyncCommand } from './tripCoordinateSync'

export async function saveTripCoordinates(user: User, command: CoordinateSyncCommand): Promise<{ updatedStops: number }> {
  const controller = new AbortController()
  const message = 'ยังยืนยันผลบันทึกไม่ได้ ลองส่งรายการเดิมอีกครั้งหรือโหลดใบคิวเพื่อตรวจผล'
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error(message)) }, 45_000)
  })
  const run = async () => {
    const token = await user.getIdToken()
    if (controller.signal.aborted) throw new Error(message)
    const response = await fetch('/api/trips/sync-coordinates', {
      method: 'POST', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(command),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : message)
    if (!Number.isSafeInteger(result?.updatedStops) || result.updatedStops < 0 || result.updatedStops > command.selections.length) throw new Error(message)
    return { updatedStops: result.updatedStops as number }
  }
  try { return await Promise.race([run(), timeout]) }
  finally { clearTimeout(timer) }
}

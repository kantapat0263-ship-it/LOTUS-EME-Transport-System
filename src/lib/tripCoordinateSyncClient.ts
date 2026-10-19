import type { User } from 'firebase/auth'
import type { CoordinateSyncCommand } from './tripCoordinateSync'
import type { PlanDistance, PlanDistanceResult } from './planDistance'
import { isManagedTrip } from './continuousQueue'
import type { Trip, TripStop } from '@/types/models'

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

export type CoordinateSyncOutcome =
  | { status: 'plan-failed' }
  | { status: 'synced'; updatedStops: number; distance: 'saved'; plan: PlanDistance }
  | { status: 'synced'; updatedStops: number; distance: 'save-failed'; plan: PlanDistance }
  | { status: 'synced'; updatedStops: number; distance: 'skipped'; plan: null }

/**
 * ซิงก์พิกัด + กม.ตามแผน (ผู้ใช้กำหนด 2026-10-19: แก้พิกัดแล้ว กม. ต้องตาม)
 * คิดระยะจากพิกัดชุดใหม่ก่อน — คิดไม่ได้ = ยังไม่ซิงก์ ให้ลองใหม่ · ซิงก์แล้วค่อยบันทึก กม.
 * บันทึก กม. ล้มหลังซิงก์ = แจ้งแยก (พิกัดเปลี่ยนแล้ว) พร้อมผลระยะให้กดบันทึกซ้ำ — ซิงก์ซ้ำ/แก้ในหน้าประวัติจะไม่คิดใหม่เพราะพิกัดตรงแล้ว
 * ทริปคิวต่อเนื่องแก้ผ่าน API คิวเท่านั้น (ตัวเขียนทริปปฏิเสธ) = ซิงก์พิกัดอย่างเดียว
 */
export async function syncCoordinatesWithDistance(input: {
  trip: Trip
  command: CoordinateSyncCommand
  computePlan: (stops: TripStop[]) => Promise<PlanDistanceResult>
  sync: () => Promise<{ updatedStops: number }>
  saveDistance: (plan: PlanDistance) => Promise<void>
}): Promise<CoordinateSyncOutcome> {
  const { trip, command } = input
  const bySelection = new Map(command.selections.map(sel => [sel.stopIndex, sel]))
  const nextStops = (trip.stops || []).map((stop, i) => {
    const sel = bySelection.get(i)
    return sel ? { ...stop, lat: sel.latitude, lng: sel.longitude } : stop
  })
  const plan = isManagedTrip(trip) ? 'no-coords' : await input.computePlan(nextStops)
  if (plan === 'failed') return { status: 'plan-failed' }
  const { updatedStops } = await input.sync()
  if (plan === 'no-coords') return { status: 'synced', updatedStops, distance: 'skipped', plan: null }
  try {
    await input.saveDistance(plan)
    return { status: 'synced', updatedStops, distance: 'saved', plan }
  } catch {
    return { status: 'synced', updatedStops, distance: 'save-failed', plan }
  }
}

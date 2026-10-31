/**
 * ฝากของไปไซต์ — หาเที่ยวรถที่จะไปไซต์ที่ผู้ใช้ฝากของไว้ (ตรรกะล้วน ไม่แตะฐานข้อมูล)
 * ใช้กฎเดียวกับใบสรุป: จุดงานที่เลื่อนวันไม่นับ · งานที่โยกไปคันอื่นตามไปคันที่รับจริง (liveMoveTarget)
 * ผู้ใช้เห็นเฉพาะรายการของตัวเอง (rules) — ไม่เกี่ยวกับคนจัดรถ
 */
import type { ParcelWatch, Trip, TripStop } from '@/types/models'
import { liveMoveTarget, tripDriverLabel } from '@/lib/reassign'
import { tripRouteMode } from '@/lib/routeMode'
import { daysBetween } from '@/lib/vehicle-compliance'

/** ดูทริปล่วงหน้ากี่วัน (นับจากวันนี้) */
export const PARCEL_LOOKAHEAD_DAYS = 14
/** ความยาวข้อความ — ตรงกับ firestore.rules (parcelWatches) */
export const PARCEL_LIMITS = { item: 200, note: 300 } as const

export interface ParcelRun {
  tripDocId: string
  tripCode: string
  date: string
  plate: string
  /** คนขับจริง (ขับแทน) ก่อนคนขับประจำ — ใช้หาเบอร์โทร */
  driverId: string
  driverName: string
  /** ไซต์อื่นในเที่ยวเดียวกัน */
  otherSites: string[]
}

export interface ParcelAlert {
  key: string
  parcelId: string
  item: string
  siteName: string
  run: ParcelRun
}

const TH_DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` → "ส. 31 ต.ค." */
export function thaiShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${TH_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${TH_MONTHS[m - 1]}`
}

export function runDateLabel(date: string, today: string): string {
  const diff = daysBetween(today, date)
  if (diff === 0) return 'วันนี้'
  if (diff === 1) return 'พรุ่งนี้'
  return thaiShortDate(date)
}

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
const isPostponed = (s: TripStop) => s.outcome === 'postponed' || !!s.postponedToDate

/** จุดงานที่เที่ยวนี้ไปจริง: ของตัวเองที่ไม่ได้เลื่อน/โยกออก + งานที่โยกเข้ามาจากคันอื่นวันเดียวกัน */
function effectiveStops(trip: Trip, sameDay: Trip[]): TripStop[] {
  const own = (trip.stops || []).filter(s => !isPostponed(s) && !liveMoveTarget(s, sameDay))
  const incoming = sameDay.flatMap(other => other.id === trip.id ? [] :
    (other.stops || []).filter(s => !isPostponed(s) && liveMoveTarget(s, sameDay)?.id === trip.id))
  return [...own, ...incoming]
}

/** รหัสไซต์ตรงกัน · จุดงานที่พิมพ์ชื่อเอง (ไม่มีรหัส / `custom-N` จากหน้าวางแผน) เทียบชื่อแทน
 *  ไซต์ในระบบคนละรหัสไม่จับคู่แม้ชื่อซ้ำ (เช่น "สำนักงานใหญ่" คนละบริษัท) */
function stopAtSite(s: TripStop, p: Pick<ParcelWatch, 'siteId' | 'siteName'>): boolean {
  if (s.siteId && !s.siteId.startsWith('custom-')) return s.siteId === p.siteId
  return !!norm(s.siteName) && norm(s.siteName) === norm(p.siteName)
}

/** เที่ยวที่ยังฝากของได้ (ตั้งแต่วันนี้ ไม่ยกเลิก ไม่จบงาน ไม่กดรอรอบถัดไป) ที่ไปไซต์ของรายการนี้ — ใกล้สุดก่อน
 *  ทริปกลับอย่างเดียว (เริ่มจากไซต์) ไม่นับ เพราะรถไม่ได้ออกจากออฟฟิศ */
export function matchParcelRuns(parcel: Pick<ParcelWatch, 'siteId' | 'siteName' | 'skippedTripIds'>, trips: Trip[], today: string): ParcelRun[] {
  const skipped = new Set(parcel.skippedTripIds ?? [])
  const live = trips.filter(t => t.status !== 'Cancelled' && t.tripDate >= today)
  const byDate = new Map<string, Trip[]>()
  for (const t of live) byDate.set(t.tripDate, [...(byDate.get(t.tripDate) ?? []), t])

  const runs: ParcelRun[] = []
  for (const t of live) {
    if (t.status === 'Completed' || t.gpsEndAt != null || tripRouteMode(t) === 'return' || skipped.has(t.id)) continue
    const stops = effectiveStops(t, byDate.get(t.tripDate)!)
    if (!stops.some(s => stopAtSite(s, parcel))) continue
    runs.push({
      tripDocId: t.id,
      tripCode: t.tripId || t.id,
      date: t.tripDate,
      plate: t.vehiclePlate || '',
      driverId: t.actualDriverId || t.driverId || '',
      driverName: tripDriverLabel(t),
      otherSites: [...new Set(stops.filter(s => !stopAtSite(s, parcel)).map(s => s.siteName).filter(Boolean))],
    })
  }
  return runs.sort((a, b) => a.date.localeCompare(b.date) || a.tripCode.localeCompare(b.tripCode))
}

/** เตือนเมื่อรถอาจไปไม่ทันวันที่ต้องถึง — null = ไม่ต้องเตือน */
export function parcelDeadlineWarning(parcel: Pick<ParcelWatch, 'status' | 'deadline'>, firstRun: ParcelRun | undefined, today: string): string | null {
  const deadline = parcel.deadline
  if (parcel.status !== 'waiting' || !deadline || (firstRun && firstRun.date <= deadline)) return null
  if (deadline < today) return `เลยวันที่ต้องถึง (${thaiShortDate(deadline)}) แล้ว`
  if (firstRun) return `รถเที่ยวแรกไป ${thaiShortDate(firstRun.date)} หลังวันที่ต้องถึง (${thaiShortDate(deadline)}) — ลองคุยกับคนจัดรถ`
  if (daysBetween(today, deadline) <= 2) return `ใกล้วันที่ต้องถึง (${thaiShortDate(deadline)}) แต่ยังไม่มีรถไปไซต์นี้ — ลองคุยกับคนจัดรถ`
  return null
}

/** เที่ยวแรกของแต่ละรายการที่รอรถ ซึ่งยังไม่เคยแจ้งบนเครื่องนี้ (key = parcelId:tripDocId) */
export function pendingParcelAlerts(entries: { parcel: ParcelWatch; runs: ParcelRun[] }[], seen: ReadonlySet<string>): ParcelAlert[] {
  return entries.flatMap(({ parcel, runs }) => {
    const run = runs[0]
    if (parcel.status !== 'waiting' || !run) return []
    const key = `${parcel.id}:${run.tripDocId}`
    return seen.has(key) ? [] : [{ key, parcelId: parcel.id, item: parcel.item, siteName: parcel.siteName, run }]
  })
}

export function parcelAlertMessage(alerts: ParcelAlert[], today: string): { title: string; body: string } {
  if (alerts.length === 1) {
    const { item, siteName, run } = alerts[0]
    return {
      title: `มีรถไป ${siteName} ${runDateLabel(run.date, today)}`,
      // ทริปไม่มีสถานะ "ออกจากออฟฟิศแล้ว" — เที่ยววันนี้อาจออกไปแล้ว
      body: `ฝาก "${item}" ไปกับ ${run.plate}${run.driverName ? ` · ${run.driverName}` : ''}${run.date === today ? ' · รถอาจออกไปแล้ว โทรถามคนขับก่อน' : ''}`,
    }
  }
  return {
    title: `มีรถไปไซต์ที่คุณฝากของ ${alerts.length} รายการ`,
    body: alerts.slice(0, 3).map(a => `${a.item} → ${a.siteName} (${runDateLabel(a.run.date, today)})`).join('\n'),
  }
}

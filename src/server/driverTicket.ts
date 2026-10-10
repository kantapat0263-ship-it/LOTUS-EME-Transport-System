import { computeDriverLeaderboard, computeOutcomeStats, incomingStopsForTrip } from '@/lib/calculations'

/**
 * ข้อมูลใบงานคนขับที่ส่งให้คนเปิดลิงก์ (ไม่ต้องล็อกอิน) — คัดเฉพาะฟิลด์ที่หน้า /driver/[tripId] แสดงจริง
 * ห้ามส่งเอกสารทริปทั้งก้อน (ค่าน้ำมัน, id คนขับ/รถ, ใบขอรถต้นทาง, ข้อมูลคิวต่อเนื่อง ฯลฯ ไม่ต้องรู้)
 * และสถิติรายเดือนคำนวณที่ server ส่งกลับแค่ของคนขับคนนี้ (เดิม client ดึงทริปทั้งเดือนของทุกคน)
 */
type Raw = Record<string, unknown>

const STOP_TEXT_FIELDS = [
  'siteName', 'requestTime', 'cargoDetails', 'requestedBy', 'requestedByPhone', 'note',
  'reassignedToVehiclePlate', 'reassignedToDriverName', 'assistForPlate', 'assistForDriver',
] as const

const TRIP_TEXT_FIELDS = ['tripId', 'tripDate', 'departureTime', 'driverName', 'actualDriverName', 'vehiclePlate'] as const
const TRIP_NUMBER_FIELDS = ['totalDistanceKm', 'totalEstimatedTimeMinutes'] as const

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function pickText<K extends string>(source: Raw, keys: readonly K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {}
  for (const key of keys) if (typeof source[key] === 'string') out[key] = source[key] as string
  return out
}

const asRaw = (value: unknown) => (value && typeof value === 'object' ? value : {}) as Raw
const text = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * หมายเหตุคนจัดรถที่ใบงานแสดงจริงของแต่ละจุด: trip.stopNotes (ตัวหลัก) ไม่มีก็ใช้ stop.dispatcherNote (รุ่นเก่า)
 * — ตรรกะเดียวกับหน้าใบงาน แต่ส่งเฉพาะค่าที่ชนะ และเฉพาะจุดที่มีอยู่จริง (ไม่ส่งหมายเหตุค้างของจุดที่ถูกลบ)
 */
function effectiveStopNotes(trip: Raw, stops: Raw[]) {
  const notes: Record<string, string> = {}
  const authors: Record<string, string> = {}
  const tripNotes = asRaw(trip.stopNotes)
  const tripAuthors = asRaw(trip.stopNoteAuthors)
  stops.forEach((stop, index) => {
    const key = `stop_${index}`
    const note = text(tripNotes[key]) || text(stop.dispatcherNote)
    const author = text(tripAuthors[key]) || text(stop.dispatcherName)
    if (note) notes[key] = note
    if (author) authors[key] = author
  })
  return { stopNotes: notes, stopNoteAuthors: authors }
}

function projectStop(s: Raw) {
  return {
    ...pickText(s, STOP_TEXT_FIELDS),
    // ใบงานใช้ผลแค่ "ส่งแล้ว/ยังไม่ส่ง" เพื่อขึ้นป้ายงานที่โยกไปแล้ว — ไม่ส่งเหตุผลภายใน (เช่น driver-refused)
    ...(typeof s.outcome === 'string' && s.outcome ? { outcome: s.outcome === 'delivered' ? 'delivered' : 'not-delivered' } : {}),
    ...(isNum(s.lat) ? { lat: s.lat } : {}),
    ...(isNum(s.lng) ? { lng: s.lng } : {}),
  }
}

export interface DriverTicketStats { rank: number; actualKm: number; completedStops: number; workingDays: number }

export function buildDriverTicket(trip: Raw & { id: string }, monthTrips: (Raw & { id: string })[], driverPhone: string) {
  const stops = Array.isArray(trip.stops) ? trip.stops.map(asRaw) : []
  const projected = {
    id: trip.id,
    ...pickText(trip, TRIP_TEXT_FIELDS),
    ...Object.fromEntries(TRIP_NUMBER_FIELDS.filter(k => isNum(trip[k])).map(k => [k, trip[k]])),
    ...effectiveStopNotes(trip, stops),
    stops: stops.map(projectStop),
  }

  let stats: DriverTicketStats | null = null
  let boardSize = 0
  let topKm = 0
  let incoming: { siteName: string; cargoDetails: string; dispatcherNote: string; dispatcherName: string; fromVehiclePlate: string; fromDriverName: string }[] = []
  let actualKm: number | null = null
  if (trip.tripDate && trip.driverId) {
    // ไม่นับทริปที่ยกเลิก (Cancelled) — เหมือนหน้าใบงานเดิม
    const active = monthTrips.filter(t => t.status !== 'Cancelled') as never[]
    const board = computeDriverLeaderboard(active)
    // สถิติของ "คนที่ขับจริง" (ขับแทน) ถ้ามี — คนเปิดลิงก์คือคนขับจริง
    const statDriverId = trip.actualDriverId || trip.driverId
    const mine = board.find(b => b.driverId === statDriverId)
    stats = mine ? { rank: mine.rank, actualKm: mine.actualKm, completedStops: mine.completedStops, workingDays: mine.workingDays } : null
    boardSize = board.length
    topKm = board[0]?.actualKm || 0
    incoming = incomingStopsForTrip(active, trip.id).map(job => ({
      siteName: job.siteName, cargoDetails: job.cargoDetails, dispatcherNote: job.dispatcherNote,
      dispatcherName: job.dispatcherName, fromVehiclePlate: job.fromVehiclePlate, fromDriverName: job.fromDriverName,
    }))
    actualKm = computeOutcomeStats(active).actualKmByTrip[trip.id] ?? null
  }

  return { trip: projected, driverPhone, stats, boardSize, topKm, incoming, actualKm }
}

export type DriverTicket = ReturnType<typeof buildDriverTicket>

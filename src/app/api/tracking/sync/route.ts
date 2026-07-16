import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb, verifyStaffToken } from '@/firebase/admin'
import { sinotrackLogin, fetchLastPositions, type VehiclePosition } from '@/lib/sinotrack'
import { trackingDateKey, computeDailySummary, OFFICE_LOCATION } from '@/lib/tracking'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** จำนวนจุดสูงสุดที่เก็บใน trail ต่อคันต่อวัน — 1 จุด/นาที × 24 ชม. = 1440 (doc ~43KB ยังเล็ก)
 *  ต้องครอบคลุมช่วงบันทึกทั้งวัน (เช่น 05:00–20:00 = 900 จุด) ไม่งั้นช่วงเช้าจะถูกตัด */
const MAX_TRAIL_POINTS = 1440

/** กันยิงถี่เกิน (หลายคนเปิดหน้าติดตามพร้อมกัน) — ถ้าเพิ่ง sync ไปไม่ถึงเวลานี้ ให้ข้าม */
const MIN_SYNC_INTERVAL_MS = 45_000

/**
 * ดึงตำแหน่งรถล่าสุดจาก SinoTrack → เขียนลง Firestore
 *   vehiclePositions/{deviceId}                 = ตำแหน่งล่าสุด (ให้หน้าเมนูอ่านเร็ว)
 *   vehiclePositionTrails/{date}__{deviceId}    = เส้นทางที่วิ่งจริงของวันนั้น (array จุด)
 *
 * เรียกได้ 2 ทาง:
 *   (ก) จากหน้าเมนู "ติดตามรถ" ที่เปิดค้าง — client แนบ Firebase ID token ของ staff (poll ทุก 1 นาที)
 *       → ฟรี ไม่ต้องพึ่ง cron ภายนอก
 *   (ข) จาก external cron (cron-job.org) — แนบ `Authorization: Bearer <CRON_SECRET>` (ทางเลือก)
 *
 * ENV ที่ต้องตั้งบน Vercel:
 *   SINOTRACK_USER, SINOTRACK_PASSWORD  — บัญชี SinoTrack (เก็บเป็น secret เท่านั้น)
 *   FIREBASE_SERVICE_ACCOUNT_BASE64     — เขียน Firestore + verify token ฝั่ง server (มีอยู่แล้วจาก cron ราคาน้ำมัน)
 *   CRON_SECRET                          — (ทางเลือก) สำหรับ external cron
 */
export async function GET(req: NextRequest) {
  // --- auth: staff token (client) หรือ CRON_SECRET (cron) ---
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  const isCron = !!secret && authHeader === `Bearer ${secret}`
  if (!isCron) {
    const uid = await verifyStaffToken(authHeader)
    if (!uid) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
  }

  // --- cron: บันทึกเฉพาะช่วงเวลาทำงาน 05:00–20:00 (เวลาไทย) ; คนเปิดหน้าดูตอนไหนก็ยังได้ ---
  if (isCron) {
    const thaiHour = new Date(Date.now() + 7 * 3600 * 1000).getUTCHours()
    if (thaiHour < 5 || thaiHour >= 20) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'off-hours', thaiHour })
    }
  }

  const user = process.env.SINOTRACK_USER
  const password = process.env.SINOTRACK_PASSWORD
  if (!user || !password) {
    return NextResponse.json(
      { ok: false, error: 'config', detail: 'ยังไม่ได้ตั้ง SINOTRACK_USER / SINOTRACK_PASSWORD' },
      { status: 500 }
    )
  }

  let db
  try {
    db = getAdminDb()
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'admin-init', detail: e?.message }, { status: 500 })
  }

  // --- กันยิงถี่เกิน: ถ้าเพิ่ง sync ไป <45 วิ ให้ข้าม (จองคิวทันทีกันชนกัน) ---
  const metaRef = db.collection('trackingMeta').doc('sync')
  try {
    const metaSnap = await metaRef.get()
    const lastRunAt = metaSnap.exists ? (metaSnap.data()?.lastRunAt as number | undefined) : undefined
    if (lastRunAt && Date.now() - lastRunAt < MIN_SYNC_INTERVAL_MS) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'recently-synced', lastRunAt })
    }
    await metaRef.set({ lastRunAt: Date.now() }, { merge: true })
  } catch {
    /* meta อ่าน/เขียนพลาด → ปล่อยให้ sync ต่อ ไม่ throw */
  }

  // 1) อ่านทะเบียนรถที่จับคู่ GPS ไว้ (deviceId → plate)
  let deviceToPlate: Record<string, string> = {}
  try {
    const snap = await db.collection('vehicles').get()
    snap.forEach((d) => {
      const v = d.data()
      if (v?.gpsDeviceId) deviceToPlate[String(v.gpsDeviceId)] = String(v.licensePlate ?? '')
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'read-vehicles', detail: e?.message }, { status: 500 })
  }

  const deviceIds = Object.keys(deviceToPlate)
  if (deviceIds.length === 0) {
    return NextResponse.json({ ok: true, synced: 0, note: 'ยังไม่มีรถที่จับคู่ GPS' })
  }

  const dateKey = trackingDateKey()

  // 1b) งานของแต่ละคันวันนี้ (plate → จุดงาน + ต้นทาง) สำหรับคำนวณสรุปรายวัน
  // ต้นทาง = ออฟฟิศเสมอ (ตั้งใน settings ได้ ไม่งั้นใช้พิกัดออฟฟิศคงที่)
  let office: { lat: number; lng: number } = OFFICE_LOCATION
  try {
    const cfg = await db.collection('companySettings').doc('default').get()
    const c = cfg.data()
    if (c?.warehouseLatitude != null && c?.warehouseLongitude != null) {
      office = { lat: Number(c.warehouseLatitude), lng: Number(c.warehouseLongitude) }
    }
  } catch {
    /* ใช้พิกัดออฟฟิศคงที่ */
  }
  const plateToJob: Record<string, { stops: any[]; origin: { lat: number; lng: number } | null }> = {}
  try {
    const tripSnap = await db.collection('trips').where('tripDate', '==', dateKey).get()
    tripSnap.forEach((d) => {
      const t = d.data()
      if (t?.status === 'Cancelled' || !t?.vehiclePlate) return
      const origin = office
      const stops = (t.stops ?? []).map((s: any) => ({
        order: s.order,
        siteName: s.siteName ?? '',
        lat: s.lat,
        lng: s.lng,
      }))
      plateToJob[String(t.vehiclePlate)] = { stops, origin }
    })
  } catch (e: any) {
    console.error('[tracking-sync] read trips failed:', e?.message)
  }

  // 2) login + ดึงตำแหน่งล่าสุด
  let positions: VehiclePosition[]
  try {
    const cookie = await sinotrackLogin(user, password)
    positions = await fetchLastPositions(cookie, user, deviceIds)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'sinotrack', detail: e?.message }, { status: 502 })
  }

  const nowMs = Date.now()
  const date = trackingDateKey(nowMs)
  let written = 0

  // 3) เขียนตำแหน่งล่าสุด + ต่อ trail
  for (const p of positions) {
    const plate = deviceToPlate[p.deviceId] ?? ''
    try {
      await db
        .collection('vehiclePositions')
        .doc(p.deviceId)
        .set(
          {
            deviceId: p.deviceId,
            licensePlate: plate,
            lat: p.lat,
            lng: p.lng,
            speed: p.speed,
            direction: p.direction,
            positionTime: p.time, // เวลาที่ GPS รายงาน (ms)
            alarmState: p.alarmState, // bitmask (32768=ตัดไฟ, 64=ความเร็วเกิน)
            mileage: p.mileage, // ระยะสะสมจากอุปกรณ์ (เมตร)
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )

      // ต่อ trail รายวัน — ข้ามถ้าจุดเวลาเดิม (GPS ยังไม่รายงานจุดใหม่)
      const trailRef = db.collection('vehiclePositionTrails').doc(`${date}__${p.deviceId}`)
      const trailSnap = await trailRef.get()
      const prev: any[] = trailSnap.exists ? trailSnap.data()?.points ?? [] : []
      const last = prev[prev.length - 1]
      let effPoints: any[] = prev
      if (!last || last.t !== p.time) {
        effPoints = [...prev, { lat: p.lat, lng: p.lng, t: p.time, sp: p.speed }].slice(-MAX_TRAIL_POINTS)
        await trailRef.set(
          { deviceId: p.deviceId, licensePlate: plate, date, points: effPoints, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        )
      }

      // สรุปรายวัน (เวลาจอด/เดินทาง/เข้า-ออกออฟฟิศ) — คำนวณจาก trail + งานของคันนั้น
      const job = plateToJob[plate]
      if (job) {
        const sum = computeDailySummary(effPoints, job.stops, job.origin)
        await db
          .collection('trackingDaily')
          .doc(`${date}__${p.deviceId}`)
          .set(
            {
              date,
              deviceId: p.deviceId,
              licensePlate: plate,
              departedOfficeAt: sum.departedOfficeAt,
              returnedOfficeAt: sum.returnedOfficeAt,
              totalKm: sum.totalKm,
              stops: sum.stops,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          )
      }
      written++
    } catch (e: any) {
      console.error('[tracking-sync] write failed for', p.deviceId, e?.message)
    }
  }

  return NextResponse.json({
    ok: true,
    synced: written,
    devices: deviceIds.length,
    positions: positions.length,
    at: new Date(nowMs).toISOString(),
  })
}

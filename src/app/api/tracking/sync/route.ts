import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/firebase/admin'
import { sinotrackLogin, fetchLastPositions, type VehiclePosition } from '@/lib/sinotrack'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** จำนวนจุดสูงสุดที่เก็บใน trail ต่อคันต่อวัน (กัน doc โต — 1 จุด/นาที ~ ครอบคลุมทั้งวัน) */
const MAX_TRAIL_POINTS = 720

/** วันที่ตามเวลาไทย (UTC+7) รูปแบบ YYYY-MM-DD ใช้เป็น key ของ trail รายวัน */
function thaiDate(nowMs: number): string {
  return new Date(nowMs + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * ดึงตำแหน่งรถล่าสุดจาก SinoTrack → เขียนลง Firestore
 *   vehiclePositions/{deviceId}                 = ตำแหน่งล่าสุด (ให้หน้าเมนูอ่านเร็ว)
 *   vehiclePositionTrails/{date}__{deviceId}    = เส้นทางที่วิ่งจริงของวันนั้น (array จุด)
 *
 * เรียกจากตัวกระตุ้น cron ทุก 1-2 นาที (Vercel Cron หรือ external เช่น cron-job.org)
 * ป้องกันด้วย CRON_SECRET แบบเดียวกับ /api/cron/update-diesel-price
 *
 * ENV ที่ต้องตั้งบน Vercel:
 *   SINOTRACK_USER, SINOTRACK_PASSWORD  — บัญชี SinoTrack (เก็บเป็น secret เท่านั้น)
 *   FIREBASE_SERVICE_ACCOUNT_BASE64     — เขียน Firestore ฝั่ง server (มีอยู่แล้วจาก cron ราคาน้ำมัน)
 *   CRON_SECRET                          — กันยิงมั่ว (ถ้าไม่ตั้ง = เปิด public)
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
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

  // 2) login + ดึงตำแหน่งล่าสุด
  let positions: VehiclePosition[]
  try {
    const cookie = await sinotrackLogin(user, password)
    positions = await fetchLastPositions(cookie, user, deviceIds)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'sinotrack', detail: e?.message }, { status: 502 })
  }

  const nowMs = Date.now()
  const date = thaiDate(nowMs)
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
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )

      // ต่อ trail รายวัน — ข้ามถ้าจุดเวลาเดิม (GPS ยังไม่รายงานจุดใหม่)
      const trailRef = db.collection('vehiclePositionTrails').doc(`${date}__${p.deviceId}`)
      const trailSnap = await trailRef.get()
      const prev: any[] = trailSnap.exists ? trailSnap.data()?.points ?? [] : []
      const last = prev[prev.length - 1]
      if (!last || last.t !== p.time) {
        const points = [...prev, { lat: p.lat, lng: p.lng, t: p.time, sp: p.speed }].slice(
          -MAX_TRAIL_POINTS
        )
        await trailRef.set(
          { deviceId: p.deviceId, licensePlate: plate, date, points, updatedAt: FieldValue.serverTimestamp() },
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

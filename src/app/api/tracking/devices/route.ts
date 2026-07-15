import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffToken } from '@/firebase/admin'
import { sinotrackLogin, fetchDevices, fetchLastPositions } from '@/lib/sinotrack'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** cache รายชื่ออุปกรณ์ไว้สั้น ๆ (device list แทบไม่เปลี่ยน) กันยิง SinoTrack ทุกครั้งที่เปิดหน้า fleet */
let cache: { at: number; devices: { deviceId: string; carNum: string }[] } | null = null
const CACHE_MS = 5 * 60 * 1000

/**
 * รายชื่ออุปกรณ์ GPS ในบัญชี SinoTrack (deviceId + ชื่อที่ตั้งไว้)
 * ให้หน้า "ฟลีทรถและคนขับ" ทำ dropdown จับคู่ทะเบียน↔GPS โดยไม่ต้องพิมพ์เลขเอง
 * เฉพาะ staff (admin/dispatcher) ที่ login แล้ว
 */
export async function GET(req: NextRequest) {
  const uid = await verifyStaffToken(req.headers.get('authorization'))
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({ ok: true, cached: true, devices: cache.devices })
  }

  const user = process.env.SINOTRACK_USER
  const password = process.env.SINOTRACK_PASSWORD
  if (!user || !password) {
    return NextResponse.json(
      { ok: false, error: 'config', detail: 'ยังไม่ได้ตั้ง SINOTRACK_USER / SINOTRACK_PASSWORD' },
      { status: 500 }
    )
  }

  try {
    const cookie = await sinotrackLogin(user, password)
    const list = await fetchDevices(cookie, user)
    // เติมชื่อรถ (strCarNum) จากตำแหน่งล่าสุด เพราะ Proc_GetUserOwnCar ไม่มีชื่อ
    const positions = await fetchLastPositions(cookie, user, list.map((d) => d.deviceId))
    const nameById = new Map(positions.map((p) => [p.deviceId, p.carNum || '']))
    const devices = list.map((d) => ({
      deviceId: d.deviceId,
      carNum: nameById.get(d.deviceId) || d.carNum || '',
    }))
    cache = { at: Date.now(), devices }
    return NextResponse.json({ ok: true, devices })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'sinotrack', detail: e?.message }, { status: 502 })
  }
}

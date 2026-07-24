import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffToken } from '@/firebase/admin'
import { sinotrackLogin, fetchDevices, fetchLastPositions, SINOTRACK_SERVER } from '@/lib/sinotrack'

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

  // บัญชีหลัก + VIP (ถ้าตั้ง env) — รวมรายชื่ออุปกรณ์จากทุก server
  const accounts: { user: string; password: string; server: string; label: string }[] = [
    { user, password, server: SINOTRACK_SERVER, label: 'primary' },
  ]
  const vipUser = process.env.SINOTRACK_VIP_USER
  const vipPassword = process.env.SINOTRACK_VIP_PASSWORD
  if (vipUser && vipPassword) {
    accounts.push({
      user: vipUser,
      password: vipPassword,
      server: process.env.SINOTRACK_VIP_SERVER || 'https://242.sinotrack.com', // Server 5 | Vip.SinoTrack
      label: 'vip',
    })
  }

  const devices: { deviceId: string; carNum: string }[] = []
  const errors: string[] = []
  for (const acct of accounts) {
    try {
      const cookie = await sinotrackLogin(acct.user, acct.password, acct.server)
      const list = await fetchDevices(cookie, acct.user, acct.server)
      // เติมชื่อรถ (strCarNum) จากตำแหน่งล่าสุด เพราะ Proc_GetUserOwnCar ไม่มีชื่อ
      const positions = await fetchLastPositions(cookie, acct.user, list.map((d) => d.deviceId), acct.server)
      const nameById = new Map(positions.map((p) => [p.deviceId, p.carNum || '']))
      for (const d of list) {
        devices.push({ deviceId: d.deviceId, carNum: nameById.get(d.deviceId) || d.carNum || '' })
      }
    } catch (e: any) {
      errors.push(`${acct.label}: ${e?.message}`)
    }
  }
  if (devices.length === 0 && errors.length === accounts.length) {
    return NextResponse.json({ ok: false, error: 'sinotrack', detail: errors.join(' | ') }, { status: 502 })
  }
  cache = { at: Date.now(), devices }
  return NextResponse.json({ ok: true, devices })
}

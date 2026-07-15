/**
 * แสดงรายชื่ออุปกรณ์ GPS ทั้งหมดในบัญชี SinoTrack พร้อม "ชื่อรถที่ตั้งไว้"
 * เพื่อเอาไปจับคู่กับทะเบียนรถในเมนู "ฟลีทรถและคนขับ"
 *
 * วิธีรัน (PowerShell):
 *   $env:SINOTRACK_USER='lotuseme'
 *   $env:SINOTRACK_PASSWORD='<รหัสผ่าน>'
 *   cmd /c "npx tsx scripts/list-gps-devices.ts"
 */
import { sinotrackLogin, fetchDevices, fetchLastPositions } from '../src/lib/sinotrack'

async function main() {
  const user = process.env.SINOTRACK_USER
  const password = process.env.SINOTRACK_PASSWORD
  if (!user || !password) {
    console.error('❌ ต้องตั้ง env SINOTRACK_USER และ SINOTRACK_PASSWORD ก่อน')
    process.exit(1)
  }

  const cookie = await sinotrackLogin(user, password)
  const devices = await fetchDevices(cookie, user)

  // ดึงตำแหน่งล่าสุดของทุกตัว — ผลลัพธ์มี strCarNum (ชื่อรถที่ตั้งใน SinoTrack) + เวลาล่าสุด
  const positions = await fetchLastPositions(
    cookie,
    user,
    devices.map((d) => d.deviceId)
  )
  const byId = new Map(positions.map((p) => [p.deviceId, p]))

  const now = Date.now()
  console.log(`\nพบ ${devices.length} อุปกรณ์ในบัญชี ${user}\n`)
  console.log('เลข GPS (gpsDeviceId) | ชื่อใน SinoTrack     | อัปเดตล่าสุด            | สถานะ')
  console.log('-'.repeat(88))

  for (const d of devices) {
    const p = byId.get(d.deviceId)
    const name = p?.carNum || d.carNum || '(ไม่มีชื่อ)'
    const last = p?.time ? new Date(p.time).toLocaleString('th-TH') : '-'
    const ageMin = p?.time ? Math.round((now - p.time) / 60000) : Infinity
    const state = !p?.time
      ? '❔ ไม่มีข้อมูล'
      : ageMin > 60 * 24
        ? `💤 ออฟไลน์ (${Math.round(ageMin / 60 / 24)} วัน)`
        : ageMin > 30
          ? `⚠️ เก่า (${ageMin} นาที)`
          : '🟢 สด'
    console.log(
      `${d.deviceId.padEnd(21)} | ${String(name).padEnd(20)} | ${last.padEnd(22)} | ${state}`
    )
  }

  console.log(
    '\n👉 เอา "เลข GPS" ไปใส่ในเมนู ฟลีทรถและคนขับ → แก้ไขรถแต่ละคัน → ช่อง "เลขอุปกรณ์ GPS (SinoTrack)"\n'
  )
}

main().catch((e) => {
  console.error('❌ ล้มเหลว:', e?.message ?? e)
  process.exit(1)
})

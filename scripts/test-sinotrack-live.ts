/**
 * ทดสอบเชื่อมต่อ SinoTrack จริง (login → device list → ตำแหน่งล่าสุด)
 *
 * รหัสผ่านอ่านจาก environment variable — ไม่เก็บในไฟล์/โค้ด
 *
 * วิธีรัน (PowerShell):
 *   $env:SINOTRACK_USER='lotuseme'
 *   $env:SINOTRACK_PASSWORD='<รหัสผ่าน>'
 *   npx tsx scripts/test-sinotrack-live.ts
 */
import { sinotrackLogin, fetchDevices, fetchLastPositions } from '../src/lib/sinotrack'

async function main() {
  const user = process.env.SINOTRACK_USER
  const password = process.env.SINOTRACK_PASSWORD
  if (!user || !password) {
    console.error('❌ ต้องตั้ง env SINOTRACK_USER และ SINOTRACK_PASSWORD ก่อน')
    process.exit(1)
  }

  console.log('1) กำลัง login…')
  const cookie = await sinotrackLogin(user, password)
  console.log('   ✅ login สำเร็จ (ได้ session cookie)')

  console.log('2) ดึงรายชื่ออุปกรณ์…')
  const devices = await fetchDevices(cookie, user)
  console.log(`   ✅ พบ ${devices.length} อุปกรณ์`)
  devices.slice(0, 30).forEach((d) => console.log(`      ${d.deviceId}  ${d.carNum}`))

  console.log('3) ดึงตำแหน่งล่าสุด (5 คันแรก)…')
  const pos = await fetchLastPositions(
    cookie,
    user,
    devices.slice(0, 5).map((d) => d.deviceId)
  )
  pos.forEach((p) =>
    console.log(
      `      ${p.deviceId}  lat=${p.lat} lng=${p.lng} speed=${p.speed} เวลา=${new Date(
        p.time
      ).toLocaleString('th-TH')}`
    )
  )
  console.log('\n🎉 เชื่อมต่อ SinoTrack ได้ครบทุกขั้น — พร้อมทำเมนูติดตามรถต่อ')
}

main().catch((e) => {
  console.error('❌ ล้มเหลว:', e?.message ?? e)
  process.exit(1)
})

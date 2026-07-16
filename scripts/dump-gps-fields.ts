/**
 * ดัมป์ค่า "ทุกฟิลด์" ที่ SinoTrack คืนมาต่อรถ 1 คัน — เพื่อดูว่า GPS รุ่นนี้ (ST-902)
 * อ่านค่าอะไรจากรถได้จริงบ้าง (อะไรมีค่า อะไรเป็น 0/ว่าง)
 *
 * รหัสผ่านอ่านจาก env — ไม่เก็บในไฟล์
 *
 * วิธีรัน (PowerShell):
 *   cd "C:\Users\kantapat\Desktop\COWORK SPACE\ระบบจัดคิวรถ\LOTUS-EME-Transport-System"
 *   $env:SINOTRACK_USER='lotuseme'
 *   $env:SINOTRACK_PASSWORD='<รหัสผ่าน>'
 *   cmd /c "npx tsx scripts/dump-gps-fields.ts"
 */
import {
  sinotrackLogin,
  fetchDevices,
  buildRequest,
  parseAppJson,
  buildData,
  PROC,
  SINOTRACK_SERVER,
  SINOTRACK_ENDPOINT,
} from '../src/lib/sinotrack'

function randomDigits(len = 14): string {
  let s = ''
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10)
  return s.replace(/^0/, '1')
}

/** เรียก proc ตรง ๆ แล้วคืนผล parse (ทุกฟิลด์) โดยแนบ cookie */
async function rawProc(cmd: string, args: string[], user: string, cookie: string) {
  const req = buildRequest({ cmd, args, user, nowMs: Date.now(), random: randomDigits() })
  const body = new URLSearchParams(req as any).toString()
  const res = await fetch(SINOTRACK_SERVER + SINOTRACK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body,
  })
  return parseAppJson(await res.json())
}

async function main() {
  const user = process.env.SINOTRACK_USER
  const password = process.env.SINOTRACK_PASSWORD
  if (!user || !password) {
    console.error('❌ ต้องตั้ง env SINOTRACK_USER และ SINOTRACK_PASSWORD ก่อน')
    process.exit(1)
  }

  console.log('กำลัง login…')
  const cookie = await sinotrackLogin(user, password)
  const devices = await fetchDevices(cookie, user)
  console.log(`พบ ${devices.length} อุปกรณ์ — ขอดู 3 คันแรก\n`)

  const ids = devices.slice(0, 3).map((d) => d.deviceId)
  const res = await rawProc(PROC.getLastPosition, [ids.join(',')], user, cookie)

  console.log('===== ฟิลด์ทั้งหมดที่ API คืนมา =====')
  console.log(res.fields.join(', '))
  console.log('')

  res.records.forEach((r, i) => {
    console.log(`----- รถคันที่ ${i + 1} (${r.strTEID || r.strCarNum || '?'}) -----`)
    Object.entries(r).forEach(([k, v]) => {
      console.log(`  ${k.padEnd(14)} = ${v}`)
    })
    console.log('')
  })

  console.log('เสร็จ — ดูว่าฟิลด์ไหนมีค่าจริง (ไม่ใช่ 0/ว่าง) = ค่านั้นดึงมาใช้ได้')
}

main().catch((e) => {
  console.error('❌ ล้มเหลว:', e?.message ?? e)
  process.exit(1)
})

/**
 * ใส่ข้อมูลทดสอบลง Firebase Emulator (ในเครื่องเท่านั้น — ไม่แตะ production)
 *
 *   1) firebase emulators:start --project demo-lotus-eme
 *   2) npx tsx scripts/seed-emulator.ts
 *
 * บัญชีทดสอบ (ใช้ได้เฉพาะ emulator): ดู TEST_USERS ด้านล่าง
 */
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'

import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'demo-lotus-eme'
if (!PROJECT_ID.startsWith('demo-')) throw new Error('seed ใช้ได้กับ demo project เท่านั้น')

const TEST_USERS = [
  { email: 'dispatcher@test.local', password: 'emulator-only-1234', name: 'คนจัดรถ (ทดสอบ)', role: 'dispatcher' },
  { email: 'viewer@test.local', password: 'emulator-only-1234', name: 'ผู้ดู (ทดสอบ)', role: 'viewer' },
]

// ทะเบียนตัวอย่าง: บางคันตรงกับตารางในภาพ (ไว้ลองนำเข้า) + กรณีพิเศษ (ซ้ำ / ไม่มีในตาราง)
const VEHICLES = [
  { id: 'veh-28', licensePlate: '1ฒษ-4407', type: 'Pickup', maxLoadCapacityKg: 1000 },
  { id: 'veh-29', licensePlate: '1ฒส-3002', type: 'Pickup', maxLoadCapacityKg: 1000 },
  { id: 'veh-30', licensePlate: '1ฒส-9972', type: 'Pickup', maxLoadCapacityKg: 1200 },
  { id: 'veh-33', licensePlate: '2ฒธ-7920', type: 'Pickup', maxLoadCapacityKg: 1000 },
  { id: 'veh-34', licensePlate: 'ฮอ-5716', type: 'Pickup', maxLoadCapacityKg: 800 },
  { id: 'veh-35', licensePlate: '40-1953', type: '6-wheel truck', maxLoadCapacityKg: 5000 },
  { id: 'veh-36', licensePlate: '2ฒร-7169', type: 'Pickup', maxLoadCapacityKg: 1000 },
  { id: 'veh-37', licensePlate: '40-2050', type: '4-wheel truck', maxLoadCapacityKg: 2500 },
  { id: 'veh-dupA', licensePlate: '3กข-1111', type: 'Pickup', maxLoadCapacityKg: 1000 },
  { id: 'veh-dupB', licensePlate: '3กข 1111', type: 'Pickup', maxLoadCapacityKg: 1000 },
  { id: 'veh-new', licensePlate: '4กค-2222', type: 'Pickup', maxLoadCapacityKg: 1000 },
]

function isoPlus(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
  const [y, m, d] = today.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

async function main() {
  initializeApp({ projectId: PROJECT_ID })
  const auth = getAuth()
  const db = getFirestore()

  for (const u of TEST_USERS) {
    let uid: string
    try {
      uid = (await auth.getUserByEmail(u.email)).uid
    } catch {
      uid = (await auth.createUser({ email: u.email, password: u.password, displayName: u.name })).uid
    }
    await db.doc(`users/${uid}`).set({ id: uid, email: u.email, name: u.name, role: u.role, active: true, pending: false })
  }

  for (const v of VEHICLES) await db.doc(`vehicles/${v.id}`).set(v)

  // ข้อมูลเดิมบางส่วน — ไว้ทดสอบว่า "ไม่เขียนทับ" + รายการรอตรวจสอบ
  await db.doc('vehicleDetails/veh-29').set({ id: 'veh-29', color: 'ดำ', brand: 'TOYOTA' })
  // วันจดทะเบียน (ยังไม่มีวันหมดอายุ) — ไว้ทดสอบปุ่ม "ตั้งวันหมดอายุจากวันจดทะเบียน"
  await db.doc('vehicleDetails/veh-37').set({ id: 'veh-37', registrationDate: '2025-04-10' })
  await db.doc('vehicleDetails/veh-new').set({ id: 'veh-new', registrationDate: '2016-10-28' })

  // สถานะ พ.ร.บ./ภาษี ครบทุกแบบ (วันอิงวันนี้ตอนรัน seed)
  const C = (tax: object | undefined, act: object | undefined, responsibleName?: string) => ({
    ...(tax ? { tax } : {}),
    ...(act ? { act } : {}),
    ...(responsibleName ? { responsibleName } : {}),
  })
  const conf = (days: number) => ({ expiry: isoPlus(days), confirmed: true, confirmedBy: 'seed', workStatus: 'none' })
  const seeds: Record<string, object> = {
    'veh-28': C(conf(-3), conf(-3), 'คุณเอ'), // เกินกำหนด
    'veh-29': C(conf(0), conf(40), 'คุณเอ'), // ภาษีครบวันนี้
    'veh-30': C(conf(1), conf(1), 'คุณบี'), // พรุ่งนี้
    'veh-33': C({ ...conf(6), workStatus: 'in_progress' }, conf(200)), // กำลังดำเนินการ แต่ยังต้องเตือน
    'veh-34': C(conf(14), conf(29), 'คุณบี'),
    'veh-35': C({ expiry: isoPlus(20), confirmed: false }, undefined), // รอยืนยัน → ไม่เตือน
    'veh-36': C(conf(120), conf(120)), // ปกติ
    // veh-37, veh-dup*, veh-new → ยังไม่มีข้อมูล
  }
  for (const [id, data] of Object.entries(seeds)) await db.doc(`vehicleCompliance/${id}`).set({ id, ...data })

  console.log(`seeded: ${TEST_USERS.length} users, ${VEHICLES.length} vehicles, ${Object.keys(seeds).length} compliance docs`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

/**
 * เทสต์ firestore.rules กับ Firestore Emulator
 * รัน: npm run test:rules   (firebase emulators:exec จะเปิด/ปิด emulator ให้เอง — ต้องมี Java)
 *
 * ทุกเคสใช้ project "demo-lotus-eme" → ไม่แตะ Firebase จริง
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  setLogLevel,
  updateDoc,
  writeBatch,
  where,
  type Firestore,
} from 'firebase/firestore'
import { updateTripWithQueueGuard } from '../../src/lib/tripQueueGuard'

let env: RulesTestEnvironment

// อีเมลที่เคยฝังในแอปให้ตั้งตัวเองเป็นแอดมินได้ — ถอดแล้ว ต้องตั้งไม่ได้
const FORMER_BOOTSTRAP_EMAIL = 'ownchang@hotmail.com'

// บัญชีตัวอย่าง (uid → users doc)
const PROFILES = {
  admin: { role: 'admin', active: true },
  dispatcher: { role: 'dispatcher', active: true },
  viewer: { role: 'viewer', active: true },
  otherViewer: { role: 'viewer', active: true },
  pendingViewer: { role: 'viewer', active: false, pending: true },
  inactiveDispatcher: { role: 'dispatcher', active: false },
} as const

type Uid = keyof typeof PROFILES

const as = (uid: Uid | 'noProfile', email = `${uid}@example.com`) =>
  env.authenticatedContext(uid, { email }).firestore()
const anon = () => env.unauthenticatedContext().firestore()

beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Use only isolated demo Firestore on localhost8080')
  setLogLevel('silent')
  env = await initializeTestEnvironment({
    projectId: 'demo-lotus-eme',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

describe('ประวัติ/หลักฐานต่ออายุรถเพิ่มได้อย่างเดียว', () => {
  const collections = ['vehicleComplianceHistory', 'vehicleComplianceEvidence']
  it.each(['admin', 'dispatcher'] as Uid[])('ผู้มีสิทธิ์ %s ต่ออายุแบบ batch พร้อมหลักฐานได้', async uid => {
    const db = as(uid), batch = writeBatch(db)
    batch.set(doc(db, 'vehicles', 'V1'), { licensePlate: 'TEST', taxExpiry: '2027-10-06' }, { merge: true })
    for (const name of collections) batch.set(doc(db, name, 'NEW'), { vehicleId: 'V1', uploadedBy: uid, recordedAt: '2026-10-06' })
    await assertSucceeds(batch.commit())
    for (const name of collections) {
      await assertSucceeds(getDoc(doc(as(uid), name, 'NEW')))
      await assertFails(getDoc(doc(as('viewer'), name, 'NEW'))) // ข้อมูลรถ/พ.ร.บ. = staff เท่านั้น
    }
  })
  it.each(['admin', 'dispatcher'] as Uid[])('ผู้มีสิทธิ์ %s ห้ามแก้/เขียนทับ/ลบประวัติที่มีอยู่', async uid => {
    await env.withSecurityRulesDisabled(async ctx => {
      for (const name of collections) await setDoc(doc(ctx.firestore(), name, 'OLD'), { vehicleId: 'V1', legacy: true, value: 'original' })
    })
    for (const name of collections) {
      const ref = doc(as(uid), name, 'OLD')
      await assertFails(updateDoc(ref, { value: 'changed' }))
      await assertFails(setDoc(ref, { value: 'overwritten' }))
      await assertFails(setDoc(ref, { value: 'merged' }, { merge: true }))
      await assertFails(deleteDoc(ref))
      await assertSucceeds(getDoc(ref))
    }
  })
  it.each(['viewer', 'pendingViewer', 'inactiveDispatcher', 'noProfile'] as const)('%s เพิ่มประวัติ/หลักฐานไม่ได้', async uid => {
    for (const name of collections) await assertFails(setDoc(doc(as(uid), name, 'NEW'), { vehicleId: 'V1' }))
  })
  it('คนไม่ล็อกอินอ่าน/เพิ่มไม่ได้ และ batch ที่แก้ประวัติเก่าปฏิเสธทั้งก้อน', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      for (const name of collections) await setDoc(doc(ctx.firestore(), name, 'OLD'), { vehicleId: 'V1', value: 'original' })
      await setDoc(doc(ctx.firestore(), 'vehicles', 'V1'), { licensePlate: 'TEST', taxExpiry: '2026-10-06' })
    })
    for (const name of collections) {
      await assertFails(getDoc(doc(anon(), name, 'OLD')))
      await assertFails(setDoc(doc(anon(), name, 'NEW'), { vehicleId: 'V1' }))
    }
    const db = as('dispatcher'), batch = writeBatch(db)
    batch.update(doc(db, 'vehicles', 'V1'), { taxExpiry: '2027-10-06' })
    batch.update(doc(db, 'vehicleComplianceHistory', 'OLD'), { value: 'changed' })
    await assertFails(batch.commit())
    await env.withSecurityRulesDisabled(async ctx => {
      const snap = await getDoc(doc(ctx.firestore(), 'vehicles', 'V1'))
      if (snap.data()?.taxExpiry !== '2026-10-06') throw new Error('Denied batch changed the car')
    })
  })
})

afterAll(async () => {
  await env?.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const [uid, p] of Object.entries(PROFILES)) {
      await setDoc(doc(db, 'users', uid), { id: uid, email: `${uid}@example.com`, name: uid, ...p })
    }
    await setDoc(doc(db, 'trips', 'TRIP-1'), { tripId: 'TRIP-1', tripDate: '2026-10-05', driverId: 'D1', status: 'Planned' })
    await setDoc(doc(db, 'drivers', 'D1'), { name: 'อ๊อฟ', phoneNumber: '0800000000' })
    await setDoc(doc(db, 'vehicleRequests', 'VR-OTHER'), { userId: 'otherViewer', requestDate: '2026-10-05', status: 'pending' })
    await setDoc(doc(db, 'vehicleRequests', 'VR-MINE'), { userId: 'viewer', requestDate: '2026-10-05', status: 'pending' })
    await setDoc(doc(db, 'companySettings', 'default'), { dieselPrice: 30 })
  })
})

describe('users — ห้ามยกระดับสิทธิ์ตัวเอง', () => {
  it('viewer ตั้ง role ตัวเองเป็น admin ไม่ได้', async () => {
    await assertFails(updateDoc(doc(as('viewer'), 'users', 'viewer'), { role: 'admin' }))
    await assertFails(setDoc(doc(as('viewer'), 'users', 'viewer'), { role: 'admin', active: true }, { merge: true }))
  })

  it('viewer ตั้ง role เป็น dispatcher / เปิด active ตัวเอง ไม่ได้', async () => {
    await assertFails(updateDoc(doc(as('viewer'), 'users', 'viewer'), { role: 'dispatcher' }))
    await assertFails(updateDoc(doc(as('pendingViewer'), 'users', 'pendingViewer'), { active: true, pending: false }))
  })

  it('dispatcher ตั้ง role ตัวเองเป็น admin ไม่ได้', async () => {
    await assertFails(updateDoc(doc(as('dispatcher'), 'users', 'dispatcher'), { role: 'admin' }))
  })

  it('viewer แก้ชื่อ/เบอร์ตัวเองได้ (หน้า profile)', async () => {
    await assertSucceeds(updateDoc(doc(as('viewer'), 'users', 'viewer'), {
      name: 'ชื่อใหม่', phone: '0811111111', updatedAt: serverTimestamp(),
    }))
  })

  it('viewer แก้ users ของคนอื่นไม่ได้ / อ่าน users ทั้งหมดไม่ได้ แต่อ่านของตัวเองได้', async () => {
    await assertFails(updateDoc(doc(as('viewer'), 'users', 'otherViewer'), { name: 'x' }))
    await assertFails(getDocs(collection(as('viewer'), 'users')))
    await assertSucceeds(getDoc(doc(as('viewer'), 'users', 'viewer')))
  })

  it('บัญชีรออนุมัติอ่าน users doc ตัวเองได้ (หน้า login เช็ก active)', async () => {
    await assertSucceeds(getDoc(doc(as('pendingViewer'), 'users', 'pendingViewer')))
  })

  it('admin เปลี่ยน role / อนุมัติ / ลบ ผู้ใช้อื่นได้ และ list users ได้', async () => {
    const db = as('admin')
    await assertSucceeds(updateDoc(doc(db, 'users', 'viewer'), { role: 'dispatcher', updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(doc(db, 'users', 'pendingViewer'), { active: true, pending: false }))
    await assertSucceeds(getDocs(query(collection(db, 'users'), where('pending', '==', true))))
    await assertSucceeds(deleteDoc(doc(db, 'users', 'otherViewer')))
  })

  it('dispatcher เปลี่ยน role คนอื่นไม่ได้', async () => {
    await assertFails(updateDoc(doc(as('dispatcher'), 'users', 'viewer'), { role: 'admin' }))
  })

  it('สมัครใหม่: สร้าง users doc ตัวเองเป็น viewer ที่รออนุมัติได้', async () => {
    await assertSucceeds(setDoc(doc(as('noProfile'), 'users', 'noProfile'), {
      id: 'noProfile', email: 'noProfile@example.com', name: 'ใหม่', phone: '',
      role: 'viewer', active: false, pending: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }))
  })

  it('สมัครใหม่: สร้างตัวเองเป็น admin / dispatcher / viewer ที่ active เองไม่ได้', async () => {
    const db = as('noProfile')
    const ref = doc(db, 'users', 'noProfile')
    await assertFails(setDoc(ref, { role: 'admin', active: true }))
    await assertFails(setDoc(ref, { role: 'dispatcher', active: false }))
    await assertFails(setDoc(ref, { role: 'viewer', active: true }))
  })

  it('ไม่มีอีเมลไหนตั้งตัวเองเป็น admin ได้ (รวมอีเมลที่เคยฝังในแอป) · admin เดิมยังเป็น admin', async () => {
    const db = env.authenticatedContext('ownerUid', { email: FORMER_BOOTSTRAP_EMAIL }).firestore()
    await assertFails(setDoc(doc(db, 'users', 'ownerUid'), { role: 'admin', active: true }))
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'users', 'ownerUid'), { role: 'viewer', active: false, pending: true }))
    await assertFails(updateDoc(doc(db, 'users', 'ownerUid'), { role: 'admin', active: true }))
    await assertSucceeds(updateDoc(doc(as('admin'), 'users', 'viewer'), { name: 'แอดมินยังแก้ได้' }))
  })
})

describe('drivers / ข้อมูลหลัก — เขียนได้เฉพาะ staff', () => {
  const driver = { name: 'คนขับใหม่', phoneNumber: '0899999999' }

  it('viewer เขียน drivers ไม่ได้ (สร้าง/แก้/ลบ)', async () => {
    const db = as('viewer')
    await assertFails(setDoc(doc(db, 'drivers', 'D2'), driver))
    await assertFails(updateDoc(doc(db, 'drivers', 'D1'), { phoneNumber: '0' }))
    await assertFails(deleteDoc(doc(db, 'drivers', 'D1')))
  })

  it('dispatcher และ admin เขียน drivers ได้', async () => {
    await assertSucceeds(setDoc(doc(as('dispatcher'), 'drivers', 'D2'), driver))
    await assertSucceeds(updateDoc(doc(as('admin'), 'drivers', 'D1'), { phoneNumber: '0811111111' }))
    await assertSucceeds(deleteDoc(doc(as('admin'), 'drivers', 'D2')))
  })

  it('dispatcher ที่ถูกระงับ (active=false) เขียน drivers ไม่ได้', async () => {
    await assertFails(setDoc(doc(as('inactiveDispatcher'), 'drivers', 'D2'), driver))
  })

  it('viewer เขียน vehicles / companySettings / trips ไม่ได้ แต่ staff ได้', async () => {
    await assertFails(setDoc(doc(as('viewer'), 'vehicles', 'V1'), { plate: '1กก-1111' }))
    await assertFails(setDoc(doc(as('viewer'), 'companySettings', 'default'), { dieselPrice: 1 }, { merge: true }))
    await assertFails(updateDoc(doc(as('viewer'), 'trips', 'TRIP-1'), { status: 'Cancelled' }))
    await assertSucceeds(setDoc(doc(as('dispatcher'), 'vehicles', 'V1'), { plate: '1กก-1111' }))
    await assertSucceeds(setDoc(doc(as('dispatcher'), 'companySettings', 'default'), { dieselPrice: 31 }, { merge: true }))
    await assertSucceeds(updateTripWithQueueGuard(as('dispatcher') as unknown as Firestore, 'TRIP-1', { status: 'In Progress' }))
  })

  it('ฝั่ง client เขียน collection ที่ server เขียนเท่านั้นไม่ได้ แม้เป็น admin', async () => {
    await assertFails(setDoc(doc(as('admin'), 'vehiclePositions', 'dev1'), { lat: 1 }))
    await assertFails(setDoc(doc(as('admin'), 'dieselPriceHistory', '2026-10-03'), { price: 30 }))
  })

  it('collection ที่ไม่ได้ระบุในกฎ ถูกปฏิเสธ', async () => {
    await assertFails(setDoc(doc(as('admin'), 'randomCollection', 'x'), { a: 1 }))
    await assertFails(getDoc(doc(as('admin'), 'randomCollection', 'x')))
  })
})

describe('vehicleRequests — viewer ยังขอรถของตัวเองได้', () => {
  const newRequest = (userId: string, status = 'pending') => ({
    requestDate: '2026-10-05', requestTime: '08:30', requestedBy: 'ผู้ขอ',
    userId, destinations: [], note: '', status, createdAt: serverTimestamp(),
  })

  it('viewer อ่านใบคนอื่น / นับใบทั้งวัน / เช็กเลข VR ของคนอื่นไม่ได้ (การออกเลขอยู่ที่ server แล้ว)', async () => {
    const db = as('viewer')
    await assertFails(getDocs(query(collection(db, 'vehicleRequests'), where('requestDate', '==', '2026-10-05'))))
    await assertFails(getDoc(doc(db, 'vehicleRequests', 'VR-OTHER')))
    await assertFails(getDocs(collection(db, 'vehicleRequests')))
  })

  it('viewer อ่าน "คำขอของฉัน" (where userId ==) และใบตัวเองได้', async () => {
    const db = as('viewer')
    await assertSucceeds(getDocs(query(collection(db, 'vehicleRequests'), where('userId', '==', 'viewer'))))
    await assertSucceeds(getDocs(query(collection(db, 'vehicleRequests'), where('userId', '==', 'viewer'), where('status', '==', 'pending'))))
    await assertSucceeds(getDoc(doc(db, 'vehicleRequests', 'VR-MINE')))
  })

  it('viewer สร้างใบตรงจาก client ไม่ได้ทุกกรณี (ต้องผ่าน /api/vehicle-requests)', async () => {
    await assertFails(setDoc(doc(as('viewer'), 'vehicleRequests', 'VR-X'), newRequest('viewer')))
    await assertFails(setDoc(doc(as('viewer'), 'vehicleRequests', 'VR-X'), newRequest('otherViewer')))
    await assertFails(setDoc(doc(as('viewer'), 'vehicleRequests', 'VR-X'), newRequest('viewer', 'in_progress')))
  })

  it('บัญชีรออนุมัติ / ไม่มี users doc สร้างใบขอรถไม่ได้', async () => {
    await assertFails(setDoc(doc(as('pendingViewer'), 'vehicleRequests', 'VR-X'), newRequest('pendingViewer')))
    await assertFails(setDoc(doc(as('noProfile'), 'vehicleRequests', 'VR-X'), newRequest('noProfile')))
  })

  it('viewer ยกเลิกใบของตัวเองได้ แต่ยกเลิกใบคนอื่น / อนุมัติใบตัวเองไม่ได้', async () => {
    const db = as('viewer')
    await assertSucceeds(updateDoc(doc(db, 'vehicleRequests', 'VR-MINE'), {
      status: 'cancelled', cancelledAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }))
    await assertFails(updateDoc(doc(db, 'vehicleRequests', 'VR-OTHER'), { status: 'cancelled', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'vehicleRequests', 'VR-MINE'), { status: 'in_progress' }))
    await assertFails(updateDoc(doc(db, 'vehicleRequests', 'VR-MINE'), { status: 'cancelled', userId: 'otherViewer' }))
    await assertFails(deleteDoc(doc(db, 'vehicleRequests', 'VR-MINE')))
  })

  it('staff สร้างใบ in_progress / รับเรื่อง / ลบ ได้', async () => {
    const db = as('dispatcher')
    await assertSucceeds(setDoc(doc(db, 'vehicleRequests', 'VR-STAFF'), newRequest('dispatcher', 'in_progress')))
    await assertSucceeds(updateDoc(doc(db, 'vehicleRequests', 'VR-OTHER'), { status: 'in_progress', acknowledgedBy: 'คนจัดรถ' }))
    await assertSucceeds(deleteDoc(doc(db, 'vehicleRequests', 'VR-STAFF')))
  })

  it('viewer ขออนุมัติเร่งด่วนของตัวเองได้ แต่อนุมัติเองไม่ได้', async () => {
    const db = as('viewer')
    await assertSucceeds(setDoc(doc(db, 'urgentRequests', 'U1'), {
      id: 'U1', userId: 'viewer', requestedDate: '2026-10-04', status: 'pending', createdAt: serverTimestamp(),
    }))
    await assertSucceeds(getDocs(query(collection(db, 'urgentRequests'),
      where('userId', '==', 'viewer'), where('requestedDate', '==', '2026-10-04'))))
    await assertFails(updateDoc(doc(db, 'urgentRequests', 'U1'), { status: 'approved' }))
    await assertFails(setDoc(doc(db, 'urgentRequests', 'U2'), { userId: 'viewer', status: 'approved' }))
    await assertSucceeds(updateDoc(doc(as('dispatcher'), 'urgentRequests', 'U1'), { status: 'approved' }))
  })

  it('viewer แนบปลายทาง/งาน/เบอร์กับคำขออนุมัติพิเศษได้ แต่ข้อความยาวเกินหรือไม่ใช่ข้อความถูกปฏิเสธ', async () => {
    const db = as('viewer')
    const base = { userId: 'viewer', requestedDate: '2026-10-15', status: 'pending', destination: 'ไซต์บางนา', jobSummary: 'ส่งท่อ 10 เส้น', contactPhone: '081-234-5678' }
    await assertSucceeds(setDoc(doc(db, 'urgentRequests', 'U-OK'), base))
    await assertSucceeds(setDoc(doc(db, 'urgentRequests', 'U-OLD'), { userId: 'viewer', requestedDate: '2026-10-15', status: 'pending' }))
    for (const bad of [{ destination: 'x'.repeat(201) }, { jobSummary: 'x'.repeat(501) }, { contactPhone: '0'.repeat(31) }, { contactPhone: 812345678 }]) {
      await assertFails(setDoc(doc(db, 'urgentRequests', 'U-BAD'), { ...base, ...bad }))
    }
  })

  it('viewer อ่านขออนุมัติเร่งด่วนของคนอื่นไม่ได้', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'urgentRequests', 'U-OTHER'), { userId: 'otherViewer', requestedDate: '2026-10-04', status: 'pending' }))
    await assertFails(getDoc(doc(as('viewer'), 'urgentRequests', 'U-OTHER')))
    await assertFails(getDocs(query(collection(as('viewer'), 'urgentRequests'), where('status', '==', 'pending'))))
    await assertSucceeds(getDocs(query(collection(as('dispatcher'), 'urgentRequests'), where('status', '==', 'pending'))))
  })

  it('viewer สร้าง/แก้/ลบสถานที่จาก client ไม่ได้ (สถานที่ใหม่จากฟอร์มขอรถไปทาง server)', async () => {
    const db = as('viewer')
    await assertFails(setDoc(doc(db, 'sites', 'S-OFFICIAL'), { name: 'x', status: 'Active' }))
    await assertFails(setDoc(doc(db, 'sites', 'S-USER'), { name: 'ร้านใหม่', latitude: 14, longitude: 100, isUserAdded: true }))
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'sites', 'S1'), { name: 'คลัง' }))
    await assertFails(updateDoc(doc(db, 'sites', 'S1'), { name: 'y' }))
    await assertFails(deleteDoc(doc(db, 'sites', 'S1')))
  })
})

describe('ใบงานคนขับจากลิงก์ LINE ไม่ใช้การอ่าน Firestore แบบ public แล้ว (ผ่าน /api/driver-ticket)', () => {
  it('anonymous อ่าน trips (doc / query รายเดือน / ทั้ง collection), stops และ drivers ไม่ได้', async () => {
    const db = anon()
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'trips', 'TRIP-1', 'stops', 'S0'), { siteName: 'x' }))
    await assertFails(getDoc(doc(db, 'trips', 'TRIP-1')))
    await assertFails(getDocs(query(collection(db, 'trips'),
      where('tripDate', '>=', '2026-10-01'), where('tripDate', '<=', '2026-10-31'))))
    await assertFails(getDocs(collection(db, 'trips')))
    await assertFails(getDoc(doc(db, 'trips', 'TRIP-1', 'stops', 'S0')))
    await assertFails(getDocs(collection(db, 'trips', 'TRIP-1', 'stops')))
    await assertFails(getDoc(doc(db, 'drivers', 'D1')))
    await assertFails(getDocs(collection(db, 'drivers')))
  })

  it('anonymous เขียน trips/drivers หรืออ่านข้อมูลภายในไม่ได้', async () => {
    const db = anon()
    await assertFails(updateDoc(doc(db, 'trips', 'TRIP-1'), { status: 'Cancelled' }))
    await assertFails(setDoc(doc(db, 'drivers', 'D9'), { name: 'x' }))
    await assertFails(getDoc(doc(db, 'vehicleRequests', 'VR-MINE')))
    await assertFails(getDoc(doc(db, 'users', 'admin')))
  })
})

describe('ตารางสิทธิ์อ่าน: ไม่ล็อกอิน / รออนุมัติ / ไม่มีโปรไฟล์ / viewer / dispatcher / admin', () => {
  type Who = 'anon' | 'pendingViewer' | 'inactiveDispatcher' | 'noProfile' | 'viewer' | 'dispatcher' | 'admin'
  const db = (who: Who) => who === 'anon' ? anon() : as(who)
  const ACTIVE: Who[] = ['viewer', 'dispatcher', 'admin']
  const STAFF: Who[] = ['dispatcher', 'admin']
  const EVERYONE: Who[] = ['anon', 'pendingViewer', 'inactiveDispatcher', 'noProfile', 'viewer', 'dispatcher', 'admin']

  // collection → ใครอ่านได้ (ทั้ง get และ list)
  const MATRIX: [string, Who[]][] = [
    ['trips', ACTIVE], ['drivers', ACTIVE], ['sites', ACTIVE], ['vehicles', ACTIVE], ['vehicleTypes', ACTIVE],
    ['companySettings', ACTIVE], ['vehiclePositions', ACTIVE], ['vehiclePositionTrails', ACTIVE], ['trackingDaily', ACTIVE],
    ['vehicleDetails', STAFF], ['vehicleCompliance', STAFF], ['vehicleComplianceHistory', STAFF],
    ['vehicleComplianceEvidence', STAFF], ['dieselPriceHistory', STAFF], ['queueResourceDays', STAFF],
    ['trackingMeta', []], ['driverLinks', []], ['vehicleRequestOperations', []], ['continuousBookings', []],
  ]

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      for (const [name] of MATRIX) await setDoc(doc(ctx.firestore(), name, 'X1'), { name: 'ทดสอบ', userId: 'viewer' })
      await setDoc(doc(ctx.firestore(), 'trips', 'TRIP-1', 'editLogs', 'L1'), { by: 'admin' })
      await setDoc(doc(ctx.firestore(), 'trips', 'TRIP-1', 'stops', 'S0'), { siteName: 'x' })
    })
  })

  for (const [name, allowed] of MATRIX) {
    it.each(EVERYONE)(`${name}: %s`, async (who) => {
      const expectRead = allowed.includes(who) ? assertSucceeds : assertFails
      await expectRead(getDoc(doc(db(who), name, 'X1')))
      await expectRead(getDocs(collection(db(who), name)))
    })
  }

  it.each(EVERYONE)('trips/{id}/editLogs อ่านได้เฉพาะบัญชีที่อนุมัติแล้ว · stops ไม่มีใครอ่าน: %s', async (who) => {
    const expectRead = ACTIVE.includes(who) ? assertSucceeds : assertFails
    await expectRead(getDocs(collection(db(who), 'trips', 'TRIP-1', 'editLogs')))
    await assertFails(getDocs(collection(db(who), 'trips', 'TRIP-1', 'stops')))
  })

  it.each(EVERYONE)('vehicleRequests: staff อ่านทั้งหมด · viewer เฉพาะของตัวเอง · ที่เหลืออ่านไม่ได้: %s', async (who) => {
    const all = () => getDocs(collection(db(who), 'vehicleRequests'))
    const mine = () => getDocs(query(collection(db(who), 'vehicleRequests'), where('userId', '==', who)))
    if (STAFF.includes(who)) { await assertSucceeds(all()); await assertSucceeds(mine()) }
    else if (who === 'viewer') { await assertFails(all()); await assertSucceeds(mine()) }
    else { await assertFails(all()); await assertFails(mine()) }
  })

  it.each(['anon', 'pendingViewer', 'inactiveDispatcher', 'noProfile'] as Who[])('%s สร้าง/แก้รายการธุรกิจไม่ได้', async (who) => {
    const d = db(who)
    await assertFails(setDoc(doc(d, 'vehicleRequests', 'VR-P'), { userId: who, status: 'pending' }))
    await assertFails(setDoc(doc(d, 'urgentRequests', 'U-P'), { userId: who, status: 'pending' }))
    await assertFails(setDoc(doc(d, 'sites', 'S-P'), { name: 'x', isUserAdded: true }))
    await assertFails(updateDoc(doc(d, 'vehicleRequests', 'VR-MINE'), { status: 'cancelled' }))
    await assertFails(setDoc(doc(d, 'trips', 'T-P'), { tripDate: '2026-10-05', driverId: 'D1', status: 'Planned' }))
  })

  it('บัญชีรออนุมัติอ่านได้แค่โปรไฟล์ตัวเอง และเปิด active / ยก role ตัวเองไม่ได้', async () => {
    const d = as('pendingViewer')
    await assertSucceeds(getDoc(doc(d, 'users', 'pendingViewer')))
    await assertFails(getDoc(doc(d, 'users', 'viewer')))
    await assertFails(updateDoc(doc(d, 'users', 'pendingViewer'), { active: true }))
    await assertFails(updateDoc(doc(d, 'users', 'pendingViewer'), { role: 'admin' }))
    await assertFails(updateDoc(doc(as('inactiveDispatcher'), 'users', 'inactiveDispatcher'), { active: true }))
  })
})

describe('sites — ตรวจชนิด/ความยาว/พิกัดที่ rules (ไม่พึ่งแค่ฟอร์ม)', () => {
  const site = (extra: Record<string, unknown> = {}) => ({ name: 'ไซต์ทดสอบ', address: 'ถนนทดสอบ', latitude: 13.75, longitude: 100.5, projectTypeTag: 'ไซต์งาน', status: 'Active', ...extra })

  it('staff บันทึกชื่อภาษาไทย/ที่อยู่/พิกัด และชื่อที่มี markup (เก็บเป็นข้อความ) ได้', async () => {
    const d = as('dispatcher')
    await assertSucceeds(setDoc(doc(d, 'sites', 'S-TH'), site()))
    await assertSucceeds(setDoc(doc(d, 'sites', 'S-XSS'), site({ name: '<img src=x onerror=alert(1)>' })))
    await assertSucceeds(updateDoc(doc(d, 'sites', 'S-TH'), { address: 'ที่อยู่ใหม่', latitude: -12.5 }))
  })

  it('ชื่อว่าง/ยาวเกิน/ไม่ใช่ข้อความ, ที่อยู่ยาวเกิน, พิกัดนอกช่วงหรือไม่ใช่ตัวเลข → ปฏิเสธ', async () => {
    const d = as('admin')
    for (const bad of [
      { name: '' }, { name: 'ก'.repeat(201) }, { name: 123 }, { address: 'x'.repeat(1001) },
      { latitude: 91 }, { longitude: -181 }, { latitude: '13.7' }, { projectTypeTag: 'x'.repeat(61) },
    ]) await assertFails(setDoc(doc(d, 'sites', 'S-BAD'), site(bad)))
    await assertSucceeds(setDoc(doc(d, 'sites', 'S-OK'), site()))
    await assertFails(updateDoc(doc(d, 'sites', 'S-OK'), { name: 'ก'.repeat(201) }))
  })

  it('สถานที่เก่าที่ข้อมูลไม่ตรงรูปแบบ ยังแก้ฟิลด์อื่นได้ แต่ใส่ค่าผิดรูปแบบใหม่ไม่ได้', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'sites', 'S-LEGACY'), site({ latitude: 200, projectTypeTag: 'x'.repeat(80) })))
    const d = as('dispatcher')
    await assertSucceeds(updateDoc(doc(d, 'sites', 'S-LEGACY'), { name: 'ชื่อใหม่', address: 'ที่อยู่ใหม่', updatedAt: serverTimestamp() }))
    await assertSucceeds(setDoc(doc(d, 'sites', 'S-LEGACY'), { name: 'ชื่อใหม่', status: 'Active' }, { merge: true }))
    await assertSucceeds(updateDoc(doc(d, 'sites', 'S-LEGACY'), { latitude: 13.7 }))
    await assertFails(updateDoc(doc(d, 'sites', 'S-LEGACY'), { longitude: 999 }))
    await assertFails(updateDoc(doc(d, 'sites', 'S-LEGACY'), { name: '' }))
  })
})

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
  where,
  type Firestore,
} from 'firebase/firestore'
import { updateTripWithQueueGuard } from '../../src/lib/tripQueueGuard'

let env: RulesTestEnvironment

const ADMIN_EMAIL = 'ownchang@hotmail.com'

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
  setLogLevel('silent')
  env = await initializeTestEnvironment({
    projectId: 'demo-lotus-eme',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
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

  it('อีเมลแอดมินที่ hardcode ในแอป สร้าง/กู้ users doc ตัวเองเป็น admin ได้', async () => {
    const db = env.authenticatedContext('ownerUid', { email: ADMIN_EMAIL }).firestore()
    await assertSucceeds(setDoc(doc(db, 'users', 'ownerUid'), { role: 'admin', active: true }))
    await assertSucceeds(updateDoc(doc(db, 'users', 'ownerUid'), { role: 'admin', active: true }))
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

  it('viewer ทำ flow ส่งใบขอรถได้ครบ: นับใบทั้งวัน + เช็กเลขซ้ำใน transaction + สร้างใบ + สถานที่ใหม่', async () => {
    const db = as('viewer')
    // RequestForm: นับใบของวันนั้นทั้งหมดเพื่อออกเลข VR
    await assertSucceeds(getDocs(query(collection(db, 'vehicleRequests'), where('requestDate', '==', '2026-10-05'))))
    // RequestForm: ธุรกรรมเช็กเลขว่าง + สร้างสถานที่ใหม่ + สร้างใบ
    await assertSucceeds(runTransaction(db, async (t) => {
      const snap = await t.get(doc(db, 'vehicleRequests', 'VR-NEW'))
      if (snap.exists()) throw new Error('id taken')
      for (const id of ['S-NEW-1', 'S-NEW-2']) {
        t.set(doc(db, 'sites', id), {
          name: id, latitude: 14, longitude: 100, address: '', status: 'Active',
          isUserAdded: true, addedBy: 'viewer@example.com', createdAt: serverTimestamp(),
        })
      }
      t.set(doc(db, 'vehicleRequests', 'VR-NEW'), { ...newRequest('viewer'), id: 'VR-NEW', requestId: 'VR-NEW' })
    }))
  })

  it('viewer อ่าน "คำขอของฉัน" (where userId ==) ได้', async () => {
    await assertSucceeds(getDocs(query(collection(as('viewer'), 'vehicleRequests'), where('userId', '==', 'viewer'))))
  })

  it('viewer สร้างใบในชื่อคนอื่น หรือสร้างแบบข้ามคิว (in_progress) ไม่ได้', async () => {
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

  it('viewer แก้/ลบสถานที่ หรือสร้างสถานที่แบบ "ทางการ" (ไม่ติด isUserAdded) ไม่ได้', async () => {
    const db = as('viewer')
    await assertFails(setDoc(doc(db, 'sites', 'S-OFFICIAL'), { name: 'x', status: 'Active' }))
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'sites', 'S1'), { name: 'คลัง' }))
    await assertFails(updateDoc(doc(db, 'sites', 'S1'), { name: 'y' }))
    await assertFails(deleteDoc(doc(db, 'sites', 'S1')))
  })
})

describe('ใบงานคนขับแบบ public (ไม่ login)', () => {
  it('anonymous อ่าน trips (doc + query ทั้งเดือน) และ drivers ได้', async () => {
    const db = anon()
    await assertSucceeds(getDoc(doc(db, 'trips', 'TRIP-1')))
    await assertSucceeds(getDocs(query(collection(db, 'trips'),
      where('tripDate', '>=', '2026-10-01'), where('tripDate', '<=', '2026-10-31'))))
    await assertSucceeds(getDoc(doc(db, 'drivers', 'D1')))
  })

  it('anonymous เขียน trips/drivers หรืออ่านข้อมูลภายในไม่ได้', async () => {
    const db = anon()
    await assertFails(updateDoc(doc(db, 'trips', 'TRIP-1'), { status: 'Cancelled' }))
    await assertFails(setDoc(doc(db, 'drivers', 'D9'), { name: 'x' }))
    await assertFails(getDoc(doc(db, 'vehicleRequests', 'VR-MINE')))
    await assertFails(getDoc(doc(db, 'users', 'admin')))
  })
})

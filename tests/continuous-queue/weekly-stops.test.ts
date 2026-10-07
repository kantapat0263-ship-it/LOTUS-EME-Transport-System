import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { Firestore } from 'firebase-admin/firestore'
import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/reports/weekly-stops/route'
import { POST as reviewPOST } from '@/app/api/reports/weekly-stops/review/route'
import { readWeeklyStopReport, saveStopReview } from '@/server/weeklyStopService'
import type { StopReviewCommand } from '@/server/weeklyStopValidation'

let db: Firestore
let app: FirebaseApp, authUid: string, header: string
const project = 'demo-weekly-driver-stops'
const date = '2026-10-05', start = Date.parse(`${date}T08:00:00+07:00`)
const points = [...Array.from({ length: 61 }, (_, i) => ({ lat: 15 + i * .003, lng: 101, t: start + i * 60_000, sp: 60 })), ...Array.from({ length: 30 }, (_, i) => ({ lat: 15.18, lng: 101, t: start + (61 + i) * 60_000, sp: 0 }))]
beforeAll(async () => {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Local emulator only')
  db = new Firestore({ projectId: project, credentials: { client_email: 'test@demo.invalid', private_key: 'local-only' } })
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099')
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_BASE64', Buffer.from(JSON.stringify({ project_id: project, client_email: `test@${project}.iam.gserviceaccount.com`, private_key: privateKey })).toString('base64'))
  app = initializeApp({ projectId: project, apiKey: 'fake-test-key' }, randomUUID())
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const result = await createUserWithEmailAndPassword(auth, `${randomUUID()}@test.local`, 'local-only-password')
  authUid = result.user.uid; header = `Bearer ${await result.user.getIdToken()}`
})
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' })
  await Promise.all([
    db.doc('users/admin').set({ role: 'admin', active: true, name: 'ชื่อจริง' }),
    db.doc('trips/t1').set({ tripId: 'T-0510-0001', tripDate: date, driverId: 'd1', driverName: 'สมคิด', vehiclePlate: '40-1000', vehicleId: 'v1', stops: [], status: 'Completed', sourceVRIds: ['VR-0510-0001'], fuelCost: 300, totalDistanceKm: 50 }),
    db.doc(`vehiclePositionTrails/${date}__gps1`).set({ deviceId: 'gps1', licensePlate: '40-1000', date, points }),
  ])
})
afterAll(async () => { await db?.terminate(); if (app) await deleteApp(app); vi.unstubAllEnvs() })
it('reads a bounded weekly report for active admins and gives evidence a stable fingerprint', async () => {
  const report = await readWeeklyStopReport(db, date, 'admin')
  expect(report).toMatchObject({ weekStart: date, weekEnd: '2026-10-11', drivers: [{ driverId: 'd1', reviewMin: 30 }] })
  expect(report.days[0].sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
  expect((await readWeeklyStopReport(db, date, 'admin')).days[0].sourceFingerprint).toBe(report.days[0].sourceFingerprint)
})
const command = async (patch: Partial<StopReviewCommand> = {}): Promise<StopReviewCommand> => {
  const day = (await readWeeklyStopReport(db, date, 'admin')).days[0]
  return { operationId: randomUUID(), weekStart: date, dayKey: day.key, eventId: day.events[0].eventId, sourceFingerprint: day.sourceFingerprint, expectedVersion: day.events[0].review?.version ?? 0, excluded: true, reason: 'แวะส่งเอกสารที่ผู้จัดสั่ง', ...patch }
}
it('records an admin explanation and excludes only review time without modifying source records', async () => {
  const tripBefore = (await db.doc('trips/t1').get()).data(), trailBefore = (await db.doc(`vehiclePositionTrails/${date}__gps1`).get()).data()
  await expect(saveStopReview(db, await command(), 'admin')).resolves.toMatchObject({ version: 1 })
  const report = await readWeeklyStopReport(db, date, 'admin')
  expect(report.drivers[0]).toMatchObject({ reviewMin: 0, excludedMin: 30, minutesPer100Km: 0 })
  expect(report.days[0].events[0].review).toMatchObject({ reason: 'แวะส่งเอกสารที่ผู้จัดสั่ง', updatedBy: 'ชื่อจริง', version: 1 })
  expect((await db.doc('trips/t1').get()).data()).toEqual(tripBefore)
  expect((await db.doc(`vehiclePositionTrails/${date}__gps1`).get()).data()).toEqual(trailBefore)
  expect((await db.collection('driverStopReviewAudit').get()).docs.map(d => d.data())).toMatchObject([{ actorId: 'admin', actorName: 'ชื่อจริง', before: null, after: { excluded: true } }])
})
it('replays identical retries and concurrent requests with one immutable audit, but rejects reused operation IDs', async () => {
  const input = await command()
  const result = await Promise.all([saveStopReview(db, input, 'admin'), saveStopReview(db, input, 'admin')])
  expect(result).toContainEqual({ version: 1, replayed: true })
  expect((await db.collection('driverStopReviewAudit').get()).size).toBe(1)
  await expect(saveStopReview(db, input, 'admin')).resolves.toEqual({ version: 1, replayed: true })
  await expect(saveStopReview(db, { ...input, reason: 'เปลี่ยนคำสั่ง' }, 'admin')).rejects.toThrow('คำสั่ง')
})
it('revokes an exclusion with a new audited version and rejects a stale version from another tab', async () => {
  const original = await command()
  await saveStopReview(db, original, 'admin')
  await expect(saveStopReview(db, await command({ excluded: false, reason: 'ยกเลิกเหตุผลเดิม' }), 'admin')).resolves.toEqual({ version: 2 })
  expect((await readWeeklyStopReport(db, date, 'admin')).drivers[0].reviewMin).toBe(30)
  await expect(saveStopReview(db, { ...original, operationId: randomUUID() }, 'admin')).rejects.toThrow('อีกหน้าจอ')
  expect((await db.collection('driverStopReviewAudit').get()).size).toBe(2)
})
it('never applies an old exclusion after GPS evidence changed and still exposes its version for re-review', async () => {
  await saveStopReview(db, await command(), 'admin')
  await db.doc(`vehiclePositionTrails/${date}__gps1`).update({ points: [{ ...points[0], sp: 59 }, ...points.slice(1)] })
  const report = await readWeeklyStopReport(db, date, 'admin')
  expect(report.drivers[0].reviewMin).toBe(30)
  expect(report.days[0].events[0].review).toMatchObject({ version: 1, stale: true })
  await expect(saveStopReview(db, await command(), 'admin')).resolves.toMatchObject({ version: 2 })
})
it('rejects stale source and ambiguous driver ownership atomically', async () => {
  const input = await command()
  await db.doc('trips/t1').update({ actualDriverId: 'new-driver', actualDriverName: 'คนใหม่' })
  await expect(saveStopReview(db, input, 'admin')).rejects.toThrow('เปลี่ยน')
  expect((await db.collection('driverStopReviewAudit').get()).size).toBe(0)
  await db.doc('trips/t2').set({ ...(await db.doc('trips/t1').get()).data(), actualDriverId: 'another' })
  await expect(saveStopReview(db, input, 'admin')).rejects.toThrow('เปลี่ยน')
  expect((await db.collection('driverStopReviews').get()).size).toBe(0)
})
it.each([{ role: 'viewer', active: true }, { role: 'dispatcher', active: true }, { role: 'admin', active: false }])('denies current non-active-admin profile %j for reads, writes and replays', async profile => {
  const input = await command()
  await saveStopReview(db, input, 'admin')
  await db.doc('users/admin').update(profile)
  await expect(readWeeklyStopReport(db, date, 'admin')).rejects.toMatchObject({ status: 403 })
  await expect(saveStopReview(db, input, 'admin')).rejects.toMatchObject({ status: 403 })
  expect((await db.collection('driverStopReviewAudit').get()).size).toBe(1)
})
it('requires real active-admin authentication for both API methods and never returns private data to other roles', async () => {
  const request = (method: 'GET' | 'POST', token: string, body: unknown = { weekStart: date }) => new NextRequest('http://localhost/api/reports/weekly-stops', { method, headers: { Authorization: token }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) })
  const getResponse = await GET(request('GET', ''))
  expect(getResponse.status).toBe(405)
  expect(getResponse.headers.get('Cache-Control')).toBe('private, no-store')
  for (const token of ['', 'Bearer forged-token']) {
    expect((await POST(request('POST', token))).status).toBe(401)
    expect((await reviewPOST(request('POST', token))).status).toBe(401)
  }
  for (const profile of [{ role: 'viewer', active: true, status: 403 }, { role: 'dispatcher', active: true, status: 403 }, { role: 'admin', active: false, status: 401 }]) {
    await db.doc(`users/${authUid}`).set(profile)
    for (const response of [await POST(request('POST', header)), await reviewPOST(request('POST', header))]) {
      expect(response.status).toBe(profile.status)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(await response.json()).not.toHaveProperty('days')
    }
  }
  await db.doc(`users/${authUid}`).set({ role: 'admin', active: true, name: 'API admin' })
  expect((await POST(request('POST', header))).status).toBe(200)
  expect((await reviewPOST(request('POST', header))).status).toBe(400)
  const input = await command()
  expect((await reviewPOST(request('POST', header, input))).status).toBe(200)
  expect((await readWeeklyStopReport(db, date, authUid)).drivers[0].reviewMin).toBe(0)
})
it('the deployed rule source denies direct SDK reads and writes to reviews and immutable audits for every browser role', async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':')
  const env = await initializeTestEnvironment({ projectId: 'demo-weekly-stop-rules', firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') } })
  try {
    await env.clearFirestore()
    await env.withSecurityRulesDisabled(async context => {
      for (const role of ['admin', 'dispatcher', 'viewer']) await setDoc(doc(context.firestore(), 'users', role), { role, active: true })
      await setDoc(doc(context.firestore(), 'driverStopReviews', 'r1'), { reason: 'ข้อมูลส่วนตัว' })
      await setDoc(doc(context.firestore(), 'driverStopReviewAudit', 'a1'), { actorId: 'admin' })
    })
    for (const role of ['admin', 'dispatcher', 'viewer']) {
      const client = env.authenticatedContext(role).firestore()
      for (const collection of ['driverStopReviews', 'driverStopReviewAudit']) {
        await assertFails(getDoc(doc(client, collection, collection === 'driverStopReviews' ? 'r1' : 'a1')))
        await assertFails(setDoc(doc(client, collection, 'new'), { reason: 'ปลอม' }))
      }
    }
  } finally { await env.cleanup() }
})
it('aborting a real SDK transaction after staging the review and audit leaves both absent', async () => {
  const input = await command()
  const originalTransaction = db.runTransaction.bind(db)
  const failingDb = Object.create(db) as Firestore
  failingDb.runTransaction = async (callback: any) => originalTransaction(async tx => { await callback(tx); throw new Error('simulated precommit failure') })
  await expect(saveStopReview(failingDb, input, 'admin')).rejects.toThrow('precommit')
  expect((await db.collection('driverStopReviews').get()).size).toBe(0)
  expect((await db.collection('driverStopReviewAudit').get()).size).toBe(0)
})

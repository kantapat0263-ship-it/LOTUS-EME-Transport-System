import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where, type Firestore, type Transaction } from 'firebase/firestore'
import { incomingStopsForTrip } from './calculations'
import { resourceGuardKeys } from './continuousQueue'
import type { Trip } from '@/types/models'
import type { QueueSourceAssignment } from '@/types/continuous-queue'
import { remapStopNotes, type LegacyStopNotes } from './stopNote'
import { assertRequestDestinationsUnchanged } from './requestDestination'

const MANAGED_MESSAGE = 'คิวนี้เป็นคิวต่อเนื่อง กรุณาใช้แผงคิวต่อเนื่องเพื่อปรับเฉพาะวันและเก็บประวัติ'

export interface TripSourceAllocation {
  assignments: (QueueSourceAssignment & { tripStopIndexes?: number[] })[]
  metadata?: { approvedBy?: string; vehiclePlate?: string; driverName?: string; approvedAt?: any }
  expected?: { tripDate: string; driverId: string; vehicleId: string; stops: Trip['stops']; sourceVRIds?: string[] }
}

export interface TripStopEdit {
  expectedStops: Trip['stops']
  sourceIndexes: (number | null)[]
  supersedeRequest?: { id: string; by: string }
  createTarget?: { id: string; data: Record<string, any> }
  assistSource?: TripAssistSource
}

export interface TripAssistSource { tripId: string; stopIndex: number; expectedTrip: Trip }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export function assertTripStopsUnchanged(liveStops: Trip['stops'], expectedStops: Trip['stops']): void {
  const withoutNotes = (stops: Trip['stops']) => stops.map(({ dispatcherNote: _note, dispatcherName: _author, ...stop }) => stop)
  if (!Array.isArray(liveStops) || !Array.isArray(expectedStops) || canonical(withoutNotes(liveStops)) !== canonical(withoutNotes(expectedStops))) {
    throw new Error('รายการงานหรือผลปิดงานเปลี่ยนระหว่างแก้ไข กรุณาโหลดข้อมูลใหม่ก่อนบันทึก')
  }
}

async function sourceWrites(db: Firestore, tx: Transaction, trip: Trip, tripId: string, sources?: TripSourceAllocation, existingStopCount = 0) {
  const assignments = sources?.assignments || []
  if (assignments.length > 100) throw new Error('จำนวนใบขอมากเกินไป')
  if (assignments.length && trip.status === 'Cancelled') throw new Error('ทริปถูกยกเลิกแล้ว กรุณาเลือกคิวใหม่')
  const seen = new Set<string>()
  const noteTargets = new Set<number>()
  const writes = []
  for (const { requestId, destinationIndexes, tripStopIndexes, expectedDestinationFingerprints } of assignments) {
    if (seen.has(requestId)) throw new Error('เลือกใบขอซ้ำ')
    seen.add(requestId)
    const ref = doc(db, 'vehicleRequests', requestId)
    const snap = await tx.get(ref)
    const request = snap.data()
    if (!request || !['pending', 'in_progress', 'partial', 'rescheduled'].includes(request.status)) throw new Error('ใบขอถูกยกเลิกหรือเปลี่ยนสถานะแล้ว กรุณาเลือกงานใหม่')
    if (request.requestDate !== (trip.tripDate || (trip as Trip & { date?: string }).date)) throw new Error('วันที่ของใบขอเปลี่ยนแล้ว กรุณาเลือกงานใหม่')
    const assigned: number[] = request.assignedDestinations || []
    if (!Array.isArray(request.destinations) || !Array.isArray(assigned) || destinationIndexes.length === 0 || new Set(destinationIndexes).size !== destinationIndexes.length || destinationIndexes.some(index => !Number.isSafeInteger(index) || index < 0 || index >= request.destinations.length || assigned.includes(index))) throw new Error('จุดหมายถูกจัดรถแล้วหรือไม่พบในใบขอ กรุณาเลือกงานใหม่')
    if (tripStopIndexes !== undefined && (!Array.isArray(tripStopIndexes) || !Array.isArray(trip.stops) || tripStopIndexes.length !== destinationIndexes.length || tripStopIndexes.some(index => !Number.isSafeInteger(index) || index < existingStopCount || index >= trip.stops.length || noteTargets.has(index)))) throw new Error('ลำดับจุดสำหรับหมายเหตุไม่ตรงกับงานที่รวม กรุณาเลือกงานใหม่')
    if (tripStopIndexes && new Set(tripStopIndexes).size !== tripStopIndexes.length) throw new Error('เลือกจุดหมายเหตุซ้ำ กรุณาเลือกงานใหม่')
    assertRequestDestinationsUnchanged(request, destinationIndexes, expectedDestinationFingerprints)
    const noteUpdates = (tripStopIndexes || []).map((stopIndex, index) => {
      noteTargets.add(stopIndex)
      const key = `stop_${destinationIndexes[index]}`
      return { stopIndex, dispatcherNote: request.stopNotes?.[key] || '', dispatcherName: request.stopNoteAuthors?.[key] || request.stopNotesUpdatedBy || '' }
    })
    const humanId = request.requestId || request.vrId
    if (typeof humanId !== 'string' || !humanId) throw new Error('ใบขอไม่มีรหัสอ้างอิง')
    const newAssigned = [...new Set([...assigned, ...destinationIndexes])]
    const complete = newAssigned.length === request.destinations.length
    const previousTripIds: string[] = Array.isArray(request.tripIds) ? request.tripIds : request.tripId ? [request.tripId] : []
    writes.push({ ref, humanId, noteUpdates, patch: {
      ...sources?.metadata, assignedDestinations: newAssigned, status: complete ? 'approved' : 'partial',
      tripId: complete ? tripId : request.tripId || null, tripIds: [...new Set([...previousTripIds, tripId])], updatedAt: serverTimestamp(),
    } })
  }
  return writes
}

function sourceNotePatch(trip: Trip, requests: Awaited<ReturnType<typeof sourceWrites>>): Partial<Pick<Trip, 'stops'>> {
  const updates = new Map(requests.flatMap(request => request.noteUpdates.map(({ stopIndex, ...note }) => [stopIndex, note] as const)))
  if (!updates.size) return {}
  return { stops: trip.stops.map((stop, index) => updates.has(index) ? { ...stop, ...updates.get(index) } : stop) }
}

function checkExpected(trip: Trip, sources?: TripSourceAllocation) {
  const expected = sources?.expected
  if (expected && ((trip.tripDate || (trip as Trip & { date?: string }).date) !== expected.tripDate || (trip.actualDriverId || trip.driverId) !== expected.driverId || trip.vehicleId !== expected.vehicleId || canonical(trip.stops || []) !== canonical(expected.stops) || (expected.sourceVRIds !== undefined && canonical(trip.sourceVRIds || []) !== canonical(expected.sourceVRIds)))) throw new Error('ทริปเปลี่ยนระหว่างรวมงาน กรุณาโหลดข้อมูลและเลือกใหม่')
}

async function readGuards(db: Firestore, tx: Transaction, keys: string[]) {
  return Promise.all(keys.map(async key => {
    const ref = doc(db, 'queueResourceDays', key)
    const snap = await tx.get(ref)
    return { ref, data: snap.data() }
  }))
}

function touchGuards(tx: Transaction, guards: Awaited<ReturnType<typeof readGuards>>) {
  for (const guard of guards) tx.set(guard.ref, { version: (guard.data?.version ?? 0) + 1, updatedAt: serverTimestamp() }, { merge: true })
}

function assertAvailable(guards: Awaited<ReturnType<typeof readGuards>>) {
  if (guards.some(guard => !!guard.data?.bookingId)) throw new Error('คนขับหรือรถมีคิวต่อเนื่องในวันที่เลือก กรุณาปรับคิวเฉพาะวันผ่านแผงคิวต่อเนื่อง')
}

async function readAssistNote(db: Firestore, tx: Transaction, targetId: string, target: Trip, source: TripAssistSource) {
  const message = 'งานหรือรถต้นทางของคันช่วยเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่และเลือกงานใหม่'
  if (!source || source.tripId === targetId || source.expectedTrip?.id !== source.tripId || !Number.isSafeInteger(source.stopIndex) || source.stopIndex < 0 || target.status === 'Cancelled') throw new Error(message)
  const snap = await tx.get(doc(db, 'trips', source.tripId))
  const live = snap.data() as (Trip & LegacyStopNotes) | undefined
  const expected = source.expectedTrip
  const identity = (trip: Trip) => [trip.tripDate || (trip as Trip & { date?: string }).date, trip.driverId, trip.driverName, trip.actualDriverId || '', trip.actualDriverName || '', trip.vehicleId, trip.vehiclePlate, trip.status]
  if (!live || live.queueLink || live.status === 'Cancelled' || canonical(identity(live)) !== canonical(identity(expected)) || target.tripDate !== (live.tripDate || (live as Trip & { date?: string }).date)) throw new Error(message)
  assertTripStopsUnchanged(live.stops, expected.stops)
  const stop = live.stops[source.stopIndex]
  if (!stop) throw new Error(message)
  const key = `stop_${source.stopIndex}`
  return { dispatcherNote: live.stopNotes?.[key] || stop.dispatcherNote || '', dispatcherName: live.stopNoteAuthors?.[key] || stop.dispatcherName || '' }
}

export async function createTripWithQueueGuard(db: Firestore, id: string, data: Record<string, any>, sources?: TripSourceAllocation, assistSource?: TripAssistSource): Promise<Record<string, any>> {
  if (data.queueLink) throw new Error(MANAGED_MESSAGE)
  if (!data.tripDate || !data.driverId || !data.vehicleId) throw new Error('ระบุวัน คนขับ และรถให้ครบก่อนจัดคิว')
  return runTransaction(db, async tx => {
    const ref = doc(db, 'trips', id)
    if ((await tx.get(ref)).exists()) throw new Error('รหัสเที่ยววิ่งถูกใช้แล้ว กรุณาจัดคิวใหม่')
    const guards = await readGuards(db, tx, resourceGuardKeys(data as Trip))
    if (data.status !== 'Cancelled') assertAvailable(guards)
    if (assistSource && (data.stops?.length !== 1 || sources?.assignments.length)) throw new Error('ข้อมูลคันช่วยไม่ตรงกับงานต้นทาง')
    const assistNote = assistSource ? await readAssistNote(db, tx, id, data as Trip, assistSource) : null
    const requests = await sourceWrites(db, tx, data as Trip, id, sources)
    const saved = requests.length ? { ...data, ...sourceNotePatch(data as Trip, requests), sourceVRIds: [...new Set([...(data.sourceVRIds || []), ...requests.map(request => request.humanId)])] } : assistNote ? { ...data, stops: [{ ...data.stops[0], ...assistNote }] } : data
    touchGuards(tx, guards)
    tx.set(ref, saved)
    for (const request of requests) tx.update(request.ref, request.patch)
    return saved
  })
}
export async function updateTripWithQueueGuard(db: Firestore, id: string, patch: Record<string, any>, sources?: TripSourceAllocation, stopEdit?: TripStopEdit): Promise<Record<string, any>> {
  if ('queueLink' in patch) throw new Error(MANAGED_MESSAGE)
  if ('stops' in patch && !stopEdit && !sources?.expected) throw new Error('การแก้รายการงานต้องมีข้อมูลต้นฉบับ กรุณาโหลดหน้าใหม่ก่อนบันทึก')
  return runTransaction(db, async tx => {
    const ref = doc(db, 'trips', id)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('ไม่พบเที่ยววิ่ง กรุณาโหลดคิวใหม่')
    const before = snap.data() as Trip & LegacyStopNotes
    if (before.queueLink) throw new Error(MANAGED_MESSAGE)
    checkExpected(before, sources)
    let effectivePatch = patch
    if (stopEdit) {
      assertTripStopsUnchanged(before.stops, stopEdit.expectedStops)
      if (!Array.isArray(patch.stops) || !Array.isArray(stopEdit.sourceIndexes)) throw new Error('ลำดับรายการงานไม่ถูกต้อง กรุณาโหลดหน้าใหม่')
      effectivePatch = { ...patch, ...remapStopNotes(before, patch.stops, stopEdit.sourceIndexes) }
    }
    const after = { ...before, ...effectivePatch } as Trip
    // deleteField/null clears the override, so the planned driver becomes effective again.
    if ('actualDriverId' in patch && typeof patch.actualDriverId !== 'string') delete after.actualDriverId
    const oldKeys = resourceGuardKeys(before)
    const newKeys = resourceGuardKeys(after)
    const target = stopEdit?.createTarget
    const targetKeys = target ? resourceGuardKeys(target.data as Trip) : []
    const targetRef = target ? doc(db, 'trips', target.id) : null
    if (target && targetRef) {
      if (target.id === id || target.data.queueLink || !target.data.driverId || !target.data.vehicleId || target.data.tripDate !== after.tripDate || !Array.isArray(target.data.stops) || target.data.stops.length || !after.stops.some(stop => stop.reassignedToTripId === target.id)) throw new Error('ข้อมูลทริปรับโยกไม่ตรงกับงานต้นทาง')
      if ((await tx.get(targetRef)).exists()) throw new Error('รหัสเที่ยววิ่งถูกใช้แล้ว กรุณาจัดคิวใหม่')
    }
    const supersede = stopEdit?.supersedeRequest
    const oldRequestRef = supersede ? doc(db, 'vehicleRequests', supersede.id) : null
    const oldRequest = oldRequestRef ? await tx.get(oldRequestRef) : null
    if (supersede && (!before.stops.some(stop => stop.postponedRequestId === supersede.id) || after.stops.some(stop => stop.postponedRequestId === supersede.id))) throw new Error('ใบที่เลื่อนไว้ไม่ตรงกับจุดงานที่แก้')
    if (oldRequest?.exists() && ['approved', 'partial'].includes(oldRequest.data().status)) throw new Error('ใบที่เลื่อนไว้ถูกจัดรถแล้ว ต้องนำงานออกจากทริปวันใหม่ก่อนเปลี่ยนผล')
    const guards = await readGuards(db, tx, [...new Set([...oldKeys, ...newKeys, ...targetKeys])])
    if (after.status !== 'Cancelled') assertAvailable(guards.filter(guard => newKeys.includes(guard.ref.id)))
    if (target) assertAvailable(guards.filter(guard => targetKeys.includes(guard.ref.id)))
    if (stopEdit?.assistSource) {
      if (target || sources?.assignments.length || after.stops.length !== before.stops.length + 1 || stopEdit.sourceIndexes.some((index, position) => index !== (position < before.stops.length ? position : null))) throw new Error('ข้อมูลคันช่วยไม่ตรงกับงานต้นทาง')
      const note = await readAssistNote(db, tx, id, after, stopEdit.assistSource)
      effectivePatch = { ...effectivePatch, stops: after.stops.map((stop, index) => index === before.stops.length ? { ...stop, ...note } : stop) }
      after.stops = effectivePatch.stops
    }
    const requests = await sourceWrites(db, tx, after, id, sources, before.stops?.length || 0)
    touchGuards(tx, guards)
    if (target && targetRef) tx.set(targetRef, target.data)
    if (oldRequestRef && oldRequest?.exists()) tx.update(oldRequestRef, { status: 'superseded', supersededAt: serverTimestamp(), supersededByUser: supersede!.by })
    const savedPatch = requests.length ? { ...effectivePatch, ...sourceNotePatch(after, requests), sourceVRIds: [...new Set([...(after.sourceVRIds || []), ...requests.map(request => request.humanId)])] } : effectivePatch
    tx.update(ref, savedPatch)
    for (const request of requests) tx.update(request.ref, request.patch)
    return savedPatch
  })
}
/**
 * ลบทริป — ทุกทางที่ลบทริปต้องผ่านตัวนี้ (ใบสรุป/หน้าประวัติ ลบทีละใบ/หลายใบ/ล้างข้อมูลไม่สมบูรณ์)
 * - ห้ามลบทริปที่ยังถืองานที่คันอื่นโยกเข้ามา: pointer อยู่ที่จุดต้นทาง ลบปลายทางแล้วงานหายจากทุกหน้าเงียบ ๆ
 *   (เช็คจากทริปวันเดียวกันก่อนเปิด transaction — transaction ฝั่ง client query ไม่ได้ ยังมีช่องแคบมากถ้ามีคนโยกเข้าพร้อมกัน)
 * - supersede = จุดที่ลบเคยเลื่อนไปวันใหม่ → ปลดใบวันใหม่ในคำสั่งเดียวกัน · ใบวันใหม่ถูกจัดรถแล้ว = ห้ามลบ
 */
export async function deleteTripWithQueueGuard(db: Firestore, id: string, expectedStops?: Trip['stops'], supersede?: { id: string; by: string }): Promise<void> {
  const ref = doc(db, 'trips', id)
  const current = await getDoc(ref)
  if (!current.exists()) return
  const tripDate = current.data().tripDate
  if (tripDate) {
    const sameDay = await getDocs(query(collection(db, 'trips'), where('tripDate', '==', tripDate)))
    const live = sameDay.docs.map(d => ({ ...(d.data() as Trip), id: d.id })).filter(t => t.status !== 'Cancelled')
    const incoming = incomingStopsForTrip(live, id)
    if (incoming.length) {
      const from = [...new Set(incoming.map(job => [job.fromDriverName, job.fromVehiclePlate].filter(Boolean).join(' ')))].join(', ')
      throw new Error(`ทริปนี้ยังรับงานที่โยกมาจาก ${from} (${incoming.length} จุด) — ย้ายงานนั้นไปคันอื่นหรือคืนคันเดิมก่อนลบ`)
    }
  }
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    if (snap.data().queueLink) throw new Error(MANAGED_MESSAGE)
    if (expectedStops) assertTripStopsUnchanged(snap.data().stops, expectedStops)
    const requestRef = supersede ? doc(db, 'vehicleRequests', supersede.id) : null
    const request = requestRef ? await tx.get(requestRef) : null
    if (supersede && !(snap.data().stops || []).some((stop: any) => stop.postponedRequestId === supersede.id)) throw new Error('ใบที่เลื่อนไว้ไม่ตรงกับจุดงานที่แก้')
    if (request?.exists() && ['approved', 'partial'].includes(request.data().status)) throw new Error('ใบที่เลื่อนไว้ถูกจัดรถแล้ว ต้องนำงานออกจากทริปวันใหม่ก่อนเปลี่ยนผล')
    const guards = await readGuards(db, tx, resourceGuardKeys(snap.data() as Trip))
    touchGuards(tx, guards)
    if (requestRef && request?.exists()) tx.update(requestRef, { status: 'superseded', supersededAt: serverTimestamp(), supersededByUser: supersede!.by })
    tx.delete(ref)
  })
}

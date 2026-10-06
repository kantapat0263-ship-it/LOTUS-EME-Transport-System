import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from 'firebase/firestore'
import { resourceGuardKeys } from './continuousQueue'
import type { Trip } from '@/types/models'
import type { QueueSourceAssignment } from '@/types/continuous-queue'
import { remapStopNotes, type LegacyStopNotes } from './stopNote'

const MANAGED_MESSAGE = 'คิวนี้เป็นคิวต่อเนื่อง กรุณาใช้แผงคิวต่อเนื่องเพื่อปรับเฉพาะวันและเก็บประวัติ'

export interface TripSourceAllocation {
  assignments: (QueueSourceAssignment & { tripStopIndexes?: number[] })[]
  metadata?: { approvedBy?: string; vehiclePlate?: string; driverName?: string; approvedAt?: any }
  expected?: { tripDate: string; driverId: string; vehicleId: string; stops: Trip['stops']; sourceVRIds?: string[] }
}

export interface TripStopEdit {
  expectedStops: Trip['stops']
  sourceIndexes: (number | null)[]
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

async function sourceWrites(db: Firestore, tx: Transaction, trip: Trip, tripId: string, sources?: TripSourceAllocation, existingStopCount = 0) {
  const assignments = sources?.assignments || []
  if (assignments.length > 100) throw new Error('จำนวนใบขอมากเกินไป')
  if (assignments.length && trip.status === 'Cancelled') throw new Error('ทริปถูกยกเลิกแล้ว กรุณาเลือกคิวใหม่')
  const seen = new Set<string>()
  const noteTargets = new Set<number>()
  const writes = []
  for (const { requestId, destinationIndexes, tripStopIndexes } of assignments) {
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

export async function createTripWithQueueGuard(db: Firestore, id: string, data: Record<string, any>, sources?: TripSourceAllocation): Promise<void> {
  if (data.queueLink) throw new Error(MANAGED_MESSAGE)
  if (!data.tripDate || !data.driverId || !data.vehicleId) throw new Error('ระบุวัน คนขับ และรถให้ครบก่อนจัดคิว')
  await runTransaction(db, async tx => {
    const ref = doc(db, 'trips', id)
    if ((await tx.get(ref)).exists()) throw new Error('รหัสเที่ยววิ่งถูกใช้แล้ว กรุณาจัดคิวใหม่')
    const guards = await readGuards(db, tx, resourceGuardKeys(data as Trip))
    if (data.status !== 'Cancelled') assertAvailable(guards)
    const requests = await sourceWrites(db, tx, data as Trip, id, sources)
    touchGuards(tx, guards)
    tx.set(ref, requests.length ? { ...data, ...sourceNotePatch(data as Trip, requests), sourceVRIds: [...new Set([...(data.sourceVRIds || []), ...requests.map(request => request.humanId)])] } : data)
    for (const request of requests) tx.update(request.ref, request.patch)
  })
}
export async function updateTripWithQueueGuard(db: Firestore, id: string, patch: Record<string, any>, sources?: TripSourceAllocation, stopEdit?: TripStopEdit): Promise<Record<string, any>> {
  if ('queueLink' in patch) throw new Error(MANAGED_MESSAGE)
  return runTransaction(db, async tx => {
    const ref = doc(db, 'trips', id)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('ไม่พบเที่ยววิ่ง กรุณาโหลดคิวใหม่')
    const before = snap.data() as Trip & LegacyStopNotes
    if (before.queueLink) throw new Error(MANAGED_MESSAGE)
    checkExpected(before, sources)
    let effectivePatch = patch
    if (stopEdit) {
      const withoutNotes = (stops: Trip['stops']) => stops.map(({ dispatcherNote: _note, dispatcherName: _author, ...stop }) => stop)
      if (!Array.isArray(before.stops) || !Array.isArray(patch.stops) || !Array.isArray(stopEdit.expectedStops) || !Array.isArray(stopEdit.sourceIndexes) || canonical(withoutNotes(before.stops)) !== canonical(withoutNotes(stopEdit.expectedStops))) {
        throw new Error('รายการงานเปลี่ยนระหว่างแก้ไข กรุณาโหลดข้อมูลและเลือกใหม่')
      }
      effectivePatch = { ...patch, ...remapStopNotes(before, patch.stops, stopEdit.sourceIndexes) }
    }
    const after = { ...before, ...effectivePatch } as Trip
    // deleteField/null clears the override, so the planned driver becomes effective again.
    if ('actualDriverId' in patch && typeof patch.actualDriverId !== 'string') delete after.actualDriverId
    const oldKeys = resourceGuardKeys(before)
    const newKeys = resourceGuardKeys(after)
    const guards = await readGuards(db, tx, [...new Set([...oldKeys, ...newKeys])])
    if (after.status !== 'Cancelled') assertAvailable(guards.filter(guard => newKeys.includes(guard.ref.id)))
    const requests = await sourceWrites(db, tx, after, id, sources, before.stops?.length || 0)
    touchGuards(tx, guards)
    const savedPatch = requests.length ? { ...effectivePatch, ...sourceNotePatch(after, requests), sourceVRIds: [...new Set([...(after.sourceVRIds || []), ...requests.map(request => request.humanId)])] } : effectivePatch
    tx.update(ref, savedPatch)
    for (const request of requests) tx.update(request.ref, request.patch)
    return savedPatch
  })
}
export async function deleteTripWithQueueGuard(db: Firestore, id: string): Promise<void> {
  await runTransaction(db, async tx => {
    const ref = doc(db, 'trips', id)
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    if (snap.data().queueLink) throw new Error(MANAGED_MESSAGE)
    const guards = await readGuards(db, tx, resourceGuardKeys(snap.data() as Trip))
    touchGuards(tx, guards)
    tx.delete(ref)
  })
}

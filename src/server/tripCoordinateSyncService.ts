import { createHash } from 'node:crypto'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { canSyncTripCoordinates, coordinateSyncBaseline, validCoordinates, type CoordinateSyncCommand } from '@/lib/tripCoordinateSync'
import { parseCoordinateSyncCommand } from './tripCoordinateSyncValidation'
import type { Trip, TripEditLog } from '@/types/models'

export class CoordinateSyncError extends Error {
  constructor(message: string, readonly status: 403 | 404 | 409 = 409) { super(message) }
}

export async function syncTripCoordinates(db: Firestore, input: CoordinateSyncCommand, uid: string): Promise<{ updatedStops: number; replayed?: boolean }> {
  const command = parseCoordinateSyncCommand(input)
  const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex')
  const tripRef = db.doc(`trips/${command.tripId}`)
  const logRef = tripRef.collection('editLogs').doc(`coordinates-${command.operationId}`)
  const siteIds = [...new Set(command.selections.map(item => item.siteId))]
  return db.runTransaction(async tx => {
    const [profileSnap, tripSnap, logSnap, ...siteSnaps] = await tx.getAll(db.doc(`users/${uid}`), tripRef, logRef, ...siteIds.map(id => db.doc(`sites/${id}`)))
    const profile = profileSnap.data()
    if (profile?.active !== true || !['admin', 'dispatcher'].includes(profile.role)) throw new CoordinateSyncError('ไม่มีสิทธิ์ซิงก์พิกัด กรุณาติดต่อผู้ดูแล', 403)
    const log = logSnap.data()
    if (log) {
      if (log.commandFingerprint !== fingerprint || log.editedById !== uid) throw new CoordinateSyncError('รหัสคำสั่งนี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาเปิดรายการใหม่')
      return { updatedStops: log.changes.coordinatesUpdated.length, replayed: true }
    }
    const live = tripSnap.data() as Trip | undefined
    if (!live) throw new CoordinateSyncError('ไม่พบใบคิวนี้ กรุณาโหลดข้อมูลใหม่', 404)
    if (!canSyncTripCoordinates(live)) throw new CoordinateSyncError('ใบคิวจบหรือยกเลิกแล้ว ไม่สามารถซิงก์พิกัดได้')
    if (createHash('sha256').update(coordinateSyncBaseline(live)).digest('hex') !== command.baseline) throw new CoordinateSyncError('ใบคิวหรือผลปิดงานเปลี่ยนระหว่างตรวจ กรุณาโหลดรายการใหม่')
    const sites = new Map(siteSnaps.map(snap => [snap.id, snap.data()]))
    const stops = [...live.stops]
    const changes: NonNullable<TripEditLog['changes']['coordinatesUpdated']> = []
    for (const item of command.selections) {
      const stop = stops[item.stopIndex]
      if (!stop || stop.siteId !== item.siteId || stop.outcome) throw new CoordinateSyncError('จุดงานเปลี่ยนหรือปิดผลงานแล้ว กรุณาโหลดรายการใหม่')
      const site = sites.get(item.siteId)
      if (!site || !validCoordinates(site.latitude, site.longitude)) throw new CoordinateSyncError('สถานที่ถูกลบหรือพิกัดไม่ถูกต้อง กรุณาตรวจสถานที่แล้วโหลดรายการใหม่')
      if (site.latitude !== item.latitude || site.longitude !== item.longitude) throw new CoordinateSyncError('พิกัดสถานที่เปลี่ยนระหว่างตรวจ กรุณาโหลดรายการใหม่')
      if (stop.lat === item.latitude && stop.lng === item.longitude) continue
      changes.push({ stopIndex: item.stopIndex, siteId: item.siteId, siteName: stop.siteName, from: { lat: stop.lat ?? null, lng: stop.lng ?? null }, to: { lat: item.latitude, lng: item.longitude } })
      stops[item.stopIndex] = { ...stop, lat: item.latitude, lng: item.longitude }
    }
    if (!changes.length) return { updatedStops: 0 }
    // Coordinates alone do not change allocation. Preserve booking/guards, notes and frozen totals.
    tx.update(tripRef, { stops, updatedAt: FieldValue.serverTimestamp() })
    tx.create(logRef, {
      editedAt: FieldValue.serverTimestamp(), editedBy: profile.name || uid, editedById: uid,
      note: `ซิงก์พิกัดจากสถานที่ ${changes.length} จุด`, changes: { coordinatesUpdated: changes }, commandFingerprint: fingerprint,
    })
    return { updatedStops: changes.length }
  })
}

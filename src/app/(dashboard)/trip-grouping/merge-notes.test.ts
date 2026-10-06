import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let mergeHandler: ts.Expression | undefined
function find(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleMergeTrip') mergeHandler = node.initializer
  ts.forEachChild(node, find)
}
find(source)
if (!mergeHandler) throw new Error('Actual merge handler not found')
const compiled = ts.transpileModule(`const merge = ${mergeHandler.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function arrange(statuses: Record<string, string> = {}) {
  const existingStop = { order: 1, siteName: 'งานเดิม', dispatcherNote: 'คำสั่งงานเดิม' }
  const trip = { id: 'T1', tripId: 'T1', driverId: 'D1', driverName: 'คนขับทดสอบ', vehicleId: 'V1', tripDate: '2026-10-07', status: 'Planned', stops: [existingStop], sourceVRIds: ['VR-OLD'] }
  const selected = [
    { vrDocId: 'R1', vrId: 'VR-A', destIndex: 2, sourceFingerprint: 'original-A2', siteName: 'จุด A2', lat: 13, lng: 100 },
    { vrDocId: 'R2', vrId: 'VR-B', destIndex: 1, sourceFingerprint: 'original-B1', siteName: 'จุด B1', lat: 13, lng: 100 },
    { vrDocId: 'R1', vrId: 'VR-A', destIndex: 0, sourceFingerprint: 'original-A0', siteName: 'จุด A0', lat: 13, lng: 100 },
  ]
  const dialog = { existingTrip: trip, newStops: selected }
  const update = vi.fn().mockResolvedValue(undefined)
  const toast = vi.fn()
  const reset = vi.fn()
  const snapshot = (data: unknown) => ({ exists: () => true, data: () => data })
  const getDoc = vi.fn(async (ref: string) => snapshot(ref.startsWith('trips/') ? trip : { status: statuses[ref.split('/')[1]] || 'in_progress' }))
  const handler = new Function('setIsProcessing', 'mergeDialog', 'pageVersionRef', 'mergeDialogRef', 'getDoc', 'doc', 'db', 'toast', 'isManagedTrip', 'confirmLeaveBeforeAssign', 'checkLeave', 'drivers', 'window', 'updateTripWithQueueGuard', 'serverTimestamp', 'recalcMergedTripDistance', 'resetAll', 'console', `${compiled}; return merge`)(
    vi.fn(), dialog, { current: 1 }, { current: dialog }, getDoc, (_db: unknown, collection: string, id: string) => `${collection}/${id}`, {}, toast, () => false, vi.fn().mockResolvedValue(true), vi.fn(), [], { confirm: () => true }, update, () => 'test-timestamp', vi.fn(), reset, { error: vi.fn() },
  ) as () => Promise<void>
  return { handler, update, toast, reset, trip, selected }
}

describe('actual merge click handler source-note mapping', () => {
  it('ข้ามใบที่ยกเลิกแล้วผูกหมายเหตุกับแถวใหม่โดยไม่มีช่องว่างของ index', async () => {
    const { handler, update } = arrange({ R1: 'cancelled' })
    await handler()
    expect(update.mock.calls[0][3].assignments).toEqual([{ requestId: 'R2', destinationIndexes: [1], tripStopIndexes: [1], expectedDestinationFingerprints: ['original-B1'] }])
  })

  it('ทุกใบถูกยกเลิกแล้วไม่เขียนทริปและไม่รีเซ็ตการเลือก', async () => {
    const { handler, update, reset } = arrange({ R1: 'cancelled', R2: 'cancelled' })
    await handler()
    expect(update).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
  })

  it('ผูกจุดในใบขอกับลำดับจุดใหม่ในทริปถูกต้องแม้หลายใบสลับกัน', async () => {
    const { handler, update, trip } = arrange()
    await handler()
    expect(update).toHaveBeenCalledTimes(1)
    const [, , patch, allocation] = update.mock.calls[0]
    expect(allocation.assignments).toEqual([
      { requestId: 'R1', destinationIndexes: [2, 0], tripStopIndexes: [1, 3], expectedDestinationFingerprints: ['original-A2', 'original-A0'] },
      { requestId: 'R2', destinationIndexes: [1], tripStopIndexes: [2], expectedDestinationFingerprints: ['original-B1'] },
    ])
    expect(patch.stops[0]).toEqual(trip.stops[0])
    expect(allocation.expected).toMatchObject({ stops: trip.stops, tripDate: trip.tripDate, driverId: trip.driverId, vehicleId: trip.vehicleId })
  })
})

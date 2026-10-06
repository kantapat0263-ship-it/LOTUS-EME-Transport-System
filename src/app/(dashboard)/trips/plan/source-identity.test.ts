import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { requestDestinationFingerprint } from '@/lib/requestDestination'

const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function actual(name: string, deps: Record<string, unknown>) {
  let expression: ts.Expression | undefined
  const find = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) expression = node.initializer
    ts.forEachChild(node, find)
  }
  find(source)
  if (!expression) throw new Error(`Actual ${name} missing`)
  const compiled = ts.transpileModule(`const work = ${expression.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(deps), `${compiled}return work`)(...Object.values(deps))
}

const request = { requestId: 'VR-0710-001', requestDate: '2026-10-07', requestedBy: 'ผู้ขอ', userId: 'U1', createdAt: { seconds: 1791300000, nanoseconds: 123456789 }, destinations: [{ type: 'site', siteId: 'S1', siteName: 'งาน A', jobDescription: 'ส่ง A' }, { type: 'site', siteId: 'S2', siteName: 'งาน B', jobDescription: 'ส่ง B' }] }
const fingerprints = request.destinations.map((_, index) => requestDestinationFingerprint(request, index))

function arrange(complete: boolean) {
  const pending = { docId: 'R1', vrId: request.requestId, requestDate: request.requestDate, destinations: request.destinations, ...(complete ? { expectedDestinationFingerprints: fingerprints } : {}) }
  const create = vi.fn().mockResolvedValue(undefined), toast = vi.fn(), clearStorage = vi.fn()
  const flight = { isCurrent: () => true, finish: vi.fn() }
  const deps = {
    saveFlightRef: { current: { isPending: () => false, begin: () => flight } }, stops: [
      { id: 'B', siteId: 'S2', cargo: 'ส่ง B', sourceDestinationIndex: 1 },
      { id: 'manual', siteId: 'S3', cargo: 'เพิ่มเอง' },
      { id: 'A', siteId: 'S1', cargo: 'ส่ง A', sourceDestinationIndex: 0 },
    ],
    vehicleId: 'V1', driverId: 'D1', tripDate: request.requestDate, pendingVr: pending, toast,
    pendingRequestFingerprints: (vr: any) => vr.expectedDestinationFingerprints || null, mountedRef: { current: true }, formSigRef: { current: 'same' }, formSig: 'same',
    setIsSaving: vi.fn(), routeStats: { distanceNum: 1, durationNum: 1 }, calculateRoute: vi.fn(), vehicles: [{ id: 'V1', licensePlate: 'รถ' }], drivers: [{ id: 'D1', name: 'คนขับ' }],
    query: vi.fn(), collection: vi.fn(), db: {}, where: vi.fn(), getDocs: vi.fn().mockResolvedValue({ size: 0 }), sites: [{ id: 'S1', name: 'งาน A' }, { id: 'S2', name: 'งาน B' }, { id: 'S3', name: 'งานเพิ่ม' }],
    createTripWithQueueGuard: create, departurePointId: 'warehouse', serverTimestamp: () => 'time', user: { email: 'dispatcher@example.test' },
    window: {}, sessionStorage: { removeItem: clearStorage }, router: { push: vi.fn() }, console: { error: vi.fn() },
  }
  return { handler: actual('handleSaveTrip', deps), create, toast, clearStorage }
}

describe('actual legacy plan source identity', () => {
  it('complete original JSON snapshot normalizes serialized timestamp without reading a fresh request', () => {
    const parse = actual('pendingRequestFingerprints', { requestDestinationFingerprint })
    const pending = JSON.parse(JSON.stringify({ docId: 'R1', vrId: request.requestId, requestDate: request.requestDate, destinations: request.destinations, requestSnapshot: request }))
    expect(parse(pending)).toEqual(fingerprints)
    expect(parse({ ...request, docId: 'R1', vrId: request.requestId })).toEqual(fingerprints)
  })

  it('incomplete, misaligned or changed stored snapshots fail closed', () => {
    const parse = actual('pendingRequestFingerprints', { requestDestinationFingerprint })
    const pending = { docId: 'R1', vrId: request.requestId, requestDate: request.requestDate, destinations: request.destinations }
    expect(parse(pending)).toBeNull()
    expect(parse({ ...pending, expectedDestinationFingerprints: [fingerprints[0]] })).toBeNull()
    expect(parse({ ...pending, expectedDestinationFingerprints: [fingerprints[0], null] })).toBeNull()
    expect(parse({ ...pending, requestSnapshot: request, destinations: [{ ...request.destinations[0], jobDescription: 'งานเปลี่ยนแล้ว' }, request.destinations[1]] })).toBeNull()
    expect(parse({ ...pending, requestSnapshot: { ...request, requestDate: '2026-10-08' } })).toBeNull()
  })

  it('เก็บคำขอเก่าที่ไม่มีต้นฉบับไว้ให้ตรวจแต่ไม่จัดงานและไม่ล้าง sessionStorage', async () => {
    const ui = arrange(false)
    await ui.handler()
    expect(ui.create).not.toHaveBeenCalled()
    expect(ui.clearStorage).not.toHaveBeenCalled()
    expect(ui.toast.mock.calls.at(-1)?.[0]).toMatchObject({ variant: 'destructive' })
  })

  it('ผูก fingerprint ตาม source index แม้สลับจุดและแทรกงานที่เพิ่มเอง', async () => {
    const ui = arrange(true)
    await ui.handler()
    expect(ui.create.mock.calls[0][3].assignments).toEqual([{ requestId: 'R1', destinationIndexes: [1, 0], expectedDestinationFingerprints: [fingerprints[1], fingerprints[0]] }])
    expect(ui.clearStorage).toHaveBeenCalledWith('pendingVR')
  })
})

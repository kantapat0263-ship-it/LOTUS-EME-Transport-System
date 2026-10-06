import { expect, it } from 'vitest'
import { parseQueueCommand } from './continuousQueueValidation'

it('รับคำสั่งคืนคิวพร้อมเหตุผล แต่ไม่รับผู้อนุมัติที่ส่งมาเองหรือวันที่ไม่จริง', () => {
  const command = { action: 'return', bookingId: 'B1', date: '2026-10-06', reason: 'ตกลงคืนคิวก่อนเริ่มงาน', operationId: 'op-123456' }
  expect(parseQueueCommand(command)).toEqual(command)
  expect(() => parseQueueCommand({ ...command, approvedBy: 'admin' })).toThrow()
  expect(() => parseQueueCommand({ ...command, date: '2026-02-30' })).toThrow()
  expect(() => parseQueueCommand({ ...command, reason: '  ' })).toThrow()
})

it('create/borrow ต้องมี snapshot ต้นฉบับครบทุก index', () => {
  const trip = { tripDate: '2026-10-07', driverId: 'D1', driverName: 'คนขับ', vehicleId: 'V1', vehiclePlate: 'รถ', stops: [{ siteName: 'A', order: 1, cargoDetails: 'ของ' }] }
  const command = { action: 'create', operationId: 'op-123456', trip, endDate: trip.tripDate, assignments: [{ requestId: 'R1', destinationIndexes: [0], expectedDestinationFingerprints: ['original'] }] }
  expect(parseQueueCommand(command)).toEqual(command)
  expect(() => parseQueueCommand({ ...command, assignments: [{ requestId: 'R1', destinationIndexes: [0] }] })).toThrow()
  expect(() => parseQueueCommand({ ...command, assignments: [{ ...command.assignments[0], expectedDestinationFingerprints: [] }] })).toThrow()
  expect(() => parseQueueCommand({ ...command, assignments: [{ ...command.assignments[0], expectedDestinationFingerprints: ['one', 'two'] }] })).toThrow()
})

import { expect, it } from 'vitest'
import { parseQueueCommand } from './continuousQueueValidation'

it('รับคำสั่งคืนคิวพร้อมเหตุผล แต่ไม่รับผู้อนุมัติที่ส่งมาเองหรือวันที่ไม่จริง', () => {
  const command = { action: 'return', bookingId: 'B1', date: '2026-10-06', reason: 'ตกลงคืนคิวก่อนเริ่มงาน', operationId: 'op-123456' }
  expect(parseQueueCommand(command)).toEqual(command)
  expect(() => parseQueueCommand({ ...command, approvedBy: 'admin' })).toThrow()
  expect(() => parseQueueCommand({ ...command, date: '2026-02-30' })).toThrow()
  expect(() => parseQueueCommand({ ...command, reason: '  ' })).toThrow()
})

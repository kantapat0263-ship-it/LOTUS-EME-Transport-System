import { describe, expect, it } from 'vitest'
import { displayText, formatIsoDateTh, isUrgentPastDue, requesterVrAfterUrgent, urgentCloseChanges, urgentNotPendingMessage } from './urgentRequest'
import { closedTomorrowMessage, isOutsideRequestHours, settingMinutes, viewerRequestDateProblem } from './requestWindow'

describe('เวลาเปิด/ปิดรับคำขอ (ฟอร์มกับ server ใช้ตัวเดียวกัน)', () => {
  it('อ่าน "HH:MM" เป็นนาทีของวัน (นับนาทีด้วย) · "00:00" = 0 ไม่กลายเป็นค่าเริ่มต้น · ไม่มีค่า/อ่านไม่ได้ = ค่าเริ่มต้น', () => {
    expect(settingMinutes('00:00', 8)).toBe(0)
    expect(settingMinutes('16:30', 8)).toBe(16 * 60 + 30)
    expect(settingMinutes('17:30:00', 8)).toBe(17 * 60 + 30)
    expect(settingMinutes('7', 8)).toBe(7 * 60)
    expect(settingMinutes(' 08:15 ', 16)).toBe(8 * 60 + 15)
    expect(settingMinutes(undefined, 16)).toBe(16 * 60)
    expect(settingMinutes('', 16)).toBe(16 * 60)
    expect(settingMinutes('abc', 16)).toBe(16 * 60)
    expect(settingMinutes('25:00', 16)).toBe(16 * 60)
    expect(settingMinutes('16:75', 8)).toBe(8 * 60)
    expect(settingMinutes(1730, 16)).toBe(16 * 60)
  })

  // เวลาไทย = UTC+7 → สร้างเวลาจาก "HH:MM" ไทยของวันหนึ่ง
  const bkk = (hhmm: string) => new Date(`2030-01-07T${hhmm}:00+07:00`)

  it('นอกเวลา = ตั้งแต่เวลาปิด หรือก่อนเวลาเปิด (ชั่วโมงตรง)', () => {
    const settings = { requestOpenTime: '08:00', requestCloseTime: '16:00' }
    expect(isOutsideRequestHours(bkk('07:59'), settings)).toBe(true)
    expect(isOutsideRequestHours(bkk('08:00'), settings)).toBe(false)
    expect(isOutsideRequestHours(bkk('15:59'), settings)).toBe(false)
    expect(isOutsideRequestHours(bkk('16:00'), settings)).toBe(true)
    expect(isOutsideRequestHours(bkk('01:00'), { requestOpenTime: '00:00', requestCloseTime: '17:00' })).toBe(false)
    expect(isOutsideRequestHours(bkk('16:00'), null)).toBe(true)
  })

  it('ตั้งปิด 17:30 = ปิดจริง 17:30 (เดิมอ่านแค่ชั่วโมง ปิดตั้งแต่ 17:00) · เปิด 08:30 = 08:29 ยังปิด', () => {
    const settings = { requestOpenTime: '08:30', requestCloseTime: '17:30' }
    expect(isOutsideRequestHours(bkk('17:00'), settings)).toBe(false)
    expect(isOutsideRequestHours(bkk('17:29'), settings)).toBe(false)
    expect(isOutsideRequestHours(bkk('17:30'), settings)).toBe(true)
    expect(isOutsideRequestHours(bkk('08:29'), settings)).toBe(true)
    expect(isOutsideRequestHours(bkk('08:30'), settings)).toBe(false)
  })

  it('ใช้เวลาไทยเสมอ ไม่ขึ้นกับเขตเวลาเครื่อง', () => {
    const settings = { requestOpenTime: '08:00', requestCloseTime: '17:30' }
    expect(isOutsideRequestHours(new Date('2030-01-07T10:29:00Z'), settings)).toBe(false) // 17:29 ไทย
    expect(isOutsideRequestHours(new Date('2030-01-07T10:30:00Z'), settings)).toBe(true) // 17:30 ไทย
  })
})

describe('ผู้ขอทั่วไปส่งใบของวันไหนได้ (ผู้ใช้กำหนด 2026-11-14: หลังเวลาปิดรับ ใบพรุ่งนี้ปิดเด็ดขาด)', () => {
  // วันที่ 2030-01-07 เวลาไทย · พรุ่งนี้ = 08 · มะรืน = 09
  const bkk = (hhmm: string) => new Date(`2030-01-07T${hhmm}:00+07:00`)
  const settings = { requestOpenTime: '06:00', requestCloseTime: '16:00' }

  it('ในเวลารับคำขอ: พรุ่งนี้และวันถัดไปส่งได้', () => {
    expect(viewerRequestDateProblem('2030-01-08', bkk('15:59'), settings)).toBeNull()
    expect(viewerRequestDateProblem('2030-01-09', bkk('06:00'), settings)).toBeNull()
  })

  it('ตั้งแต่เวลาปิด: พรุ่งนี้ส่งไม่ได้ ให้แจ้งคนจัดรถ · มะรืนเป็นต้นไปยังส่งได้', () => {
    const message = viewerRequestDateProblem('2030-01-08', bkk('16:00'), settings)
    expect(message).toContain('เลยเวลาปิดรับใบขอรถของพรุ่งนี้แล้ว (ปิด 16:00 น.)')
    expect(message).toContain('แจ้งคนจัดรถโดยตรง')
    expect(viewerRequestDateProblem('2030-01-08', bkk('23:59'), settings)).toBe(message)
    expect(viewerRequestDateProblem('2030-01-09', bkk('16:00'), settings)).toBeNull()
    expect(viewerRequestDateProblem('2030-01-20', bkk('23:59'), settings)).toBeNull()
  })

  it('ก่อนเวลาเปิด: พรุ่งนี้ยังส่งไม่ได้ (รอเปิดรับ ไม่ใช่ให้แจ้งคนจัดรถ) · มะรืนส่งได้', () => {
    const message = viewerRequestDateProblem('2030-01-08', bkk('05:59'), settings)
    expect(message).toBe('ยังไม่ถึงเวลาเปิดรับใบขอรถของพรุ่งนี้ (รับ 06:00–16:00 น.) — ส่งได้ตั้งแต่ 06:00 น.')
    expect(viewerRequestDateProblem('2030-01-09', bkk('00:30'), settings)).toBeNull()
  })

  it('วันนี้/ย้อนหลัง = ต้องล่วงหน้าอย่างน้อย 1 วัน ทุกเวลา', () => {
    for (const time of ['00:00', '10:00', '16:30']) {
      expect(viewerRequestDateProblem('2030-01-07', bkk(time), settings)).toBe('ต้องขอล่วงหน้าอย่างน้อย 1 วัน')
      expect(viewerRequestDateProblem('2030-01-01', bkk(time), settings)).toBe('ต้องขอล่วงหน้าอย่างน้อย 1 วัน')
    }
  })

  it('เวลาปิดมีนาที (17:30) และไม่มีค่าในตั้งค่า (ค่าเริ่มต้นปิด 16:00)', () => {
    const half = { requestOpenTime: '08:00', requestCloseTime: '17:30' }
    expect(viewerRequestDateProblem('2030-01-08', bkk('17:29'), half)).toBeNull()
    expect(viewerRequestDateProblem('2030-01-08', bkk('17:30'), half)).toContain('ปิด 17:30 น.')
    expect(viewerRequestDateProblem('2030-01-08', bkk('16:00'), null)).toContain('ปิด 16:00 น.')
  })

  it('ตัดสินด้วยเวลาไทยเสมอ — 16:00 ไทย = 09:00 UTC ของวันเดียวกัน', () => {
    expect(viewerRequestDateProblem('2030-01-08', new Date('2030-01-07T08:59:00Z'), settings)).toBeNull()
    expect(viewerRequestDateProblem('2030-01-08', new Date('2030-01-07T09:00:00Z'), settings)).toContain('เลยเวลาปิดรับ')
    // 23:30 ไทยวันที่ 7 = 16:30 UTC วันที่ 7 — "พรุ่งนี้" ยังเป็นวันที่ 8 ตามเวลาไทย
    expect(viewerRequestDateProblem('2030-01-08', new Date('2030-01-07T16:30:00Z'), settings)).toContain('เลยเวลาปิดรับ')
    // 00:30 ไทยวันที่ 8 = 17:30 UTC วันที่ 7 — พรุ่งนี้กลายเป็นวันที่ 9 (ก่อนเวลาเปิด) · วันที่ 8 = วันนี้
    expect(viewerRequestDateProblem('2030-01-09', new Date('2030-01-07T17:30:00Z'), settings)).toContain('ยังไม่ถึงเวลาเปิดรับ')
    expect(viewerRequestDateProblem('2030-01-08', new Date('2030-01-07T17:30:00Z'), settings)).toBe('ต้องขอล่วงหน้าอย่างน้อย 1 วัน')
  })

  it('ข้อความกล่องแจ้งในฟอร์ม: ในเวลา = ไม่มี', () => {
    expect(closedTomorrowMessage(bkk('10:00'), settings)).toBeNull()
    expect(closedTomorrowMessage(bkk('16:00'), settings)).toContain('แจ้งคนจัดรถ')
    expect(closedTomorrowMessage(bkk('05:00'), settings)).toContain('ยังไม่ถึงเวลาเปิดรับ')
  })
})

describe('คำขออนุมัติที่ถึงวันขอแล้ว (ผู้ขอส่งใบเองไม่ได้ — คนจัดรถต้องจัดให้เอง)', () => {
  const today = '2026-11-08'
  it.each([
    ['2026-11-08', true], // ขอวันนี้ (ส่งคำขอเมื่อวานหลังเวลาปิดรับ แล้วไม่มีใครตอบ)
    ['2026-11-01', true], // ค้างมาหลายวัน
    ['2026-11-09', false], // พรุ่งนี้ — ยังอนุมัติให้ผู้ขอส่งใบเองทัน
    ['', false],
    [undefined, false],
    [20261108, false],
    ['8/11/2026', false],
    ['2026-02-30', false],
  ])('%o → %s', (requestedDate, expected) => {
    expect(isUrgentPastDue(requestedDate, today)).toBe(expected)
  })
})

describe('ใบที่ผู้ขอส่งเองหลังขออนุมัติ (กันคนจัดรถจัดซ้ำ — แต่ไม่จับงานคนละงาน)', () => {
  const at = (ms: number) => ({ toDate: () => new Date(ms), toMillis: () => ms })
  const urgent = { userId: 'u1', requestedDate: '2026-11-08', createdAt: at(1_000) }
  const vr = (over: Record<string, unknown>) => ({ userId: 'u1', requestDate: '2026-11-08', status: 'pending', requestId: 'VR-1', createdAt: at(2_000), ...over })

  it('ส่งหลังคำขออนุมัติ วันเดียวกัน ผู้ขอคนเดียวกัน = เจอ', () => {
    expect(requesterVrAfterUrgent([vr({})], urgent)?.requestId).toBe('VR-1')
    expect(requesterVrAfterUrgent([vr({ status: 'in_progress' }), vr({ requestId: 'VR-2', status: 'partial' })], urgent)?.requestId).toBe('VR-1')
  })

  it.each([
    ['ใบที่มีอยู่ก่อนขออนุมัติ (ขอเพิ่มงาน B)', { createdAt: at(500) }],
    ['ผู้ขอคนอื่น', { userId: 'u2' }],
    ['คนละวัน', { requestDate: '2026-11-09' }],
    ['ยกเลิกแล้ว', { status: 'cancelled' }],
    ['ใบเลื่อนวันมาตรงวันนั้น', { status: 'rescheduled' }],
    ['ใบที่ถูกแทนแล้ว', { status: 'superseded' }],
    ['ไม่มีเวลาสร้าง', { createdAt: null }],
  ])('%s = ไม่นับ', (_label, over) => {
    expect(requesterVrAfterUrgent([vr(over)], urgent)).toBeNull()
  })

  it('คำขออนุมัติไม่มีเวลาสร้าง / ไม่มีผู้ขอ = ไม่เดา', () => {
    expect(requesterVrAfterUrgent([vr({})], { ...urgent, createdAt: null })).toBeNull()
    expect(requesterVrAfterUrgent([vr({ userId: undefined })], { ...urgent, userId: undefined })).toBeNull()
    expect(requesterVrAfterUrgent(null, urgent)).toBeNull()
  })
})

describe('คนจัดรถปิดคำขอที่ถึงวันขอแล้ว', () => {
  it('จัดรถให้แล้ว / ไม่ได้จัด + หมายเหตุ (ตัดช่องว่าง) · ไม่มีค่า undefined (Firestore ปฏิเสธทั้งก้อน)', () => {
    expect(urgentCloseChanges('handled', '  แทรกงานเข้าทริปนายเอ  ', 'คนจัดรถ')).toEqual({
      status: 'closed', closeOutcome: 'handled', closeNote: 'แทรกงานเข้าทริปนายเอ', closedBy: 'คนจัดรถ',
    })
    const notHandled = urgentCloseChanges('not_handled', '', '')
    expect(notHandled).toEqual({ status: 'closed', closeOutcome: 'not_handled', closeNote: '', closedBy: 'Dispatcher' })
    expect(Object.values(notHandled).some(v => v === undefined)).toBe(false)
  })

  it('หมายเหตุยาวเกินถูกตัดที่ 500 ตัวอักษร', () => {
    expect(urgentCloseChanges('handled', 'x'.repeat(600), 'A').closeNote).toHaveLength(500)
  })

  it('ปิดแล้ว = คนจัดรถกดตอบไม่ได้อีก', () => {
    expect(urgentNotPendingMessage('closed')).toBe('คำขอนี้ถูกปิดไปแล้ว')
  })
})

describe('ค่าที่ผู้ใช้เขียนเองได้ ต้องแสดงได้โดยไม่ทำให้หน้าล้ม', () => {
  it('displayText รับเฉพาะข้อความ', () => {
    expect(displayText('081')).toBe('081')
    for (const bad of [{ a: 1 }, ['x'], 123, null, undefined, true]) expect(displayText(bad)).toBe('')
  })
  it('formatIsoDateTh ไม่ throw กับวันที่เสีย', () => {
    expect(formatIsoDateTh('2026-10-15')).toBe('15/10/2026')
    expect(formatIsoDateTh('2026-99-99')).toBe('2026-99-99')
    expect(formatIsoDateTh('2026-02-30')).toBe('2026-02-30')
    expect(formatIsoDateTh({ toDate: 1 })).toBe('')
    expect(formatIsoDateTh(undefined)).toBe('')
  })
})

describe('คนจัดรถตอบคำขอที่ไม่ได้รออนุมัติแล้ว', () => {
  it.each([
    ['cancelled', 'ผู้ขอยกเลิกคำขอนี้ไปแล้ว'],
    ['approved', 'คำขอนี้ได้รับอนุมัติไปแล้ว'],
    ['rejected', 'คำขอนี้ถูกปฏิเสธไปแล้ว'],
    [null, 'คำขอนี้ไม่ได้รออนุมัติแล้ว'],
    [undefined, 'คำขอนี้ไม่ได้รออนุมัติแล้ว'],
  ])('%s → %s', (status, message) => {
    expect(urgentNotPendingMessage(status)).toBe(message)
  })
})

import { describe, expect, it } from 'vitest'
import {
  displayText, formatIsoDateTh, latestUrgentRequest, planUrgentCancel, urgentDetailsError, urgentFormStatus, urgentNotPendingMessage,
  urgentPrefill, urgentRejectReason,
} from './urgentRequest'
import { isOutsideRequestHours, settingHour } from './requestWindow'

describe('urgentPrefill — เติมจากฟอร์มที่กรอกไว้', () => {
  it('ใช้ชื่อสถานที่ (กำหนดเองใช้ชื่อที่พิมพ์) ไม่ซ้ำ + รายละเอียดงานแรก + เบอร์โปรไฟล์', () => {
    expect(urgentPrefill([
      { category: 'site', siteName: 'ไซต์บางนา', jobDescription: '' },
      { category: 'custom', customName: ' ร้านวัสดุ ', siteName: 'ไม่ใช้', jobDescription: ' ท่อ 10 เส้น ' },
      { category: 'site', siteName: 'ไซต์บางนา' },
    ], '081-234-5678')).toEqual({ destination: 'ไซต์บางนา, ร้านวัสดุ', jobSummary: 'ท่อ 10 เส้น', contactPhone: '081-234-5678' })
  })

  it('ฟอร์มยังว่าง / ไม่มีเบอร์ในโปรไฟล์ → ช่องว่างให้กรอกเอง', () => {
    expect(urgentPrefill([{ category: 'all', siteName: '' }], undefined)).toEqual({ destination: '', jobSummary: '', contactPhone: '' })
  })

  it('🔁 หลายจุดตามลำดับ: เส้นทางตามลำดับจริง คงชื่อซ้ำ (เห็นขากลับ) + งานแยกตามจุด', () => {
    expect(urgentPrefill([
      { category: 'site', siteName: 'ไซต์ A', jobDescription: 'รับคนงาน 3 คน', inSequence: true },
      { category: 'custom', customName: 'สนง.ทำเอกสาร', jobDescription: 'รอทำเอกสาร', inSequence: true },
      { category: 'site', siteName: 'ไซต์ A', jobDescription: 'ส่งคนงานกลับ', inSequence: true },
    ], '')).toEqual({
      destination: 'ไซต์ A → สนง.ทำเอกสาร → ไซต์ A',
      jobSummary: '1) รับคนงาน 3 คน · 2) รอทำเอกสาร · 3) ส่งคนงานกลับ',
      contactPhone: '',
    })
  })

  it('🔁 จุดที่ยังไม่กรอกงาน/ชื่อ ข้ามไป แต่เลขข้อตรงกับลำดับในใบ', () => {
    const r = urgentPrefill([
      { category: 'site', siteName: 'ร้าน', jobDescription: '', inSequence: true },
      { category: 'site', siteName: '', jobDescription: 'ส่งท่อ', inSequence: true },
    ], '')
    expect(r.destination).toBe('ร้าน')
    expect(r.jobSummary).toBe('2) ส่งท่อ')
  })

  it('📦 รับของไปส่งต่อ: "รับ: ... → ส่ง: ..." + งานบอกว่ารับ/ส่งที่ไหน', () => {
    expect(urgentPrefill([
      { category: 'store', siteName: 'ดูโฮม', jobDescription: 'ท่อ 8 เส้น', transferRole: 'pickup' },
      { category: 'store', siteName: 'ไทวัสดุ', jobDescription: 'ปูน 5 ถุง', transferRole: 'pickup' },
      { category: 'site', siteName: 'ไซต์ B', jobDescription: '', transferRole: 'drop' },
    ], '0812345678')).toEqual({
      destination: 'รับ: ดูโฮม, ไทวัสดุ → ส่ง: ไซต์ B',
      jobSummary: 'รับ ดูโฮม: ท่อ 8 เส้น · รับ ไทวัสดุ: ปูน 5 ถุง',
      contactPhone: '0812345678',
    })
  })

  it('ข้อความยาวเกินถูกตัดตามความยาวที่ rules ยอม', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ category: 'site', siteName: `ไซต์ทดสอบชื่อยาวมากหมายเลข ${i}`, jobDescription: 'x'.repeat(80), inSequence: true }))
    const r = urgentPrefill(many, '')
    expect(r.destination.length).toBeLessThanOrEqual(200)
    expect(r.jobSummary.length).toBeLessThanOrEqual(500)
  })
})

describe('urgentDetailsError', () => {
  const ok = { destination: 'ไซต์บางนา', jobSummary: 'ส่งท่อ', contactPhone: '0812345678' }
  it('ครบ = ส่งได้', () => expect(urgentDetailsError(ok)).toBeNull())
  it.each([
    [{ ...ok, destination: ' ' }, 'ไปที่ไหน'],
    [{ ...ok, jobSummary: '' }, 'งาน'],
    [{ ...ok, contactPhone: '' }, 'เบอร์'],
    [{ ...ok, contactPhone: '<script>' }, 'ตัวเลข'],
    [{ ...ok, contactPhone: '---' }, 'ตัวเลข'],
    [{ ...ok, contactPhone: '( )' }, 'ตัวเลข'],
    [{ ...ok, destination: 'x'.repeat(201) }, 'ยาวเกิน'],
    [{ ...ok, jobSummary: 'x'.repeat(501) }, 'ยาวเกิน'],
  ])('%o → ไม่ผ่าน', (details, message) => {
    expect(urgentDetailsError(details)).toContain(message)
  })
})

describe('เวลาเปิด/ปิดรับคำขอ (ฟอร์มกับ server ใช้ตัวเดียวกัน)', () => {
  it('"00:00" อ่านเป็น 0 ชั่วโมง ไม่กลายเป็นค่าเริ่มต้น · ไม่มีค่า/อ่านไม่ได้ = ค่าเริ่มต้น', () => {
    expect(settingHour('00:00', 8)).toBe(0)
    expect(settingHour('16:30', 8)).toBe(16)
    expect(settingHour(undefined, 16)).toBe(16)
    expect(settingHour('', 16)).toBe(16)
    expect(settingHour('abc', 16)).toBe(16)
    expect(settingHour('25:00', 16)).toBe(16)
  })

  it('นอกเวลา = ตั้งแต่ชั่วโมงปิด หรือก่อนชั่วโมงเปิด', () => {
    const settings = { requestOpenTime: '08:00', requestCloseTime: '16:00' }
    expect(isOutsideRequestHours(7, settings)).toBe(true)
    expect(isOutsideRequestHours(8, settings)).toBe(false)
    expect(isOutsideRequestHours(15, settings)).toBe(false)
    expect(isOutsideRequestHours(16, settings)).toBe(true)
    expect(isOutsideRequestHours(1, { requestOpenTime: '00:00', requestCloseTime: '17:00' })).toBe(false)
    expect(isOutsideRequestHours(16, null)).toBe(true)
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

describe('คำขออนุมัติใบล่าสุด (ฟอร์มใช้ตัดสินแบบเดียวกับ server)', () => {
  const at = (ms: number) => ({ toMillis: () => ms })
  const urgent = (id: string, status: string, createdMs: number | null, extra: Record<string, unknown> = {}) =>
    ({ id, status, createdAt: createdMs === null ? null : at(createdMs), ...extra })

  it('เลือกใบที่สร้างทีหลังสุด ไม่ขึ้นกับลำดับที่ได้มา', () => {
    const list = [urgent('A', 'cancelled', 1_000), urgent('C', 'pending', 3_000), urgent('B', 'cancelled', 2_000)]
    expect(latestUrgentRequest(list)?.id).toBe('C')
    expect(latestUrgentRequest([...list].reverse())?.id).toBe('C')
  })

  it('ไม่มีคำขอ = null', () => {
    expect(latestUrgentRequest([])).toBeNull()
    expect(latestUrgentRequest(null)).toBeNull()
    expect(latestUrgentRequest(undefined)).toBeNull()
  })

  it('ใบที่เพิ่งส่งในเครื่อง (server ยังไม่ประทับ createdAt) = ใบใหม่สุด — ไม่เด้งกลับไปขึ้นปุ่มขออนุมัติ', () => {
    expect(latestUrgentRequest([urgent('OLD', 'cancelled', 5_000), urgent('NEW', 'pending', null)])?.id).toBe('NEW')
  })

  it('ใบล่าสุดถูกยกเลิก = เหมือนยังไม่มีคำขอ (ขออนุมัติใหม่ได้)', () => {
    expect(urgentFormStatus([urgent('A', 'cancelled', 1_000)])).toBeNull()
    expect(urgentFormStatus([urgent('A', 'cancelled', 1_000), urgent('B', 'cancelled', 2_000)])).toBeNull()
    expect(urgentFormStatus([])).toBeNull()
    expect(urgentFormStatus(null)).toBeNull()
  })

  it('ยกเลิกแล้วขอใหม่ = ใช้ผลของใบใหม่', () => {
    expect(urgentFormStatus([urgent('B', 'pending', 2_000), urgent('A', 'cancelled', 1_000)])).toBe('pending')
    expect(urgentFormStatus([urgent('A', 'cancelled', 1_000), urgent('B', 'approved', 2_000)])).toBe('approved')
    expect(urgentFormStatus([urgent('A', 'cancelled', 1_000), urgent('B', 'rejected', 2_000)])).toBe('rejected')
  })

  it('เหตุผลการปฏิเสธมาจากใบล่าสุด ไม่ใช่ใบแรกในรายการ', () => {
    const list = [
      urgent('OLD', 'rejected', 1_000, { rejectReason: 'เหตุผลใบเก่า' }),
      urgent('NEW', 'rejected', 3_000, { rejectReason: 'รถเต็มแล้ว' }),
      urgent('MID', 'cancelled', 2_000),
    ]
    expect(urgentRejectReason(list)).toBe('รถเต็มแล้ว')
  })

  it('ใบล่าสุดไม่ได้ถูกปฏิเสธ / เหตุผลไม่ใช่ข้อความ = ไม่แสดงเหตุผล', () => {
    expect(urgentRejectReason([urgent('OLD', 'rejected', 1_000, { rejectReason: 'เก่า' }), urgent('NEW', 'pending', 2_000)])).toBe('')
    expect(urgentRejectReason([urgent('A', 'rejected', 1_000, { rejectReason: { text: 'x' } })])).toBe('')
    expect(urgentRejectReason([])).toBe('')
  })
})

describe('ผู้ขอกดยกเลิก — ยกเลิกทุกใบของวันนั้นที่ยังรออนุมัติ (ค่าที่อ่านซ้ำใน transaction)', () => {
  const at = (ms: number) => ({ toMillis: () => ms })
  const urgent = (id: string, status: string, createdMs: number) => ({ id, status, createdAt: at(createdMs) })

  it('ส่งซ้ำจาก 2 เครื่อง (pending 2 ใบ) = ยกเลิกทั้ง 2 ใบ ไม่เหลือค้างที่การ์ดคนจัดรถ', () => {
    expect(planUrgentCancel([urgent('OLD', 'pending', 1_000), urgent('NEW', 'pending', 2_000)]))
      .toEqual({ cancelIds: ['OLD', 'NEW'], message: 'ยกเลิกคำขออนุมัติแล้ว' })
  })

  it('ยกเลิกเฉพาะใบที่ยังรออนุมัติ — ใบที่คนจัดรถเพิ่งตอบไม่ถูกเขียนทับ', () => {
    expect(planUrgentCancel([urgent('OLD', 'approved', 1_000), urgent('NEW', 'pending', 2_000)]))
      .toEqual({ cancelIds: ['NEW'], message: 'ยกเลิกคำขออนุมัติแล้ว' })
  })

  it('ไม่มีใบไหนรออนุมัติเหลือ: คนจัดรถตอบใบล่าสุดไปแล้ว', () => {
    expect(planUrgentCancel([urgent('A', 'approved', 1_000)])).toEqual({ cancelIds: [], message: 'คนจัดรถเพิ่งตอบคำขอนี้แล้ว' })
    expect(planUrgentCancel([urgent('A', 'cancelled', 1_000), urgent('B', 'rejected', 2_000)]))
      .toEqual({ cancelIds: [], message: 'คนจัดรถเพิ่งตอบคำขอนี้แล้ว' })
  })

  it('ไม่มีใบไหนรออนุมัติเหลือ: ใบล่าสุดถูกยกเลิกจากอีกแท็บ/เครื่องไปแล้ว', () => {
    expect(planUrgentCancel([urgent('A', 'cancelled', 1_000)])).toEqual({ cancelIds: [], message: 'คำขอนี้ถูกยกเลิกไปแล้ว' })
    expect(planUrgentCancel([urgent('A', 'approved', 1_000), urgent('B', 'cancelled', 2_000)]))
      .toEqual({ cancelIds: [], message: 'คำขอนี้ถูกยกเลิกไปแล้ว' })
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

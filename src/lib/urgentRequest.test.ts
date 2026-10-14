import { describe, expect, it } from 'vitest'
import { displayText, formatIsoDateTh, urgentDetailsError, urgentPrefill } from './urgentRequest'
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

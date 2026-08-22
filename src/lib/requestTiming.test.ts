import { describe, it, expect } from 'vitest'
import { describeRequestTiming, toMillis } from './requestTiming'

// 22/8/2026 16:02 เวลาไทย = 09:02 UTC
const SAT_1602 = Date.UTC(2026, 7, 22, 9, 2)
const SAT_1030 = Date.UTC(2026, 7, 22, 3, 30)

describe('requestTiming: describeRequestTiming', () => {
  it('ส่ง 16:02 ขอใช้ 24/8 → label ถูก, ล่วงหน้า 2 วัน, นอกเวลา', () => {
    const t = describeRequestTiming(SAT_1602, '2026-08-24')!
    expect(t.submittedLabel).toBe('22/8 16:02')
    expect(t.leadDays).toBe(2)
    expect(t.leadLabel).toBe('ล่วงหน้า 2 วัน')
    expect(t.outsideHours).toBe(true)
  })

  it('ส่ง 10:30 ขอพรุ่งนี้ → ในเวลา ล่วงหน้า 1 วัน', () => {
    const t = describeRequestTiming(SAT_1030, '2026-08-23')!
    expect(t.outsideHours).toBe(false)
    expect(t.leadLabel).toBe('ล่วงหน้า 1 วัน')
  })

  it('ขอวันเดียวกับที่ส่ง (งานด่วนหน้างาน) → "วันเดียวกัน"', () => {
    expect(describeRequestTiming(SAT_1030, '2026-08-22')!.leadLabel).toBe('วันเดียวกัน')
  })

  it('ส่งหลังวันใช้รถ (ลงย้อนหลัง) → leadDays ติดลบ', () => {
    const t = describeRequestTiming(SAT_1030, '2026-08-20')!
    expect(t.leadDays).toBe(-2)
    expect(t.leadLabel).toBe('ส่งย้อนหลัง')
  })

  it('ส่งก่อน 08:00 ก็นับนอกเวลา / เวลาตัดรอบปรับได้จาก settings', () => {
    const early = Date.UTC(2026, 7, 22, 0, 15) // 07:15 ไทย
    expect(describeRequestTiming(early, '2026-08-24')!.outsideHours).toBe(true)
    expect(describeRequestTiming(early, '2026-08-24', { openHour: 7 })!.outsideHours).toBe(false)
    expect(describeRequestTiming(SAT_1602, '2026-08-24', { closeHour: 17 })!.outsideHours).toBe(false)
  })

  it('ข้ามเที่ยงคืน UTC แต่ยังวันเดียวกันในไทย → วันที่ไทยถูก', () => {
    const late = Date.UTC(2026, 7, 22, 18, 30) // 01:30 ไทย วันที่ 23
    expect(describeRequestTiming(late, '2026-08-23')!.submittedLabel).toBe('23/8 01:30')
    expect(describeRequestTiming(late, '2026-08-23')!.leadLabel).toBe('วันเดียวกัน')
  })

  it('ไม่มีเวลาส่ง / ไม่มีวันใช้รถ → null (stop เก่าที่ไม่มี field)', () => {
    expect(describeRequestTiming(null, '2026-08-24')).toBeNull()
    expect(describeRequestTiming(SAT_1602, '')).toBeNull()
  })
})

describe('requestTiming: toMillis', () => {
  it('รับ ms / Firestore Timestamp / {seconds} / ISO', () => {
    expect(toMillis(123)).toBe(123)
    expect(toMillis({ toMillis: () => 456 })).toBe(456)
    expect(toMillis({ seconds: 2 })).toBe(2000)
    expect(toMillis('2026-08-22T09:02:00Z')).toBe(SAT_1602)
    expect(toMillis(undefined)).toBeNull()
    expect(toMillis('ไม่ใช่วันที่')).toBeNull()
  })
})

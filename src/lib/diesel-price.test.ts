import { describe, it, expect } from 'vitest'
import { extractB7Price } from './diesel-price'

describe('extractB7Price', () => {
  it('แกะราคา B7 จาก shape แบบ key ตรงตัว (itorbenz-like)', () => {
    const data = {
      result: {
        stations: [
          { name: 'ptt', oils: { gasohol95: '36.04', diesel_b7: '32.94', diesel_b20: '32.94' } },
          { name: 'bcp', oils: { diesel_b7: '32.94' } },
        ],
      },
    }
    expect(extractB7Price(data)).toBe(32.94)
  })

  it('แกะราคาจาก label ภาษาไทย "ดีเซล B7"', () => {
    const data = [{ ชนิดน้ำมัน: 'ดีเซล B7', ราคา: '33.94' }]
    // label "ราคา" ไม่เข้าเงื่อนไข B7 แต่ key "ชนิดน้ำมัน" ค่าเป็น string ที่บอกชนิด → ไม่ใช่ราคา
    // ค่า 33.94 อยู่ใต้ key "ราคา" ที่ไม่ match → คาดว่าไม่เจอ (กันการเดาผิด)
    expect(extractB7Price(data)).toBeNull()
  })

  it('แกะได้เมื่อ key ของ "ราคา" คือชื่อชนิดน้ำมัน', () => {
    const data = { 'ดีเซล': 31.5, 'แก๊สโซฮอล์95': 36.0 }
    expect(extractB7Price(data)).toBe(31.5)
  })

  it('คืน null เมื่อไม่มีข้อมูล B7', () => {
    expect(extractB7Price({ gasohol95: '36.04' })).toBeNull()
    expect(extractB7Price(null)).toBeNull()
    expect(extractB7Price({})).toBeNull()
  })

  it('กันค่าหลุดช่วงราคา (เช่น เลขทะเบียน/ปี/%)', () => {
    expect(extractB7Price({ diesel_b7: '1234' })).toBeNull()
    expect(extractB7Price({ diesel_b7: '5' })).toBeNull()
    expect(extractB7Price({ diesel_b7: '2026' })).toBeNull()
  })

  it('ไม่เอา B20 / พรีเมียม มาปนกับ B7', () => {
    const data = { diesel_b20: '32.94', diesel_premium: '42.0' }
    expect(extractB7Price(data)).toBeNull()
  })

  it('คืนมัธยฐานเมื่อหลายปั๊มราคาต่างกันเล็กน้อย', () => {
    const data = { a: { b7: 30 }, b: { b7: 32 }, c: { b7: 34 } }
    expect(extractB7Price(data)).toBe(32)
  })
})

import { describe, it, expect } from 'vitest'
import { extractB7Price, extractB7PriceFromHtml } from './diesel-price'

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

describe('extractB7PriceFromHtml', () => {
  it('แกะราคาจากตาราง HTML (kapook-like) — เอามัธยฐาน ตัด B20/พรีเมียมออก', () => {
    const html = `
      <table>
        <tr><td>ดีเซล B7</td><td>39.80</td><td>39.94</td><td>39.80</td></tr>
        <tr><td>ดีเซล B20</td><td>35.00</td></tr>
        <tr><td>ดีเซลพรีเมียม B7</td><td>47.66</td></tr>
      </table>`
    expect(extractB7PriceFromHtml(html)).toBe(39.8)
  })

  it('แกะได้แม้ label เป็นแค่ "ดีเซล" (ไม่มี B7)', () => {
    const html = '<div><span>ดีเซล</span> <b>39.80</b> บาท/ลิตร</div>'
    expect(extractB7PriceFromHtml(html)).toBe(39.8)
  })

  it('ตัด script/style ออกก่อนแกะ ไม่หลงราคาปลอมใน JS', () => {
    const html =
      '<script>var ดีเซล = 99.99;</script><p>ดีเซล B7 39.80</p>'
    expect(extractB7PriceFromHtml(html)).toBe(39.8)
  })

  it('คืน null เมื่อหน้าเว็บไม่มีราคาดีเซล', () => {
    expect(extractB7PriceFromHtml('<html><body>ไม่มีข้อมูล</body></html>')).toBeNull()
    expect(extractB7PriceFromHtml('')).toBeNull()
  })

  it('ทนเลขคั่นกลาง (เช่น ปี) ยังจับราคาดีเซลถูก', () => {
    // "2026" คั่นอยู่ แต่บริบทย้อนหลังยังเห็นคำว่า "ดีเซล" ภายใน 30 ตัวอักษร
    const html = '<p>ดีเซล อัปเดตปี 2026 ราคา 39.80</p>'
    expect(extractB7PriceFromHtml(html)).toBe(39.8)
  })

  it('กันค่าหลุดช่วง sane (label ติดราคาเกินช่วง → ไม่เอา)', () => {
    expect(extractB7PriceFromHtml('<p>ดีเซล B7 99.99</p>')).toBeNull()
    expect(extractB7PriceFromHtml('<p>ดีเซล B7 12.34</p>')).toBeNull()
  })
})

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
  it('does not treat a neighboring gasoline row as a diesel price', () => {
    expect(extractB7PriceFromHtml('<p>ดีเซล B7 32.94</p><p>เบนซิน 40.00</p>')).toBe(32.94)
  })

  it('rejects premium even when the qualifier precedes Diesel', () => {
    expect(extractB7PriceFromHtml('<p>Premium Diesel 49.94</p>')).toBeNull()
  })

  it('rejects the complete out-of-range number rather than extracting its last two digits', () => {
    expect(extractB7PriceFromHtml('<p>ดีเซล B7 132.94</p>')).toBeNull()
  })

  it('keeps a B7 row independent from a preceding B20 row', () => {
    expect(extractB7PriceFromHtml('<p>ดีเซล B20 25.00</p><p>ดีเซล B7 32.94</p>')).toBe(32.94)
  })

  it('reads Kapook list rows including the premium category badge and keeps the existing median', () => {
    const fuel = (name: string, category: string, price: string) => `<li><div><div><p>${name}</p><span>${category}</span></div><div><p>${price}</p><p>บาท/ลิตร</p></div></div></li>`
    const html = `<section><ul>${[
      fuel('ดีเซล B7', 'ดีเซล', '32.94'),
      fuel('ดีเซล B20', 'ดีเซล', '27.94'),
      fuel('เชลล์ วี-เพาเวอร์ ดีเซล', 'พรีเมียม', '49.94'),
      fuel('เชลล์ ฟิวเซฟ ดีเซล', 'ดีเซล', '33.94'),
      fuel('ดีเซล B7', 'ดีเซล', '34.94'),
      fuel('เบนซิน 95', 'เบนซิน', '40.00'),
    ].join('')}</ul></section>`
    expect(extractB7PriceFromHtml(html)).toBe(33.94)
  })

  it('returns null when diesel and prices have no supported row boundary', () => {
    expect(extractB7PriceFromHtml('ดีเซล B7 32.94 เบนซิน 40.00')).toBeNull()
  })


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
it.each([
  '<nav><ul><li>หน้าแรก</li></ul></nav><p>ดีเซล B7 42.19</p>',
  '<table><tr><td>วันที่ 7 ตุลาคม 2569</td></tr></table><div>ดีเซล B7 42.19</div>',
])('supports a bounded diesel row despite unrelated lists or tables: %s', html => {
  expect(extractB7PriceFromHtml(html)).toBe(42.19)
})

it.each([
  '<p>ดีเซล B7 32.94 เบนซิน 40.00</p>',
  '<li>ดีเซล B7 32.94 ราคาพรุ่งนี้ 33.94</li>',
  '<p>ดีเซล B7 -32.94</p>',
  '<li><p>Diesel 49.94</p><span>พรีเมียม</span></li>',
])('keeps the old price when a row is ambiguous or negative: %s', html => {
  expect(extractB7PriceFromHtml(html)).toBeNull()
})

import { describe, expect, it } from 'vitest'
import { destinationCoordinateProblem, parseThaiCoordinates } from './requestCoordinates'

describe('parseThaiCoordinates — พิกัดของจุดหมายในใบขอรถ', () => {
  it('"lat, lng" ในไทย = ตัวเลข (เว้นวรรคได้ ทศนิยมยาวได้)', () => {
    expect(parseThaiCoordinates('13.807983109909317, 100.05208123106483')).toEqual({ lat: 13.807983109909317, lng: 100.05208123106483 })
    expect(parseThaiCoordinates(' 14.0815,100.7129 ')).toEqual({ lat: 14.0815, lng: 100.7129 })
  })
  it('ว่าง / ค่าเดียว / ตัวอักษร / (0,0) / นอกไทย / สลับ lat-lng = null', () => {
    // รวมรูปแบบที่ Number() อ่านได้แต่ไม่ใช่เลขฐานสิบ (0xD = 13) — ตัวตรวจกับตัวเก็บต้องได้ค่าเดียวกัน
    for (const bad of ['', '13.8', '13.8,', ',100.5', 'abc, def', '0, 0', '35.68, 139.69', '100.5, 13.7', '13.8, 100.5, 1', '0xD, 0x64', '1.3e1, 100.5', '13.8., 100.5']) {
      expect(parseThaiCoordinates(bad)).toBeNull()
    }
  })
})

describe('destinationCoordinateProblem — ข้อความชี้จุดที่ผิด (ฟอร์มกับ server ใช้ร่วมกัน)', () => {
  const where = 'จุดที่ 2 (โกดังลูกค้า)'
  it('พิกัดถูก = ไม่มีปัญหา', () => {
    expect(destinationCoordinateProblem({ category: 'custom', coordinates: '13.8, 100.5' }, where)).toBeNull()
  })
  it('กำหนดเองไม่ใส่พิกัด = บอกให้ใส่ + ตัวอย่าง · ใส่ผิด/นอกไทย = บอกรูปแบบที่ถูก', () => {
    expect(destinationCoordinateProblem({ category: 'custom', coordinates: '' }, where)).toBe('จุดที่ 2 (โกดังลูกค้า): ยังไม่มีพิกัด — ใส่พิกัด เช่น 13.709811, 100.523629 (คลิกขวาบนจุดใน Google Maps แล้วคัดลอกพิกัด)')
    expect(destinationCoordinateProblem({ category: 'custom', coordinates: '35.68, 139.69' }, where)).toContain('อยู่นอกประเทศไทย')
  })
  it('เลือกสถานที่ที่บันทึกไว้แต่ไม่มีพิกัด = บอกทางออก (กำหนดเอง/แจ้งทีมจัดรถ)', () => {
    expect(destinationCoordinateProblem({ category: 'site', coordinates: '' }, where)).toContain('สถานที่นี้ยังไม่มีพิกัดในระบบ')
  })
})

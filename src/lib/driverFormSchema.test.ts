import { describe, expect, it } from 'vitest'
import { driverSchema } from './driverFormSchema'

const base = { name: 'สมศักดิ์', phoneNumber: '0812345678' }
const CODE_MSG = 'รหัสพนักงานเป็นตัวเลข 4–6 หลัก'

const issuesAt = (input: unknown, path: string) => {
  const r = driverSchema.safeParse(input)
  return r.success ? [] : r.error.issues.filter((i) => i.path.join('.') === path).map((i) => i.message)
}

describe('driverSchema (ฟอร์มคนขับในหน้าฟลีท)', () => {
  describe('คนขับประจำ — ตรวจรูปแบบรหัสเหมือนเดิม', () => {
    it.each(['123', '1234567', '12a4', 'abcd'])('รหัส "%s" ผิดรูปแบบ → error ที่ employeeCode', (code) => {
      expect(issuesAt({ ...base, employeeCode: code, driverType: 'regular' }, 'employeeCode')).toEqual([CODE_MSG])
    })

    it('รหัสว่าง (ไม่บังคับ) / 4 หลัก / 6 หลัก → ผ่าน', () => {
      for (const code of ['', '1234', '123456']) {
        expect(driverSchema.safeParse({ ...base, employeeCode: code, driverType: 'regular' }).success).toBe(true)
      }
    })

    it('ตัดช่องว่างหัวท้ายก่อนตรวจและก่อนบันทึก', () => {
      const r = driverSchema.parse({ ...base, employeeCode: ' 12345 ', driverType: 'regular' })
      expect(r.employeeCode).toBe('12345')
    })
  })

  describe('คนขับไม่ประจำ — ไม่ตรวจรหัส และบันทึกค่าเดิมกลับตามที่เป็น', () => {
    it.each(['123', ' 12x ', 'abcd', '', '12345'])('รหัส "%s" ไม่บล็อกการบันทึก และค่าไม่ถูกแก้', (code) => {
      const r = driverSchema.safeParse({ ...base, employeeCode: code, driverType: 'occasional' })
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.employeeCode).toBe(code)
        expect(r.data.driverType).toBe('occasional')
      }
    })

    it('ชื่อ/เบอร์ยังตรวจตามเดิม', () => {
      expect(issuesAt({ name: 'ก', phoneNumber: '0812345678', employeeCode: '', driverType: 'occasional' }, 'name')).toHaveLength(1)
      expect(issuesAt({ name: 'สมศักดิ์', phoneNumber: '08', employeeCode: '', driverType: 'occasional' }, 'phoneNumber')).toHaveLength(1)
    })
  })

  it('driverType ต้องเป็น regular / occasional เท่านั้น', () => {
    expect(driverSchema.safeParse({ ...base, employeeCode: '', driverType: 'helper' }).success).toBe(false)
    expect(driverSchema.safeParse({ ...base, employeeCode: '' }).success).toBe(false)
  })
})

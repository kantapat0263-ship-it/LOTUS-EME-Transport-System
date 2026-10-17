import { describe, it, expect } from 'vitest'
import { parseVehicleRequestCommand, VehicleRequestInputError } from './vehicleRequestValidation'

const dest = (o: Record<string, unknown> = {}) => ({
  category: 'custom', siteId: '', siteName: '', customName: 'ศูนย์บริการใบอนุญาตทำงานของคนต่างด้าว จังหวัดนครปฐม',
  coordinates: '13.807983109909317, 100.05208123106483', jobDescription: 'พาแรงงานไปถ่ายใบอนุญาติทำงาน',
  saveAsSite: false, locationType: 'ไซต์งาน', requestTime: '06:30', ...o,
})
const body = (o: Record<string, unknown> = {}, dests: unknown[] = [dest()]) => ({
  operationId: '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b', requestDate: '2026-10-19', requestTime: '06:30',
  requestedBy: 'ผู้ขอ', note: 'รถแคปเท่านั้น', destinations: dests, ...o,
})
/** ข้อความที่ผู้ขอจะเห็น */
const messageOf = (input: unknown) => {
  try {
    parseVehicleRequestCommand(input)
  } catch (e) {
    expect(e).toBeInstanceOf(VehicleRequestInputError)
    return (e as Error).message
  }
  throw new Error('คาดว่าต้องไม่ผ่าน')
}

describe('parseVehicleRequestCommand: เวลาแบบใช้จุด (เคสจริง 2026-10-17)', () => {
  it('"06.30" / "6.30 น." ผ่าน และบันทึกเป็น HH:MM', () => {
    const cmd = parseVehicleRequestCommand(body({ requestTime: '06.30' }, [dest({ requestTime: '6.30 น.' })]))
    expect(cmd.requestTime).toBe('06:30')
    expect(cmd.destinations[0].requestTime).toBe('06:30')
  })
  it('เวลาว่างยังผ่าน (server ใส่ค่าเริ่มต้นเอง)', () => {
    expect(parseVehicleRequestCommand(body({ requestTime: '' }, [dest({ requestTime: '' })])).destinations[0].requestTime).toBe('')
  })
})

describe('parseVehicleRequestCommand: ข้อความแจ้งตรงประเด็นว่าผิดช่องไหน', () => {
  it('เวลาของจุด → บอกจุดที่ + ชื่อสถานที่ + ค่าที่กรอก + รูปแบบที่ถูก', () => {
    expect(messageOf(body({}, [dest(), dest({ customName: 'โกดัง B', requestTime: '25:00' })])))
      .toBe('จุดที่ 2 (โกดัง B): เวลา "25:00" ไม่ถูกต้อง — ใช้รูปแบบ 08:30')
  })
  it('ข้อความยาวเกิน → บอกช่อง + เพดาน', () => {
    expect(messageOf(body({ note: 'x'.repeat(2001) }))).toBe('หมายเหตุเพิ่มเติมยาวเกิน 2,000 ตัวอักษร')
    expect(messageOf(body({}, [dest({ jobDescription: 'x'.repeat(4001) })])))
      .toBe('จุดที่ 1 (ศูนย์บริการใบอนุญาตทำงานของคนต่างด้าว จังหวัดนครปฐม): ลักษณะงานที่ต้องทำยาวเกิน 4,000 ตัวอักษร')
    expect(messageOf(body({}, [dest({ customName: 'ก'.repeat(201) })]))).toMatch(/^จุดที่ 1: ชื่อสถานที่ยาวเกิน 200 ตัวอักษร$/)
    expect(messageOf(body({ requestedBy: 'x'.repeat(121) }))).toBe('ชื่อผู้ขอใช้รถยาวเกิน 120 ตัวอักษร')
  })
  it('ไม่ได้เลือก/ไม่ได้ใส่ชื่อสถานที่ · ไม่มีจุดหมาย · วันที่ผิด', () => {
    expect(messageOf(body({}, [dest({ customName: '  ' })]))).toBe('จุดที่ 1: ยังไม่ได้ใส่ชื่อสถานที่')
    expect(messageOf(body({}, [dest({ category: 'site', siteId: '', siteName: '' })]))).toBe('จุดที่ 1: ยังไม่ได้เลือกสถานที่')
    expect(messageOf(body({}, []))).toBe('ต้องมีจุดหมายอย่างน้อย 1 จุด')
    expect(messageOf(body({ requestDate: '2026-02-30' }))).toBe('วันที่ขอรถไม่ถูกต้อง — เลือกวันใหม่')
  })
  it('ผิดหลายช่อง → บอกได้หลายข้อ (สูงสุด 3)', () => {
    expect(messageOf(body({ note: 'x'.repeat(2001) }, [dest({ requestTime: 'abc' })])))
      .toBe('หมายเหตุเพิ่มเติมยาวเกิน 2,000 ตัวอักษร · จุดที่ 1 (ศูนย์บริการใบอนุญาตทำงานของคนต่างด้าว จังหวัดนครปฐม): เวลา "abc" ไม่ถูกต้อง — ใช้รูปแบบ 08:30')
  })
  it('ฟิลด์ส่วนเกินในจุดหมาย (ชื่อครบ) ต้องไม่บอกว่า "ยังไม่ได้ใส่ชื่อ" (Codex ข้อ 2)', () => {
    expect(messageOf(body({}, [dest({ extra: 1 })]))).toBe('ข้อมูลใบขอรถไม่ถูกต้อง — กรุณาโหลดหน้าใหม่ (F5) แล้วส่งอีกครั้ง')
    expect(messageOf(body({}, [dest({ locationType: 'x'.repeat(61) })])))
      .toBe('จุดที่ 1 (ศูนย์บริการใบอนุญาตทำงานของคนต่างด้าว จังหวัดนครปฐม): ประเภทสถานที่ยาวเกิน 60 ตัวอักษร')
    expect(messageOf(body({}, [dest({ category: 'site', siteId: 'a/b', siteName: 'โกดัง' })]))).toBe('จุดที่ 1 (โกดัง): สถานที่ไม่ถูกต้อง — เลือกสถานที่ใหม่')
  })
  it('ค่าเวลายาวมากไม่ถูกใส่กลับทั้งหมด (Codex ข้อ 4)', () => {
    expect(messageOf(body({}, [dest({ requestTime: '9'.repeat(500) })])))
      .toBe(`จุดที่ 1 (ศูนย์บริการใบอนุญาตทำงานของคนต่างด้าว จังหวัดนครปฐม): เวลา "${'9'.repeat(20)}…" ไม่ถูกต้อง — ใช้รูปแบบ 08:30`)
  })
  it('ข้อมูลที่ผู้ขอแก้เองไม่ได้ (ฟอร์มรุ่นเก่า/ส่งฟิลด์แปลก) → ให้โหลดหน้าใหม่', () => {
    expect(messageOf(body({ status: 'in_progress' }))).toBe('ข้อมูลใบขอรถไม่ถูกต้อง — กรุณาโหลดหน้าใหม่ (F5) แล้วส่งอีกครั้ง')
    expect(messageOf(body({ operationId: 'not-a-uuid' }))).toBe('ข้อมูลใบขอรถไม่ถูกต้อง — กรุณาโหลดหน้าใหม่ (F5) แล้วส่งอีกครั้ง')
    expect(messageOf(null)).toBe('ข้อมูลใบขอรถไม่ถูกต้อง — กรุณาโหลดหน้าใหม่ (F5) แล้วส่งอีกครั้ง')
  })
})

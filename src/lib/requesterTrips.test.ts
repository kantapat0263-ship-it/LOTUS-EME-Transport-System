import { describe, expect, it } from 'vitest'
import { isRequesterTrip } from './requesterTrips'

const me = { uid: 'u-somchai-1', email: 'somchai@lotus.co.th', name: 'สมชาย' }

describe('isRequesterTrip — หน้าประวัติ/Dashboard ของผู้ขอ', () => {
  it('จุดที่มีรหัสบัญชีของฉัน: เห็น แม้พิมพ์ชื่อผู้ขอเป็นชื่ออื่น (ชื่อเล่น/ขอแทนเพื่อน) หรือเปลี่ยนชื่อโปรไฟล์ (เดิมหาย)', () => {
    expect(isRequesterTrip({ stops: [{ requestedBy: 'ชาย (ขอแทนพี่ใหญ่)', requestedByUserId: 'u-somchai-1' }] }, me)).toBe(true)
    expect(isRequesterTrip({ stops: [{ requestedBy: 'สมชาย', requestedByUserId: 'u-somchai-1' }] }, { ...me, name: 'สมชาย ใจดี' })).toBe(true)
  })

  it('คนจัดรถ/เพื่อนกรอกใบแทน (รหัสเป็นของคนกรอก) แต่ระบุชื่อฉัน: ยังเห็นเหมือนเดิม', () => {
    expect(isRequesterTrip({ stops: [{ requestedBy: 'สมชาย', requestedByUserId: 'u-dispatcher' }] }, me)).toBe(true)
  })

  it('ไม่ใช่รหัสฉัน และชื่อไม่ตรง: ไม่เห็น', () => {
    expect(isRequesterTrip({ stops: [{ requestedBy: 'สมศรี', requestedByUserId: 'u-somsri' }] }, me)).toBe(false)
  })

  it('จุดเก่าที่ไม่มีรหัส (หรือรหัสว่าง): เทียบชื่อ/อีเมลแบบเดิม', () => {
    expect(isRequesterTrip({ stops: [{ requestedBy: 'สมชาย' }] }, me)).toBe(true)
    expect(isRequesterTrip({ stops: [{ requestedBy: 'somchai@lotus.co.th', requestedByUserId: '' }] }, me)).toBe(true)
    expect(isRequesterTrip({ stops: [{ requestedBy: 'สมศรี' }] }, me)).toBe(false)
  })

  it('เที่ยวหลายจุด: มีจุดของฉันสักจุดก็เห็น', () => {
    expect(isRequesterTrip({ stops: [{ requestedBy: 'สมศรี', requestedByUserId: 'u-x' }, { requestedBy: 'x', requestedByUserId: 'u-somchai-1' }] }, me)).toBe(true)
  })

  it('ช่องระดับทริปรุ่นเก่ายังใช้ได้', () => {
    expect(isRequesterTrip({ userId: 'u-somchai-1', stops: [] }, me)).toBe(true)
    expect(isRequesterTrip({ requestedByEmail: 'somchai@lotus.co.th' }, me)).toBe(true)
    expect(isRequesterTrip({ requesterEmail: 'somchai@lotus.co.th' }, me)).toBe(true)
    expect(isRequesterTrip({ requestedBy: 'สมชาย' }, me)).toBe(true)
  })

  it('ข้อมูลว่างไม่นับเป็นของใคร (เดิม email ว่าง = ตรงกับช่องว่างของทริป)', () => {
    expect(isRequesterTrip({ stops: [{}] }, { uid: 'u-1' })).toBe(false)
    expect(isRequesterTrip({ stops: [{ requestedBy: '' }] }, { uid: 'u-1', email: '', name: '' })).toBe(false)
    expect(isRequesterTrip({ stops: [{ requestedByUserId: '' }] }, { uid: '' })).toBe(false)
    expect(isRequesterTrip({}, {})).toBe(false)
  })
})

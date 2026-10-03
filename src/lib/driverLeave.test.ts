import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatLeaveRange,
  leaveBadgeText,
  leaveConfirmLines,
  leaveStatusOn,
  thaiToday,
  validateLeaveResponse,
  type ApiLeave,
  type Coverage,
  type DriverLeaveStatus,
  type LeaveApiResponse,
  type LeaveItem,
} from './driverLeave'

// ---------- helpers ----------

const EMPLOYEES: LeaveApiResponse['employees'] = { '10001': { name: 'สมศักดิ์', active: true } }

// ใบลาตั้งต้น = ลาพักร้อน 3–7 ต.ค. อนุมัติแล้ว เต็มวัน (override ได้ทีละฟิลด์)
const res = (
  leaves: Partial<ApiLeave>[],
  employees: LeaveApiResponse['employees'] = EMPLOYEES,
): LeaveApiResponse => ({
  employees,
  leaves: leaves.map(
    (l): ApiLeave => ({
      code: '10001',
      type: 'vacation',
      typeLabel: 'ลาพักร้อน',
      start: '2026-10-03',
      end: '2026-10-07',
      days: 5,
      status: 'approved',
      timing: null,
      edges: null,
      ...l,
    }),
  ),
})

const cov: Coverage = { from: '2026-10-01', to: '2026-10-31' }

const items = (s: DriverLeaveStatus): LeaveItem[] => {
  if (s.kind !== 'leave') throw new Error(`expected kind "leave" but got "${s.kind}"`)
  return s.items
}

const item = (o: Partial<LeaveItem> = {}): LeaveItem => ({
  approved: true,
  typeLabel: 'ลากิจ',
  start: '2026-10-05',
  end: '2026-10-05',
  days: 1,
  part: null,
  ...o,
})

const leaveOf = (list: LeaveItem[]): DriverLeaveStatus => ({ kind: 'leave', name: 'สมศักดิ์', items: list })

// ใบวันเดียวที่ 10 ต.ค. (ลากิจ) — ใช้ซ้ำในเทสต์ "หลายใบในวันเดียว"
const DAY = '2026-10-10'
const oneDay = (o: Partial<ApiLeave>): Partial<ApiLeave> => ({
  start: DAY,
  end: DAY,
  type: 'personal',
  typeLabel: 'ลากิจ',
  days: 0.5,
  ...o,
})

// ---------- leaveStatusOn ----------

describe('leaveStatusOn', () => {
  it('ทับวันแรก/วันสุดท้าย นับ · วันก่อน/หลังไม่นับ', () => {
    const r = res([{}]) // 3–7 ต.ค.
    expect(leaveStatusOn('10001', '2026-10-03', r, cov).kind).toBe('leave')
    expect(leaveStatusOn('10001', '2026-10-07', r, cov).kind).toBe('leave')
    expect(leaveStatusOn('10001', '2026-10-02', r, cov)).toEqual({ kind: 'free', name: 'สมศักดิ์' })
    expect(leaveStatusOn('10001', '2026-10-08', r, cov)).toEqual({ kind: 'free', name: 'สมศักดิ์' })
  })

  it('leave พกชื่อ + รายละเอียดใบ (ประเภท/ช่วงวัน/จำนวนวัน) ครบ', () => {
    const s = leaveStatusOn('10001', '2026-10-05', res([{}]), cov)
    expect(s).toEqual({
      kind: 'leave',
      name: 'สมศักดิ์',
      items: [
        { approved: true, typeLabel: 'ลาพักร้อน', start: '2026-10-03', end: '2026-10-07', days: 5, part: null },
      ],
    })
  })

  it('unmapped เมื่อไม่มีรหัส (undefined / ว่าง / มีแต่ช่องว่าง)', () => {
    expect(leaveStatusOn(undefined, '2026-10-05', res([]), cov).kind).toBe('unmapped')
    expect(leaveStatusOn('', '2026-10-05', res([]), cov).kind).toBe('unmapped')
    expect(leaveStatusOn('   ', '2026-10-05', res([]), cov).kind).toBe('unmapped')
  })

  it('unmapped ชนะ unknown (ไม่มีรหัสก็ไม่ต้องรอข้อมูล)', () => {
    expect(leaveStatusOn(undefined, '2026-10-05', null, null).kind).toBe('unmapped')
  })

  it('unknown เมื่อ res เป็น null (กำลังโหลด/พัง)', () => {
    expect(leaveStatusOn('10001', '2026-10-05', null, cov)).toEqual({ kind: 'unknown' })
  })

  it('unknown เมื่อ coverage เป็น null', () => {
    expect(leaveStatusOn('10001', '2026-10-05', res([]), null)).toEqual({ kind: 'unknown' })
  })

  it('unknown เมื่อวันอยู่นอก coverage · ขอบหัวท้ายยังอยู่ใน coverage', () => {
    const r = res([])
    expect(leaveStatusOn('10001', '2026-09-30', r, cov)).toEqual({ kind: 'unknown' })
    expect(leaveStatusOn('10001', '2026-11-01', r, cov)).toEqual({ kind: 'unknown' })
    expect(leaveStatusOn('10001', '2026-10-01', r, cov).kind).toBe('free')
    expect(leaveStatusOn('10001', '2026-10-31', r, cov).kind).toBe('free')
  })

  it('unknown เมื่อไม่มีวันที่ ("" / undefined — ทริปเก่ามีแค่ date ไม่มี tripDate) ห้ามกลายเป็น free', () => {
    const r = res([])
    expect(leaveStatusOn('10001', '', r, cov)).toEqual({ kind: 'unknown' })
    expect(leaveStatusOn('10001', undefined as unknown as string, r, cov)).toEqual({ kind: 'unknown' })
  })

  it('ไม่ผูกรหัส + ไม่มีวันที่ → ยัง unmapped (ตัดสิน unmapped ก่อนเช็กวันที่)', () => {
    expect(leaveStatusOn(undefined, '', res([]), cov)).toEqual({ kind: 'unmapped' })
    expect(leaveStatusOn('', undefined as unknown as string, res([]), cov)).toEqual({ kind: 'unmapped' })
  })

  it('unknown เมื่อ code ไม่มี key ใน employees (ไม่ใช่ free) · key ที่สืบทอดจาก Object ไม่นับ', () => {
    expect(leaveStatusOn('99999', '2026-10-05', res([]), cov)).toEqual({ kind: 'unknown' })
    expect(leaveStatusOn('constructor', '2026-10-05', res([]), cov)).toEqual({ kind: 'unknown' })
  })

  it('not_found เมื่อ employees[code] === null (ต่างจาก unknown)', () => {
    const r = res([], { '10001': null })
    expect(leaveStatusOn('10001', '2026-10-05', r, cov)).toEqual({ kind: 'not_found' })
  })

  it('inactive ชนะ leave', () => {
    const r = res([{}], { '10001': { name: 'สมศักดิ์', active: false } })
    expect(leaveStatusOn('10001', '2026-10-05', r, cov)).toEqual({ kind: 'inactive', name: 'สมศักดิ์' })
  })

  it('ตัดช่องว่างรอบรหัสก่อนค้น · ใบของพนักงานคนอื่นไม่นับ', () => {
    const employees = { '10001': { name: 'สมศักดิ์', active: true }, '10002': { name: 'สมหมาย', active: true } }
    const r = res([{ code: '10002' }], employees)
    expect(leaveStatusOn(' 10001 ', '2026-10-05', r, cov)).toEqual({ kind: 'free', name: 'สมศักดิ์' })
    expect(leaveStatusOn(' 10002 ', '2026-10-05', r, cov).kind).toBe('leave')
  })

  it('awaiting_doc = approved:true · pending = approved:false', () => {
    const approvedOf = (status: ApiLeave['status']) =>
      items(leaveStatusOn('10001', '2026-10-05', res([{ status }]), cov))[0].approved
    expect(approvedOf('approved')).toBe(true)
    expect(approvedOf('awaiting_doc')).toBe(true)
    expect(approvedOf('pending')).toBe(false)
  })

  it('เก็บทุกใบในวันเดียว: เช้า approved + บ่าย pending', () => {
    const s = leaveStatusOn(
      '10001',
      DAY,
      res([
        oneDay({ timing: { mode: 'am', start: '08:00', end: '12:00' } }),
        oneDay({ typeLabel: 'ลาพักร้อน', status: 'pending', timing: { mode: 'pm', start: '13:00', end: '17:00' } }),
      ]),
      cov,
    )
    expect(s.kind).toBe('leave')
    expect(items(s).map((i) => [i.part, i.approved])).toEqual([
      ['am', true],
      ['pm', false],
    ])
  })

  it('hours แนบช่วงเวลา', () => {
    const s = leaveStatusOn(
      '10001',
      DAY,
      res([oneDay({ timing: { mode: 'hours', start: '13:00', end: '15:00' } })]),
      cov,
    )
    const [i] = items(s)
    expect(i.part).toBe('hours')
    expect(i.hours).toBe('13:00–15:00')
  })

  it('part อื่นไม่มี hours · ใบวันเดียวที่ timing เป็น null = เต็มวัน', () => {
    const am = items(leaveStatusOn('10001', DAY, res([oneDay({ timing: { mode: 'am', start: '08:00', end: '12:00' } })]), cov))[0]
    const full = items(leaveStatusOn('10001', DAY, res([oneDay({ days: 1 })]), cov))[0]
    expect(am.hours).toBeUndefined()
    expect(full.part).toBeNull()
    expect(full.hours).toBeUndefined()
  })

  it('ใบหลายวัน: วันแรก edges.start = pm · วันสุดท้าย edges.end = am · วันกลาง null', () => {
    const r = res([
      { edges: { start: { start: '13:00', end: '17:00' }, end: { start: '08:00', end: '12:00' } } },
    ]) // 3–7 ต.ค.
    const partOn = (d: string) => items(leaveStatusOn('10001', d, r, cov))[0].part
    expect(partOn('2026-10-03')).toBe('pm')
    expect(partOn('2026-10-04')).toBeNull()
    expect(partOn('2026-10-05')).toBeNull()
    expect(partOn('2026-10-07')).toBe('am')
  })

  it('ใบหลายวันที่ edges ฝั่งนั้นเป็น null = วันแรก/วันสุดท้ายเต็มวัน', () => {
    const r = res([{ edges: { start: null, end: { start: '08:00', end: '12:00' } } }])
    expect(items(leaveStatusOn('10001', '2026-10-03', r, cov))[0].part).toBeNull()
    expect(items(leaveStatusOn('10001', '2026-10-07', r, cov))[0].part).toBe('am')
  })

  it('ใบหลายวัน (วันสุดท้ายลาเช้า) + ใบวันเดียวลาบ่าย → ทั้ง 2 ใบไม่หายจากวันนั้น', () => {
    const s = leaveStatusOn(
      '10001',
      '2026-10-05',
      res([
        { start: '2026-10-03', end: '2026-10-05', days: 2.5, edges: { start: null, end: { start: '08:00', end: '12:00' } } },
        oneDay({ start: '2026-10-05', end: '2026-10-05', status: 'pending', timing: { mode: 'pm', start: '13:00', end: '17:00' } }),
      ]),
      cov,
    )
    expect(items(s).map((i) => [i.typeLabel, i.part, i.approved])).toEqual([
      ['ลาพักร้อน', 'am', true],
      ['ลากิจ', 'pm', false],
    ])
  })

  it('เรียงในวัน: เช้า → เต็มวัน/รายชั่วโมงตามเวลาเริ่ม (เต็มวันก่อนถ้าเท่ากัน) → บ่าย', () => {
    const s = leaveStatusOn(
      '10001',
      DAY,
      res([
        oneDay({ typeLabel: 'บ่าย', timing: { mode: 'pm', start: '13:00', end: '17:00' } }),
        oneDay({ typeLabel: 'ชม.13', timing: { mode: 'hours', start: '13:00', end: '15:00' } }),
        oneDay({ typeLabel: 'ชม.09', timing: { mode: 'hours', start: '09:00', end: '10:00' } }),
        oneDay({ typeLabel: 'เต็มวัน', days: 1, timing: null }),
        oneDay({ typeLabel: 'เช้า', timing: { mode: 'am', start: '08:00', end: '12:00' } }),
      ]),
      cov,
    )
    expect(items(s).map((i) => i.typeLabel)).toEqual(['เช้า', 'เต็มวัน', 'ชม.09', 'ชม.13', 'บ่าย'])
  })

  it('เรียงในวัน: เต็มวันมาก่อนรายชั่วโมงแม้เริ่ม 00:00 เท่ากัน', () => {
    const s = leaveStatusOn(
      '10001',
      DAY,
      res([
        oneDay({ typeLabel: 'ชม.00', timing: { mode: 'hours', start: '00:00', end: '01:00' } }),
        oneDay({ typeLabel: 'เต็มวัน', days: 1, timing: null }),
      ]),
      cov,
    )
    expect(items(s).map((i) => i.typeLabel)).toEqual(['เต็มวัน', 'ชม.00'])
  })
})

// ---------- validateLeaveResponse ----------

const rawLeave = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  code: '10001',
  type: 'personal',
  typeLabel: 'ลากิจ',
  start: '2026-10-05',
  end: '2026-10-05',
  days: 0.5,
  status: 'approved',
  timing: { mode: 'am', start: '08:00', end: '12:00' },
  edges: null,
  ...over,
})
const rawRes = (
  leaves: unknown = [rawLeave()],
  employees: unknown = { '10001': { name: 'นายสมศักดิ์', active: true }, '99999': null },
) => ({ employees, leaves })
const without = (o: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key))

describe('validateLeaveResponse', () => {
  it('ผ่านเมื่อรูปถูก (employees มีทั้ง null และ object · ใบมี timing/edges)', () => {
    const input = rawRes([
      rawLeave(),
      rawLeave({
        start: '2026-10-03',
        end: '2026-10-07',
        days: 5,
        status: 'awaiting_doc',
        timing: null,
        edges: { start: { start: '13:00', end: '17:00' }, end: null },
      }),
      rawLeave({ status: 'pending', timing: { mode: 'hours', start: '13:00', end: '15:00' } }),
    ])
    expect(validateLeaveResponse(input)).toEqual(input)
  })

  it('ผ่านเมื่อไม่มีใบลาเลย / ไม่มีพนักงานเลย', () => {
    expect(validateLeaveResponse({ employees: {}, leaves: [] })).toEqual({ employees: {}, leaves: [] })
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['undefined', undefined],
    ['ตัวเลข', 42],
    ['array', []],
    ['สตริงธรรมดา', 'ok'],
    ['สตริง HTML (เช่นหน้า error ของ proxy)', '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>'],
    ['ไม่มี employees', { leaves: [] }],
    ['employees เป็น null', { employees: null, leaves: [] }],
    ['employees เป็น array', { employees: [], leaves: [] }],
    ['ไม่มี leaves', { employees: {} }],
    ['leaves ไม่ใช่ array', { employees: {}, leaves: {} }],
    ['employees entry เป็นสตริง', rawRes([], { '10001': 'สมศักดิ์' })],
    ['employees entry ไม่มี active', rawRes([], { '10001': { name: 'สมศักดิ์' } })],
    ['employees entry active ไม่ใช่ boolean', rawRes([], { '10001': { name: 'สมศักดิ์', active: 1 } })],
    ['employees entry name ไม่ใช่สตริง', rawRes([], { '10001': { name: null, active: true } })],
    ['ใบลาเป็นสตริง', rawRes(['x'])],
    ['ใบลา code ไม่ใช่สตริง', rawRes([rawLeave({ code: 10001 })])],
    ['ใบลาไม่มี typeLabel', rawRes([without(rawLeave(), 'typeLabel')])],
    ['status แปลก', rawRes([rawLeave({ status: 'weird' })])],
    ['status draft (ไม่อยู่ในสัญญา)', rawRes([rawLeave({ status: 'draft' })])],
    ['status ไม่มี', rawRes([without(rawLeave(), 'status')])],
    ['start รูปผิด (D/M/Y)', rawRes([rawLeave({ start: '05/10/2026' })])],
    ['start วันเดือนไม่เติมศูนย์', rawRes([rawLeave({ start: '2026-10-5' })])],
    ['start เดือนที่ 13', rawRes([rawLeave({ start: '2026-13-01' })])],
    ['end วันที่ไม่มีจริง (30 ก.พ.)', rawRes([rawLeave({ end: '2026-02-30' })])],
    ['end ไม่ใช่สตริง', rawRes([rawLeave({ end: 20261005 })])],
    ['days เป็นสตริง', rawRes([rawLeave({ days: '0.5' })])],
    ['days เป็น null', rawRes([rawLeave({ days: null })])],
    ['timing ไม่มีฟิลด์ (ต้องเป็น null อย่างชัดเจน)', rawRes([without(rawLeave(), 'timing')])],
    ['timing mode แปลก', rawRes([rawLeave({ timing: { mode: 'night', start: '08:00', end: '12:00' } })])],
    ['timing ไม่มี end', rawRes([rawLeave({ timing: { mode: 'am', start: '08:00' } })])],
    ['edges ไม่มีฟิลด์', rawRes([without(rawLeave(), 'edges')])],
    ['edges.start เป็นสตริง', rawRes([rawLeave({ edges: { start: '13:00', end: null } })])],
    ['edges ไม่มี end', rawRes([rawLeave({ edges: { start: null } })])],
    ['edges.end ไม่มีเวลา', rawRes([rawLeave({ edges: { start: null, end: { start: '08:00' } } })])],
  ])('throw: %s', (_name, input) => {
    expect(() => validateLeaveResponse(input)).toThrow(Error)
  })

  it('ข้อความ error ชี้ตำแหน่งที่ผิด', () => {
    expect(() => validateLeaveResponse(rawRes([rawLeave(), rawLeave({ status: 'weird' })]))).toThrow(
      /leaves\[1\]\.status/,
    )
  })
})

// ---------- formatLeaveRange ----------

describe('formatLeaveRange', () => {
  it('วันเดียว', () => expect(formatLeaveRange('2026-10-05', '2026-10-05')).toBe('5 ต.ค.'))
  it('เดือนเดียว', () => expect(formatLeaveRange('2026-10-03', '2026-10-07')).toBe('3–7 ต.ค.'))
  it('ข้ามเดือน', () => expect(formatLeaveRange('2026-09-30', '2026-10-02')).toBe('30 ก.ย.–2 ต.ค.'))
  it('ข้ามปี ใส่ พ.ศ. 2 หลัก', () =>
    expect(formatLeaveRange('2026-12-30', '2027-01-02')).toBe('30 ธ.ค. 69–2 ม.ค. 70'))
  it('วันเดียวไม่ใส่ปีแม้เป็นวันสิ้นปี', () => expect(formatLeaveRange('2026-12-31', '2026-12-31')).toBe('31 ธ.ค.'))
  it('ชื่อเดือนย่อครบ 12 เดือน', () => {
    const names = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
    names.forEach((name, idx) => {
      const mm = String(idx + 1).padStart(2, '0')
      expect(formatLeaveRange(`2026-${mm}-01`, `2026-${mm}-01`)).toBe(`1 ${name}`)
    })
  })
})

// ---------- leaveBadgeText ----------

describe('leaveBadgeText', () => {
  it('หลายวันอนุมัติ', () => {
    const s = leaveOf([item({ typeLabel: 'ลาพักร้อน', start: '2026-10-03', end: '2026-10-07', days: 5 })])
    expect(leaveBadgeText(s)).toBe('🏖 ลาพักร้อน 3–7 ต.ค.')
  })

  it('วันเดียว', () => {
    expect(leaveBadgeText(leaveOf([item()]))).toBe('🏖 ลากิจ')
  })

  it('ครึ่งวันเช้า / ครึ่งวันบ่าย (ติดกับชื่อประเภท)', () => {
    expect(leaveBadgeText(leaveOf([item({ part: 'am' })]))).toBe('🏖 ลากิจครึ่งวันเช้า')
    expect(leaveBadgeText(leaveOf([item({ part: 'pm' })]))).toBe('🏖 ลากิจครึ่งวันบ่าย')
  })

  it('ชั่วโมง (เว้นวรรคก่อนช่วงเวลา)', () => {
    expect(leaveBadgeText(leaveOf([item({ part: 'hours', hours: '13:00–15:00' })]))).toBe('🏖 ลากิจ 13:00–15:00')
  })

  it('ใบหลายวันที่วันนั้นเป็นครึ่งวัน → แสดง part ของวันที่ถาม', () => {
    const s = leaveOf([item({ typeLabel: 'ลาพักร้อน', start: '2026-10-03', end: '2026-10-07', days: 5, part: 'pm' })])
    expect(leaveBadgeText(s)).toBe('🏖 ลาพักร้อนครึ่งวันบ่าย')
  })

  it('รออนุมัติ', () => {
    const s = leaveOf([
      item({ approved: false, typeLabel: 'ลาพักร้อน', start: '2026-10-04', end: '2026-10-06', days: 3 }),
    ])
    expect(leaveBadgeText(s)).toBe('⏳ ยื่นลาพักร้อน 4–6 ต.ค. (รออนุมัติ)')
  })

  it('รออนุมัติ วันเดียว / ครึ่งวัน / ชั่วโมง', () => {
    expect(leaveBadgeText(leaveOf([item({ approved: false })]))).toBe('⏳ ยื่นลากิจ (รออนุมัติ)')
    expect(leaveBadgeText(leaveOf([item({ approved: false, part: 'am' })]))).toBe('⏳ ยื่นลากิจครึ่งวันเช้า (รออนุมัติ)')
    expect(leaveBadgeText(leaveOf([item({ approved: false, part: 'hours', hours: '09:00–10:30' })]))).toBe(
      '⏳ ยื่นลากิจ 09:00–10:30 (รออนุมัติ)',
    )
  })

  it('หลายใบ: มี approved อย่างน้อย 1 → 🏖 ลา N ช่วง', () => {
    const both = leaveOf([item({ part: 'am' }), item({ part: 'pm', approved: false })])
    expect(leaveBadgeText(both)).toBe('🏖 ลา 2 ช่วง')
    const bothApproved = leaveOf([item({ part: 'am' }), item({ part: 'pm' })])
    expect(leaveBadgeText(bothApproved)).toBe('🏖 ลา 2 ช่วง')
  })

  it('หลายใบ: pending ทั้งหมด → ⏳ ลา N ช่วง (รออนุมัติ)', () => {
    const s = leaveOf([item({ part: 'am', approved: false }), item({ part: 'pm', approved: false })])
    expect(leaveBadgeText(s)).toBe('⏳ ลา 2 ช่วง (รออนุมัติ)')
  })

  it('หลายใบ: ใช้จำนวนใบจริง (3 ใบ)', () => {
    const three = leaveOf([item({ approved: false }), item({ approved: false }), item({ approved: false })])
    expect(leaveBadgeText(three)).toBe('⏳ ลา 3 ช่วง (รออนุมัติ)')
    expect(leaveBadgeText(leaveOf([item({ approved: false }), item(), item({ approved: false })]))).toBe('🏖 ลา 3 ช่วง')
  })

  it('unmapped / not_found / driver_missing / inactive', () => {
    expect(leaveBadgeText({ kind: 'unmapped' })).toBe('❔ ยังไม่ผูกรหัสพนักงาน')
    expect(leaveBadgeText({ kind: 'not_found' })).toBe('❔ ไม่พบรหัสในระบบใบลา')
    expect(leaveBadgeText({ kind: 'driver_missing' })).toBe('❔ ไม่พบข้อมูลคนขับ')
    expect(leaveBadgeText({ kind: 'inactive', name: 'สมศักดิ์' })).toBe('⛔ พ้นสภาพในระบบใบลา')
  })

  it('free และ unknown = "" (ไม่มีป้าย)', () => {
    expect(leaveBadgeText({ kind: 'free', name: 'สมศักดิ์' })).toBe('')
    expect(leaveBadgeText({ kind: 'unknown' })).toBe('')
  })

  it('ต่อกับ leaveStatusOn จริง: ใบหลายวันที่ 5 ต.ค.', () => {
    const s = leaveStatusOn('10001', '2026-10-05', res([{}]), cov)
    expect(leaveBadgeText(s)).toBe('🏖 ลาพักร้อน 3–7 ต.ค.')
  })
})

// ---------- leaveConfirmLines ----------

describe('leaveConfirmLines', () => {
  const twoItemStatus = leaveOf([
    item({ typeLabel: 'ลากิจ', start: '2026-10-10', end: '2026-10-10', days: 0.5, part: 'am' }),
    item({ typeLabel: 'ลาพักร้อน', start: '2026-10-10', end: '2026-10-10', days: 0.5, part: 'pm', approved: false }),
  ])

  it('แจกแจงทุกใบ', () => {
    expect(leaveConfirmLines('สมศักดิ์', '2026-10-10', twoItemStatus)).toEqual([
      '⚠️ สมศักดิ์ ลาวันที่ 10 ต.ค.',
      '• ลากิจ ครึ่งวันเช้า · อนุมัติแล้ว',
      '• ลาพักร้อน ครึ่งวันบ่าย · รออนุมัติ',
    ])
  })

  it('หลายวัน แสดงช่วง+จำนวนวัน', () => {
    const s = leaveOf([item({ typeLabel: 'ลาพักร้อน', start: '2026-10-03', end: '2026-10-07', days: 5 })])
    expect(leaveConfirmLines('สมศักดิ์', '2026-10-05', s)).toEqual([
      '⚠️ สมศักดิ์ ลาวันที่ 5 ต.ค.',
      '• ลาพักร้อน 3–7 ต.ค. (5 วัน) · อนุมัติแล้ว',
    ])
  })

  it('หลายวัน: จำนวนวันพิมพ์ตามที่ให้มา (ทศนิยมไม่ถูกปัด) + รออนุมัติ', () => {
    const s = leaveOf([
      item({ approved: false, typeLabel: 'ลาป่วย', start: '2026-09-30', end: '2026-10-02', days: 2.5 }),
    ])
    expect(leaveConfirmLines('สมศักดิ์', '2026-10-01', s)).toEqual([
      '⚠️ สมศักดิ์ ลาวันที่ 1 ต.ค.',
      '• ลาป่วย 30 ก.ย.–2 ต.ค. (2.5 วัน) · รออนุมัติ',
    ])
  })

  it('วันเดียวเต็มวัน: ไม่มีช่วง/จำนวนวัน', () => {
    expect(leaveConfirmLines('สมศักดิ์', '2026-10-05', leaveOf([item()]))).toEqual([
      '⚠️ สมศักดิ์ ลาวันที่ 5 ต.ค.',
      '• ลากิจ · อนุมัติแล้ว',
    ])
  })

  it('รายชั่วโมง: เว้นวรรคแล้วตามด้วยช่วงเวลา', () => {
    const s = leaveOf([item({ part: 'hours', hours: '13:00–15:00', days: 0.25 })])
    expect(leaveConfirmLines('สมศักดิ์', '2026-10-05', s)).toEqual([
      '⚠️ สมศักดิ์ ลาวันที่ 5 ต.ค.',
      '• ลากิจ 13:00–15:00 · อนุมัติแล้ว',
    ])
  })

  it('ใช้ชื่อที่ผู้เรียกส่งมา (ไม่ใช่ชื่อในระบบใบลา) ในบรรทัดแรก', () => {
    const s: DriverLeaveStatus = { kind: 'leave', name: 'นายสมศักดิ์ ใจดี', items: [item()] }
    expect(leaveConfirmLines('พี่ศักดิ์', '2026-10-05', s)[0]).toBe('⚠️ พี่ศักดิ์ ลาวันที่ 5 ต.ค.')
  })

  it('inactive', () => {
    expect(leaveConfirmLines('สมศักดิ์', '2026-10-10', { kind: 'inactive', name: 'นายสมศักดิ์ ใจดี' })).toEqual([
      '⛔ สมศักดิ์ พ้นสภาพในระบบใบลาแล้ว',
    ])
  })

  it.each<[string, DriverLeaveStatus]>([
    ['free', { kind: 'free', name: 'สมศักดิ์' }],
    ['unknown', { kind: 'unknown' }],
    ['unmapped', { kind: 'unmapped' }],
    ['not_found', { kind: 'not_found' }],
    ['driver_missing', { kind: 'driver_missing' }],
  ])('%s → ไม่มีบรรทัด (ไม่ถามซ้ำ)', (_kind, s) => {
    expect(leaveConfirmLines('สมศักดิ์', '2026-10-10', s)).toEqual([])
  })

  it('ต่อกับ leaveStatusOn จริง: เช้า approved + บ่าย pending', () => {
    const s = leaveStatusOn(
      '10001',
      DAY,
      res([
        oneDay({ timing: { mode: 'am', start: '08:00', end: '12:00' } }),
        oneDay({ typeLabel: 'ลาพักร้อน', status: 'pending', timing: { mode: 'pm', start: '13:00', end: '17:00' } }),
      ]),
      cov,
    )
    expect(leaveConfirmLines('สมศักดิ์', DAY, s)).toEqual([
      '⚠️ สมศักดิ์ ลาวันที่ 10 ต.ค.',
      '• ลากิจ ครึ่งวันเช้า · อนุมัติแล้ว',
      '• ลาพักร้อน ครึ่งวันบ่าย · รออนุมัติ',
    ])
  })
})

// ---------- thaiToday ----------

describe('thaiToday', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('00:30 ไทย = วันไทย ไม่ใช่วัน UTC', () => {
    expect(thaiToday(new Date('2026-10-04T17:30:00Z'))).toBe('2026-10-05')
  })

  it('23:59:59 ไทย ยังเป็นวันเดิม · 00:00:00 ไทย ขึ้นวันใหม่', () => {
    expect(thaiToday(new Date('2026-10-04T16:59:59Z'))).toBe('2026-10-04')
    expect(thaiToday(new Date('2026-10-04T17:00:00Z'))).toBe('2026-10-05')
  })

  it('ข้ามสิ้นปี/สิ้นเดือน และเติมศูนย์หน้าเดือน/วัน', () => {
    expect(thaiToday(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01')
    expect(thaiToday(new Date('2026-02-28T20:00:00Z'))).toBe('2026-03-01')
    expect(thaiToday(new Date('2026-03-04T03:00:00Z'))).toBe('2026-03-04')
  })

  it('ไม่ส่งอาร์กิวเมนต์ = ใช้เวลาปัจจุบัน', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T17:30:00Z'))
    expect(thaiToday()).toBe('2026-10-05')
  })
})

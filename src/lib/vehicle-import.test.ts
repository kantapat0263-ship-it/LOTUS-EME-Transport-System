import { describe, it, expect } from 'vitest'
import { parseThaiDate, parseKg, parseSeats, splitPlate, looksLikePlate, parseVehicleTable, planImport } from './vehicle-import'

// ถอดจากภาพหน้าจอตาราง (แถว 28–37) เพื่อใช้ทดสอบเท่านั้น — ไม่ใช่ข้อมูลที่จะนำเข้าจริง
const HEADER = ['ที่', 'ทะเบียนรถ', 'จังหวัด', 'ยี่ห้อ', 'แบบ/ชื่อรถ', 'สี', 'เลขตัวรถ', 'เลขเครื่องยนต์', 'วันที่จดทะเบียน', 'รุ่นปี ค.ศ.', 'น้ำหนักรถ', 'น้ำหนักบรรทุก', 'น้ำหนักรวม', 'เชื้อเพลิง', 'ราคา', 'ลักษณะรถ', 'หมายเหตุ']
const ROWS = [
  ['28', '1ฒษ-4407', 'กรุงเทพมหานคร', 'TOYOTA', 'Hilux Revo', 'ขาว', 'MR0JB8DC202721279', '2GD8095048', '23 ส.ค. 59', '2016', '1,850 กก.', '1,060 กก.', '2,910  กก.', 'ดีเซล', '738,000.00', 'แค็ป', ''],
  ['29', '1ฒส-3002', 'กรุงเทพมหานคร', 'TOYOTA', 'GUN135R-CTTSHT A2', 'เทา', 'MR0JB8DC902722929', '2GDC101664', '26 ก.ย. 59', '2016', '1,850 กก.', '1,060 กก.', '2,910  กก.', 'ดีเซล', '739,000.00', 'แค็ป', ''],
  ['31', '1ฒส-9980', 'กรุงเทพมหานคร', 'TOYOTA', 'Hilux Revo', 'ขาว', 'MR0JB8DC202721279', '2GD8095048', '28 ต.ค. 59', '2016', '1,650 กก.', '1,200 กก.', '2,850 กก.', 'ดีเซล', '622,080.00', 'กระบะตอนเดียว', 'ติดตั้งรั้ว'],
  ['32', 'รถแบ็คโฮว์', '', 'KUBOTA', 'KX91-3C (ล้อเหล็ก)', 'แดง', 'D1503-7CW2098', '50541', '5 ก.ค. 56', '2016', '', '', '', 'ดีเซล', '850,000.00', 'รถขุดล้อเหล็ก', ''],
  ['34', 'ฮอ-5716', 'กรุงเทพมหานคร', 'TOYOTA', 'Hilux Revo B-Cab', 'ขาว', 'MR0EB8CB000887936', '2GDC475302', '13 ธ.ค. 61', '2018', '1,900 กก.', '(10 คน)', '2,400 กก.', 'ดีเซล', '527,000.00', 'รถนั่งสองแถว', 'ติดตั้งรั้ว,หลังคา,เบาะ'],
  ['36', '2ฒร-7169', 'กรุงเทพมหานคร', 'TOYOTA', 'GUN135R-CTTSHT/A4', 'ขาว', 'MROJB8DC402777644', '2GD-4715626', '31 ก.ค. 62', '2019', '1,850 กก.', '1,060 กก.', '2,910 กก.', 'ดีเซล', '730,000.00', 'แค็ป', ''],
  ['37', '40-2050', 'นนทบุรี', 'ISUZU', 'NLR85EXXXB', 'ขาว', 'MP1NLR85ERT100714', '4JJ1EVR523', '10 เม.ย. 68', '2050', '2,800 กก.', '(16 คน)', '4,400 กก.', 'ดีเซล', '987,648.00', 'รถโดยสารส่วนบุคคล', ''],
]
const TSV = ['รายละเอียดเกี่ยวกับยานพาหนะ', HEADER.join('\t'), ...ROWS.map((r) => r.join('\t'))].join('\n')

describe('value parsers', () => {
  it('Thai short date with 2-digit BE year → CE ISO', () => {
    expect(parseThaiDate('23 ส.ค. 59')).toBe('2016-08-23')
    expect(parseThaiDate('10 เม.ย. 68')).toBe('2025-04-10')
    expect(parseThaiDate('23 สิงหาคม 2559')).toBe('2016-08-23')
    expect(parseThaiDate('23/08/2016')).toBe('2016-08-23')
    expect(parseThaiDate('31 ก.พ. 59')).toBeNull()
    expect(parseThaiDate('??')).toBeNull()
  })
  it('weights vs seats kept separate', () => {
    expect(parseKg('1,850 กก.')).toBe(1850)
    expect(parseKg('2,910  กก.')).toBe(2910)
    expect(parseKg('(10 คน)')).toBeNull()
    expect(parseSeats('(10 คน)')).toBe(10)
  })
  it('plate normalisation', () => {
    expect(splitPlate('1ฒษ-4407')).toEqual({ key: '1ฒษ4407' })
    expect(splitPlate('1ฒษ 4407 กทม.')).toEqual({ key: '1ฒษ4407', province: 'กรุงเทพมหานคร' })
    expect(splitPlate('40-2050 นนทบุรี')).toEqual({ key: '402050', province: 'นนทบุรี' })
    expect(looksLikePlate('1ฒษ4407')).toBe(true)
    expect(looksLikePlate('402050')).toBe(true)
    expect(looksLikePlate('รถแบ็คโฮว์')).toBe(false)
  })
})

describe('parseVehicleTable', () => {
  const { rows, error } = parseVehicleTable(TSV)
  const byNo = (n: string) => rows.find((r) => r.rowNo === n)!

  it('finds header below a title row; ignores price', () => {
    expect(error).toBeUndefined()
    expect(rows).toHaveLength(ROWS.length)
    expect(Object.values(byNo('28').values)).not.toContain('738,000.00')
  })
  it('parses typed values', () => {
    expect(byNo('29').values).toMatchObject({ registrationDate: '2016-09-26', modelYear: 2016, curbWeightKg: 1850, payloadKg: 1060, grossWeightKg: 2910, province: 'กรุงเทพมหานคร' })
  })
  it('"(10 คน)" in payload column → seats, payload left empty', () => {
    expect(byNo('34').values.seats).toBe(10)
    expect(byNo('34').values.payloadKg).toBeUndefined()
  })
  it('duplicate chassis/engine across rows → field dropped on both rows', () => {
    for (const n of ['28', '31']) {
      expect(byNo(n).values.chassisNo).toBeUndefined()
      expect(byNo(n).values.engineNo).toBeUndefined()
      expect(byNo(n).issues.map((i) => i.field)).toEqual(expect.arrayContaining(['chassisNo', 'engineNo']))
    }
  })
  it('VIN with letter O → dropped, not auto-corrected', () => {
    expect(byNo('36').values.chassisNo).toBeUndefined()
    expect(byNo('36').issues[0].field).toBe('chassisNo')
  })
  it('model year 2050 for a 2025 registration → dropped', () => {
    expect(byNo('37').values.modelYear).toBeUndefined()
    expect(byNo('37').issues.some((i) => i.field === 'modelYear')).toBe(true)
  })
  it('no header → error', () => {
    expect(parseVehicleTable('a\tb\n1\t2').error).toBeDefined()
  })
})

describe('planImport', () => {
  const { rows } = parseVehicleTable(TSV)
  const vehicles = [
    { id: 'v28', licensePlate: '1ฒษ 4407' }, // เว้นวรรคต่างจากตาราง — ยังตรง
    { id: 'v29', licensePlate: '1ฒส-3002' },
    { id: 'v34a', licensePlate: 'ฮอ-5716' },
    { id: 'v34b', licensePlate: 'ฮอ 5716' }, // ทะเบียนซ้ำในระบบ
    { id: 'v36', licensePlate: '2ฒร-7169' },
    { id: 'v37', licensePlate: '40-2050 ชลบุรี' }, // จังหวัดไม่ตรง
    { id: 'vX', licensePlate: '3กข-1111' }, // ไม่มีในตาราง
  ]

  it('fills only confident matches, never creates vehicles, skips with reasons', () => {
    const plan = planImport(rows, vehicles, {})
    const filled = plan.fills.map((f) => f.vehicleId).sort()
    expect(filled).toEqual(['v28', 'v29', 'v36'])
    const reasons = Object.fromEntries(plan.skippedRows.map((s) => [s.plate, s.reason]))
    expect(reasons['1ฒส-9980']).toMatch(/ไม่พบ/)
    expect(reasons['รถแบ็คโฮว์']).toMatch(/ไม่มีเลขทะเบียน/)
    expect(reasons['ฮอ-5716']).toMatch(/ซ้ำกันในระบบ/)
    expect(reasons['40-2050']).toMatch(/จังหวัดไม่ตรง/)
    expect(plan.untouchedVehicles).toContain('3กข-1111')
    // ช่องที่มีปัญหาของแถวที่จับคู่ได้ ถูกสรุปไว้
    expect(plan.skippedFields.some((s) => s.plate === '2ฒร-7169' && s.field === 'chassisNo')).toBe(true)
  })

  it('never overwrites: existing differing value → conflict; same value → nothing', () => {
    const plan = planImport(rows, vehicles, {
      v29: { id: 'v29', color: 'ดำ', brand: 'TOYOTA' },
    })
    const f29 = plan.fills.find((f) => f.vehicleId === 'v29')!
    expect(f29.fields.color).toBeUndefined()
    expect(f29.fields.brand).toBeUndefined()
    expect(f29.fields.model).toBe('GUN135R-CTTSHT A2')
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ vehicleId: 'v29', field: 'color', existing: 'ดำ', incoming: 'เทา' }),
    ])
  })

  it('existing chassis differs → not the same car, whole row skipped', () => {
    const plan = planImport(rows, vehicles, { v29: { id: 'v29', chassisNo: 'XXX' } })
    expect(plan.fills.find((f) => f.vehicleId === 'v29')).toBeUndefined()
    expect(plan.skippedRows.find((s) => s.plate === '1ฒส-3002')?.reason).toMatch(/เลขตัวรถไม่ตรง/)
  })
})

import { describe, it, expect } from 'vitest'
import { parseThaiDate, parseKg, parseSeats, parsePrice, splitPlate, looksLikePlate, formatPlate, parseVehicleTable, planImport, planShape, suggestVehicleType } from './vehicle-import'

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
  it('price: number with commas/decimals; text like "(ไม่มีสัญญาฯ)" → null', () => {
    expect(parsePrice('738,000.00')).toBe(738000)
    expect(parsePrice('1057929.12')).toBe(1057929.12)
    expect(parsePrice('544000 บาท')).toBe(544000)
    expect(parsePrice('(ไม่มีสัญญาฯ)')).toBeNull()
    expect(parsePrice('0')).toBeNull()
  })
  it('plate normalisation', () => {
    expect(splitPlate('1ฒษ-4407')).toEqual({ key: '1ฒษ4407' })
    expect(splitPlate('1ฒษ 4407 กทม.')).toEqual({ key: '1ฒษ4407', province: 'กรุงเทพมหานคร' })
    expect(splitPlate('40-2050 นนทบุรี')).toEqual({ key: '402050', province: 'นนทบุรี' })
    expect(looksLikePlate('1ฒษ4407')).toBe(true)
    expect(looksLikePlate('402050')).toBe(true)
    expect(looksLikePlate('รถแบ็คโฮว์')).toBe(false)
  })
  it('canonical plate text for new cars: dash before the number', () => {
    expect(formatPlate('1ฒษ4407')).toBe('1ฒษ-4407')
    expect(formatPlate('402050')).toBe('40-2050')
    expect(formatPlate('830018')).toBe('83-0018')
    expect(formatPlate('ตจ1438')).toBe('ตจ-1438')
  })
})

describe('parseVehicleTable', () => {
  const { rows, error } = parseVehicleTable(TSV)
  const byNo = (n: string) => rows.find((r) => r.rowNo === n)!

  it('finds header below a title row; reads price as a number', () => {
    expect(error).toBeUndefined()
    expect(rows).toHaveLength(ROWS.length)
    expect(byNo('28').values.price).toBe(738000)
  })
  it('price that is not a number → field skipped with a reason', () => {
    const t = [HEADER.join('\t'), ['1', 'บธ-7244', 'เพชรบูรณ์', 'NISSAN', 'TGD21SFU5', 'แดง', '', '', ' 16 ม.ค. 38', '1994', '1,400 กก.', '1150 กก.', '2,550 กก.', 'ดีเซล', '(ไม่มีสัญญาฯ)', 'กระบะตอนเดียว', 'ติดตั้งรั้ว'].join('\t')].join('\n')
    const r = parseVehicleTable(t).rows[0]
    expect(r.values.price).toBeUndefined()
    expect(r.issues).toEqual([expect.objectContaining({ field: 'price', value: '(ไม่มีสัญญาฯ)' })])
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
  it('"-" means no value (not an unreadable value)', () => {
    const t = [HEADER.join('\t'), ['1', 'อว-4018', 'กรุงเทพมหานคร', 'TOYOTA', 'RZH153R', 'ขาว', '', '', ' 31 พ.ค. 44', '2001', '1800 กก.', ' - ', '1800 กก.', 'เบนซิน', '', 'รถตู้', ''].join('\t')].join('\n')
    const r = parseVehicleTable(t).rows[0]
    expect(r.issues).toEqual([])
    expect(r.values.payloadKg).toBeUndefined()
    expect(r.values.curbWeightKg).toBe(1800)
    expect(r.values.registrationDate).toBe('2001-05-31')
  })
  it('repeated header line inside the data → ignored (not a car named "ทะเบียนรถ")', () => {
    const t = [HEADER.join('\t'), ROWS[1].join('\t'), HEADER.join('\t'), ROWS[5].join('\t')].join('\n')
    const { rows: rs } = parseVehicleTable(t)
    expect(rs.map((r) => r.plateRaw)).toEqual(['1ฒส-3002', '2ฒร-7169'])
  })
  it('car name containing "ทะเบียน" (e.g. "(ไม่มีทะเบียน)") is a real row, not a header', () => {
    const row = [...ROWS[3]]
    row[1] = 'รถแบ็คโฮว์ (ไม่มีทะเบียน)'
    const { rows: rs } = parseVehicleTable([HEADER.join('\t'), row.join('\t')].join('\n'))
    expect(rs.map((r) => r.plateRaw)).toEqual(['รถแบ็คโฮว์ (ไม่มีทะเบียน)'])
    expect(planImport(rs, [], {}).creates.map((c) => c.licensePlate)).toEqual(['รถแบ็คโฮว์ (ไม่มีทะเบียน)'])
  })
  it('registration date in the future → field skipped (would make expiry before registration)', () => {
    const row = [...ROWS[1]]
    row[8] = '23/08/2575' // ค.ศ. 2032
    const r = parseVehicleTable([HEADER.join('\t'), row.join('\t')].join('\n')).rows[0]
    expect(r.values.registrationDate).toBeUndefined()
    expect(r.issues).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'registrationDate', reason: expect.stringMatching(/อนาคต/) })]))
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

  it('fills only confident matches, skips unsafe rows with reasons', () => {
    const plan = planImport(rows, vehicles, {})
    const filled = plan.fills.map((f) => f.vehicleId).sort()
    expect(filled).toEqual(['v28', 'v29', 'v36'])
    expect(plan.matched.map((m) => m.vehicleId).sort()).toEqual(['v28', 'v29', 'v36'])
    const reasons = Object.fromEntries(plan.skippedRows.map((s) => [s.plate, s.reason]))
    expect(reasons['1ฒส-9980']).toBeUndefined() // ไม่มีในระบบ → เพิ่มเป็นรถใหม่ (ดูเทสต์ถัดไป)
    expect(reasons['ฮอ-5716']).toMatch(/ซ้ำกันในระบบ/)
    expect(reasons['40-2050']).toMatch(/จังหวัดไม่ตรง/)
    expect(plan.untouchedVehicles).toContain('3กข-1111')
    // ช่องที่มีปัญหาของแถวที่จับคู่ได้ ถูกสรุปไว้
    expect(plan.skippedFields.some((s) => s.plate === '2ฒร-7169' && s.field === 'chassisNo')).toBe(true)
  })

  it('plate not in the system → new car (canonical plate, details from the row)', () => {
    const plan = planImport(rows, vehicles, {})
    const c = plan.creates.find((x) => x.plateKey === '1ฒส9980')!
    expect(c).toMatchObject({ licensePlate: '1ฒส-9980', hasPlate: true, rowLabel: 'ที่ 31' })
    expect(c.fields).toMatchObject({ registrationDate: '2016-10-28', brand: 'TOYOTA', price: 622080, bodyType: 'กระบะตอนเดียว' })
    expect(c.fields.chassisNo).toBeUndefined() // ซ้ำกับแถวอื่น → ไม่ใส่
    // ช่องที่มีปัญหาของรถใหม่ก็ถูกสรุปไว้
    expect(plan.skippedFields.some((s) => s.plate === '1ฒส-9980' && s.field === 'chassisNo')).toBe(true)
  })

  it('row without a plate but with vehicle data (backhoe) → new car named by the plate column text', () => {
    const plan = planImport(rows, vehicles, {})
    const c = plan.creates.find((x) => x.licensePlate === 'รถแบ็คโฮว์')!
    expect(c.hasPlate).toBe(false)
    expect(c.fields).toMatchObject({ brand: 'KUBOTA', registrationDate: '2013-07-05' })
    expect(plan.skippedRows.find((s) => s.plate === 'รถแบ็คโฮว์')).toBeUndefined()
  })

  it('re-import: car already added under a non-plate name is matched, not created again', () => {
    const plan = planImport(rows, [...vehicles, { id: 'vBH', licensePlate: 'รถแบ็คโฮว์' }], {})
    expect(plan.creates.find((x) => x.licensePlate === 'รถแบ็คโฮว์')).toBeUndefined()
    expect(plan.fills.find((f) => f.vehicleId === 'vBH')).toBeDefined()
  })

  it('plate with province suffix → stored plate without province, province kept in details', () => {
    const t = [HEADER.join('\t'), ['1', '83-0018 ปทุมธานี', '', 'HINO', 'FC9JELA', 'ขาว', 'FC9JELA-15784', 'J05ETCH19162', '30 มิ.ย. 57', '2014', '4,840 กก.', '5,060 กก.', '9,900 กก.', 'ดีเซล', '1497600', 'บรรทุก 6 ล้อดั๊มพ์', ''].join('\t')].join('\n')
    const plan = planImport(parseVehicleTable(t).rows, [], {})
    expect(plan.creates[0]).toMatchObject({ licensePlate: '83-0018', fields: expect.objectContaining({ province: 'ปทุมธานี' }) })
  })

  it('junk line without plate pattern or vehicle data → skipped, not created', () => {
    const t = [HEADER.join('\t'), ['', 'รวมทั้งหมด', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''].join('\t')].join('\n')
    const plan = planImport(parseVehicleTable(t).rows, [], {})
    expect(plan.creates).toEqual([])
    expect(plan.skippedRows[0].reason).toMatch(/ไม่มีเลขทะเบียน/)
  })

  it('new plate whose chassis already belongs to a car in the system → not created (maybe re-plated)', () => {
    const plan = planImport(rows, vehicles, { v29: { id: 'v29', chassisNo: 'D1503-7CW2098' } })
    expect(plan.creates.find((x) => x.licensePlate === 'รถแบ็คโฮว์')).toBeUndefined()
    expect(plan.skippedRows.find((s) => s.plate === 'รถแบ็คโฮว์')?.reason).toMatch(/เลขตัวรถตรงกับ.*1ฒส-3002/)
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

describe('suggestVehicleType (pre-fill only — staff can change)', () => {
  const OPTIONS = ['Pickup', '4-wheel truck', '6-wheel truck', 'PICK UP', 'PICK UP คอก', 'แคป']
  const USED = [{ type: 'PICK UP' }, { type: 'PICK UP' }, { type: 'PICK UP คอก' }, { type: 'แคป' }]

  it('maps body type + note to an existing type name', () => {
    expect(suggestVehicleType({ bodyType: 'แค็ป' }, OPTIONS, USED)).toBe('แคป')
    expect(suggestVehicleType({ bodyType: 'กระบะตอนเดียว', note: 'ติดตั้งรั้ว' }, OPTIONS, USED)).toBe('PICK UP คอก')
    expect(suggestVehicleType({ bodyType: 'กระบะตอนเดียว' }, OPTIONS, USED)).toBe('PICK UP')
    expect(suggestVehicleType({ bodyType: '4 ประตู' }, OPTIONS, USED)).toBe('PICK UP')
    expect(suggestVehicleType({ bodyType: 'บรรทุก 6 ล้อดั๊มพ์' }, OPTIONS, USED)).toBe('6-wheel truck')
  })
  it('unknown body type → no guess', () => {
    for (const bodyType of ['เก๋ง', 'รถตู้', 'รถโดยสารส่วนบุคคล', 'รถนั่งสองแถว', undefined]) {
      expect(suggestVehicleType({ bodyType }, OPTIONS, USED)).toBeUndefined()
    }
  })
  it('several matching types and none clearly most used → no guess', () => {
    expect(suggestVehicleType({ bodyType: 'กระบะตอนเดียว' }, OPTIONS, [])).toBeUndefined()
  })
  it('no matching type (e.g. no คอก type) → no guess', () => {
    expect(suggestVehicleType({ bodyType: 'กระบะตอนเดียว', note: 'ติดตั้งรั้ว' }, ['Pickup', '6-wheel truck'], [])).toBeUndefined()
  })
})

describe('planShape (guard: plan still valid right before saving)', () => {
  const { rows } = parseVehicleTable(TSV)
  it('same cars and plates → same shape', () => {
    const vs = [{ id: 'A', licensePlate: '1ฒส-3002' }, { id: 'B', licensePlate: '2ฒร-7169' }]
    expect(planShape(planImport(rows, vs, {}))).toBe(planShape(planImport(rows, [...vs].reverse(), {})))
  })
  it('two matched cars swapped plates in between → different shape (would fill the wrong car)', () => {
    const before = planImport(rows, [{ id: 'A', licensePlate: '1ฒส-3002' }, { id: 'B', licensePlate: '2ฒร-7169' }], {})
    const swapped = planImport(rows, [{ id: 'A', licensePlate: '2ฒร-7169' }, { id: 'B', licensePlate: '1ฒส-3002' }], {})
    expect(planShape(swapped)).not.toBe(planShape(before))
  })
  it('a plate that was new is now in the system → different shape', () => {
    const before = planImport(rows, [], {})
    const after = planImport(rows, [{ id: 'X', licensePlate: '1ฒส-9980' }], {})
    expect(planShape(after)).not.toBe(planShape(before))
  })
})

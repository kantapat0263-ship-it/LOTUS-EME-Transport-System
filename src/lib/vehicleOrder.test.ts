import { describe, expect, it } from 'vitest'
import { sortVehiclesByType, vehicleTypeRank } from './vehicleOrder'

describe('vehicleTypeRank', () => {
  it('PICK UP ทุกรูปแบบการพิมพ์ = กลุ่มแรก', () => {
    for (const t of ['Pickup', 'PICK UP', 'pick-up', ' Pick Up ']) expect(vehicleTypeRank(t)).toBe(0)
  })

  it('มีคำว่า "คอก" = กระบะคอก (กลุ่ม 2) · มีคำว่า "แคป" = แคป (กลุ่ม 3)', () => {
    expect(vehicleTypeRank('กระบะคอก')).toBe(1)
    expect(vehicleTypeRank('คอก')).toBe(1)
    expect(vehicleTypeRank('แคป')).toBe(2)
    expect(vehicleTypeRank('กระบะแคป')).toBe(2)
  })

  it('ชื่อที่มีทั้ง pickup และ คอก/แคป → นับเป็นคอก/แคป (เจาะจงกว่า)', () => {
    expect(vehicleTypeRank('PICK UP คอก')).toBe(1)
    expect(vehicleTypeRank('Pickup แคป')).toBe(2)
  })

  it('ประเภทอื่น / ไม่มีประเภท / ไม่ใช่ข้อความ = ท้ายสุด', () => {
    for (const t of ['6-wheel truck', '4-wheel truck', '', undefined, null, 123]) expect(vehicleTypeRank(t)).toBe(3)
  })
})

describe('sortVehiclesByType', () => {
  const ids = (vs: readonly { id: string }[]) => vs.map((v) => v.id)

  it('PICK UP → กระบะคอก → แคป → อื่น ๆ · ในกลุ่มเดียวกันคงลำดับเดิม', () => {
    const vehicles = [
      { id: 'other1', type: '6-wheel truck' },
      { id: 'cab1', type: 'แคป' },
      { id: 'cage1', type: 'กระบะคอก' },
      { id: 'pu1', type: 'PICK UP' },
      { id: 'cab2', type: 'แคป' },
      { id: 'none', type: undefined },
      { id: 'pu2', type: 'Pickup' },
      { id: 'cage2', type: 'กระบะคอก' },
    ]
    expect(ids(sortVehiclesByType(vehicles))).toEqual(['pu1', 'pu2', 'cage1', 'cage2', 'cab1', 'cab2', 'other1', 'none'])
  })

  it('ไม่แก้ array เดิม', () => {
    const vehicles = [{ id: 'cab', type: 'แคป' }, { id: 'pu', type: 'PICK UP' }]
    sortVehiclesByType(vehicles)
    expect(ids(vehicles)).toEqual(['cab', 'pu'])
  })
})

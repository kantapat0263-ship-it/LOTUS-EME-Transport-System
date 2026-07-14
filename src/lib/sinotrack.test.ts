import { describe, it, expect } from 'vitest'
import {
  buildAppId,
  buildData,
  buildToken,
  buildSign,
  buildRequest,
  parseAppJson,
  toVehiclePositions,
  SINOTRACK_SERVER,
} from './sinotrack'

/**
 * Vector จริงจากคำขอที่ดักได้จากหน้าเว็บ SinoTrack (บัญชี lotuseme, Proc_GetLastPosition)
 * ไม่มีรหัสผ่าน/secret — เป็นค่าที่ปรากฏใน request body ล้วน ๆ
 */
const V = {
  nTimeStamp: '1784023174634',
  strRandom: '38272838981981',
  strUser: 'lotuseme',
  strAppID: 'MTAxLnNpbm90cmFjay5jb20v',
  strToken:
    'UHJvY19HZXRMYXN0UG9zaXRpb24RTic5MTcwOTQ0NTQ4LDkxNzA4NDg1MjYsOTE3MDk0NDM2NSw5MTcwOTQ0MzE3LDkxNzA3NDc0NjEsOTE3MDc0NzEyNSw5MTcwODQ4NTAxLDkxNzA5NDQ3ODIsOTE3MDk0NDQxNCw5MTcwODQ4NDY5LDkxNzA4NDgzODksOTE3MDc0NzQ2NScRERs2',
  expectedSign: '99538a8187f8ee6e058be0ec21ff7ed9',
}

describe('sinotrack: signing (พิสูจน์กับคำขอจริง)', () => {
  it('buildSign ตรงกับลายเซ็นจริงเป๊ะ', () => {
    expect(buildSign(V.nTimeStamp, V.strRandom, V.strUser, V.strAppID, V.strToken)).toBe(
      V.expectedSign
    )
  })

  it('buildAppId ให้ค่าตรงกับ strAppID จริง', () => {
    expect(buildAppId(SINOTRACK_SERVER)).toBe(V.strAppID)
  })
})

describe('sinotrack: token framing', () => {
  it('token decode กลับได้ Cmd \\x11 Data \\x11 Field \\x11 \\x1b', () => {
    const token = buildToken('Proc_GetLastPosition', "N'123'")
    const decoded = Buffer.from(token, 'base64').toString('utf8')
    expect(decoded.startsWith("Proc_GetLastPosition\x11N'123'\x11\x11\x1b")).toBe(true)
  })

  it('buildData ใส่ N\'..\' และ escape single quote', () => {
    expect(buildData(['9170747125'])).toBe("N'9170747125'")
    expect(buildData(['a', "b'c"])).toBe("N'a',N'b''c'")
  })

  it('buildRequest ประกอบครบและ sign สอดคล้องกับ token ที่สร้าง', () => {
    const req = buildRequest({
      cmd: 'Proc_GetLastPosition',
      args: ['9170747125'],
      user: 'lotuseme',
      nowMs: 1784023174634,
      random: '38272838981981',
    })
    expect(req.strAppID).toBe(V.strAppID)
    expect(req.strUser).toBe('lotuseme')
    // sign ต้อง = md5 ของ token ที่ req สร้างเอง (self-consistent)
    expect(req.strSign).toBe(
      buildSign(req.nTimeStamp, req.strRandom, req.strUser, req.strAppID, req.strToken)
    )
  })
})

describe('sinotrack: parse response', () => {
  const sample = {
    m_isResultOk: 1,
    m_arrField: ['nID', 'strTEID', 'nTime', 'dbLon', 'dbLat', 'nDirection', 'nSpeed', 'strCarNum'],
    m_arrRecord: [
      ['202560', '9170747125', '1784023462', '100.86432', '13.6567117', '90', '92', 'Lotus 4413'],
      ['202561', '9170747461', '1784023087', '100.6878233', '14.093885', '0', '0', 'Lotus 4465'],
    ],
  }

  it('parseAppJson zip field↔record ถูกต้อง', () => {
    const r = parseAppJson(sample)
    expect(r.ok).toBe(true)
    expect(r.records).toHaveLength(2)
    expect(r.records[0].strTEID).toBe('9170747125')
    expect(r.records[0].dbLat).toBe('13.6567117')
  })

  it('toVehiclePositions แปลงพิกัด/ความเร็ว/เวลาถูก', () => {
    const pos = toVehiclePositions(parseAppJson(sample))
    expect(pos).toHaveLength(2)
    expect(pos[0]).toMatchObject({
      deviceId: '9170747125',
      lat: 13.6567117,
      lng: 100.86432,
      speed: 92,
      direction: 90,
      carNum: 'Lotus 4413',
    })
    expect(pos[0].time).toBe(1784023462 * 1000)
  })
})

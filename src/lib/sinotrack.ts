import { createHash } from 'crypto'

/**
 * SinoTrack (ProTrack/MGTS platform) client — server-only.
 *
 * แพลตฟอร์ม SinoTrack ไม่มี API ทางการ; โมดูลนี้เลียนแบบคำขอที่หน้าเว็บ
 * (https://www.sinotrack.com) ยิงไปที่ `/APP/AppJson.asp` — ถอดโครงสร้าง
 * จาก gps-go.pc.min.js แล้วพิสูจน์ลายเซ็นตรงกับคำขอจริง (ดู sinotrack.test.ts)
 *
 * โครงคำขอ (1 POST form-urlencoded):
 *   strAppID   = base64(host)  host = server ตัวเล็ก ตัด http(s):// + เติม "/" จน len%3==0
 *   strUser    = ชื่อผู้ใช้
 *   nTimeStamp = เวลา ms
 *   strRandom  = เลขสุ่ม
 *   strToken   = base64( Cmd \x11 Data \x11 Field \x11 \x1b  [+padding] )
 *   strSign    = md5( nTimeStamp + strRandom + strUser + strAppID + strToken )   // hex ตัวเล็ก ไม่มี secret
 *
 * ⚠️ เป็น API ภายในของ SinoTrack — ไม่มีสัญญารองรับ อาจเปลี่ยนได้ ใช้เฉพาะบัญชีที่เราเป็นเจ้าของ
 */

/** เซิร์ฟเวอร์ที่บัญชี lotuseme อยู่ (Server 2 | SinoTracking) */
export const SINOTRACK_SERVER = 'https://101.sinotrack.com'
export const SINOTRACK_ENDPOINT = '/APP/AppJson.asp'

// ตัวคั่นภายใน (control chars) จาก _xf473._xf77b
const ROW = '\x11' // strServerRow
const TABLE = '\x1b' // strServerTable

/** คำสั่ง (stored procedure) ที่ใช้ */
export const PROC = {
  login: 'Proc_Login',
  getUserOwnCar: 'Proc_GetUserOwnCar',
  getCar: 'Proc_GetCar',
  getLastPosition: 'Proc_GetLastPosition',
} as const

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

/** strAppID = base64 ของ host (ตัด scheme + เติม "/" จน len%3==0 สูงสุด 2 ครั้ง) */
export function buildAppId(server: string): string {
  let n = server.toLowerCase().replace('http://', '').replace('https://', '')
  if (n.length % 3) n += '/'
  if (n.length % 3) n += '/'
  return b64(n)
}

/** Data = N'a',N'b',...  (escape ' เป็น '') */
export function buildData(args: string[]): string {
  return args.map((a) => `N'${String(a).replace(/'/g, "''")}'`).join(',')
}

/**
 * strToken = base64( Cmd + \x11 + Data + \x11 + Field + \x11 + \x1b [+ padding] )
 * padding: เติมตัวเลขจน length%3==0 (สูงสุด 2 ตัว) เพื่อให้ base64 ไม่มี "="
 * @param pad ตัวอักษร padding (default '0') — เซิร์ฟเวอร์ตัดทิ้งหลัง \x1b อยู่แล้ว
 */
export function buildToken(cmd: string, data: string, field = '', pad = '0'): string {
  let r = cmd + ROW + data + ROW + field + ROW + TABLE
  if (r.length % 3) r += pad
  if (r.length % 3) r += pad
  return b64(r)
}

/** strSign = md5( nTimeStamp + strRandom + strUser + strAppID + strToken ) */
export function buildSign(
  nTimeStamp: number | string,
  strRandom: string,
  strUser: string,
  strAppID: string,
  strToken: string
): string {
  return createHash('md5')
    .update(String(nTimeStamp) + String(strRandom) + strUser + strAppID + strToken, 'utf8')
    .digest('hex')
}

export interface SignedRequest {
  strAppID: string
  strUser: string
  nTimeStamp: string
  strRandom: string
  strSign: string
  strToken: string
}

/** ประกอบคำขอที่เซ็นครบ (บริสุทธิ์ — รับ now/random เข้ามาเพื่อทดสอบได้) */
export function buildRequest(opts: {
  cmd: string
  args: string[]
  user: string
  server?: string
  field?: string
  nowMs: number
  random: string
  pad?: string
}): SignedRequest {
  const server = opts.server ?? SINOTRACK_SERVER
  const strAppID = buildAppId(server)
  const strToken = buildToken(opts.cmd, buildData(opts.args), opts.field ?? '', opts.pad ?? '0')
  const nTimeStamp = String(opts.nowMs)
  const strSign = buildSign(nTimeStamp, opts.random, opts.user, strAppID, strToken)
  return {
    strAppID,
    strUser: opts.user,
    nTimeStamp,
    strRandom: opts.random,
    strSign,
    strToken,
  }
}

/** แปลงผลลัพธ์ AppJson ({m_arrField, m_arrRecord}) เป็น array ของ object */
export interface AppJsonResult {
  ok: boolean
  fields: string[]
  records: Record<string, string>[]
  raw: any
}

export function parseAppJson(json: any): AppJsonResult {
  const fields: string[] = Array.isArray(json?.m_arrField) ? json.m_arrField : []
  const rows: any[] = Array.isArray(json?.m_arrRecord) ? json.m_arrRecord : []
  const records = rows.map((row: any[]) => {
    const o: Record<string, string> = {}
    fields.forEach((f, i) => {
      o[f] = row[i]
    })
    return o
  })
  return { ok: json?.m_isResultOk === 1, fields, records, raw: json }
}

/** ตำแหน่งรถ 1 คัน (แปลงจากผล Proc_GetLastPosition) */
export interface VehiclePosition {
  deviceId: string // strTEID
  lat: number // dbLat
  lng: number // dbLon
  speed: number // nSpeed (กม./ชม.)
  direction: number // nDirection (องศา)
  /** เวลาตำแหน่งล่าสุด (unix ms) */
  time: number
  carNum?: string // strCarNum (ถ้ามี)
}

export function toVehiclePositions(res: AppJsonResult): VehiclePosition[] {
  return res.records
    .filter((r) => r.strTEID && r.dbLat && r.dbLon)
    .map((r) => ({
      deviceId: String(r.strTEID),
      lat: Number(r.dbLat),
      lng: Number(r.dbLon),
      speed: Number(r.nSpeed ?? 0),
      direction: Number(r.nDirection ?? 0),
      time: Number(r.nTime ?? 0) * 1000, // วินาที → ms
      carNum: r.strCarNum ? String(r.strCarNum) : undefined,
    }))
}

// ---------------------------------------------------------------------------
// Network client (server-only). login → เก็บ cookie → เรียก Proc ต่อ ๆ ไป
// ---------------------------------------------------------------------------

function randomDigits(len = 14): string {
  let s = ''
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10)
  // กันขึ้นต้นด้วย 0 (ให้เหมือน random จริงของแพลตฟอร์ม)
  return s.replace(/^0/, '1')
}

async function callProc(
  cmd: string,
  args: string[],
  user: string,
  cookie: string | null
): Promise<{ result: AppJsonResult; cookie: string | null }> {
  const req = buildRequest({ cmd, args, user, nowMs: Date.now(), random: randomDigits() })
  const body = new URLSearchParams(req as unknown as Record<string, string>).toString()

  const res = await fetch(SINOTRACK_SERVER + SINOTRACK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`AppJson HTTP ${res.status}`)

  // เก็บ cookie จาก login (undici รองรับ getSetCookie)
  let nextCookie = cookie
  const setCookies =
    (res.headers as any).getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : [])
  if (setCookies.length) {
    nextCookie = setCookies.map((c: string) => c.split(';')[0]).join('; ')
  }

  const json = await res.json()
  return { result: parseAppJson(json), cookie: nextCookie }
}

/** login แล้วคืน cookie session (โยน error ถ้า user/pass ผิด) */
export async function sinotrackLogin(user: string, password: string): Promise<string> {
  const { result, cookie } = await callProc(PROC.login, [user, password], user, null)
  if (!result.ok) throw new Error('SinoTrack login failed (บัญชีหรือรหัสผ่านไม่ถูกต้อง)')
  if (!cookie) throw new Error('SinoTrack login: ไม่ได้ session cookie')
  return cookie
}

/** ดึงตำแหน่งล่าสุดของอุปกรณ์ตามรายการ deviceId */
export async function fetchLastPositions(
  cookie: string,
  user: string,
  deviceIds: string[]
): Promise<VehiclePosition[]> {
  if (deviceIds.length === 0) return []
  const { result } = await callProc(PROC.getLastPosition, [deviceIds.join(',')], user, cookie)
  return toVehiclePositions(result)
}

/** ดึงรายชื่ออุปกรณ์ในบัญชี (strTEID + strCarNum) เพื่อช่วยจับคู่ทะเบียน */
export async function fetchDevices(
  cookie: string,
  user: string
): Promise<{ deviceId: string; carNum: string }[]> {
  const { result } = await callProc(PROC.getUserOwnCar, [user], user, cookie)
  return result.records
    .filter((r) => r.strTEID)
    .map((r) => ({ deviceId: String(r.strTEID), carNum: String(r.strCarNum ?? '') }))
}

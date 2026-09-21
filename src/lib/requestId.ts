/**
 * การจัดสรรรหัสใบขอรถ (VR id) — แยกออกมาเป็น logic ล้วนเพื่อ unit test ได้
 *
 * เดิม RequestForm และ daily-summary ต่างคนต่างมีลูป "เช็คว่ารหัสว่าง → แล้วค่อยเขียน"
 * ซึ่งเป็น TOCTOU: สองคนกดส่งพร้อมกันเช็คเจอว่าว่างทั้งคู่ แล้ว setDoc ทับกัน ใบแรกหายเงียบ
 * (ทั้งคู่เห็น "ส่งสำเร็จ") — ที่นี่จึงบังคับให้ "เช็ค + เขียน" อยู่ใน transaction เดียวกัน
 * ตัว transaction ของ Firestore จะจดว่าเราอ่าน doc นี้ไว้ (แม้ตอนอ่านยังไม่มี) ถ้ามีคนอื่น
 * สร้างมันก่อนเรา commit ธุรกรรมจะถูกสั่งให้ทำใหม่เอง แล้วเราจะเลื่อนไปรหัสถัดไป
 */

/** จำนวนรหัสที่ยอมไล่หาต่อหนึ่งธุรกรรม — หมดแล้วต้องโยน error ห้ามเขียนทับของเดิม */
export const REQUEST_ID_MAX_ATTEMPTS = 50

/** `2026-09-21` → `VR-2109` (วันก่อนเดือน — สลับกับรูปแบบวันที่ อย่าเผลอกลับด้าน) */
export function requestIdPrefix(dateStr: string): string {
  const [, month, day] = dateStr.split("-")
  return `VR-${day}${month}`
}

/**
 * ประกอบรหัสตามรูปแบบที่ใช้งานจริง: prefix + ลำดับ 3 หลัก + เลขสุ่ม 1 หลัก
 * เช่น `VR-2109-0044` (ลำดับ 4, สุ่มได้ 4)
 * ⚠️ รูปแบบนี้ผู้ใช้เห็นและจดไว้ (แคปหน้าจอ/LINE/ใบสรุป) ห้ามเปลี่ยน
 */
export function formatRequestId(prefix: string, seq: number, safety: number): string {
  return `${prefix}-${String(seq).padStart(3, "0")}${safety}`
}

/** มุมมองของธุรกรรมที่ logic นี้ต้องใช้ — ให้ฝั่งเรียกผูกกับ Firestore เอง */
export interface RequestIdTx {
  /** doc รหัสนี้มีอยู่แล้วหรือยัง (ต้องอ่านผ่านธุรกรรม เพื่อให้ติด read set) */
  exists(id: string): Promise<boolean>
  /** เขียนใบใหม่ลงรหัสนี้ */
  create(id: string, data: unknown): void
}

export type RunRequestTx = <T>(fn: (tx: RequestIdTx) => Promise<T>) => Promise<T>

export class RequestIdExhaustedError extends Error {
  constructor(public readonly attempts: number) {
    super(`หารหัสใบขอที่ว่างไม่ได้หลังลอง ${attempts} ครั้ง`)
    this.name = "RequestIdExhaustedError"
  }
}

const defaultRollSafety = () => Math.floor(Math.random() * 10)

/**
 * ไล่หารหัสแรกที่ยังว่าง เริ่มจาก startSeq แล้วเลื่อนขึ้นทีละ 1
 * (Firestore ไม่เลื่อนเลขให้เองตอน retry — ต้องไล่เองแบบนี้)
 * อ่านให้ครบก่อนเขียนเสมอ ตามข้อบังคับของ transaction
 */
export async function findFreeRequestId(
  tx: Pick<RequestIdTx, "exists">,
  prefix: string,
  startSeq: number,
  rollSafety: () => number = defaultRollSafety,
  maxAttempts: number = REQUEST_ID_MAX_ATTEMPTS
): Promise<string> {
  let seq = Math.max(1, startSeq)
  for (let i = 0; i < maxAttempts; i++) {
    const id = formatRequestId(prefix, seq, rollSafety())
    if (!(await tx.exists(id))) return id
    seq++
  }
  // ห้าม fallback เป็นรหัสมั่วหรือเขียนทับ — ให้ฝั่งเรียกแจ้งผู้ใช้ว่าไม่สำเร็จ
  throw new RequestIdExhaustedError(maxAttempts)
}

/**
 * สร้างใบขอรถใหม่แบบกันชน: หา่รหัสว่าง + เขียนใบ ในธุรกรรมเดียว
 * คืนรหัสที่ใช้จริง (อาจไม่ใช่ startSeq ถ้าโดนแย่ง)
 */
export async function createRequestWithUniqueId(
  runTx: RunRequestTx,
  opts: {
    prefix: string
    startSeq: number
    /** สร้าง payload จากรหัสที่จัดสรรได้ (เพราะ id/requestId ต้องอยู่ในตัวเอกสารด้วย) */
    buildData: (id: string) => unknown
    rollSafety?: () => number
    maxAttempts?: number
  }
): Promise<string> {
  return runTx(async (tx) => {
    const id = await findFreeRequestId(tx, opts.prefix, opts.startSeq, opts.rollSafety, opts.maxAttempts)
    tx.create(id, opts.buildData(id))
    return id
  })
}

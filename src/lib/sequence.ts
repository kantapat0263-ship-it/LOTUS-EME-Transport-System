/**
 * งาน "🔁 ไปหลายจุดตามลำดับ (ไป-กลับ)" (ผู้ใช้อนุมัติ 2026-11-06) — ใบขอเดียว ผู้ขอกรอกจุด 1 → 2 → 3 ตามลำดับจริง
 * เช่น ไซต์ (รับคนงาน) → ที่ทำเอกสาร (ส่ง รอ) → ไซต์ (ส่งกลับ) · ร้าน (รับท่อ) → ไซต์ (ส่ง + รับท่อเก่า) → ร้าน (ส่งไปดัด)
 * สถานที่ซ้ำในใบเดียวได้ (ไป-กลับ) แต่จุดที่ติดกันห้ามเป็นที่เดียวกัน
 *
 * จุดในชุดผูกกันด้วย sequenceId (server ออก `sq_<uuid>`) + sequenceIndex (ลำดับที่ผู้ขอกรอก เริ่ม 0) + sequenceSize (จำนวนจุดตอนส่งใบ)
 * ไม่ใช้ตำแหน่งใน array — ถอนคันคู่/โยก/เลื่อนทำให้ตำแหน่งเลื่อน และจุดในทริปไม่มี backlink ไปใบขอ (เหตุผลเดียวกับ transferId)
 * helper ใช้ "ลำดับสัมพัทธ์" ของ sequenceIndex เท่านั้น (ถอด/เลื่อน/โยกแล้วเลขขาดช่วงได้)
 * ผู้ใช้ตัดสิน: ไม่แทรกงานอื่นกลางชุด (orderSequences จัดให้ติดกัน) · เลื่อนทั้งชุด = ใบวันใหม่แยกทีละจุด · ถอดบางจุดไปคันอื่นได้ (มีคำเตือน)
 * ใบเก่า/ใบปกติ/ใบรับของไปส่งต่อไม่มีฟิลด์เหล่านี้ = ทำงานเหมือนเดิมทุกอย่าง · จุดหนึ่งไม่เป็นทั้งงานรับ-ส่งและงานต่อเนื่อง
 */
// import แบบ type อย่างเดียวสำหรับ react — ไฟล์นี้ถูก import ฝั่ง server ด้วย (driverTicket, vehicleRequestValidation)
import type { CSSProperties } from 'react'
import { isInactiveStop, isTransferStop, orderPickupsBeforeDrop, postponedPickupNote, samePlace, transferLabel, transferMateReminder, transferMissingWarning, transferNoteForDriver, transferStopFields, transferTagStyle, type Place, type TransferFields, type TransferLabel } from './transfer'

export interface SequenceFields {
  sequenceId?: string
  /** ลำดับที่ผู้ขอกรอก (เริ่ม 0) — คงที่ตลอด แม้บางจุดถูกถอด/เลื่อน/โยก */
  sequenceIndex?: number
  /** จำนวนจุดของชุดตอนส่งใบ — ใช้ทำป้าย "จุดที่ 2/3" และบอกว่าจุดไหนไม่ได้มากับเที่ยวนี้ */
  sequenceSize?: number
}

/** จำนวนจุดสูงสุดต่อใบ (ฟอร์ม + server ใช้ค่าเดียวกัน) */
export const SEQUENCE_MAX_STOPS = 10

export const isSequenceStop = (stop: SequenceFields | null | undefined): boolean =>
  !!stop && typeof stop.sequenceId === 'string' && stop.sequenceId !== '' && Number.isInteger(stop.sequenceIndex) && (stop.sequenceIndex as number) >= 0

/** ฟิลด์ของชุดที่ต้องติดไปกับจุดเวลาคัดลอก (ใบปกติ = ว่าง ไม่เขียน undefined ลง Firestore) */
export function sequenceStopFields(source: SequenceFields | null | undefined): SequenceFields {
  if (!source || !isSequenceStop(source)) return {}
  return {
    sequenceId: source.sequenceId,
    sequenceIndex: source.sequenceIndex,
    ...(Number.isInteger(source.sequenceSize) && (source.sequenceSize as number) > 0 ? { sequenceSize: source.sequenceSize } : {}),
  }
}

/** ฟิลด์ชุดงานทั้งสองแบบ (รับของไปส่งต่อ + ไปหลายจุดตามลำดับ) — ใช้ทุกจุดที่คัดลอกจุดงานไปที่อื่น ห้ามเลือกแบบเดียว */
export function jobSetFields(source: (TransferFields & SequenceFields) | null | undefined): TransferFields & SequenceFields {
  return { ...transferStopFields(source), ...sequenceStopFields(source) }
}

/** จุดที่เป็นงานครั้งเดียวผูกชุด (รับ-ส่ง หรือ งานต่อเนื่อง) — ห้ามใส่คิวต่อเนื่อง */
export const isOneOffJobStop = (stop: (TransferFields & SequenceFields) | null | undefined): boolean => isTransferStop(stop) || isSequenceStop(stop)

/** ข้อความเตือนให้โหลดหน้าใหม่ (ฟอร์มรุ่นเก่า/ข้อมูลผิดรูป) — ใช้ค่าเดียวทั้งฟอร์มและ server */
export const SEQUENCE_RELOAD = 'ใบไปหลายจุดตามลำดับผิดรูปแบบ — กรุณาโหลดหน้าใหม่ (F5) แล้วส่งอีกครั้ง'

/**
 * ตรวจรูปใบ: ไม่มี sequenceIndex เลย = ไม่ใช่ใบแบบนี้ (ผ่าน) · ใบแบบนี้ = ทุกจุดมี index ตรงกับตำแหน่ง, ไม่ปนงานรับ-ส่ง,
 * 2–SEQUENCE_MAX_STOPS จุด, จุดที่ติดกันไม่ใช่ที่เดียวกัน · places = สถานที่ของแต่ละจุด (ตำแหน่งเดียวกับ items) ไม่ส่ง = ไม่ตรวจที่ซ้ำ
 * คืนข้อความที่ผู้ขอเห็น / null = ถูกต้อง
 */
export function sequenceShapeProblem(
  items: readonly { sequenceIndex?: unknown; transferRole?: unknown }[],
  places?: readonly Place[],
): string | null {
  if (items.every(item => item.sequenceIndex === undefined)) return null
  if (items.some((item, i) => item.sequenceIndex !== i || item.transferRole !== undefined)) return SEQUENCE_RELOAD
  if (items.length < 2) return 'ไปที่เดียว ให้เลือก "งานปกติ"'
  if (items.length > SEQUENCE_MAX_STOPS) return `ใบไปหลายจุดตามลำดับมีได้ไม่เกิน ${SEQUENCE_MAX_STOPS} จุด — แยกเป็นหลายใบ`
  if (places) {
    for (let i = 1; i < items.length; i++) {
      if (places[i] && places[i - 1] && samePlace(places[i], places[i - 1])) {
        return `จุดที่ ${i + 1} เป็นที่เดียวกับจุดที่ ${i} — รวมงานไว้ในจุดเดียว`
      }
    }
  }
  return null
}

/**
 * จัดจุดของแต่ละชุดให้ "ติดกัน และเรียงตาม sequenceIndex" ณ ตำแหน่งของสมาชิกตัวแรกที่เจอ (ผู้ใช้ตัดสิน: ไม่แทรกงานอื่นกลางชุด)
 * จุดอื่นคงลำดับเดิม · ใช้หลัง Google จัดลำดับ (โหมดอัตโนมัติ) / ตอนเลือกจุดในโหมดจัดเอง
 */
export function orderSequences<T extends SequenceFields>(items: readonly T[]): T[] {
  const result: T[] = []
  const placed = new Set<string>()
  for (const item of items) {
    if (!isSequenceStop(item)) { result.push(item); continue }
    if (placed.has(item.sequenceId!)) continue
    placed.add(item.sequenceId!)
    result.push(...items.filter(m => isSequenceStop(m) && m.sequenceId === item.sequenceId)
      .map((m, at) => ({ m, at }))
      .sort((a, b) => (a.m.sequenceIndex! - b.m.sequenceIndex!) || a.at - b.at)
      .map(x => x.m))
  }
  return result
}

/** ลำดับของทั้งสองแบบ: รับก่อนส่ง แล้วจัดงานต่อเนื่องให้ติดกันตามลำดับ (ไม่ทำให้ลำดับรับ-ส่งผิด — ขยับเฉพาะจุดของงานต่อเนื่อง) */
export function enforceSetOrder<T extends TransferFields & SequenceFields & Place>(items: readonly T[]): T[] {
  return orderSequences(orderPickupsBeforeDrop(items))
}

/** คำเตือนของป้าย — ใช้ค่าคงที่นี้เทียบเสมอ */
export const SEQUENCE_WARNING = {
  outOfOrder: 'ลำดับสลับ — ตรวจลำดับงานต่อเนื่อง',
  /** งานอื่นคั่นกลางจุดของชุด (ผู้ใช้ตัดสิน: ไม่แทรกกลางชุด) — เตือนคนจัดรถ ไม่บอกคนขับ (อาจตั้งใจ) */
  interleaved: 'มีงานอื่นคั่นกลางงานต่อเนื่อง',
} as const

type Peer = SequenceFields & { siteName?: string; outcome?: string }

export interface SequenceLabel {
  role: 'sequence'
  text: string
  /** เตือนคนจัดรถ: ลำดับสลับ / บางจุดของชุดไม่ได้ไปกับเที่ยวนี้ · ไม่มี = ปกติ */
  warning?: string
  /** เลขจุด (ตามที่ผู้ขอกรอก เริ่ม 1) ที่ไม่ได้ไปกับเที่ยวนี้ */
  missing?: number[]
}

const nameOf = (p: Peer) => (p.siteName || '').trim()
const numberOf = (p: Peer) => (p.sequenceIndex as number) + 1

/**
 * ป้ายของจุดที่ `index` คิดจากจุดอื่นใน "ลิสต์เดียวกับที่แสดง" (จุดของเที่ยว + งานที่โยกเข้ามา ตามลำดับบนจอ) — คิดตอนแสดงผลเสมอ
 * ข้อความ: "🔁 จุดที่ 2/3 · ต่อจาก ไซต์A" (เลขตามที่ผู้ขอกรอก) · จุดที่ไม่ทำแล้วไม่มีคำเตือน (มีป้ายโยก/เลื่อนบอกอยู่แล้ว)
 */
export function sequenceLabel(peers: readonly Peer[], index: number): SequenceLabel | null {
  const stop = peers[index]
  if (!stop || !isSequenceStop(stop)) return null
  const group = peers.map((peer, i) => ({ peer, i })).filter(({ peer }) => isSequenceStop(peer) && peer.sequenceId === stop.sequenceId)
  const size = Math.max(stop.sequenceSize || 0, ...group.map(({ peer }) => numberOf(peer)))
  // "ต่อจาก" = จุดก่อนหน้าที่ยังไปกับเที่ยวนี้ (จุดที่เลื่อน/โยกออกแล้ว รถไม่ได้ไป ไม่เอามาเป็นชื่อ)
  const prev = group
    .filter(({ peer }) => peer.sequenceIndex! < stop.sequenceIndex! && !isInactiveStop(peer))
    .sort((a, b) => b.peer.sequenceIndex! - a.peer.sequenceIndex!)[0]
  const prevName = prev ? nameOf(prev.peer) : ''
  const text = `🔁 จุดที่ ${numberOf(stop)}/${size}${prevName ? ` · ต่อจาก ${prevName}` : ''}`
  if (isInactiveStop(stop)) return { role: 'sequence', text }
  const active = group.filter(({ peer }) => !isInactiveStop(peer))
  const present = new Set(active.map(({ peer }) => peer.sequenceIndex))
  const missing = Array.from({ length: size }, (_, k) => k).filter(k => !present.has(k)).map(k => k + 1)
  // ลำดับบนจอสลับกับลำดับที่ผู้ขอกรอก (เช่น จุดที่โยกเข้ามาต่อท้าย) — เทียบเฉพาะจุดที่ยังไปกับเที่ยวนี้
  const outOfOrder = active.some(({ peer, i }) => (peer.sequenceIndex! < stop.sequenceIndex!) !== (i < index) && i !== index)
  const missingText = missing.length ? `จุดที่ ${missing.join(', ')} ไม่ได้ไปกับเที่ยวนี้` : ''
  // งานอื่นที่ยังไปกับเที่ยวนี้อยู่ระหว่างจุดของชุด (เช่น รวมเข้าทริปเดิม / งานโยกเข้า) — ตำแหน่งบนจอ
  const positions = active.map(({ i }) => i)
  const interleaved = positions.length > 1 && peers.some((peer, i) =>
    i > Math.min(...positions) && i < Math.max(...positions) && !isInactiveStop(peer) && !(isSequenceStop(peer) && peer.sequenceId === stop.sequenceId))
  const warning = [outOfOrder ? SEQUENCE_WARNING.outOfOrder : '', interleaved ? SEQUENCE_WARNING.interleaved : '', missingText].filter(Boolean).join(' · ')
  return { role: 'sequence', text, ...(warning ? { warning } : {}), ...(missing.length ? { missing } : {}) }
}

export type JobSetLabel = TransferLabel | SequenceLabel

/** ป้ายของชุดงานทั้งสองแบบ — ใช้ตัวนี้ที่หน้าจอ (งานปกติ = null) */
export function jobSetLabel(peers: readonly (Peer & TransferFields)[], index: number): JobSetLabel | null {
  return transferLabel(peers, index) ?? sequenceLabel(peers, index)
}

/** สีป้ายบนกระดาษขาว (ใบสรุป/ใบพิมพ์) — inline style ให้ติดไปกับรูปที่ส่ง LINE (Tailwind ไม่สแกน src/lib) */
export const sequenceTagStyle: CSSProperties = { fontSize: '11px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: '#e0e7ff', color: '#3730a3' }

/**
 * เตือนคนจัดรถตอนเลื่อน/ยกเลิก/โยก/คนขับปฏิเสธ "ทีละจุด" ของงานต่อเนื่อง — จุดอื่นของชุดที่ยังไปกับเที่ยวนี้ไม่ขยับตามให้เอง
 * null = ไม่ใช่งานต่อเนื่อง / ไม่มีจุดอื่นค้างในเที่ยวนี้
 */
export function sequenceMateReminder(peers: readonly Peer[], index: number): string | null {
  const stop = peers[index]
  if (!stop || !isSequenceStop(stop)) return null
  const mates = peers
    .filter((peer, i) => i !== index && isSequenceStop(peer) && peer.sequenceId === stop.sequenceId && !isInactiveStop(peer))
    .sort((a, b) => a.sequenceIndex! - b.sequenceIndex!)
    .map(peer => `จุดที่ ${numberOf(peer)}${nameOf(peer) ? ` ${nameOf(peer)}` : ''}`)
  return mates.length ? `ยังมี ${mates.join(', ')} ของงานต่อเนื่องเดียวกันอยู่ในเที่ยวนี้` : null
}

/** เตือนจุดคู่ของทั้งสองแบบ (รับ-ส่ง / งานต่อเนื่อง) */
export function jobSetMateReminder(peers: readonly (Peer & TransferFields)[], index: number): string | null {
  return transferMateReminder(peers, index) ?? sequenceMateReminder(peers, index)
}

/**
 * เส้นทางเต็มของชุด มีเลขจุด "1.ไซต์A → 2.สนง.เอกสาร → 3.ไซต์A" — จุดที่ไม่อยู่ในลิสต์ (อยู่คันอื่น) = "2.(คันอื่น)"
 * size = จำนวนจุดของชุด (ไม่ส่ง = เลขสูงสุดที่เห็น)
 */
export function sequenceRouteText(peers: readonly Peer[], sequenceId: string, size?: number): string {
  const members = peers.filter(peer => isSequenceStop(peer) && peer.sequenceId === sequenceId)
  const total = Math.max(size || 0, ...members.map(numberOf))
  return Array.from({ length: total }, (_, k) => {
    const m = members.find(peer => peer.sequenceIndex === k)
    return `${k + 1}.${m ? nameOf(m) || 'ไม่ระบุสถานที่' : '(คันอื่น)'}`
  }).join(' → ')
}

/**
 * ข้อความต่อท้ายรายละเอียดงาน เมื่อ "เลื่อน" จุดของงานต่อเนื่องไปวันอื่น — ใบวันใหม่เป็นจุดปกติ (ผู้ใช้ตัดสิน: ใบแยกทีละจุด)
 * เขียนเส้นทางเดิม + ใบนี้คือจุดที่เท่าไร + จุดไหนเลื่อนมาด้วยกัน ให้คนจัดรถวันใหม่จัดคันเดียวกันและเรียงเอง
 * together = ตำแหน่ง (ใน peers) ของจุดที่เลื่อนพร้อมกัน · ไม่ส่ง/มีจุดเดียว = เลื่อนมาเฉพาะจุดนี้ · ไม่ใช่งานต่อเนื่อง = null
 */
export function postponedSequenceNote(peers: readonly Peer[], index: number, together?: readonly number[]): string | null {
  const stop = peers[index]
  if (!stop || !isSequenceStop(stop)) return null
  const size = Math.max(stop.sequenceSize || 0, numberOf(stop))
  const nums = [...new Set((together ?? [index]).map(i => peers[i]).filter(p => p && isSequenceStop(p) && p.sequenceId === stop.sequenceId).map(p => numberOf(p!)))].sort((a, b) => a - b)
  const moved = nums.length <= 1 ? 'เลื่อนมาเฉพาะจุดนี้' : nums.length === size ? 'เลื่อนมาทั้งชุด' : `เลื่อนมาพร้อมกัน: จุดที่ ${nums.join(', ')}`
  return `(งานต่อเนื่อง ${sequenceRouteText(peers, stop.sequenceId!, size)} · ใบนี้ = จุดที่ ${numberOf(stop)} · ${moved})`
}

/** คำอธิบายใต้ป้ายสำหรับคนขับ (ภาษาคนขับ) */
export function sequenceNoteForDriver(label: SequenceLabel | null): string | null {
  if (!label?.warning) return null
  if (label.warning.startsWith(SEQUENCE_WARNING.outOfOrder)) return 'ไปตามเลขจุดของงานต่อเนื่อง (จุดที่ 1 ก่อน) — ไม่แน่ใจถามคนจัดรถ'
  if (label.missing?.length) return `จุดที่ ${label.missing.join(', ')} ของงานนี้ไม่ได้อยู่ในใบงานนี้ — ถามคนจัดรถก่อนไป`
  return null
}

// ---------------------------------------------------------------------------
// ตัวรวมของทั้งสองแบบ สำหรับหน้าจอ (ใบสรุป/ใบพิมพ์/ใบงานคนขับ/ประวัติ)
// ---------------------------------------------------------------------------

/** ชื่อแบบงานของจุด ใช้ขึ้นต้นข้อความเตือน — งานปกติ = '' */
export function jobSetKindName(stop: (TransferFields & SequenceFields) | null | undefined): string {
  return isTransferStop(stop) ? 'งานรับของไปส่งต่อ' : isSequenceStop(stop) ? 'งานไปหลายจุดตามลำดับ' : ''
}

/** สีป้ายบนกระดาษขาว (inline style) ของทั้งสองแบบ */
export function jobSetTagStyle(label: JobSetLabel): CSSProperties {
  return label.role === 'sequence' ? sequenceTagStyle : transferTagStyle(label)
}

/** คำอธิบายใต้ป้ายสำหรับคนขับ ของทั้งสองแบบ */
export function jobSetNoteForDriver(label: JobSetLabel | null): string | null {
  if (!label) return null
  return label.role === 'sequence' ? sequenceNoteForDriver(label) : transferNoteForDriver(label)
}

/** ข้อความต่อท้ายใบวันใหม่เมื่อเลื่อนจุดของชุดงาน (จุดรับของ / จุดของงานต่อเนื่อง) · อื่น ๆ = null */
export function jobSetPostponeNote(peers: readonly (Peer & TransferFields)[], index: number, together?: readonly number[]): string | null {
  return postponedPickupNote(peers, index) ?? postponedSequenceNote(peers, index, together)
}

/**
 * คำเตือนของหน้าต่างแก้ไขเที่ยววิ่ง (หน้าประวัติ) — เฉพาะจุดของงานต่อเนื่องที่ "เพิ่งลบในหน้าต่างนี้" (แบบเดียวกับ transferMissingWarning)
 * จุดที่ขาดมาตั้งแต่เปิดหน้าต่าง (ถอดไปคันอื่น/เลื่อน) ไม่เตือน · opened = ลิสต์ตอนเปิดหน้าต่าง (รูปเดียวกับ peers)
 */
export function sequenceMissingWarning(peers: readonly Peer[], index: number, opened: readonly Peer[] = peers): string | null {
  const stop = peers[index]
  const missing = sequenceLabel(peers, index)?.missing
  if (!stop || !missing?.length) return null
  const openedHere = new Set(opened
    .filter(peer => isSequenceStop(peer) && peer.sequenceId === stop.sequenceId && !isInactiveStop(peer))
    .map(peer => numberOf(peer)))
  const removedHere = missing.filter(n => openedHere.has(n))
  return removedHere.length ? `จุดที่ ${removedHere.join(', ')} ของงานต่อเนื่องถูกลบออกจากเที่ยวนี้` : null
}

/** คำเตือนหน้าต่างแก้ไขเที่ยววิ่ง ของทั้งสองแบบ */
export function jobSetMissingWarning(peers: readonly (Peer & TransferFields)[], index: number, opened: readonly (Peer & TransferFields)[] = peers): string | null {
  return transferMissingWarning(peers, index, opened) ?? sequenceMissingWarning(peers, index, opened)
}

/**
 * งาน "รับของไปส่งต่อ" (ผู้ใช้ขอ 2026-11-05) — ใบขอเดียวมีจุดรับของ (pickup) 1 จุดขึ้นไป + จุดส่ง (drop) 1 จุดท้ายใบ
 * เดิมผู้ขอต้องทำ 2 ใบ (ใบรับ + ใบส่ง) → ถูกจัดคนละคัน / ลำดับในใบงานส่งก่อนรับ / จุดส่งไม่ได้ปักหมุด
 *
 * จุดในกลุ่มผูกกันด้วย transferId (ไม่ใช้ index — ถอนคันคู่/โยกงานทำให้ index เลื่อน และจุดในทริปไม่มี backlink ไปใบขอ)
 * ห้ามตั้งชื่อฟิลด์ว่า `pickup` เฉย ๆ — หน้าติดตามรถใช้ `pickup` คนละความหมาย (ทริปกลับอย่างเดียว)
 * ใบเก่า/ใบปกติไม่มีฟิลด์เหล่านี้ = ทำงานเหมือนเดิมทุกอย่าง
 */
// import แบบ type อย่างเดียว (ถูกตัดทิ้งตอน build) — ไฟล์นี้ถูก import ฝั่ง server ด้วย (driverTicket, vehicleRequestValidation)
import type { CSSProperties } from 'react'

export type TransferRole = 'pickup' | 'drop'

export interface TransferFields {
  transferRole?: TransferRole
  transferId?: string
  /** ชื่อจุดส่ง (เก็บไว้ที่จุดรับตอนส่งใบ) — ใช้ทำป้ายเมื่อจุดส่งไม่อยู่ในเที่ยวเดียวกัน */
  transferDropName?: string
}

export const isTransferRole = (value: unknown): value is TransferRole => value === 'pickup' || value === 'drop'

export const isTransferStop = (stop: TransferFields | null | undefined): boolean =>
  !!stop && isTransferRole(stop.transferRole) && typeof stop.transferId === 'string' && stop.transferId !== ''

/** ฟิลด์ของกลุ่มที่ต้องติดไปกับจุดเวลาคัดลอกจากใบขอไปเป็นจุดในทริป (ใบปกติ = ว่าง ไม่เขียน undefined ลง Firestore) */
export function transferStopFields(source: TransferFields | null | undefined): TransferFields {
  if (!source || !isTransferStop(source)) return {}
  return {
    transferRole: source.transferRole,
    transferId: source.transferId,
    ...(source.transferRole === 'pickup' && source.transferDropName ? { transferDropName: source.transferDropName } : {}),
  }
}

/**
 * ตรวจรูปใบ: ใบปกติ (ไม่มี role เลย) ผ่าน · ใบรับของไปส่งต่อ = ทุกจุดมี role, จุดรับ ≥ 1, จุดส่ง 1 จุดอยู่ท้ายใบ
 * คืนข้อความที่ผู้ขอเห็น / null = ถูกต้อง
 */
export function transferShapeProblem(roles: readonly (string | undefined)[]): string | null {
  if (roles.every(role => role === undefined)) return null
  if (roles.some(role => !isTransferRole(role))) return 'ใบรับของไปส่งต่อต้องมีแค่จุดรับของและจุดส่งของ — กรุณาโหลดหน้าใหม่ (F5) แล้วส่งอีกครั้ง'
  const drops = roles.filter(role => role === 'drop').length
  if (drops === 0) return 'ยังไม่ได้ระบุจุดส่งของ'
  if (drops > 1 || roles[roles.length - 1] !== 'drop') return 'ใบรับของไปส่งต่อมีจุดส่งได้ 1 จุด — ส่งหลายที่ให้แยกเป็นหลายใบ'
  if (roles.length < 2) return 'ต้องมีจุดรับของอย่างน้อย 1 จุด'
  return null
}

/** บรรทัดของจุดรับ 1 จุดในรายละเอียดงานของจุดส่ง — รูปเดียวที่ใช้ทั้งตอนส่งใบและตอนแก้ของทีหลัง (syncDropText หาบรรทัดด้วยรูปนี้) */
export const dropLine = (name: string, items: string) => `ส่งของที่รับจาก ${name.trim() || 'จุดรับ'}: ${items.trim()}`

/** รายละเอียดงานของจุดส่ง เขียนให้อัตโนมัติจากของที่รับแต่ละจุด (ผู้ขอไม่ต้องพิมพ์ซ้ำ) + งานอื่นที่จุดส่ง (ถ้ามี) */
export function buildDropDescription(pickups: readonly { name: string; items: string }[], extra: string): string {
  const lines = pickups.map(p => dropLine(p.name, p.items))
  if (extra.trim()) lines.push(extra.trim())
  return lines.join('\n')
}

export type Place = { siteId?: string | null; lat?: number | null; lng?: number | null }

/** จุดอยู่ที่เดียวกัน (ไซต์เดียวกัน หรือพิกัดตรงกัน) — ใช้ตอนย้ายจุดส่ง ไม่ให้แทรกกลางงานที่ทำในที่เดียวกัน · งานต่อเนื่องใช้ห้ามจุดติดกันซ้ำ */
export function samePlace(a: Place, b: Place): boolean {
  if (a.siteId && a.siteId === b.siteId) return true
  const coords = (p: Place) => typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  return coords(a) && coords(b) && Math.abs(a.lat! - b.lat!) < 1e-5 && Math.abs(a.lng! - b.lng!) < 1e-5
}

/**
 * จัดให้จุดส่งอยู่หลังจุดรับทุกจุดของกลุ่มเดียวกัน — ย้ายเฉพาะจุดส่งที่มาก่อน ไปต่อท้ายจุดรับตัวสุดท้าย ลำดับอื่นคงเดิม
 * ถ้าถัดจากจุดรับตัวสุดท้ายมีงานอื่นที่ที่เดียวกัน (เช่น งานสลับของ: รับของที่ Best + ส่งของให้ Best) ใส่จุดส่งหลังงานพวกนั้น
 * ไม่งั้นรถจะวิ่งออกแล้ววนกลับมาที่เดิม (Best → ดอนเมือง → Best → ดอนเมือง)
 * ใช้หลัง Google จัดลำดับให้ (โหมดอัตโนมัติ) / ตอนเลือกจุดในโหมดจัดเอง · จุดที่ไม่ใช่งานรับ-ส่งไม่ขยับ
 */
export function orderPickupsBeforeDrop<T extends TransferFields & Place>(items: readonly T[]): T[] {
  const result = [...items]
  const groups = new Set(result.filter(i => isTransferStop(i) && i.transferRole === 'drop').map(i => i.transferId))
  for (const group of groups) {
    const dropIndex = result.findIndex(i => i.transferId === group && i.transferRole === 'drop' && isTransferStop(i))
    let lastPickup = -1
    result.forEach((item, index) => { if (item.transferId === group && item.transferRole === 'pickup') lastPickup = index })
    if (lastPickup > dropIndex) {
      const [drop] = result.splice(dropIndex, 1)
      // ตัดจุดส่งออกแล้ว จุดรับตัวสุดท้ายเลื่อนมาอยู่ที่ lastPickup - 1 → ใส่ที่ lastPickup = ต่อท้ายจุดรับพอดี
      const pickup = result[lastPickup - 1]
      let at = lastPickup
      while (at < result.length && samePlace(result[at], pickup)) at++ // จุดส่งไปช้าลงได้เสมอ ไม่ทำให้กลุ่มอื่นผิดลำดับ
      result.splice(at, 0, drop)
    }
  }
  return result
}

export interface TransferLabel {
  role: TransferRole
  /** ข้อความบนป้าย */
  text: string
  /** เตือนคนจัดรถ: จุดคู่ไม่อยู่ในเที่ยวนี้ / ลำดับส่งก่อนรับ / ของบางร้านไม่ได้มา · ไม่มี = ปกติ */
  warning?: string
  /** จุดส่ง: ชื่อจุดรับที่ของไม่ได้มากับเที่ยวนี้ (เลื่อน/โยกออก/ปฏิเสธ) ทั้งที่ยังมีจุดรับอื่นมา — warning เป็นข้อความที่มีชื่อ */
  missingFrom?: string[]
}

/**
 * ป้ายงานรับของไปส่งต่อบนกระดาษขาว (ใบสรุป/ใบพิมพ์จากหน้าประวัติ) — รูปเดียวกับป้ายคันช่วย
 * inline style ให้ติดไปกับรูปที่ส่ง LINE (ย้ายมาจากใบสรุปแบบเดิมทุกตัวอักษร) · ป้ายบนพื้นมืดใช้ class Tailwind ในไฟล์หน้าเอง (Tailwind ไม่สแกน src/lib)
 */
export const transferTagStyle = (label: Pick<TransferLabel, 'role'>): CSSProperties => ({
  fontSize: '11px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px',
  ...(label.role === 'pickup' ? { background: '#ffedd5', color: '#9a3412' } : { background: '#dcfce7', color: '#166534' }),
})

/** คำเตือนของป้าย — ใช้ค่าคงที่นี้เทียบเสมอ (ห้ามเทียบข้อความตรง ๆ ที่อื่น) */
export const TRANSFER_WARNING = {
  dropMissing: 'จุดส่งไม่อยู่ในเที่ยวนี้',
  pickupMissing: 'จุดรับไม่อยู่ในเที่ยวนี้',
  dropBeforePickup: 'จุดส่งอยู่ก่อนจุดรับ — ตรวจลำดับ',
  pickupAfterDrop: 'จุดรับอยู่หลังจุดส่ง — ตรวจลำดับ',
} as const

type Peer = TransferFields & { siteName?: string; outcome?: string; sequenceId?: string; sequenceIndex?: number }

/**
 * จุดที่โยกไปคันอื่น / เลื่อนวัน / ไม่ได้ทำ (outcome อื่นที่ไม่ใช่ส่งแล้ว) — ยังอยู่ในลิสต์ของทริปเดิม แต่ของไม่ได้ไปกับคันนี้
 * ตัวเช็กเดียวที่ทุกหน้าใช้ — หน้าที่ไม่มีป้ายโยก/เลื่อนกำกับ (หน้าประวัติ) ไม่ขึ้นป้ายรับ-ส่งของจุดพวกนี้ กันคนขับไปรับของที่ไม่ต้องไปแล้ว
 */
export const isInactiveStop = (p: { outcome?: string | null }) => !!p.outcome && p.outcome !== 'delivered'

/**
 * ป้ายของจุดที่ `index` คิดจากจุดอื่นใน "ลิสต์เดียวกับที่แสดง" (จุดของเที่ยว + งานที่โยกเข้ามา ตามลำดับบนจอ)
 * คิดตอนแสดงผลเสมอ ไม่เก็บชื่อคู่ไว้ในจุด — โยก/เลื่อน/ยกเลิกทีหลังแล้วป้ายไม่ค้างค่าเก่า
 * จุดที่โยกออก/เลื่อน/ไม่ได้ทำ ไม่นับเป็นคู่ และตัวมันเองไม่มีคำเตือน (มีป้ายโยก/เลื่อนบอกอยู่แล้ว)
 */
export function transferLabel(peers: readonly Peer[], index: number): TransferLabel | null {
  const stop = peers[index]
  if (!stop || !isTransferStop(stop)) return null
  const mates = peers
    .map((peer, i) => ({ peer, i }))
    .filter(({ peer, i }) => i !== index && isTransferStop(peer) && peer.transferId === stop.transferId && !isInactiveStop(peer))
  const quiet = isInactiveStop(stop)

  if (stop.transferRole === 'pickup') {
    const drop = mates.find(m => m.peer.transferRole === 'drop')
    const dropName = (drop?.peer.siteName || stop.transferDropName || '').trim()
    const text = dropName ? `📦 รับของ → ไปส่งต่อที่ ${dropName}` : '📦 รับของไปส่งต่อ'
    if (quiet) return { role: 'pickup', text }
    if (!drop) return { role: 'pickup', text, warning: TRANSFER_WARNING.dropMissing }
    if (drop.i < index) return { role: 'pickup', text, warning: TRANSFER_WARNING.dropBeforePickup }
    return { role: 'pickup', text }
  }

  const pickups = mates.filter(m => m.peer.transferRole === 'pickup')
  // จุดรับของกลุ่มที่ยังอยู่ในลิสต์ แต่ของไม่ได้มากับคันนี้ (เลื่อน/โยกออก/ปฏิเสธ) — ชื่อยังอยู่บนป้าย เพราะรายละเอียดงานยังเขียนถึงร้านนั้น
  const nameOf = (p: Peer) => (p.siteName || '').trim()
  const groupPickups = peers.filter((peer, i) => i !== index && isTransferStop(peer) && peer.transferId === stop.transferId && peer.transferRole === 'pickup')
  const names = [...new Set(groupPickups.map(nameOf).filter(Boolean))]
  // ตัดสินทีละจุด (ไม่ใช่ทีละชื่อ): ร้านเดียวกันสองรายการแล้วไม่ได้ไปรายการหนึ่ง ยังต้องเตือน · ไม่มีชื่อ = "จุดรับ"
  const labelOf = (p: Peer) => nameOf(p) || 'จุดรับ'
  const activeNames = new Set(pickups.map(m => labelOf(m.peer)))
  const awayNames = [...new Set(groupPickups.filter(isInactiveStop).map(p => {
    const name = labelOf(p)
    return activeNames.has(name) ? `${name} (บางรายการ)` : name
  }))]
  const text = names.length ? `🏁 ส่งของที่รับจาก ${names.join(', ')}` : '🏁 จุดส่งของ'
  const away = awayNames.length ? { missingFrom: awayNames } : {}
  const awayText = `ของจาก ${awayNames.join(', ')} ไม่ได้มากับเที่ยวนี้`
  if (quiet) return { role: 'drop', text }
  if (pickups.length === 0) return { role: 'drop', text, warning: TRANSFER_WARNING.pickupMissing }
  // ลำดับผิด (จุดรับที่โยกเข้ามาต่อท้าย) ไม่บังคำเตือนของที่ไม่มา — บอกทั้งสองเรื่อง
  if (pickups.some(m => m.i > index)) return { role: 'drop', text, warning: awayNames.length ? `${TRANSFER_WARNING.pickupAfterDrop} · ${awayText}` : TRANSFER_WARNING.pickupAfterDrop, ...away }
  if (awayNames.length) return { role: 'drop', text, warning: awayText, ...away }
  return { role: 'drop', text }
}

/**
 * คำเตือนของหน้าต่างแก้ไขเที่ยววิ่ง (หน้าประวัติ) — เฉพาะ "จุดรับ/จุดส่งไม่อยู่ในเที่ยวนี้" ที่การลบจุดในหน้าต่างนั้นทำให้เกิดได้ (ไม่เตือนลำดับ/ของบางร้าน)
 * จุดคู่ยังอยู่ในลิสต์แต่เลื่อน/โยกออก/ไม่ได้ทำแล้ว = ไม่เตือน: หน้าต่างนั้นไม่มีป้ายเลื่อน/โยกบอกเหตุผล
 * คนจัดรถจะเห็นชื่อร้านอยู่ในลิสต์แต่ระบบบอกว่าไม่อยู่ แล้วลบทิ้ง (ประวัติผลเลื่อน/โยกหายจากทริป) · ลบจุดคู่ออกจากฟอร์มแล้วค่อยเตือน
 * opened = ลิสต์ตอนเปิดหน้าต่าง (รูปเดียวกับ peers) — ไม่เตือนเมื่อจุดคู่ยังอยู่ในลิสต์และไม่ได้ไปกับเที่ยวมาตั้งแต่เปิดหน้าต่าง
 * ตอนเปิดยังมีจุดคู่ที่ไปกับเที่ยว แต่ในฟอร์มไม่เหลือแล้ว = คนจัดรถเพิ่งลบ → เตือน แม้ยังมีจุดคู่ที่ไม่ทำแล้วค้างในลิสต์ · ไม่ส่ง = แบบเดิม
 */
export function transferMissingWarning(peers: readonly Peer[], index: number, opened: readonly Peer[] = peers): string | null {
  const warning = transferLabel(peers, index)?.warning
  if (warning !== TRANSFER_WARNING.pickupMissing && warning !== TRANSFER_WARNING.dropMissing) return null
  const stop = peers[index]
  const listed = peers.some((peer, i) => i !== index && isTransferStop(peer) && peer.transferId === stop.transferId && peer.transferRole !== stop.transferRole)
  const removedHere = opened.some(peer => isTransferStop(peer) && peer.transferId === stop.transferId && peer.transferRole !== stop.transferRole && !isInactiveStop(peer))
  return listed && !removedHere ? null : warning
}

/** บรรทัดใต้งานโยกเข้าที่แสดงอย่างเดียว (แผงปิดผลงาน) — ผลของงานโยกเก็บที่คันต้นทาง · ใช้ประโยคนี้ทุกที่ที่บอกให้ไปแก้ที่คันต้นทาง */
export const TRANSFER_EDIT_AT_SOURCE = 'แก้ผล/โยก/เลื่อนงานนี้ที่การ์ดของคันต้นทาง'

/** ตำแหน่งบนจอ: จุดของเที่ยว (index ที่บันทึก) หรืองานที่โยกเข้ามา (index ในลิสต์งานโยกเข้า) */
export type TransferDisplayEntry =
  | { kind: 'own'; index: number }
  /** inline = ยังมีจุดของเที่ยวอยู่หลังตำแหน่งนี้ (ถูกแทรกก่อนจุดส่งของคันนี้) · false = อยู่ท้ายใบเหมือนเดิม */
  | { kind: 'incoming'; index: number; inline: boolean }

export interface TransferDisplay<O extends Peer, I extends Peer> {
  order: TransferDisplayEntry[]
  /** จุดเรียงตามลำดับบนจอ — ส่งให้ transferLabel */
  peers: (O | I)[]
  /** ตำแหน่งบนจอ (เริ่ม 0) ของจุดของเที่ยว / งานโยกเข้าแต่ละงาน — เลขข้อที่แสดง = ตำแหน่ง + 1 */
  ownPos: number[]
  incomingPos: number[]
}

/**
 * ลำดับที่แสดงบนใบสรุป/ใบงานคนขับ/แผงปิดผลงาน — เริ่มจาก [จุดของเที่ยวตามที่บันทึก..., งานโยกเข้า...] (แบบเดิม)
 * แล้วย้ายงานโยกเข้าที่เป็น "จุดรับ" ไปไว้หน้าจุดส่งของกลุ่มเดียวกันที่ยังไปกับเที่ยวนี้ (ถ้าจุดส่งมาก่อน)
 * งานต่อเนื่องที่โยกเข้า ไปไว้หน้าจุดลำดับถัดไปของชุดเดียวกัน (กติกาเดียวกัน)
 * รับหลายร้านคงลำดับเดิม (P1, P2, D) · จุดของเที่ยวไม่สลับกันเอง · งานอื่นอยู่ท้ายเหมือนเดิม · ทริปปกติได้ลำดับเดิมทุกตำแหน่ง
 * แสดงผลอย่างเดียว: ไม่เรียง stops ที่บันทึก — ปุ่ม/หมายเหตุ (stop_<i>)/กม. ยังใช้ index ที่บันทึก
 */
export function transferDisplayOrder<O extends Peer, I extends Peer>(own: readonly O[], incoming: readonly I[]): TransferDisplay<O, I> {
  type Slot = { kind: 'own'; index: number; stop: O } | { kind: 'incoming'; index: number; stop: I }
  const slots: Slot[] = [
    ...own.map((stop, index): Slot => ({ kind: 'own', index, stop })),
    ...incoming.map((stop, index): Slot => ({ kind: 'incoming', index, stop })),
  ]
  incoming.forEach((job, index) => {
    if (!isTransferStop(job) || job.transferRole !== 'pickup') return
    const at = slots.findIndex(s => s.kind === 'incoming' && s.index === index)
    const drop = slots.findIndex(s => isTransferStop(s.stop) && s.stop.transferRole === 'drop' && s.stop.transferId === job.transferId && !isInactiveStop(s.stop))
    if (drop === -1 || drop > at) return
    const [slot] = slots.splice(at, 1)
    slots.splice(drop, 0, slot) // drop อยู่ก่อน at → ตัด at ออกแล้วตำแหน่ง drop ไม่เลื่อน = วางหน้าจุดส่งพอดี
  })
  // งานไปหลายจุดตามลำดับ (lib/sequence): งานโยกเข้าไปอยู่หน้าจุดลำดับถัดไปของชุดเดียวกันที่ยังไปกับเที่ยวนี้ (ถ้าจุดนั้นมาก่อน)
  incoming.forEach((job, index) => {
    const key = stopSetKey(job)
    if (!key?.startsWith('sq:')) return
    const at = slots.findIndex(s => s.kind === 'incoming' && s.index === index)
    const later = slots.findIndex(s => s !== slots[at] && stopSetKey(s.stop) === key && (s.stop.sequenceIndex as number) > (job.sequenceIndex as number) && !isInactiveStop(s.stop))
    if (later === -1 || later > at) return
    const [slot] = slots.splice(at, 1)
    slots.splice(later, 0, slot)
  })
  const ownPos: number[] = new Array(own.length)
  const incomingPos: number[] = new Array(incoming.length)
  const order: TransferDisplayEntry[] = new Array(slots.length)
  let ownAfter = false
  for (let pos = slots.length - 1; pos >= 0; pos--) {
    const slot = slots[pos]
    if (slot.kind === 'own') {
      ownPos[slot.index] = pos
      order[pos] = { kind: 'own', index: slot.index }
      ownAfter = true
    } else {
      incomingPos[slot.index] = pos
      order[pos] = { kind: 'incoming', index: slot.index, inline: ownAfter }
    }
  }
  return { order, peers: slots.map(s => s.stop), ownPos, incomingPos }
}

/** คำอธิบายใต้ป้ายสำหรับคนขับ (ภาษาคนขับ ไม่ใช่ภาษาคนจัดรถ) */
export function transferNoteForDriver(label: TransferLabel | null): string | null {
  if (!label?.warning) return null
  // จุดคู่อาจไม่อยู่ในใบงานเลย หรืออยู่แต่ถูกเลื่อน/โยก/ปฏิเสธ — "ไม่ได้ไปกับเที่ยวนี้" ถูกทั้งสองกรณี ระบบไม่รู้ว่าของอยู่ไหน จึงให้ถามก่อน
  if (label.warning === TRANSFER_WARNING.dropMissing) return 'จุดส่งของงานนี้ไม่ได้ไปกับเที่ยวนี้ — ถามคนจัดรถว่าเอาของไปไว้ที่ไหน'
  if (label.warning === TRANSFER_WARNING.pickupMissing) return 'จุดรับของงานนี้ไม่ได้ไปกับเที่ยวนี้ — ถามคนจัดรถก่อนไปว่าของอยู่ที่ไหน'
  const missing = label.missingFrom?.length ? `ของจาก ${label.missingFrom.join(', ')} ไม่ได้มากับเที่ยวนี้ — ส่งเฉพาะของที่รับมา` : null
  const outOfOrder = label.warning.startsWith(TRANSFER_WARNING.pickupAfterDrop) || label.warning.startsWith(TRANSFER_WARNING.dropBeforePickup)
  if (!outOfOrder) return missing
  if (label.role === 'pickup') return 'รับของจุดนี้ก่อน แล้วค่อยไปจุดส่ง'
  return missing ? `ไปรับของที่จุดรับในใบงานนี้ก่อน แล้วค่อยมาส่งจุดนี้ · ${missing}` : 'ไปรับของให้ครบก่อน แล้วค่อยมาส่งจุดนี้'
}

/**
 * เตือนคนจัดรถตอนเลื่อน/ยกเลิก/โยก/คนขับปฏิเสธ "ทีละจุด" ของงานรับ-ส่ง — จุดคู่ที่ยังไปกับเที่ยวนี้ไม่ขยับตามให้เอง
 * จุดรับ → บอกจุดส่ง · จุดส่ง → บอกจุดรับ · peers = ลิสต์เดียวกับป้าย (จุดของเที่ยว + งานที่โยกเข้ามา)
 * null = ไม่ใช่งานรับ-ส่ง / ไม่มีจุดคู่ค้างในเที่ยวนี้
 */
export function transferMateReminder(peers: readonly Peer[], index: number): string | null {
  const stop = peers[index]
  if (!stop || !isTransferStop(stop)) return null
  const want: TransferRole = stop.transferRole === 'pickup' ? 'drop' : 'pickup'
  const kind = want === 'drop' ? 'จุดส่ง' : 'จุดรับ'
  const names = [...new Set(peers
    .filter((peer, i) => i !== index && isTransferStop(peer) && peer.transferId === stop.transferId && peer.transferRole === want && !isInactiveStop(peer))
    .map(peer => (peer.siteName || '').trim() || kind))]
  return names.length ? `ยังมี${kind} ${names.join(', ')} ของงานเดียวกันอยู่ในเที่ยวนี้` : null
}

/**
 * ข้อความต่อท้ายรายละเอียดงาน เมื่อ "เลื่อน" จุดรับไปวันอื่น — ใบวันใหม่เป็นจุดปกติ (ไม่มีจุดส่งในใบ)
 * จึงต้องเขียนไว้ว่ารับแล้วเอาไปส่งที่ไหน · จุดอื่นที่ไม่ใช่จุดรับ = null
 */
export function postponedPickupNote(peers: readonly Peer[], index: number): string | null {
  const stop = peers[index]
  if (!stop || !isTransferStop(stop) || stop.transferRole !== 'pickup') return null
  const drop = peers.find((peer, i) => i !== index && isTransferStop(peer) && peer.transferId === stop.transferId && peer.transferRole === 'drop')
  const name = (drop?.siteName || stop.transferDropName || '').trim()
  return name ? `(รับของแล้วเอาไปส่งต่อที่ ${name})` : '(รับของแล้วเอาไปส่งต่อ — ถามผู้ขอว่าส่งที่ไหน)'
}

// ---------------------------------------------------------------------------
// แก้ของที่จุดรับแล้ว จุดส่งอัปเดตตาม (ผู้ใช้ขอ 2026-11-05)
// รายละเอียดของจุดส่งถูกเขียนรวมก้อนเดียวตอนส่งใบ — แก้ของที่จุดรับทีหลัง ให้แทน "เฉพาะบรรทัดของจุดรับนั้น" ที่ตรงทุกตัวอักษร
// ข้อความอื่นในจุดส่ง (งานอื่นที่ผู้ขอพิมพ์ / ที่คนจัดรถแก้เอง) คงเดิม · หาไม่เจอ = ไม่แตะ แล้วเตือนให้แก้เอง
// แก้แค่ข้อความในฟิลด์เดิม (jobDescription ของใบขอ / cargoDetails ของจุดในทริป) ไม่เพิ่มฟิลด์ ไม่สลับลำดับจุด
// ---------------------------------------------------------------------------

/** ตำแหน่งที่ `line` อยู่เต็มบรรทัด (ต้นข้อความหรือหลัง \n และจบที่ท้ายข้อความหรือก่อน \n) — ค้นข้อความธรรมดา ไม่ใช้ RegExp (ชื่อร้านมี ( ) . + * ? ได้) */
function wholeLineAt(text: string, line: string): number[] {
  const found: number[] = []
  for (let at = text.indexOf(line); at !== -1; at = text.indexOf(line, at + 1)) {
    const end = at + line.length
    if ((at === 0 || text[at - 1] === '\n') && (end === text.length || text[end] === '\n')) found.push(at)
  }
  return found
}

export type DropTextSync = 'updated' | 'same' | 'manual'

/**
 * แทนบรรทัด "ส่งของที่รับจาก <ชื่อ>: <ของเดิม>" ในรายละเอียดจุดส่ง ด้วยของใหม่
 * updated = เจอบรรทัดเดิม 1 ที่แล้วแทน · same = บรรทัดเหมือนเดิม/มีบรรทัดใหม่อยู่แล้ว · manual = ไม่เจอ หรือเจอหลายที่ (ไม่แตะข้อความ)
 * ของเดิมเป็น "ปูน 10" ไม่ไปจับบรรทัด "ปูน 10 ถุง" (ต้องจบบรรทัดพอดี) · ของหลายบรรทัดใช้ได้
 */
export function syncDropText(dropText: string, pickupName: string, oldItems: string, newItems: string): { text: string; result: DropTextSync } {
  const oldLine = dropLine(pickupName, oldItems)
  const newLine = dropLine(pickupName, newItems)
  if (oldLine === newLine) return { text: dropText, result: 'same' }
  const found = wholeLineAt(dropText, oldLine)
  if (found.length === 1) return { text: dropText.slice(0, found[0]) + newLine + dropText.slice(found[0] + oldLine.length), result: 'updated' }
  if (found.length === 0 && wholeLineAt(dropText, newLine).length) return { text: dropText, result: 'same' }
  return { text: dropText, result: 'manual' }
}

type RequestDestinationLike = TransferFields & { siteName?: string; jobDescription?: string; withdrawn?: boolean }

export interface PickupItemsEdit<T> {
  destinations: T[]
  /** on-trip = จุดส่งจัดเข้าเที่ยวแล้ว (ไม่แตะ) · none = ไม่ใช่จุดรับ / ไม่มีจุดส่งในใบ / จุดส่งเป็นสำเนาคันคู่ที่ถอนแล้ว */
  drop: DropTextSync | 'on-trip' | 'none'
  dropName: string
  /** จุดรับนี้จัดเข้าเที่ยวแล้ว (ไม่นับสำเนาที่ถอน) — ใบงานคนขับยังเป็นของเดิม */
  pickupOnTrip: boolean
}

/**
 * หน้าคำขอ: แก้รายละเอียดงานของจุดที่ `index` แล้วซิงก์จุดส่งของกลุ่มเดียวกันในใบนี้ (คืน destinations ชุดใหม่ ไม่แก้ array/object เดิม)
 * ไม่แตะทริป — จุดในทริปไม่มีตัวชี้กลับมาใบขอ · ชุดคันคู่มี transferId ของตัวเอง จึงไม่ปนกัน
 */
export function applyPickupItemsEdit<T extends RequestDestinationLike>(
  request: { destinations?: readonly T[]; assignedDestinations?: readonly unknown[] },
  index: number,
  items: string,
): PickupItemsEdit<T> {
  const destinations = [...(request.destinations || [])]
  const pickup = destinations[index]
  const assigned = Array.isArray(request.assignedDestinations) ? request.assignedDestinations : []
  destinations[index] = { ...pickup, jobDescription: items }
  const pickupOnTrip = assigned.includes(index) && !pickup?.withdrawn
  if (!isTransferStop(pickup) || pickup.transferRole !== 'pickup') return { destinations, drop: 'none', dropName: '', pickupOnTrip }
  const drops = destinations.flatMap((d, i) => (isTransferStop(d) && d.transferRole === 'drop' && d.transferId === pickup.transferId ? [i] : []))
  const fallbackName = (pickup.transferDropName || '').trim()
  if (drops.length === 0) return { destinations, drop: 'none', dropName: fallbackName, pickupOnTrip }
  if (drops.length > 1) return { destinations, drop: 'manual', dropName: fallbackName, pickupOnTrip }
  const at = drops[0]
  const drop = destinations[at]
  const dropName = (drop.siteName || '').trim() || fallbackName
  if (assigned.includes(at)) return { destinations, drop: drop.withdrawn ? 'none' : 'on-trip', dropName, pickupOnTrip }
  const synced = syncDropText(drop.jobDescription || '', pickup.siteName || '', pickup.jobDescription || '', items)
  if (synced.result === 'updated') destinations[at] = { ...drop, jobDescription: synced.text }
  return { destinations, drop: synced.result, dropName, pickupOnTrip }
}

/** ที่แก้ของในเที่ยว — ปุ่มดินสอไม่เปิดให้เที่ยวคิวต่อเนื่อง (handleOpenEdit) จึงต้องบอกทางออกไว้ด้วย */
const EDIT_IN_TRIP = 'เมนู ประวัติการส่ง → ปุ่มดินสอ · ถ้าเป็นคิวต่อเนื่อง ให้แจ้งคนขับเอง'

/** ข้อความต่อท้าย toast "บันทึกรายละเอียดงานแล้ว" ของหน้าคำขอ · warn = ต้องให้คนจัดรถไปแก้ต่อเอง (toast สีแดง) */
export function pickupEditMessage(plan: Pick<PickupItemsEdit<unknown>, 'drop' | 'dropName' | 'pickupOnTrip'>): { text: string | null; warn: boolean } {
  const dropLabel = `จุดส่ง${plan.dropName ? ` ${plan.dropName}` : ''}`
  const parts: string[] = []
  if (plan.pickupOnTrip) parts.push(`⚠️ จุดรับนี้จัดเข้าเที่ยวแล้ว ใบงานคนขับยังเป็นรายการเดิม — แก้ของที่จุดรับในเที่ยวนั้นด้วย (${EDIT_IN_TRIP})`)
  if (plan.drop === 'updated') parts.push(plan.pickupOnTrip ? `${dropLabel} ในใบนี้อัปเดตแล้ว` : `อัปเดตรายการของที่${dropLabel} ให้ตามแล้ว`)
  if (plan.drop === 'manual') parts.push(`⚠️ ${dropLabel} ยังเป็นรายการเดิม (ระบบแก้ให้เองไม่ได้) — แก้รายละเอียดที่จุดส่งด้วย`)
  if (plan.drop === 'on-trip') {
    parts.push(plan.pickupOnTrip
      ? `${dropLabel} ก็จัดเข้าเที่ยวแล้ว — ถ้าอยู่เที่ยวเดียวกัน แก้ของที่จุดรับในเที่ยวนั้นแล้วจุดส่งจะแก้ตามให้`
      : `⚠️ ${dropLabel} จัดเข้าเที่ยวแล้ว — แก้ช่องรายละเอียดของจุดส่งในเที่ยวนั้นเอง (${EDIT_IN_TRIP})`)
  }
  return { text: parts.length ? parts.join(' · ') : null, warn: plan.pickupOnTrip || plan.drop === 'manual' || plan.drop === 'on-trip' }
}

type TripStopLike = TransferFields & {
  siteName?: string
  cargoDetails?: string
  outcome?: string | null
  assistForPlate?: string
  postponedToDate?: string
  postponedRequestId?: string
}

export interface TripDropSync<T> {
  /** stops ของฟอร์มที่แก้บรรทัดของในจุดส่งแล้ว (ลำดับ/จำนวนเท่าเดิม) */
  stops: T[]
  /** ชื่อจุดส่งที่แทนบรรทัดของให้แล้ว */
  updated: string[]
  /** ตำแหน่งในฟอร์มของจุดรับที่บรรทัดของในจุดส่งถูกแทน — ใช้บอกในหน้าต่างก่อนกดบันทึก */
  replacedFor: number[]
  /** จุดส่งไม่อยู่ในเที่ยวนี้ (ชื่อจากจุดรับ) */
  notInTrip: string[]
  /** ต้องตรวจเอง: หาบรรทัดเดิมไม่เจอ / จุดส่งหรือจุดรับเลื่อนวันแล้ว */
  check: string[]
  /** จุดรับที่ของเปลี่ยน (ชื่อจุดรับ + ของใหม่) — ใช้เช็กว่าสำเนาคันช่วย/งานต้นทางบนคันอื่นยังไม่ได้แก้ */
  changed: { transferId: string; assistForPlate: string; siteName: string; items: string }[]
}

/** YYYY-MM-DD → DD/MM/YYYY แบบเดียวกับหน้าประวัติ */
const dayText = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : iso || '')
// ใบวันใหม่มีจุดเดียว — พอจัดรถแล้วสถานะเป็น approved ไม่ขึ้นในหน้าคำขอ งานจริงอยู่ในเที่ยวของวันใหม่ จึงบอกทั้ง 2 ทาง
const postponedText = (stop: TripStopLike) => {
  const day = stop.postponedToDate ? `วันที่ ${dayText(stop.postponedToDate)}` : 'วันใหม่'
  return `เลื่อน${stop.postponedToDate ? `ไป${day} ` : 'วัน'}แล้ว — ถ้ายังไม่จัดรถ แก้รายละเอียดที่ใบ${stop.postponedRequestId ? ` ${stop.postponedRequestId}` : 'วันใหม่'} ในหน้าคำขอ · ถ้าจัดรถแล้ว แก้ที่เที่ยว${day} (${EDIT_IN_TRIP})`
}

/**
 * หน้าต่าง "แก้ไขเที่ยววิ่ง": จุดรับที่ของเปลี่ยน (เทียบกับตอนเปิดหน้าต่าง) → แทนบรรทัดของในจุดส่งของกลุ่มเดียวกัน "ในฟอร์มตอนนี้"
 * เทียบกับข้อความจุดส่งในฟอร์มเสมอ (คนจัดรถพิมพ์อย่างอื่นเพิ่มที่จุดส่งไว้ก็ยังแทนเฉพาะบรรทัดเดิม)
 * จับคู่เฉพาะจุดที่ assistForPlate เหมือนกัน (จุดจริงกับจุดจริง / สำเนาคันช่วยจากคันเดียวกัน) · จุดรับที่เลื่อนวันแล้วไม่ซิงก์ (งานจริงอยู่ใบวันใหม่)
 * จุดรับที่โยกไปคันอื่นยังซิงก์ — คันที่รับงานอ่านรายละเอียดจากจุดต้นทาง · ทริปปกติ = stops เดิมทุกค่า
 */
export function syncDropsInTripEdit<T extends TripStopLike>(
  originalStops: readonly T[],
  editedStops: readonly T[],
  sourceIndexes: readonly (number | null)[],
): TripDropSync<T> {
  const sync: TripDropSync<T> = { stops: [...editedStops], updated: [], replacedFor: [], notInTrip: [], check: [], changed: [] }
  const kept = new Set(sourceIndexes.filter((i): i is number => typeof i === 'number'))
  const assistOf = (stop: TripStopLike) => stop.assistForPlate || ''
  const addOnce = (list: string[], text: string) => { if (!list.includes(text)) list.push(text) }
  editedStops.forEach((row, at) => {
    const source = sourceIndexes[at]
    if (typeof source !== 'number' || !isTransferStop(row) || row.transferRole !== 'pickup') return
    const oldItems = originalStops[source]?.cargoDetails || ''
    const newItems = row.cargoDetails || ''
    if (oldItems === newItems) return
    sync.changed.push({ transferId: row.transferId!, assistForPlate: assistOf(row), siteName: row.siteName || '', items: newItems })
    const pickupName = (row.siteName || '').trim() || 'จุดรับ'
    if (row.outcome === 'postponed') { addOnce(sync.check, `จุดรับ ${pickupName} ${postponedText(row)} (จุดส่งไม่ถูกแก้ตาม)`); return }
    const isMate = (stop: TripStopLike) => isTransferStop(stop) && stop.transferRole === 'drop' && stop.transferId === row.transferId && assistOf(stop) === assistOf(row)
    const drops = sync.stops.flatMap((stop, i) => (isMate(stop) ? [i] : []))
    const fallbackName = (row.transferDropName || '').trim()
    if (drops.length === 0) {
      // จุดส่งถูกลบในหน้าต่างนี้เอง = คนจัดรถตั้งใจ ไม่เตือน · สำเนาคันช่วยไม่มีจุดส่งสำเนา = ไม่เตือน (dropSyncNote บอกเรื่องงานต้นทางบนคันอื่นแทน)
      if (!assistOf(row) && !originalStops.some((stop, i) => isMate(stop) && !kept.has(i))) addOnce(sync.notInTrip, fallbackName)
      return
    }
    const dropName = (sync.stops[drops[0]].siteName || '').trim() || fallbackName || 'จุดส่ง'
    if (drops.length > 1) { addOnce(sync.check, `จุดส่ง ${dropName} ยังเป็นรายการเดิม (มีหลายจุดส่งของงานเดียวกัน) — ตรวจแล้วแก้เอง`); return }
    const drop = sync.stops[drops[0]]
    if (drop.outcome === 'postponed') { addOnce(sync.check, `จุดส่ง ${dropName} ${postponedText(drop)}`); return }
    const synced = syncDropText(drop.cargoDetails || '', row.siteName || '', oldItems, newItems)
    if (synced.result === 'updated') {
      sync.stops[drops[0]] = { ...drop, cargoDetails: synced.text }
      addOnce(sync.updated, dropName)
      sync.replacedFor.push(at)
    } else if (synced.result === 'manual') {
      addOnce(sync.check, `จุดส่ง ${dropName} ยังเป็นรายการเดิม (หาบรรทัดของ ${pickupName} เดิมไม่เจอ) — เปิดแก้ไขอีกครั้งแล้วแก้ช่องของจุดส่งเอง`)
    }
  })
  return sync
}

/**
 * ข้อความต่อท้าย toast "แก้ไขสำเร็จ" ของหน้าประวัติ (ขึ้นต้นด้วย " · " / ว่าง = ไม่มีอะไรต้องบอก) · warn = มีเรื่องต้องไปแก้ต่อ (toast สีแดง)
 * otherStops = จุดของทริปอื่นที่ยังไม่ยกเลิก — มีสำเนาคันช่วยของงานนี้ (หรือแก้ที่คันช่วย แล้วงานต้นทางอยู่คันอื่น) ที่ยังไม่เป็นของใหม่ = บอกว่าคันนั้นไม่ถูกแก้ตาม
 * (จุดรับชื่อเดียวกันที่ของยังไม่ตรงของใหม่ / จุดส่งที่ยังไม่มีบรรทัดของใหม่ · แก้ครบทั้ง 2 คันแล้ว = ไม่เตือน)
 * ใบงานคนขับไม่โหลดข้อมูลใหม่เอง (ดึงครั้งเดียวตอนเปิดลิงก์) จึงต้องบอกให้คนขับเปิดลิงก์ใหม่ — ไม่ใช้การดึงซ้ำเป็นระยะ (โควตา Vercel)
 */
export function dropSyncNote(sync: Pick<TripDropSync<unknown>, 'updated' | 'notInTrip' | 'check' | 'changed'>, otherStops: readonly TripStopLike[]): { text: string; warn: boolean } {
  const parts: string[] = []
  if (sync.updated.length) parts.push(`อัปเดตรายการของที่จุดส่ง ${sync.updated.join(', ')} ให้ตามแล้ว · ถ้าคนขับเปิดใบงานไว้แล้ว ให้บอกคนขับปิดแล้วเปิดลิงก์ใหม่`)
  const warnings = [
    // จุดส่งที่ยังไม่จัด (ค้างในใบขอ) หน้านี้ไม่ได้แก้ให้ — แก้จุดรับเดียวกันในหน้าคำขอ แล้ว applyPickupItemsEdit ซิงก์จุดส่งในใบให้ (ตอนจัดทีหลังจะได้ของใหม่)
    // หน้าคำขอเห็นว่าจุดรับนี้จัดเข้าเที่ยวแล้ว จึงขึ้น toast แดงให้ไปแก้ในเที่ยว (pickupEditMessage) — บอกไว้ก่อน ไม่งั้นคนจัดรถแก้ในเที่ยวซ้ำ
    ...sync.notInTrip.map(name => `${TRANSFER_WARNING.dropMissing}${name ? ` (${name})` : ''} — ถ้าจัดไปเที่ยวอื่นแล้ว ให้แก้รายการที่จุดส่งในเที่ยวนั้นด้วย (ถ้าเป็นคิวต่อเนื่อง ให้แจ้งคนขับเอง) · ถ้ายังไม่ได้จัด ให้แก้ของที่จุดรับเดียวกันในหน้าคำขอด้วย (จุดส่งในใบจะแก้ตามให้) — ถ้าหน้าคำขอเตือนว่าจุดรับนี้จัดเข้าเที่ยวแล้ว ไม่ต้องแก้จุดรับในเที่ยวนี้ซ้ำ (แก้ที่นี่แล้ว)`),
    ...sync.check,
  ]
  const notUpdated = (p: TripDropSync<unknown>['changed'][number], stop: TripStopLike) =>
    stop.transferRole === 'drop'
      ? wholeLineAt(stop.cargoDetails || '', dropLine(p.siteName, p.items)).length === 0
      : (stop.siteName || '').trim() === p.siteName.trim() && (stop.cargoDetails || '').trim() !== p.items.trim()
  const assisted = sync.changed.some(p => otherStops.some(stop => isTransferStop(stop) && stop.transferId === p.transferId && !!(p.assistForPlate || stop.assistForPlate) && notUpdated(p, stop)))
  if (assisted) warnings.push('สำเนาคันช่วย/งานต้นทางบนคันอื่นไม่ถูกแก้ตาม — แก้ที่คันนั้นด้วย')
  return { text: [...parts, ...warnings.map(w => `⚠️ ${w}`)].map(part => ` · ${part}`).join(''), warn: warnings.length > 0 }
}

// ---------------------------------------------------------------------------
// ทำทั้งชุด (ใบสรุป: โยก/คนขับปฏิเสธ/ยกเลิก/เลื่อน จุดของกลุ่มเดียวกันพร้อมกัน ผู้ใช้ขอ 2026-11-05)
// เขียนข้อมูลหน้าตาเหมือนกดทีละจุด N ครั้ง (ไม่มีฟิลด์ใหม่) · แตะได้แค่จุดของเที่ยวนี้ในการเขียนครั้งเดียว
// งานโยกเข้า (ผลเก็บที่คันต้นทาง) / สำเนาคันช่วย / จุดที่ไม่ทำแล้ว / จุดของกลุ่มบนคันอื่น ไม่ถูกทำตาม — หน้าต่างบอกรายชื่อด้วย transferSetOutside
// "ชุด" = งานรับของไปส่งต่อ (transferId) หรืองานไปหลายจุดตามลำดับ (sequenceId, lib/sequence.ts 2026-11-06) — ฟังก์ชันกลุ่มนี้ใช้ได้ทั้งสองแบบ
// ---------------------------------------------------------------------------

/** บันทึกทั้งชุดไม่ผ่านเพราะงานในทริปเปลี่ยนหลังเปิดหน้าต่าง — ปิดหน้าต่างแล้วบอกประโยคนี้ */
export const TRANSFER_SET_CONFLICT = 'งานในทริปนี้เพิ่งถูกแก้ — ตรวจแล้วกดปุ่มที่จุดนั้นใหม่'

type SequenceKeyFields = { sequenceId?: string; sequenceIndex?: number }

/**
 * รหัสชุดของจุด: งานรับ-ส่ง = "tf:<transferId>" · งานต่อเนื่อง = "sq:<sequenceId>" · งานปกติ = null
 * เช็กงานต่อเนื่องตรงนี้เอง (ไม่ import lib/sequence — ไฟล์นั้น import ไฟล์นี้) ต้องตรงกับ isSequenceStop
 */
export function stopSetKey(stop: (TransferFields & SequenceKeyFields) | null | undefined): string | null {
  if (!stop) return null
  if (isTransferStop(stop)) return `tf:${stop.transferId}`
  if (typeof stop.sequenceId === 'string' && stop.sequenceId !== '' && Number.isInteger(stop.sequenceIndex) && (stop.sequenceIndex as number) >= 0) return `sq:${stop.sequenceId}`
  return null
}

type SetStop = TransferFields & SequenceKeyFields & {
  siteName?: string
  outcome?: string | null
  assistForPlate?: string
  postponedRequestId?: string
  postponedToDate?: string
  reassignedToVehiclePlate?: string
}

/** ชื่อจุดพร้อมบทบาท เช่น "วังโค (จุดรับ)" / "ไซต์A (จุดที่ 3)" — ใช้ในหน้าต่าง/toast ของทำทั้งชุด (เรียกด้วยชื่อ ไม่ใช้เลขข้อ เพราะเลขบนจอ ≠ index ที่บันทึก) */
export function transferStopName(stop: SetStop | null | undefined): string {
  const role = stop?.transferRole === 'pickup' ? 'จุดรับ' : stop?.transferRole === 'drop' ? 'จุดส่ง' : ''
  const sequenceNo = !role && stopSetKey(stop)?.startsWith('sq:') ? `จุดที่ ${(stop!.sequenceIndex as number) + 1}` : ''
  const name = (stop?.siteName || '').trim() || role || 'จุดงาน'
  return role || sequenceNo ? `${name} (${role || sequenceNo})` : name
}

/**
 * จุดของเที่ยวนี้ (index ที่บันทึก เรียงตาม stops) ที่อยู่ชุดเดียวกับจุดที่ `index` และยังไปกับเที่ยวนี้ — รวมจุดที่กดเอง
 * [] = ใช้ปุ่มทีละจุดเหมือนเดิม: ไม่ใช่ชุดงาน / จุดที่กดไม่ทำแล้ว / จุดที่กดเป็นสำเนาคันช่วย
 *      / จุดในชุดมี postponedRequestId ค้าง (ทางทีละจุดปลดใบวันใหม่ให้ถูก ส่วนทำทั้งชุดไม่ส่ง supersede)
 * ไม่นับสำเนาคันช่วย (assistForPlate — งานจริงอยู่คันต้นทาง) · รับแค่ trip.stops ไม่รวมงานโยกเข้า · ได้ 1 ตัว = ไม่มีจุดคู่ (ไม่ถามทั้งชุด)
 */
export function activeTransferSet(stops: readonly SetStop[], index: number): number[] {
  const stop = stops[index]
  const key = stopSetKey(stop)
  if (!stop || !key || isInactiveStop(stop) || stop.assistForPlate) return []
  const set = stops.flatMap((s, i) => (stopSetKey(s) === key && !isInactiveStop(s) && !s.assistForPlate ? [i] : []))
  return set.some(i => stops[i].postponedRequestId) ? [] : set
}

type OtherTrip = { vehiclePlate?: string; driverName?: string; actualDriverName?: string; stops?: readonly SetStop[] }

/**
 * จุดของกลุ่มเดียวกันที่ "ทำทั้งชุด" ไม่แตะ พร้อมเหตุผลภาษาคน — ไม่งั้นคนจัดรถนึกว่าทั้งงานจัดการครบแล้ว
 * stops = จุดของเที่ยวนี้ · incoming = งานที่คันอื่นโยกเข้ามา · others = ทริปอื่นของวันเดียวกันที่โหลดไว้แล้ว (หาจุดของกลุ่มบนคันอื่น + สำเนาคันช่วยของเที่ยวนี้ ไม่อ่านฐานเพิ่ม)
 * plate = ทะเบียนของเที่ยวนี้ (สำเนาคันช่วยเก็บทะเบียนคันต้นทางไว้ที่ assistForPlate)
 */
export function transferSetOutside(
  stops: readonly SetStop[],
  index: number,
  incoming: readonly (SetStop & { fromVehiclePlate?: string; fromDriverName?: string })[],
  others: readonly OtherTrip[],
  plate: string,
): string[] {
  const stop = stops[index]
  const key = stopSetKey(stop)
  if (!stop || !key) return []
  const mate = (s: SetStop) => stopSetKey(s) === key
  const inSet = new Set(activeTransferSet(stops, index))
  const lines: string[] = []
  stops.forEach((s, i) => {
    if (i === index || inSet.has(i) || !mate(s)) return
    const name = transferStopName(s)
    if (s.assistForPlate) lines.push(`${name} — สำเนาคันช่วยจากรถ ${s.assistForPlate} ไม่ถูกทำตาม (จัดการเองที่จุดนั้น)`)
    else if (s.outcome === 'postponed') lines.push(`${name} — เลื่อน${s.postponedToDate ? `ไปวันที่ ${dayText(s.postponedToDate)} ` : 'วัน'}แล้ว`)
    else if (s.outcome === 'reassigned') lines.push(`${name} — โยกไป${s.reassignedToVehiclePlate ? `รถ ${s.reassignedToVehiclePlate} ` : 'คันอื่น'}แล้ว`)
    else if (s.outcome === 'driver-refused') lines.push(`${name} — คนขับปฏิเสธแล้ว${s.reassignedToVehiclePlate ? ` (รถ ${s.reassignedToVehiclePlate} รับไปทำแทน)` : ''}`)
    else lines.push(`${name} — ไม่ถูกทำตาม (จัดการทีละจุด)`)
  })
  for (const job of incoming) {
    if (!mate(job)) continue
    const from = [job.fromVehiclePlate, job.fromDriverName ? `(${job.fromDriverName})` : ''].filter(Boolean).join(' ')
    lines.push(`${transferStopName(job)} — โยกมาจาก${from ? ` ${from}` : 'คันอื่น'} · ${TRANSFER_EDIT_AT_SOURCE}`)
  }
  // ทริปอื่น: จุดจริงของกลุ่มที่จัดไว้คันอื่นตั้งแต่ตอนจัดกลุ่ม + สำเนาคันช่วยของเที่ยวนี้ (ไม่รู้ทะเบียนของเที่ยวนี้ = ไม่เดาสำเนา)
  // จุดที่ไม่ทำแล้วไม่ขึ้น — รวมจุดที่โยกเข้าคันนี้ (outcome reassigned/driver-refused) ซึ่งขึ้นในลิสต์งานโยกเข้าแล้ว · สำเนาคันช่วยของคันอื่นไม่ขึ้น (งานจริงอยู่คันต้นทาง)
  for (const other of others) {
    for (const s of other.stops || []) {
      if (!mate(s) || isInactiveStop(s)) continue
      const driver = other.actualDriverName || other.driverName || ''
      const where = `รถ ${other.vehiclePlate || ''}${driver ? ` (${driver})` : ''}`
      if (!s.assistForPlate) lines.push(`${transferStopName(s)} — อยู่บน${where} ไม่ถูกทำตาม — จัดการเองที่คันนั้น`)
      else if (plate && s.assistForPlate === plate) lines.push(`${transferStopName(s)} — สำเนาคันช่วยบน${where} ไม่ถูกทำตาม — ไปแก้/ลบเองที่คันนั้น`)
    }
  }
  return lines
}

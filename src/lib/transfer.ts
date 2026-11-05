/**
 * งาน "รับของไปส่งต่อ" (ผู้ใช้ขอ 2026-11-05) — ใบขอเดียวมีจุดรับของ (pickup) 1 จุดขึ้นไป + จุดส่ง (drop) 1 จุดท้ายใบ
 * เดิมผู้ขอต้องทำ 2 ใบ (ใบรับ + ใบส่ง) → ถูกจัดคนละคัน / ลำดับในใบงานส่งก่อนรับ / จุดส่งไม่ได้ปักหมุด
 *
 * จุดในกลุ่มผูกกันด้วย transferId (ไม่ใช้ index — ถอนคันคู่/โยกงานทำให้ index เลื่อน และจุดในทริปไม่มี backlink ไปใบขอ)
 * ห้ามตั้งชื่อฟิลด์ว่า `pickup` เฉย ๆ — หน้าติดตามรถใช้ `pickup` คนละความหมาย (ทริปกลับอย่างเดียว)
 * ใบเก่า/ใบปกติไม่มีฟิลด์เหล่านี้ = ทำงานเหมือนเดิมทุกอย่าง
 */
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

/** รายละเอียดงานของจุดส่ง เขียนให้อัตโนมัติจากของที่รับแต่ละจุด (ผู้ขอไม่ต้องพิมพ์ซ้ำ) + งานอื่นที่จุดส่ง (ถ้ามี) */
export function buildDropDescription(pickups: readonly { name: string; items: string }[], extra: string): string {
  const lines = pickups.map(p => `ส่งของที่รับจาก ${p.name.trim() || 'จุดรับ'}: ${p.items.trim()}`)
  if (extra.trim()) lines.push(extra.trim())
  return lines.join('\n')
}

type Place = { siteId?: string | null; lat?: number | null; lng?: number | null }

/** จุดอยู่ที่เดียวกัน (ไซต์เดียวกัน หรือพิกัดตรงกัน) — ใช้ตอนย้ายจุดส่ง ไม่ให้แทรกกลางงานที่ทำในที่เดียวกัน */
function samePlace(a: Place, b: Place): boolean {
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

/** คำเตือนของป้าย — ใช้ค่าคงที่นี้เทียบเสมอ (ห้ามเทียบข้อความตรง ๆ ที่อื่น) */
export const TRANSFER_WARNING = {
  dropMissing: 'จุดส่งไม่อยู่ในเที่ยวนี้',
  pickupMissing: 'จุดรับไม่อยู่ในเที่ยวนี้',
  dropBeforePickup: 'จุดส่งอยู่ก่อนจุดรับ — ตรวจลำดับ',
  pickupAfterDrop: 'จุดรับอยู่หลังจุดส่ง — ตรวจลำดับ',
} as const

type Peer = TransferFields & { siteName?: string; outcome?: string }

/** จุดที่โยกไปคันอื่น / เลื่อนวัน / ไม่ได้ทำ (outcome อื่นที่ไม่ใช่ส่งแล้ว) — ยังอยู่ในลิสต์ของทริปเดิม แต่ของไม่ได้ไปกับคันนี้ */
const inactive = (p: Peer) => !!p.outcome && p.outcome !== 'delivered'

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
    .filter(({ peer, i }) => i !== index && isTransferStop(peer) && peer.transferId === stop.transferId && !inactive(peer))
  const quiet = inactive(stop)

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
  const awayNames = [...new Set(groupPickups.filter(inactive).map(p => {
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
    const drop = slots.findIndex(s => isTransferStop(s.stop) && s.stop.transferRole === 'drop' && s.stop.transferId === job.transferId && !inactive(s.stop))
    if (drop === -1 || drop > at) return
    const [slot] = slots.splice(at, 1)
    slots.splice(drop, 0, slot) // drop อยู่ก่อน at → ตัด at ออกแล้วตำแหน่ง drop ไม่เลื่อน = วางหน้าจุดส่งพอดี
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
    .filter((peer, i) => i !== index && isTransferStop(peer) && peer.transferId === stop.transferId && peer.transferRole === want && !inactive(peer))
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

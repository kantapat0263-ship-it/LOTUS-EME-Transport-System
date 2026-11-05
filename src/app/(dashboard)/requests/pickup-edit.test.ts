import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { COORDINATE_EXAMPLE, parseThaiCoordinates } from '@/lib/requestCoordinates'
import { applyPickupItemsEdit, buildDropDescription, isTransferStop, pickupEditMessage } from '@/lib/transfer'

// หน้าคำขอ: แก้ของที่จุดรับ แล้วจุดส่งในใบเดียวกันแก้ตาม — คอมไพล์โค้ดจริงของหน้า (ไม่บูต Firebase) แล้วส่งของปลอมเข้าไป
const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const compile = (code: string) => ts.transpileModule(`const work = ${code};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function declaration(name: string) {
  let value: ts.Expression | undefined
  function find(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) value = node.initializer
    ts.forEachChild(node, find)
  }
  find(source)
  if (!value) throw new Error(`${name} missing`)
  return compile(value.getText(source))
}
/** ค่าของ attribute `attr` ใน JSX ที่มีข้อความ `mustInclude` — ต้องเจอตัวเดียวพอดี */
function jsxAttribute(attr: string, mustInclude: string) {
  const found: ts.Expression[] = []
  function find(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === attr && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && node.initializer.expression.getText(source).includes(mustInclude)) found.push(node.initializer.expression)
    ts.forEachChild(node, find)
  }
  find(source)
  if (found.length !== 1) throw new Error(`${attr} (${mustInclude}): found ${found.length}`)
  return compile(found[0].getText(source))
}

const dropText = buildDropDescription([{ name: 'ดูโฮม', items: 'ปูน 10 ถุง' }, { name: 'วานิช', items: 'ยางมะตอย' }], 'ท่อ EMT จากออฟฟิศ')
const request = (extra: Record<string, unknown> = {}) => ({
  id: 'VR-1', requestId: 'VR-1', status: 'in_progress', assignedDestinations: [] as number[],
  destinations: [
    { siteName: 'ดูโฮม', jobDescription: 'ปูน 10 ถุง', transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ดอนเมือง' },
    { siteName: 'วานิช', jobDescription: 'ยางมะตอย', transferRole: 'pickup', transferId: 'tf_1', transferDropName: 'ดอนเมือง' },
    { siteName: 'ดอนเมือง', jobDescription: dropText, transferRole: 'drop', transferId: 'tf_1' },
  ],
  ...extra,
})

/** savePickupItems ตัวจริง · fresh = ใบในฐานตอนธุรกรรมอ่าน (อาจต่างจาก selectedReq บนจอ) */
function savePickupItems(selectedReq: any, fresh: any) {
  const tx = { get: vi.fn(async () => ({ exists: () => !!fresh, data: () => fresh })), update: vi.fn() }
  const toast = vi.fn()
  const runTransaction = vi.fn(async (_db: unknown, fn: (t: typeof tx) => unknown) => fn(tx))
  const work = new Function('selectedReq', 'isStaff', 'doc', 'db', 'runTransaction', 'applyPickupItemsEdit', 'serverTimestamp', 'pickupEditMessage', 'toast', `${declaration('savePickupItems')}return work`)(
    selectedReq, true, (_db: unknown, ...path: string[]) => path.join('/'), {}, runTransaction, applyPickupItemsEdit, () => 'ts', pickupEditMessage, toast,
  ) as (index: number, before: any, items: string) => Promise<void>
  return { work, tx, toast }
}

describe('หน้าคำขอ — savePickupItems (แก้ของที่จุดรับ)', () => {
  it('ซิงก์บรรทัดของจุดส่งในธุรกรรมเดียว · งานอื่นในจุดส่งคงเดิม · toast บอกชื่อจุดส่ง', async () => {
    const req = request()
    const { work, tx, toast } = savePickupItems(req, request())
    await work(0, req.destinations[0], 'ปูน 15 ถุง')
    expect(tx.update).toHaveBeenCalledOnce()
    const [ref, patch] = tx.update.mock.calls[0] as unknown as [string, any]
    expect(ref).toBe('vehicleRequests/VR-1')
    expect(patch.updatedAt).toBe('ts')
    expect(patch.destinations.map((d: any) => d.jobDescription)).toEqual(['ปูน 15 ถุง', 'ยางมะตอย', 'ส่งของที่รับจาก ดูโฮม: ปูน 15 ถุง\nส่งของที่รับจาก วานิช: ยางมะตอย\nท่อ EMT จากออฟฟิศ'])
    expect(toast).toHaveBeenCalledWith({ title: 'บันทึกรายละเอียดงานแล้ว', description: 'อัปเดตรายการของที่จุดส่ง ดอนเมือง ให้ตามแล้ว' })
  })

  it('ใช้ข้อมูลสดในธุรกรรม ไม่ใช่ข้อมูลค้างบนจอ (จุดส่งเพิ่งมีบรรทัดเพิ่มจากอีกเครื่อง)', async () => {
    const screen = request()
    const fresh = request()
    fresh.destinations[2] = { ...fresh.destinations[2], jobDescription: `${dropText}\nโทรหาโฟร์แมนก่อนถึง` }
    const { work, tx } = savePickupItems(screen, fresh)
    await work(0, screen.destinations[0], 'ปูน 15 ถุง')
    const patch = tx.update.mock.calls[0][1] as any
    expect(patch.destinations[2].jobDescription).toBe('ส่งของที่รับจาก ดูโฮม: ปูน 15 ถุง\nส่งของที่รับจาก วานิช: ยางมะตอย\nท่อ EMT จากออฟฟิศ\nโทรหาโฟร์แมนก่อนถึง')
  })

  it('จุดนี้ถูกแก้จากอีกเครื่องหลังเปิดหน้าต่าง → ไม่เขียน และแจ้งให้เปิดใบใหม่', async () => {
    const screen = request()
    const fresh = request()
    fresh.destinations[0] = { ...fresh.destinations[0], jobDescription: 'ปูน 12 ถุง' }
    const { work, tx, toast } = savePickupItems(screen, fresh)
    await work(0, screen.destinations[0], 'ปูน 15 ถุง')
    expect(tx.update).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith({ title: 'บันทึกไม่สำเร็จ', description: 'รายละเอียดจุดนี้เพิ่งถูกแก้จากอีกเครื่อง — ปิดแล้วเปิดใบนี้ใหม่ แล้วแก้อีกครั้ง', variant: 'destructive' })
  })

  it('จุดส่งจัดเข้าเที่ยวแล้ว → บันทึกจุดรับอย่างเดียว · toast สีแดงบอกให้ไปแก้ในเที่ยว', async () => {
    const req = request({ assignedDestinations: [2] })
    const { work, tx, toast } = savePickupItems(req, request({ assignedDestinations: [2] }))
    await work(0, req.destinations[0], 'ปูน 15 ถุง')
    const patch = tx.update.mock.calls[0][1] as any
    expect(patch.destinations[2].jobDescription).toBe(dropText)
    expect(patch.destinations[0].jobDescription).toBe('ปูน 15 ถุง')
    const shown = toast.mock.calls[0][0]
    expect(shown.variant).toBe('destructive')
    expect(shown.description).toContain('จุดส่ง ดอนเมือง จัดเข้าเที่ยวแล้ว')
  })
})

const normalRequest = () => ({
  id: 'VR-2', requestId: 'VR-2', status: 'in_progress', assignedDestinations: [] as number[],
  destinations: [{ siteName: 'ไซต์ A', jobDescription: 'งาน A', requestTime: '08:30' }, { siteName: 'ไซต์ B', jobDescription: 'งาน B', requestTime: '08:30' }],
})
const isTransferReqOf = (req: any) => new Function('selectedReq', 'isTransferStop', `${declaration('isTransferReq')}return work`)(req, isTransferStop) as boolean

/** saveTransferDestination ตัวจริง (ใบรับ-ส่ง: ช่องอื่นอ่านใบสดแล้วแก้เฉพาะจุดนั้น) · fresh = ใบในฐานตอนธุรกรรมอ่าน */
function saveTransferDestination(selectedReq: any, fresh: any) {
  const tx = { get: vi.fn(async () => ({ exists: () => !!fresh, data: () => fresh })), update: vi.fn() }
  const toast = vi.fn()
  const runTransaction = vi.fn(async (_db: unknown, fn: (t: typeof tx) => unknown) => fn(tx))
  const work = new Function('selectedReq', 'doc', 'db', 'runTransaction', 'serverTimestamp', 'toast', `${declaration('saveTransferDestination')}return work`)(
    selectedReq, (_db: unknown, ...path: string[]) => path.join('/'), {}, runTransaction, () => 'ts', toast,
  ) as (index: number, patch: Record<string, unknown>, before: Record<string, unknown>, doneTitle?: string) => Promise<boolean>
  return { work, tx, toast }
}

/** จอยังเป็นของก่อนแก้จุดรับ แต่ในฐานธุรกรรมของจุดรับบันทึกแล้ว (จุดรับ 15 ถุง + บรรทัดจุดส่งซิงก์แล้ว) — runTransaction ไม่ขึ้นจอทันที */
const afterPickupSave = () => {
  const fresh = request()
  fresh.destinations[0] = { ...fresh.destinations[0], jobDescription: 'ปูน 15 ถุง' }
  fresh.destinations[2] = { ...fresh.destinations[2], jobDescription: dropText.replace('ปูน 10 ถุง', 'ปูน 15 ถุง') }
  return fresh
}

describe('หน้าคำขอ — saveTransferDestination (ช่องอื่นของใบรับ-ส่ง)', () => {
  it('อ่านใบสดแล้วแก้เฉพาะจุดนั้น → ผลของจุดรับที่เพิ่งบันทึก (จอยังไม่อัปเดต) ไม่ถูกทับ', async () => {
    const { work, tx, toast } = saveTransferDestination(request(), afterPickupSave())
    expect(await work(2, { requestTime: '09:00' }, { siteName: 'ดอนเมือง' }, 'อัปเดตเวลาสำเร็จ')).toBe(true)
    const [ref, patch] = tx.update.mock.calls[0] as unknown as [string, any]
    expect(ref).toBe('vehicleRequests/VR-1')
    expect(patch.updatedAt).toBe('ts')
    expect(patch.destinations).toEqual(afterPickupSave().destinations.map((d: any, i: number) => (i === 2 ? { ...d, requestTime: '09:00' } : d)))
    expect(toast).toHaveBeenCalledWith({ title: 'อัปเดตเวลาสำเร็จ' })
  })

  it('ข้อความบนจอไม่ตรงกับในใบแล้ว (จุดส่งเพิ่งซิงก์) / จุดที่ index นั้นไม่ใช่จุดเดิม → ไม่เขียน toast สีแดง คืน false', async () => {
    const screen = request()
    const stale = saveTransferDestination(screen, afterPickupSave())
    expect(await stale.work(2, { jobDescription: `${dropText}\nเพิ่ม` }, { siteName: 'ดอนเมือง', jobDescription: screen.destinations[2].jobDescription }, 'บันทึกรายละเอียดงานแล้ว')).toBe(false)
    expect(stale.tx.update).not.toHaveBeenCalled()
    expect(stale.toast).toHaveBeenCalledWith({ title: 'บันทึกไม่สำเร็จ', description: 'จุดนี้เพิ่งถูกแก้ (เช่น จุดส่งเพิ่งแก้ตามจุดรับ) — รอให้ช่องแสดงข้อมูลล่าสุด แล้วแก้อีกครั้ง', variant: 'destructive' })
    const moved = saveTransferDestination(screen, request())
    expect(await moved.work(1, { requestTime: '09:00' }, { siteName: 'ดูโฮม' })).toBe(false)
    expect(moved.tx.update).not.toHaveBeenCalled()
  })

  it('isTransferReq = ใบที่มีจุดรับ-ส่งอย่างน้อย 1 จุด (รวมจุดปกติในใบเดียวกัน) · ใบปกติ = false', () => {
    expect(isTransferReqOf(request())).toBe(true)
    expect(isTransferReqOf(normalRequest())).toBe(false)
    expect(isTransferReqOf(null)).toBe(false)
  })
})

describe('หน้าคำขอ — ช่อง "รายละเอียดงาน" (onBlur / key)', () => {
  const onBlur = jsxAttribute('onBlur', 'savePickupItems(idx')
  /** idx ตรงกับ dest ใน req จริง (เดิม indexOf ข้าม object คนละตัว → ได้ 0 ทุกเคส) */
  function blur(req: any, idx: number, value: string, saveTransfer: (...args: any[]) => Promise<boolean> = vi.fn(async () => true)) {
    const updateDoc = vi.fn(async () => {})
    const toast = vi.fn()
    const save = vi.fn(async () => {})
    const dest = req.destinations[idx]
    const work = new Function('selectedReq', 'updateDoc', 'doc', 'db', 'serverTimestamp', 'toast', 'idx', 'dest', 'isTransferStop', 'savePickupItems', 'isTransferReq', 'saveTransferDestination', `${onBlur}return work`)(
      req, updateDoc, (_db: unknown, ...path: string[]) => path.join('/'), {}, () => 'ts', toast, idx, dest, isTransferStop, save, isTransferReqOf(req), saveTransfer,
    ) as (e: { target: { value: string } }) => Promise<void>
    return { run: () => work({ target: { value } }), updateDoc, save, saveTransfer, toast, dest }
  }

  it('จุดรับของใบรับ-ส่ง → ไปทาง savePickupItems ด้วย index ของจุดนั้น (ไม่ใช้ updateDoc จากข้อมูลบนจอ)', async () => {
    for (const idx of [0, 1]) {
      const h = blur(request(), idx, 'ของใหม่')
      await h.run()
      expect(h.save).toHaveBeenCalledWith(idx, h.dest, 'ของใหม่')
      expect(h.updateDoc).not.toHaveBeenCalled()
      expect(h.saveTransfer).not.toHaveBeenCalled()
    }
  })

  it('จุดส่งของใบรับ-ส่ง → อ่านใบสดแล้วแก้เฉพาะจุดนี้ (เทียบข้อความบนจอ) ไม่ใช้ updateDoc ทั้งก้อน', async () => {
    const h = blur(request(), 2, 'ข้อความใหม่')
    await h.run()
    expect(h.saveTransfer).toHaveBeenCalledWith(2, { jobDescription: 'ข้อความใหม่' }, { siteName: 'ดอนเมือง', jobDescription: dropText }, 'บันทึกรายละเอียดงานแล้ว')
    expect(h.updateDoc).not.toHaveBeenCalled()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('แก้จุดส่งก่อน snapshot ของจุดรับจะมาถึง → ไม่เขียนข้อความเก่าทับบรรทัดที่เพิ่งซิงก์ (ผลตรวจ drop-sync ข้อ 2)', async () => {
    const screen = request()
    const real = saveTransferDestination(screen, afterPickupSave())
    const h = blur(screen, 2, `${dropText}\nโทรก่อนถึง`, real.work)
    await h.run()
    expect(h.updateDoc).not.toHaveBeenCalled()
    expect(real.tx.update).not.toHaveBeenCalled()
    expect(real.toast.mock.calls[0][0].variant).toBe('destructive')
  })

  it('ใบปกติ → ทางเดิม (updateDoc เขียนจุดที่ idx + toast เดิม) · ข้อความไม่เปลี่ยน = ไม่ทำอะไร', async () => {
    const h = blur(normalRequest(), 1, 'ข้อความใหม่')
    await h.run()
    expect(h.save).not.toHaveBeenCalled()
    expect(h.saveTransfer).not.toHaveBeenCalled()
    expect(h.updateDoc).toHaveBeenCalledOnce()
    const [ref, patch] = h.updateDoc.mock.calls[0] as unknown as [string, any]
    expect(ref).toBe('vehicleRequests/VR-2')
    expect(patch).toEqual({ destinations: [normalRequest().destinations[0], { ...normalRequest().destinations[1], jobDescription: 'ข้อความใหม่' }], updatedAt: 'ts' })
    expect(h.toast).toHaveBeenCalledWith({ title: 'บันทึกรายละเอียดงานแล้ว' })
    const same = blur(request(), 0, 'ปูน 10 ถุง')
    await same.run()
    expect(same.save).not.toHaveBeenCalled()
    expect(same.updateDoc).not.toHaveBeenCalled()
    expect(same.saveTransfer).not.toHaveBeenCalled()
  })

  it('key ของช่อง: ใบรับ-ส่งเปลี่ยนตามข้อความ (ช่องจุดส่งโหลดข้อความที่ซิงก์ใหม่) · ใบปกติไม่มี key เหมือนเดิม', () => {
    const key = (dest: any, idx: number) => new Function('isTransferStop', 'dest', 'idx', `${jsxAttribute('key', 'jd-')}return work`)(isTransferStop, dest, idx)
    const drop = request().destinations[2]
    expect(key(drop, 2)).toBe(`jd-2-${dropText}`)
    expect(key({ ...drop, jobDescription: 'ใหม่' }, 2)).not.toBe(key(drop, 2))
    expect(key({ siteName: 'ไซต์ A', jobDescription: 'งาน A' }, 0)).toBeUndefined()
  })
})

describe('หน้าคำขอ — ช่องเวลา / บันทึกพิกัด ของใบรับ-ส่ง (ผลตรวจ drop-sync ข้อ 2)', () => {
  const timeBlur = jsxAttribute('onBlur', 'requestTime: newTime')
  function blurTime(req: any, idx: number, value: string, saveTransfer: (...args: any[]) => Promise<boolean> = vi.fn(async () => true)) {
    const updateDoc = vi.fn(async () => {})
    const toast = vi.fn()
    const work = new Function('selectedReq', 'updateDoc', 'doc', 'db', 'serverTimestamp', 'toast', 'idx', 'dest', 'isTransferReq', 'saveTransferDestination', `${timeBlur}return work`)(
      req, updateDoc, (_db: unknown, ...path: string[]) => path.join('/'), {}, () => 'ts', toast, idx, req.destinations[idx], isTransferReqOf(req), saveTransfer,
    ) as (e: { target: { value: string } }) => Promise<void>
    return { run: () => work({ target: { value } }), updateDoc, saveTransfer, toast }
  }

  it('แก้เวลาจุดส่งก่อน snapshot ของจุดรับจะมาถึง → เขียนเฉพาะเวลาบนใบสด จุดรับ/บรรทัดจุดส่งที่ซิงก์แล้วยังอยู่', async () => {
    const screen = request()
    const real = saveTransferDestination(screen, afterPickupSave())
    const h = blurTime(screen, 2, '09:00', real.work)
    await h.run()
    expect(h.updateDoc).not.toHaveBeenCalled()
    const patch = real.tx.update.mock.calls[0][1] as any
    expect(patch.destinations.map((d: any) => d.jobDescription)).toEqual(afterPickupSave().destinations.map((d: any) => d.jobDescription))
    expect(patch.destinations[2].requestTime).toBe('09:00')
    expect(real.toast).toHaveBeenCalledWith({ title: 'อัปเดตเวลาสำเร็จ' })
  })

  it('ใบปกติ → ทางเดิม (updateDoc ทั้งก้อน + toast เดิม) · เวลาไม่เปลี่ยน = ไม่ทำอะไร', async () => {
    const h = blurTime(normalRequest(), 1, '09:00')
    await h.run()
    expect(h.saveTransfer).not.toHaveBeenCalled()
    expect(h.updateDoc).toHaveBeenCalledWith('vehicleRequests/VR-2', { destinations: [normalRequest().destinations[0], { ...normalRequest().destinations[1], requestTime: '09:00' }], updatedAt: 'ts' })
    expect(h.toast).toHaveBeenCalledWith({ title: 'อัปเดตเวลาสำเร็จ' })
    const timed: any = request()
    timed.destinations[2] = { ...timed.destinations[2], requestTime: '08:30' }
    const same = blurTime(timed, 2, '08:30')
    await same.run()
    expect(same.saveTransfer).not.toHaveBeenCalled()
    expect(same.updateDoc).not.toHaveBeenCalled()
  })

  function saveCoords(req: any, saveTransfer: (...args: any[]) => Promise<boolean>) {
    const updateDoc = vi.fn(async () => {})
    const toast = vi.fn()
    const setEditingCoords = vi.fn()
    const work = new Function('selectedReq', 'editingCoords', 'toast', 'parseThaiCoordinates', 'COORDINATE_EXAMPLE', 'isTransferReq', 'saveTransferDestination', 'updateDoc', 'doc', 'db', 'serverTimestamp', 'getDocs', 'query', 'collection', 'where', 'setDoc', 'setEditingCoords', `${declaration('handleSaveCoordinates')}return work`)(
      req, { 2: '13.9, 100.6' }, toast, parseThaiCoordinates, COORDINATE_EXAMPLE, isTransferReqOf(req), saveTransfer, updateDoc, (_db: unknown, ...path: string[]) => path.join('/'), {}, () => 'ts',
      vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), setEditingCoords,
    ) as (destIndex: number) => Promise<void>
    return { work, updateDoc, toast, setEditingCoords }
  }

  it('บันทึกพิกัดใบรับ-ส่ง → อ่านใบสดแล้วแก้เฉพาะพิกัดจุดนี้ · ไม่ผ่าน = ไม่ขึ้น "บันทึกพิกัดสำเร็จ" และช่องพิกัดยังอยู่', async () => {
    const ok = vi.fn(async () => true)
    const saved = saveCoords(request(), ok)
    await saved.work(2)
    expect(ok).toHaveBeenCalledWith(2, { lat: 13.9, lng: 100.6 }, { siteName: 'ดอนเมือง' })
    expect(saved.updateDoc).not.toHaveBeenCalled()
    expect(saved.toast).toHaveBeenCalledWith({ title: 'บันทึกพิกัดสำเร็จ', description: 'อัพเดทพิกัดจุดที่ 3 แล้ว' })
    expect(saved.setEditingCoords).toHaveBeenCalledOnce()
    const refused = saveCoords(request(), vi.fn(async () => false))
    await refused.work(2)
    expect(refused.updateDoc).not.toHaveBeenCalled()
    expect(refused.toast).not.toHaveBeenCalled()
    expect(refused.setEditingCoords).not.toHaveBeenCalled()
  })
})

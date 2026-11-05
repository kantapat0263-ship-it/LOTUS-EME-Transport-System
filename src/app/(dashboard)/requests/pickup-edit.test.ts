import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
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

describe('หน้าคำขอ — ช่อง "รายละเอียดงาน" (onBlur / key)', () => {
  const onBlur = jsxAttribute('onBlur', 'savePickupItems(idx')
  function blur(dest: any, value: string) {
    const updateDoc = vi.fn(async () => {})
    const toast = vi.fn()
    const save = vi.fn(async () => {})
    const req = request()
    const work = new Function('selectedReq', 'updateDoc', 'doc', 'db', 'serverTimestamp', 'toast', 'idx', 'dest', 'isTransferStop', 'savePickupItems', `${onBlur}return work`)(
      req, updateDoc, (_db: unknown, ...path: string[]) => path.join('/'), {}, () => 'ts', toast, req.destinations.indexOf(dest) === -1 ? 0 : req.destinations.indexOf(dest), dest, isTransferStop, save,
    ) as (e: { target: { value: string } }) => Promise<void>
    return { run: () => work({ target: { value } }), updateDoc, save, toast }
  }

  it('จุดรับของใบรับ-ส่ง → ไปทาง savePickupItems (ไม่ใช้ updateDoc จากข้อมูลบนจอ)', async () => {
    const dest = request().destinations[0]
    const h = blur(dest, 'ปูน 15 ถุง')
    await h.run()
    expect(h.save).toHaveBeenCalledWith(0, dest, 'ปูน 15 ถุง')
    expect(h.updateDoc).not.toHaveBeenCalled()
  })

  it('จุดส่ง / ใบปกติ → ทางเดิม (updateDoc + toast เดิม) · ข้อความไม่เปลี่ยน = ไม่ทำอะไร', async () => {
    for (const dest of [request().destinations[2], { siteName: 'ไซต์ A', jobDescription: 'งาน A' }]) {
      const h = blur(dest, 'ข้อความใหม่')
      await h.run()
      expect(h.save).not.toHaveBeenCalled()
      expect(h.updateDoc).toHaveBeenCalledOnce()
      expect(h.toast).toHaveBeenCalledWith({ title: 'บันทึกรายละเอียดงานแล้ว' })
    }
    const same = blur(request().destinations[0], 'ปูน 10 ถุง')
    await same.run()
    expect(same.save).not.toHaveBeenCalled()
    expect(same.updateDoc).not.toHaveBeenCalled()
  })

  it('key ของช่อง: ใบรับ-ส่งเปลี่ยนตามข้อความ (ช่องจุดส่งโหลดข้อความที่ซิงก์ใหม่) · ใบปกติไม่มี key เหมือนเดิม', () => {
    const key = (dest: any, idx: number) => new Function('isTransferStop', 'dest', 'idx', `${jsxAttribute('key', 'jd-')}return work`)(isTransferStop, dest, idx)
    const drop = request().destinations[2]
    expect(key(drop, 2)).toBe(`jd-2-${dropText}`)
    expect(key({ ...drop, jobDescription: 'ใหม่' }, 2)).not.toBe(key(drop, 2))
    expect(key({ siteName: 'ไซต์ A', jobDescription: 'งาน A' }, 0)).toBeUndefined()
  })
})

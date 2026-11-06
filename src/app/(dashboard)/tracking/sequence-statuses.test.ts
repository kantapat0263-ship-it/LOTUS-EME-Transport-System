import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'

// หน้าติดตามรถต้องส่งรหัสชุด/ลำดับ/ผลของจุดให้ computeStopStatuses — ไม่งั้นจุดที่กลับมาที่เดิม (งานต่อเนื่อง) ถูกติ๊ก "ถึง" ตั้งแต่รอบแรก
// (ผลตรวจ: เคยตัดเหลือ order/lat/lng ทั้งที่ routeStops มีฟิลด์ครบ)
it('หน้าติดตามรถส่ง sequenceId/sequenceIndex/outcome ของทุกจุดให้ตัวคิด "ถึงแล้ว"', () => {
  const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let arg: ts.Expression | undefined
  const find = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'computeStopStatuses') arg = node.arguments[0]
    ts.forEachChild(node, find)
  }
  find(source)
  if (!arg) throw new Error('computeStopStatuses call missing')
  const compiled = ts.transpileModule(`const work = (routeStops) => ${arg.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const mapStops = new Function(`${compiled}return work`)() as (r: object[]) => object[]
  const route = [{ order: 2, siteName: 'ไซต์', lat: 13.7, lng: 100.7, sequenceId: 'sq_1', sequenceIndex: 2, outcome: 'delivered' }]
  expect(mapStops(route)).toEqual([{ order: 2, lat: 13.7, lng: 100.7, sequenceId: 'sq_1', sequenceIndex: 2, outcome: 'delivered' }])
})

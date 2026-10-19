import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { inThailand } from '@/lib/roadFlood'

const text = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const source = ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function actual(name: string) {
  let value: ts.Expression | undefined
  function find(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) value = node.initializer
    ts.forEachChild(node, find)
  }
  find(source)
  if (!value) throw new Error(`Actual ${name} missing`)
  const code = ts.transpileModule(`const work = ${value.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('inThailand', `${code}return work`)(inThailand)
}

it('พิกัดจากใบขอลงงานในทริป: ในไทยคัดลอก · (0,0) = ไม่มีพิกัด / นอกไทย / ไม่มีค่า = ไม่ใส่ lat/lng', () => {
  const stopCoords = actual('stopCoords')
  expect(stopCoords({ lat: 14.2, lng: 100.62 })).toEqual({ lat: 14.2, lng: 100.62 })
  for (const bad of [{ lat: 0, lng: 0 }, { lat: 35.68, lng: 139.69 }, {}, { lat: null, lng: null }, { lat: NaN, lng: 100 }]) {
    expect(stopCoords(bad)).toEqual({})
  }
})

it('ทุกจุดที่สร้างงานในทริปจากใบขอ ใช้ stopCoords (ไม่คัดลอก lat/lng ตรง ๆ)', () => {
  expect(text.match(/\.\.\.stopCoords\(/g)?.length).toBe(3)
  expect(text).not.toMatch(/lat: d\.lat,/)
  expect(text).not.toMatch(/fresh\.lat != null/)
})

import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'
it('keeps the private weekly panel outside the JPEG export element', () => {
  const source = ts.createSourceFile('report.tsx', readFileSync('src/app/(dashboard)/report/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let panels = 0, panelsInExport = 0
  function visit(node: ts.Node, inExport = false) {
    if (ts.isJsxElement(node)) inExport ||= node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'id' && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === 'report-content')
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'WeeklyStopReportPanel') { panels++; if (inExport) panelsInExport++ }
    ts.forEachChild(node, child => visit(child, inExport))
  }
  visit(source)
  expect(panels).toBe(1)
  expect(panelsInExport).toBe(0)
})
it('uses the same classifier in tracking and retains GPS speed for observed driving proof', () => {
  const source = readFileSync('src/app/(dashboard)/tracking/page.tsx', 'utf8')
  expect(source.includes('classifyDriverStops(trail, origin,')).toBe(true)
  expect(source.includes('sp: pt.sp')).toBe(true)
})

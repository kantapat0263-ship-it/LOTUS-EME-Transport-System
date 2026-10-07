import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { todayBangkok } from '@/lib/vehicle-compliance'

// Evaluate the real page's day expression without loading Firebase or submitting a settings form.
function pageTodayKey() {
  const path = new URL('./page.tsx', import.meta.url)
  const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: string | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'todayKey') {
      expression = node.initializer?.getText(source)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!expression) throw new Error('Settings todayKey expression not found')
  return new Function('todayBangkok', `return ${expression}`)(todayBangkok) as string
}

describe('settings diesel history day', () => {
  it('recognizes the 06:00 Thai cron entry both before and after 07:00 Thai', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-06T23:00:00Z'))
      const cronDay = todayBangkok()
      expect(pageTodayKey()).toBe(cronDay)
      vi.setSystemTime(new Date('2026-10-07T00:15:00Z'))
      expect(pageTodayKey()).toBe(cronDay)
    } finally {
      vi.useRealTimers()
    }
  })
})

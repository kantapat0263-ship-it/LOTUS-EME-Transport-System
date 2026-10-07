import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { todayBangkok } from '@/lib/vehicle-compliance'
import { dieselHistoryThaiDay } from '@/lib/diesel-price-history'

// Evaluate the real page's day expression without loading Firebase or submitting a settings form.
function pageExpression(name: string, priceHistory?: unknown[]) {
  const path = new URL('./page.tsx', import.meta.url)
  const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: string | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      expression = node.initializer?.getText(source)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!expression) throw new Error(`Settings ${name} expression not found`)
  const javascript = ts.transpileModule(`return (${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('todayBangkok', 'priceHistory', 'todayKey', 'dieselHistoryThaiDay', javascript)(todayBangkok, priceHistory, todayBangkok(), dieselHistoryThaiDay)
}
const pageTodayKey = () => pageExpression('todayKey') as string

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

  it('recognizes an existing UTC-named record from the actual Thai run timestamp without migrating it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-07T01:30:00Z'))
    try {
      const history = [{ id: '2026-10-06', date: '2026-10-06', createdAt: { toDate: () => new Date('2026-10-06T23:25:18Z') } }]
      expect(pageExpression('ranToday', history)).toBe(true)
      expect(history[0].date).toBe('2026-10-06')
    } finally { vi.useRealTimers() }
  })

  it('ignores previous runs and supports historical entries without timestamps', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-07T01:30:00Z'))
    try {
      expect(pageExpression('ranToday', [{ id: '2026-10-05', date: '2026-10-05', createdAt: { toDate: () => new Date('2026-10-05T23:25:18Z') } }])).toBe(false)
      expect(pageExpression('ranToday', [{ id: '2026-10-07' }])).toBe(true)
    } finally { vi.useRealTimers() }
  })
})

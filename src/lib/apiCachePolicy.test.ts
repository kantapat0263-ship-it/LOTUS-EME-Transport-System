import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requireActual = createRequire(import.meta.url)
beforeEach(() => vi.stubGlobal('self', { origin: 'https://local.test' }))
afterEach(() => vi.unstubAllGlobals())
function runtimeCaching() {
  const source = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8')
  const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText
  let rules: Array<{ urlPattern: RegExp | ((input: { url: URL; sameOrigin: boolean }) => boolean); handler: string; method?: string }> = []
  const requireConfig = (name: string) => name === 'next-pwa'
    ? (options: { runtimeCaching: typeof rules }) => { rules = options.runtimeCaching; return (config: unknown) => config }
    : requireActual(name)
  new Function('require', 'module', 'exports', compiled)(requireConfig, { exports: {} }, {})
  return rules
}

describe('service worker API isolation', () => {
  it.each(['/api/road-events', '/api/reports/weekly-stops?weekStart=2026-10-05'])
    ('the first matching GET rule for %s is NetworkOnly, before generic API cache', path => {
      const url = new URL(path, 'https://local.test')
      const matched = runtimeCaching().find(rule => (rule.method ?? 'GET') === 'GET' &&
        (typeof rule.urlPattern === 'function' ? rule.urlPattern({ url, sameOrigin: true }) : rule.urlPattern.test(url.href)))
      expect(matched?.handler).toBe('NetworkOnly')
    })
})

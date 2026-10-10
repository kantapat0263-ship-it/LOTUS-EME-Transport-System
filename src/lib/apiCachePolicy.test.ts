import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requireActual = createRequire(import.meta.url)
beforeEach(() => vi.stubGlobal('self', { origin: 'https://local.test' }))
afterEach(() => vi.unstubAllGlobals())

type Rule = { urlPattern: RegExp | ((input: { url: URL; sameOrigin: boolean }) => boolean); handler: string; method?: string }
type HeaderRule = { source: string; headers: { key: string; value: string }[] }

function loadConfig() {
  const source = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8')
  const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText
  let rules: Rule[] = []
  let pwaOptions: Record<string, unknown> = {}
  const requireConfig = (name: string) => name === 'next-pwa'
    ? (options: { runtimeCaching: Rule[] }) => { rules = options.runtimeCaching; pwaOptions = options; return (config: unknown) => config }
    : requireActual(name)
  const mod = { exports: {} as { default?: { headers?: () => Promise<HeaderRule[]> } } }
  new Function('require', 'module', 'exports', compiled)(requireConfig, mod, mod.exports)
  return { rules, pwaOptions, nextConfig: mod.exports.default }
}

/** กฎแรกที่ workbox จะใช้กับ GET นี้ (ลำดับสำคัญ — กฎแรกที่ตรงชนะ) */
function firstGetRule(path: string, origin = 'https://local.test') {
  const url = new URL(path, origin)
  return loadConfig().rules.find(rule => (rule.method ?? 'GET') === 'GET' &&
    (typeof rule.urlPattern === 'function' ? rule.urlPattern({ url, sameOrigin: url.origin === origin }) : rule.urlPattern.test(url.href)))
}

describe('service worker API isolation', () => {
  // API ที่ต้องล็อกอิน/คืนข้อมูลส่วนตัว — ห้ามมีสำเนาใน CacheStorage (เครื่องร่วมกัน: staff → logout → offline ได้ของเก่า)
  it.each([
    '/api/road-events',
    '/api/reports/weekly-stops?weekStart=2026-10-05',
    '/api/continuous-queues?date=2026-10-10',
    '/api/tracking/devices',
    '/api/tracking/sync',
    '/api/version?t=1',
    '/api/driver-ticket/T-1010-0013?t=abc',
    '/api/some-future-route',
  ])('the first matching GET rule for %s is NetworkOnly, before generic API cache', path => {
    expect(firstGetRule(path)?.handler).toBe('NetworkOnly')
  })

  it('static assets still use the offline caches (app keeps loading as before)', () => {
    expect(firstGetRule('/_next/static/chunks/main-abc.js')?.handler).not.toBe('NetworkOnly')
    expect(firstGetRule('/icons/icon-192x192.png')?.handler).not.toBe('NetworkOnly')
  })

  it('manifest.json is never served from cache', () => {
    expect(firstGetRule('/manifest.json')?.handler).toBe('NetworkOnly')
  })

  it('another origin\'s /api/ path is not affected by the same-origin rule', () => {
    expect(firstGetRule('https://maps.example.com/api/x')?.handler).not.toBe('NetworkOnly')
  })
})

describe('private API response headers', () => {
  it.each(['/api/tracking/:path*', '/api/cron/:path*', '/api/driver-leaves', '/api/line/:path*', '/api/line-webhook'])
    ('%s responds with Cache-Control: private, no-store', async source => {
      const rules = (await loadConfig().nextConfig?.headers?.()) ?? []
      const rule = rules.find(r => r.source === source)
      expect(rule?.headers).toEqual(expect.arrayContaining([{ key: 'Cache-Control', value: 'private, no-store' }]))
    })

  it('public flood data keeps its own CDN caching (not overridden)', async () => {
    const rules = (await loadConfig().nextConfig?.headers?.()) ?? []
    expect(rules.some(r => r.source.includes('road-events') || r.source === '/api/:path*')).toBe(false)
  })
})

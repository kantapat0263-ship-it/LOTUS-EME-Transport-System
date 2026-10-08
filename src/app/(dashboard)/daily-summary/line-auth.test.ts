import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'

const source = ts.createSourceFile('page.tsx', readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let sendHandler: ts.Expression | undefined
function find(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleSendLine' && node.initializer && ts.isCallExpression(node.initializer)) sendHandler = node.initializer.arguments[1]
  ts.forEachChild(node, find)
}
find(source)
if (!sendHandler) throw new Error('Daily-summary LINE handler not found')
const compiled = ts.transpileModule(`const send = ${sendHandler.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function arrange(user: { getIdToken: () => Promise<string> } | null) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true })
  const toast = vi.fn()
  const setBusy = vi.fn()
  const handler = new Function('user', 'trips', 'setIsSendingLine', 'isFullyMovedOut', 'isHiddenFromReport', 'incomingStopsForTrip', 'fetch', 'toast', 'selectedDate', 'formatThaiDate', 'process', 'console', `${compiled}; return send`)(
    user, [{ id: 'trip-test', tripId: 'T-TEST', driverName: 'คนขับทดสอบ', stops: [] }], setBusy, () => false, () => false, () => [], fetchMock, toast, '2026-10-06', () => 'วันที่ทดสอบ', { env: { NEXT_PUBLIC_APP_URL: 'https://transport.example' } }, { error: vi.fn() },
  ) as () => Promise<void>
  return { handler, fetchMock, toast, setBusy }
}

afterEach(() => vi.restoreAllMocks())

describe('actual daily-summary LINE click handler', () => {
  it('gets a Firebase token before sending the existing summary payload', async () => {
    const getIdToken = vi.fn().mockResolvedValue('test-user-id-token')
    const { handler, fetchMock, setBusy } = arrange({ getIdToken })
    await handler()
    expect(getIdToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getIdToken.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0])
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/line/send-summary')
    expect(request.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer test-user-id-token' })
    expect(JSON.parse(request.body)).toEqual({ trips: [{ driverName: 'คนขับทดสอบ', driverUrl: 'https://transport.example/driver/T-TEST', incomingCount: 0, incomingFrom: [], outgoingCount: 0, outgoingTo: [] }], dateStr: 'วันที่ทดสอบ', selectedDate: '2026-10-06' })
    expect(setBusy).toHaveBeenLastCalledWith(false)
  })

  it('does not send if the user has signed out', async () => {
    const { handler, fetchMock, toast } = arrange(null)
    await handler()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalled()
  })

  it('does not send and clears loading if token acquisition fails', async () => {
    const { handler, fetchMock, setBusy, toast } = arrange({ getIdToken: vi.fn().mockRejectedValue(new Error('test token failure')) })
    await handler()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(setBusy).toHaveBeenLastCalledWith(false)
    expect(toast).toHaveBeenCalled()
  })
})

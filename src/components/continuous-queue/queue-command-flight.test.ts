import { describe, expect, it } from 'vitest'
import { createQueueCommandFlight } from './queue-command-flight'

describe('queue command submission', () => {
  it('keeps one command in flight and rejects stale selection before sending', () => {
    let selectedDate = '2026-10-05'
    const guard = createQueueCommandFlight(() => 'operation-1')
    const flight = guard.begin(() => selectedDate === '2026-10-05')
    expect(flight).not.toBeNull()
    expect(guard.begin(() => true)).toBeNull()
    expect(flight!.isCurrent()).toBe(true)
    selectedDate = '2026-10-06'
    expect(flight!.isCurrent()).toBe(false)
    flight!.finish(false)
    expect(guard.isPending()).toBe(false)
  })
  it('reuses the operation after a failed response only while the payload is unchanged', () => {
    let sequence = 0
    const guard = createQueueCommandFlight(() => `operation-${++sequence}`)
    const first = guard.begin(() => true)!
    const originalId = first.operationId('create|date5|driverA|vehicleA')
    first.finish(false)
    const retry = guard.begin(() => true)!
    expect(retry.operationId('create|date5|driverA|vehicleA')).toBe(originalId)
    retry.finish(false)
    const changed = guard.begin(() => true)!
    expect(changed.operationId('create|date6|driverA|vehicleA')).not.toBe(originalId)
    changed.finish(true)
    const afterSuccess = guard.begin(() => true)!
    expect(afterSuccess.operationId('create|date6|driverA|vehicleA')).not.toBe('operation-2')
    afterSuccess.finish(true)
  })
})

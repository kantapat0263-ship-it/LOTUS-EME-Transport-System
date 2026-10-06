function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

function millis(value: any): number | null {
  const seconds = value?.seconds ?? value?._seconds
  const nanoseconds = value?.nanoseconds ?? value?._nanoseconds ?? 0
  if (typeof seconds === 'number' && typeof nanoseconds === 'number') return seconds * 1000 + nanoseconds / 1_000_000
  return typeof value?.toMillis === 'function' ? value.toMillis() : null
}

// Capture the original request row, before flattening it into a UI/trip stop.
// Notes written by dispatchers and assignments may change without changing the job.
export function requestDestinationFingerprint(request: Record<string, any>, index: number): string {
  const destination = request.destinations?.[index]
  if (!Number.isSafeInteger(index) || index < 0 || !destination || typeof destination !== 'object' || Array.isArray(destination)) throw new Error('ไม่พบจุดหมายต้นฉบับ กรุณาโหลดหน้าใหม่และเลือกงานใหม่')
  return canonical({ destination, requestId: request.requestId || request.vrId || '', requestDate: request.requestDate || '', requestedBy: request.requestedBy || '', requestedByPhone: request.requestedByPhone || '', userId: request.userId || '', requestTime: destination.requestTime || request.requestTime || '08:30', note: request.note || request.notes || '', requestedAt: millis(request.createdAt) })
}

export function assertRequestDestinationsUnchanged(request: Record<string, any>, indexes: number[], expected?: string[]): void {
  if (!Array.isArray(expected) || expected.length !== indexes.length || expected.some(value => typeof value !== 'string' || !value)) throw new Error('ข้อมูลจุดหมายต้นฉบับไม่ครบ กรุณาโหลดหน้าใหม่และเลือกงานใหม่')
  if (indexes.some((index, position) => requestDestinationFingerprint(request, index) !== expected[position])) throw new Error('จุดหมายหรือรายละเอียดใบขอเปลี่ยนระหว่างจัดรถ กรุณาโหลดหน้าใหม่และเลือกงานใหม่')
}

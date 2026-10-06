export function createQueueCommandFlight(makeId: () => string = () => crypto.randomUUID()) {
  let pending = false
  let operation: { signature: string; id: string } | null = null
  return {
    isPending: () => pending,
    begin(isCurrent: () => boolean) {
      if (pending) return null
      pending = true
      let closed = false
      return {
        operationId(signature: string) {
          if (operation?.signature !== signature) operation = { signature, id: makeId() }
          return operation.id
        },
        isCurrent: () => !closed && isCurrent(),
        finish(success: boolean) {
          if (closed) return
          closed = true
          pending = false
          if (success) operation = null
        },
      }
    },
  }
}

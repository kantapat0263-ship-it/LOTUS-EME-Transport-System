import { isIsoDate, todayBangkok } from './vehicle-compliance'

/** Old cron entries used UTC document IDs; display the actual run day in Thailand. */
export function dieselHistoryThaiDay(entry: { createdAt?: unknown; date?: unknown; id?: unknown }): string | null {
  const timestamp = entry.createdAt
  try {
    const date = timestamp instanceof Date ? timestamp
      : timestamp && typeof timestamp === 'object' && 'toDate' in timestamp && typeof timestamp.toDate === 'function'
        ? timestamp.toDate() : null
    if (date instanceof Date && Number.isFinite(date.getTime())) return todayBangkok(date)
  } catch { /* Legacy or malformed timestamps fall back to the stored day. */ }
  return isIsoDate(entry.date) ? entry.date : isIsoDate(entry.id) ? entry.id : null
}

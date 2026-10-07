/** Round the total first so 119.6 minutes becomes 2 hours, never 1 hour 60 minutes. */
export function formatDurationMinutes(minutes: number, style: 'text' | 'compact' = 'text'): string {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const remaining = total % 60
  if (style === 'compact') return hours ? `${hours}ชม.${remaining ? `${remaining}′` : ''}` : `${total}′`
  return hours ? `${hours} ชม.${remaining ? ` ${remaining} นาที` : ''}` : `${total} นาที`
}

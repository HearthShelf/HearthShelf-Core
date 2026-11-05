// Server activity chart helpers.

export const DAY_LABELS: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const HOUR_LABELS: readonly string[] = Array.from({ length: 24 }, (_, hour) => {
  if (hour === 0) return '12a'
  if (hour < 12) return `${hour}a`
  if (hour === 12) return '12p'
  return `${hour - 12}p`
})

/** A short label for listening seconds: "0", "12m", "3.5h", "42h". */
export function activityValue(seconds: number): string {
  if (seconds <= 0) return '0'
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`
  const hours = seconds / 3600
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`
}

/** Exactly `length` buckets, with anything missing or invalid as 0. */
export function normalizeActivityBuckets(value: number[] | undefined, length: number): number[] {
  return Array.from({ length }, (_, i) => {
    const n = Number(value?.[i])
    return Number.isFinite(n) && n > 0 ? n : 0
  })
}

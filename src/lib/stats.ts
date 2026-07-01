// Pure listening-stats math, shared by the HearthShelf server (/hs/stats) and by
// clients that fall back to computing from raw ABS /api/me/listening-stats. No
// Node/DOM APIs, so it runs identically in the Worker/server and in the app.
//
// All day bucketing is in the CALLER's local time. The server can't know the
// caller's timezone, so /hs/stats takes a `now` (or day-offset) from the client
// and passes it here; clients computing locally pass their own `new Date()`.

import type { ABSListeningStats, HSListeningStats, HSStatsItem } from '../types/abs'

/** Stable local-time day key (YYYY-MM-DD) matching ABS's `days` map keys. */
export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Seconds listened on the day `offset` days before `now`. */
function daySeconds(byDay: Record<string, number>, now: Date, offset: number): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
  return byDay[dayKey(d)] ?? 0
}

/** Sum of the last 7 local days (today + 6 prior). */
export function weekSeconds(byDay: Record<string, number>, now: Date): number {
  let total = 0
  for (let i = 0; i < 7; i++) total += daySeconds(byDay, now, i)
  return total
}

/**
 * Consecutive days with any listening, ending today. If today has no listening
 * yet, the count starts from yesterday so an in-progress day doesn't reset the
 * streak. Capped at 365. (Algorithm from the absorb client's _currentStreak.)
 */
export function computeStreak(byDay: Record<string, number>, now: Date): number {
  let streak = 0
  const startOffset = daySeconds(byDay, now, 0) > 0 ? 0 : 1
  for (let i = startOffset; i < 365; i++) {
    if (daySeconds(byDay, now, i) > 0) streak++
    else break
  }
  return streak
}

/** Count of distinct days with any listening. */
export function activeDays(byDay: Record<string, number>): number {
  let n = 0
  for (const k in byDay) if (byDay[k] > 0) n++
  return n
}

/** All-time per-item listening, resolved + sorted desc, for "Most listened". */
export function mostListened(items: ABSListeningStats['items']): HSStatsItem[] {
  return Object.entries(items ?? {})
    .map(([key, raw]) => {
      const md = raw.mediaMetadata
      return {
        id: raw.id || key,
        title: md?.title || 'Untitled',
        author: md?.authorName || md?.authors?.[0]?.name || '',
        narrator: md?.narratorName || md?.narrators?.[0] || '',
        timeSec: raw.timeListening ?? 0,
      }
    })
    .sort((a, b) => b.timeSec - a.timeSec)
}

/**
 * Fold a raw ABS listening-stats payload into the computed HSListeningStats.
 * Used by /hs/stats server-side and by the client fallback. `now` is the
 * caller's local time.
 */
export function computeListeningStats(raw: ABSListeningStats, now: Date): HSListeningStats {
  const byDay = raw.days ?? {}
  return {
    totalTimeSec: raw.totalTime ?? 0,
    todaySec: raw.today ?? 0,
    weekSec: weekSeconds(byDay, now),
    dayStreak: computeStreak(byDay, now),
    activeDays: activeDays(byDay),
    byDay,
    mostListened: mostListened(raw.items),
  }
}

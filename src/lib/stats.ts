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
 * streak. Capped at 365.
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

/** Average seconds listened per active day. 0 when there are no active days. */
export function avgPerActiveDay(totalSec: number, activeDayCount: number): number {
  if (!activeDayCount) return 0
  return totalSec / activeDayCount
}

/** Average seconds per session. 0 when there are no sessions. */
export function avgSession(totalSec: number, sessionCount: number): number {
  if (!sessionCount) return 0
  return totalSec / sessionCount
}

/**
 * Normalize ABS's dayOfWeek bucketing into a dense '0'..'6' (Sun..Sat) map with
 * every weekday present (0 for weekdays with no listening), for the 7-bar chart.
 * ABS keys dayOfWeek by weekday NAME ('Sunday'..'Saturday'); older/other shapes
 * may key by index. Both are folded to the numeric index here.
 */
export function dayOfWeekTotals(
  dayOfWeek: Record<string, number> | undefined | null,
): Record<string, number> {
  const names: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  }
  const out: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 }
  for (const [key, val] of Object.entries(dayOfWeek ?? {})) {
    const seconds = typeof val === 'number' ? val : 0
    const named = names[key.trim().toLowerCase()]
    const idx = named !== undefined ? named : Number.parseInt(key, 10)
    if (Number.isInteger(idx) && idx >= 0 && idx <= 6) out[String(idx)] += seconds
  }
  return out
}

/**
 * Average seconds listened per occurrence of each weekday, keyed '0'..'6'
 * (Sun..Sat). Computed from the byDay date map: for each weekday, sum the
 * seconds across every date of that weekday PRESENT in byDay, then divide by how
 * many such dates there are. Unlike byDayOfWeek (a running total that grows the
 * longer you've listened), this answers "on a typical Monday, how long do I
 * listen" - comparable across weekdays even though the window holds unequal
 * counts of each. A weekday absent from byDay averages to 0.
 *
 * Only dates already in byDay count as the divisor (ABS's own reporting window),
 * so a weekday you've never listened on doesn't dilute the others.
 */
export function dayOfWeekAverages(byDay: Record<string, number> | undefined | null): Record<string, number> {
  const sums: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 }
  const counts: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 }
  for (const [date, val] of Object.entries(byDay ?? {})) {
    const seconds = typeof val === 'number' ? val : 0
    // Parse 'YYYY-MM-DD' as a local date to read its weekday. Constructing from
    // parts (not Date.parse) avoids the UTC-midnight shift that can bump the day.
    const parts = date.split('-')
    if (parts.length !== 3) continue
    const y = Number.parseInt(parts[0], 10)
    const m = Number.parseInt(parts[1], 10)
    const d = Number.parseInt(parts[2], 10)
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) continue
    const idx = new Date(y, m - 1, d).getDay()
    const key = String(idx)
    sums[key] += seconds
    counts[key] += 1
  }
  const out: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 }
  for (const key of Object.keys(out)) out[key] = counts[key] ? sums[key] / counts[key] : 0
  return out
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
    byDayOfWeek: dayOfWeekTotals(raw.dayOfWeek),
    byWeekdayAvg: dayOfWeekAverages(byDay),
    mostListened: mostListened(raw.items),
    // ABS-db-derived fields: the /hs/stats server route fills these from a direct
    // read of ABS's database. Clients computing locally from the REST payload
    // (older-server fallback) can't reach that data, so they stay null.
    booksFinished: null,
    booksThisYear: null,
    sessionCount: null,
    highlights: null,
  }
}

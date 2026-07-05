// Pure release-date / countdown logic, shared by the app (Home banner, upcoming
// book page), the settings screen, and the server's push job. No I/O; the caller
// passes `now` (ms epoch) so these stay deterministic and testable.

import type {
  HSAudibleSeriesBook,
  HSNotificationPrefs,
  HSSubscription,
} from '../types/hs'

export const DEFAULT_NOTIFICATION_PREFS: HSNotificationPrefs = {
  enabled: true,
  notifyAvailableInLibrary: true,
  notifyOnReleaseDate: true,
  reminderDaysBefore: 3,
  countdownWindowDays: 14,
}

/** Clamp the countdown window to the supported 1-30 range. */
export function clampCountdownWindow(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_NOTIFICATION_PREFS.countdownWindowDays
  return Math.max(1, Math.min(30, Math.round(days)))
}

/** The release instant (ms epoch) for a book, preferring the precise
 *  publication_datetime and falling back to the date-only release_date (treated
 *  as local midnight of that day). null when neither is present/parseable. */
export function releaseMs(
  book: { publicationDatetime?: string; releaseDate?: string },
): number | null {
  const raw = book.publicationDatetime || book.releaseDate
  if (!raw) return null
  const t = Date.parse(raw)
  return Number.isNaN(t) ? null : t
}

/** True when the book's release is in the future relative to `now`. */
export function isUpcoming(
  book: { publicationDatetime?: string; releaseDate?: string },
  now: number,
): boolean {
  const ms = releaseMs(book)
  return ms !== null && ms > now
}

/** Whole days from `now` until release, rounded up (so a book out later today
 *  reads as "1 day", and one out now/past reads as 0). null when no date. */
export function daysUntilRelease(
  book: { publicationDatetime?: string; releaseDate?: string },
  now: number,
): number | null {
  const ms = releaseMs(book)
  if (ms === null) return null
  const diff = ms - now
  if (diff <= 0) return 0
  return Math.ceil(diff / 86_400_000)
}

/** Short human countdown, e.g. "Out today", "1 day", "12 days". null when no date. */
export function countdownLabel(
  book: { publicationDatetime?: string; releaseDate?: string },
  now: number,
): string | null {
  const d = daysUntilRelease(book, now)
  if (d === null) return null
  if (d <= 0) return 'Out today'
  return d === 1 ? '1 day' : `${d} days`
}

/** Should this subscription show on the Home countdown banner right now?
 *  It must be an unresolved book (not yet available) whose release is within the
 *  configured window and still in the future. */
export function isInCountdownWindow(
  sub: Pick<
    HSSubscription,
    'kind' | 'available' | 'publicationDatetime' | 'releaseDate'
  >,
  windowDays: number,
  now: number,
): boolean {
  if (sub.kind !== 'book') return false
  if (sub.available) return false
  const d = daysUntilRelease(sub, now)
  if (d === null) return false
  return d >= 0 && d <= clampCountdownWindow(windowDays)
}

/** Book subscriptions to surface on the banner, soonest release first. */
export function bannerSubscriptions(
  subs: HSSubscription[],
  prefs: Pick<HSNotificationPrefs, 'countdownWindowDays'>,
  now: number,
): HSSubscription[] {
  return subs
    .filter((s) => isInCountdownWindow(s, prefs.countdownWindowDays, now))
    .sort((a, b) => (releaseMs(a) ?? Infinity) - (releaseMs(b) ?? Infinity))
}

/** Upcoming (unreleased) books in a resolved series roster, soonest first. Used
 *  by the series screen + upcoming book page to spotlight what's coming. */
export function upcomingSeriesBooks(
  books: HSAudibleSeriesBook[],
  now: number,
): HSAudibleSeriesBook[] {
  return books
    .filter((b) => (b.upcoming ?? isUpcoming(b, now)) && !b.owned)
    .sort((a, b) => (releaseMs(a) ?? Infinity) - (releaseMs(b) ?? Infinity))
}

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

/** Audible's sentinel for "announced, no date yet". Treated as NO date rather
 *  than a real one - otherwise every countdown off it reads "63330 days". */
const UNSCHEDULED_YEAR = '2200'

/** True when the date is Audible's placeholder rather than a real schedule. */
export function isUnscheduled(
  book: { publicationDatetime?: string; releaseDate?: string },
): boolean {
  const raw = book.publicationDatetime || book.releaseDate || ''
  return raw.startsWith(UNSCHEDULED_YEAR)
}

/** The release instant (ms epoch) for a book, preferring the precise
 *  publication_datetime and falling back to the date-only release_date (treated
 *  as local midnight of that day). null when neither is present/parseable, and
 *  null for Audible's 2200-01-01 "not scheduled yet" sentinel, so callers show
 *  a TBD state instead of counting down to the year 2200. */
export function releaseMs(
  book: { publicationDatetime?: string; releaseDate?: string },
): number | null {
  const raw = book.publicationDatetime || book.releaseDate
  if (!raw) return null
  if (isUnscheduled(book)) return null
  const t = Date.parse(raw)
  return Number.isNaN(t) ? null : t
}

/** True when the book isn't out yet. An unscheduled book (Audible's 2200
 *  sentinel) counts as upcoming even though it has no usable date - it has been
 *  announced but not released, which is exactly "not out yet". Without this it
 *  would read as already available. */
export function isUpcoming(
  book: { publicationDatetime?: string; releaseDate?: string },
  now: number,
): boolean {
  if (isUnscheduled(book)) return true
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

/** Short human countdown, e.g. "Out today", "1 day", "12 days". "Date TBD" for
 *  an announced-but-unscheduled book; null when there's no date at all. */
export function countdownLabel(
  book: { publicationDatetime?: string; releaseDate?: string },
  now: number,
): string | null {
  if (isUnscheduled(book)) return 'Date TBD'
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

/** The single next book to expect in a followed series - what the reader picks
 *  up next, in series order. null when the series is fully owned and nothing is
 *  announced.
 *
 *  A series subscription carries no release date of its own (it stands for every
 *  future book), so a "following" list needs this to say anything concrete about
 *  what is next.
 *
 *  Ordering is by SEQUENCE, not by release date. Someone who owns books 1-5 of a
 *  fifteen-book series is waiting on book 6 - which is out now - not on book 15
 *  just because 15 is the next thing Audible will publish. Only once every
 *  released book is owned does the soonest unreleased one become "next", and
 *  that case falls out of the same sequence ordering. */
export function nextSeriesBook(
  books: HSAudibleSeriesBook[],
  now: number,
): HSAudibleSeriesBook | null {
  const unowned = books
    .filter((b) => b.title && !b.owned)
    .sort((a, b) => (parseFloat(a.sequence ?? '') || 0) - (parseFloat(b.sequence ?? '') || 0))
  if (unowned.length === 0) return null
  // Prefer the first gap in what's already out; fall back to the soonest
  // announced book when the reader is fully caught up.
  const released = unowned.find((b) => !(b.upcoming ?? isUpcoming(b, now)))
  return released ?? upcomingSeriesBooks(unowned, now)[0] ?? unowned[0]
}

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
  // A book whose date has PASSED but that never landed in the library is not a
  // countdown - daysUntilRelease floors at 0, so without this an old follow sat
  // on the banner reading "Out today" forever.
  const ms = releaseMs(sub)
  if (ms === null || ms < now - 86_400_000) return false
  const d = daysUntilRelease(sub, now)
  if (d === null) return false
  return d >= 0 && d <= clampCountdownWindow(windowDays)
}

/** Book subscriptions to surface on the banner, soonest release first.
 *
 *  `ignoredAsins` drops books the user has ignored: ignoring a book is a
 *  statement that they don't want to hear about it, so it must not keep
 *  appearing on Home just because a follow still exists for it. */
export function bannerSubscriptions(
  subs: HSSubscription[],
  prefs: Pick<HSNotificationPrefs, 'countdownWindowDays'>,
  now: number,
  ignoredAsins?: readonly string[],
): HSSubscription[] {
  const ignored = ignoredAsins?.length
    ? new Set(ignoredAsins.map((a) => String(a).toLowerCase()))
    : null
  return subs
    .filter((s) => !(ignored && s.asin && ignored.has(String(s.asin).toLowerCase())))
    .filter((s) => isInCountdownWindow(s, prefs.countdownWindowDays, now))
    .sort((a, b) => (releaseMs(a) ?? Infinity) - (releaseMs(b) ?? Infinity))
}

/** One thing with a release ahead of it, flattened from either source: a book
 *  the user followed directly, or the next book of a series they follow. */
export interface PendingRelease {
  /** Stable key for lists: the book's ASIN when known, else the sub's id. */
  key: string
  title: string
  author?: string
  coverArtUrl?: string
  seriesTitle?: string
  sequence?: string | null
  asin?: string
  releaseDate?: string
  publicationDatetime?: string
  /** The subscription this came from, so unfollowing still targets the right
   *  row (a series-derived release unfollows the SERIES, not one book). */
  sub: HSSubscription
}

/** Everything the user is waiting on, from BOTH sources, soonest first.
 *
 *  A series subscription carries no date of its own, so on its own it can never
 *  satisfy a countdown - which is why a user who follows only series saw an
 *  empty Home banner and an empty Upcoming page. Pass `nextBySeriesAsin` (the
 *  resolved next book per followed series, from nextSeriesBook) and those books
 *  join the same list as directly-followed books.
 *
 *  `ignoredAsins` drops books the user has ignored, from either source. */
export function pendingReleases(
  subs: readonly HSSubscription[],
  nextBySeriesAsin: ReadonlyMap<string, HSAudibleSeriesBook | null>,
  ignoredAsins?: readonly string[],
): PendingRelease[] {
  const ignored = ignoredAsins?.length
    ? new Set(ignoredAsins.map((a) => String(a).toLowerCase()))
    : null
  const isIgnored = (asin?: string) =>
    Boolean(ignored && asin && ignored.has(String(asin).toLowerCase()))

  const out: PendingRelease[] = []
  for (const s of subs) {
    if (s.kind === 'book') {
      if (s.available || isIgnored(s.asin)) continue
      out.push({
        key: s.asin ?? s.id,
        title: s.title,
        author: s.author,
        coverArtUrl: s.coverArtUrl,
        seriesTitle: s.seriesTitle,
        sequence: s.sequence,
        asin: s.asin,
        releaseDate: s.releaseDate,
        publicationDatetime: s.publicationDatetime,
        sub: s,
      })
      continue
    }
    const next = s.seriesAsin ? nextBySeriesAsin.get(s.seriesAsin) : null
    if (!next || next.owned || isIgnored(next.asin)) continue
    out.push({
      key: `${s.id}:${next.asin}`,
      title: next.title,
      author: next.author || s.author,
      coverArtUrl: next.coverArtUrl ?? s.coverArtUrl,
      seriesTitle: s.seriesTitle ?? s.title,
      sequence: next.sequence,
      asin: next.asin,
      releaseDate: next.releaseDate,
      publicationDatetime: next.publicationDatetime,
      sub: s,
    })
  }
  return out.sort((a, b) => (releaseMs(a) ?? Infinity) - (releaseMs(b) ?? Infinity))
}

/** The pending releases close enough to show on the Home countdown banner:
 *  dated, still ahead, and inside the reader's window. */
export function bannerReleases(
  releases: readonly PendingRelease[],
  prefs: Pick<HSNotificationPrefs, 'countdownWindowDays'>,
  now: number,
): PendingRelease[] {
  const window = clampCountdownWindow(prefs.countdownWindowDays)
  return releases.filter((r) => {
    const ms = releaseMs(r)
    if (ms === null || ms < now - 86_400_000) return false
    const d = daysUntilRelease(r, now)
    return d !== null && d >= 0 && d <= window
  })
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
  ignoredAsins?: readonly string[],
): HSAudibleSeriesBook | null {
  const ignored = ignoredAsins?.length
    ? new Set(ignoredAsins.map((a) => String(a).toLowerCase()))
    : null
  const unowned = books
    .filter(
      (b) =>
        b.title &&
        !b.owned &&
        !(ignored && b.asin && ignored.has(String(b.asin).toLowerCase())),
    )
    .sort((a, b) => (parseFloat(a.sequence ?? '') || 0) - (parseFloat(b.sequence ?? '') || 0))
  if (unowned.length === 0) return null
  // Prefer the first gap in what's already out; fall back to the soonest
  // announced book when the reader is fully caught up.
  const released = unowned.find((b) => !(b.upcoming ?? isUpcoming(b, now)))
  return released ?? upcomingSeriesBooks(unowned, now)[0] ?? unowned[0]
}

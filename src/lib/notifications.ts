// Pure release-date / countdown logic, shared by the app (Home banner, upcoming
// book page), the settings screen, and the server's push job. No I/O; the caller
// passes `now` (ms epoch) so these stay deterministic and testable.

import type {
  HSAudibleSeriesBook,
  HSNotifyPrefs,
  HSSubscription,
  NotifyChannel,
  NotifyChannels,
  NotifyType,
} from '../types/hs'

/** Everything on. A notification the user never opted out of should reach them:
 *  the failure mode of a wrong default here is one extra alert, whereas the
 *  opposite is a mention they never learn about. */
export const DEFAULT_NOTIFY_PREFS: HSNotifyPrefs = {
  global: { inApp: true, push: true, email: true },
  types: {
    release: {
      enabled: true,
      availableInLibrary: true,
      onReleaseDate: true,
      reminderDaysBefore: 3,
    },
    mention: { enabled: true },
    clubInvite: { enabled: true },
    reaction: { enabled: true },
    reply: { enabled: true },
    // In-app only. A finished book is a prompt to reflect, not news that decays,
    // so it waits in the tray instead of buzzing the phone the moment a book
    // ends - which, for a listener who fell asleep to it, is the worst moment.
    // The channels override is explicit rather than inherited: this is the one
    // type whose quietness is the product decision, not the user's global one.
    rating: { enabled: true, channels: { inApp: true, push: false, email: false } },
  },
  countdownWindowDays: 14,
}

/** The channels a given type actually delivers on: the user's global set, with
 *  any per-type override applied on top. */
export function resolveChannels(prefs: HSNotifyPrefs, type: NotifyType): NotifyChannels {
  const global = prefs.global
  const override = prefs.types[type]?.channels
  return override ? { ...global, ...override } : { ...global }
}

/** Whether `type` should be delivered on `channel` for this user.
 *
 *  Club invites are floored ON for the in-app tray: an invite you cannot see is
 *  an invite you cannot accept, which strands both the invitee and whoever sent
 *  it. That floor is enforced here rather than by hiding the toggle, so no
 *  client can drift out of the rule. */
export function shouldNotify(
  prefs: HSNotifyPrefs,
  type: NotifyType,
  channel: NotifyChannel,
): boolean {
  if (type === 'clubInvite' && channel === 'inApp') return true
  if (!prefs.types[type]?.enabled) return false
  return resolveChannels(prefs, type)[channel]
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function channels(value: unknown, fallback: NotifyChannels): NotifyChannels {
  const v = (value ?? {}) as Partial<NotifyChannels>
  return {
    inApp: bool(v.inApp, fallback.inApp),
    push: bool(v.push, fallback.push),
    email: bool(v.email, fallback.email),
  }
}

/** Narrow a stored `notifyPrefs` value to a complete HSNotifyPrefs, filling any
 *  missing or malformed field from the defaults.
 *
 *  This is deliberately total rather than a strict validator: settings sync can
 *  hand us a value written by an older or newer client, and a notifications
 *  subsystem that throws on an unexpected shape is worse than one that falls
 *  back to "tell the user". Unknown per-type channel keys are dropped. */
export function normalizeNotifyPrefs(raw: unknown): HSNotifyPrefs {
  const d = DEFAULT_NOTIFY_PREFS
  if (!raw || typeof raw !== 'object') return { ...d, types: { ...d.types } }
  const v = raw as Partial<HSNotifyPrefs>
  const t = (v.types ?? {}) as Partial<HSNotifyPrefs['types']>
  const global = channels(v.global, d.global)
  // A per-type `channels` stays ABSENT unless the stored value had one, so a
  // type keeps inheriting `global` instead of being frozen at today's values.
  const overrideOf = (src: unknown): Partial<NotifyChannels> | undefined => {
    if (!src || typeof src !== 'object') return undefined
    const o = src as Partial<NotifyChannels>
    const out: Partial<NotifyChannels> = {}
    if (typeof o.inApp === 'boolean') out.inApp = o.inApp
    if (typeof o.push === 'boolean') out.push = o.push
    if (typeof o.email === 'boolean') out.email = o.email
    return Object.keys(out).length ? out : undefined
  }
  const release = (t.release ?? {}) as Partial<HSNotifyPrefs['types']['release']>
  const mention = (t.mention ?? {}) as Partial<HSNotifyPrefs['types']['mention']>
  const invite = (t.clubInvite ?? {}) as Partial<HSNotifyPrefs['types']['clubInvite']>
  const reaction = (t.reaction ?? {}) as Partial<HSNotifyPrefs['types']['reaction']>
  const reply = (t.reply ?? {}) as Partial<HSNotifyPrefs['types']['reply']>
  const rating = (t.rating ?? {}) as Partial<HSNotifyPrefs['types']['rating']>
  const reminder = Number(release.reminderDaysBefore)
  return {
    global,
    types: {
      release: {
        enabled: bool(release.enabled, d.types.release.enabled),
        channels: overrideOf(release.channels),
        availableInLibrary: bool(release.availableInLibrary, d.types.release.availableInLibrary),
        onReleaseDate: bool(release.onReleaseDate, d.types.release.onReleaseDate),
        reminderDaysBefore: Number.isFinite(reminder)
          ? Math.max(0, Math.min(30, Math.round(reminder)))
          : d.types.release.reminderDaysBefore,
      },
      mention: {
        enabled: bool(mention.enabled, d.types.mention.enabled),
        channels: overrideOf(mention.channels),
      },
      clubInvite: {
        enabled: bool(invite.enabled, d.types.clubInvite.enabled),
        channels: overrideOf(invite.channels),
      },
      reaction: {
        enabled: bool(reaction.enabled, d.types.reaction.enabled),
        channels: overrideOf(reaction.channels),
      },
      reply: {
        enabled: bool(reply.enabled, d.types.reply.enabled),
        channels: overrideOf(reply.channels),
      },
      rating: {
        enabled: bool(rating.enabled, d.types.rating.enabled),
        // Falls back to the default's quiet override (not `undefined`) when the
        // stored value has none, so a client that saved prefs before rating
        // notifications existed does not silently inherit `global` and start
        // pushing rating prompts to the phone.
        channels: overrideOf(rating.channels) ?? d.types.rating.channels,
      },
    },
    countdownWindowDays: clampCountdownWindow(Number(v.countdownWindowDays)),
  }
}

/** Settings-catalog predicate for `notifyPrefs`.
 *
 *  Intentionally permissive: normalizeNotifyPrefs() can rebuild a usable value
 *  from anything object-shaped, so rejecting here would only strand a user on a
 *  stale value written by another client. Non-objects are still refused. */
export function isNotifyPrefs(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Clamp the countdown window to the supported 1-30 range. */
export function clampCountdownWindow(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_NOTIFY_PREFS.countdownWindowDays
  return Math.max(1, Math.min(30, Math.round(days)))
}

/** Audible's sentinel for "announced, no date yet". Treated as NO date rather
 *  than a real one - otherwise every countdown off it reads "63330 days". */
const UNSCHEDULED_YEAR = '2200'

/** True when the date is Audible's placeholder rather than a real schedule. */
export function isUnscheduled(book: {
  publicationDatetime?: string
  releaseDate?: string
}): boolean {
  const raw = book.publicationDatetime || book.releaseDate || ''
  return raw.startsWith(UNSCHEDULED_YEAR)
}

/** The release instant (ms epoch) for a book, preferring the precise
 *  publication_datetime and falling back to the date-only release_date (treated
 *  as local midnight of that day). null when neither is present/parseable, and
 *  null for Audible's 2200-01-01 "not scheduled yet" sentinel, so callers show
 *  a TBD state instead of counting down to the year 2200. */
export function releaseMs(book: {
  publicationDatetime?: string
  releaseDate?: string
}): number | null {
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
  sub: Pick<HSSubscription, 'kind' | 'available' | 'publicationDatetime' | 'releaseDate'>,
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
  prefs: Pick<HSNotifyPrefs, 'countdownWindowDays'>,
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
  prefs: Pick<HSNotifyPrefs, 'countdownWindowDays'>,
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
        b.title && !b.owned && !(ignored && b.asin && ignored.has(String(b.asin).toLowerCase())),
    )
    .sort((a, b) => (parseFloat(a.sequence ?? '') || 0) - (parseFloat(b.sequence ?? '') || 0))
  if (unowned.length === 0) return null
  // Prefer the first gap in what's already out; fall back to the soonest
  // announced book when the reader is fully caught up.
  const released = unowned.find((b) => !(b.upcoming ?? isUpcoming(b, now)))
  return released ?? upcomingSeriesBooks(unowned, now)[0] ?? unowned[0]
}

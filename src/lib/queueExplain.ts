// User-facing explanation of how the Auto queue stays up to date. Shared by web,
// self-hosted and mobile so all three describe the same behaviour in the same
// words - this copy answers a specific, common confusion:
//
//   "I ignored the queue and started a new series, and the rest of it still
//    isn't in my Auto queue yet."
//
// The honest answer is that Auto is mostly TRIGGER-based, not nightly: starting
// a new book rebuilds the queue once you've genuinely been listening for a
// couple of minutes (the play-cooldown in the player). The nightly job is only a
// backstop for changes no client action would catch - chiefly a brand-new book
// landing in the library for a series you're already reading. Leading with
// "nightly" would send people away to wait overnight for something that already
// happens while they listen, so the triggers come first and the nightly run is
// framed as the catch-up.

/** Real playback seconds a newly-started book accrues before its Auto rebuild
 *  fires. Mirrors QUEUE_RECOMPUTE_COOLDOWN_SEC in the player; kept here so the
 *  explanation copy and the actual behaviour can't drift apart. */
export const QUEUE_RECOMPUTE_COOLDOWN_SEC = 120

/** The things that rebuild an Auto queue, in the order worth showing: the ones
 *  a user can act on right now first. */
export const AUTO_QUEUE_TRIGGERS: string[] = [
  'You listen to a new book for a couple of minutes',
  'You change your Auto rules or their order',
  'You add or remove a book in your queue by hand',
  'You hide a series or book from your shelves',
]

/** One-line summary of what the nightly run is actually for. */
export const AUTO_QUEUE_NIGHTLY_NOTE =
  'Every night HearthShelf also does a catch-up pass, so new releases in series you are reading show up on their own.'

/** Short "how long until the nightly catch-up" label, e.g. "in 6h 20m".
 *  Returns null when there's no known schedule, so callers hide the countdown
 *  rather than inventing one. `at` and `from` are epoch ms. */
export function formatNextRebuild(at: number | null, from: number = Date.now()): string | null {
  if (at == null || !Number.isFinite(at)) return null
  const ms = at - from
  if (ms <= 0) return 'any moment now'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `in ${Math.max(1, mins)}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`
}

/** "Updated 4 minutes ago" style label for when the queue last changed.
 *  `at` and `from` are epoch ms; returns null for a queue that never synced. */
export function formatQueueUpdated(at: number | null, from: number = Date.now()): string | null {
  if (!at || !Number.isFinite(at)) return null
  const ms = from - at
  if (ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

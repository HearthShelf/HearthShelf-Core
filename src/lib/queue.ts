// Pure Auto-mode queue logic, shared by web and mobile so both build the same
// up-next list from the same rules. No I/O, no store access.

import type { ABSLibraryItem, ABSMediaProgress, ABSSeries } from '../types/abs'
import type { AutoRuleId, AutoRulePref, QueueEntry } from '../types/queue'

// Default Auto-mode rule order (= priority). 'manual' sits last on purpose:
// Auto's suggestions play first, and the user's hand-queued list is what comes
// after ("when I finish the series and the new releases, read this next").
export const DEFAULT_AUTO_RULES: AutoRulePref[] = [
  { id: 'finish-series', on: true },
  { id: 'in-progress', on: true },
  { id: 'new-in-series', on: true },
  // Modifier on new-in-series. Off by default: a started series contributes
  // only its next unfinished book, so a big backlog doesn't flood up-next.
  // Turn on to queue every remaining book in each started series.
  { id: 'new-in-series-all', on: false },
  { id: 'book-club', on: true },
  { id: 'manual', on: true },
]

interface BuildAutoQueueArgs {
  // All books in the active library (minified list shape).
  items: ABSLibraryItem[]
  // The library's series, books ordered by sequence (ABS series response order).
  series: ABSSeries[]
  // Per-item listening progress, keyed by libraryItemId.
  progressById: Map<string, ABSMediaProgress>
  // The book currently playing (excluded from the queue).
  currentItemId: string | null
  // Ordered, enabled rules (array order = priority).
  rules: AutoRulePref[]
  // Books the user's clubs are reading, in the order they should queue (each
  // club's current book, then its up-next queue). Drives the 'book-club' rule.
  // Carries its own title/author so a club book that isn't in the local library
  // list still produces a usable entry. Optional so existing callers are
  // unaffected; the rule no-ops when omitted.
  clubBooks?: QueueEntry[]
  // The user's durable hand-queued list, in their chosen order. Drives the
  // 'manual' rule so a hand-picked queue survives every Auto rebuild. Each
  // entry carries its own title/author, so a manual pick queues even if it's
  // not in this library's item list. Optional; the rule no-ops when omitted.
  manualBooks?: QueueEntry[]
}

function entryOf(item: ABSLibraryItem): QueueEntry {
  const m = item.media.metadata
  return {
    libraryItemId: item.id,
    title: m.title ?? 'Untitled',
    author: m.authorName ?? '',
  }
}

function isFinished(id: string, progressById: Map<string, ABSMediaProgress>): boolean {
  return !!progressById.get(id)?.isFinished
}

function isStarted(id: string, progressById: Map<string, ABSMediaProgress>): boolean {
  const p = progressById.get(id)
  return !!p && !p.isFinished && p.progress > 0
}

// Build the Auto-mode up-next list. Pure: same inputs -> same output. Rules run
// in priority order; each appends its books, then we de-dupe (first rule wins),
// drop the current book and anything finished.
export function buildAutoQueue({
  items,
  series,
  progressById,
  currentItemId,
  rules,
  clubBooks = [],
  manualBooks = [],
}: BuildAutoQueueArgs): QueueEntry[] {
  const itemById = new Map(items.map((i) => [i.id, i]))
  // Series that contain the current book (for "finish current series").
  const seriesOf = (id: string) => series.filter((s) => s.books.some((b) => b.id === id))

  const collected: QueueEntry[] = []
  const seen = new Set<string>()
  // Push a library-item id. `fallback` supplies title/author for ids not in the
  // library list (club books), so they still produce a usable entry. Returns
  // true if it actually added an entry (so callers can count real additions,
  // not skipped ones), false if it was dropped (current/finished/dupe/unknown).
  const push = (id: string, fallback?: QueueEntry): boolean => {
    if (id === currentItemId) return false
    if (isFinished(id, progressById)) return false
    const item = itemById.get(id)
    if (!item && !fallback) return false
    if (seen.has(id)) return false
    seen.add(id)
    collected.push(item ? entryOf(item) : (fallback as QueueEntry))
    return true
  }

  // Modifier flag: when on, new-in-series queues every remaining book in a
  // started series; when off (default), just the next unfinished one.
  const allNewInSeries = rules.some((r) => r.id === 'new-in-series-all' && r.on)

  for (const rule of rules) {
    if (!rule.on) continue
    applyRule(rule.id)
  }

  function applyRule(id: AutoRuleId) {
    if (id === 'finish-series') {
      if (!currentItemId) return
      for (const s of seriesOf(currentItemId)) {
        const idx = s.books.findIndex((b) => b.id === currentItemId)
        // Books after the current one, in sequence order.
        for (const b of s.books.slice(idx + 1)) push(b.id)
      }
    } else if (id === 'in-progress') {
      // Other books the user has started but not finished, most-recently-touched
      // first. Recency order matters: the book you just left (e.g. by switching
      // in the player carousel) is the newest-touched in-progress book after the
      // now-current one, so it lands at the top of up-next ("next up") rather
      // than wherever it happened to sit in the library's item order.
      const started = items.filter((it) => isStarted(it.id, progressById))
      started.sort((a, b) => {
        const la = Number(progressById.get(a.id)?.lastUpdate ?? 0)
        const lb = Number(progressById.get(b.id)?.lastUpdate ?? 0)
        return lb - la
      })
      for (const it of started) push(it.id)
    } else if (id === 'new-in-series') {
      // Series the user has started (any book finished or in progress) but not
      // completed: queue the next unfinished book in sequence. With the
      // new-in-series-all modifier on, queue every remaining unfinished book;
      // otherwise just the first one, so a large backlog of started series
      // doesn't flood up-next with dozens of books.
      for (const s of series) {
        const touched = s.books.some(
          (b) => isFinished(b.id, progressById) || isStarted(b.id, progressById),
        )
        const complete = s.books.every((b) => isFinished(b.id, progressById))
        if (!touched || complete) continue
        for (const b of s.books) {
          if (isFinished(b.id, progressById)) continue
          // Only count books that actually queued (push can skip the current
          // book, dupes already surfaced by an earlier rule, etc.), so a
          // limited series still contributes its first real 'next' book.
          const added = push(b.id)
          if (added && !allNewInSeries) break
        }
      }
    } else if (id === 'new-in-series-all') {
      // Modifier only (see new-in-series above / allNewInSeries). Queues nothing
      // on its own.
    } else if (id === 'book-club') {
      // What the user's clubs are reading (current book, then up-next), in the
      // order the caller supplied. Club books carry their own title/author, so
      // they queue even if they aren't in this library's item list.
      for (const b of clubBooks) push(b.libraryItemId, b)
    } else if (id === 'manual') {
      // The user's hand-queued list, in their order. De-dupe (via push/seen)
      // means a book an earlier rule already surfaced won't queue twice - the
      // manual list acts as a fallback for whatever the other rules didn't add.
      for (const b of manualBooks) push(b.libraryItemId, b)
    }
  }

  return collected
}

/** Last-writer-wins merge for the two queue states a client might be holding
 * (its own optimistic local state vs. what the server just returned). */
export function resolveQueueConflict<T extends { updatedAt: number }>(local: T, remote: T): T {
  return remote.updatedAt >= local.updatedAt ? remote : local
}

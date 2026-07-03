// Pure Auto-mode queue logic, shared by web and mobile so both build the same
// up-next list from the same rules. No I/O, no store access.

import type { ABSLibraryItem, ABSMediaProgress, ABSSeries } from '../types/abs'
import type { AutoRuleId, AutoRulePref, QueueEntry } from '../types/queue'

export const DEFAULT_AUTO_RULES: AutoRulePref[] = [
  { id: 'finish-series', on: true },
  { id: 'in-progress', on: true },
  { id: 'new-in-series', on: true },
  { id: 'book-club', on: true },
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
}: BuildAutoQueueArgs): QueueEntry[] {
  const itemById = new Map(items.map((i) => [i.id, i]))
  // Series that contain the current book (for "finish current series").
  const seriesOf = (id: string) => series.filter((s) => s.books.some((b) => b.id === id))

  const collected: QueueEntry[] = []
  const seen = new Set<string>()
  // Push a library-item id. `fallback` supplies title/author for ids not in the
  // library list (club books), so they still produce a usable entry.
  const push = (id: string, fallback?: QueueEntry) => {
    if (id === currentItemId) return
    if (isFinished(id, progressById)) return
    const item = itemById.get(id)
    if (!item && !fallback) return
    if (seen.has(id)) return
    seen.add(id)
    collected.push(item ? entryOf(item) : (fallback as QueueEntry))
  }

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
      // Other books the user has started but not finished.
      for (const it of items) {
        if (isStarted(it.id, progressById)) push(it.id)
      }
    } else if (id === 'new-in-series') {
      // Series the user has started (any book finished or in progress) but not
      // completed: queue the remaining unfinished books in sequence.
      for (const s of series) {
        const touched = s.books.some(
          (b) => isFinished(b.id, progressById) || isStarted(b.id, progressById),
        )
        const complete = s.books.every((b) => isFinished(b.id, progressById))
        if (!touched || complete) continue
        for (const b of s.books) {
          if (!isFinished(b.id, progressById)) push(b.id)
        }
      }
    } else if (id === 'book-club') {
      // What the user's clubs are reading (current book, then up-next), in the
      // order the caller supplied. Club books carry their own title/author, so
      // they queue even if they aren't in this library's item list.
      for (const b of clubBooks) push(b.libraryItemId, b)
    }
  }

  return collected
}

/** Last-writer-wins merge for the two queue states a client might be holding
 * (its own optimistic local state vs. what the server just returned). */
export function resolveQueueConflict<T extends { updatedAt: number }>(local: T, remote: T): T {
  return remote.updatedAt >= local.updatedAt ? remote : local
}

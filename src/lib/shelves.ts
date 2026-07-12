// Pure builders for the Auto-source home shelves, shared by web and mobile so
// every surface shows the same "Continue Series" / "Continue Listening" content
// the Auto queue draws from. These EXPOSE the queue's sources as browsable
// shelves; the same dismissals that hide a series/book from the queue hide it
// here too. No I/O, no store access.

import type { ABSLibraryItem, ABSMediaProgress, ABSSeries } from '../types/abs'
import type { Dismissals } from '../types/queue'

function isFinished(id: string, progressById: Map<string, ABSMediaProgress>): boolean {
  return !!progressById.get(id)?.isFinished
}

function isStarted(id: string, progressById: Map<string, ABSMediaProgress>): boolean {
  const p = progressById.get(id)
  return !!p && !p.isFinished && p.progress > 0
}

export interface ContinueSeriesEntry {
  series: ABSSeries
  // The next unfinished book in the series (what the Auto queue would add).
  nextBook: ABSLibraryItem
}

/**
 * "Continue Series" shelf source: every started-but-unfinished series, with its
 * next unfinished book. Mirrors the new-in-series rule (one book per series),
 * minus dismissed series. Sorted by the next book's most-recent progress so the
 * series you touched last leads.
 */
export function continueSeriesShelf(
  series: ABSSeries[],
  progressById: Map<string, ABSMediaProgress>,
  dismissed: Dismissals,
): ContinueSeriesEntry[] {
  const hiddenSeries = new Set(dismissed.seriesIds)
  const out: ContinueSeriesEntry[] = []
  for (const s of series) {
    if (hiddenSeries.has(s.id)) continue
    const touched = s.books.some(
      (b) => isFinished(b.id, progressById) || isStarted(b.id, progressById),
    )
    const complete = s.books.every((b) => isFinished(b.id, progressById))
    if (!touched || complete) continue
    const nextBook = s.books.find((b) => !isFinished(b.id, progressById))
    if (!nextBook) continue
    out.push({ series: s, nextBook })
  }
  // Most-recently-progressed series first (recency of the next book's row).
  out.sort((a, b) => {
    const la = Number(progressById.get(a.nextBook.id)?.lastUpdate ?? 0)
    const lb = Number(progressById.get(b.nextBook.id)?.lastUpdate ?? 0)
    return lb - la
  })
  return out
}

/**
 * "Continue Listening" shelf source: books started but not finished, most-
 * recently-touched first, minus dismissed items. Mirrors the in-progress rule.
 * `currentItemId` (the now-playing book) is excluded so the shelf is "what else
 * is in progress".
 */
export function continueListeningShelf(
  items: ABSLibraryItem[],
  progressById: Map<string, ABSMediaProgress>,
  dismissed: Dismissals,
  currentItemId?: string | null,
): ABSLibraryItem[] {
  const hiddenItems = new Set(dismissed.itemIds)
  const out = items.filter(
    (it) => it.id !== currentItemId && !hiddenItems.has(it.id) && isStarted(it.id, progressById),
  )
  out.sort((a, b) => {
    const la = Number(progressById.get(a.id)?.lastUpdate ?? 0)
    const lb = Number(progressById.get(b.id)?.lastUpdate ?? 0)
    return lb - la
  })
  return out
}

/** True if a series is currently dismissed. */
export function isSeriesDismissed(seriesId: string, dismissed: Dismissals): boolean {
  return dismissed.seriesIds.includes(seriesId)
}

/** True if a book is currently dismissed. */
export function isItemDismissed(itemId: string, dismissed: Dismissals): boolean {
  return dismissed.itemIds.includes(itemId)
}

// Pure series-completeness logic shared by every HearthShelf surface (self-hosted
// web, hosted web app, mobile). ABS only knows the books you OWN in a series; the
// full series roster comes from Audible (GET /hs/audible/series). These helpers
// dedupe owned vs. Audible to find the "unowned" gap and fold it into a single
// completion figure so all three clients compute identically. No I/O, no client
// types - callers pass plain values.

import type { HSAudibleSeriesBook } from '../types/hs'

// The dedup key that pairs an owned library book with an Audible catalog entry.
// ABS has no cross-catalog id, so we match on title + author, case-folded and
// trimmed. Kept in one place so owned-side and Audible-side keys never drift.
export function ownedKeyOf(
  title: string | null | undefined,
  author: string | null | undefined,
): string {
  return `${(title ?? '').trim()}|${(author ?? '').trim()}`.toLowerCase()
}

// Audible entries for a series that aren't in the owned set - the "unowned"
// books. Filters out untitled entries (nothing to dedupe or show) and any whose
// owned-key is already present, then orders by numeric Audible sequence so they
// slot in after the owned books in reading order.
export function missingSeriesBooks(
  audibleBooks: readonly HSAudibleSeriesBook[],
  ownedKeys: ReadonlySet<string>,
): HSAudibleSeriesBook[] {
  return audibleBooks
    .filter((b) => b.title && !ownedKeys.has(ownedKeyOf(b.title, b.author)))
    .sort((a, b) => (parseFloat(a.sequence ?? '') || 0) - (parseFloat(b.sequence ?? '') || 0))
}

export interface SeriesCompletion {
  // Listening completion as a 0..1 fraction. Denominator is the FULL series
  // (owned + missing) when the Audible roster resolved, else owned-only.
  pct: number
  // Books the user owns in this series.
  ownedCount: number
  // Books in the series the user doesn't own (0 when unresolved).
  missingCount: number
  // ownedCount + missingCount - the full series size we measured against.
  totalCount: number
  // Whether missing books were factored into pct (i.e. the Audible roster
  // resolved and actually had entries beyond what's owned).
  countsMissing: boolean
}

// Fold owned listening progress and the unowned gap into one completion figure.
//
// `ownedProgressSum` is the sum of per-owned-book progress where a finished book
// counts as 1.0 and an in-progress book its 0..1 fraction (exactly what the
// series pages already accumulate). Missing books contribute 0 to the numerator
// but DO enlarge the denominator, so owning 3 of 4 and finishing all 3 reads 75%.
//
// When the series roster couldn't be resolved (missingCount 0, e.g. no Audible
// match or offline) this degrades to the classic owned-only percentage.
export function seriesCompletion(input: {
  ownedProgressSum: number
  ownedCount: number
  missingCount: number
}): SeriesCompletion {
  const { ownedProgressSum, ownedCount, missingCount } = input
  const totalCount = ownedCount + missingCount
  const pct = totalCount > 0 ? ownedProgressSum / totalCount : 0
  return {
    pct,
    ownedCount,
    missingCount,
    totalCount,
    countsMissing: missingCount > 0,
  }
}

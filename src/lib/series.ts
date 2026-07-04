// Pure series-completeness logic shared by every HearthShelf surface (self-hosted
// web, hosted web app, mobile). ABS only knows the books you OWN in a series; the
// full series roster comes from Audible (GET /hs/audible/series). These helpers
// dedupe owned vs. Audible to find the "unowned" gap and fold it into a single
// completion figure so all three clients compute identically. No I/O, no client
// types - callers pass plain values.

import type { HSAudibleSeriesBook } from '../types/hs'

// Normalize a book title for cross-catalog matching. ABS and Audible format the
// same title differently (subtitles, ", Book 4" suffixes, punctuation, spacing),
// which used to make owned books look unowned. Strip a trailing series/volume
// suffix, drop everything after a colon (subtitle), remove punctuation, and
// collapse whitespace so "Taken to the Stars, Book 4" and "Taken to the Stars"
// compare equal.
export function normalizeTitle(title: string | null | undefined): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/:\s.*$/, '') // drop subtitle after a colon
    .replace(/[,\-–—]?\s*(book|volume|vol|part|#)\s*\d+(\.\d+)?\s*$/i, '') // trailing "Book 4"
    .replace(/[^\p{L}\p{N}\s]/gu, '') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

// A number key for a series sequence ("4", "2.5", "#4 ") -> "4"/"2.5", or '' when
// there's no parseable number. Used as the primary match signal: within one
// resolved series, same sequence == same book regardless of title/author text.
export function seqKey(sequence: string | number | null | undefined): string {
  if (sequence == null) return ''
  const n = parseFloat(String(sequence).replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? String(n) : ''
}

// Parse a book's sequence within a series from ABS's denormalized seriesName,
// e.g. "Taken to the Stars #4" -> "4", "Foundation #2.5" -> "2.5". '' when none.
// Clients build owned-book match info with this so every surface parses alike.
export function seriesSeqFromName(seriesName: string | null | undefined): string {
  const m = (seriesName ?? '').match(/#\s*([\d.]+)\s*$/)
  return m ? m[1] : ''
}

// An owned book, reduced to just what series-matching needs. `sequence` is the
// book's position in THIS series (parsed from ABS's denormalized seriesName,
// e.g. "Taken to the Stars #4" -> "4"); pass null/'' when unknown.
export interface OwnedSeriesBook {
  title: string | null | undefined
  sequence?: string | number | null
}

// Audible entries for a series that aren't among the owned books - the "unowned"
// books. When the server has stamped each roster book with an `owned` flag (the
// ASIN-accurate, library-wide precompute), that is authoritative and used
// directly. Otherwise (older servers) it falls back to matching the roster
// against `ownedBooks` by series SEQUENCE first (the reliable signal inside one
// series), then by normalized title - so differently-formatted titles/authors or
// duplicate owned copies don't read as missing. Ordered by numeric sequence.
export function missingSeriesBooks(
  audibleBooks: readonly HSAudibleSeriesBook[],
  ownedBooks: readonly OwnedSeriesBook[],
): HSAudibleSeriesBook[] {
  const bySequence = (a: HSAudibleSeriesBook, b: HSAudibleSeriesBook) =>
    (parseFloat(a.sequence ?? '') || 0) - (parseFloat(b.sequence ?? '') || 0)

  // Server-provided owned flags are authoritative when present on any book.
  if (audibleBooks.some((b) => typeof b.owned === 'boolean')) {
    return audibleBooks.filter((b) => b.title && b.owned === false).sort(bySequence)
  }

  const ownedSeqs = new Set<string>()
  const ownedTitles = new Set<string>()
  for (const b of ownedBooks) {
    const s = seqKey(b.sequence)
    if (s) ownedSeqs.add(s)
    const t = normalizeTitle(b.title)
    if (t) ownedTitles.add(t)
  }
  return audibleBooks
    .filter((b) => {
      if (!b.title) return false
      const s = seqKey(b.sequence)
      if (s && ownedSeqs.has(s)) return false
      return !ownedTitles.has(normalizeTitle(b.title))
    })
    .sort(bySequence)
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

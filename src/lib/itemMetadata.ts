// Guards for the editable-metadata payload (PATCH /api/items/:id/media), shared
// by every HearthShelf surface so all of them send ABS the same well-formed
// body. Pure functions, no I/O.
//
// These exist because ABS fails SILENTLY on malformed input rather than
// erroring, which surfaces as "some of my edits saved and some didn't":
//
//   - updateSeriesFromRequest bails on the WHOLE series update (returns null)
//     if any entry lacks a non-empty string `name`, while every other field in
//     the same request still saves.
//   - `sequence` is read as
//     `typeof seriesObj.sequence === 'string' ? seriesObj.sequence : null`, so
//     a numeric 3 WIPES the position instead of setting it.
//   - The controller drops author entries whose `name` isn't a string.
//
// Verified against AudiobookShelf 2.36.0 (server/models/Book.js,
// server/controllers/LibraryItemController.js).

import type { ABSItemAuthorPatch, ABSItemSeriesPatch } from '../types/abs.ts'

/**
 * Drop series entries ABS would reject and coerce `sequence` to the string it
 * requires (or null when blank), so a malformed row can't silently discard the
 * whole series update.
 */
export function normalizeSeriesPatch(
  series: readonly ABSItemSeriesPatch[],
): ABSItemSeriesPatch[] {
  return series
    .map((s) => ({ name: String(s?.name ?? '').trim(), sequence: s?.sequence }))
    .filter((s) => s.name.length > 0)
    .map((s) => {
      const seq = s.sequence == null ? '' : String(s.sequence).trim()
      return { name: s.name, sequence: seq === '' ? null : seq }
    })
}

/** Drop author entries without a usable name; ABS discards them server-side. */
export function normalizeAuthorsPatch(
  authors: readonly ABSItemAuthorPatch[],
): ABSItemAuthorPatch[] {
  return authors
    .map((a) => ({ name: String(a?.name ?? '').trim() }))
    .filter((a) => a.name.length > 0)
}

/** Drop blank entries from a string list field (narrators, genres, tags). */
export function normalizeStringList(values: readonly (string | null | undefined)[]): string[] {
  return values.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0)
}

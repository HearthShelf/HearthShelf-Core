// The user's own star ratings (book_ratings / GET+PUT /hs/ratings).
//
// The key space is polymorphic because not every rateable book exists in ABS. A
// finished-books row imported from Goodreads may name a book the server does not
// own (a "stub", library_item_id NULL), and those are exactly the rows the
// Hardcover write-through most needs a rating for. So a key is either a bare ABS
// library item id, or 'fb:' + the finished_books row id for a stub.
//
// Every UI surface deals only in owned books and therefore only ever sees bare
// item ids; the prefixed form exists solely on the Hardcover sync path.

import { HS_RATING_MIN, HS_RATING_MAX } from '../types/hs.ts'

export const FINISHED_BOOK_KEY_PREFIX = 'fb:'

/** The rating key for an owned book. */
export function ratingKeyForItem(libraryItemId: string): string {
  return libraryItemId
}

/** The rating key for a finished-books row: its ABS item when matched, else a
 *  key namespaced to the row itself so an unowned book can still be rated. */
export function ratingKeyForFinishedBook(book: {
  id: string
  libraryItemId: string | null
}): string {
  return book.libraryItemId ?? FINISHED_BOOK_KEY_PREFIX + book.id
}

/** True when a key refers to a finished-books stub rather than an ABS item. */
export function isFinishedBookKey(key: string): boolean {
  return key.startsWith(FINISHED_BOOK_KEY_PREFIX)
}

/** Shared by the settings UI and the server's PUT handler so the accepted range
 *  cannot drift between them. */
export function isValidRating(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= HS_RATING_MIN &&
    value <= HS_RATING_MAX
  )
}

// The "how was it?" prompt shown after you finish a book.
//
// One rating notification is created per NEW completion (jobs/statsSnapshot.js,
// off the same recordFinishObservation signal that tallies re-reads), and it is
// answered in place: five stars, or Skip. There is no separate rating screen to
// route to, which is the whole point - a prompt you have to navigate away to
// answer is a prompt people abandon.
//
// The kind string is 'rating' on the wire (notifications.kind) and 'rating' as a
// NotifyType. Those are deliberately the same word so the delivery-prefs lookup
// and the inbox row cannot drift apart.

import { HS_RATING_MIN, HS_RATING_MAX } from '../types/hs.ts'

/** notifications.kind for a finished-book rating prompt. */
export const RATING_NOTIFICATION_KIND = 'rating'

/** The `data` blob carried by a rating notification. `itemKey` is what a rating
 *  write is keyed by (see ratings.ts), kept distinct from the media id so the
 *  client never has to re-derive it. */
export interface RatingPromptData {
  /** ABS library item id - what the client rates and routes to. */
  itemKey: string
  /** ABS media id (books.id). The dedupe/entity identity on the server side. */
  mediaItemId?: string
  title?: string
  author?: string
}

/** The stars a prompt offers, low to high. Derived from the shared 1-5 bounds so
 *  a change to the rating scale reaches the UI without a second edit. */
export const RATING_PROMPT_VALUES: readonly number[] = Array.from(
  { length: HS_RATING_MAX - HS_RATING_MIN + 1 },
  (_, i) => HS_RATING_MIN + i,
)

/** Accessible label for one star button. Spelled out ("1 star" / "4 stars")
 *  because a screen reader announcing a bare number next to four other bare
 *  numbers tells you nothing about what tapping it does. */
export function ratingStarLabel(value: number): string {
  return value === 1 ? '1 star' : `${value} stars`
}

/** Title for the inbox row. The book's name carries the row, so the title is
 *  the question - the row should read as something to answer, not as an
 *  announcement that you finished a book (you know; you were there). */
export function ratingPromptTitle(title?: string): string {
  return title ? `How was ${title}?` : 'How was your last book?'
}

/** Body copy. Names the author when known, and always says the rating is
 *  private - people rate more honestly when they know it is not broadcast. */
export function ratingPromptBody(author?: string): string {
  const who = author ? `You finished it - ${author}` : 'You finished it'
  return `${who}. Rate it just for you, or skip.`
}

/** Confirmation shown after a rating lands, just before the row clears itself. */
export function ratingSavedMessage(value: number): string {
  return `Rated ${ratingStarLabel(value)}`
}

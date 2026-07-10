// Listening queue - shared by web, mobile, and the /hs/queue backend route.
// The queue *items* persist server-side (one row per user, see docs/queue.md
// in HearthShelf); mode + auto-rules are user preferences and ride along in
// the existing settings sync instead.

export interface QueueEntry {
  libraryItemId: string
  title: string
  author: string
}

// How the up-next queue behaves when a book ends:
//  - off:      stop at the end of each book
//  - manual:   play the next book the user queued by hand
//  - auto:     rebuild up-next from the smart rules (see lib/queue)
//  - playlist: follow a chosen ABS playlist in order
export type QueueMode = 'off' | 'manual' | 'auto' | 'playlist'

// Ordered, toggleable rules that drive Auto mode. Order = priority.
//  - new-in-series: for each started-but-unfinished series, queue the next
//    unfinished book. By default just ONE book per series (the natural
//    'read next'), so a big backlog of started series doesn't flood up-next.
//  - new-in-series-all: a MODIFIER on new-in-series (not a source of its own):
//    when both are on, new-in-series queues EVERY remaining unfinished book in
//    each series instead of only the next one. No effect unless new-in-series
//    is also on.
//  - manual: the books the user queued by hand (their durable manual list),
//    spliced into Auto at this rule's position so a hand-picked queue survives
//    every Auto rebuild instead of being overwritten. In Manual mode this same
//    list is the whole queue.
export type AutoRuleId =
  'finish-series' | 'in-progress' | 'new-in-series' | 'new-in-series-all' | 'book-club' | 'manual'

export interface AutoRulePref {
  id: AutoRuleId
  on: boolean
}

/** The /hs/queue GET/PUT payload. `updatedAt` (ms) is the conflict key - the
 * server rejects a PUT whose updatedAt is older than the stored row.
 *
 * `items` is the ACTIVE up-next list the player pops from - in Auto/Playlist
 * mode it's rebuilt (ephemeral); in Manual mode it mirrors `manual`. `manual`
 * is the user's DURABLE hand-queued list: it drives Manual mode and, in Auto
 * mode, is spliced in at the 'manual' rule's position. Auto rebuilds never
 * overwrite `manual`. */
export interface QueueState {
  items: QueueEntry[]
  manual: QueueEntry[]
  playlistId: string | null
  updatedAt: number
}

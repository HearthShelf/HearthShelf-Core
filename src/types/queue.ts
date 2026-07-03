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
export type AutoRuleId = 'finish-series' | 'in-progress' | 'new-in-series' | 'book-club'

export interface AutoRulePref {
  id: AutoRuleId
  on: boolean
}

/** The /hs/queue GET/PUT payload. `updatedAt` (ms) is the conflict key - the
 * server rejects a PUT whose updatedAt is older than the stored row. */
export interface QueueState {
  items: QueueEntry[]
  playlistId: string | null
  updatedAt: number
}

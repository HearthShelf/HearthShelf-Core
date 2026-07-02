// Social (HearthShelf backend, /hs/social/*)
// Cross-user data ABS won't serve to non-admins; read from ABS's database by our
// backend. `available` is false when ABS's db isn't mapped, so the UI hides it.
// Design doc: HearthShelf docs/social.md.

export interface HSLeaderboardEntry {
  rank: number
  userId: string
  username: string
  booksFinished: number
  secondsListened: number
  isMe: boolean
}

/** Leaderboard time window. Servers without windowing support serve 'all' only. */
export type LeaderboardWindow = 'week' | 'month' | 'all'

export interface HSLeaderboardResponse {
  available: boolean
  me: HSLeaderboardEntry | null
  entries: HSLeaderboardEntry[]
  /** Echoed window actually served; absent on older servers (= 'all'). */
  window?: LeaderboardWindow
  /** False when the server can only serve all-time (date-format probe failed
   * or older server, where the field is absent). */
  windowsAvailable?: boolean
}

export interface HSFinishedCount {
  available: boolean
  count: number
}

/** One user who finished a book, privacy-filtered server-side. */
export interface HSFinishedByUser {
  userId: string
  username: string
  /** ms epoch of the latest finish; ABS keeps no finish history. */
  finishedAt: number | null
}

export interface HSFinishedByResponse {
  available: boolean
  users: HSFinishedByUser[]
}

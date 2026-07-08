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

// --- Compare (HearthShelf backend, /hs/social/compare) ---
// The caller's own numbers alongside a comparison target's: the whole-server
// aggregate (scope=server, no identity leaked) or a single opted-in user
// (?userId, drawn only from the leaderboard's privacy-filtered roster). Read
// from ABS's database like the rest of /hs/social. See HearthShelf's stats plan.

/** A comparable set of listening totals for one subject (the caller, a user, or
 * the server aggregate). Seconds + finished-book counts, no identity. */
export interface HSCompareStats {
  booksFinished: number
  secondsListened: number
  /** Distinct days with any listening, when available (server aggregate omits). */
  activeDays: number | null
}

/** GET /hs/social/compare response. `me` is always the caller's numbers;
 * `target` is the comparison subject. For scope=server, `target` holds the
 * per-user AVERAGE across eligible users and `scope` is 'server'; for a user
 * comparison `scope` is 'user' and `username`/`userId` name the target.
 * `available` is false when the ABS database isn't mounted. */
export interface HSCompareResponse {
  available: boolean
  scope: 'server' | 'user'
  me: HSCompareStats
  target: HSCompareStats
  /** Present only for a user comparison. */
  userId?: string
  username?: string
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

// --- Listening now (Phase 3) ---
// Who is actively (recently) listening to a book. New privacy surface, default
// OFF; the server filters by the shareCurrentlyListening resolution. UI copy
// says "listening recently", not "online". See docs/social.md.

/** One user actively listening to a book right now-ish. */
export interface HSListeningNowUser {
  userId: string
  username: string
}

/** Listening-now for a single item (GET ?libraryItemId=). */
export interface HSListeningNowResponse {
  available: boolean
  users: HSListeningNowUser[]
}

/** Listening-now for many items at once (POST {libraryItemIds}, capped 100). */
export interface HSListeningNowBulkResponse {
  available: boolean
  byItem: Record<string, HSListeningNowUser[]>
}

// --- Public notes (Phase 4) ---
// Per-book notes with server-side spoiler gating by playback position. The
// server returns full notes only where allowed and anonymous locked stubs for
// ahead-notes (timeline ticks + club pops). See docs/social.md.

/** Who can read a note. 'club' = members of clubId; 'public' = everyone on the
 * server; 'personal' = only the author (the server filters these to the author,
 * so other callers never receive them). See docs/social.md. */
export type NoteVisibility = 'club' | 'public' | 'personal'

/** A club, public, or personal note. clubId '' for public/personal; parentId ''
 * = top-level (a reply gates at its PARENT's timeSec); timeSec null = general
 * (ungated) note. `safe` = author-declared spoiler-free, so it bypasses the
 * position gate and shows to everyone regardless of playback position (still
 * carries timeSec for the scrubber marker). `safe` applies only to top-level
 * notes; replies never inherit it. */
export interface HSNote {
  id: string
  userId: string
  username: string
  libraryItemId: string
  clubId: string
  visibility: NoteVisibility
  parentId: string
  timeSec: number | null
  safe: boolean
  body: string
  createdAt: number
}

/** Anonymous stub for a locked ahead-note: id + timestamp only, no body/author/
 * date. Powers timeline ticks and club pops without leaking spoilers. */
export interface HSNoteStub {
  id: string
  timeSec: number
}

/** GET /hs/notes response: unlocked notes, locked stubs (club scope only),
 * hiddenAhead count, and the server clock for pop timing. */
export interface HSNotesResponse {
  enabled: boolean
  notes: HSNote[]
  locked: HSNoteStub[]
  hiddenAhead: number
  now: number
}

// --- Book Club (Phase 5) ---
// Persistent multi-book reading groups. A club has a book history (past books +
// one current book), per-book chat, member progress race, and unread cursors.
// See docs/social.md.

/** One book in a club's reading timeline. A book is in exactly one of three
 * states: queued (queuedAt set, not yet started), current (started, finishedAt
 * null), or finished (finishedAt stamped). title/author are snapshots so the
 * timeline renders even if the item later leaves ABS. */
export interface HSClubBook {
  libraryItemId: string
  title: string
  author: string
  addedBy: string
  /** ms epoch when this book became the current book, or 0 while it's queued. */
  startedAt: number
  finishedAt: number | null
  /** ms epoch when the book was added to the up-next queue; null once it has
   * been promoted to the current book (or if it was never queued). */
  queuedAt: number | null
}

/** What the club's next-book recommendation is based on:
 *   off                  - the owner has turned recommendations off for this club
 *   club-history         - the genres of books the club has read together
 *   all-members-finished - the genres every member has finished (read from ABS)
 * Only the owner sets it; default is club-history. See docs/social.md. */
export type ClubRecBasis = 'off' | 'club-history' | 'all-members-finished'

/** A club summary. currentBook is the one book with finishedAt null, or null if
 * the club has no current book. */
export interface HSClub {
  id: string
  name: string
  createdBy: string
  isOpen: boolean
  archived: boolean
  createdAt: number
  memberCount: number
  currentBook: HSClubBook | null
  /** The basis the owner chose for next-book recommendations. */
  recBasis: ClubRecBasis
}

/** One recommended next book for a club, resolved to a real library item so the
 * owner can add it straight to the club's up-next queue. */
export interface ClubRecPick {
  libraryItemId: string
  title: string
  author: string
  genre: string
  /** One warm sentence on why it fits the club. */
  reason: string
}

/** POST /hs/clubs/:id/recommend response. `engine` says whether the picks came
 * from the AI provider or the deterministic fallback; `basis` echoes what they
 * were built from. picks is empty when the library has no fitting candidate. */
export interface ClubRecommendation {
  engine: 'ai' | 'heuristic'
  basis: ClubRecBasis
  intro: string
  picks: ClubRecPick[]
}

/** A club member with their progress in the book being viewed. Progress fields
 * (currentTime, duration, isFinished) are null when the server has no ABS db
 * mounted. */
export interface HSClubMember {
  userId: string
  username: string
  role: 'owner' | 'member'
  joinedAt: number
  currentTime: number | null
  duration: number | null
  isFinished: boolean | null
  listeningNow: boolean
}

/** GET /hs/clubs response: the caller's clubs and open clubs joinable for an
 * item (joinable = open clubs whose current book is that item). */
export interface HSClubsResponse {
  enabled: boolean
  mine: HSClub[]
  joinable: HSClub[]
}

/** GET /hs/clubs/:id response: the club, its book history (current + finished,
 * ordered by startedAt), the up-next queue (ordered by queuedAt), members with
 * progress in the viewed book, that book's notes (gated), and the unread count.
 * locked stubs are only present for the current book. */
export interface HSClubDetail {
  enabled: boolean
  club: HSClub
  books: HSClubBook[]
  /** Books lined up to read next, ordered oldest-queued first. The owner
   * promotes the front of this list to become the current book. */
  queue: HSClubBook[]
  members: HSClubMember[]
  notes: {
    notes: HSNote[]
    locked: HSNoteStub[]
    hiddenAhead: number
  }
  unreadCount: number
}

// --- Timeline markers (shared player scrubber) ---

/** A clustered scrubber marker built by clusterTimelineMarkers. fraction is the
 * cluster's mean position (0..1 clamped); kind is 'mixed' when a cluster holds
 * both unlocked notes and locked stubs; items carries the clustered inputs. */
export interface TimelineMarker {
  fraction: number
  kind: 'note' | 'stub' | 'mixed'
  count: number
  items: Array<{
    id: string
    timeSec: number
    kind: 'note' | 'stub'
    userId?: string
    username?: string
  }>
}

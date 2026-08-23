// Social (HearthShelf backend, /hs/social/*)
// Cross-user data ABS won't serve to non-admins; read from ABS's database by our
// backend. `available` is false when ABS's db isn't mapped, so the UI hides it.
// Design doc: HearthShelf docs/social.md.

import type { NoteReactionKind } from '../lib/noteReactions.ts'

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
  /** Average seconds listened per active day. For the server aggregate this is
   * the mean of each user's own average. Absent on older servers (treat as
   * undefined -> omit the row). */
  avgPerActiveDaySec?: number
  /** Books finished this year (caller-local year). null when the server didn't
   * compute it; absent on older servers. */
  booksThisYear?: number | null
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

// --- User profile (HearthShelf backend, /hs/social/profile) ---
// Everything one user's profile page shows, in a single round trip. Three
// independent privacy gates apply server-side (see the route): a roster gate
// that 403s for users who aren't shareable at all, then shareReadBooks for
// `finished` and shareCurrentlyListening for `listening`. The caller always
// sees their own profile in full.

/** What a user is listening to now, or last listened to. `isLive` is true when
 * their latest book session updated within the presence window (~3 min) - the
 * same signal listening-now uses, so the UI can say "listening now" vs "last
 * listened". Progress fields come from their mediaProgresses row for the item. */
export interface HSProfileListen {
  libraryItemId: string
  title: string
  author: string
  narrator: string
  durationSec: number
  currentTimeSec: number
  /** 0..1 fraction complete, as ABS stores it. */
  progress: number
  isFinished: boolean
  /** ms epoch of the last session update; null when unparseable. */
  lastListenedAt: number | null
  isLive: boolean
}

/** One finished book on a profile. `alsoMine` is true when the CALLER has also
 * finished it - computed server-side so the shared-books view needs no second
 * request. Always false when viewing your own profile. */
export interface HSProfileBook {
  libraryItemId: string
  title: string
  finishedAt: number | null
  alsoMine: boolean
}

/** A named thing and how often it came up in a year (an author or narrator by
 * books finished, a series by books). */
export interface HSYearTally {
  name: string
  count: number
}

/** One year of a listener's finishes, recapped. Every highlight is nullable
 * because a year can lack the data to compute it: a library with no durations
 * yields no longest/shortest, a book with no author yields no topAuthor.
 *
 * Note ABS overwrites finishedAt on a re-finish and keeps no completion
 * history, so a re-read book counts only toward the year it was LAST finished
 * in. */
export interface HSYearInReview {
  year: number
  /** Books finished in this year. */
  books: number
  /** Their combined length, in seconds. */
  seconds: number
  longest: { title: string; durationSec: number } | null
  shortest: { title: string; durationSec: number } | null
  topAuthor: HSYearTally | null
  /** A book with several narrators counts toward each. */
  topNarrator: HSYearTally | null
  topSeriesByBooks: HSYearTally | null
  /** The series they spent the most listening time in, seconds. */
  topSeriesByTime: { name: string; seconds: number } | null
  /** Series whose first finish landed in this year. */
  seriesStarted: number
}

/** GET /hs/social/profile?userId= response. `me`/`target` are the same compare
 * shape the compare endpoint serves, so the profile can render side-by-side
 * bars. `readShared`/`listeningShared` report which sections the target opted
 * into: when false, the matching field is empty and the UI shows "not shared"
 * rather than "nothing here". `available` is false when ABS's db isn't mounted;
 * the route 403s (not_shareable) for a user off the visibility roster. */
export interface HSProfileResponse {
  available: boolean
  userId: string
  username: string
  isMe: boolean
  me: HSCompareStats
  target: HSCompareStats
  readShared: boolean
  listeningShared: boolean
  listening: HSProfileListen | null
  finished: HSProfileBook[]
  /** How many of `finished` the caller has also finished. */
  sharedCount: number
  /** Per-year recap, newest year first. Gated by the same `readShared` flag as
   *  `finished`, so it is empty when the reading list is private. Absent on
   *  older servers - treat a missing field as []. */
  yearsInReview?: HSYearInReview[]
}

/** One user's relationship to a book, privacy-filtered server-side. 'finished'
 * readers are gated by shareReadBooks; 'reading' (started, not finished) by
 * shareCurrentlyListening. Absent status means 'finished' (older servers). */
export interface HSFinishedByUser {
  userId: string
  username: string
  /** ms epoch of the latest finish; ABS keeps no finish history. null while
   * 'reading' (not yet finished). */
  finishedAt: number | null
  status?: 'finished' | 'reading'
}

export interface HSFinishedByResponse {
  available: boolean
  users: HSFinishedByUser[]
}

/** Who finished many items at once (POST {libraryItemIds}, capped 100). For
 * reader-avatar stacks on library/browse cards. Same privacy filter as the
 * single-item finished-by. */
export interface HSFinishedByBulkResponse {
  available: boolean
  byItem: Record<string, HSFinishedByUser[]>
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
 * = top-level (a reply always gates at its parent and may add its own explicit
 * position gate); timeSec null = general
 * (ungated) note. `safe` = author-declared spoiler-free, so it bypasses the
 * position gate and shows to everyone regardless of playback position (still
 * carries timeSec for the scrubber marker). `safe` applies only to top-level
 * notes; replies never inherit it. */
/** Someone addressed by an @mention in a note.
 *
 * `userId` is the identity - mentions are stored and delivered by id, never by
 * re-parsing the body, so a later username change can't re-point a mention at
 * someone else or orphan it. `username` is only the display snapshot taken when
 * the note was written. */
export interface HSNoteMention {
  userId: string
  username: string
}

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
  /** Author-marked spoiler text. This is a visual reveal affordance and is
   * independent of the playback-position gate controlled by `safe`/timeSec. */
  spoiler: boolean
  body: string
  createdAt: number
  /** ms epoch of the latest edit, or null when the note has never been edited. */
  updatedAt: number | null
  /** Club members addressed with @. Absent/empty when the note mentions nobody. */
  mentions?: HSNoteMention[]
  /** Reaction tallies, one entry per kind that has at least one reactor.
   *  Absent/empty when nobody has reacted. */
  reactions?: HSNoteReaction[]
}

/** The reactions a note can carry.
 *
 * A kind is EITHER a raw emoji or one of three legacy names ('up' | 'heart' |
 * 'laugh') stored before reactions accepted emoji. New reactions always store
 * the emoji itself, so the kind IS the glyph and any client can render any
 * reaction without a lookup table.
 *
 * See lib/noteReactions.ts for validation, normalization, and the glyph/label
 * helpers that keep the legacy names rendering. */
export type { NoteReactionKind }

/** One kind's tally on a note. `mine` is whether the calling user is among the
 *  reactors, so a client never has to fetch the reactor list to render state. */
export interface HSNoteReaction {
  kind: NoteReactionKind
  count: number
  mine: boolean
}

/** One reader listed in the reaction-detail tray. */
export interface HSNoteReactionUser {
  userId: string
  username: string
  reactedAt: number
}

/** The readers behind one reaction kind. */
export interface HSNoteReactionDetail {
  kind: NoteReactionKind
  users: HSNoteReactionUser[]
}

/** POST /hs/notes/:id/reactions body. Toggling is explicit rather than implied,
 *  so a double-tap that races itself converges instead of flipping twice. */
export interface HSNoteReactionBody {
  kind: NoteReactionKind
  on: boolean
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

/** One book in a club's reading timeline. A book is in exactly one of four
 * states: queued (queuedAt set, not yet started), current (started, finishedAt
 * and abandonedAt both null), finished (finishedAt stamped), or set aside
 * (abandonedAt stamped - started but shelved without finishing). title/author
 * are snapshots so the timeline renders even if the item later leaves ABS. */
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
  /** ms epoch when the club set this book aside without finishing it. A set
   * aside book left the current slot but was never read to the end, so it is
   * not a past read. Mutually exclusive with finishedAt. */
  abandonedAt: number | null
  /** Owner-controlled position in the up-next queue, ascending. Only meaningful
   * while queuedAt is set. */
  sortOrder: number
}

/** What the club's next-book recommendation is based on:
 *   off                  - the owner has turned recommendations off for this club
 *   club-history         - the genres of books the club has read together
 *   all-members-finished - the genres every member has finished (read from ABS)
 * Only the owner sets it; default is club-history. See docs/social.md. */
export type ClubRecBasis = 'off' | 'club-history' | 'all-members-finished'

/** Who can discover and join a book club. Closed clubs are invite-only; public
 * clubs appear in the server-wide directory and can be joined directly. */
export type ClubVisibility = 'closed' | 'public'

/** A club summary. currentBook is the one book with finishedAt null, or null if
 * the club has no current book. */
export interface HSClub {
  id: string
  name: string
  createdBy: string
  visibility: ClubVisibility
  /** @deprecated Prefer visibility. Kept while older clients migrate. */
  isOpen: boolean
  archived: boolean
  createdAt: number
  /** Most recent book or discussion activity. */
  lastActivityAt: number
  memberCount: number
  currentBook: HSClubBook | null
  /** Library item ids sitting in this club's up-next queue. Carried on the
   * summary so a book page can show "In queue" without fetching each club's
   * full detail. */
  queuedItemIds: string[]
  /** The basis the owner chose for next-book recommendations. */
  recBasis: ClubRecBasis
  /** Club policy: members may revise their own comments and spoiler flag. */
  allowCommentEditing: boolean
  /** Club policy: members may reply to top-level comments. */
  allowReplies: boolean
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
  /** How far this member has read through the club's book order, for clubs
   * working a long series where members read ahead. Null when the server has no
   * ABS db mounted. See HSClubMemberReach. */
  reach: HSClubMemberReach | null
}

/** A member's furthest point in the club's ordered book list (past reads, then
 * the current book, then the up-next queue). `index` is 0-based into that list
 * and `total` is its length, so the UI can say "book 5 of 12". `libraryItemId`
 * and `title` identify the furthest book the member has started or finished.
 * `aheadOfClub` is true when that book sits after the club's current book. */
export interface HSClubMemberReach {
  index: number
  total: number
  libraryItemId: string
  title: string
  isFinished: boolean
  aheadOfClub: boolean
}

/** GET /hs/clubs response: the caller's clubs and public clubs they can join.
 * With libraryItemId, joinable is narrowed to clubs currently reading it;
 * `directory=1` requests the server-wide public directory. */
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
  /** Books lined up to read next, in the owner's chosen order (sortOrder, then
   * queuedAt). The owner promotes any of these to become the current book. */
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

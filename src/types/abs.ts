// Single source of truth for AudiobookShelf (ABS) API response shapes.
// Verified against ABS 2.35.1 by direct observation - do not guess fields.
// Only the subset of fields used in v0.1 is typed; ABS returns more.

// --- Auth ---

export interface ABSUser {
  id: string
  username: string
  email: string | null
  type: string
  token: string
  isActive: boolean
  isLocked: boolean
  createdAt: number
  librariesAccessible: string[]
  hasOpenIDLink: boolean
}

// /login and /api/authorize return the same envelope.
export interface ABSAuthResponse {
  user: ABSUser
  userDefaultLibraryId: string
  serverSettings: ABSServerSettings
  Source: string
}

export interface ABSServerSettings {
  id: string
  version: string
  language: string
  authActiveAuthMethods: string[]
  authOpenIDButtonText: string
  authLoginCustomMessage: string | null
  // Scanner (editable via PATCH /api/settings)
  scannerFindCovers?: boolean
  scannerParseSubtitle?: boolean
  scannerPreferMatchedMetadata?: boolean
  scannerDisableWatcher?: boolean
  storeCoverWithItem?: boolean
  // Display
  bookshelfView?: string
  dateFormat?: string
  timeFormat?: string
  // Backups (editable via PATCH /api/settings). backupSchedule is a cron string,
  // or false when auto-backups are disabled (ABS's default). Changing it
  // reschedules the cron live, no restart. maxBackupSize is in GB (0 = no cap).
  backupSchedule?: string | false
  backupsToKeep?: number
  maxBackupSize?: number
}

// /status (unauthenticated) - used to discover available auth methods.
export interface ABSStatusResponse {
  app: string
  serverVersion: string
  isInit: boolean
  language: string
  authMethods: string[]
  authFormData: {
    authLoginCustomMessage: string
    authOpenIDButtonText: string
    authOpenIDAutoLaunch: boolean
  }
}

// --- Libraries ---

// A library's on-disk root. GET /api/libraries returns these; the Upload page
// targets one when placing files.
export interface ABSLibraryFolder {
  id: string
  fullPath: string
  libraryId: string
  addedAt: number
}

// Per-library settings blob (ABS LibrarySettingsObject). Book and podcast
// libraries share the shape; podcast-only fields (podcastSearchRegion) and
// book-only fields are both optional. coverAspectRatio: 1 = square, 0 = standard.
export interface ABSLibrarySettings {
  coverAspectRatio: number
  disableWatcher: boolean
  autoScanCronExpression: string | null
  skipMatchingMediaWithAsin?: boolean
  skipMatchingMediaWithIsbn?: boolean
  audiobooksOnly?: boolean
  epubsAllowScriptedContent?: boolean
  hideSingleBookSeries?: boolean
  onlyShowLaterBooksInContinueSeries?: boolean
  metadataPrecedence?: string[]
  podcastSearchRegion?: string
  markAsFinishedTimeRemaining: number | null
  markAsFinishedPercentComplete: number | null
}

export interface ABSLibrary {
  id: string
  name: string
  icon: string
  mediaType: string
  provider: string
  folders: ABSLibraryFolder[]
  settings: ABSLibrarySettings
  displayOrder: number
  createdAt: number
  lastUpdate: number
}

export interface ABSLibrariesResponse {
  libraries: ABSLibrary[]
}

// --- Library items ---

export interface ABSBookMetadata {
  title: string | null
  titleIgnorePrefix: string
  subtitle: string | null
  authorName: string
  narratorName: string
  seriesName: string
  publishedYear: string | null
  description: string | null
  genres: string[]
  language: string | null
  explicit: boolean
}

export interface ABSBookMedia {
  id: string
  metadata: ABSBookMetadata
  coverPath: string | null
  tags: string[]
  numTracks: number
  numAudioFiles: number
  numChapters: number
  duration: number
  size: number
  // Present (e.g. "epub", "pdf") when the item has an ebook file; absent for
  // audio-only items. Used to surface the format badge on tiles. This is the
  // MINIFIED list shape; the expanded item detail uses `ebookFile` instead.
  ebookFormat?: string
  // The expanded item detail (/api/items/:id) carries the full ebook file
  // object here rather than the flat `ebookFormat` string.
  ebookFile?: ABSEBookFile | null
}

// ABS ebook file object (expanded item detail). The reader only needs the
// format; the binary is fetched from /api/items/:id/ebook.
export interface ABSEBookFile {
  ino: string
  ebookFormat: string
  metadata?: {
    filename?: string
    ext?: string
    size?: number
  }
}

export interface ABSLibraryItem {
  id: string
  libraryId: string
  folderId: string
  path: string
  mediaType: string
  media: ABSBookMedia
  addedAt: number
  updatedAt: number
  isMissing: boolean
  isInvalid: boolean
}

// /api/libraries/:id/items - paginated.
export interface ABSLibraryItemsResponse {
  results: ABSLibraryItem[]
  total: number
  limit: number
  page: number
  sortDesc: boolean
  mediaType: string
  minified: boolean
}

// --- Single item detail (/api/items/:id) ---

export interface ABSChapter {
  id: number
  start: number
  end: number
  title: string
}

export interface ABSAuthor {
  id: string
  name: string
}

// /api/libraries/:id/authors - library author list.
export interface ABSLibraryAuthor {
  id: string
  name: string
  description: string | null
  imagePath: string | null
  numBooks: number
  addedAt: number
}

export interface ABSAuthorsResponse {
  authors: ABSLibraryAuthor[]
}

export interface ABSNarrator {
  id: string
  name: string
  numBooks: number
}

export interface ABSNarratorsResponse {
  narrators: ABSNarrator[]
}

// /api/authors/:id?include=items - author detail with books.
export interface ABSAuthorDetail extends ABSLibraryAuthor {
  asin: string | null
  libraryItems: ABSLibraryItem[]
}

export interface ABSAudioFileMetadata {
  filename: string
  ext: string
  size: number
}

export interface ABSAudioFile {
  index: number
  ino: string
  duration: number
  codec?: string
  bitRate?: number
  metadata: ABSAudioFileMetadata
}

export interface ABSSeriesRef {
  id: string
  name: string
  sequence: string | null
}

// The detail endpoint (/api/items/:id) is NOT minified, and differs from the
// items list: it omits the flattened authorName, media.duration, and
// media.numChapters, instead exposing metadata.authors[], media.audioFiles[],
// and media.chapters[]. Derive the flattened values from these.
export interface ABSBookMetadataDetail extends ABSBookMetadata {
  authors: ABSAuthor[]
  narrators: string[]
  series: ABSSeriesRef[]
  isbn: string | null
  asin: string | null
  publisher: string | null
  abridged?: boolean
  rating?: number | null
}

export interface ABSBookMediaDetail extends Omit<
  ABSBookMedia,
  'metadata' | 'duration' | 'numChapters'
> {
  metadata: ABSBookMetadataDetail
  audioFiles: ABSAudioFile[]
  chapters: ABSChapter[]
}

export interface ABSLibraryItemDetail extends Omit<ABSLibraryItem, 'media'> {
  media: ABSBookMediaDetail
}

// Editable book metadata - the body of PATCH /api/items/:id/media. Every field
// is optional; only the keys present are written. null clears a field.
export interface ABSItemMetadataPatch {
  title?: string | null
  subtitle?: string | null
  description?: string | null
  publishedYear?: string | null
  publisher?: string | null
  language?: string | null
  isbn?: string | null
  asin?: string | null
  genres?: string[]
  explicit?: boolean
  abridged?: boolean
}

// --- Progress (/api/me/items-in-progress) ---

export interface ABSItemsInProgressResponse {
  libraryItems: ABSLibraryItem[]
}

// --- Podcasts (podcast-type libraries) ---
// Shapes per podcasts.md / ABS 2.35.1. Several fields are @needs-verify against a
// live podcast library; this ABS instance has only book libraries.

export interface ABSPodcastEpisode {
  id: string
  title: string
  description: string | null
  publishedAt: number | null
  duration: number | null
  audioFile?: { ino: string } | null
}

export interface ABSPodcastMetadata {
  title: string | null
  author: string | null
  description: string | null
  feedUrl: string | null
  genres: string[]
}

export interface ABSPodcastMedia {
  metadata: ABSPodcastMetadata
  episodes: ABSPodcastEpisode[]
  autoDownloadEpisodes?: boolean
  numEpisodes?: number
}

export interface ABSPodcastItem {
  id: string
  libraryId: string
  media: ABSPodcastMedia
}

export interface ABSPodcastItemsResponse {
  results: ABSPodcastItem[]
  total: number
}

// A recent episode carries its parent podcast's identity for the flat feed.
export interface ABSRecentEpisode extends ABSPodcastEpisode {
  libraryItemId: string
  podcast?: { title: string | null }
}

export interface ABSRecentEpisodesResponse {
  episodes: ABSRecentEpisode[]
}

// --- Admin / config (admin-only) ---

// ABS user permission flags. librariesAccessible / itemTagsSelected ride inside
// the permissions object in the current ABS model (names, not ids, for tags).
export interface ABSUserPermissions {
  download: boolean
  update: boolean
  delete: boolean
  upload: boolean
  createEreader: boolean
  accessAllLibraries: boolean
  accessAllTags: boolean
  accessExplicitContent: boolean
  selectedTagsNotAccessible: boolean
  librariesAccessible: string[]
  itemTagsSelected: string[]
}

export interface ABSAdminUser {
  id: string
  username: string
  email: string | null
  type: string
  isActive: boolean
  isLocked: boolean
  lastSeen: number | null
  createdAt: number
  permissions?: ABSUserPermissions
  librariesAccessible?: string[]
}

export interface ABSUsersResponse {
  users: ABSAdminUser[]
}

// ABS embeds the owning user (and, on list, the admin who minted it) on each key.
export interface ABSApiKeyUserRef {
  id: string
  username: string
  type: string
}

export interface ABSApiKey {
  id: string
  name: string
  description: string | null
  expiresAt: number | null
  lastUsedAt: number | null
  isActive: boolean
  createdAt: string
  userId: string
  user?: ABSApiKeyUserRef
  createdByUser?: ABSApiKeyUserRef | null
  // ABS returns the raw token on `apiKey` only on the create response; it is
  // never echoed on subsequent list reads.
  apiKey?: string
}

export interface ABSApiKeysResponse {
  apiKeys: ABSApiKey[]
}

export interface ABSBackup {
  id: string
  datePretty: string
  filename: string
  fileSize: number
  createdAt: number
  serverVersion: string
}

export interface ABSBackupsResponse {
  backups: ABSBackup[]
  backupLocation: string
}

// --- Collections (/api/libraries/:id/collections) ---

export interface ABSCollection {
  id: string
  libraryId: string
  name: string
  description: string | null
  books: ABSLibraryItem[]
}

export interface ABSCollectionsResponse {
  results: ABSCollection[]
  total: number
}

// --- Playlists (/api/libraries/:id/playlists) ---

export interface ABSPlaylistItem {
  libraryItemId: string
  episodeId: string | null
  libraryItem: ABSLibraryItem
}

export interface ABSPlaylist {
  id: string
  libraryId: string
  userId: string
  name: string
  description: string | null
  items: ABSPlaylistItem[]
}

export interface ABSPlaylistsResponse {
  results: ABSPlaylist[]
  total: number
}

// --- Series (/api/libraries/:id/series) ---

export interface ABSSeries {
  id: string
  name: string
  nameIgnorePrefix: string
  description: string | null
  books: ABSLibraryItem[]
}

export interface ABSSeriesResponse {
  results: ABSSeries[]
  total: number
  limit: number
  page: number
}

// --- Search (/api/libraries/:id/search) ---

export interface ABSSearchAuthor {
  id: string
  name: string
  numBooks: number
}

export interface ABSSearchNarrator {
  name: string
  numBooks: number
}

export interface ABSSearchSeriesResult {
  series: { id: string; name: string }
  books: ABSLibraryItem[]
}

export interface ABSSearchResponse {
  book: { libraryItem: ABSLibraryItem }[]
  series: ABSSearchSeriesResult[]
  authors: ABSSearchAuthor[]
  narrators: ABSSearchNarrator[]
}

// --- Personalized home shelves (/api/libraries/:id/personalized) ---
// A discriminated union by shelf type; v0.1 renders only book + series shelves.

interface ABSShelfBase {
  id: string
  label: string
}
export interface ABSBookShelf extends ABSShelfBase {
  type: 'book'
  entities: ABSLibraryItem[]
}
export interface ABSSeriesShelf extends ABSShelfBase {
  type: 'series'
  entities: ABSSeries[]
}
export interface ABSOtherShelf extends ABSShelfBase {
  type: 'authors' | 'podcast' | 'episode'
  entities: unknown[]
}
export type ABSShelf = ABSBookShelf | ABSSeriesShelf | ABSOtherShelf

// --- Playback session (POST /api/items/:id/play) ---

export interface ABSAudioTrack {
  index: number
  // Server-relative path, e.g. /api/items/:id/file/:ino - prefix with /abs-api
  // and append ?token=... to load it natively in <audio>.
  contentUrl: string
  mimeType: string
  duration: number
  // Seconds into the whole book where this track begins (multi-file books).
  startOffset: number
}

export interface ABSPlaybackSession {
  id: string
  libraryItemId: string
  displayTitle: string
  displayAuthor: string | null
  coverPath: string | null
  duration: number
  currentTime: number
  chapters: ABSChapter[]
  audioTracks: ABSAudioTrack[]
}

// Entry in user.mediaProgress[] - drives tile progress bars + resume.
export interface ABSMediaProgress {
  libraryItemId: string
  duration: number
  progress: number
  currentTime: number
  isFinished: boolean
  // ABS epoch-ms timestamp of the last progress write. Used to order in-progress
  // books by recency (newest-touched first). Optional: locally-built stub rows
  // may omit it.
  lastUpdate?: number
}

// GET /api/me - the caller's full progress list, for library filter chips
// (in progress / finished) that need per-item state the minified item list
// doesn't carry.
export interface ABSMeResponse {
  id: string
  mediaProgress: ABSMediaProgress[]
  bookmarks?: ABSBookmark[]
}

export interface ABSBookmark {
  libraryItemId: string
  title: string
  time: number
  createdAt: number
}

// --- Listening sessions (/api/me/listening-sessions) ---

export interface ABSDeviceInfo {
  browserName?: string
  osName?: string
  deviceName?: string
  /** Client app identity (e.g. "HearthShelf", "HearthShelf Mobile",
   *  "HearthShelf iOS", "HearthShelf Auto"). Set verbatim by each client. */
  clientName?: string
  /** Stable per-client id (e.g. "hearthshelf-web", "hearthshelf-auto",
   *  "hearthshelf-ios-carplay"). The most reliable surface signal. */
  deviceId?: string
  clientVersion?: string
  manufacturer?: string
  model?: string
  sdkVersion?: number
}

export interface ABSListeningSession {
  id: string
  libraryItemId: string
  displayTitle: string
  displayAuthor: string
  duration: number
  timeListening: number
  startTime: number
  currentTime: number
  startedAt: number
  updatedAt: number
  dayOfWeek: string
  deviceInfo?: ABSDeviceInfo
}

export interface ABSListeningSessionsResponse {
  total: number
  numPages: number
  page: number
  itemsPerPage: number
  sessions: ABSListeningSession[]
}

// --- Listening stats (/api/me/listening-stats) ---

export interface ABSStatsItem {
  id: string
  mediaMetadata: ABSBookMetadataDetail
  timeListening: number
}

export interface ABSListeningStats {
  totalTime: number
  items: Record<string, ABSStatsItem>
  days: Record<string, number>
  dayOfWeek: Record<string, number>
  today: number
}

// --- Server logs ---
// One log line, shared by ABS's own daily log (/api/logger-data) and the
// HearthShelf app-log ring (/hs/logs). `source` is the subsystem tag; `level` is
// a numeric severity (see the admin Logs view's LEVEL_LABEL map).
export interface ABSLogEntry {
  timestamp: string
  source?: string
  message: string
  level?: number
}

/** GET /api/logger-data response (ABS's current daily log). */
export interface ABSLoggerData {
  currentDailyLogs: ABSLogEntry[]
}

/** GET /hs/logs response (HearthShelf's in-process app-log ring). */
export interface HSAppLogResponse {
  logs: ABSLogEntry[]
}

// --- Listening stats (HearthShelf backend, /hs/stats) ---
// Computed server-side from ABS /api/me/listening-stats so every client (mobile,
// web, widgets) shows identical numbers instead of each reimplementing
// the streak/week walk. Clients that hit an older server without /hs/stats fall
// back to reading raw ABSListeningStats and computing via lib/stats.ts.

/** One book's all-time listening time, for the "Most listened" list. */
export interface HSStatsItem {
  id: string
  title: string
  author: string
  narrator: string
  timeSec: number
}

export interface HSListeningStats {
  /** All-time seconds listened. */
  totalTimeSec: number
  /** Seconds listened today (caller-local). */
  todaySec: number
  /** Seconds listened across the last 7 local days. */
  weekSec: number
  /** Consecutive days with any listening, ending today (or yesterday if today
   * is still zero). See computeStreak. */
  dayStreak: number
  /** Distinct days with any listening (byDay keys with >0). */
  activeDays: number
  /** Raw seconds-per-day map (YYYY-MM-DD), for the week bars + heatmap. */
  byDay: Record<string, number>
  /** Total seconds listened per weekday, keyed '0'..'6' (Sun..Sat) - ABS's own
   * dayOfWeek bucketing (a running sum), for the "Total" day-of-week bars. */
  byDayOfWeek: Record<string, number>
  /** Average seconds per occurrence of each weekday, keyed '0'..'6' (Sun..Sat),
   * derived from byDay - for the "Average" day-of-week bars. See
   * dayOfWeekAverages. */
  byWeekdayAvg: Record<string, number>
  /** Per-item all-time listening, sorted desc at build time. */
  mostListened: HSStatsItem[]
  /** All-time distinct books finished. null when the ABS database isn't mounted
   * (a slim install without the read-only volume) - the field is derived from a
   * direct ABS-db read, not the REST listening-stats payload. */
  booksFinished: number | null
  /** Distinct books finished since Jan 1 of the current year. null when the ABS
   * database isn't mounted (same source as booksFinished). */
  booksThisYear: number | null
  /** All-time count of recorded listening sessions (ABS /api/sessions total).
   * null when the session count couldn't be read. */
  sessionCount: number | null
  /** Personal "highlight" badges over finished books (longest/shortest book,
   * most-read author/narrator). null when the ABS database isn't mounted - these
   * are direct ABS-db reads like booksFinished. Individual fields inside are also
   * nullable (e.g. a user with no finished book has no extremes). */
  highlights: HSStatsHighlights | null
}

/** One finished book identified for a highlight badge (longest / shortest). */
export interface HSHighlightBook {
  title: string
  /** The book's canonical length in seconds (books.duration). */
  durationSec: number
  /** The owning ABS library-item id, so the client can render a cover. null when
   * the book is no longer in the library. */
  libraryItemId: string | null
}

/** A person (author or narrator) and how many of the user's finished books they
 * account for, for the most-read highlight badges. */
export interface HSHighlightPerson {
  name: string
  /** Distinct finished books by this author / narrated by this narrator. */
  count: number
}

/** The book a user has finished the most times (re-read / re-listened), for the
 * "Most re-read" highlight badge. ABS keeps no completion count, so this comes
 * from HearthShelf's own durable per-(user, book) tracker (book_completions),
 * which only accrues meaningful data after months of snapshots observe re-finishes.
 * `completions` is always >= 2 (a single finish is not a re-read). */
export interface HSHighlightReReadBook {
  title: string
  /** How many times the user has finished this book (>= 2). */
  completions: number
  /** The owning ABS library-item id, so the client can render a cover. null when
   * the book is no longer in the library. */
  libraryItemId: string | null
}

/** Finished-book highlight badges for the Stats page. Every field is null when
 * the data doesn't exist (no finished books, or no author/narrator recorded). */
export interface HSStatsHighlights {
  longestBook: HSHighlightBook | null
  shortestBook: HSHighlightBook | null
  topAuthor: HSHighlightPerson | null
  topNarrator: HSHighlightPerson | null
  /** The user's most re-read book (>= 2 completions), or null until HS has
   * observed a re-read. Not derivable from ABS - see HSHighlightReReadBook. */
  mostReRead: HSHighlightReReadBook | null
}

// --- Listening history (HearthShelf backend, /hs/stats/history) ---
// HS owns a durable daily listening history that ABS never keeps: a nightly
// snapshot job appends one immutable row per user per day. Unlocks the full
// heatmap (every day since the job started, surviving ABS restarts/re-scans),
// trend lines, and durable longest-ever streaks. See HearthShelf's stats plan.

/** One day of a user's snapshotted listening history. */
export interface HSStatsHistoryDay {
  /** Local day bucket, 'YYYY-MM-DD'. */
  date: string
  /** Seconds listened that day. */
  secondsListened: number
  /** Recorded listening sessions that day. */
  sessions: number
  /** Distinct books finished that day. */
  booksFinished: number
}

/** One calendar month of a user's snapshotted history, rolled up from the daily
 * rows. Powers the "by month" averages card. */
export interface HSStatsMonth {
  /** Month bucket, 'YYYY-MM'. */
  month: string
  /** Total seconds listened that month. */
  seconds: number
  /** Total books finished that month. */
  books: number
  /** Days that month with any listening (seconds > 0). */
  activeDays: number
}

/** GET /hs/stats/history response: the caller's daily rows (oldest first) plus a
 * per-month rollup. `available` is false when the ABS database isn't mounted (no
 * snapshot source), in which case both arrays are empty. `months` is absent on
 * older servers that predate the rollup - treat as []. */
export interface HSStatsHistory {
  available: boolean
  days: HSStatsHistoryDay[]
  months?: HSStatsMonth[]
}

// --- Social (HearthShelf backend, /hs/social/*) ---
// Moved to ./social.ts. Temporary re-export so consumers can bump the
// submodule independently; remove once all imports point at types/social.
export type { HSLeaderboardEntry, HSLeaderboardResponse, HSFinishedCount } from './social'

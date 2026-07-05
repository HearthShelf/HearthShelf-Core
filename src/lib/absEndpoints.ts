// Machine-readable maps of the two HTTP surfaces every HearthShelf client uses,
// plus the offline-sync rules that govern progress reconciliation. Shared across
// every surface so paths and sync semantics are defined once, not per repo.
//
//   ABS_ENDPOINTS - AudiobookShelf routes (library/item/playback/progress data).
//   HS_ENDPOINTS  - HearthShelf-native `/hs/*` routes (features ABS lacks).
//
// IMPORTANT: these are PATHS, not URLs, and clients never call ABS directly.
// Every client has one connection - to a HearthShelf host - which multiplexes by
// path: ABS paths are reached via the host's `/abs-api/*` proxy, `/hs/*` via the
// host's own backend. Core owns the contract (paths + shapes); each app owns the
// transport that prepends `/abs-api` (or the origin) at call time. See
// `docs/architecture.md` for the full who-talks-to-whom.
//
// Prose companion for ABS behavior (params, responses, auth, socket events):
// `docs/abs-api-reference.md`. ABS response shapes: `src/types/abs.ts`.
//
// Verified against ABS 2.35.1. Pure constants + path builders - no DOM, no Node.

/** ABS server version these definitions were derived from. */
export const ABS_API_VERSION = '2.35.1'

// --- Endpoint paths -------------------------------------------------------
//
// Static paths are string literals; parameterized paths are builder functions
// so callers never string-concat ids by hand. Paths are relative to the ABS
// origin (in HearthShelf they're reached through the `/abs-api/*` proxy - prefix
// as needed at the call site).

export const ABS_ENDPOINTS = {
  // Server-level (not under /api)
  status: '/status',
  ping: '/ping',
  healthcheck: '/healthcheck',
  init: '/init',
  login: '/login',
  logout: '/logout',
  authRefresh: '/auth/refresh',
  authorize: '/api/authorize',

  // Current user (self-scoped)
  me: '/api/me',
  meListeningSessions: '/api/me/listening-sessions',
  meListeningStats: '/api/me/listening-stats',
  meItemsInProgress: '/api/me/items-in-progress',
  /** GET one media progress. */
  meProgress: (libraryItemId: string, episodeId?: string) => (episodeId ? `/api/me/progress/${libraryItemId}/${episodeId}` : `/api/me/progress/${libraryItemId}`),
  /** PATCH create/update progress. NO last-writer-wins guard - see ABS_OFFLINE_SYNC_RULES. */
  meProgressUpdate: (libraryItemId: string, episodeId?: string) => (episodeId ? `/api/me/progress/${libraryItemId}/${episodeId}` : `/api/me/progress/${libraryItemId}`),
  /** PATCH batch progress. NO guard; per-item errors silently skipped. */
  meProgressBatchUpdate: '/api/me/progress/batch/update',
  /** DELETE a progress record (id = MediaProgress id, not library item id). */
  meProgressRemove: (mediaProgressId: string) => `/api/me/progress/${mediaProgressId}`,

  // Playback sessions
  /** Start a playback session for an item. */
  itemPlay: (libraryItemId: string) => `/api/items/${libraryItemId}/play`,
  /** Start a playback session for a podcast episode. */
  itemPlayEpisode: (libraryItemId: string, episodeId: string) => `/api/items/${libraryItemId}/play/${episodeId}`,
  /** Live sync of an OPEN session. Body { currentTime, timeListened (delta!), duration? }. */
  sessionSync: (sessionId: string) => `/api/session/${sessionId}/sync`,
  /** Close an open session (optional final sync body). */
  sessionClose: (sessionId: string) => `/api/session/${sessionId}/close`,
  /** GET an open (in-memory) session. */
  sessionOpen: (sessionId: string) => `/api/session/${sessionId}`,
  /** Sync ONE offline/local session. LWW-guarded. */
  sessionLocal: '/api/session/local',
  /** Batch-sync offline/local sessions. LWW-guarded, per-item results. PREFER for offline flush. */
  sessionLocalAll: '/api/session/local-all',
  sessions: '/api/sessions',
  sessionsOpen: '/api/sessions/open',
  sessionsBatchDelete: '/api/sessions/batch/delete',
  session: (sessionId: string) => `/api/session/${sessionId}`,

  // Libraries
  libraries: '/api/libraries',
  library: (libraryId: string) => `/api/libraries/${libraryId}`,
  libraryItems: (libraryId: string) => `/api/libraries/${libraryId}/items`,
  librarySearch: (libraryId: string) => `/api/libraries/${libraryId}/search`,
  libraryPersonalized: (libraryId: string) => `/api/libraries/${libraryId}/personalized`,
  libraryFilterData: (libraryId: string) => `/api/libraries/${libraryId}/filterdata`,
  librarySeries: (libraryId: string) => `/api/libraries/${libraryId}/series`,
  libraryCollections: (libraryId: string) => `/api/libraries/${libraryId}/collections`,
  libraryPlaylists: (libraryId: string) => `/api/libraries/${libraryId}/playlists`,
  libraryAuthors: (libraryId: string) => `/api/libraries/${libraryId}/authors`,

  // Library items
  item: (libraryItemId: string) => `/api/items/${libraryItemId}`,
  itemCover: (libraryItemId: string) => `/api/items/${libraryItemId}/cover`,
  // The item's primary EPUB, streamed as application/epub+zip. Auth via Bearer
  // header (JSON transports) or ?token= query (media loaders that can't set
  // headers). Fetch as an ArrayBuffer for epub.js - a URL lets it sniff the
  // extension and mis-handle the cross-origin auth.
  itemEbook: (libraryItemId: string) => `/api/items/${libraryItemId}/ebook`,
  itemsBatchGet: '/api/items/batch/get',

  // Collections / Playlists
  collections: '/api/collections',
  collection: (collectionId: string) => `/api/collections/${collectionId}`,
  playlists: '/api/playlists',
  playlist: (playlistId: string) => `/api/playlists/${playlistId}`,

  // Podcasts
  podcastEpisode: (libraryItemId: string, episodeId: string) => `/api/podcasts/${libraryItemId}/episode/${episodeId}`,

  // Authors / Series
  author: (authorId: string) => `/api/authors/${authorId}`,
  authorImage: (authorId: string) => `/api/authors/${authorId}/image`,
  series: (seriesId: string) => `/api/series/${seriesId}`
} as const

// --- Socket.io event names -----------------------------------------------
//
// The subset a client cares about. The two that matter for progress-tracking
// UIs are `user_item_progress_updated` and `user_session_closed`.

export const ABS_SOCKET_EVENTS = {
  auth: 'auth',
  userItemProgressUpdated: 'user_item_progress_updated',
  userSessionClosed: 'user_session_closed',
  userUpdated: 'user_updated',
  userStreamUpdate: 'user_stream_update',
  itemUpdated: 'item_updated',
  itemRemoved: 'item_removed',
  libraryUpdated: 'library_updated',
  streamReset: 'stream_reset',
  taskStarted: 'task_started',
  taskFinished: 'task_finished'
} as const

// --- Offline sync rules ---------------------------------------------------
//
// The conflict-resolution behavior that broke mobile offline sync. Encoded as
// data so every client agrees on it. Full explanation in
// docs/abs-api-reference.md § "Offline Sync - the rules that matter".

/**
 * Whether a progress-writing endpoint applies ABS's last-writer-wins guard.
 *
 * Guarded endpoints (`/api/session/local`, `/local-all`) SKIP the write when the
 * server's stored MediaProgress.updatedAt is newer than the incoming session's
 * `updatedAt` - so a stale offline session can't clobber newer server progress,
 * BUT ONLY if the client set the session's `updatedAt` to when the listening
 * actually happened. Unguarded endpoints (`/api/me/progress/*`) always apply and
 * will overwrite newer server progress - conflict avoidance is the client's job.
 */
export const ABS_OFFLINE_SYNC_RULES = {
  /** POST /api/session/local - single offline session. Server compares updatedAt. */
  sessionLocal: { lastWriterWinsGuard: true, reportsPerItemResults: false },
  /** POST /api/session/local-all - batch. Guarded per session; returns results[]. Preferred for flush. */
  sessionLocalAll: { lastWriterWinsGuard: true, reportsPerItemResults: true },
  /** PATCH /api/me/progress/:id - always applies. Use `lastUpdate` to backdate updatedAt. */
  meProgressUpdate: { lastWriterWinsGuard: false, reportsPerItemResults: false },
  /** PATCH /api/me/progress/batch/update - always applies; per-item errors silently dropped. */
  meProgressBatchUpdate: { lastWriterWinsGuard: false, reportsPerItemResults: false },
  /** POST /api/session/:id/sync - open session assumed authoritative. timeListened is a DELTA. */
  sessionSync: { lastWriterWinsGuard: false, reportsPerItemResults: false }
} as const

/**
 * The endpoint to prefer when flushing queued offline sessions on reconnect.
 * It applies the LWW guard AND reports per-session success/failure, which the
 * `/api/me/progress` batch path does not.
 */
export const ABS_OFFLINE_FLUSH_ENDPOINT = ABS_ENDPOINTS.sessionLocalAll

/**
 * Fields a client MUST set correctly on a queued offline session for the LWW
 * guard to reconcile it right. `updatedAt` (epoch ms) must reflect when the
 * listening happened, not "now" at flush time - the #1 offline-sync bug.
 */
export const ABS_OFFLINE_SESSION_REQUIRED_FIELDS = ['id', 'libraryItemId', 'currentTime', 'timeListening', 'updatedAt'] as const

// --- HearthShelf-native endpoints (/hs/*) --------------------------------
//
// Features ABS has no concept of, served by the HearthShelf backend
// (HearthShelf/server/routes/*). Same transport rule: reached via the
// HearthShelf host at `/hs/*`. Authenticated by the caller's ABS bearer token,
// which the backend resolves to (serverId, userId). Implementation reference:
// HearthShelf/server/index.js (dispatcher) + server/routes/. Not an ABS
// passthrough - only these fixed feature routes exist.

export const HS_ENDPOINTS = {
  // Runtime (read at boot, unauthenticated)
  runtime: '/hs/runtime',
  runtimeOnboarded: '/hs/runtime/onboarded',
  runtimeServerName: '/hs/runtime/server-name',
  runtimeInitAdmin: '/hs/runtime/init-admin',
  runtimePublicIp: '/hs/runtime/public-ip',

  // Discovery / AI
  questgiverConfig: '/hs/questgiver/config',
  questgiverRecommend: '/hs/questgiver/recommend',
  questgiverRuns: '/hs/questgiver/runs',
  questgiverHealth: '/hs/questgiver/health',
  questgiverAdminConfig: '/hs/questgiver/admin/config',
  discover: '/hs/discover',
  discoverFeedback: '/hs/discover/feedback',
  discoverPopular: '/hs/discover/popular',

  // Cross-device user state
  settings: '/hs/settings',
  queue: '/hs/queue',

  // Social
  socialLeaderboard: '/hs/social/leaderboard',
  socialFinishedCount: '/hs/social/finished-count',
  socialFinishedBy: '/hs/social/finished-by',
  socialListeningNow: '/hs/social/listening-now',
  socialCommunityConfig: '/hs/social/community-config',

  // Clubs / notes
  clubs: '/hs/clubs',
  notes: '/hs/notes',

  // Stats
  stats: '/hs/stats',

  // Narrator photos (HS-native; ABS has none)
  narratorImageNames: '/hs/narrators/images',
  /** Narrator photo by name (GET public / PUT+DELETE admin). */
  narratorImage: (name: string) => `/hs/narrators/${encodeURIComponent(name)}/image`,

  // Per-user avatars
  /** User avatar (GET public, may 302 to Gravatar / PUT+DELETE self-or-admin). */
  avatar: (userId: string) => `/hs/avatars/${userId}`,

  // Finished-books / Hardcover
  finishedBooks: '/hs/finished-books',
  finishedBooksMatch: '/hs/finished-books/match',
  finishedBooksImport: '/hs/finished-books/import',
  finishedBooksSyncAbs: '/hs/finished-books/sync-abs',
  finishedBooksHardcover: '/hs/finished-books/hardcover',
  finishedBooksHardcoverSync: '/hs/finished-books/hardcover/sync',

  // Integrations (admin) + external catalogs
  integrationsConfig: '/hs/integrations/config',
  audibleSearch: '/hs/audible/search',
  audibleSeries: '/hs/audible/series',

  // Release subscriptions + push notifications. Notification PREFERENCES are not
  // here - they ride the settings catalog (/hs/settings) like other account
  // prefs; the push job reads them via getUserSetting.
  subscriptions: '/hs/subscriptions',
  /** One subscription (DELETE to unfollow). */
  subscription: (id: string) => `/hs/subscriptions/${id}`,
  pushRegister: '/hs/push/register',
  rmabConfig: '/hs/rmab/config',
  rmabSearch: '/hs/rmab/search',
  rmabRequests: '/hs/rmab/requests',
  /** One RMAB request (GET / PATCH cancel|retry). */
  rmabRequest: (id: string) => `/hs/rmab/requests/${id}`,
  rmabRequestEbook: (id: string) => `/hs/rmab/requests/${id}/ebook`,
  rmabWatchedAuthors: '/hs/rmab/watched-authors',
  rmabWatchedSeries: '/hs/rmab/watched-series',
  rmabIgnored: '/hs/rmab/ignored',
  audplexusConfig: '/hs/audplexus/config',
  audplexusStatus: '/hs/audplexus/status',

  // Service accounts / telemetry (admin)
  serviceAccounts: '/hs/service-accounts',
  serviceAccount: (id: string) => `/hs/service-accounts/${encodeURIComponent(id)}`,
  telemetry: '/hs/telemetry',

  // Hosted setup / pairing (host/admin-plane; `connect` is the hosted-SPA login)
  hostedConnect: '/hs/hosted/connect',
  hostedConfig: '/hs/hosted/config',
  hostedPair: '/hs/hosted/pair',
  hostedPairStatus: '/hs/hosted/pair-status',
  hostedPortCheck: '/hs/hosted/port-check',
  hostedHsDirect: '/hs/hosted/hsdirect',
  hostedReachability: '/hs/hosted/reachability',
  hostedEmailRelay: '/hs/hosted/email-relay',
  hostedEmailRelayApply: '/hs/hosted/email-relay/apply',
  hostedDisconnect: '/hs/hosted/disconnect',
  hostedInvite: '/hs/hosted/invite',
  hostedRecoverAdmins: '/hs/hosted/recover-admins',
  hostedRecoverSecret: '/hs/hosted/recover-secret'
} as const

export type ABSEndpoints = typeof ABS_ENDPOINTS
export type ABSSocketEvents = typeof ABS_SOCKET_EVENTS
export type ABSOfflineSyncRules = typeof ABS_OFFLINE_SYNC_RULES
export type HSEndpoints = typeof HS_ENDPOINTS

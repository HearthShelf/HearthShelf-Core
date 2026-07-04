// Canonical request/response shapes for the HearthShelf-native `/hs/*` API - the
// features ABS has no concept of, served by the HearthShelf backend
// (HearthShelf/server/routes/*). This is the single source of truth: no consumer
// repo should hand-roll these. Verified against the backend route handlers.
//
// See docs/architecture.md for how clients reach `/hs/*` (through a HearthShelf
// host) and docs/abs-api-reference.md for the ABS surface. Endpoint PATHS are in
// src/lib/absEndpoints.ts (HS_ENDPOINTS).
//
// Conventions:
// - Every error body is HSErrorResponse `{ error: string, ... }`.
// - Secrets (API keys, tokens) are write-only: requests accept them, responses
//   expose only boolean presence flags (`hasKey`, `configured`, ...).
// - `env` lock maps mean a field is pinned by an environment variable and is
//   read-only in the admin UI.
// - Some `/hs` routes are thin proxies (RMAB, Audplexus) or forward control-plane
//   JSON (hosted pairing); those bodies are upstream-owned and typed as opaque
//   named aliases - do NOT invent fields for them.

import type { DiscoverSummary, DiscoverCandidate } from '../lib/discover'

// --- Common ---------------------------------------------------------------

/** Every `/hs/*` error response. Some carry extra fields (see specific types). */
export interface HSErrorResponse {
  error: string
  detail?: string
}

/** Generic success ack used by DELETE/action routes. */
export interface HSOkResponse {
  ok: true
}

/** Response from image PUT routes (narrator photo, avatar). `version` bumps each
 *  upload for cache-busting (`?v=`). */
export interface HSImageUploadResponse {
  ok: true
  version: number
}

/** Rate-limit period for QuestGiver/AI limits. */
export type HSRatePeriod = 'hour' | 'day' | 'week' | 'month'

/** The runtime deployment mode of a HearthShelf host. */
export type HSMode = 'slim' | 'aio' | 'hosted'

// --- Runtime (GET /hs/runtime) --------------------------------------------
// Read by every client at boot to route onboarding vs login. Unauthenticated.

export interface HSRuntimeInfo {
  mode: HSMode
  absInitialized: boolean
  paired: boolean
  onboarded: boolean
  publicUrl: string | null
  controlPlaneUrl: string
  serviceUsername: string | null
  serverName: string | null
  serverId: string
  hsVersion: string | null
}

// --- QuestGiver (/hs/questgiver/*) ----------------------------------------

/** GET /hs/questgiver/config - public feature status + the caller's rate state. */
export interface HSQuestGiverConfig {
  featureEnabled: boolean
  discoverEnabled: boolean
  enabled: boolean
  provider: string | null
  model: string | null
  limit: number | null
  remaining: number | null
  period: HSRatePeriod | null
}

/** Which QuestGiver admin-config fields are pinned by env (read-only in UI). */
export interface HSQuestGiverConfigEnvLocks {
  provider: boolean
  model: boolean
  apiKey: boolean
  baseUrl: boolean
  limit: boolean
  enabled: boolean
  discoverEnabled: boolean
}

/** GET/PUT /hs/questgiver/admin/config response. Never leaks the API key. */
export interface HSQuestGiverAdminConfig {
  provider: string | null
  model: string | null
  baseUrl: string | null
  limit: string
  enabled: boolean
  discoverEnabled: boolean
  hasKey: boolean
  validProviders: string[]
  env: HSQuestGiverConfigEnvLocks
}

/** PUT /hs/questgiver/admin/config body (partial patch; env-pinned fields ignored). */
export interface HSQuestGiverAdminConfigUpdate {
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  limit?: string
  enabled?: boolean
  discoverEnabled?: boolean
}

/** POST /hs/questgiver/recommend body. `prompt` must be length >= 10. */
export interface HSQuestGiverRecommendRequest {
  prompt: string
}

/** POST /hs/questgiver/recommend success response. */
export interface HSQuestGiverRecommendResponse {
  intro: string
  picks: HSQuestGiverPick[]
  newPicks: HSQuestGiverPick[]
  engine: 'ai'
  remaining: number | null
  limit: number | null
}

/** A recommendation pick. `newPicks` entries additionally carry
 *  title/author/genre/hours (see core QgNewPick). */
export interface HSQuestGiverPick {
  id: string
  reason: string
}

/** 429 body when the AI rate limit is hit. */
export interface HSRateLimitedResponse {
  error: 'rate_limited'
  limit: number | null
  remaining: number
  period: HSRatePeriod | null
}

/** A saved QuestGiver session. The backend only stamps `id` and reads `label`;
 *  the rest of the body is client-defined and round-tripped verbatim. */
export interface HSQuestGiverRun {
  id: string
  label?: string
  [key: string]: unknown
}

/** GET/POST /hs/questgiver/runs response (newest-first, max 30). */
export interface HSQuestGiverRunsResponse {
  runs: HSQuestGiverRun[]
}

// --- Discover (/hs/discover/*) --------------------------------------------

export type HSDiscoverVote = 'like' | 'dislike' | 'not_interested'

export interface HSDiscoverFeedback {
  vote?: HSDiscoverVote
  rating?: number
}

/** Keyed by item/candidate id; entries with no vote and no rating are absent. */
export type HSDiscoverFeedbackMap = Record<string, HSDiscoverFeedback>

/** GET/POST /hs/discover/feedback response. */
export interface HSDiscoverFeedbackResponse {
  feedback: HSDiscoverFeedbackMap
}

/** POST /hs/discover/feedback body. */
export interface HSDiscoverFeedbackRequest {
  itemKey: string
  vote?: HSDiscoverVote | null
  rating?: number | null
}

export interface HSDiscoverPopularItem {
  itemId: string
  finishedBy: number
  inProgressBy: number
}

/** GET /hs/discover/popular response. `items` is [] for non-admin callers. */
export interface HSDiscoverPopularResponse {
  items: HSDiscoverPopularItem[]
}

export type HSDiscoverEngine = 'ai' | 'heuristic' | 'none'

/** A monthly-shelf pick referencing a candidate id with a one-line reason. */
export interface HSDiscoverPick {
  id: string
  reason: string
}

/** GET/POST /hs/discover response - the monthly shelf (generate-once, cached). */
export interface HSDiscoverShelf {
  month: string
  engine: HSDiscoverEngine
  intro: string
  picks: HSDiscoverPick[]
}

/** POST /hs/discover body (ignored if a shelf is already cached this month).
 *  Reuses the core Discover logic types. */
export interface HSDiscoverGenerateRequest {
  summary?: DiscoverSummary
  candidates: DiscoverCandidate[]
}

// --- Finished books (/hs/finished-books/*) --------------------------------
// The caller's personal reading-history store. NOT the social "finished by N
// people" feature (that's HSFinishedByUser in social.ts) - do not conflate.

export type HSFinishedBookSource = 'abs' | 'goodreads' | 'hardcover'

export interface HSFinishedBook {
  id: string
  source: HSFinishedBookSource
  libraryItemId: string | null
  title: string
  author: string | null
  isbn: string | null
  dateFinished: string | null
  rating: number | null
  hardcoverBookId: string | null
  hardcoverSyncedAt: number | null
  createdAt: number
  updatedAt: number
}

/** GET /hs/finished-books response. */
export interface HSFinishedBooksResponse {
  books: HSFinishedBook[]
}

/** A raw Goodreads CSV row for matching/import. Only title/author/isbn are used. */
export interface HSGoodreadsRow {
  title: string
  author?: string
  isbn?: string
}

/** POST /hs/finished-books/match body. */
export interface HSFinishedBooksMatchRequest {
  libraryId: string
  rows: HSGoodreadsRow[]
}

export type HSMatchStatus = 'auto' | 'ambiguous' | 'none'

export interface HSMatchCandidate {
  libraryItemId: string
  title: string
  author: string
  score: number
}

/** One input row echoed with its library-match result. */
export interface HSFinishedBookMatch {
  title: string
  author: string | undefined
  isbn: string | undefined
  status: HSMatchStatus
  candidates: HSMatchCandidate[]
}

/** POST /hs/finished-books/match response. */
export interface HSFinishedBooksMatchResponse {
  matches: HSFinishedBookMatch[]
}

/** A reviewed row for import (already resolved to a definite id or a null stub). */
export interface HSFinishedBookImportRow {
  title: string
  libraryItemId?: string | null
  author?: string | null
  isbn?: string | null
  dateFinished?: string | null
  rating?: number | null
}

/** POST /hs/finished-books/import body. */
export interface HSFinishedBooksImportRequest {
  rows: HSFinishedBookImportRow[]
}

/** POST /hs/finished-books/import response. */
export interface HSUpsertResult {
  inserted: number
  updated: number
}

/** POST /hs/finished-books/sync-abs response. */
export interface HSSyncAbsResult {
  inserted: number
}

/** GET/PUT /hs/finished-books/hardcover response. Never returns the token. */
export interface HSHardcoverAccount {
  connected: boolean
  username: string | null
  lastSyncAt: number | null
  lastSyncStatus: string | null
  lastSyncError: string | null
}

/** PUT /hs/finished-books/hardcover body. */
export interface HSHardcoverConnectRequest {
  token: string
}

export interface HSHardcoverSyncError {
  title: string
  error: string
}

/** POST /hs/finished-books/hardcover/sync response. */
export interface HSHardcoverSyncResult {
  synced: number
  notFound: string[]
  errors: HSHardcoverSyncError[]
}

// --- Integrations (/hs/integrations/config, admin) ------------------------

export type HSAudibleRegion = 'us' | 'ca' | 'uk' | 'au' | 'in' | 'de' | 'es' | 'fr'

/** Which integration fields are pinned by env (read-only in UI). */
export interface HSIntegrationsEnvLocks {
  rmabUrl: boolean
  rmabLoginToken: boolean
  audplexusUrl: boolean
  audplexusKey: boolean
  audibleRegion: boolean
}

/** GET/PUT /hs/integrations/config response. Never leaks secrets. */
export interface HSIntegrationsConfig {
  rmabUrl: string | null
  rmabConfigured: boolean
  rmabHasToken: boolean
  audplexusUrl: string | null
  audplexusConfigured: boolean
  audplexusHasKey: boolean
  audibleRegion: HSAudibleRegion
  validRegions: HSAudibleRegion[]
  env: HSIntegrationsEnvLocks
}

/** PUT /hs/integrations/config body (partial patch; env-pinned fields ignored).
 *  Secret fields: '' ignored (keeps stored), null clears, string sets. */
export interface HSIntegrationsPatch {
  rmabUrl?: string | null // null or '' clears the stored URL
  rmabLoginToken?: string | null
  audplexusUrl?: string | null // null or '' clears the stored URL
  audplexusKey?: string | null
  audibleRegion?: HSAudibleRegion
}

// --- Audible catalog search (/hs/audible/*) -------------------------------
// HearthShelf's own mapped shape over Audible's public catalog. Absent optional
// fields are omitted from JSON (undefined), not null.

export interface HSAudibleSearchResult {
  asin: string
  title: string
  author: string
  authorAsin?: string
  narrator?: string
  description?: string
  coverArtUrl?: string
  durationMinutes?: number
  releaseDate?: string
  rating?: number
  series?: string
  seriesAsin?: string
}

/** GET /hs/audible/search response. */
export interface HSAudibleSearchResponse {
  query: string
  results: HSAudibleSearchResult[]
  totalResults: number
  page: number
  hasMore: boolean
}

/** A series child book: a search result plus its series sequence. `owned` is set
 *  by the server when it has precomputed the roster against the ABS library (a
 *  library-wide fact, ASIN-accurate); absent on older servers, where clients fall
 *  back to matching the roster against owned books locally. */
export interface HSAudibleSeriesBook extends HSAudibleSearchResult {
  sequence: string | null
  owned?: boolean
}

/** GET /hs/audible/series response. Empty (`seriesAsin: null, books: []`) when unresolved. */
export interface HSAudibleSeriesResponse {
  name: string
  seriesAsin: string | null
  seriesTitle?: string
  books: HSAudibleSeriesBook[]
}

// --- RMAB (/hs/rmab/*) - thin proxy to ReadMeABook -------------------------
// Only the config status is HearthShelf-owned. Every other RMAB body (search
// results, requests, watch lists) is RMAB-defined and forwarded verbatim; it is
// NOT reshaped here. Model those as HSRmabPassthrough unless RMAB's own types are
// shared.

/** GET /hs/rmab/config - the only HS-owned RMAB shape. */
export interface HSRmabConfig {
  configured: boolean
}

/** PATCH /hs/rmab/requests/:id body. Only these two actions are accepted. */
export interface HSRmabRequestPatchBody {
  action: 'cancel' | 'retry'
}

/** RMAB-defined body forwarded verbatim (search results, request objects, watch
 *  lists). Not owned or validated by HearthShelf. */
export type HSRmabPassthrough = unknown

// --- Audplexus (/hs/audplexus/*) - thin proxy, admin -----------------------

/** GET /hs/audplexus/config. Always `{ configured: false }` for non-admins. */
export interface HSAudplexusConfig {
  configured: boolean
}

/** GET /hs/audplexus/status - Audplexus-defined diagnostics body, forwarded verbatim. */
export type HSAudplexusStatus = unknown

// --- Service accounts (/hs/service-accounts, admin) ------------------------

/** An ABS user id tagged as a HearthShelf service account. */
export type HSServiceAccountId = string

/** GET/POST/DELETE /hs/service-accounts response. */
export interface HSServiceAccountsResponse {
  ids: HSServiceAccountId[]
}

// --- Telemetry (/hs/telemetry, admin-editable) -----------------------------

export type HSTelemetryUserBucket = '1' | '2-5' | '6-20' | '21+'
export type HSTelemetryBookBucket = '0' | '1-99' | '100-999' | '1000+'

export interface HSTelemetryPayloadPreview {
  telemetry_id: string
  hs_version: string | null
  abs_version: string | null
  mode: HSMode
  user_bucket: HSTelemetryUserBucket
  book_bucket: HSTelemetryBookBucket
  quests_given: number
  quests_accepted: number
  books_finished: number
  club_books_finished: number
  clubs_active: number
}

/** GET /hs/telemetry response. */
export interface HSTelemetryStatus {
  enabled: boolean
  canEdit: boolean
  payloadPreview: HSTelemetryPayloadPreview
}

// --- Hosted setup / pairing (/hs/hosted/*) --------------------------------
// Host/admin-plane. `connect` is the everyday hosted-SPA login exchange; the rest
// is the pairing wizard + admin recovery. Several forward control-plane JSON
// verbatim - those are CP-owned and typed as named opaque aliases.

/** POST /hs/hosted/connect - exchange a control-plane grant for a per-user ABS token. */
export interface HSHostedConnectRequest {
  grant: string
}

export interface HSHostedConnectResponse {
  token: string
  userId: string
  role: 'user' | 'admin'
}

/** GET /hs/hosted/config status. */
export interface HSHostedConfigStatus {
  mode: HSMode
  paired: boolean
  hasAbsAdminToken: boolean
  issuer: string | null
}

/** PUT /hs/hosted/config body. */
export interface HSHostedConfigUpdateRequest {
  absAdminToken?: string
  issuer?: string
  jwksUrl?: string
}

export interface HSHostedRecoveredAdmin {
  id: string
  username: string
}

/** POST /hs/hosted/recover-admins response. */
export interface HSHostedRecoverAdminsResponse {
  ok: true
  recovered: HSHostedRecoveredAdmin[]
  count: number
}

/** GET /hs/hosted/email-relay status. */
export interface HSHostedEmailRelayStatus {
  available: boolean
  paired: boolean
  optedOut: boolean
  active: boolean
  host: string
  port: number
}

/** GET /hs/hosted/port-check result. */
export interface HSHostedPortCheckResult {
  open: boolean
  port: number
  publicIp: string | null
}

/** GET /hs/hosted/hsdirect state. */
export interface HSHostedHsDirectState {
  status: 'opted_out' | 'not_paired' | 'pending' | 'active'
  publicUrl: string | null
  host: string | null
}

/** POST /hs/hosted/pair body. */
export interface HSHostedPairRequest {
  controlPlaneUrl?: string
  publicUrl?: string
  name?: string
}

/** POST /hs/hosted/pair response. */
export interface HSHostedPairResponse {
  code: string
  expires_at: string | number
  control_plane: string
  issuer: string
}

/** POST /hs/hosted/invite body. */
export interface HSHostedInviteRequest {
  email: string
  role?: 'admin' | 'user'
}

/** Control-plane-owned response bodies forwarded verbatim by the hosted routes.
 *  Fields are defined by the control plane, not this backend - do not over-specify. */
export type HSHostedReachabilityResult = Record<string, unknown>
export type HSHostedPairStatusResult = Record<string, unknown>
export type HSHostedInviteResult = Record<string, unknown>

// --- Community config (/hs/social/community-config) -----------------------
// Instance-wide community settings + feature kill-switches. `canEdit` reflects
// whether the caller (admin) may PUT changes.

export interface HSCommunityConfig {
  defaultShare: boolean // reading-list leaderboard default (opt-out, on)
  defaultShareListening: boolean // listening-now presence default (off)
  notesEnabled: boolean // public-notes kill-switch (on)
  clubsEnabled: boolean // book-club kill-switch (on)
  canEdit: boolean // caller is admin (may PUT)
}

/** PUT /hs/social/community-config body (partial patch; admin-only). */
export interface HSCommunityConfigPatch {
  defaultShare?: boolean
  defaultShareListening?: boolean
  notesEnabled?: boolean
  clubsEnabled?: boolean
}

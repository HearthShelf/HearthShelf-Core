// Shapes the server admin area reads and writes, shared by every client. Field
// shapes verified against audiobookshelf 2.35.1 controllers and serializers, and
// against the HearthShelf backend for the /hs/* routes.
import type { ABSLibrarySettings, ABSUserPermissions } from './abs.ts'

// --- Users ------------------------------------------------------------------

export type ABSUserType = 'admin' | 'user' | 'guest'

/** Fields shared by create and edit. permissions is partial: only the toggles a
 *  client exposes are sent, and ABS keeps its defaults for the rest.
 *  librariesAccessible and itemTagsSelected live inside permissions. */
export interface UserFormValues {
  username: string
  email?: string | null
  type: ABSUserType
  isActive: boolean
  permissions: Partial<ABSUserPermissions>
}

/** GET /api/users/online. App and REST users never open the ABS web socket, so
 *  usersOnline is usually empty for HearthShelf; openSessions is the real signal. */
export interface ABSUsersOnlineResponse {
  usersOnline?: { id: string }[]
  openSessions?: { userId: string }[]
}

/** GET /hs/service-accounts, and the echo from tagging or untagging. */
export interface ServiceAccountIdsResponse {
  ids: string[]
}

// --- Listening sessions -----------------------------------------------------

/** One row of GET /api/sessions (all users, admin). */
export interface ABSAdminSession {
  id: string
  userId: string
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
}

export interface ABSSessionsResponse {
  total: number
  numPages: number
  page: number
  itemsPerPage: number
  sessions: ABSAdminSession[]
}

/** A mediaProgress row off GET /api/users/:id. Carries what explains an unfinished
 *  book: how far in they are, whether finishedAt was stamped, and the duration ABS
 *  measured against. */
export interface ABSUserMediaProgress {
  id: string
  libraryItemId: string
  episodeId: string | null
  /** Seconds ABS believes the item runs. 0 means ABS never measured it. */
  duration: number
  /** 0..1 fraction complete. */
  progress: number
  currentTime: number
  isFinished: boolean
  hideFromContinueListening: boolean
  lastUpdate: number
  startedAt: number
  finishedAt: number | null
  displayTitle?: string
}

// --- Libraries --------------------------------------------------------------

/** A metadata source from GET /api/search/providers. */
export interface MetadataProvider {
  text: string
  value: string
}

/** A folder in a library update. Existing folders keep their id; new ones send
 *  just fullPath. ABS treats the array as the complete desired set, so any
 *  existing folder left out is REMOVED along with all its library items. */
export interface LibraryFolderInput {
  id?: string
  fullPath: string
}

/** The editable library fields. All optional: only changed keys are sent. */
export interface LibraryUpdatePayload {
  name?: string
  provider?: string
  icon?: string
  folders?: LibraryFolderInput[]
  settings?: Partial<ABSLibrarySettings>
}

// --- Notifications, email, RSS, auth, providers -----------------------------

export interface ABSNotificationRule {
  id: string
  eventName: string
  enabled: boolean
}

export interface ABSNotificationSettings {
  appriseType: string | null
  appriseApiUrl: string | null
  notifications: ABSNotificationRule[]
  maxFailedAttempts: number
  notificationDelay: number
}

export interface ABSEreaderDevice {
  name: string
  email: string
}

export interface ABSEmailSettings {
  host: string | null
  port: number | null
  secure: boolean
  rejectUnauthorized: boolean
  user: string | null
  fromAddress: string | null
  testAddress: string | null
  ereaderDevices: ABSEreaderDevice[]
}

export interface ABSRssFeed {
  id: string
  entityType: string
  entityId: string
  feedUrl: string
  meta?: { title?: string }
}

/** GET /api/auth-settings. authOpenIDClientSecret is write-only and never returned. */
export interface ABSAuthSettings {
  authActiveAuthMethods: string[]
  authLoginCustomMessage: string | null
  authOpenIDIssuerURL: string | null
  authOpenIDClientID: string | null
  authOpenIDButtonText: string | null
  authOpenIDAutoLaunch: boolean
  authOpenIDAutoRegister: boolean
}

/** GET /api/custom-metadata-providers. Built-in providers are not listed. */
export interface ABSCustomProvider {
  id: string
  name: string
  url: string
}

// --- Stats ------------------------------------------------------------------

export interface ABSServerStatsBucket {
  numItems: number
  numAudioFiles: number
  totalSize: number
}

export interface ABSServerStats {
  books: ABSServerStatsBucket
  podcasts: ABSServerStatsBucket
  total: ABSServerStatsBucket
}

/** GET /hs/stats/server-activity: anonymous all-user activity. */
export interface HSServerActivity {
  available: boolean
  /** All-time listening seconds by local hour, indices 0-23. */
  byHour: number[]
  /** All-time listening seconds by local weekday, Sunday first. */
  byDay: number[]
}

export interface ABSLibraryStatsItem {
  id: string
  title: string
  size?: number
  duration?: number
}

export interface ABSLibraryStats {
  totalItems: number
  totalAuthors: number
  totalGenres: number
  totalSize: number
  totalDuration: number
  numAudioTracks: number
  largestItems: ABSLibraryStatsItem[]
  longestItems: ABSLibraryStatsItem[]
}

// --- Scheduled jobs (/hs/jobs) ----------------------------------------------

export interface JobRun {
  id: string
  jobId: string
  trigger: 'schedule' | 'manual'
  status: 'running' | 'ok' | 'error'
  startedAt: number
  finishedAt: number | null
  summary: string | null
  error: string | null
  itemsProcessed: number
  itemsTotal: number
}

export interface JobSummary {
  id: string
  name: string
  description: string
  intervalMs: number
  running: boolean
  lastRun: JobRun | null
}

export interface JobLogLine {
  seq: number
  at: number
  level: 'info' | 'warn' | 'error'
  message: string
}

// --- HS backups -------------------------------------------------------------

/** POST /hs/backups/:id/restore and /hs/archive/restore. */
export interface HsRestoreResult {
  ok: boolean
  crossServer?: boolean
  escapeDir?: string
}

// --- Hosted (/hs/hosted, /hs/runtime) ---------------------------------------

/** ABS and HearthShelf backend versions, both off GET /hs/runtime. Either can be
 *  absent on an older box or a slim ABS with no HS backend. */
export interface ServerVersions {
  /** audiobookshelf server version, e.g. "2.35.1". */
  absVersion: string | null
  /** HearthShelf backend version, e.g. "0.1.0". null if no HS backend. */
  hsVersion: string | null
}

/** POST /hs/hosted/pair-status. The concrete fields clients read off the
 *  control-plane passthrough that HSHostedPairStatusResult leaves opaque. */
export interface PairStatus {
  claimed: boolean
  expired: boolean
  name: string | null
  claimedByEmail: string | null
}

/** POST /hs/hosted/invite. The concrete fields clients read off the passthrough
 *  that HSHostedInviteResult leaves opaque. */
export interface InviteResult {
  ok: boolean
  email: string
  role: 'admin' | 'user'
  /** The freshly minted invite code, shown to the admin. */
  code: string
  /** False if the email couldn't be sent - the admin should read out the code. */
  emailed: boolean
}

export interface PendingInvite {
  id: string
  email: string
  role: 'admin' | 'user'
  /** The XXXX-XXXX code, so an admin can read it out if the email never landed. */
  code: string | null
  created_at: number
  expires_at: number | null
}

export interface RemoveUserResult {
  ok: boolean
  /** The ABS account is gone. */
  deleted: boolean
  /** The hosted-side link is gone too. False when unpaired or the control plane
   *  couldn't be reached: the user is removed locally but would still see this
   *  server in their picker. */
  unlinked: boolean
  email: string | null
  invites_revoked?: number
}

/** GET /hs/hosted/linked-users: who has signed in through the hosted app. */
export interface HostedLinkedUsersResponse {
  linked?: { absUserId: string; email: string }[]
}

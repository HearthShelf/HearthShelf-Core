// Data-lifecycle wire shapes - backups, the .hsarchive portability format, and
// (stubbed for Phase 4) import reports. Shared by web, hosted web, mobile admin
// screens, and the self-hosted server so every surface agrees on the shape.
//
// The server-side data-domain REGISTRY (which names real tables/columns) lives
// in HearthShelf's server/lib/dataDomains.js; only the shapes that cross the
// wire live here. See docs/data-lifecycle/archive-format.md and backups.md.

// --- HearthShelf backups (Phase 1) ----------------------------------------

/** One HS backup file on disk, as listed by GET /hs/backups. */
export interface HsBackupEntry {
  id: string // opaque id (the filename without extension)
  filename: string
  size: number // bytes
  createdAt: number // ms epoch
  hsVersion: string
}

/** The editable HS backup schedule + retention. Any field pinned by an env var
 * is reported in `env` and is read-only in the UI (env-overrides-DB, per field,
 * the same model as ai_config / integrations_config). */
export interface HsBackupConfig {
  schedule: string // cron; '' or 'off' disables the schedule
  keep: number // how many backups to retain
  offBoxPath: string | null // HS_BACKUP_PATH mirror target, if set
  env: {
    schedule: boolean
    keep: boolean
    offBoxPath: boolean
  }
}

/** GET /hs/backups response. */
export interface HsBackupsResponse {
  backups: HsBackupEntry[]
  config: HsBackupConfig
  lastRun: {
    at: number
    status: 'ok' | 'error' | 'running'
    summary: string | null
  } | null
  // Where backups are written (for the "same volume" honesty note in the UI).
  backupDir: string
}

// --- The HS backup manifest (inside each .hsbackup zip) --------------------

/** One data domain's presence in a backup, straight from the registry. */
export interface BackupDomainSummary {
  key: string
  rows: number
}

/** manifest.json inside a .hsbackup zip. Format version gates restore: a reader
 * refuses a manifestVersion above what it knows. */
export interface HsBackupManifest {
  format: 'hsbackup'
  manifestVersion: number
  createdAt: number
  serverId: string
  serverName: string | null
  hsVersion: string
  includesSecrets: true // server backups always carry secrets (see backups.md)
  domains: BackupDomainSummary[]
  // Relative paths of the file trees included (e.g. 'avatars', 'narrators').
  fileRoots: string[]
}

// --- The .hsarchive portability format (Phase 2) --------------------------

export type ServerMode = 'aio' | 'slim' | 'hosted'

/** manifest.json inside a .hsarchive. See archive-format.md. Either half may be
 * absent (a Thin install exports HS-only; an ABS-only export re-wraps a backup),
 * so consumers must handle `present: false` on each. */
export interface HsArchiveManifest {
  format: 'hsarchive'
  formatVersion: number
  createdAt: number
  source: {
    serverId: string
    serverName: string | null
    hsVersion: string
    absVersion: string | null
    mode: ServerMode
  }
  contents: {
    abs: {
      present: boolean
      filename?: string
      size?: number
      absBackupId?: string
    }
    hs: {
      present: boolean
      filename?: string
      size?: number
      domains?: BackupDomainSummary[]
    }
  }
  includesSecrets: boolean
  checksums: Record<string, string> // path -> 'sha256:...'
  // Reserved for future whole-archive passphrase encryption (v1 omits it).
  encryption?: { algorithm: string } | null
}

/** How an uploaded archive is applied. See archive-format.md > Consuming. */
export type ArchiveRestoreMode = 'replace' | 'hs-only' | 'import'

/** GET /hs/archive/estimate - sizes shown before a download. */
export interface HsArchiveEstimate {
  absPresent: boolean
  hsPresent: boolean
  absBytes: number | null // null when unknown until produced
  hsBytes: number | null
}

// --- Import report (Phase 4 - shape reserved now, engine builds later) -----

// --- Import / merge engine (Phase 4) --------------------------------------
//
// The engine builds two maps - sourceUserId->targetUserId and
// sourceMediaId->targetMediaId - then everything downstream consumes only those.
// All shapes here are pure data so the matching + merge logic (lib/portability.ts)
// is unit-testable and shared. See docs/data-lifecycle/merge-engine.md.

/** How a source entity was matched to (or will be created on) this server. */
export type MatchMethod = 'inode' | 'asin' | 'isbn' | 'fuzzy' | 'id' | 'email' | 'username' | 'none'

/** Which flow the engine is running - each is the same pipeline, different intent.
 *  - import:           bring another server's users + histories in
 *  - restore-as-import: recover selected users from a backup of THIS server
 *  - relink:           re-attach this server's own history to rescanned item ids */
export type ImportMode = 'import' | 'restore-as-import' | 'relink'

/** A minimal source/target library item for matching (books only in v1). */
export interface MatchItem {
  libraryItemId: string
  mediaId: string // the book/media id progress references (not the libraryItem id)
  title: string
  author: string | null
  asin: string | null
  isbn: string | null
  ino: string | null // file inode as a string, when known
  isPodcast?: boolean
}

/** One item-match decision, recorded with its method for the report. */
export interface ItemMatch {
  sourceItemId: string
  sourceMediaId: string
  sourceLabel: string
  targetItemId: string | null
  targetMediaId: string | null
  method: MatchMethod
  fuzzy: boolean
}

/** A minimal source/target user for matching. */
export interface MatchUser {
  id: string
  username: string
  email: string | null
  type: string // 'root' | 'admin' | 'user' | 'guest'
  isActive?: boolean
}

/** One user-match proposal (admin-editable in the dry-run UI). action 'create'
 *  means no target existed; 'map' points the source user at an existing target;
 *  'skip' excludes them (default for root/service/guest). */
export interface UserMatch {
  sourceUserId: string
  sourceLabel: string
  sourceEmail: string | null
  sourceType: string
  targetUserId: string | null
  action: 'map' | 'create' | 'skip'
  method: MatchMethod
}

/** ABS media-progress row shape the merge rules operate on (subset). */
export interface ProgressRow {
  mediaItemId: string // the media id (book/episode)
  libraryItemId?: string
  isFinished?: boolean
  finishedAt?: number | null
  currentTime?: number
  ebookLocation?: string | null
  ebookProgress?: number | null
  hideFromContinueListening?: boolean
  lastUpdate?: number // epoch ms - LWW key
}

/** A bookmark (union by item+time). */
export interface BookmarkRow {
  libraryItemId: string
  time: number
  title?: string
  createdAt?: number
}

/** Per-domain plan counts for the dry-run report. */
export interface DomainPlan {
  key: string
  policy: 'union' | 'lww' | 'skip' | 'custom'
  toWrite: number
  skipped: number
  note?: string
}

/** The full dry-run report, persisted as a job run and required (by id) to
 *  execute. Regenerated if the target state changed since it was produced. */
export interface ImportReport {
  reportId: string
  engineVersion: number
  mode: ImportMode
  createdAt: number
  source: {
    serverId: string | null
    serverName: string | null
    kind: 'live' | 'archive' | 'backup'
  }
  sameServer: boolean // source serverId === this server (restore-as-import / relink)
  users: UserMatch[]
  items: {
    matched: number
    fuzzy: number
    unmatched: ItemMatch[] // items with no target (their progress is skipped)
    podcastSkipped: number
  }
  perUser: Record<string, { progress: number; sessions: number; bookmarks: number }>
  domains: DomainPlan[]
  warnings: string[]
}

/** The result of an execute run (also persisted). */
export interface ImportResult {
  reportId: string
  createdAt: number
  usersCreated: number
  usersMerged: number
  progressWritten: number
  sessionsWritten: number
  bookmarksWritten: number
  domainsMerged: Record<string, number>
  createdUserInvites: { userId: string; email: string | null; username: string }[]
  warnings: string[]
  backup: { hsBackup: string | null; absBackupId: string | null }
}

export const IMPORT_ENGINE_VERSION = 1

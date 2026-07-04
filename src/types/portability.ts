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

/** A single proposed or applied mapping between a source entity and this
 * install. Reserved shape; the merge engine (Phase 4) fills it in. */
export interface ImportMapping {
  kind: 'user' | 'item'
  sourceId: string
  sourceLabel: string
  matchedId: string | null
  confidence: 'exact' | 'fuzzy' | 'none'
}

export interface ImportReport {
  createdAt: number
  source: { serverId: string | null; serverName: string | null }
  mappings: ImportMapping[]
  domainCounts: Record<string, { toWrite: number; skipped: number }>
  warnings: string[]
}

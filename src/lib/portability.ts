// Pure helpers for the data-lifecycle formats: version gating and manifest
// validation for HS backups and .hsarchive bundles. No I/O - the server reads
// the zip and hands the parsed manifest here; the client does the same before an
// upload. One compatibility table owned in one place. See
// docs/data-lifecycle/archive-format.md.

import type { HsArchiveManifest, HsBackupManifest } from '../types/portability.ts'

// The highest format/manifest versions THIS build knows how to read. A reader
// refuses anything above these (a newer backup on older code). Older versions
// upgrade forward through the normal boot migrations after restore. Bump these
// (additively) when the format grows a field a reader must understand.
export const CURRENT_BACKUP_MANIFEST_VERSION = 1
export const CURRENT_ARCHIVE_FORMAT_VERSION = 1

export interface ValidationResult<T> {
  ok: boolean
  reason?: string
  manifest?: T
}

// A version is readable when it's a positive integer no greater than what this
// build understands. Below-or-equal = fine (forward-migrate); above = reject.
export function isReadableVersion(version: unknown, current: number): boolean {
  return (
    typeof version === 'number' && Number.isInteger(version) && version >= 1 && version <= current
  )
}

/** Validate a parsed .hsbackup manifest before restoring from it. */
export function validateBackupManifest(raw: unknown): ValidationResult<HsBackupManifest> {
  if (!raw || typeof raw !== 'object')
    return { ok: false, reason: 'Manifest is missing or unreadable.' }
  const m = raw as Partial<HsBackupManifest>
  if (m.format !== 'hsbackup') return { ok: false, reason: 'Not a HearthShelf backup manifest.' }
  if (!isReadableVersion(m.manifestVersion, CURRENT_BACKUP_MANIFEST_VERSION)) {
    return {
      ok: false,
      reason: `This backup was made by a newer version of HearthShelf (format ${String(
        m.manifestVersion,
      )}). Update HearthShelf, then restore.`,
    }
  }
  if (typeof m.serverId !== 'string' || !m.serverId) {
    return { ok: false, reason: 'Manifest is missing its server id.' }
  }
  return { ok: true, manifest: m as HsBackupManifest }
}

/** Validate a parsed .hsarchive manifest before restoring/importing from it. */
export function validateArchiveManifest(raw: unknown): ValidationResult<HsArchiveManifest> {
  if (!raw || typeof raw !== 'object')
    return { ok: false, reason: 'Archive manifest is missing or unreadable.' }
  const m = raw as Partial<HsArchiveManifest>
  if (m.format !== 'hsarchive') return { ok: false, reason: 'Not a HearthShelf archive.' }
  if (!isReadableVersion(m.formatVersion, CURRENT_ARCHIVE_FORMAT_VERSION)) {
    return {
      ok: false,
      reason: `This archive was made by a newer version of HearthShelf (format ${String(
        m.formatVersion,
      )}). Update HearthShelf, then restore.`,
    }
  }
  if (!m.contents || (!m.contents.abs?.present && !m.contents.hs?.present)) {
    return {
      ok: false,
      reason: 'Archive is empty - it contains neither an AudiobookShelf nor a HearthShelf backup.',
    }
  }
  if (!m.source || typeof m.source.serverId !== 'string') {
    return { ok: false, reason: 'Archive manifest is missing its source server id.' }
  }
  return { ok: true, manifest: m as HsArchiveManifest }
}

/** True when an archive/backup came from a DIFFERENT server than this one -
 * i.e. restoring it is a migration, not a same-install restore. The UI warns
 * and links to the migration playbooks in that case. */
export function isCrossServer(manifestServerId: string, thisServerId: string): boolean {
  return Boolean(manifestServerId) && Boolean(thisServerId) && manifestServerId !== thisServerId
}

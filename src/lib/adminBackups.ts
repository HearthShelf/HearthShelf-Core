// Backup logic for the server admin area.
import type { ABSServerSettings } from '../types/abs.ts'
import type { HsBackupsResponse } from '../types/portability.ts'

/** Automatic backup choices, as cron strings. '' turns the schedule off. */
export const BACKUP_SCHEDULE_PRESETS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Off - no automatic backups' },
  { value: '0 1 * * *', label: 'Every day at 1:00 AM' },
  { value: '30 1 * * *', label: 'Every day at 1:30 AM' },
  { value: '0 3 * * *', label: 'Every day at 3:00 AM' },
  { value: '0 1 * * 0', label: 'Every Sunday at 1:00 AM' },
]

/** True when ABS has no automatic backup schedule. */
export function isAbsScheduleOff(backupSchedule: ABSServerSettings['backupSchedule']): boolean {
  return !backupSchedule
}

/** True when the HearthShelf backend answered and has no schedule. A null response
 *  means the box's backend is unreachable or older, which is not the same as off. */
export function isHsScheduleOff(hs: Pick<HsBackupsResponse, 'config'> | null | undefined): boolean {
  return Boolean(hs) && !hs?.config?.schedule
}

/** The file name for a downloaded .hsarchive, from its Content-Disposition header. */
export function archiveFilename(contentDisposition: string | null | undefined): string {
  const match = (contentDisposition || '').match(/filename="([^"]+)"/)
  return match?.[1] ?? 'hearthshelf.hsarchive'
}

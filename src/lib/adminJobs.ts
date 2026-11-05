// Display logic for the server's scheduled jobs.
import type { JobRun } from '../types/admin.ts'

export type JobStatusTone = 'info' | 'success' | 'danger'

/** Each client maps the tone to its own color. */
export const JOB_STATUS_META: Record<JobRun['status'], { tone: JobStatusTone; label: string }> = {
  running: { tone: 'info', label: 'Running' },
  ok: { tone: 'success', label: 'Success' },
  error: { tone: 'danger', label: 'Failed' },
}

export function fmtJobWhen(ms: number | null): string {
  if (!ms) return 'never'
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function fmtJobInterval(ms: number): string {
  const h = ms / 3_600_000
  if (h % 24 === 0) return h / 24 === 1 ? 'Daily' : `Every ${h / 24} days`
  return h === 1 ? 'Hourly' : `Every ${h}h`
}

/** How long a finished run took, or '' while it is still going. */
export function fmtJobDuration(run: Pick<JobRun, 'startedAt' | 'finishedAt'>): string {
  if (!run.finishedAt) return ''
  const s = Math.round((run.finishedAt - run.startedAt) / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

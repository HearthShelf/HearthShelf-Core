// Hosted connection logic for the server admin area.
import type { HSServiceHealth } from '../types/hs.ts'

/** A failed /hs/hosted/* call: the backend's machine-readable code and HTTP status,
 *  so a client can map them to friendly copy. `detail` is a technical note for logs. */
export class HostedError extends Error {
  code: string
  status: number
  detail: string | null
  constructor(code: string, status: number, detail: string | null) {
    super(code)
    this.name = 'HostedError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

/**
 * The box answered, but something beyond it could not be reached: the connect
 * domain's broker is down, its probe could not run, or the box itself dropped off
 * the network. These say nothing about the app or the user's server settings, and
 * the pages that hit them already explain it in place.
 */
export function isHostedOutage(err: unknown): boolean {
  if (!(err instanceof HostedError)) return false
  return err.code === 'broker_unreachable' || err.code === 'probe_failed' || err.code === 'network'
}

/** "12:34" style mm:ss left until a pairing code expires, or null once gone. The
 *  control plane may report expiry as epoch ms or an ISO-8601 string. */
export function pairingTimeLeft(expiresAt: string | number, nowMs: number): string | null {
  const epoch = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt)
  if (Number.isNaN(epoch)) return null
  const ms = epoch - nowMs
  if (ms <= 0) return null
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export interface ServiceHealthView {
  tone: 'ok' | 'warn' | 'error'
  title: string
  /** Only set when something needs fixing. */
  detail: string | null
}

/** What to tell an admin about the credential that provisions invited users. null
 *  means hosted admin work isn't set up here, so show nothing. */
export function serviceHealthView(
  health: Pick<HSServiceHealth, 'state' | 'username'>,
): ServiceHealthView | null {
  if (health.state === 'absent') return null
  if (health.state === 'valid') {
    const who = health.username ? ` (as ${health.username})` : ''
    return {
      tone: 'ok',
      title: `Service account is healthy - invited users are created automatically${who}.`,
      detail: null,
    }
  }
  if (health.state === 'stale') {
    return {
      tone: 'warn',
      title: 'Service account needs reconnecting',
      detail:
        'The credential HearthShelf uses to create invited accounts has expired. It can be reconnected automatically.',
    }
  }
  return {
    tone: 'error',
    title: 'Service account is broken - invited users cannot be added',
    detail:
      'The saved credential no longer works and could not be restored automatically. Reset it, or supply a new one below.',
  }
}

/** A sentence for a failed manual credential override, from the backend's code. */
export function serviceCredentialErrorMessage(code: string): string {
  if (code === 'bad_service_password') return 'That service password did not work.'
  if (code === 'token_not_admin') return 'That token is not an admin/root token.'
  return 'Could not update the credential. Check the value and try again.'
}

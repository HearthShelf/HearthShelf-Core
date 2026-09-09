/**
 * One way to report errors and logs across every HearthShelf service.
 *
 * Reports go to a self-hosted GlitchTip instance over Sentry's **envelope**
 * wire format, spoken directly rather than through an SDK. That choice is
 * deliberate:
 *
 *  - The Cloudflare Workers that need this (control plane, auth service) run
 *    without `nodejs_compat`, and pulling in a Sentry SDK to send three lines
 *    of newline-delimited JSON would cost bundle size and cold-start time for
 *    no benefit.
 *  - The SDK's Workers support relies on `ctx.waitUntil` and isolate-lifecycle
 *    workarounds whose failure modes are harder to reason about than a fetch.
 *  - Compatibility of `@better-auth`-style SDKs against a *self-hosted* GlitchTip
 *    DSN is not something we could verify from documentation, whereas the
 *    envelope format is a published contract GlitchTip implements in source.
 *
 * Everything here is BEST-EFFORT. Reporting must never be the reason a request
 * fails, so every path swallows its own errors and returns quietly.
 *
 * What GlitchTip accepts (verified against glitchtip-backend's
 * `apps/event_ingest/schema.py`): `event`, `transaction`, `log`, `otel_log`,
 * `user_report`, `feedback`. Notably `span` is IGNORED - tracing works at
 * transaction granularity, so do not expect a cross-service waterfall from
 * standalone spans.
 */

// `URL` and `crypto` are Web-platform globals present in every runtime this
// package targets (browsers, React Native, Workers, and Node 18+), but core's
// build config declares neither DOM nor Node lib types on purpose - it stays
// environment-agnostic. Declaring just what this file uses keeps that property
// instead of widening the whole package's lib for two symbols.
declare const URL: { new (url: string): { origin: string; pathname: string; username: string } }
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T }

/** Severity, matching Sentry's level vocabulary. */
export type TelemetryLevel = 'debug' | 'info' | 'warning' | 'error' | 'fatal'

/** A parsed DSN. */
export interface TelemetryDsn {
  /** Origin to POST to, e.g. "https://errors.hearthshelf.com". */
  origin: string
  /** Numeric project id from the DSN path. */
  projectId: string
  /** Public key (the DSN's user part), sent as the auth header. */
  publicKey: string
}

export interface TelemetryContext {
  /** Which service is reporting, e.g. 'control-plane'. Becomes a tag. */
  service: string
  /** Deployment environment, e.g. 'production'. */
  environment?: string
  /** Release identifier, when the service knows its own version. */
  release?: string
  /** Extra tags applied to every report from this service. */
  tags?: Record<string, string>
}

/**
 * Parse a Sentry/GlitchTip DSN.
 *
 * Shape: `https://<publicKey>@<host>/<projectId>`. Returns null rather than
 * throwing on anything malformed - an unparseable DSN must degrade to "no
 * reporting", never to a crash on a path that only exists to report crashes.
 */
export function parseDsn(dsn: string | undefined | null): TelemetryDsn | null {
  if (!dsn) return null
  try {
    const url = new URL(dsn)
    const projectId = url.pathname.replace(/^\//, '').trim()
    if (!projectId || !url.username) return null
    return { origin: url.origin, projectId, publicKey: url.username }
  } catch {
    return null
  }
}

/** The ingest URL for a parsed DSN. */
export function envelopeUrl(dsn: TelemetryDsn): string {
  return `${dsn.origin}/api/${dsn.projectId}/envelope/`
}

/**
 * The auth header GlitchTip expects.
 *
 * `sentry_key` is the only required field; the version and client are sent
 * because the ingest pipeline logs them and a blank client makes triage harder.
 */
export function authHeader(dsn: TelemetryDsn): string {
  return `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=hearthshelf/1.0`
}

/** RFC4122-ish id without dashes, which is what the event schema wants. */
function eventId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Build an envelope for a single error/message event.
 *
 * An envelope is three newline-delimited JSON objects: the envelope header,
 * the item header, then the payload.
 */
export function buildEventEnvelope(
  ctx: TelemetryContext,
  args: {
    message: string
    level?: TelemetryLevel
    /** Stack trace, when the report came from a thrown error. */
    stack?: string
    /** Searchable key/values. Keep the cardinality low - these are indexed. */
    tags?: Record<string, string>
    /** Arbitrary detail. Not indexed; safe for larger payloads. */
    extra?: Record<string, unknown>
    /** A stable slug for grouping, so one recurring fault is one issue. */
    fingerprint?: string[]
  },
): string {
  const id = eventId()
  const sentAt = new Date().toISOString()

  const header = { event_id: id, sent_at: sentAt }
  const itemHeader = { type: 'event' }
  const payload = {
    event_id: id,
    timestamp: sentAt,
    platform: 'javascript',
    level: args.level ?? 'error',
    logger: ctx.service,
    environment: ctx.environment ?? 'production',
    ...(ctx.release ? { release: ctx.release } : {}),
    message: { formatted: args.message },
    tags: { service: ctx.service, ...ctx.tags, ...args.tags },
    ...(args.fingerprint ? { fingerprint: args.fingerprint } : {}),
    // The raw stack rides in `extra` rather than as parsed frames: building
    // frame objects from a string is guesswork, and a wrong frame list is worse
    // than none.
    ...(args.extra || args.stack
      ? { extra: { ...(args.extra ?? {}), ...(args.stack ? { stack: args.stack } : {}) } }
      : {}),
    ...(args.stack
      ? { exception: { values: [{ type: 'Error', value: args.message }] } }
      : {}),
  }

  return [JSON.stringify(header), JSON.stringify(itemHeader), JSON.stringify(payload)].join('\n')
}

/**
 * Build an envelope carrying structured log records.
 *
 * GlitchTip ingests these as its Logs product (its own UI page with level and
 * service filters), not as errors - so routine operational lines can be
 * reported without each one becoming an "issue" to triage.
 */
export function buildLogEnvelope(
  ctx: TelemetryContext,
  logs: {
    message: string
    level?: TelemetryLevel
    attributes?: Record<string, string | number | boolean>
  }[],
): string {
  const sentAt = new Date().toISOString()
  const header = { event_id: eventId(), sent_at: sentAt }
  const itemHeader = { type: 'log', item_count: logs.length, content_type: 'application/vnd.sentry.items.log+json' }

  const items = logs.map((l) => ({
    timestamp: Date.now() / 1000,
    level: l.level ?? 'info',
    body: l.message,
    attributes: Object.fromEntries(
      Object.entries({
        'sentry.environment': ctx.environment ?? 'production',
        ...(ctx.release ? { 'sentry.release': ctx.release } : {}),
        service: ctx.service,
        ...ctx.tags,
        ...l.attributes,
      }).map(([k, v]) => [k, { value: v, type: typeof v === 'number' ? 'double' : typeof v === 'boolean' ? 'boolean' : 'string' }]),
    ),
  }))

  return [JSON.stringify(header), JSON.stringify(itemHeader), JSON.stringify({ items })].join('\n')
}

// App-connection scopes - the vocabulary a third-party app uses to say what it
// wants, and the user sees on the consent screen.
//
// DELIBERATELY COARSE. A consent screen nobody reads is not consent, so there
// are five scopes and they are server-wide. Per-library scoping was considered
// and rejected: it turns the consent screen into a tree, and the ABS permission
// model underneath is not per-library in a way we could honestly enforce.
//
// Scopes can be WIDENED later but never narrowed - narrowing breaks every app
// already installed against them. Treat this list as close to immutable.
//
// RESERVED: the `events:` prefix is intentionally unused. A later change adds
// event delivery (an app-initiated stream; see the app-connections design doc)
// on that axis, so an app can receive notifications WITHOUT gaining read access
// and vice versa. Do not repurpose a `library:`/`progress:` scope to also mean
// "may receive events" - re-interpreting a shipped scope is not possible once
// apps depend on it.

/** A scope a third-party app can request. Server-wide, coarse by design. */
export type AppScope =
  | 'library:read'
  | 'library:write'
  | 'progress:read'
  | 'progress:write'
  | 'admin'

/** Every valid scope, in the order a consent screen should show them. */
export const APP_SCOPES: readonly AppScope[] = [
  'library:read',
  'library:write',
  'progress:read',
  'progress:write',
  'admin',
] as const

/**
 * Plain-language consent copy. Lives here rather than inline in JSX so the
 * hosted app, the self-hosted box, and mobile all show the SAME words for the
 * same grant - a user who reads one and approves the other should not be
 * surprised.
 *
 * Written as "what this app will be able to do", second person, no jargon.
 */
export const APP_SCOPE_DESCRIPTIONS: Record<AppScope, string> = {
  'library:read': 'See your books, series, authors, and covers',
  'library:write': 'Add and update books in your library',
  'progress:read': 'See what you have listened to and how far you got',
  'progress:write': 'Update your listening progress',
  'admin': 'Administer your server',
}

/**
 * Scopes that deserve extra weight on the consent screen. `admin` is separated
 * from the rest precisely so the common case (an app that files audiobooks)
 * never has to prompt for anything frightening - which means when it IS asked
 * for, it should stand out.
 */
export const SENSITIVE_APP_SCOPES: readonly AppScope[] = ['admin'] as const

/** Narrow an unknown value to a valid scope. */
export function isAppScope(value: unknown): value is AppScope {
  return typeof value === 'string' && (APP_SCOPES as readonly string[]).includes(value)
}

/**
 * Parse a scope list (space-delimited per OAuth, or already an array) into
 * validated scopes. Returns the unknown entries separately rather than throwing
 * or silently dropping them: registration must REJECT an unknown scope naming
 * the offender, while a token check wants to ignore it - same parse, different
 * policy at the call site.
 */
export function parseAppScopes(input: string | readonly string[] | null | undefined): {
  scopes: AppScope[]
  unknown: string[]
} {
  const raw =
    typeof input === 'string'
      ? input.split(/[\s,]+/)
      : Array.isArray(input)
        ? input
        : []
  const scopes: AppScope[] = []
  const unknown: string[] = []
  for (const entry of raw) {
    const trimmed = String(entry ?? '').trim()
    if (!trimmed) continue
    if (isAppScope(trimmed)) {
      if (!scopes.includes(trimmed)) scopes.push(trimmed)
    } else if (!unknown.includes(trimmed)) {
      unknown.push(trimmed)
    }
  }
  return { scopes, unknown }
}

/** Serialize scopes the way OAuth expects them on the wire. */
export function formatAppScopes(scopes: readonly AppScope[]): string {
  return scopes.join(' ')
}

/** Does this scope set permit reading library content? */
export function canReadLibrary(scopes: readonly AppScope[]): boolean {
  return scopes.includes('library:read') || scopes.includes('admin')
}

/** Does this scope set permit writing library content? */
export function canWriteLibrary(scopes: readonly AppScope[]): boolean {
  return scopes.includes('library:write') || scopes.includes('admin')
}

/** Does this scope set permit reading listening progress? */
export function canReadProgress(scopes: readonly AppScope[]): boolean {
  return scopes.includes('progress:read') || scopes.includes('admin')
}

/** Does this scope set permit writing listening progress? */
export function canWriteProgress(scopes: readonly AppScope[]): boolean {
  return scopes.includes('progress:write') || scopes.includes('admin')
}

/**
 * Is `requested` fully covered by `granted`? Used when an already-connected app
 * asks for something new: if this returns false the user must re-consent rather
 * than the extra scope being silently absorbed.
 */
export function scopesCovered(
  granted: readonly AppScope[],
  requested: readonly AppScope[],
): boolean {
  return requested.every((s) => granted.includes(s) || granted.includes('admin'))
}

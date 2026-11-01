// Turning a ReadMeABook rejection into something a person can act on.
//
// Shared because the two clients disagreed about whether to bother. The web app
// mapped five upstream codes to real sentences; mobile threw the code away and
// showed "Request failed. Please try again." for every outcome -- including the
// ones where trying again can only fail the same way forever. That is why a
// request failing for a book already in the library reached us as a verbal
// report rather than as an error: nothing on screen and nothing in Sentry said
// what the server had actually answered.
//
// The wire contract, for reference (HearthShelf server/routes/rmab.js):
//   - The proxy forwards the upstream status and body VERBATIM.
//   - A rejection reason is `body.error`, falling back to `body.message`.
//   - A 2xx can still be a rejection: the proxy treats `body.success === false`
//     as one and logs it, but forwards the 2xx. So a client that only inspects
//     non-2xx responses misses the most common case.
//   - `body` can arrive as `{}` when the upstream sent HTML or nothing, so a
//     rejection with no code at all is a real shape, not a bug.

/** Upstream rejection codes we have sentences for. */
export const RMAB_REJECTION_COPY: Record<string, string> = {
  AlreadyAvailable: 'That title is already in your library.',
  BeingProcessed: 'That title is already being processed.',
  DuplicateRequest: "You've already requested that title.",
  Ignored: 'That title is on your ignore list.',
  UserNotFound: "Couldn't find the requesting account on ReadMeABook.",
}

/** What a client knows about a failed request. Every field is optional because
 *  the proxy can only forward what the upstream sent. */
export interface RmabRejection {
  /** `body.error` when the upstream sent a code. */
  code?: string | null
  /** Free text from `body.detail` / `body.message`. */
  detail?: string | null
  /** The HTTP status the proxy forwarded. */
  status?: number | null
}

/**
 * True when trying the same request again could plausibly succeed.
 *
 * The point of asking is the advice: "Please try again" is actively wrong for
 * every code in the table above and for a 403, because nothing about repeating
 * the call changes the answer. A server error or a dropped connection is the
 * opposite -- that is exactly when retrying is the right move.
 */
export function isRmabRetryable(rejection: RmabRejection): boolean {
  const code = rejection.code ?? ''
  if (code && code in RMAB_REJECTION_COPY) return false
  const status = rejection.status ?? 0
  // 401/403 are settled: the proxy already retried once with a fresh token
  // before giving up (server/rmab.js), so one reaching a client means the
  // account is not permitted, not that the token was merely stale.
  if (status === 401 || status === 403) return false
  // 404 means the endpoint is not there -- a slim deploy without /hs/rmab.
  if (status === 404) return false
  return true
}

/**
 * The sentence to show for a failed request.
 *
 * Unknown codes are surfaced rather than swallowed: an upstream code nobody has
 * written copy for is still far more useful to a person reporting it than
 * "Request failed", and it is how the next unmapped code gets noticed at all.
 */
export function rmabRejectionMessage(rejection: RmabRejection): string {
  const code = (rejection.code ?? '').trim()
  const known = code ? RMAB_REJECTION_COPY[code] : undefined
  if (known) return known

  const detail = (rejection.detail ?? '').trim()
  const status = rejection.status ?? 0

  if (status === 401 || status === 403) {
    return detail || 'Your account is not allowed to request titles on this server.'
  }
  if (status === 404) {
    return 'This server does not have book requests set up.'
  }
  if (status >= 500) {
    return detail || 'The request service is having trouble. Try again in a little while.'
  }
  // Something was said, just not something we have copy for.
  if (code) return detail ? `${code}: ${detail}` : `The request was refused (${code}).`
  if (detail) return detail
  return status
    ? `The request was refused (HTTP ${status}).`
    : 'The request could not be sent. Check your connection and try again.'
}

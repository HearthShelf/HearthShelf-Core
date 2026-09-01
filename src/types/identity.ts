// The authenticated identity contract, shared by the control plane and the
// clients that sign in against it.
//
// This type exists to make the identity PROVIDER a swappable detail. The
// control plane's job is to turn "some proof the caller is a person" into a
// short-lived grant assertion it signs itself; the self-hosted boxes verify
// only that signature (see HearthShelf/server/lib/hosted.js). Nothing
// downstream of the control plane knows or cares which provider issued the
// session, which is what allows the provider to change without touching a
// single box - including boxes we do not operate.
//
// Two properties are load-bearing during the Clerk -> Better Auth migration:
//
//  1. `subject` is STABLE ACROSS PROVIDERS. It is the value that appears as
//     `sub` in every grant, and it is the primary key of per-user rows on
//     every box (hosted_user_keys.cp_subject, app_installations.cp_subject).
//     Migrated accounts therefore keep their original Clerk user id forever -
//     the id is ours now, and its `user_...` shape is a historical accident,
//     not a Clerk dependency. Re-keying it would orphan data on machines we
//     cannot coordinate a migration across.
//
//  2. `email` must be VERIFIED before a grant is minted. Boxes match an ABS
//     user by email on the cold path, so an unverified address would be an
//     account-takeover vector against someone else's server.

/** An identity provider the control plane can authenticate a session against. */
export type IdentityProvider = 'clerk' | 'better-auth'

/**
 * A social/OAuth identity linked to an account.
 *
 * `providerAccountId` is the provider's own stable subject for the user
 * (Google's `sub`, Apple's `sub`, Discord's snowflake) - NOT an email, which
 * users can change and Apple relays per developer team.
 */
export interface LinkedIdentity {
  /** Bare provider name, no `oauth_` prefix: 'google' | 'apple' | 'discord'. */
  provider: string
  /** The provider's stable subject for this user. */
  providerAccountId: string
  /** Email the provider asserted, when it asserted one. Informational only. */
  email?: string
}

/**
 * The resolved caller identity, whichever provider verified the session.
 *
 * Deliberately the same shape Clerk verification already returned, so the
 * swap is one function's implementation rather than a change that ripples
 * through every route.
 */
export interface AuthIdentity {
  /**
   * Stable account id, used as the grant `sub` and as the per-user primary key
   * on every box. Preserved verbatim across the provider migration.
   */
  subject: string
  /** Verified email address. */
  email: string
  /** Whether the provider considers the address verified. Must be true to mint. */
  emailVerified: boolean
  /** Display username. May be empty; boxes reconcile ABS usernames to it. */
  username: string
  /** Which provider verified this session. Observability + migration triage. */
  provider: IdentityProvider
}

/**
 * A pre-seeded account carried over from a previous identity provider.
 *
 * The migration seeds one of these per existing user so that the FIRST
 * sign-in through the new provider attaches to the existing `subject` instead
 * of minting a new account. Matching is by verified email, or by an exact
 * (provider, providerAccountId) hit - the latter matters for Apple Private
 * Relay users, whose relay address is per developer team and so cannot be
 * matched by email alone.
 */
export interface LegacyAccountSeed {
  /** The `subject` this account must keep. */
  legacyId: string
  email: string
  emailVerified: boolean
  username: string
  /** OAuth identities the previous provider had on file. */
  oauth: LinkedIdentity[]
  /** Whether the previous provider held a password for this account. */
  hasPassword: boolean
  /** Original account creation time (ms epoch), preserved for continuity. */
  createdAt?: number
}

/**
 * Decide which pre-seeded legacy account a freshly authenticated identity
 * belongs to, if any.
 *
 * Order matters. An exact OAuth subject match is checked FIRST because it is
 * the only signal that survives Apple Private Relay: the relay address differs
 * per developer team, so an Apple user's email may not match anything on file
 * even though it is unambiguously the same person. Email is the fallback for
 * the common case, and is only trusted when the provider verified it.
 *
 * Returns the matching seed, or null when this is a genuinely new account.
 */
export function matchLegacyAccount(
  seeds: readonly LegacyAccountSeed[],
  candidate: {
    email: string
    emailVerified: boolean
    oauth?: readonly LinkedIdentity[],
  },
): LegacyAccountSeed | null {
  for (const link of candidate.oauth ?? []) {
    if (!link.provider || !link.providerAccountId) continue
    const hit = seeds.find((s) =>
      s.oauth.some(
        (l) => l.provider === link.provider && l.providerAccountId === link.providerAccountId,
      ),
    )
    if (hit) return hit
  }

  if (!candidate.emailVerified) return null
  const email = candidate.email.trim().toLowerCase()
  if (!email) return null
  return seeds.find((s) => s.email.trim().toLowerCase() === email) ?? null
}

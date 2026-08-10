// Third-party app connections - the shapes shared by the control plane, the
// self-hosted box, and the clients that render them.
//
// See the app-connections design doc in HearthShelf-WebApp/openspec for the
// full model. The two things worth knowing to read these types:
//
//  1. Apps are split by WHERE THEY RUN, not by who wrote them or by review
//     status. A self-hosted app deployed once per user ('instance') registers
//     itself and can only ever be authorized by the account running it. A hosted
//     service serving many users ('cloud') registers once and is reviewed before
//     anyone else can connect it.
//
//  2. The control plane owns only the INTRODUCTION (consent). The box owns the
//     steady state - tokens, refresh, revocation. So an installation record on
//     the control plane is a MIRROR for the cross-server connections page; where
//     the two disagree the box wins, because it holds the data.

import type { AppScope } from '../lib/appScopes.ts'

/**
 * Where an app runs, which determines everything else about it.
 *
 * 'instance' - one deployment per user (Audplexus, a Home Assistant
 *   integration, a personal script). Self-registers, own credential per
 *   install, authorizable ONLY by the account running it, never store-listed
 *   (there is nothing to list - it is software, not a service, and a shared
 *   listing would imply a shared secret in a public binary).
 *
 * 'cloud' - one deployment serving many users (a SaaS integrating inward).
 *   Registered once by its developer, reviewed before others can connect,
 *   because one compromised credential is a fleet-wide incident.
 */
export type AppKind = 'instance' | 'cloud'

/**
 * Store visibility. Instance apps are permanently 'unlisted' and may not be
 * submitted; only cloud apps move through review.
 */
export type AppListingStatus = 'unlisted' | 'pending' | 'listed'

/** An app as its own developer sees it in the dev console. */
export interface AppRecord {
  appId: string
  name: string
  kind: AppKind
  /** Software family for self-registering instance apps, e.g. 'audplexus'.
   *  A label for grouping and consent copy - it confers NO trust, since
   *  anything can claim it. Null for one-off dev-console apps. */
  family: string | null
  homepageUrl: string | null
  requestedScopes: AppScope[]
  listingStatus: AppListingStatus
  /** Why a submission was rejected, shown to the developer. */
  reviewReason: string | null
  createdAt: number
}

/** An app as a prospective user sees it in the store or on a consent screen. */
export interface AppPublicRecord {
  appId: string
  name: string
  kind: AppKind
  family: string | null
  homepageUrl: string | null
  requestedScopes: AppScope[]
  listingStatus: AppListingStatus
}

/** One server an installation reaches. */
export interface AppInstallationServer {
  serverId: string
  serverName: string | null
}

/**
 * A connected app, as the connections page renders it.
 *
 * `stale` marks a row served from the control plane's mirror because the owning
 * server could not be reached. It must be surfaced rather than smoothed over:
 * showing a confident list we could not verify is worse than admitting we do
 * not currently know.
 */
export interface AppInstallation {
  id: string
  appId: string
  appName: string
  kind: AppKind
  family: string | null
  scopes: AppScope[]
  servers: AppInstallationServer[]
  createdAt: number
  lastUsedAt: number | null
  /** True when this app is being rate limited persistently - the signal that
   *  lets a user notice something misbehaving and revoke it. */
  throttled?: boolean
  /** True when this row could not be confirmed with the owning server. */
  stale?: boolean
}

/** RFC 8628 device-flow start, as returned to the app. */
export interface AppDeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

/**
 * RFC 8628 polling errors. These are wire-format strings and MUST match the RFC
 * exactly - a stock OAuth client library keys off them, and the whole point of
 * following the standard is that an app author can point one at us.
 */
export type AppDeviceFlowError =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'

/**
 * What a successful poll returns: one introduction token PER approved server.
 *
 * Not a refresh token. The control plane introduces the app to each box and
 * then gets out of the way; the box issues the credential the app actually
 * lives on. Each token is single-use and audience-bound to one server, because
 * the box verifies `aud` strictly - see the design doc.
 */
export interface AppIntroduction {
  serverId: string
  serverName: string | null
  /** Addresses to try, most-preferred first. A LAN address MUST be identity-
   *  checked before any credential is presented to it. */
  serverUrl: string
  fallbackUrl?: string
  localUrl?: string
  /** Ed25519 public key (base64 SPKI DER) for the local-address identity
   *  challenge. Present only when localUrl is. */
  identityKey?: string
  /** Short-TTL single-use token the app presents to that server. */
  introductionToken: string
}

export interface AppDeviceTokenResponse {
  introductions: AppIntroduction[]
  scopes: AppScope[]
}

/** What the box returns once an app has introduced itself. */
export interface AppTokenSet {
  access_token: string
  refresh_token: string
  token_type: 'Bearer'
  expires_in: number
  scope: string
}

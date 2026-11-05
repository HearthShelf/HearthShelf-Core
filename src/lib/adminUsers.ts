// User, API key and service account logic for the server admin area.
import type {
  ABSAdminUser,
  ABSApiKey,
  ABSListeningSession,
  ABSUserPermissions,
} from '../types/abs.ts'
import type {
  ABSAdminSession,
  ABSUserMediaProgress,
  ABSUsersOnlineResponse,
  ABSUserType,
  UserFormValues,
} from '../types/admin.ts'

// --- Account types and permissions ------------------------------------------

export const USER_TYPE_OPTIONS: readonly { value: ABSUserType; label: string }[] = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
  { value: 'guest', label: 'Guest' },
]

/** The permission toggles, in display order. librariesAccessible and
 *  itemTagsSelected are chosen with pickers instead. */
export const PERM_TOGGLES: readonly { key: keyof ABSUserPermissions; label: string }[] = [
  { key: 'download', label: 'Can Download' },
  { key: 'update', label: 'Can Update' },
  { key: 'delete', label: 'Can Delete' },
  { key: 'upload', label: 'Can Upload' },
  { key: 'createEreader', label: 'Can Create Ereader' },
  { key: 'accessExplicitContent', label: 'Can Access Explicit Content' },
  { key: 'accessAllLibraries', label: 'Can Access All Libraries' },
  { key: 'accessAllTags', label: 'Can Access All Tags' },
]

export function defaultPermissions(type: ABSUserType): ABSUserPermissions {
  const elevated = type === 'admin'
  return {
    download: true,
    update: elevated,
    delete: false,
    upload: elevated,
    createEreader: elevated,
    accessAllLibraries: true,
    accessAllTags: true,
    accessExplicitContent: elevated,
    selectedTagsNotAccessible: false,
    librariesAccessible: [],
    itemTagsSelected: [],
  }
}

/** Permissions after switching account type: the new type's baseline, keeping any
 *  library and tag selections the admin already made. */
export function reseedPermissions(
  type: ABSUserType,
  current: ABSUserPermissions,
): ABSUserPermissions {
  return {
    ...defaultPermissions(type),
    librariesAccessible: current.librariesAccessible,
    itemTagsSelected: current.itemTagsSelected,
    selectedTagsNotAccessible: current.selectedTagsNotAccessible,
  }
}

// --- People and machine accounts --------------------------------------------

/** True for machine logins: anything an admin tagged, plus the box's auto-created
 *  service root. The root is a regular ABS admin user missing from the tagged set,
 *  so it can only be matched by the username in the box's runtime config. */
export function isServiceAccount(
  user: Pick<ABSAdminUser, 'id' | 'username'>,
  serviceUserIds: ReadonlySet<string>,
  serviceUsername: string | null,
): boolean {
  return (
    serviceUserIds.has(user.id) || (serviceUsername != null && user.username === serviceUsername)
  )
}

/** The accounts that belong to people. */
export function humanUsers<T extends Pick<ABSAdminUser, 'id' | 'username'>>(
  users: readonly T[],
  serviceUserIds: ReadonlySet<string>,
  serviceUsername: string | null,
): T[] {
  return users.filter((u) => !isServiceAccount(u, serviceUserIds, serviceUsername))
}

// --- Presence ---------------------------------------------------------------

/** Who is listening right now, from GET /api/users/online. Unions websocket users
 *  and open playback sessions. isActive on a user is the account-enabled flag, not
 *  presence, so it cannot answer this. */
export function onlineUserIds(res: ABSUsersOnlineResponse): Set<string> {
  const ids = new Set<string>()
  for (const u of res.usersOnline ?? []) if (u.id) ids.add(u.id)
  for (const s of res.openSessions ?? []) if (s.userId) ids.add(s.userId)
  return ids
}

/** Last activity per user (epoch ms), from a page of recent sessions. ABS stamps
 *  the user record's lastSeen only on websocket auth, which app users never
 *  trigger, so a playback session's updatedAt is the real signal. */
export function lastSeenByUser(
  sessions: readonly Pick<ABSAdminSession, 'userId' | 'updatedAt' | 'startedAt'>[],
): Map<string, number> {
  const last = new Map<string, number>()
  for (const s of sessions) {
    if (!s.userId) continue
    const ts = s.updatedAt || s.startedAt || 0
    if (ts > (last.get(s.userId) ?? 0)) last.set(s.userId, ts)
  }
  return last
}

// --- Bulk edits -------------------------------------------------------------

/** One account type, enabled state and permission set for every selected user. */
export interface BulkUserValues {
  type: ABSUserType
  isActive: boolean
  permissions: ABSUserPermissions
}

/** The PATCH for one user in a bulk edit. Never disables the admin's own account,
 *  and never changes a root account's type, which ABS rejects. */
export function bulkUserPatch(
  user: Pick<ABSAdminUser, 'id' | 'type'>,
  values: BulkUserValues,
  selfId: string | null | undefined,
): Partial<UserFormValues> {
  const patch: Partial<UserFormValues> = {
    permissions: values.permissions,
    isActive: user.id === selfId ? true : values.isActive,
  }
  if (user.type !== 'root') patch.type = values.type
  return patch
}

/** True when a bulk disable left the admin's own account enabled, so the result
 *  message can say so. */
export function bulkSkipsSelf(
  users: readonly Pick<ABSAdminUser, 'id'>[],
  isActive: boolean,
  selfId: string | null | undefined,
): boolean {
  return !isActive && users.some((u) => u.id === selfId)
}

// --- Invites ----------------------------------------------------------------

/** Where an invite is redeemed. Matches the acceptUrl the control plane builds for
 *  the invite email (APP_ORIGIN + /invite). */
export function inviteUrl(origin: string, code: string): string {
  return `${origin}/invite?token=${encodeURIComponent(code)}`
}

/** A ready-to-paste invite message. It carries both ways in, the link and the bare
 *  code, and names the library so it makes sense arriving with no explanation. */
export function inviteMessage(opts: {
  code: string
  serverName?: string | null
  origin: string
}): string {
  // Avoids "my HearthShelf library on HearthShelf" when the server is unnamed.
  const opener = opts.serverName
    ? `You're invited to "${opts.serverName}" on HearthShelf.`
    : `You're invited to my HearthShelf library.`
  return [
    opener,
    '',
    '1. Install HearthShelf on your phone (App Store or Google Play).',
    '2. Sign in, then enter this invite code:',
    '',
    `   ${opts.code}`,
    '',
    `Already have the app open? Just tap: ${inviteUrl(opts.origin, opts.code)}`,
    '',
    'The code expires in 14 days.',
  ].join('\n')
}

// --- Why a book did not finish ----------------------------------------------

export interface SessionFinishDiagnostics {
  /** The position this session last saved, in seconds. */
  leftOff: number
  /** Where this session began, in seconds. */
  startedAtSec: number
  /** The book's length, in seconds. 0 when nothing recorded one. */
  bookDuration: number
  /** ABS measured the book as 0 seconds, so it can never reach the threshold. */
  zeroDuration: boolean
  /** The session ran to within a minute of the end but the book is unfinished. */
  stalledFinish: boolean
}

/** Reads one session against the user's progress row for that book. Session
 *  duration can be 0 on older rows, so the progress row wins when it has one. */
export function sessionFinishDiagnostics(
  session: Pick<ABSListeningSession, 'currentTime' | 'startTime' | 'duration'>,
  progress: Pick<ABSUserMediaProgress, 'duration' | 'isFinished'> | null | undefined,
): SessionFinishDiagnostics {
  const leftOff = session.currentTime || 0
  const bookDuration = progress?.duration || session.duration || 0
  const nearEnd = bookDuration > 0 && bookDuration - leftOff <= 60
  return {
    leftOff,
    startedAtSec: session.startTime || 0,
    bookDuration,
    zeroDuration: progress != null && progress.duration <= 0,
    stalledFinish: progress != null && !progress.isFinished && nearEnd,
  }
}

// --- API keys ---------------------------------------------------------------

/** Preset key lifetimes in seconds. null means it never expires. */
export const API_KEY_EXPIRY_OPTIONS: readonly { label: string; seconds: number | null }[] = [
  { label: 'Never', seconds: null },
  { label: '7 days', seconds: 7 * 24 * 60 * 60 },
  { label: '30 days', seconds: 30 * 24 * 60 * 60 },
  { label: '90 days', seconds: 90 * 24 * 60 * 60 },
  { label: '1 year', seconds: 365 * 24 * 60 * 60 },
]

export function isServiceKey(
  key: Pick<ABSApiKey, 'userId'>,
  serviceUserIds: ReadonlySet<string>,
): boolean {
  return serviceUserIds.has(key.userId)
}

/** The key's owner. ABS doesn't embed the user on older keys or slimmer list
 *  responses, so fall back to the user list. */
export function apiKeyOwnerName(
  key: Pick<ABSApiKey, 'user' | 'userId'>,
  userById: ReadonlyMap<string, Pick<ABSAdminUser, 'username'>>,
): string {
  return key.user?.username ?? userById.get(key.userId)?.username ?? 'Unknown'
}

// --- Service accounts -------------------------------------------------------

export function accountInitials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_'

/** A strong password an admin can hand to another app. The alphabet has no
 *  look-alikes (0/O, 1/l/I), and rejection sampling avoids modulo bias. Core has no
 *  crypto of its own, so the caller supplies a secure source of random bytes. */
export function generatePassword(randomBytes: (count: number) => Uint8Array, length = 20): string {
  const max = Math.floor(256 / PASSWORD_ALPHABET.length) * PASSWORD_ALPHABET.length
  let out = ''
  while (out.length < length) {
    for (const byte of randomBytes(length - out.length)) {
      if (byte < max) out += PASSWORD_ALPHABET.charAt(byte % PASSWORD_ALPHABET.length)
    }
  }
  return out
}

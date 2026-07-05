// The settings catalog + pure helpers, shared by web, mobile, and the
// /hs/settings backend route. No I/O, no store access. The catalog is the one
// definition of every setting; validateSetting/mergeSettings run identically on
// client and server. See docs/settings-sync.md in HearthShelf.

import { resolveQueueConflict } from './queue.ts'
import type { AutoRuleId, AutoRulePref } from '../types/queue'
import type {
  SettingChange,
  SettingDef,
  SettingsCatalog,
  SettingValidation,
  SettingValue,
  StoredSetting,
} from '../types/settings'

// Canonical rule order (also the Auto-mode priority order). Keep in step with
// AutoRuleId in types/queue.ts and DEFAULT_AUTO_RULES in lib/queue.ts.
export const AUTO_RULE_IDS: AutoRuleId[] = [
  'finish-series',
  'in-progress',
  'new-in-series',
  'book-club',
]

/**
 * Reconcile a stored queueAutoRules array with the canonical rule set: keep the
 * user's on/off choices and order for rules they have, append any rules added
 * since they last saved (on by default), and drop ids no longer known. Lets a
 * new rule (e.g. book-club) surface for existing users without a migration.
 */
export function normalizeAutoRules(stored: unknown): AutoRulePref[] {
  const arr = Array.isArray(stored) ? (stored as AutoRulePref[]) : []
  const byId = new Map(
    arr
      .filter((r) => r && AUTO_RULE_IDS.includes(r.id) && typeof r.on === 'boolean')
      .map((r) => [r.id, r] as const),
  )
  return AUTO_RULE_IDS.map((id) => byId.get(id) ?? { id, on: true })
}

// True if v is a valid queueAutoRules array: entries of { id: AutoRuleId, on }.
function isAutoRules(v: unknown): boolean {
  if (!Array.isArray(v)) return false
  return v.every(
    (r) =>
      !!r &&
      typeof r === 'object' &&
      AUTO_RULE_IDS.includes((r as { id: unknown }).id as AutoRuleId) &&
      typeof (r as { on: unknown }).on === 'boolean',
  )
}

// Where a customizable player-action button can sit. The action-KEY whitelist
// stays platform-side (mobile's normalizePlayerActions reconciles unknown keys);
// the catalog validates only the arrangement's shape.
const ACTION_PLACEMENTS = ['onscreen', 'tray', 'hidden']

// True if v is a valid playerActions arrangement: entries of { key, placement }.
function isPlayerActions(v: unknown): boolean {
  if (!Array.isArray(v)) return false
  return v.every(
    (a) =>
      !!a &&
      typeof a === 'object' &&
      typeof (a as { key: unknown }).key === 'string' &&
      ACTION_PLACEMENTS.includes((a as { placement: unknown }).placement as string),
  )
}

// Default player-action arrangement. Duplicated from mobile's DEFAULT_PLAYER_ACTIONS
// as a plain literal so core stays platform-agnostic (no mobile -> core dependency).
// Keep in step with src/store/settings.ts in HearthShelf-Mobile.
const DEFAULT_PLAYER_ACTIONS: Array<{ key: string; placement: string }> = [
  { key: 'chapters', placement: 'onscreen' },
  { key: 'speed', placement: 'onscreen' },
  { key: 'sleep', placement: 'onscreen' },
  { key: 'recent', placement: 'onscreen' },
  { key: 'bookmarks', placement: 'tray' },
  { key: 'details', placement: 'tray' },
  { key: 'notes', placement: 'tray' },
  { key: 'addList', placement: 'tray' },
  { key: 'download', placement: 'tray' },
  { key: 'cast', placement: 'tray' },
  { key: 'carMode', placement: 'tray' },
]

// Every HearthShelf setting, unified across web + hosted. Absence of a stored
// row means "use the default here" (sparse storage - the DB holds only what the
// user changed). Where the two clients disagreed on a default, the value below
// is the one agreed default. WebApp-only prefs (car mode, custom skips) are
// scope 'device' so they have a home without touching other platforms.
const DEFS: SettingDef[] = [
  // --- Appearance (account) ---
  {
    key: 'theme',
    scope: 'account',
    type: 'enum',
    values: ['auto', 'dark', 'light', 'flat', 'oled'],
    default: 'dark',
  },
  {
    key: 'accentMode',
    scope: 'account',
    type: 'enum',
    values: ['dynamic', 'manual'],
    default: 'manual',
  },
  {
    key: 'accentHex',
    scope: 'account',
    type: 'string',
    pattern: /^#[0-9a-fA-F]{6}$/,
    default: '#e0654a',
  },
  { key: 'glow', scope: 'account', type: 'number', min: 0, max: 60, int: true, default: 60 },
  {
    key: 'coverStyle',
    scope: 'account',
    type: 'enum',
    values: ['floating', 'cards'],
    default: 'cards',
  },
  { key: 'colorEverywhere', scope: 'account', type: 'boolean', default: true },
  { key: 'hearthBgPlayer', scope: 'account', type: 'boolean', default: true },
  { key: 'cardBg', scope: 'account', type: 'boolean', default: true },
  // Mobile full-player background: blurred cover art, a breathing hue gradient,
  // or the hearth artwork. Web still keys its player background off the boolean
  // hearthBgPlayer above; the two converge when web adopts this enum.
  {
    key: 'playerBg',
    scope: 'account',
    type: 'enum',
    values: ['blurred', 'gradient', 'hearth'],
    default: 'blurred',
  },

  // --- Playback (account) ---
  {
    key: 'scrubber',
    scope: 'account',
    type: 'enum',
    values: ['chapter', 'book'],
    default: 'chapter',
  },
  {
    key: 'skipForward',
    scope: 'account',
    type: 'number',
    min: 5,
    max: 300,
    int: true,
    default: 30,
  },
  { key: 'skipBack', scope: 'account', type: 'number', min: 5, max: 300, int: true, default: 15 },
  { key: 'chapterBarrier', scope: 'account', type: 'boolean', default: true },
  // Default playback rate a fresh book starts at. Fractional, so not int.
  { key: 'defaultSpeed', scope: 'account', type: 'number', min: 0.5, max: 3.5, default: 1 },
  // Tap the full-player artwork to play/pause. Off by default so a tap on the
  // cover keeps its existing meaning (lightbox / immersive) unless opted in.
  { key: 'tapArtworkTogglesPlay', scope: 'account', type: 'boolean', default: false },
  // Double-tap the margins beside the full-player artwork to skip back/forward.
  { key: 'skipHotspots', scope: 'account', type: 'boolean', default: true },

  // --- Cover display (account) - mobile ---
  {
    key: 'coverAspect',
    scope: 'account',
    type: 'enum',
    values: ['square', 'portrait'],
    default: 'square',
  },
  {
    key: 'glowMode',
    scope: 'account',
    type: 'enum',
    values: ['gradient', 'image'],
    default: 'gradient',
  },

  // --- Queue (account) ---
  {
    key: 'queueMode',
    scope: 'account',
    type: 'enum',
    values: ['off', 'manual', 'auto', 'playlist'],
    default: 'manual',
  },
  {
    key: 'queueAutoRules',
    scope: 'account',
    type: 'json',
    validate: isAutoRules,
    default: AUTO_RULE_IDS.map((id) => ({ id, on: true })),
  },

  // --- Library & home (account) ---
  { key: 'libraryFill', scope: 'account', type: 'boolean', default: false },
  { key: 'unifiedHome', scope: 'account', type: 'boolean', default: false },
  { key: 'showOthersBooks', scope: 'account', type: 'boolean', default: true },

  // --- Sleep (account) ---
  {
    key: 'sleepRewindSec',
    scope: 'account',
    type: 'number',
    min: 0,
    max: 300,
    int: true,
    default: 30,
  },
  { key: 'sleepFade', scope: 'account', type: 'boolean', default: true },
  {
    key: 'sleepFadeLen',
    scope: 'account',
    type: 'number',
    min: 3,
    max: 60,
    int: true,
    default: 20,
  },
  { key: 'sleepChime', scope: 'account', type: 'boolean', default: false },
  // Shake the phone to add time to a running sleep timer (mobile renders these;
  // account-scoped so the preference survives reinstalls).
  { key: 'sleepShakeExtend', scope: 'account', type: 'boolean', default: false },
  {
    key: 'sleepShakeMinutes',
    scope: 'account',
    type: 'number',
    min: 1,
    max: 30,
    int: true,
    default: 5,
  },
  { key: 'autoSleep', scope: 'account', type: 'boolean', default: false },
  {
    key: 'autoSleepStart',
    scope: 'account',
    type: 'string',
    pattern: /^([01]\d|2[0-3]):[0-5]\d$/,
    default: '22:00',
  },
  {
    key: 'autoSleepEnd',
    scope: 'account',
    type: 'string',
    pattern: /^([01]\d|2[0-3]):[0-5]\d$/,
    default: '06:00',
  },
  {
    key: 'autoSleepDur',
    scope: 'account',
    type: 'number',
    min: 5,
    max: 180,
    int: true,
    default: 30,
  },

  // --- Account & privacy (account) ---
  // Tri-state: null = never chose (fall back to the user's Gravatar by their
  // email - the persisted default is ON). true/false = the user's own explicit
  // choice. Only written once the user actually toggles it, so it stays one
  // account-wide setting no client redefines a default for.
  { key: 'useGravatar', scope: 'account', type: 'triBool', default: null },
  // Tri-state: null = never chose (follow the server's community default).
  { key: 'shareReadBooks', scope: 'account', type: 'triBool', default: null },
  // Tri-state: null = never chose (follow the server's community default, which
  // ships OFF for presence - more sensitive than a historical reading list).
  { key: 'shareCurrentlyListening', scope: 'account', type: 'triBool', default: null },
  // Book clubs opt-in. Off hides every club surface (book-detail card, home
  // shelf, More entry, player button). Account-scoped so opting out follows the
  // user across devices. The server also has its own admin kill-switch.
  { key: 'clubsEnabled', scope: 'account', type: 'boolean', default: true },
  // Show the "open club" button on the player when the current book belongs to a
  // club. Separate from clubsEnabled so the button can be hidden while clubs
  // stay on. Account-scoped to follow the user across devices.
  { key: 'clubPlayerButton', scope: 'account', type: 'boolean', default: true },

  // --- Device-scoped (per install, not shared across devices) ---
  // Whether this device applies account-scoped server settings at all. Off =
  // the device runs on its local values only. Device-scoped so it's visible
  // across devices but governs only the one it belongs to.
  { key: 'useSharedSettings', scope: 'device', type: 'boolean', default: true },
  { key: 'libraryView', scope: 'device', type: 'enum', values: ['grid', 'list'], default: 'grid' },
  {
    key: 'libraryScale',
    scope: 'device',
    type: 'number',
    min: 120,
    max: 240,
    int: true,
    default: 168,
  },
  {
    key: 'homeHero',
    scope: 'device',
    type: 'enum',
    values: ['comfy', 'compact'],
    default: 'comfy',
  },
  {
    key: 'skipForwardCustom',
    scope: 'account',
    type: 'number',
    min: 5,
    max: 300,
    int: true,
    default: 45,
  },
  {
    key: 'skipBackCustom',
    scope: 'account',
    type: 'number',
    min: 5,
    max: 300,
    int: true,
    default: 20,
  },
  // Show a toast when playback crosses a club note. Device-scoped so you can
  // silence pops on one device without leaving the club.
  { key: 'notePops', scope: 'device', type: 'boolean', default: true },
  // Remembers the note composer's last Public/Personal choice, per device.
  {
    key: 'noteDefaultVisibility',
    scope: 'device',
    type: 'enum',
    values: ['public', 'personal'],
    default: 'public',
  },
  { key: 'carMode', scope: 'device', type: 'enum', values: ['auto', 'on', 'off'], default: 'auto' },
  { key: 'carFadeEnabled', scope: 'device', type: 'boolean', default: true },
  { key: 'carFadeSec', scope: 'device', type: 'number', min: 0, max: 120, int: true, default: 30 },
  { key: 'showAdvanced', scope: 'device', type: 'boolean', default: false },

  // --- Haptics + player-button layout (device) - mobile ---
  // Haptics are device hardware, and the player-button arrangement is a
  // per-device UI layout, so both are device-scoped (backed up per install).
  {
    key: 'haptics',
    scope: 'device',
    type: 'enum',
    values: ['off', 'minimal', 'all'],
    default: 'minimal',
  },
  {
    key: 'hapticIntensity',
    scope: 'device',
    type: 'enum',
    values: ['light', 'medium'],
    default: 'light',
  },
  { key: 'playerActionsIconOnly', scope: 'device', type: 'boolean', default: false },
  {
    key: 'playerActions',
    scope: 'device',
    type: 'json',
    validate: isPlayerActions,
    default: DEFAULT_PLAYER_ACTIONS,
  },

  // --- Release notifications (account) ---
  // Preferences for followed-book / series push notifications + the Home
  // countdown banner. Account-scoped so they follow the user across devices; the
  // server's push job reads them via getUserSetting. Keep in step with
  // HSNotificationPrefs + DEFAULT_NOTIFICATION_PREFS in lib/notifications.ts.
  { key: 'notifyEnabled', scope: 'account', type: 'boolean', default: true },
  { key: 'notifyAvailableInLibrary', scope: 'account', type: 'boolean', default: true },
  { key: 'notifyOnReleaseDate', scope: 'account', type: 'boolean', default: true },
  {
    key: 'notifyReminderDaysBefore',
    scope: 'account',
    type: 'number',
    min: 0,
    max: 30,
    int: true,
    default: 3,
  },
  {
    key: 'notifyCountdownWindowDays',
    scope: 'account',
    type: 'number',
    min: 1,
    max: 30,
    int: true,
    default: 14,
  },
]

// The catalog, indexed by key.
export const SETTINGS_CATALOG: SettingsCatalog = Object.fromEntries(DEFS.map((d) => [d.key, d]))

// A setting's def, or undefined if the key isn't catalogued (unknown keys are
// rejected on write and ignored on read).
export function settingDef(key: string): SettingDef | undefined {
  return SETTINGS_CATALOG[key]
}

// The default value for a key (as a SettingValue), or undefined for unknown keys.
export function settingDefault(key: string): SettingValue | undefined {
  const d = SETTINGS_CATALOG[key]
  return d ? (d.default as SettingValue) : undefined
}

// Validate (and where sensible coerce/clamp) a value against its catalog
// constraint. Numbers outside min/max clamp rather than reject; type mismatches
// and pattern/enum failures reject. Unknown keys reject. Runs on client and
// server from the same catalog.
export function validateSetting(key: string, value: SettingValue): SettingValidation {
  const d = SETTINGS_CATALOG[key]
  if (!d) return { ok: false, reason: 'unknown_key' }

  switch (d.type) {
    case 'boolean':
      if (typeof value !== 'boolean') return { ok: false, reason: 'not_boolean' }
      return { ok: true, value }

    case 'triBool':
      if (value !== null && typeof value !== 'boolean') return { ok: false, reason: 'not_tribool' }
      return { ok: true, value }

    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value))
        return { ok: false, reason: 'not_number' }
      let n = d.int ? Math.round(value) : value
      if (d.min != null && n < d.min) n = d.min
      if (d.max != null && n > d.max) n = d.max
      return { ok: true, value: n }
    }

    case 'string': {
      if (typeof value !== 'string') return { ok: false, reason: 'not_string' }
      if (d.maxLen != null && value.length > d.maxLen) return { ok: false, reason: 'too_long' }
      if (d.pattern && !d.pattern.test(value)) return { ok: false, reason: 'pattern' }
      return { ok: true, value }
    }

    case 'enum':
      if (typeof value !== 'string' || !d.values.includes(value))
        return { ok: false, reason: 'not_in_enum' }
      return { ok: true, value }

    case 'json':
      if (!d.validate(value)) return { ok: false, reason: 'invalid_shape' }
      return { ok: true, value }
  }
}

// Resolve the effective value of a key: the stored value if present, else the
// catalog default. Unknown keys return undefined.
export function resolveSetting(
  stored: Record<string, StoredSetting>,
  key: string,
): SettingValue | undefined {
  const row = stored[key]
  if (row) return row.value
  return settingDefault(key)
}

// Per-key last-writer-wins merge of two stored-settings maps (e.g. local
// optimistic state vs. what the server returned). Reuses resolveQueueConflict
// so the queue and settings share one LWW rule. Keys present in only one side
// carry through unchanged.
export function mergeSettings(
  local: Record<string, StoredSetting>,
  remote: Record<string, StoredSetting>,
): Record<string, StoredSetting> {
  const out: Record<string, StoredSetting> = { ...local }
  for (const key of Object.keys(remote)) {
    const l = local[key]
    const r = remote[key]
    out[key] = l ? resolveQueueConflict(l, r) : r
  }
  return out
}

// Build the minimal set of changes to push: keys whose value differs between a
// prior and next stored-settings map, stamped with next's updatedAt. Used to
// send only what changed rather than the whole set.
export function changedKeys(
  prev: Record<string, StoredSetting>,
  next: Record<string, StoredSetting>,
): SettingChange[] {
  const changes: SettingChange[] = []
  for (const key of Object.keys(next)) {
    const n = next[key]
    const p = prev[key]
    if (p && p.value === n.value && p.updatedAt === n.updatedAt) continue
    const d = SETTINGS_CATALOG[key]
    if (!d) continue
    changes.push({ scope: d.scope, key, value: n.value, updatedAt: n.updatedAt })
  }
  return changes
}

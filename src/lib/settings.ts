// The settings catalog + pure helpers, shared by web, mobile, and the
// /hs/settings backend route. No I/O, no store access. The catalog is the one
// definition of every setting; validateSetting/mergeSettings run identically on
// client and server. See docs/settings-sync.md in HearthShelf.

import { resolveQueueConflict, DEFAULT_AUTO_RULES } from './queue.ts'
import {
  DEFAULT_HOME_SECTIONS,
  DEFAULT_REC_SHELF_COUNT,
  MAX_REC_SHELF_COUNT,
  isHomeSections,
} from './homeSections.ts'
import { DEFAULT_NOTIFY_PREFS, isNotifyPrefs } from './notifications.ts'
import {
  READER_DEFAULTS,
  READER_SIZE_MIN,
  READER_SIZE_MAX,
  READER_BRIGHTNESS_MIN,
  READER_BRIGHTNESS_MAX,
} from './reader.ts'
import type { ReaderPrefs } from './reader.ts'
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
  'new-in-series-all',
  'book-club',
  'manual',
]

// The canonical on/off default per rule, from DEFAULT_AUTO_RULES. A rule added
// since the user last saved gets ITS default (not a blanket 'on'), so e.g.
// new-in-series-all surfaces OFF for existing users - the whole point of it
// being an opt-in modifier.
const DEFAULT_RULE_ON = new Map(DEFAULT_AUTO_RULES.map((r) => [r.id, r.on] as const))

/**
 * Reconcile a stored queueAutoRules array with the canonical rule set: keep the
 * user's on/off choices and order for rules they have, append any rules added
 * since they last saved (at that rule's default), and drop ids no longer known.
 * Lets a new rule (e.g. book-club) surface for existing users without a migration.
 */
export function normalizeAutoRules(stored: unknown): AutoRulePref[] {
  const arr = Array.isArray(stored) ? (stored as AutoRulePref[]) : []
  const normalized: AutoRulePref[] = []
  const seen = new Set<AutoRuleId>()
  // Preserve the user's stored order. The previous map + AUTO_RULE_IDS.map()
  // kept on/off values but rebuilt canonical order on every hydrate/server pull,
  // so devices could sync the same array and still display different priorities.
  for (const rule of arr) {
    if (
      !rule ||
      !AUTO_RULE_IDS.includes(rule.id) ||
      typeof rule.on !== 'boolean' ||
      seen.has(rule.id)
    ) {
      continue
    }
    seen.add(rule.id)
    normalized.push({ id: rule.id, on: rule.on })
  }
  // New rules still append in canonical order at their intended default.
  for (const id of AUTO_RULE_IDS) {
    if (!seen.has(id)) normalized.push({ id, on: DEFAULT_RULE_ON.get(id) ?? true })
  }
  return normalized
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

// Where a customizable bottom-nav destination can sit. As with player actions,
// the item-KEY whitelist stays platform-side (mobile's normalizeNavItems
// reconciles unknown keys); the catalog validates only the arrangement's shape.
const NAV_PLACEMENTS = ['bar', 'menu', 'hidden']

// True if v is a valid navItems arrangement: entries of { key, placement }.
function isNavItems(v: unknown): boolean {
  if (!Array.isArray(v)) return false
  return v.every(
    (a) =>
      !!a &&
      typeof a === 'object' &&
      typeof (a as { key: unknown }).key === 'string' &&
      NAV_PLACEMENTS.includes((a as { placement: unknown }).placement as string),
  )
}

// Default bottom-nav arrangement: the tabs pinned before the nav became
// customizable stay on the bar, and every More-menu destination keeps its place
// in the menu. Duplicated from mobile's DEFAULT_NAV_ITEMS as a plain literal so
// core stays platform-agnostic.
// Keep in step with src/store/settings.ts in HearthShelf-Mobile.
const DEFAULT_NAV_ITEMS: Array<{ key: string; placement: string }> = [
  { key: 'index', placement: 'bar' },
  { key: 'library', placement: 'bar' },
  { key: 'now', placement: 'bar' },
  { key: 'stats', placement: 'bar' },
  { key: 'feedback', placement: 'bar' },
  { key: 'discover', placement: 'menu' },
  { key: 'questgiver', placement: 'menu' },
  { key: 'following', placement: 'menu' },
  { key: 'clubs', placement: 'menu' },
  { key: 'history', placement: 'menu' },
  { key: 'collections', placement: 'menu' },
  { key: 'playlists', placement: 'menu' },
  // Downloads defaults to hidden: the same screen is reachable at
  // Settings > Storage, so shipping it in the menu duplicated a destination.
  // Still available - clients let the reader drag it back, and a saved
  // arrangement is applied before this default fills in the gaps.
  { key: 'downloads', placement: 'hidden' },
  { key: 'settings', placement: 'menu' },
  { key: 'server-settings', placement: 'menu' },
]

/**
 * Catalog key for each ebook-reader preference. The reader's own model
 * (lib/reader.ts) names its fields without a prefix (`theme`, `size`), which
 * would collide with the app's `theme`, so every reader pref is catalogued under
 * a `reader*` key. Clients bind their reader store to the settings store through
 * this map rather than hard-coding the pairs - see the mobile readerPrefs.ts and
 * the web readerPrefsStore.ts.
 */
export const READER_SETTING_KEYS: { readonly [K in keyof ReaderPrefs]: string } = {
  theme: 'readerTheme',
  font: 'readerFont',
  size: 'readerSize',
  lh: 'readerLh',
  width: 'readerWidth',
  align: 'readerAlign',
  brightness: 'readerBrightness',
  layout: 'readerLayout',
}

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

  // --- When a book counts as finished (see lib/completion.ts) ---
  // A trailing chapter this short is credits/outro rather than content, so
  // reaching it finishes the book. 0 disables the rule.
  {
    key: 'creditsChapterMaxSec',
    scope: 'account',
    type: 'number',
    min: 0,
    max: 600,
    int: true,
    default: 60,
  },
  // Stopping this close to the end of the last real chapter still counts as
  // finishing it (the "paused 2 seconds early" case).
  {
    key: 'chapterEndGraceSec',
    scope: 'account',
    type: 'number',
    min: 0,
    max: 300,
    int: true,
    default: 15,
  },
  // Plex-style percentage floor, for books with no usable chapter data. Percent,
  // 0 = off. The chapter rules above are sharper; this is only the fallback.
  {
    key: 'finishedPercent',
    scope: 'account',
    type: 'number',
    min: 0,
    max: 100,
    int: true,
    default: 0,
  },

  // Default playback rate a fresh book starts at. Fractional, so not int.
  { key: 'defaultSpeed', scope: 'account', type: 'number', min: 0.5, max: 3.5, default: 1 },
  // Rewind a few seconds when you resume, scaled to how long you were paused, so
  // a phone call or a night's sleep doesn't drop you mid-sentence. The step sizes
  // are fixed in the client; this is the on/off. On by default - it's what every
  // other audiobook player does. Account-scoped so the choice follows the user.
  { key: 'autoRewind', scope: 'account', type: 'boolean', default: true },
  // Tap the full-player artwork to play/pause. Off by default so a tap on the
  // cover keeps its existing meaning (lightbox / immersive) unless opted in.
  { key: 'tapArtworkTogglesPlay', scope: 'account', type: 'boolean', default: false },
  // Double-tap the margins beside the full-player artwork to skip back/forward.
  { key: 'skipHotspots', scope: 'account', type: 'boolean', default: true },
  // Turn the full-player cover into a swipeable deck of the live book + the
  // up-next queue. Swiping browses (audio unchanged); tap play on a card to
  // switch. Off = the classic single cover.
  { key: 'carouselPlayer', scope: 'account', type: 'boolean', default: true },
  // Hide the docked mini player (the little bar above the nav that shows the
  // book that's playing). On = no mini bar; the full player is still reachable
  // from the Now Playing tab / player nav and a book's Play button. Off (default)
  // keeps the mini bar. Account-scoped so the choice follows the user.
  { key: 'hideMiniPlayer', scope: 'account', type: 'boolean', default: false },
  // Delete a book's local download automatically when you finish it, to free up
  // space. Applies to any download (manual or auto). Account-scoped so the
  // choice follows the user across devices. On by default.
  { key: 'removeDownloadOnFinish', scope: 'account', type: 'boolean', default: true },

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
    default: DEFAULT_AUTO_RULES.map((rule) => ({ ...rule })),
  },

  // --- Library & home (account) ---
  { key: 'libraryFill', scope: 'account', type: 'boolean', default: false },
  { key: 'unifiedHome', scope: 'account', type: 'boolean', default: false },
  { key: 'showOthersBooks', scope: 'account', type: 'boolean', default: true },

  // The Home screen's section arrangement: order + which bands are hidden, from
  // Home's own edit mode. Account-scoped so a listener's Home looks the same on
  // every device. homeRecShelfCount caps how many taste-derived rows (genre /
  // author / narrator) the "More picks for you" block may spawn - see
  // lib/homeSections.
  {
    key: 'homeSections',
    scope: 'account',
    type: 'json',
    validate: isHomeSections,
    default: DEFAULT_HOME_SECTIONS,
  },
  {
    key: 'homeRecShelfCount',
    scope: 'account',
    type: 'number',
    min: 0,
    max: MAX_REC_SHELF_COUNT,
    int: true,
    default: DEFAULT_REC_SHELF_COUNT,
  },

  // --- Search (account) ---
  // When on, Search also looks up titles you don't own (via the server's Audible
  // catalog lookup) and shows them in a "Not in your library" section, so you can
  // request them if the request backend is set up. Off = Search only covers your
  // own library. On by default; account-scoped so the choice follows you.
  { key: 'searchExternalSources', scope: 'account', type: 'boolean', default: true },

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
  // Beep before the sleep timer ends. sleepChime is the master on/off; the three
  // cue toggles pick which warnings fire (2 min / 1 min / right as it stops), so
  // a listener drifting off gets a heads-up before the audio goes quiet.
  // sleepBeepSound is the tone; sleepBeepVolume (0-100) is how loud the cue is
  // relative to the book. Mobile renders these; account-scoped so they follow the
  // user across devices.
  { key: 'sleepChime', scope: 'account', type: 'boolean', default: false },
  { key: 'sleepBeepAt2min', scope: 'account', type: 'boolean', default: true },
  { key: 'sleepBeepAt1min', scope: 'account', type: 'boolean', default: true },
  { key: 'sleepBeepFinal', scope: 'account', type: 'boolean', default: false },
  {
    key: 'sleepBeepSound',
    scope: 'account',
    type: 'enum',
    values: ['chime', 'marimba', 'beep', 'bell'],
    default: 'chime',
  },
  {
    key: 'sleepBeepVolume',
    scope: 'account',
    type: 'number',
    min: 0,
    max: 100,
    int: true,
    default: 60,
  },
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
  // What shake-to-extend does when many shakes fire in a row (a phone jostling on
  // a walk, not a deliberate wake-up). off = keep adding; limit = stop adding but
  // keep the timer; disable = end the timer so playback isn't silenced. Mobile
  // renders this; account-scoped so it follows the user across devices.
  {
    key: 'sleepShakeExcessive',
    scope: 'account',
    type: 'enum',
    values: ['off', 'limit', 'disable'],
    default: 'limit',
  },
  { key: 'autoSleep', scope: 'account', type: 'boolean', default: true },
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

  // The bottom navigation's arrangement: which destinations are pinned to the
  // bar, which live under More, and which are hidden. Device-scoped like the
  // other nav prefs (floatingNav), since it's tied to the screen it's laid out
  // on rather than to the reader.
  {
    key: 'navItems',
    scope: 'device',
    type: 'json',
    validate: isNavItems,
    default: DEFAULT_NAV_ITEMS,
  },

  // --- Notifications (account) ---
  // One structured pref rather than a key per toggle: `global` channel choices
  // plus per-type overrides (see HSNotifyPrefs). A new notification category is
  // then a change in core alone, not a new catalog key every client must learn.
  // Read it through normalizeNotifyPrefs/shouldNotify in lib/notifications.ts.
  {
    key: 'notifyPrefs',
    scope: 'account',
    type: 'json',
    validate: isNotifyPrefs,
    default: DEFAULT_NOTIFY_PREFS,
  },

  // --- External book links (account) ---
  // Per-provider toggles for the search-link icons shown on a book's detail
  // page (Goodreads/Audible/Hardcover). All on by default (matches the prior
  // hardcoded behavior); account-scoped so the choice follows the user.
  { key: 'externalLinkGoodreads', scope: 'account', type: 'boolean', default: true },
  { key: 'externalLinkAudible', scope: 'account', type: 'boolean', default: true },
  { key: 'externalLinkHardcover', scope: 'account', type: 'boolean', default: true },

  // --- Reading goal (account) ---
  // How many books the user aims to finish this calendar year. 0 = no goal set;
  // the Stats page shows progress against booksThisYear when this is > 0.
  // Account-scoped so the goal follows the user across devices.
  {
    key: 'yearlyBookGoal',
    scope: 'account',
    type: 'number',
    min: 0,
    max: 1000,
    int: true,
    default: 0,
  },

  // --- Navigation layout (device) - mobile ---
  // Swap the full-width bottom tab bar for a floating glass icon pill, and how
  // that pill is laid out. Device-scoped: it's a per-install UI treatment, but it
  // IS catalogued so it rides the same backup/restore path as everything else -
  // an uncatalogued key can never follow a user to a new phone.
  { key: 'floatingNav', scope: 'device', type: 'boolean', default: false },
  {
    key: 'floatingNavOrientation',
    scope: 'device',
    type: 'enum',
    values: ['horizontal', 'vertical'],
    default: 'horizontal',
  },
  // Share anonymous install stats (app version, device model/type, OS) with the
  // public community dashboard. Device-scoped - it describes this install - and
  // catalogued so the choice is restored rather than silently re-defaulting to on
  // when the app is reinstalled.
  { key: 'shareInstallStats', scope: 'device', type: 'boolean', default: true },

  // --- Ebook reader typography (device) ---
  // The reader's display prefs, catalogued under READER_SETTING_KEYS. Defaults
  // and bounds come from READER_DEFAULTS / the READER_* constants in lib/reader
  // so the catalog can never drift from the reader's own model. Device-scoped
  // (type size that suits a phone rarely suits a desktop), which still means they
  // are stored server-side and restored onto a reinstalled or brand-new device.
  {
    key: READER_SETTING_KEYS.theme,
    scope: 'device',
    type: 'enum',
    values: ['dark', 'sepia', 'light', 'paper'],
    default: READER_DEFAULTS.theme,
  },
  {
    key: READER_SETTING_KEYS.font,
    scope: 'device',
    type: 'enum',
    values: ['serif', 'sans', 'dyslexic'],
    default: READER_DEFAULTS.font,
  },
  {
    key: READER_SETTING_KEYS.size,
    scope: 'device',
    type: 'number',
    min: READER_SIZE_MIN,
    max: READER_SIZE_MAX,
    int: true,
    default: READER_DEFAULTS.size,
  },
  {
    key: READER_SETTING_KEYS.lh,
    scope: 'device',
    type: 'enum',
    values: ['compact', 'normal', 'relaxed'],
    default: READER_DEFAULTS.lh,
  },
  {
    key: READER_SETTING_KEYS.width,
    scope: 'device',
    type: 'enum',
    values: ['narrow', 'medium', 'wide'],
    default: READER_DEFAULTS.width,
  },
  {
    key: READER_SETTING_KEYS.align,
    scope: 'device',
    type: 'enum',
    values: ['left', 'justify'],
    default: READER_DEFAULTS.align,
  },
  {
    key: READER_SETTING_KEYS.brightness,
    scope: 'device',
    type: 'number',
    min: READER_BRIGHTNESS_MIN,
    max: READER_BRIGHTNESS_MAX,
    int: true,
    default: READER_DEFAULTS.brightness,
  },
  {
    key: READER_SETTING_KEYS.layout,
    scope: 'device',
    type: 'enum',
    values: ['scroll', 'paged'],
    default: READER_DEFAULTS.layout,
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

// Read an ebook-reader prefs object back out of a flat settings map (catalog key
// -> value), the shape every client's settings store already exposes. Any key
// that's unset or fails its catalog constraint falls back to the reader default,
// so a partially-synced device still renders a complete, valid reader.
export function readerPrefsFrom(values: Record<string, unknown>): ReaderPrefs {
  const out = { ...READER_DEFAULTS }
  for (const field of Object.keys(READER_SETTING_KEYS) as (keyof ReaderPrefs)[]) {
    const v = values[READER_SETTING_KEYS[field]]
    if (v === undefined) continue
    const check = validateSetting(READER_SETTING_KEYS[field], v as SettingValue)
    if (check.ok) (out as Record<string, unknown>)[field] = check.value
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

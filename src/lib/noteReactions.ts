// Reaction kinds: validating them, normalizing them, and picking which ones a
// client offers up front.
//
// A reaction kind is EITHER a raw emoji ("\u{1F4A9}") or one of three legacy
// names ('up' | 'heart' | 'laugh') left over from when the clients only offered
// a thumbs up. New reactions always store the emoji itself, which is what lets
// any client render any reaction with no lookup table: the kind IS the glyph.
//
// Validation is deliberately STRICTER than "any string". An unbounded kind on a
// (server_id, note_id, user_id, kind) unique index would let one reader spray a
// note with unlimited distinct rows, and lets invisible or bidirectional control
// characters ride along inside something that renders as a harmless emoji. So a
// kind must be a short run of emoji codepoints and nothing else.

/** The three kinds stored by name before reactions accepted raw emoji. Rows
 *  carrying these still exist, so every surface keeps rendering them. */
export const LEGACY_REACTION_KINDS = ['up', 'heart', 'laugh'] as const

export type LegacyReactionKind = (typeof LEGACY_REACTION_KINDS)[number]

/** A reaction kind: a raw emoji, or one of the legacy names. Widened from a
 *  closed union so a kind this build has never seen still type-checks - the
 *  whole point of storing the glyph rather than a name. */
export type NoteReactionKind = string

/** Glyph for a legacy named kind. New kinds are their own glyph. */
const LEGACY_GLYPHS: Record<LegacyReactionKind, string> = {
  up: '\u{1F44D}',
  heart: '\u{2764}\u{FE0F}',
  laugh: '\u{1F602}',
}

/** Human-readable name for a legacy kind, for screen readers. */
const LEGACY_LABELS: Record<LegacyReactionKind, string> = {
  up: 'thumbs up',
  heart: 'heart',
  laugh: 'laugh',
}

function isLegacyKind(kind: string): kind is LegacyReactionKind {
  return (LEGACY_REACTION_KINDS as readonly string[]).includes(kind)
}

/** What to draw for a kind. A legacy name maps to its glyph; anything else is
 *  already the glyph, so it renders as itself. */
export function reactionGlyph(kind: NoteReactionKind): string {
  return isLegacyKind(kind) ? LEGACY_GLYPHS[kind] : kind
}

/** What a screen reader should say. Emoji kinds have no name we can know, so
 *  they announce as "reaction" plus the glyph, which readers speak themselves. */
export function reactionLabel(kind: NoteReactionKind): string {
  return isLegacyKind(kind) ? LEGACY_LABELS[kind] : `${kind} reaction`
}

// Skin-tone modifiers (U+1F3FB..U+1F3FF). Stripped before storing so a
// thumbs-up and a medium-dark thumbs-up tally as ONE reaction rather than
// splitting a note's counts across five near-identical chips.
const SKIN_TONE_RE = /[\u{1F3FB}-\u{1F3FF}]/gu

// Variation Selector-16, which asks for the emoji (rather than text) rendering
// of a character that has both forms. Kept when present, but not required, so
// "\u2764" and "\u2764\uFE0F" don't tally separately.
const VS16 = '\u{FE0F}'

/**
 * The codepoints allowed inside a kind.
 *
 * Emoji proper, plus the joiners a single emoji legitimately needs: ZWJ (which
 * builds sequences like a family), VS16, and the regional indicators that pair
 * into a flag. Everything else - letters, digits, punctuation, whitespace, and
 * crucially every invisible formatting or bidirectional-control character - is
 * outside the set, so it cannot be smuggled in behind a glyph.
 */
const ALLOWED_RE =
  /^[\u{200D}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F0FF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]+$/u

/** Longest emoji we accept, counted in codepoints AFTER stripping skin tones.
 *  A flag is 2, a ZWJ sequence like a family runs longer, so this is generous
 *  enough for real emoji and far short of a payload. */
const MAX_CODEPOINTS = 12

/**
 * Normalize a kind for storage and comparison: trim it and drop skin-tone
 * modifiers so variants of one emoji tally together. Legacy names pass through
 * untouched.
 */
export function normalizeReactionKind(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (isLegacyKind(text)) return text
  return text.replace(SKIN_TONE_RE, '')
}

/**
 * Whether a kind may be stored. Accepts the three legacy names, and otherwise
 * requires a short run of emoji codepoints and nothing else.
 *
 * Call this on the NORMALIZED kind - normalize first, then validate, then
 * store, so what you checked is exactly what you write.
 */
export function isValidReactionKind(kind: unknown): boolean {
  if (typeof kind !== 'string') return false
  if (isLegacyKind(kind)) return true
  if (!kind) return false
  // Count codepoints, not UTF-16 units: every emoji above the BMP is a surrogate
  // pair, so `.length` would roughly double the real count.
  const points = [...kind]
  if (points.length > MAX_CODEPOINTS) return false
  // A kind that is ONLY joiners/selectors renders as nothing at all - it would
  // be an invisible reaction chip, so refuse it.
  const visible = points.filter((c) => c !== '\u{200D}' && c !== VS16)
  if (visible.length === 0) return false
  return ALLOWED_RE.test(kind)
}

/** The reactions always offered up front, before a reader's own recents. These
 *  are the three that predate emoji kinds, so a note's existing chips and the
 *  quick row agree. */
export const PINNED_REACTIONS: string[] = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}']

/** How many recently-used reactions ride along after the pinned ones. */
export const RECENT_REACTION_SLOTS = 2

/**
 * The quick-pick row: the pinned reactions, then the reader's most recent OTHER
 * choices to fill the remaining slots.
 *
 * Recents are per-reader client state, never server state - which emoji you
 * reach for is a preference, not something the club needs to agree on.
 */
export function quickReactions(recents: string[] = []): string[] {
  const pinnedGlyphs = new Set(PINNED_REACTIONS.map(normalizeReactionKind))
  const extras: string[] = []
  for (const raw of recents) {
    const kind = normalizeReactionKind(raw)
    if (!kind || pinnedGlyphs.has(kind) || extras.includes(kind)) continue
    if (!isValidReactionKind(kind)) continue
    extras.push(kind)
    if (extras.length >= RECENT_REACTION_SLOTS) break
  }
  return [...PINNED_REACTIONS, ...extras]
}

/**
 * Fold a just-used reaction into the recents list, newest first.
 *
 * Pinned reactions are skipped: they already have a permanent slot, so letting
 * them into recents would spend a limited slot showing a duplicate.
 */
export function rememberReaction(recents: string[], used: string, limit = 12): string[] {
  const kind = normalizeReactionKind(used)
  if (!kind || !isValidReactionKind(kind)) return recents
  if (PINNED_REACTIONS.map(normalizeReactionKind).includes(kind)) return recents
  return [kind, ...recents.filter((r) => normalizeReactionKind(r) !== kind)].slice(0, limit)
}

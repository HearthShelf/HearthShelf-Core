// The Home screen's section arrangement - which bands appear on Home, in what
// order, and which are hidden. Shared so every surface reads one definition of
// what a Home section is and reconciles a saved arrangement the same way.
//
// The greeting header and the hero card are NOT sections: they're the identity
// of the screen and always lead. Everything below the hero is arrangeable.
//
// Recommendation rows are deliberately split. The taste engine (lib/discover)
// emits two kinds of shelf:
//
//   - Fixed-id shelves that always mean the same thing ('recommended',
//     'series-next', 'recent', plus QuestGiver's 'questgiver'). Each gets its
//     own section, so a listener can hide "Back to your library" while keeping
//     "Recommended for you".
//   - Content-derived shelves whose ids follow the listener's taste
//     ('genre-Fantasy', 'author-Sanderson', 'narrator-...', 'cold-...'). These
//     come and go as listening changes, so pinning per-id order would rot.
//     They collapse into ONE 'recommended-picks' section, capped by
//     homeRecShelfCount, that moves and hides as a unit.

import type { HomeSectionId, HomeSectionPref } from '../types/settings'

/**
 * Every arrangeable Home section, in the order a fresh install shows them.
 * The array order IS the default order.
 */
export const HOME_SECTION_IDS: HomeSectionId[] = [
  'dashboard',
  'release-countdown',
  'book-club',
  'continue-listening',
  'continue-series',
  'questgiver',
  'recommended',
  'recommended-picks',
  'series-next',
  'recent',
  'recently-added',
]

// Sections that ship hidden. None today - a fresh Home shows everything it has
// content for. Kept explicit so adding an opt-in section later is a one-liner.
const DEFAULT_OFF = new Set<HomeSectionId>([])

/** The default arrangement: canonical order, everything visible. */
export const DEFAULT_HOME_SECTIONS: HomeSectionPref[] = HOME_SECTION_IDS.map((id) => ({
  id,
  on: !DEFAULT_OFF.has(id),
}))

/** How many generated (genre/author/narrator/cold) rows the picks block may spawn. */
export const DEFAULT_REC_SHELF_COUNT = 4
export const MAX_REC_SHELF_COUNT = 8

/**
 * The fixed-id recommendation shelves that get their own Home section, mapped to
 * the section id they render as. Any taste-engine shelf NOT in this map is a
 * content-derived row and belongs to the 'recommended-picks' block.
 */
export const GENERAL_REC_SECTIONS: Record<string, HomeSectionId> = {
  questgiver: 'questgiver',
  recommended: 'recommended',
  'series-next': 'series-next',
  recent: 'recent',
}

/** True when a taste-engine shelf id is one of the generated, taste-derived rows. */
export function isGeneratedRecShelf(shelfId: string): boolean {
  return !(shelfId in GENERAL_REC_SECTIONS)
}

/**
 * Reconcile a stored arrangement against the canonical section set: keep the
 * user's order and on/off choices for sections they have, append any section
 * added since they last saved (at its default visibility, so a new section
 * surfaces instead of vanishing), and drop ids no longer known. Guarantees every
 * section appears exactly once.
 */
export function normalizeHomeSections(stored: unknown): HomeSectionPref[] {
  const arr = Array.isArray(stored) ? (stored as HomeSectionPref[]) : []
  const valid = new Set(HOME_SECTION_IDS)
  const seen = new Set<HomeSectionId>()
  const kept: HomeSectionPref[] = []
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue
    const id = s.id
    if (!valid.has(id) || seen.has(id)) continue
    seen.add(id)
    kept.push({ id, on: typeof s.on === 'boolean' ? s.on : !DEFAULT_OFF.has(id) })
  }
  for (const id of HOME_SECTION_IDS) {
    if (!seen.has(id)) kept.push({ id, on: !DEFAULT_OFF.has(id) })
  }
  return kept
}

/** True if v is a valid homeSections array: entries of { id: HomeSectionId, on }. */
export function isHomeSections(v: unknown): boolean {
  if (!Array.isArray(v)) return false
  const valid = new Set<string>(HOME_SECTION_IDS)
  return v.every(
    (s) =>
      !!s &&
      typeof s === 'object' &&
      valid.has((s as { id: unknown }).id as string) &&
      typeof (s as { on: unknown }).on === 'boolean',
  )
}

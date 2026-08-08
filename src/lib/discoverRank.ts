// Discovery ranking layer. Takes the deterministic shelves from
// buildDiscoverShelves() and folds in the two user-driven signals so every
// surface (web/mobile Home, web/mobile Discover, Android Auto) orders picks the
// same way:
//
//   1. QuestGiver-refined picks - item ids from the user's latest accepted QG
//      run. These rank first: the user explicitly tuned them.
//   2. Discover feedback and the user's own star ratings - a like, or a rating
//      of 4-5, boosts an item; dislike / not_interested removes it from every
//      shelf. Ratings arrive separately from feedback because they are a
//      site-wide property of a book, not a Discover-only signal.
//
// This layer only ever reorders, prepends, or removes. It never GATES: the base
// shelves stay the floor, so a non-empty library always has content on first run
// with zero setup. QuestGiver / AI only refine what's already there.

import type { ABSLibraryItem, ABSMediaProgress } from '../types/abs'
import type { DiscoverShelf } from './discover'

// Feedback is keyed by ABS library item id (see the web DiscoverPage, which reads
// fbMap[item.id]). Kept structurally identical to the client's DiscoverFeedbackMap
// so this helper consumes it directly without a translation layer.
export type DiscoverVote = 'like' | 'dislike' | 'not_interested'
export interface DiscoverFeedbackEntry {
  vote?: DiscoverVote
}
export type DiscoverFeedbackMap = Record<string, DiscoverFeedbackEntry>

export interface RankInputs {
  // Item ids from the user's latest accepted QuestGiver run, best-first. Empty
  // when the user has never run QuestGiver - the base order stands.
  questGiverPicks?: string[]
  // Per-item feedback map, keyed by item id.
  feedback?: DiscoverFeedbackMap
  // The user's own 1-5 star ratings, keyed by item id. Sourced from /hs/ratings,
  // which is live even on an install with Discover switched off.
  ratings?: Record<string, number>
  // Listening progress, keyed by item id. A QuestGiver run is a point-in-time
  // snapshot: once the listener finishes (or starts) a pick, the saved run still
  // names it, so without this the shelf replays books they already read. Every
  // other shelf draws from the unstarted pool - this holds the QG shelf to the
  // same rule. Omit only when progress is genuinely unavailable.
  progressById?: Map<string, ABSMediaProgress>
}

// True when feedback says the user does not want to see this item anywhere.
function isHidden(fb: DiscoverFeedbackEntry | undefined): boolean {
  return fb?.vote === 'not_interested' || fb?.vote === 'dislike'
}

// A per-item boost from positive feedback. A liked item, or one rated 4-5, floats
// up within its shelf; neutral / unrated items are unaffected.
function feedbackBoost(fb: DiscoverFeedbackEntry | undefined, rating?: number): number {
  let b = 0
  if (fb?.vote === 'like') b += 100
  if (typeof rating === 'number' && rating >= 4) b += (rating - 3) * 10
  return b
}

// Reorder one shelf's items: drop hidden ones, then stable-sort by feedback boost
// (positive feedback first) while preserving the base builder's order within a
// boost tier. QuestGiver picks are handled at the shelf level, not here.
function rankShelfItems(
  items: ABSLibraryItem[],
  feedback: DiscoverFeedbackMap,
  ratings: Record<string, number>,
): ABSLibraryItem[] {
  return items
    .filter((it) => !isHidden(feedback[it.id]))
    .map((it, i) => ({ it, i, b: feedbackBoost(feedback[it.id], ratings[it.id]) }))
    .sort((a, b) => b.b - a.b || a.i - b.i)
    .map((x) => x.it)
}

// Apply the ranking layer to a full set of built shelves. Returns shelves with
// hidden items removed and feedback-boosted items floated up, dropping any shelf
// left below `minShelf`. A leading "Picked by QuestGiver" shelf is prepended when
// the user has QG picks that resolve to owned items and survive feedback.
export function rankDiscoverShelves(
  shelves: DiscoverShelf[],
  byId: Map<string, ABSLibraryItem>,
  inputs: RankInputs = {},
  minShelf = 3,
): DiscoverShelf[] {
  const feedback = inputs.feedback ?? {}
  const ratings = inputs.ratings ?? {}
  const qgPicks = inputs.questGiverPicks ?? []
  const progressById = inputs.progressById

  const ranked: DiscoverShelf[] = []

  // 1. QuestGiver-refined shelf leads when present. Resolve pick ids to owned
  //    items in the user's chosen order, dropping hidden ones and any the
  //    listener has since finished or started. Only surface it if it clears the
  //    min-shelf bar - a single stale pick is not a shelf.
  const qgItems: ABSLibraryItem[] = []
  const qgSeen = new Set<string>()
  for (const id of qgPicks) {
    if (qgSeen.has(id)) continue
    const it = byId.get(id)
    if (!it || isHidden(feedback[id])) continue
    const p = progressById?.get(id)
    if (p?.isFinished || (p?.progress ?? 0) > 0) continue
    qgSeen.add(id)
    qgItems.push(it)
  }
  if (qgItems.length >= minShelf) {
    ranked.push({
      id: 'questgiver',
      label: 'Picked by QuestGiver',
      icon: 'auto_awesome',
      items: qgItems,
    })
  }

  // 2. The deterministic shelves, feedback-applied. De-dupe the QuestGiver items
  //    out of them so a pick does not appear twice on the page.
  for (const shelf of shelves) {
    const items = rankShelfItems(shelf.items, feedback, ratings).filter((it) => !qgSeen.has(it.id))
    if (items.length < minShelf) continue
    ranked.push({ ...shelf, items })
  }

  return ranked
}

// The Home preview: the single strongest recommendation shelf, capped short.
// Home shows a taste of Discover, not the whole page - this returns the lead
// shelf (QuestGiver picks if the user has them, else "Recommended for you")
// trimmed to `cap` items, or null when there is nothing worth previewing.
export function discoverHomePreview(
  shelves: DiscoverShelf[],
  byId: Map<string, ABSLibraryItem>,
  inputs: RankInputs = {},
  cap = 12,
): DiscoverShelf | null {
  const ranked = rankDiscoverShelves(shelves, byId, inputs)
  const lead = ranked[0]
  if (!lead || lead.items.length === 0) return null
  return { ...lead, items: lead.items.slice(0, cap) }
}

// Pure, deterministic social helpers, shared by web and mobile so both gate
// notes, detect pops, and cluster timeline markers the same way. No I/O, no
// store access - plain data in, plain data out. See docs/social.md.

import type {
  HSNote,
  HSNoteStub,
  HSClubMember,
  TimelineMarker,
  ClubRecBasis,
  ClubRecPick,
} from '../types/social'

/**
 * Client-side optimistic re-gating of cached notes as the reader's position
 * advances between polls. NOT the authoritative spoiler gate - the server route
 * filter is; this only unlocks already-fetched notes locally.
 *
 * A note is visible iff it is safe (author-declared spoiler-free), its timeSec
 * is null (general), timeSec <= position, its author is the caller, or the book
 * is finished. A reply (parentId != '') gates at its PARENT's timeSec, found
 * within the same list; a reply whose parent is not visible is not visible
 * (replies never inherit the parent's `safe` flag - only the parent's time
 * gate). positionSec null means "no position known" (only safe / ungated / own
 * / finished notes show). Returns the visible notes plus the count hidden ahead.
 */
export function gateNotes(
  notes: HSNote[],
  positionSec: number | null,
  meId: string,
  isFinished: boolean,
): { visible: HSNote[]; hiddenAhead: number } {
  const byId = new Map(notes.map((n) => [n.id, n]))

  // A note's own gate (ignoring parent chains): the point at which it unlocks.
  const passesOwn = (n: HSNote): boolean => {
    if (n.safe) return true
    if (n.userId === meId) return true
    if (isFinished) return true
    if (n.timeSec == null) return true
    if (positionSec == null) return false
    return n.timeSec <= positionSec
  }

  const visibleCache = new Map<string, boolean>()
  const isVisible = (n: HSNote): boolean => {
    const cached = visibleCache.get(n.id)
    if (cached !== undefined) return cached
    let result: boolean
    if (n.parentId !== '') {
      // Reply: gates at its parent's TIME gate, plus the parent's `safe` flag (a
      // safe parent is shown to everyone, so its thread is too). NOT the parent's
      // author bypass - that must not unlock a stranger's reply. The reply's own
      // author/finished still bypass. A missing parent is treated as locked
      // (conservative: partial lists must never over-reveal), matching the
      // server's authoritative rule.
      if (n.userId === meId || isFinished) {
        result = true
      } else {
        const parent = byId.get(n.parentId)
        result = parent
          ? parent.safe ||
            parent.timeSec == null ||
            (positionSec != null && parent.timeSec <= positionSec)
          : false
      }
    } else {
      result = passesOwn(n)
    }
    visibleCache.set(n.id, result)
    return result
  }

  const visible: HSNote[] = []
  let hiddenAhead = 0
  for (const n of notes) {
    if (isVisible(n)) visible.push(n)
    else hiddenAhead++
  }
  return { visible, hiddenAhead }
}

/**
 * Detect note stubs crossed as playback moves from prevPos to newPos. A pop
 * fires for each stub with prevPos < timeSec <= newPos whose id is not already
 * in seenIds, sorted by timeSec ascending. A stub at exactly 0:00 pops on the
 * first forward tick from 0 (a strict lower bound would orphan it forever,
 * since prevPos starts at 0). seeked is true when the move looks like a scrub
 * (backward, or a forward jump over 30s) so the UI can condense the crossed
 * pops into one summary instead of a toast flood.
 */
export function detectNotePops(
  prevPos: number,
  newPos: number,
  stubs: HSNoteStub[],
  seenIds: ReadonlySet<string>,
): { pops: HSNoteStub[]; seeked: boolean } {
  const seeked = newPos < prevPos || newPos - prevPos > 30
  const crossed = (t: number): boolean =>
    (t > prevPos && t <= newPos) || (t === 0 && prevPos === 0 && newPos > 0)
  const pops = stubs
    .filter((s) => crossed(s.timeSec) && !seenIds.has(s.id))
    .sort((a, b) => a.timeSec - b.timeSec)
  return { pops, seeked }
}

/**
 * Count unread notes in a club: notes created after the last-read cursor. The
 * input is the already-unlocked list, so locked notes never count and the badge
 * cannot leak that discussion exists ahead of the reader.
 */
export function clubUnreadCount(notes: HSNote[], lastReadAt: number): number {
  let count = 0
  for (const n of notes) {
    if (n.createdAt > lastReadAt) count++
  }
  return count
}

/**
 * Order club members for the progress race: finished members first, then by
 * fractional progress (currentTime / duration) descending, with unknown-progress
 * members last. Stable and non-mutating.
 */
export function sortMembersByProgress(members: HSClubMember[]): HSClubMember[] {
  // rank: 0 finished, 1 has-progress, 2 unknown; then higher fraction first.
  const rankOf = (m: HSClubMember): number => {
    if (m.isFinished === true) return 0
    if (m.currentTime != null && m.duration != null && m.duration > 0) return 1
    return 2
  }
  const fractionOf = (m: HSClubMember): number => {
    if (m.currentTime != null && m.duration != null && m.duration > 0) {
      return m.currentTime / m.duration
    }
    return 0
  }
  return members
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const ra = rankOf(a.m)
      const rb = rankOf(b.m)
      if (ra !== rb) return ra - rb
      if (ra === 1) {
        const fb = fractionOf(b.m)
        const fa = fractionOf(a.m)
        if (fb !== fa) return fb - fa
      }
      return a.i - b.i // stable
    })
    .map((x) => x.m)
}

/** Input item for clusterTimelineMarkers: an unlocked note (kind 'note', with
 * author info for the avatar dot) or a locked stub (kind 'stub', anonymous). */
export interface MarkerItem {
  id: string
  timeSec: number
  kind: 'note' | 'stub'
  userId?: string
  username?: string
}

/**
 * Cluster unlocked notes + locked stubs into scrubber markers. Items are sorted
 * by timeSec, then greedily grouped so items within 1% of durationSec of the
 * cluster's start join it; each marker's fraction is the cluster mean timeSec
 * over duration (0..1 clamped). If clusters exceed maxMarkers (default 40),
 * nearest-neighbor pairs merge until under the cap. A cluster's kind is 'mixed'
 * when it holds both notes and stubs. Deterministic; returns [] for
 * durationSec <= 0 or maxMarkers < 1 (a 0 cap means "no markers", e.g. car mode).
 */
export function clusterTimelineMarkers(
  items: MarkerItem[],
  durationSec: number,
  maxMarkers = 40,
): TimelineMarker[] {
  if (durationSec <= 0 || maxMarkers < 1) return []

  const sorted = [...items].sort((a, b) => a.timeSec - b.timeSec)
  if (sorted.length === 0) return []

  const gap = durationSec * 0.01

  // Greedy pass: group items within `gap` of the current cluster's start.
  interface Cluster {
    items: MarkerItem[]
    start: number
    sum: number
  }
  const clusters: Cluster[] = []
  for (const it of sorted) {
    const last = clusters[clusters.length - 1]
    if (last && it.timeSec - last.start <= gap) {
      last.items.push(it)
      last.sum += it.timeSec
    } else {
      clusters.push({ items: [it], start: it.timeSec, sum: it.timeSec })
    }
  }

  // Merge nearest-neighbor pairs until under the cap. Distance is between
  // cluster mean positions; ties break on the earlier (lower-index) pair.
  const meanOf = (c: Cluster): number => c.sum / c.items.length
  while (clusters.length > maxMarkers) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < clusters.length - 1; i++) {
      const dist = meanOf(clusters[i + 1]) - meanOf(clusters[i])
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    }
    const a = clusters[bestIdx]
    const b = clusters[bestIdx + 1]
    const merged: Cluster = {
      items: a.items.concat(b.items),
      start: a.start,
      sum: a.sum + b.sum,
    }
    clusters.splice(bestIdx, 2, merged)
  }

  return clusters.map((c): TimelineMarker => {
    let hasNote = false
    let hasStub = false
    for (const it of c.items) {
      if (it.kind === 'note') hasNote = true
      else hasStub = true
    }
    const kind: TimelineMarker['kind'] = hasNote && hasStub ? 'mixed' : hasNote ? 'note' : 'stub'
    const rawFraction = meanOf(c) / durationSec
    const fraction = rawFraction < 0 ? 0 : rawFraction > 1 ? 1 : rawFraction
    return {
      fraction,
      kind,
      count: c.items.length,
      items: c.items.map((it) => ({
        id: it.id,
        timeSec: it.timeSec,
        kind: it.kind,
        userId: it.userId,
        username: it.username,
      })),
    }
  })
}

// --- Club next-book recommendation ------------------------------------------
//
// When a club is nearly done with its current book and has nothing queued, the
// owner can ask for a next-book pick. The taste that drives the pick is either
// the genres the club has read together (club-history) or the genres every
// member has finished across the whole library (all-members-finished); the
// server resolves whichever the owner chose into a plain genre->weight map and
// a candidate pool, and these pure helpers turn that into a prompt or a
// deterministic pick set. See docs/social.md.

/** A book the club could read next: an unstarted library item, decoupled from
 * ABS types so this stays pure (the server maps ABS items to this). */
export interface ClubRecCandidate {
  libraryItemId: string
  title: string
  author: string
  genre: string // primary bucket
  genres: string[] // all genre tokens (for weight matching)
  hours: number
}

/** The club's combined taste: how strongly each genre pulls (higher = more the
 * club leans that way), plus the raw finished/read count that produced it (for
 * the intro copy). Built by the server from the chosen basis. */
export interface ClubTaste {
  /** genre -> weight; only genres with weight > 0 need be present. */
  weights: Record<string, number>
  /** The dominant genre (highest weight), or null when the club has no history. */
  dominant: string | null
  /** How many finished/read books fed the taste (for the intro sentence). */
  sampleSize: number
}

const REC_COUNT = 4

// A candidate's pull = the best taste weight across its genre tokens.
function tasteWeightOf(taste: ClubTaste, c: ClubRecCandidate): number {
  const gs = c.genres.length ? c.genres : [c.genre]
  return Math.max(0, ...gs.map((g) => taste.weights[g] || 0))
}

/**
 * Deterministic club recommender - always available, needs no AI provider.
 * Scores candidates by how well their genres match the club's taste, nudged by
 * length, and returns the top REC_COUNT with a plain reason each. `rand` is
 * injectable for testing; the tiny jitter only breaks ties among equal-weight
 * picks so the list isn't alphabetical. Returns { intro, picks }.
 */
export function clubHeuristic(
  taste: ClubTaste,
  candidates: ClubRecCandidate[],
  basis: ClubRecBasis,
  rand: () => number = Math.random,
): { intro: string; picks: ClubRecPick[] } {
  const scored = candidates
    .map((c) => ({ c, w: tasteWeightOf(taste, c) }))
    .map((x) => ({ ...x, s: x.w + (x.c.hours > 0 ? 0 : -1) + rand() * 0.5 }))
    // Keep only candidates that actually match a genre the club leans toward,
    // unless the club has no taste at all (then everything is fair game).
    .filter((x) => x.w > 0 || taste.dominant == null)
    .sort((a, b) => b.s - a.s)

  const picks: ClubRecPick[] = scored.slice(0, REC_COUNT).map((x) => ({
    libraryItemId: x.c.libraryItemId,
    title: x.c.title,
    author: x.c.author,
    genre: x.c.genre,
    reason: taste.dominant
      ? `A ${x.c.genre} pick that fits what your club keeps coming back to.`
      : `A well-matched ${x.c.genre} listen to start your club's shelf.`,
  }))

  const source = basis === 'all-members-finished' ? "everyone's finished books" : "your club's reading"
  const intro = taste.dominant
    ? `Based on ${source} - mostly ${taste.dominant} - here's what your club could read next.`
    : "Here's what your club could read next."
  return { intro, picks }
}

/**
 * Build the AI prompt for a club next-book pick. Mirrors qgCraftPrompt's shape
 * (profile lines + candidate table + JSON-only instruction) but framed for a
 * group, and asks the model to return libraryItemIds it can only choose from the
 * candidate list. The server runs this through the same provider path as
 * QuestGiver and parses the same JSON envelope.
 */
export function craftClubPrompt(
  clubName: string,
  memberCount: number,
  taste: ClubTaste,
  candidates: ClubRecCandidate[],
  basis: ClubRecBasis,
): string {
  const weightLines = Object.entries(taste.weights)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([g, v]) => `  ${g}: ${v}/10`)
    .join('\n')
  const pool = candidates
    .map((c) => `${c.libraryItemId} | ${c.title} — ${c.author} | ${c.genre} | ${c.hours}h`)
    .join('\n')
  const source =
    basis === 'all-members-finished'
      ? `the ${taste.sampleSize} books the club's ${memberCount} members have finished`
      : `the ${taste.sampleSize} books the club has read together`
  return [
    'You are QuestGiver, an audiobook matchmaker inside HearthShelf. Recommend the next book for a reading club.',
    '',
    `CLUB: "${clubName}" (${memberCount} ${memberCount === 1 ? 'member' : 'members'}).`,
    `Its taste is drawn from ${source}; dominant genre: ${taste.dominant || 'varied'}.`,
    '',
    'GENRE LEANINGS (higher = the club reads more of it):',
    weightLines || '  (none yet)',
    '',
    'CANDIDATES (id | title — author | genre | length):',
    pool,
    '',
    `Pick ${REC_COUNT} from the candidate ids, best-first, that suit the whole club (not one member).`,
    'Each reason is ONE warm, specific sentence a librarian would say to the group.',
    'Return ONLY JSON, no prose: {"intro":"one sentence","picks":[{"id":"...","reason":"..."}]}',
  ].join('\n')
}

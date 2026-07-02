// Pure, deterministic social helpers, shared by web and mobile so both gate
// notes, detect pops, and cluster timeline markers the same way. No I/O, no
// store access - plain data in, plain data out. See docs/social.md.

import type { HSNote, HSNoteStub, HSClubMember, TimelineMarker } from '../types/social'

/**
 * Client-side optimistic re-gating of cached notes as the reader's position
 * advances between polls. NOT the authoritative spoiler gate - the server route
 * filter is; this only unlocks already-fetched notes locally.
 *
 * A note is visible iff its timeSec is null (general), timeSec <= position, its
 * author is the caller, or the book is finished. A reply (parentId != '') gates
 * at its PARENT's timeSec, found within the same list; a reply whose parent is
 * not visible is not visible. positionSec null means "no position known" (only
 * ungated / own / finished notes show). Returns the visible notes plus the
 * count of notes hidden ahead.
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
      // Reply: gates at its parent's TIME gate (not the parent's full
      // visibility - the parent-author bypass must not unlock someone else's
      // reply). Author/finished still bypass. A missing parent is treated as
      // locked (conservative: partial lists must never over-reveal), matching
      // the server's authoritative rule.
      if (n.userId === meId || isFinished) {
        result = true
      } else {
        const parent = byId.get(n.parentId)
        result = parent
          ? parent.timeSec == null || (positionSec != null && parent.timeSec <= positionSec)
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

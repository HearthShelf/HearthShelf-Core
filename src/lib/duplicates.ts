// Duplicate library items: one folder that AudiobookShelf recorded twice.
//
// How it happens (ABS server/scanner/LibraryScanner.js): a full library scan
// snapshots the existing items when it starts, spends minutes rescanning, then
// adds every folder that was not in that stale snapshot. If the folder watcher -
// or any tool calling POST /api/libraries/:id/scan - adds a folder in between,
// the full scan adds it AGAIN under a new id. The next scan then marks one of the
// two copies isMissing. Either copy can end up holding the listener's progress
// and a phone's download, so clients cannot just drop the "missing" one.
//
// Every client has to answer the same questions the same way, so they live here:
//   - which items are one folder recorded twice    findDuplicateItems
//   - which copy to keep                            pickDuplicateKeeper
//   - which id to open instead of a duplicate       resolveKeeperId
//   - which tiles to hide from a list               hideDuplicateItems
//   - whether to move the listener's place          planProgressCarryOver
//   - which bookmarks to copy                       planBookmarkCarryOver
//   - which copies an admin may safely remove       planDuplicateCleanup
//
// Removing a duplicate is DELETE /api/items/:id WITHOUT ?hard=1. Both copies
// point at the same folder on disk, so a hard delete would erase the real book.
import type { ABSBookmark, ABSMediaProgress } from '../types/abs'

/** The fields of an ABS library item (minified or expanded) this needs. */
export interface DuplicateCandidate {
  id: string
  libraryId: string
  folderId?: string | null
  path?: string | null
  ino?: string | null
  isMissing?: boolean | null
  isInvalid?: boolean | null
  /** ABS epoch ms - the item row's createdAt. */
  addedAt?: number | null
}

/**
 * How two items were matched. 'path' is certain: ABS keys items by folder path.
 * 'inode' means the same folder was renamed or moved and ABS kept the old row.
 */
export type DuplicateMatch = 'path' | 'inode'

export interface DuplicateGroup<T extends DuplicateCandidate> {
  keeper: T
  /** Never empty, never contains the keeper. */
  duplicates: T[]
  match: DuplicateMatch
}

/**
 * Duplicate id -> keeper id. A plain object so clients can persist it (offline
 * caches, query caches) without a Map serializer.
 */
export type DuplicateIndex = Readonly<Record<string, string>>

/**
 * Compare paths the way the filesystem would: forward slashes, no repeated or
 * trailing slash. Case is kept - ABS servers run on case-sensitive filesystems,
 * where "Book" and "book" are two folders.
 */
export function normalizeItemPath(path: string | null | undefined): string {
  if (!path) return ''
  let p = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

function isHealthy(item: DuplicateCandidate): boolean {
  return !item.isMissing && !item.isInvalid
}

function addedAtOf(item: DuplicateCandidate): number {
  const value = item.addedAt
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

/**
 * Order copies best-first: a copy ABS can still play (not missing, not invalid)
 * beats one it cannot; then the oldest row (the one other devices and links have
 * known longest); then the id, so every client picks the same keeper.
 */
export function compareDuplicateKeepers(a: DuplicateCandidate, b: DuplicateCandidate): number {
  const healthy = Number(isHealthy(b)) - Number(isHealthy(a))
  if (healthy !== 0) return healthy
  const aAdded = addedAtOf(a)
  const bAdded = addedAtOf(b)
  if (aAdded !== bAdded) return aAdded < bAdded ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** The copy to keep out of a set of items that are one folder. */
export function pickDuplicateKeeper<T extends DuplicateCandidate>(items: readonly T[]): T {
  if (items.length === 0) throw new Error('pickDuplicateKeeper: no items')
  return [...items].sort(compareDuplicateKeepers)[0]
}

/**
 * Group items that are one folder recorded twice. Items are matched only within
 * the same library:
 *
 *   - same normalized path: always the same folder.
 *   - same inode in the same library folder, when the path differs: only when at
 *     most one distinct path among the group is still healthy. Inode numbers
 *     repeat across disks, so two healthy items at two paths with one inode are
 *     treated as two books, never merged.
 *
 * Items without a path or inode are never grouped. Input order does not matter;
 * output groups are sorted by keeper id so results are stable.
 */
export function findDuplicateItems<T extends DuplicateCandidate>(
  items: readonly T[],
): DuplicateGroup<T>[] {
  const byId = new Map<string, T>()
  for (const item of items) {
    if (item && item.id && !byId.has(item.id)) byId.set(item.id, item)
  }
  const unique = [...byId.values()]

  // Union-find over item ids.
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root) as string
    let cur = id
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) as string
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a: string, b: string): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }
  for (const item of unique) parent.set(item.id, item.id)

  const byPath = new Map<string, T[]>()
  for (const item of unique) {
    const path = normalizeItemPath(item.path)
    if (!path) continue
    const key = `${item.libraryId}\u0000${path}`
    const list = byPath.get(key)
    if (list) list.push(item)
    else byPath.set(key, [item])
  }
  for (const list of byPath.values()) {
    for (let i = 1; i < list.length; i++) union(list[0].id, list[i].id)
  }

  const byInode = new Map<string, T[]>()
  for (const item of unique) {
    const ino = item.ino == null ? '' : String(item.ino).trim()
    if (!ino || ino === '0') continue
    const key = `${item.libraryId}\u0000${item.folderId ?? ''}\u0000${ino}`
    const list = byInode.get(key)
    if (list) list.push(item)
    else byInode.set(key, [item])
  }
  for (const list of byInode.values()) {
    if (list.length < 2) continue
    const healthyPaths = new Set(list.filter(isHealthy).map((item) => normalizeItemPath(item.path)))
    if (healthyPaths.size > 1) continue
    for (let i = 1; i < list.length; i++) union(list[0].id, list[i].id)
  }

  const groups = new Map<string, T[]>()
  for (const item of unique) {
    const root = find(item.id)
    const list = groups.get(root)
    if (list) list.push(item)
    else groups.set(root, [item])
  }

  const result: DuplicateGroup<T>[] = []
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const keeper = pickDuplicateKeeper(members)
    const keeperPath = normalizeItemPath(keeper.path)
    const duplicates = members.filter((m) => m.id !== keeper.id).sort(compareDuplicateKeepers)
    const match: DuplicateMatch =
      keeperPath !== '' && duplicates.every((d) => normalizeItemPath(d.path) === keeperPath)
        ? 'path'
        : 'inode'
    result.push({ keeper, duplicates, match })
  }
  result.sort((a, b) => (a.keeper.id < b.keeper.id ? -1 : a.keeper.id > b.keeper.id ? 1 : 0))
  return result
}

/** Duplicate id -> keeper id for a set of groups. */
export function buildDuplicateIndex<T extends DuplicateCandidate>(
  groups: readonly DuplicateGroup<T>[],
): DuplicateIndex {
  const index: Record<string, string> = {}
  for (const group of groups) {
    for (const dup of group.duplicates) index[dup.id] = group.keeper.id
  }
  return index
}

/** Later indexes win for the same duplicate id. */
export function mergeDuplicateIndexes(
  ...indexes: readonly (DuplicateIndex | null | undefined)[]
): DuplicateIndex {
  const merged: Record<string, string> = {}
  for (const index of indexes) {
    if (!index) continue
    for (const [dup, keeper] of Object.entries(index)) {
      if (dup !== keeper) merged[dup] = keeper
    }
  }
  return merged
}

/**
 * The id to open instead of `id`: its keeper when `id` is a known duplicate,
 * otherwise `id` itself. Follows chains and stops on a loop.
 */
export function resolveKeeperId(index: DuplicateIndex | null | undefined, id: string): string {
  if (!index) return id
  let current = id
  const seen = new Set<string>([current])
  for (;;) {
    const next = index[current]
    if (!next || seen.has(next)) return current
    seen.add(next)
    current = next
  }
}

export function isDuplicateId(index: DuplicateIndex | null | undefined, id: string): boolean {
  return resolveKeeperId(index, id) !== id
}

/**
 * Drop duplicate tiles from a list, keeping list order. A duplicate is hidden
 * when its keeper is in the same list. When only duplicates of a book are in the
 * list (the keeper is on another page, or the list is "continue listening" and
 * only the duplicate has progress), the first of them stays, so the book is
 * never hidden entirely - opening it should go through resolveKeeperId.
 *
 * Duplicates are recognized from `index` and, for items that carry path/ino,
 * from the list itself.
 */
export function hideDuplicateItems<T extends { id: string }>(
  items: readonly T[],
  index?: DuplicateIndex | null,
): T[] {
  const candidates = items.filter(
    (item): item is T & DuplicateCandidate =>
      typeof (item as Partial<DuplicateCandidate>).libraryId === 'string' &&
      ((item as Partial<DuplicateCandidate>).path != null ||
        (item as Partial<DuplicateCandidate>).ino != null),
  )
  const local = buildDuplicateIndex(findDuplicateItems(candidates))
  const combined = mergeDuplicateIndexes(index, local)
  if (Object.keys(combined).length === 0) return [...items]

  const present = new Set(items.map((item) => item.id))
  const shownForKeeper = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    const keeperId = resolveKeeperId(combined, item.id)
    if (keeperId === item.id) {
      result.push(item)
      continue
    }
    if (present.has(keeperId) || shownForKeeper.has(keeperId)) continue
    shownForKeeper.add(keeperId)
    result.push(item)
  }
  return result
}

// --- Progress -------------------------------------------------------------

/** The body for PATCH /api/me/progress/:keeperId. */
export interface ProgressCarryPatch {
  currentTime: number
  duration: number
  progress: number
  isFinished: boolean
  finishedAt?: number | null
  ebookLocation?: string | null
  ebookProgress?: number | null
  /** Backdates the keeper's progress to when the listening happened (ABS honors
   *  it when updating an existing progress row). */
  lastUpdate?: number
}

export interface ProgressCarryPlan {
  /** Duplicate whose progress is being moved. */
  fromItemId: string
  patch: ProgressCarryPatch
}

function hasPlace(progress: ABSMediaProgress): boolean {
  if (progress.episodeId) return false
  return (
    progress.isFinished ||
    progress.currentTime > 0 ||
    progress.progress > 0 ||
    (progress.ebookProgress ?? 0) > 0
  )
}

function lastUpdateOf(progress: ABSMediaProgress | null | undefined): number {
  const value = progress?.lastUpdate
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Whether to copy a listener's place from a duplicate onto the keeper. Picks the
 * duplicate progress touched most recently. Copies only when the keeper has no
 * progress or strictly older progress, so it never overwrites newer listening,
 * and running it again after the copy finds nothing to do. Book progress only;
 * podcast episode rows are ignored.
 */
export function planProgressCarryOver(
  keeperProgress: ABSMediaProgress | null | undefined,
  duplicateProgress: readonly (ABSMediaProgress | null | undefined)[],
): ProgressCarryPlan | null {
  let best: ABSMediaProgress | null = null
  for (const p of duplicateProgress) {
    if (!p || !hasPlace(p)) continue
    if (!best || lastUpdateOf(p) > lastUpdateOf(best)) best = p
  }
  if (!best) return null
  const keeper = keeperProgress && !keeperProgress.episodeId ? keeperProgress : null
  if (keeper && hasPlace(keeper) && lastUpdateOf(keeper) >= lastUpdateOf(best)) return null
  // A keeper row with no place at all (opened, never played) loses to any real place.
  const patch: ProgressCarryPatch = {
    currentTime: best.currentTime,
    duration: best.duration,
    progress: best.progress,
    isFinished: best.isFinished,
  }
  if (best.isFinished && best.finishedAt) patch.finishedAt = best.finishedAt
  if (best.ebookLocation) patch.ebookLocation = best.ebookLocation
  if (typeof best.ebookProgress === 'number' && best.ebookProgress > 0)
    patch.ebookProgress = best.ebookProgress
  if (lastUpdateOf(best) > 0) patch.lastUpdate = lastUpdateOf(best)
  return { fromItemId: best.libraryItemId, patch }
}

/** Bookmarks to add to the keeper: duplicate bookmarks it does not already have
 *  at (about) the same time. Body for POST /api/me/item/:keeperId/bookmark. */
export function planBookmarkCarryOver(
  keeperId: string,
  bookmarks: readonly ABSBookmark[],
  duplicateIds: readonly string[],
): { time: number; title: string }[] {
  const dupSet = new Set(duplicateIds)
  const keeperTimes = bookmarks
    .filter((b) => b.libraryItemId === keeperId)
    .map((b) => Math.round(b.time))
  const taken = new Set(keeperTimes)
  const result: { time: number; title: string }[] = []
  for (const b of bookmarks) {
    if (!dupSet.has(b.libraryItemId)) continue
    const time = Math.round(b.time)
    if (taken.has(time)) continue
    taken.add(time)
    result.push({ time: b.time, title: b.title || 'Bookmark' })
  }
  return result
}

/**
 * What one listener's client does for one group, in order: move the place,
 * then the bookmarks. `progress` and `bookmarks` are the signed-in user's own
 * (GET /api/me).
 */
export interface DuplicateCarryPlan {
  keeperId: string
  progress: ProgressCarryPlan | null
  bookmarks: { time: number; title: string }[]
}

export function planDuplicateCarryOver<T extends DuplicateCandidate>(
  group: DuplicateGroup<T>,
  progress: readonly ABSMediaProgress[],
  bookmarks: readonly ABSBookmark[] = [],
): DuplicateCarryPlan {
  const dupIds = group.duplicates.map((d) => d.id)
  const dupSet = new Set(dupIds)
  const keeperProgress =
    progress.find((p) => p.libraryItemId === group.keeper.id && !p.episodeId) ?? null
  const dupProgress = progress.filter((p) => dupSet.has(p.libraryItemId))
  return {
    keeperId: group.keeper.id,
    progress: planProgressCarryOver(keeperProgress, dupProgress),
    bookmarks: planBookmarkCarryOver(group.keeper.id, bookmarks, dupIds),
  }
}

// --- Admin cleanup --------------------------------------------------------

/** Another listener's saved progress (admin: GET /api/users/:id mediaProgress). */
export interface ListenerProgress {
  userId: string
  progress: readonly ABSMediaProgress[]
}

export type DuplicateCleanupBlock =
  /** Another listener's place is only on this copy. Their own app moves it the
   *  next time they open it; removing the copy now would erase it. */
  | 'other-listener-progress'
  /** Different library than its keeper - never expected; refuse. */
  | 'library-mismatch'

export interface DuplicateCleanupPlan {
  /** Ids safe to DELETE /api/items/:id (never with ?hard=1). */
  remove: string[]
  /** Copies that must stay for now, with why. */
  keep: { id: string; keeperId: string; reason: DuplicateCleanupBlock; userIds: string[] }[]
}

/**
 * Which duplicates an admin may remove now. Run the admin's OWN carry-over
 * first and pass their refreshed progress among `listeners`; a copy is removed
 * only when no listener would lose a place that is newer than what they have on
 * the keeper. Listeners the admin cannot see cannot be checked - only call this
 * with the full user list (admins only).
 */
export function planDuplicateCleanup<T extends DuplicateCandidate>(
  groups: readonly DuplicateGroup<T>[],
  listeners: readonly ListenerProgress[],
): DuplicateCleanupPlan {
  const plan: DuplicateCleanupPlan = { remove: [], keep: [] }
  for (const group of groups) {
    for (const dup of group.duplicates) {
      if (dup.id === group.keeper.id) continue
      if (dup.libraryId !== group.keeper.libraryId) {
        plan.keep.push({
          id: dup.id,
          keeperId: group.keeper.id,
          reason: 'library-mismatch',
          userIds: [],
        })
        continue
      }
      const blockedBy: string[] = []
      for (const listener of listeners) {
        const keeperProgress =
          listener.progress.find((p) => p.libraryItemId === group.keeper.id && !p.episodeId) ?? null
        const dupProgress = listener.progress.filter((p) => p.libraryItemId === dup.id)
        if (planProgressCarryOver(keeperProgress, dupProgress)) blockedBy.push(listener.userId)
      }
      if (blockedBy.length)
        plan.keep.push({
          id: dup.id,
          keeperId: group.keeper.id,
          reason: 'other-listener-progress',
          userIds: blockedBy,
        })
      else plan.remove.push(dup.id)
    }
  }
  return plan
}

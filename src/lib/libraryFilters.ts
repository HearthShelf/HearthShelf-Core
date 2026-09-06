import type { ABSLibraryItem } from '../types/abs'

// Filter values are encoded as "group|value" strings (or "all" / a bare flag
// id), matching the design reference. A library item's progress is supplied
// separately since it is not on the item itself.
export interface ItemProgress {
  progress: number
  isFinished: boolean
}
export type ProgressLookup = (itemId: string) => ItemProgress | undefined

export interface FilterGroup {
  id: string
  label: string
  values: (items: ABSLibraryItem[]) => string[]
}

const uniqSorted = (vals: Iterable<string>) =>
  [...new Set([...vals].filter(Boolean))].sort((a, b) => a.localeCompare(b))

const splitNames = (raw: string | null | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

// Categories derived from real ABS metadata. Each values() reads the loaded
// items so the menu only offers filters that actually match something.
//
// Every metadata read here is null-guarded even where the type says it cannot be
// missing. ABS omits genres, seriesName and narratorName entirely from a
// `minified=1` response, but the ABSLibraryItem type declares them required - so
// a client that hands us a minified list gets no type error and an unguarded
// `.flatMap(i => i.media.metadata.genres)` throws at runtime. Guarding here
// degrades to an empty filter list instead of a crash; the client still owes us
// a non-minified fetch if it wants these groups populated.
export const FILTER_GROUPS: FilterGroup[] = [
  {
    id: 'genres',
    label: 'Genre',
    values: (items) => uniqSorted(items.flatMap((i) => i.media.metadata.genres ?? [])),
  },
  {
    id: 'authors',
    label: 'Author',
    values: (items) => uniqSorted(items.flatMap((i) => splitNames(i.media.metadata.authorName))),
  },
  {
    id: 'narrators',
    label: 'Narrator',
    values: (items) =>
      uniqSorted(items.flatMap((i) => splitNames(i.media.metadata.narratorName ?? ''))),
  },
  {
    id: 'series',
    label: 'Series',
    values: (items) =>
      uniqSorted(items.map((i) => i.media.metadata.seriesName ?? '').filter(Boolean)),
  },
  {
    id: 'decade',
    label: 'Published Decade',
    values: (items) =>
      uniqSorted(
        items
          .map((i) => Number(i.media.metadata.publishedYear))
          .filter((y) => y > 0)
          .map((y) => `${Math.floor(y / 10) * 10}s`),
      ),
  },
  {
    id: 'language',
    label: 'Language',
    values: (items) =>
      uniqSorted(items.map((i) => i.media.metadata.language ?? '').filter(Boolean)),
  },
  {
    id: 'tags',
    label: 'Tag',
    values: (items) => uniqSorted(items.flatMap((i) => i.media.tags ?? [])),
  },
  {
    id: 'progress',
    label: 'Progress',
    values: () => ['Finished', 'In Progress', 'Not Started', 'Not Finished'],
  },
]

// Standalone toggles (no sub-menu).
export const FILTER_FLAGS: [string, string][] = [['explicit', 'Explicit']]

export function filterLabel(f: string): string {
  if (f === 'all') return 'Filter'
  const flag = FILTER_FLAGS.find(([id]) => id === f)
  if (flag) return flag[1]
  return f.split('|')[1] || 'Filter'
}

/**
 * The group name a "group|value" filter belongs to, e.g. "Author" for
 * "authors|Brandon Sanderson". Empty for flags and "all".
 *
 * `filterLabel` deliberately returns only the value, which reads fine inside a
 * labelled Filter menu but is ambiguous on a standalone chip: "Finished" could
 * be a progress state or a genre of that name.
 */
export function filterGroupLabel(f: string): string {
  if (f === 'all' || FILTER_FLAGS.some(([id]) => id === f)) return ''
  const gid = f.split('|')[0]
  return FILTER_GROUPS.find((g) => g.id === gid)?.label ?? ''
}

/** "Author: Brandon Sanderson" - a chip that says what it filters on. */
export function filterChipLabel(f: string): string {
  const group = filterGroupLabel(f)
  const value = filterLabel(f)
  return group ? `${group}: ${value}` : value
}

/**
 * Apply several filters at once, ANDed together.
 *
 * One active filter is enough for a small shelf, but on a large catalog a
 * single predicate rarely narrows far enough - a genre alone can still leave
 * hundreds of books, and the natural next move is combining it with a progress
 * state. Selecting a second filter used to silently replace the first.
 *
 * Ignores "all" so callers may pass a list still holding the neutral value.
 * Order does not matter; every filter must match.
 */
export function applyLibraryFilters(
  items: ABSLibraryItem[],
  filters: string[],
  progressOf: ProgressLookup,
): ABSLibraryItem[] {
  return filters
    .filter((f) => f && f !== 'all')
    .reduce((acc, f) => applyLibraryFilter(acc, f, progressOf), items)
}

// Apply a "group|value" (or flag / "all") filter to the item list.
export function applyLibraryFilter(
  items: ABSLibraryItem[],
  f: string,
  progressOf: ProgressLookup,
): ABSLibraryItem[] {
  if (f === 'all') return items
  if (f === 'explicit') return items.filter((b) => b.media.metadata.explicit)

  const [gid, val] = f.split('|')
  switch (gid) {
    case 'genres':
      return items.filter((b) => (b.media.metadata.genres ?? []).includes(val))
    case 'authors':
      return items.filter((b) => splitNames(b.media.metadata.authorName).includes(val))
    case 'narrators':
      return items.filter((b) => splitNames(b.media.metadata.narratorName ?? '').includes(val))
    case 'series':
      return items.filter((b) => b.media.metadata.seriesName === val)
    case 'decade':
      return items.filter((b) => {
        const y = Number(b.media.metadata.publishedYear)
        return y > 0 && `${Math.floor(y / 10) * 10}s` === val
      })
    case 'language':
      return items.filter((b) => b.media.metadata.language === val)
    case 'tags':
      return items.filter((b) => (b.media.tags ?? []).includes(val))
    case 'progress':
      return items.filter((b) => {
        const p = progressOf(b.id)
        if (val === 'Finished') return !!p?.isFinished
        if (val === 'In Progress') return !!p && !p.isFinished && p.progress > 0
        if (val === 'Not Started') return !p || p.progress === 0
        if (val === 'Not Finished') return !p?.isFinished
        return true
      })
    default:
      return items
  }
}

// Common sorts first, the long tail grouped under "More".
export const SORT_COMMON = ['Date Added', 'Title', 'Author', 'Published Year', 'Duration'] as const
export const SORT_MORE = ['Author (Last, First)', 'Size', 'Progress', 'Random'] as const
export type LibrarySort = (typeof SORT_COMMON)[number] | (typeof SORT_MORE)[number]

// Format a duration in seconds as a human-readable string.
// 51409.5 -> "14h 17m", 1430 -> "23m 50s"
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// ABS stores book descriptions as HTML. Render them as plain text by stripping
// tags and decoding the few entities ABS commonly emits.
export function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|div|br)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Relative day + local clock label for a session timestamp (epoch ms).
// Returns { day: "Today"/"Yesterday"/weekday/short-date, time: "3:42 PM" }.
export function fmtSessDate(ms: number): { day: string; time: string } {
  const d = new Date(ms)
  const now = new Date()
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.round((day0.getTime() - that.getTime()) / 86400000)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  let day: string
  if (diff <= 0) day = 'Today'
  else if (diff === 1) day = 'Yesterday'
  else if (diff < 7) day = d.toLocaleDateString([], { weekday: 'long' })
  else day = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return { day, time }
}

// A stable cover hue for a book, used to typeset a fallback cover and drive the
// cover-glow when real artwork is missing or hasn't loaded. ABS gives no single
// cover color, so we derive a deterministic one from a seed (the item id): hash
// the seed and pick from the HearthShelf cover palette (warm-neutral duotones,
// never navy/muddy - matching the design system's --chart / cover hues).
//
// This is the ONE cover palette for every surface (DESIGN.shared.md, "The One
// Cover Palette Rule"): a book must be the same colour on web, mobile and in the
// car. Both the palette and the seed are part of that contract - seeding on the
// title instead of the item id, or picking from a surface-local tint list, gives
// the same book two different colours and breaks the connection between
// surfaces. Never fork this list.
const COVER_PALETTE = [
  '#356b78', // teal
  '#a8482b', // rust
  '#6f6a35', // olive
  '#46508c', // indigo
  '#7a3a56', // plum
  '#2f6b50', // pine
  '#8a6a2f', // amber
  '#5e4a8c', // violet
  '#2f5a6b', // slate-teal
  '#3f6b4a', // moss
] as const

export function coverHue(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return COVER_PALETTE[Math.abs(h) % COVER_PALETTE.length]
}

// First visible character of a title, for the oversized typeset-cover initial.
export function coverInitial(title: string): string {
  return (title || '?').trim().charAt(0).toUpperCase() || '?'
}

/**
 * A run of consecutive rows that share a heading.
 *
 * Named `{ title, data }` to match React Native's SectionList directly, so the
 * mobile side renders the result with no adaptation. A web list reads the same
 * two fields; only its JSX differs.
 */
export interface DayGroup<T> {
  title: string
  data: T[]
}

/**
 * Group already-sorted rows into consecutive runs by day label.
 *
 * Shared because all three clients group listening history the same way and were
 * otherwise carrying the same eight-line loop. Generic over the row type and
 * takes an accessor, because the clients disagree on field names (the hosted app
 * calls it `timeListeningSec`/`itemId`, self-hosted `timeListening`/
 * `libraryItemId`) - the grouping does not care.
 *
 * Rows are NOT sorted here: this walks the list in order and starts a new group
 * whenever the label changes, so a caller passing unsorted rows gets repeated
 * headings rather than a silent re-order. Callers pass newest-first.
 *
 * `label` defaults to fmtSessDate's relative day (Today/Yesterday/weekday/date);
 * pass your own to group by something else, e.g. month.
 */
export function groupByDay<T>(
  rows: T[],
  startedAtOf: (row: T) => number,
  label: (ms: number) => string = (ms) => fmtSessDate(ms).day,
): DayGroup<T>[] {
  const out: DayGroup<T>[] = []
  for (const row of rows) {
    const title = label(startedAtOf(row))
    const last = out[out.length - 1]
    if (last && last.title === title) last.data.push(row)
    else out.push({ title, data: [row] })
  }
  return out
}

/** Month + year heading for the finished-books view, e.g. "August 2026". */
export function fmtMonthLabel(ms: number): string {
  return new Date(ms).toLocaleDateString([], { month: 'long', year: 'numeric' })
}

// Clock-style timestamp for chapter offsets. 3725 -> "1:02:05", 125 -> "2:05"
export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

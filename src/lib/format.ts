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

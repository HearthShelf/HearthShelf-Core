// Bulk chapter-title editing for the book editor.
//
// Ripped audiobooks routinely arrive with the numbering off by the amount of
// front matter: "Intro" is 1, "Forward" is 2, so the real Chapter 1 is titled
// "Chapter 3". Fixing that by hand is dozens of edits, so the editor offers
// three bulk operations over a selected subset of rows. All of them are pure
// title rewrites - start/end times are never touched, so a bulk edit can never
// desync a chapter from its audio.
//
// Every operation takes the full row list plus the indices to act on and
// returns a new list, so the caller stages the result and the user previews it
// before saving.

/** The number token found inside a chapter title. */
export interface ParsedChapterNumber {
  /** The numeric value, e.g. 3 for "Chapter 03". */
  value: number
  /** The text before the number, e.g. 'Chapter ' for "Chapter 03: Dawn". */
  prefix: string
  /** The text after the number, e.g. ': Dawn' for "Chapter 03: Dawn". */
  suffix: string
  /** How many digits the number was written with, so 03 can stay zero-padded. */
  digits: number
}

// The first run of digits in the title. Deliberately the *first* run: a title
// like "Chapter 3: The 7 Gates" numbers on 3, not 7. Roman numerals and spelled
// numbers ("Chapter Three") are not detected - they round-trip untouched rather
// than being mangled by a guess.
const NUMBER_RE = /\d+/

/** Pull the number out of a chapter title, or null when it has none. */
export function parseChapterNumber(title: string): ParsedChapterNumber | null {
  const m = NUMBER_RE.exec(title)
  if (!m) return null
  const raw = m[0]
  return {
    value: Number(raw),
    prefix: title.slice(0, m.index),
    suffix: title.slice(m.index + raw.length),
    digits: raw.length,
  }
}

/** Render a number with at least `digits` characters, zero-padded. */
export function padNumber(value: number, digits: number): string {
  const s = String(Math.abs(Math.trunc(value)))
  const padded = s.length >= digits ? s : '0'.repeat(digits - s.length) + s
  return value < 0 ? '-' + padded : padded
}

// A separator sitting between the number and the name: ": ", " - ", ". ", or
// plain whitespace. Stripped so `Chapter {n}: {name}` composes without the
// user having to notice the old title's punctuation.
const LEADING_SEPARATOR_RE = /^[\s]*[:.–—-]?[\s]*/

// A half-chapter letter glued to the number: the "a" of "Chapter 220a". Part
// of the numbering, not the name, so stripping the number strips it too.
const HALF_CHAPTER_RE = /^[a-z](?=$|[\s:.–—-])/i

/**
 * The chapter's name with its number and the separator after it removed, so
 * "Chapter 220: The 19th Floor Boss" gives "The 19th Floor Boss".
 *
 * A title with no number is its own name - "Opening Credits" survives a
 * rewrite that reuses this. When stripping would leave nothing, as in a bare
 * "Chapter 12", the result is empty rather than the original: the caller asked
 * for the name, and that title has none.
 */
export function stripChapterNumber(title: string): string {
  const parsed = parseChapterNumber(title)
  if (!parsed) return title.trim()
  return parsed.suffix.replace(HALF_CHAPTER_RE, '').replace(LEADING_SEPARATOR_RE, '').trim()
}

/**
 * Expand a title pattern for one row.
 *
 * `{n}` is the sequence number and `{n:2}` pads it to two digits ("01"). `{t}`
 * is the row's whole existing title. `{name}` is that title with its old
 * number stripped, which is what renumbering a named chapter almost always
 * wants: `Chapter {n}: {name}` turns "Chapter 220: Dawn" into "Chapter 1: Dawn"
 * where `{t}` would have kept the stale 220.
 */
export function formatChapterTitle(pattern: string, n: number, existingTitle: string): string {
  return pattern.replace(/\{(n|t|name)(?::(\d+))?\}/g, (_all, token: string, width?: string) => {
    if (token === 't') return existingTitle
    if (token === 'name') return stripChapterNumber(existingTitle)
    return padNumber(n, width ? Number(width) : 1)
  })
}

/** Rewrite the selected rows to `pattern`, numbering them from `startAt`. */
export function renumberChapters<T extends { title: string }>(
  rows: readonly T[],
  selected: readonly number[],
  pattern: string,
  startAt: number,
): T[] {
  const order = [...new Set(selected)].sort((a, b) => a - b)
  const seq = new Map<number, number>()
  order.forEach((rowIndex, i) => seq.set(rowIndex, startAt + i))
  return rows.map((row, i) => {
    const n = seq.get(i)
    if (n === undefined) return row
    return { ...row, title: formatChapterTitle(pattern, n, row.title) }
  })
}

/** The lowest number a shift may produce. Chapter 0 is not a chapter. */
export const MIN_CHAPTER_NUMBER = 1

/**
 * How far `delta` may go down before some selected title would fall below
 * MIN_CHAPTER_NUMBER, or null when no selected row carries a number.
 *
 * The UI uses this to explain the limit instead of letting a shift half-apply.
 */
export function minShiftDelta(
  rows: readonly { title: string }[],
  selected: readonly number[],
): number | null {
  const set = new Set(selected)
  let lowest: number | null = null
  rows.forEach((row, i) => {
    if (!set.has(i)) return
    const parsed = parseChapterNumber(row.title)
    if (!parsed) return
    if (lowest === null || parsed.value < lowest) lowest = parsed.value
  })
  return lowest === null ? null : MIN_CHAPTER_NUMBER - lowest
}

/**
 * Shift the number already inside each selected title by `delta`, leaving the
 * surrounding text and zero-padding alone. Rows with no number are untouched.
 *
 * This is the surgical alternative to renumbering: it fixes "Chapter 3" ->
 * "Chapter 1" without discarding a subtitle the way a pattern would.
 *
 * All-or-nothing: if the shift would push any selected chapter below
 * MIN_CHAPTER_NUMBER the rows are returned unchanged, because half-applying it
 * silently leaves a book numbered part old and part new - far worse than
 * refusing and saying why.
 */
export interface ShiftOptions {
  /**
   * Drop zero-padding instead of keeping it, so "Chapter 007" becomes
   * "Chapter 8" rather than "Chapter 008". Off by default: padding that was
   * deliberate is usually wanted, and a rip that pads every chapter is only
   * sometimes wrong about it.
   */
  stripPadding?: boolean
}

export function shiftChapterNumbers<T extends { title: string }>(
  rows: readonly T[],
  selected: readonly number[],
  delta: number,
  opts: ShiftOptions = {},
): T[] {
  const floor = minShiftDelta(rows, selected)
  if (floor !== null && delta < floor) return rows as T[]
  const set = new Set(selected)
  return rows.map((row, i) => {
    if (!set.has(i)) return row
    const parsed = parseChapterNumber(row.title)
    if (!parsed) return row
    // Preserve zero-padding only where it was deliberate. "Chapter 007" stays
    // three wide, but "Chapter 220" shifted down is "Chapter 1", not
    // "Chapter 001" - the old width was the size of the number, not a format.
    const width = opts.stripPadding
      ? 1
      : parsed.digits > String(parsed.value).length
        ? parsed.digits
        : 1
    return {
      ...row,
      title: parsed.prefix + padNumber(parsed.value + delta, width) + parsed.suffix,
    }
  })
}

/**
 * Rewrite each selected title into `pattern`, reusing the number the title
 * already carries rather than a running sequence. Rows with no number keep
 * their title, so "Intro" survives a normalize pass over the whole book.
 */
export function normalizeChapterNumbers<T extends { title: string }>(
  rows: readonly T[],
  selected: readonly number[],
  pattern: string,
): T[] {
  const set = new Set(selected)
  return rows.map((row, i) => {
    if (!set.has(i)) return row
    const parsed = parseChapterNumber(row.title)
    if (!parsed) return row
    return { ...row, title: formatChapterTitle(pattern, parsed.value, row.title) }
  })
}

export interface ReplaceOptions {
  /** Treat `find` as a regular expression rather than literal text. */
  regex?: boolean
  /** Match case-sensitively. Defaults to insensitive, which is what a typo fix wants. */
  matchCase?: boolean
}

/** Escape a string so it matches literally inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build the RegExp for a find-and-replace, or null when `find` is empty or is
 * an invalid pattern the user is still typing. Exposed so the UI can show the
 * "not a valid pattern" state without duplicating the construction.
 */
export function buildReplaceRegExp(find: string, opts: ReplaceOptions = {}): RegExp | null {
  if (!find) return null
  const flags = opts.matchCase ? 'g' : 'gi'
  try {
    return new RegExp(opts.regex ? find : escapeRegExp(find), flags)
  } catch {
    return null
  }
}

/**
 * Find and replace across the selected titles. With `regex`, `replace` may use
 * `$1`-style backreferences. An invalid pattern is a no-op rather than a throw.
 */
export function replaceInChapterTitles<T extends { title: string }>(
  rows: readonly T[],
  selected: readonly number[],
  find: string,
  replace: string,
  opts: ReplaceOptions = {},
): T[] {
  const re = buildReplaceRegExp(find, opts)
  if (!re) return rows as T[]
  const set = new Set(selected)
  return rows.map((row, i) => {
    if (!set.has(i)) return row
    const title = row.title.replace(re, replace)
    return title === row.title ? row : { ...row, title }
  })
}

/** How many of the selected rows a find-and-replace would actually change. */
export function countReplaceMatches(
  rows: readonly { title: string }[],
  selected: readonly number[],
  find: string,
  replace: string,
  opts: ReplaceOptions = {},
): number {
  const re = buildReplaceRegExp(find, opts)
  if (!re) return 0
  const set = new Set(selected)
  let n = 0
  rows.forEach((row, i) => {
    if (!set.has(i)) return
    re.lastIndex = 0
    if (row.title.replace(re, replace) !== row.title) n += 1
  })
  return n
}

/**
 * The indices a shift-click range select covers, given the row clicked last
 * (the anchor) and the row clicked now.
 */
export function selectionRange(anchor: number, index: number): number[] {
  const lo = Math.min(anchor, index)
  const hi = Math.max(anchor, index)
  const out: number[] = []
  for (let i = lo; i <= hi; i += 1) out.push(i)
  return out
}

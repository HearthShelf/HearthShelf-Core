// Pure series-completeness logic shared by every HearthShelf surface (self-hosted
// web, hosted web app, mobile). ABS only knows the books you OWN in a series; the
// full series roster comes from Audible (GET /hs/audible/series). These helpers
// dedupe owned vs. Audible to find the "unowned" gap and fold it into a single
// completion figure so all three clients compute identically. No I/O, no client
// types - callers pass plain values.

import type { HSAudibleSeriesBook } from '../types/hs'

// Collapse punctuation/casing/whitespace so two spellings of the same words
// compare equal. Shared tail of every title normalization here.
function squash(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

// Strip a leading "<series name>:" / "<series name> -" prefix, keeping the part
// that actually names the book. Audible titles a series entry either way -
// "Viridian Gate Online: Doom Forge" or bare "Darkling Siege" - and ABS stores
// whichever the file's metadata carried, so the prefix has to come off both
// sides for them to meet. Returns '' when the title is nothing but the series
// name, which tells the caller there's no distinguishing text to match on.
function stripSeriesPrefix(title: string, series: string): string {
  const wantedSeries = squash(series)
  if (!wantedSeries) return title
  // The prefix often carries the volume number too - Audible titles the same
  // series both "Federation Marine: Recruit" and "Federation Marine 2:
  // Sergeant". Matching the series name alone left the numbered form unstripped,
  // and the subtitle-drop fallback in normalizeTitle then kept the PREFIX and
  // threw away the book name: "Federation Marine 2: Sergeant" -> "federation
  // marine 2" instead of "sergeant". Every numbered entry got a title no owned
  // copy could match, and because a sequence claim is refused when the titles
  // disagree, books the user owned were reported missing.
  const matchesSeries = (candidate: string) =>
    candidate === wantedSeries ||
    candidate.replace(/\s*(book|volume|vol|part|#)?\s*\d+(\.\d+)?$/, '').trim() === wantedSeries
  // Split on the separators a series prefix uses, longest prefix first, so
  // "A: B: C" can shed "A" and keep "B: C".
  const parts = title.split(/\s*[:–—-]\s+/)
  for (let i = parts.length - 1; i >= 1; i--) {
    if (matchesSeries(squash(parts.slice(0, i).join(' ')))) return parts.slice(i).join(': ')
  }
  return matchesSeries(squash(title)) ? '' : title
}

// Normalize a book title for cross-catalog matching. ABS and Audible format the
// same title differently (subtitles, ", Book 4" suffixes, punctuation, spacing),
// which used to make owned books look unowned. Strip a trailing series/volume
// suffix, drop everything after a colon (subtitle), remove punctuation, and
// collapse whitespace so "Taken to the Stars, Book 4" and "Taken to the Stars"
// compare equal.
//
// Pass `series` whenever the series is known. Dropping the subtitle is only safe
// when the title's HEAD is the distinguishing part; in a series whose books are
// all titled "<Series>: <Book Name>", the subtitle IS the book name and dropping
// it normalizes every entry to the same string - so every owned book matches
// every roster entry and the matcher hands out claims at random. With `series`
// supplied, the series prefix comes off first and the remainder is kept whole,
// so "Viridian Gate Online: Doom Forge" -> "doom forge" and matches Audible's
// bare "Doom Forge". A title that is ONLY the series name keeps its old
// behaviour (there's nothing else to match on).
export function normalizeTitle(
  title: string | null | undefined,
  series?: string | null | undefined,
): string {
  const raw = title ?? ''
  const stripped = series ? stripSeriesPrefix(raw, series) : raw
  const base = stripped || raw
  return squash(
    base
      .replace(/:\s.*$/, '') // drop subtitle after a colon
      .replace(/[,\-–—]?\s*(book|volume|vol|part|#)\s*\d+(\.\d+)?\s*$/i, ''), // trailing "Book 4"
  )
}

// Audible's placeholder date for an announced-but-unscheduled product. Real
// releases never carry it; the placeholder children of a series do.
const PLACEHOLDER_RELEASE_YEAR = '2200'

/** True when this roster entry is on the user's ignore list. ASIN casing varies
 *  across Audible responses, so match case-insensitively. */
export function isIgnoredRosterBook(
  book: Pick<HSAudibleSeriesBook, 'asin'>,
  ignoredAsins: readonly string[] | undefined,
): boolean {
  if (!ignoredAsins?.length || !book.asin) return false
  const want = String(book.asin).toLowerCase()
  return ignoredAsins.some((a) => String(a).toLowerCase() === want)
}

// An "announcement placeholder": Audible's stub for a book that exists but has
// no schedule yet. It carries the sentinel release date 2200-01-01 and has
// neither a narrator nor a runtime, because none of that was known when the
// book was announced. A real dated book, even a year out, has all three.
export function isPlaceholderBook(
  book: Pick<
    HSAudibleSeriesBook,
    'releaseDate' | 'publicationDatetime' | 'narrator' | 'durationMinutes'
  >,
): boolean {
  const rel = book.releaseDate ?? book.publicationDatetime ?? ''
  if (!rel.startsWith(PLACEHOLDER_RELEASE_YEAR)) return false
  return !book.narrator && !book.durationMinutes
}

// Audible lists some series books TWICE: the real product, plus the placeholder
// left over from when it was announced. Both are children of the series and
// share a sequence, so the series showed the same book twice - once properly,
// once as a coverless row with a mangled author ("Zogarth .").
//
// A placeholder is only dropped when a REAL product occupies the same sequence.
// Standing alone it is the only record of a genuinely upcoming book (announced,
// not yet scheduled), and dropping it erased that book from the series entirely
// - which is what happened to System Universe book 9.
export function isPhantomRosterBook(
  book: HSAudibleSeriesBook,
  books: readonly HSAudibleSeriesBook[],
): boolean {
  if (!isPlaceholderBook(book)) return false
  const slot = seqKey(book.sequence)
  if (!slot) return false
  return books.some((b) => b !== book && seqKey(b.sequence) === slot && !isPlaceholderBook(b))
}

// How much a roster entry tells us - the tiebreak when two editions of one book
// are both real products. Owned wins outright (it's the copy the user has), then
// the entry carrying the most metadata, since a re-issue usually lists a cover,
// narrator, and runtime while the delisted original has been stripped back.
function editionScore(b: HSAudibleSeriesBook): number {
  return (
    (b.owned ? 8 : 0) + (b.coverArtUrl ? 4 : 0) + (b.durationMinutes ? 2 : 0) + (b.narrator ? 1 : 0)
  )
}

// Collapse re-issues of the SAME book to one entry.
//
// A book that changed publisher is listed twice in a series, under two ASINs,
// usually with the author spelled differently each time ("James Hunter" vs
// "James A. Hunter"). Both are real products, so the placeholder rule above
// doesn't touch them, and the series then shows the same book twice - once
// per edition - which also inflates the "missing" count and the series total.
//
// Two entries are the same book when they share a sequence AND normalize to the
// same title. Requiring both keeps genuinely distinct books apart: a novella at
// 3.5 keeps its own slot, and an unsequenced side story is never folded into
// another (an entry with no parseable sequence is always left alone).
function dedupeEditions(books: readonly HSAudibleSeriesBook[], series?: string | null) {
  const best = new Map<string, HSAudibleSeriesBook>()
  for (const b of books) {
    const slot = seqKey(b.sequence)
    if (!slot) continue
    const key = `${slot}|${normalizeTitle(b.title, series)}`
    const cur = best.get(key)
    if (!cur || editionScore(b) > editionScore(cur)) best.set(key, b)
  }
  return (b: HSAudibleSeriesBook) => {
    const slot = seqKey(b.sequence)
    if (!slot) return true
    const key = `${slot}|${normalizeTitle(b.title, series)}`
    const winner = best.get(key)
    return !winner || winner === b
  }
}

// The roster as the user should actually see it: superseded placeholders gone,
// and anything they've explicitly ignored gone too. Every consumer of a series
// roster should read it through this.
//
// `ignoredAsins` are entries the user has said they'll never own - an ebook-only
// side story, a print edition, a box set. Audible lists them as series children,
// but counting them makes a series permanently incompletable. Matching is
// case-insensitive because ASIN casing varies across Audible responses.
//
// Re-issued editions of one book are collapsed to a single entry too
// (dedupeEditions).
export function realRosterBooks(
  books: readonly HSAudibleSeriesBook[],
  ignoredAsins?: readonly string[],
  series?: string | null,
): HSAudibleSeriesBook[] {
  const ignored = ignoredAsins?.length
    ? new Set(ignoredAsins.map((a) => String(a).toLowerCase()))
    : null
  const notIgnored = books.filter(
    (b) =>
      !isPhantomRosterBook(b, books) &&
      !(ignored && b.asin && ignored.has(String(b.asin).toLowerCase())),
  )
  return notIgnored.filter(dedupeEditions(notIgnored, series))
}

// A number key for a series sequence ("4", "2.5", "#4 ") -> "4"/"2.5", or '' when
// there's no parseable number. Used as the primary match signal: within one
// resolved series, same sequence == same book regardless of title/author text.
export function seqKey(sequence: string | number | null | undefined): string {
  if (sequence == null) return ''
  const n = parseFloat(String(sequence).replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? String(n) : ''
}

// Parse a book's sequence within a series from ABS's denormalized seriesName,
// e.g. "Taken to the Stars #4" -> "4", "Foundation #2.5" -> "2.5". '' when none.
// Clients build owned-book match info with this so every surface parses alike.
export function seriesSeqFromName(seriesName: string | null | undefined): string {
  const m = (seriesName ?? '').match(/#\s*([\d.]+)\s*$/)
  return m ? m[1] : ''
}

// An owned book, reduced to just what series-matching needs. `sequence` is the
// book's position in THIS series (parsed from ABS's denormalized seriesName,
// e.g. "Taken to the Stars #4" -> "4"); pass null/'' when unknown.
export interface OwnedSeriesBook {
  title: string | null | undefined
  sequence?: string | number | null
}

// One owned book, tracked so a roster entry can CONSUME it - that's what stops a
// single owned book from marking several roster entries owned.
interface Claimable {
  used: boolean
  title: string
}

function push(map: Map<string, Claimable[]>, key: string, entry: Claimable): void {
  if (!key) return
  const list = map.get(key)
  if (list) list.push(entry)
  else map.set(key, [entry])
}

// Consume the first unused owned book filed under `key` (that `accept` allows).
function claim(
  map: Map<string, Claimable[]>,
  key: string,
  accept?: (e: Claimable) => boolean,
): boolean {
  if (!key) return false
  const entry = map.get(key)?.find((e) => !e.used && (!accept || accept(e)))
  if (!entry) return false
  entry.used = true
  return true
}

// Server `owned` flags are a SNAPSHOT: they come from a roster the backend
// precomputes on a schedule, so a book added to the library since the last sweep
// is still flagged unowned - and the series page then shows it twice, once in
// reading order and once under "not in your library". The caller always knows
// better here, because `ownedBooks` is what ABS just returned for this series.
//
// So the flags still decide, with one correction: an owned book the flags don't
// account for clears a roster entry that carries its title. Owned books are
// consumed by the already-owned entries FIRST, so a book the server matched
// elsewhere in the roster can't also clear a genuinely missing entry (a second
// edition, or an omnibus whose normalized title collides with book 1's). The
// match is normalized title only - never sequence, the weak signal the server
// flags exist to overrule.
function unflagOwned(
  titled: readonly HSAudibleSeriesBook[],
  ownedBooks: readonly OwnedSeriesBook[],
  series?: string | null,
): HSAudibleSeriesBook[] {
  const byTitle = new Map<string, Claimable[]>()
  for (const b of ownedBooks) {
    const title = normalizeTitle(b.title, series)
    push(byTitle, title, { used: false, title })
  }
  for (const b of titled) {
    if (b.owned !== false) claim(byTitle, normalizeTitle(b.title, series))
  }
  const missing: HSAudibleSeriesBook[] = []
  for (const b of titled) {
    if (b.owned !== false) continue
    if (!claim(byTitle, normalizeTitle(b.title, series))) missing.push(b)
  }
  return missing
}

// Audible entries for a series that aren't among the owned books - the "unowned"
// books. When the server has stamped each roster book with an `owned` flag (the
// ASIN-accurate, library-wide precompute), that is authoritative, reconciled
// against `ownedBooks` only to clear books added since the flags were computed
// (see unflagOwned). Otherwise (older servers) it matches the roster against
// `ownedBooks` itself, mirroring the server's ranking: normalized title first
// (the stronger signal client-side, where owned books carry no ASIN), then
// series sequence as a last resort. Each owned book is CONSUMED by the first
// roster entry it matches, so one owned book can never mark several roster
// entries owned.
//
// Sequence is deliberately last, limited, and CONTRADICTABLE. As an unranked,
// unlimited match it hid genuinely missing books: one owned book that ABS
// mis-tagged "#4" made Audible's real book 4 read as owned, and an omnibus at
// sequence "1" claimed slot 1 while the books it contains stayed unowned. So a
// sequence claim only stands when the two titles don't actively disagree - when
// both sides have a real title and they differ, that's contradicted metadata,
// not a match. Ordered by numeric sequence.
export function missingSeriesBooks(
  audibleBooksRaw: readonly HSAudibleSeriesBook[],
  ownedBooks: readonly OwnedSeriesBook[],
  ignoredAsins?: readonly string[],
  // The series' name. Supplied, titles are matched on the part that DISTINGUISHES
  // the book rather than the shared "<Series>:" prefix - see normalizeTitle.
  series?: string | null,
): HSAudibleSeriesBook[] {
  // Drop Audible's phantom placeholders first: they duplicate a real product's
  // sequence, and being coverless and narrator-less they can never match an
  // owned book, so they'd always surface as spurious "missing" rows. Books the
  // user has ignored go with them - they are not a gap to be filled.
  const audibleBooks = realRosterBooks(audibleBooksRaw, ignoredAsins, series)

  const bySequence = (a: HSAudibleSeriesBook, b: HSAudibleSeriesBook) =>
    (parseFloat(a.sequence ?? '') || 0) - (parseFloat(b.sequence ?? '') || 0)

  const titled = audibleBooks.filter((b) => b.title)

  // Server-provided owned flags are authoritative when present on any book.
  if (audibleBooks.some((b) => typeof b.owned === 'boolean')) {
    return unflagOwned(titled, ownedBooks, series).sort(bySequence)
  }

  const byTitle = new Map<string, Claimable[]>()
  const bySeq = new Map<string, Claimable[]>()
  for (const b of ownedBooks) {
    const entry: Claimable = { used: false, title: normalizeTitle(b.title, series) }
    push(byTitle, entry.title, entry)
    push(bySeq, seqKey(b.sequence), entry)
  }

  // Strongest signal first across the whole roster, so a title match always wins
  // an owned book ahead of a mere same-slot sequence match.
  const owned = new Set<HSAudibleSeriesBook>()
  for (const b of titled) {
    if (claim(byTitle, normalizeTitle(b.title, series))) owned.add(b)
  }
  for (const b of titled) {
    if (owned.has(b)) continue
    const rosterTitle = normalizeTitle(b.title, series)
    // Only accept a same-slot owned book whose title doesn't contradict this one.
    const compatible = (e: Claimable) => !e.title || !rosterTitle || e.title === rosterTitle
    if (claim(bySeq, seqKey(b.sequence), compatible)) owned.add(b)
  }
  return titled.filter((b) => !owned.has(b)).sort(bySequence)
}

export interface SeriesCompletion {
  // Listening completion as a 0..1 fraction. Denominator is the FULL series
  // (owned + missing) when the Audible roster resolved, else owned-only.
  pct: number
  // Books the user owns in this series.
  ownedCount: number
  // Books in the series the user doesn't own (0 when unresolved).
  missingCount: number
  // ownedCount + missingCount - the full series size we measured against.
  totalCount: number
  // Whether missing books were factored into pct (i.e. the Audible roster
  // resolved and actually had entries beyond what's owned).
  countsMissing: boolean
}

// Fold owned listening progress and the unowned gap into one completion figure.
//
// `ownedProgressSum` is the sum of per-owned-book progress where a finished book
// counts as 1.0 and an in-progress book its 0..1 fraction (exactly what the
// series pages already accumulate). Missing books contribute 0 to the numerator
// but DO enlarge the denominator, so owning 3 of 4 and finishing all 3 reads 75%.
//
// When the series roster couldn't be resolved (missingCount 0, e.g. no Audible
// match or offline) this degrades to the classic owned-only percentage.
export function seriesCompletion(input: {
  ownedProgressSum: number
  ownedCount: number
  missingCount: number
}): SeriesCompletion {
  const { ownedProgressSum, ownedCount, missingCount } = input
  const totalCount = ownedCount + missingCount
  const pct = totalCount > 0 ? ownedProgressSum / totalCount : 0
  return {
    pct,
    ownedCount,
    missingCount,
    totalCount,
    countsMissing: missingCount > 0,
  }
}

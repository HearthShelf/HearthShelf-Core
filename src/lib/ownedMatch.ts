// Deciding whether an external (Audible) catalog hit is a book the listener
// already owns. Shared because every surface that offers a "Request" affordance
// has to answer it the same way, and four of them had each answered it
// differently.
//
// The bug this replaces, in two independent halves:
//
// 1. SCOPE. Mobile search and the self-hosted search page both built their owned
//    set from the ABS library search results for the SAME typed query. ABS's
//    /search is a substring match; Audible's absorbs typos. A query of
//    "Dungeon haueler carl" returned nothing from ABS and the right book from
//    Audible, so the owned set was EMPTY, nothing was filtered, and a book
//    sitting in the library was offered with a Request button that could only
//    fail. No key format fixes that - there was no owned row to compare against.
//    Ownership must be decided against the WHOLE library.
//
// 2. KEY. Every site keyed on an exact lowercased `title|author`, and the two
//    catalogs format the same book differently (a trailing ", Book 1",
//    punctuation, "J.K." vs "J. K."), so a book was reported unowned even on a
//    perfectly spelled query.
//
// ASIN first, because it is an identity rather than a guess. Normalized
// title+author second, for owned items whose metadata carries no ASIN.
//
// NOT to be used for qgPickKey (see questgiver.ts): that key is a PERSISTED
// identity - stored feedback is keyed on it across runs - so changing how it is
// derived would orphan existing records. Ownership comparison and durable
// identity are different jobs that happened to share a formula.
import type { ABSLibraryItem } from '../types/abs'

/** The minimum an owned book or a catalog hit has to offer to be matched. */
export interface OwnedBookLike {
  title?: string | null
  author?: string | null
  /** Audible ASIN, when the side in question knows one. */
  asin?: string | null
}

/** Owned-side lookup, built once per library rather than per keystroke. */
export interface OwnedIndex {
  /** Lowercased ASINs of owned items that have one. */
  asins: ReadonlySet<string>
  /** `ownedMatchKey` for every owned item. */
  titleAuthor: ReadonlySet<string>
}

/** Stand-in before the library has loaded, and the fallback when it cannot be
 *  read. Matching nothing is the safe direction: a book shows as requestable
 *  (the old behaviour) rather than being hidden from someone who does not own
 *  it and would have no other way to ask for it. */
export const EMPTY_OWNED_INDEX: OwnedIndex = { asins: new Set(), titleAuthor: new Set() }

/**
 * Normalize a book title for cross-catalog comparison.
 *
 * Deliberately NOT `normalizeTitle` from series.ts: that one also drops
 * everything after a colon, which is only safe when the series is known. Here it
 * is not - a catalog search hit carries no series - and in a series whose books
 * are all titled "<Series>: <Book Name>" the subtitle IS the book name, so
 * dropping it collapses every entry to the same string. Two different unowned
 * books would then match one owned copy and vanish from the requestable lane,
 * which is a worse failure than the one this file fixes: the listener would have
 * no way to ask for them at all.
 *
 * So: strip a trailing volume suffix, punctuation and casing, and keep the rest.
 * A genuine subtitle divergence simply fails to match, which leaves the Request
 * button showing - the status quo, not a regression.
 */
export function normalizeBookTitle(title: string | null | undefined): string {
  return fold(
    (title ?? '')
      .toLowerCase()
      // Trailing "Book 4" / ", Volume 2" / " #3". Runs before punctuation is
      // stripped because the separator is part of the match.
      .replace(/[,\-–—:]?\s*(book|volume|vol|part|#)\s*\d+(\.\d+)?\s*$/, ''),
  )
}

/**
 * Collapse an author credit so spelling variants of one name compare equal.
 *
 * Initials are the common divergence between ABS file metadata and Audible's
 * product data ("J.K. Rowling" vs "J. K. Rowling"), so once punctuation is off,
 * the spaces BETWEEN single letters come off too. Multi-letter words are
 * untouched, so "A Tale" keeps its space.
 *
 * Named apart from `normalizeAuthor` in portability.ts on purpose. That one
 * backs library-to-library migration matching, and its keys drive which source
 * item maps onto which target item - collapsing initials there would change
 * which books migration considers the same, which is not this change's business.
 * This one folds initials; that one does not. The diacritic folding below is
 * borrowed from it.
 */
export function normalizeAuthorCredit(author: string | null | undefined): string {
  return fold(author ?? '').replace(/\b(\p{L})\s+(?=\p{L}\b)/gu, '$1')
}

/** Lowercase, strip accents, drop punctuation, collapse whitespace. Accent
 *  folding matters because Audible and ABS disagree about them ("Les
 *  Misérables" vs "Les Miserables"); NFD splits a letter from its combining
 *  marks so the marks can be removed on their own. */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The normalized `title|author` ownership key. Not a durable identity - it
 *  changes whenever the normalizers improve, so never persist it. */
export function ownedMatchKey(
  title: string | null | undefined,
  author: string | null | undefined,
): string {
  return normalizeBookTitle(title) + '|' + normalizeAuthorCredit(author)
}

/** Build the owned-side lookup. */
export function buildOwnedIndex(books: Iterable<OwnedBookLike>): OwnedIndex {
  const asins = new Set<string>()
  const titleAuthor = new Set<string>()
  for (const book of books) {
    const asin = (book.asin ?? '').trim().toLowerCase()
    if (asin) asins.add(asin)
    const key = ownedMatchKey(book.title, book.author)
    // '|' means neither side normalized to anything; an empty key would match
    // every untitled catalog hit.
    if (key !== '|') titleAuthor.add(key)
  }
  return { asins, titleAuthor }
}

/** Build the owned-side lookup straight from an ABS library read. Pass the whole
 *  library, not one query's hits - that scope is half the bug. */
export function ownedIndexFromLibraryItems(items: readonly ABSLibraryItem[]): OwnedIndex {
  return buildOwnedIndex(
    items.map((item) => {
      const metadata = item.media?.metadata
      return {
        title: metadata?.title,
        author: metadata?.authorName,
        asin: metadata?.asin,
      }
    }),
  )
}

/** True when this catalog hit is a book the library already has. */
export function isOwnedExternalResult(index: OwnedIndex, candidate: OwnedBookLike): boolean {
  const asin = (candidate.asin ?? '').trim().toLowerCase()
  if (asin && index.asins.has(asin)) return true
  const key = ownedMatchKey(candidate.title, candidate.author)
  if (key === '|') return false
  return index.titleAuthor.has(key)
}

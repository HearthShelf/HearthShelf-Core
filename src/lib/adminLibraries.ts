// Library edit logic for the server admin area.
import type { ABSLibrary, ABSLibrarySettings } from '../types/abs.ts'
import type { LibraryFolderInput, LibraryUpdatePayload } from '../types/admin.ts'

/** ABS's library icon names. HearthShelf can't render ABS's icon font, so each name
 *  maps to a Material Symbol for display, but `value` is what round-trips on save so
 *  it stays meaningful to native ABS clients. */
export const LIBRARY_ICON_OPTIONS: readonly { value: string; symbol: string; label: string }[] = [
  { value: 'database', symbol: 'database', label: 'Database' },
  { value: 'audiobookshelf', symbol: 'menu_book', label: 'Audiobookshelf' },
  { value: 'books-1', symbol: 'auto_stories', label: 'Books 1' },
  { value: 'books-2', symbol: 'library_books', label: 'Books 2' },
  { value: 'book-1', symbol: 'book', label: 'Book' },
  { value: 'microphone-1', symbol: 'mic', label: 'Microphone 1' },
  { value: 'microphone-3', symbol: 'podcasts', label: 'Microphone 3' },
  { value: 'radio', symbol: 'radio', label: 'Radio' },
  { value: 'podcast', symbol: 'podcasts', label: 'Podcast' },
  { value: 'rss', symbol: 'rss_feed', label: 'RSS' },
  { value: 'headphones', symbol: 'headphones', label: 'Headphones' },
  { value: 'music', symbol: 'music_note', label: 'Music' },
  { value: 'file-picture', symbol: 'image', label: 'Picture' },
  { value: 'rocket', symbol: 'rocket_launch', label: 'Rocket' },
  { value: 'power', symbol: 'bolt', label: 'Power' },
  { value: 'star', symbol: 'star', label: 'Star' },
  { value: 'heart', symbol: 'favorite', label: 'Heart' },
]

/** Podcast search regions ABS supports (a subset matching its dropdown). */
export const PODCAST_REGIONS: readonly string[] = [
  'us',
  'ca',
  'uk',
  'au',
  'de',
  'fr',
  'es',
  'it',
  'jp',
]

/** Metadata precedence sources in ABS's default order, labelled as its scanner tab. */
export const METADATA_SOURCES: readonly { id: string; name: string }[] = [
  { id: 'folderStructure', name: 'Folder structure' },
  { id: 'audioMetatags', name: 'Audio file meta tags OR ebook metadata' },
  { id: 'nfoFile', name: 'NFO file' },
  { id: 'txtFiles', name: 'desc.txt & reader.txt files' },
  { id: 'opfFile', name: 'OPF file' },
  { id: 'absMetadata', name: 'Audiobookshelf metadata file' },
]

export const DEFAULT_METADATA_PRECEDENCE: readonly string[] = METADATA_SOURCES.map((s) => s.id)

/** One editable settings shape for a form, mapped to the ABS payload on save.
 *  markAsFinishedWhen and markAsFinishedValue collapse ABS's two mutually exclusive
 *  fields into one control. */
export interface LibraryDraftSettings {
  squareCovers: boolean
  enableWatcher: boolean
  skipAsin: boolean
  skipIsbn: boolean
  audiobooksOnly: boolean
  epubsScripted: boolean
  hideSingleBookSeries: boolean
  onlyLaterBooks: boolean
  podcastSearchRegion: string
  markAsFinishedWhen: 'timeRemaining' | 'percentComplete'
  markAsFinishedValue: string
  autoScanCron: string | null
  metadataPrecedence: string[]
}

export function settingsFromLibrary(s: ABSLibrarySettings): LibraryDraftSettings {
  const timeRemaining = s.markAsFinishedTimeRemaining
  const percent = s.markAsFinishedPercentComplete
  const when: 'timeRemaining' | 'percentComplete' =
    percent != null && !timeRemaining ? 'percentComplete' : 'timeRemaining'
  return {
    squareCovers: s.coverAspectRatio === 1,
    enableWatcher: !s.disableWatcher,
    skipAsin: !!s.skipMatchingMediaWithAsin,
    skipIsbn: !!s.skipMatchingMediaWithIsbn,
    audiobooksOnly: !!s.audiobooksOnly,
    epubsScripted: !!s.epubsAllowScriptedContent,
    hideSingleBookSeries: !!s.hideSingleBookSeries,
    onlyLaterBooks: !!s.onlyShowLaterBooksInContinueSeries,
    podcastSearchRegion: s.podcastSearchRegion || 'us',
    markAsFinishedWhen: when,
    markAsFinishedValue: String((when === 'timeRemaining' ? timeRemaining : percent) ?? 10),
    autoScanCron: s.autoScanCronExpression ?? null,
    metadataPrecedence:
      s.metadataPrecedence && s.metadataPrecedence.length
        ? [...s.metadataPrecedence]
        : [...DEFAULT_METADATA_PRECEDENCE],
  }
}

/** Only the settings the draft actually changes. */
export function librarySettingsChanges(
  current: ABSLibrarySettings,
  draft: LibraryDraftSettings,
  isBook: boolean,
): Partial<ABSLibrarySettings> {
  const timeRemaining =
    draft.markAsFinishedWhen === 'timeRemaining' ? Number(draft.markAsFinishedValue) : null
  const percentComplete =
    draft.markAsFinishedWhen === 'percentComplete' ? Number(draft.markAsFinishedValue) : null
  const next: Partial<ABSLibrarySettings> = {
    coverAspectRatio: draft.squareCovers ? 1 : 0,
    disableWatcher: !draft.enableWatcher,
    autoScanCronExpression: draft.autoScanCron,
    markAsFinishedTimeRemaining: timeRemaining,
    markAsFinishedPercentComplete: percentComplete,
  }
  if (isBook) {
    next.skipMatchingMediaWithAsin = draft.skipAsin
    next.skipMatchingMediaWithIsbn = draft.skipIsbn
    next.audiobooksOnly = draft.audiobooksOnly
    next.epubsAllowScriptedContent = draft.epubsScripted
    next.hideSingleBookSeries = draft.hideSingleBookSeries
    next.onlyShowLaterBooksInContinueSeries = draft.onlyLaterBooks
    next.metadataPrecedence = draft.metadataPrecedence
  } else {
    next.podcastSearchRegion = draft.podcastSearchRegion
  }

  const changed: Record<string, unknown> = {}
  const before = current as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(next)) {
    const prev = before[k]
    const differs = Array.isArray(v) ? JSON.stringify(v) !== JSON.stringify(prev) : v !== prev
    if (differs) changed[k] = v
  }
  return changed as Partial<ABSLibrarySettings>
}

/** Everything a library edit form holds. */
export interface LibraryEditDraft {
  name: string
  provider: string
  icon: string
  folders: LibraryFolderInput[]
  settings: LibraryDraftSettings
}

/** The PATCH for a library edit: only what changed. Folders go as a whole list, and
 *  only when their paths or order changed, because ABS removes any folder left out. */
export function libraryUpdatePatch(
  library: ABSLibrary,
  draft: LibraryEditDraft,
): LibraryUpdatePayload {
  const patch: LibraryUpdatePayload = {}
  const name = draft.name.trim()
  if (name && name !== library.name) patch.name = name
  if (draft.provider !== library.provider) patch.provider = draft.provider
  if (draft.icon !== library.icon) patch.icon = draft.icon

  const beforeKey = library.folders.map((f) => f.fullPath).join(',')
  const afterKey = draft.folders.map((f) => f.fullPath).join(',')
  if (beforeKey !== afterKey) {
    patch.folders = draft.folders.map((f) =>
      f.id ? { id: f.id, fullPath: f.fullPath } : { fullPath: f.fullPath },
    )
  }

  const settings = librarySettingsChanges(
    library.settings,
    draft.settings,
    library.mediaType === 'book',
  )
  if (Object.keys(settings).length) patch.settings = settings
  return patch
}

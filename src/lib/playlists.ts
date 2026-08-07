// Playlist item resolution, shared by all three clients.
//
// ABS's Playlist.toOldJSONExpanded() (server/models/Playlist.js:347) emits TWO
// different item shapes:
//
//   book:    { libraryItemId, libraryItem }                     libraryItem EXPANDED
//   episode: { libraryItemId, libraryItem, episodeId, episode } libraryItem MINIFIED
//
// Three consequences, and every client got at least one of them wrong:
//
//   1. `episode` is the discriminator, NOT `episodeId != null`. Both keys are
//      absent on a book entry rather than null.
//   2. An episode row's title and duration come from `episode`. The sibling
//      `libraryItem` is the PODCAST, so reading the title off it shows the
//      show's name instead of the episode's - the bug the web apps shipped.
//   3. `libraryItem` is minified on episode entries, so anything a book row
//      reads off the expanded shape may simply be missing.
//
// ABS's own client branches exactly this way
// (client/components/tables/playlist/ItemTableRow.vue:100).

import type { ABSPlaylistItem } from '../types/abs.ts'

/** A playlist entry reduced to what any client needs to render one row. */
export interface ResolvedPlaylistEntry {
  isEpisode: boolean
  title: string
  /** The author for a book; the containing podcast's name for an episode. */
  source: string
  /** Duration in seconds. 0 when ABS gives none. */
  seconds: number
  /** Artwork is always the library item's - an episode has none of its own. */
  libraryItemId: string
  /** Present only for episode entries; needed to remove the right one. */
  episodeId?: string
}

export function resolvePlaylistEntry(item: ABSPlaylistItem): ResolvedPlaylistEntry {
  const libraryItem = item.libraryItem
  if (item.episode) {
    return {
      isEpisode: true,
      title: item.episode.title || 'Untitled episode',
      source: libraryItem?.media?.metadata?.title ?? 'Podcast',
      seconds: item.episode.duration ?? 0,
      libraryItemId: item.libraryItemId,
      episodeId: item.episodeId,
    }
  }
  return {
    isEpisode: false,
    title: libraryItem?.media?.metadata?.title ?? 'Untitled',
    source: libraryItem?.media?.metadata?.authorName ?? '',
    seconds: libraryItem?.media?.duration ?? 0,
    libraryItemId: item.libraryItemId,
  }
}

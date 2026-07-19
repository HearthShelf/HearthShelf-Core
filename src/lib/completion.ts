// When is an audiobook "done"?
//
// ABS's own rule (server/models/MediaProgress.js) is a single flat threshold:
// finished when `duration - currentTime < markAsFinishedTimeRemaining` (default
// 10s), or when `progress > markAsFinishedPercentComplete` if that's set. That
// works for a movie. It does not work for an audiobook, because audiobooks end
// in credits, outros, "here's a preview of book five" - stretches nobody
// listens to and everybody stops during. A flat 10s buffer leaves the book
// sitting at "100% - 0 chapters left - 36s remaining" forever.
//
// Plex exposes one knob for this ("Video played threshold 90%"). We can do
// better than a bare percentage because we know the chapter layout: a listener
// who reaches the last chapter and that chapter is a 40-second end-credits
// stinger is done, and a listener who stops 2 seconds from the end of the real
// final chapter is also done - even though a percentage alone would call the
// first one 98% and the second one 91% and get at least one of them wrong.
//
// So this resolves in priority order, most-specific signal first:
//
//   1. Real end of audio          - playback actually ended. Always finished.
//   2. Inside the tail buffer     - within `timeRemainingSec` of the end (the
//                                   ABS rule, kept so our answer never
//                                   contradicts the server's).
//   3. Trailing throwaway chapter - the position is at/into a run of short
//                                   trailing chapters (each <=
//                                   `creditsChapterMaxSec`). Credits, outros,
//                                   next-book previews.
//   4. End of the last real chapter - within `chapterEndGraceSec` of the end of
//                                   the last non-throwaway chapter. This is the
//                                   "stopped 2 seconds early" case.
//   5. Percent floor              - progress >= `percentComplete`, if set. The
//                                   Plex-style catch-all for books with no
//                                   chapter data at all.
//
// Every rule is a floor, never a ceiling: this only ever concludes "finished."
// It never un-finishes a book, and a book below every threshold simply isn't
// done yet. Pure - no clock, no I/O - so both clients and the server can call it
// and agree.

/** Minimal chapter shape - matches ABSChapter without depending on it. */
export interface CompletionChapter {
  start: number
  end: number
}

export interface CompletionThresholds {
  /** Finished when this many seconds or fewer remain. ABS's rule; default 10. */
  timeRemainingSec: number
  /**
   * A trailing chapter this short or shorter is treated as credits/outro rather
   * than content - reaching it means the book is done. Default 60s (the
   * "end credits are less than a minute" case).
   */
  creditsChapterMaxSec: number
  /**
   * Stopping this close to the end of the last real chapter counts as finishing
   * it. Covers "paused 2 seconds from the end". Default 15s.
   */
  chapterEndGraceSec: number
  /**
   * Plex-style percentage floor (0-1), used when chapter data can't answer.
   * Null disables it. Default null - the chapter rules are better, and a blind
   * percentage on a 30-hour book is 18 minutes of slack.
   */
  percentComplete: number | null
}

export const DEFAULT_COMPLETION_THRESHOLDS: CompletionThresholds = {
  timeRemainingSec: 10,
  creditsChapterMaxSec: 60,
  chapterEndGraceSec: 15,
  percentComplete: null,
}

/** Why a book was considered finished - for logging and UI copy. */
export type CompletionReason =
  | 'ended'
  | 'time-remaining'
  | 'credits-chapter'
  | 'last-chapter-end'
  | 'percent'

export interface CompletionInput {
  currentTime: number
  duration: number
  /** Book chapters in order. Empty/absent is fine - chapter rules just skip. */
  chapters?: CompletionChapter[]
  /** True when the audio element actually reached the end of the stream. */
  ended?: boolean
  thresholds?: Partial<CompletionThresholds>
}

export interface CompletionResult {
  isFinished: boolean
  reason: CompletionReason | null
  /**
   * The position to report to ABS. When finished this is `duration`, so ABS's
   * own `timeRemaining` check agrees with ours no matter how its library
   * settings are configured; otherwise it's the real position.
   */
  reportedTime: number
}

/**
 * Find where the trailing run of short "throwaway" chapters begins.
 *
 * Walks backward from the last chapter while each one is <= maxSec, so a book
 * ending in [.. "Chapter 40", "Epilogue" (22s), "Credits" (38s)] treats both
 * trailing shorts as throwaway. Returns the start time of the earliest such
 * chapter, or null when the last chapter is real content.
 *
 * Guards against a book made entirely of short chapters (some collections of
 * very short stories): if every chapter would qualify, none do.
 */
function trailingThrowawayStart(chapters: CompletionChapter[], maxSec: number): number | null {
  let i = chapters.length - 1
  while (i >= 0 && chapters[i].end - chapters[i].start <= maxSec) i--
  // i now points at the last real chapter (-1 if there wasn't one).
  if (i < 0) return null // all chapters short - don't treat any as credits
  if (i === chapters.length - 1) return null // last chapter is real content
  return chapters[i + 1].start
}

/**
 * Decide whether a book counts as finished. See the file header for the rule
 * order and why chapter-aware beats a flat percentage.
 */
export function evaluateCompletion(input: CompletionInput): CompletionResult {
  const t = { ...DEFAULT_COMPLETION_THRESHOLDS, ...input.thresholds }
  const { currentTime, duration, chapters = [], ended = false } = input

  const finished = (reason: CompletionReason): CompletionResult => ({
    isFinished: true,
    reason,
    reportedTime: duration,
  })

  // 1. Playback actually reached the end. Unambiguous.
  if (ended) return finished('ended')

  // Nothing below can be judged without a real duration.
  if (!Number.isFinite(duration) || duration <= 0) {
    return { isFinished: false, reason: null, reportedTime: currentTime }
  }

  // 2. ABS's own tail buffer.
  if (duration - currentTime <= t.timeRemainingSec) return finished('time-remaining')

  if (chapters.length > 0) {
    const throwawayStart = trailingThrowawayStart(chapters, t.creditsChapterMaxSec)

    // 3. Reached the trailing credits/outro run - the content is over.
    if (throwawayStart !== null && currentTime >= throwawayStart) {
      return finished('credits-chapter')
    }

    // 4. Within the grace window of the end of the last real chapter. This is
    //    the "stopped 2 seconds early" case, and it's why we don't need to
    //    trust a percentage to catch it.
    const lastRealEnd = throwawayStart ?? chapters[chapters.length - 1].end
    if (currentTime >= lastRealEnd - t.chapterEndGraceSec) {
      return finished('last-chapter-end')
    }
  }

  // 5. Plex-style percentage floor, for books with no usable chapter data.
  if (t.percentComplete != null && t.percentComplete > 0) {
    if (currentTime / duration >= t.percentComplete) return finished('percent')
  }

  return { isFinished: false, reason: null, reportedTime: currentTime }
}

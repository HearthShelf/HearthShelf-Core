// Shared ebook-reader model: display preferences + pure helpers used by every
// HearthShelf reader surface (self-hosted SPA, hosted SPA, mobile). No React,
// no DOM, no zustand - each client binds these to its own store and renderer
// (epub.js in a browser, @epubjs-react-native on the phone).
//
// Reader prefs are client-only and never sync to ABS: the reader is a
// HearthShelf feature the server knows nothing about. Reading POSITION, by
// contrast, is per-item and worth persisting locally as a CFI (see cfiStorageKey).

export type ReaderTheme = 'dark' | 'sepia' | 'light' | 'paper'
export type ReaderFont = 'serif' | 'sans' | 'dyslexic'
export type ReaderWidth = 'narrow' | 'medium' | 'wide'
export type ReaderLh = 'compact' | 'normal' | 'relaxed'
export type ReaderAlign = 'left' | 'justify'
export type ReaderLayout = 'scroll' | 'paged'

export interface ReaderThemeTokens {
  bg: string
  ink: string
  faint: string
  line: string
  fill: string
  surface: string
}

export const READER_THEMES: Record<ReaderTheme, ReaderThemeTokens> = {
  dark: {
    bg: '#1b1a18',
    ink: '#e9e3d7',
    faint: '#8c8478',
    line: 'rgba(255,255,255,0.10)',
    fill: 'rgba(255,255,255,0.06)',
    surface: '#2a2825',
  },
  sepia: {
    bg: '#f1e6d1',
    ink: '#473b2c',
    faint: '#9a8a6e',
    line: 'rgba(70,50,20,0.16)',
    fill: 'rgba(70,50,20,0.06)',
    surface: '#f7eedc',
  },
  light: {
    bg: '#faf8f4',
    ink: '#26221d',
    faint: '#8a8278',
    line: 'rgba(0,0,0,0.10)',
    fill: 'rgba(0,0,0,0.05)',
    surface: '#ffffff',
  },
  paper: {
    bg: '#e7e0d2',
    ink: '#322d25',
    faint: '#8a7f6c',
    line: 'rgba(40,30,15,0.14)',
    fill: 'rgba(40,30,15,0.05)',
    surface: '#efe9dd',
  },
}

// CSS font stacks for the web readers. `var(--font)` resolves to the app's base
// UI font. Mobile substitutes its own family names for these keys.
export const READER_FONT_STACKS: Record<ReaderFont, string> = {
  serif: '"Libre Baskerville", Georgia, serif',
  sans: 'var(--font)',
  dyslexic: '"OpenDyslexic", "Comic Sans MS", var(--font)',
}

export const READER_WIDTHS: Record<ReaderWidth, number> = {
  narrow: 540,
  medium: 660,
  wide: 820,
}

export const READER_LINE_HEIGHTS: Record<ReaderLh, number> = {
  compact: 1.5,
  normal: 1.78,
  relaxed: 2.06,
}

export const READER_SIZE_MIN = 15
export const READER_SIZE_MAX = 26

export const READER_BRIGHTNESS_MIN = 35
export const READER_BRIGHTNESS_MAX = 100

export interface ReaderPrefs {
  theme: ReaderTheme
  font: ReaderFont
  size: number
  lh: ReaderLh
  width: ReaderWidth
  align: ReaderAlign
  brightness: number // READER_BRIGHTNESS_MIN..READER_BRIGHTNESS_MAX
  layout: ReaderLayout
}

export const READER_DEFAULTS: ReaderPrefs = {
  theme: 'sepia',
  font: 'serif',
  size: 19,
  lh: 'normal',
  width: 'medium',
  align: 'left',
  brightness: READER_BRIGHTNESS_MAX,
  layout: 'scroll',
}

// localStorage / async-storage key for an item's saved reading position (CFI).
export const cfiStorageKey = (libraryItemId: string) => `hs-reader-cfi-${libraryItemId}`

// The dim overlay opacity for a given brightness. Full brightness = no dim;
// lower brightness darkens toward (but never fully to) black.
export function readerDimOpacity(brightness: number): number {
  return Math.max(0, (READER_BRIGHTNESS_MAX - brightness) / 100) * 0.72
}

// Clamp an audio elapsed fraction to [0,1] - the anchor for "jump to where the
// audio is" (the reader maps this percentage through the book to a CFI). No
// per-word sync exists; elapsed fraction is the best cross-medium anchor.
export function audioAnchorFraction(currentSec: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0
  return Math.min(1, Math.max(0, currentSec / durationSec))
}

// @hearthshelf/core - shared types + pure logic for all HearthShelf surfaces.
//
// Ships TypeScript source (no build step); each consumer's bundler (Vite / Metro)
// compiles it via a `@hearthshelf/core` path alias. No React, no DOM, no Node
// APIs - so it works identically in web and React Native.

export * from './types'
export * from './lib/format'
export * from './lib/letterBucket'
export * from './lib/libraryFilters'

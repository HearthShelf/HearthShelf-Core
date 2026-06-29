# @hearthshelf/core

Shared **types** and **pure logic** for every HearthShelf surface - the
self-hosted web SPA (`HearthShelf`), the hosted front door (`HearthShelf-WebApp`),
and the mobile app (`HearthShelf-Mobile`).

The point: ABS response shapes and common helpers live in **one place**, so an
ABS change or a small refactor is a one-file edit, not a three-repo hunt.

## What's in here

- `src/types/abs.ts` - the canonical AudiobookShelf response shapes (the single
  source of truth; each app previously kept its own drifting copy/subset).
- `src/lib/format.ts` - timestamp / duration / html-strip helpers.
- `src/lib/letterBucket.ts` - A-Z bucketing for jump bars.
- `src/lib/libraryFilters.ts` - library filter encoding/matching.

## How it's consumed (no build, no publish)

This package ships **TypeScript source** and is included in each app as a **git
submodule** at `packages/core`, imported via a `@hearthshelf/core` path alias.
Each app's own bundler (Vite for web, Metro for mobile) compiles it. So:

- **No build step** in this repo, **no npm publish**, no version bumps.
- Edit a type here, commit, and the consuming app sees it immediately.
- Works identically in web and React Native (no React, no DOM, no Node APIs -
  enforced by `tsconfig` having no `DOM` lib).

### In a consumer repo

```bash
git submodule add https://github.com/HearthShelf/HearthShelf-Core.git packages/core
```

Then add the alias (tsconfig `paths` + bundler resolver) and import:

```ts
import type { ABSLibraryItem } from '@hearthshelf/core'
import { formatDuration } from '@hearthshelf/core'
```

After pulling changes that bump the submodule pointer:

```bash
git submodule update --remote packages/core   # or: npm run sync-core
```

## Rules for this package

- **No React, no DOM, no Node APIs.** Types, pure functions, and constants only.
  `tsconfig` omits the `DOM` lib on purpose - DOM-dependent code won't compile.
- If something needs `window`, `fetch`, a Zustand store, or a React hook, it does
  NOT belong here - it's app-specific.

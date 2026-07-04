# @hearthshelf/core

[![Website](https://img.shields.io/badge/site-hearthshelf.com-2c6e6b)](https://hearthshelf.com)
[![Docs](https://img.shields.io/badge/docs-docs.hearthshelf.com-2c6e6b)](https://docs.hearthshelf.com)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

Shared **types** and **pure logic** for every HearthShelf surface - the
self-hosted web SPA ([`HearthShelf`](https://github.com/HearthShelf/HearthShelf)),
the hosted front door ([`HearthShelf-WebApp`](https://github.com/HearthShelf/HearthShelf-WebApp)),
and the mobile app ([`HearthShelf-Mobile`](https://github.com/HearthShelf/HearthShelf-Mobile)).
All three consume this repo as a git submodule at `packages/core`.

The point: ABS response shapes and common helpers live in **one place**, so an
ABS change or a small refactor is a one-file edit, not a three-repo hunt.

## What's in here

- `src/types/abs.ts` - the canonical AudiobookShelf response shapes (the single
  source of truth; each app previously kept its own drifting copy/subset).
- `src/types/hs.ts` - the canonical **HearthShelf-native** `/hs/*` request/response
  shapes (QuestGiver, Discover, finished-books, integrations, Audible, RMAB,
  runtime, telemetry, hosted setup, ...). Same rule: no consumer hand-rolls these.
- `docs/architecture.md` - **read this first.** How the repos fit together and
  who talks to whom: every client has one connection (to a HearthShelf host),
  which multiplexes ABS (`/abs-api/*`) and HearthShelf-native (`/hs/*`) surfaces.
  Explains where an endpoint/type belongs.
- `src/lib/absEndpoints.ts` - machine-readable endpoint paths: `ABS_ENDPOINTS`
  (ABS routes) and `HS_ENDPOINTS` (HearthShelf `/hs/*` routes), plus socket event
  names and the offline-sync rule flags (`ABS_OFFLINE_SYNC_RULES`). Import these
  instead of hardcoding paths; apps prepend their own transport prefix.
- `docs/abs-api-reference.md` - the **full ABS API map**: every route with its
  params, response shape, auth gate, emitted socket events, and the
  offline-sync conflict rules. Cross-repo reference (visible in every consumer at
  `packages/core/docs/`). Read it before touching progress/session code.
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

## Wiring (all three consumers are wired)

`HearthShelf`, `HearthShelf-WebApp`, and `HearthShelf-Mobile` each consume this
repo as a `packages/core` submodule, aliased to `@hearthshelf/core` via their
`tsconfig` `paths` plus a bundler resolver (Vite `resolve.alias` on the web repos,
Expo `experiments.tsconfigPaths` on mobile). Each app runs `npm run sync-core`
(`git submodule update --remote packages/core`) to pull the latest core.

To bootstrap a **new** consumer:

1. **Add the submodule:**
   ```bash
   git submodule add https://github.com/HearthShelf/HearthShelf-Core.git packages/core
   ```

2. **Add the path alias** in `tsconfig.json`:
   ```jsonc
   "paths": {
     "@/*": ["./src/*"],
     "@hearthshelf/core": ["./packages/core/src/index.ts"],
     "@hearthshelf/core/*": ["./packages/core/src/*"]
   }
   ```

3. **Teach the bundler the alias.** For a Vite app, add to `vite.config.ts`:
   ```ts
   resolve: { alias: { '@hearthshelf/core': path.resolve(__dirname, 'packages/core/src') } }
   ```
   (Expo apps use `experiments.tsconfigPaths` instead, so no bundler change.)

4. **Add the sync script** to `package.json`:
   ```json
   "sync-core": "git submodule update --remote packages/core"
   ```

### Cloning a wired repo

```bash
git clone --recursive https://github.com/HearthShelf/<repo>.git
# or, if already cloned:
git submodule update --init --recursive
```

## Rules for this package

- **No React, no DOM, no Node APIs.** Types, pure functions, and constants only.
  `tsconfig` omits the `DOM` lib on purpose - DOM-dependent code won't compile.
- If something needs `window`, `fetch`, a Zustand store, or a React hook, it does
  NOT belong here - it's app-specific.

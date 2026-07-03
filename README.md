# @hearthshelf/core

Shared **types** and **pure logic** for every HearthShelf surface - the
self-hosted web SPA (`HearthShelf`), the hosted front door (`HearthShelf-WebApp`),
and the mobile app (`HearthShelf-Mobile`).

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

## Wiring recipe (for the remaining repos)

`HearthShelf-Mobile` is already wired (reference implementation). To wire the two
web repos (`HearthShelf`, `HearthShelf-WebApp`):

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

3. **Teach the bundler the alias.** These are Vite apps, so add to `vite.config.ts`:
   ```ts
   resolve: { alias: { '@hearthshelf/core': path.resolve(__dirname, 'packages/core/src') } }
   ```
   (Mobile used Expo's `experiments.tsconfigPaths`, so no bundler change there.)

4. **Repoint imports + delete the duplicates:**
   - **HearthShelf** (the canonical source): its `src/api/types.ts` IS what core
     was copied from. Either replace its body with `export * from '@hearthshelf/core'`
     (keeps `@/api/types` importers working), or repoint importers to core and
     delete it. Same for
     `src/lib/{format,letterBucket,libraryFilters,discover,questgiver}.ts`
     (discover + questgiver now live in core too - HearthShelf still has the
     local copies until it's wired).
   - **HearthShelf-WebApp** (the messy one): its ABS types are inline/scattered
     across `src/api/abs*.ts` with **naming drift** (`AbsLibraryItem` vs core's
     `ABSLibraryItem`). Repoint to core's names; expect to touch ~10 files and fix
     the casing. Delete its copies of the shared lib files; pull `discover` +
     `questgiver` from core (WebApp doesn't have them yet - this is how it gets
     the discovery/taste features).

5. **Typecheck.** Expect core's stricter (more correct) types to surface a few
   latent bugs - e.g. nullable fields the local subset typed as non-null. That's
   the feature working. (Mobile hit exactly one: `displayAuthor: string | null`.)

6. **Add the sync script** to `package.json`:
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

# AGENTS.md

Guardrails for AI agents and contributors in `@hearthshelf/core`.

## What this repo is

`@hearthshelf/core` - the shared **types** and **pure logic** for every
HearthShelf surface (self-hosted web, hosted web, mobile). One source of truth so
an ABS change or a small refactor is a one-file edit, not a multi-repo hunt.

- **Ships TypeScript source - no build, no npm publish.** Consumed as a **git
  submodule** at `packages/core` in each app, via a `@hearthshelf/core` path
  alias; each app's bundler (Vite / Metro) compiles it.
- **Contents:** `src/types/abs.ts` (canonical ABS response shapes) +
  `src/lib/{format,letterBucket,libraryFilters,questgiver,discover}.ts`.

## Hard rules

- **No React, no DOM, no Node APIs.** Types, pure functions, and constants only.
  `tsconfig` omits the `DOM` lib on purpose - DOM-dependent code won't compile,
  which is the guardrail keeping this cross-platform (web + React Native).
- If something needs `window`, `fetch`, `localStorage`, a Zustand store, or a
  React hook, it does NOT belong here - it's app-specific.
- **Keep the ABS types a strict superset.** Consumers had drifting subsets;
  `src/types/abs.ts` is the canonical one they all narrow from. When ABS changes,
  update here - prefer accurate nullability (`string | null`) over convenience,
  even if it surfaces latent bugs in consumers (that's the point).
- **Run `tsc --noEmit`** before committing (use a sibling repo's TypeScript:
  `../HearthShelf/node_modules/.bin/tsc --noEmit -p tsconfig.json`).
- **Don't push** unless asked.

## Editing workflow

Edit a file here, commit. Consumers see it immediately (path alias to the
submodule). After bumping core, consumers run
`git submodule update --remote packages/core` (or `npm run sync-core`) and commit
the new submodule pointer. The `README.md` has the per-repo wiring recipe.

## Licensing

**MIT** (see `LICENSE.md`). Permissive on purpose: as a shared library consumed
by both the MIT mobile app and the AGPLv3 servers, MIT is the only license that
links cleanly into all of them (MIT code can be included in AGPL projects; the
reverse is not true). Keep it MIT - don't add AGPL-licensed code here.

## Related repositories

Servers are AGPLv3; the app + this shared lib are MIT.

| Repo | What it is |
| --- | --- |
| **HearthShelf** | Self-hosted SPA + Node backend (`server/`) + Docker |
| **HearthShelf-WebApp** | Hosted front door (`app.hearthshelf.com`) |
| **HearthShelf-Mobile** | Mobile app (Expo/React Native); consumes this repo |
| **HearthShelf-Core** | This repo - shared types + pure logic |
| **HearthShelf-Website** | Marketing site (`hearthshelf.com`) |
| **HearthShelf-Docs** | Docs site (`docs.hearthshelf.com`) |
| **HearthShelf-Direct-Infra** | VPS-side infra for the connect domain |
| **HearthShelf-DesignSystem** | Logos, favicon, shared design assets |

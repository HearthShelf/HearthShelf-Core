# HearthShelf architecture (cross-repo)

> How the HearthShelf repos fit together and who talks to whom. This lives in
> `@hearthshelf/core` so every surface shares one mental model. Read it before
> deciding where an endpoint, type, or piece of logic belongs.
>
> Companion: `docs/abs-api-reference.md` (the full ABS backend API map).

## The one rule that governs everything

**Every client has exactly one connection: to a HearthShelf host.** No client
holds an AudiobookShelf (ABS) URL of its own or talks to ABS directly. ABS is an
**internal-only** server that sits behind the HearthShelf front-end. A client
knows *our* origin; it does not know ABS exists as a separate box.

That HearthShelf host multiplexes by URL path:

| Path prefix | Proxied/served to | Who calls it |
| --- | --- | --- |
| `/abs-api/*` | ABS (prefix stripped) | HearthShelf clients making ABS REST calls |
| `/abs-socket/*` | ABS socket.io | HearthShelf clients' realtime socket |
| `/api`, `/socket.io`, `/auth`, `/public`, `/hls`, `/feed`, `/s` (raw) | ABS verbatim | native ABS clients (e.g. ABSORB) pointed at our host |
| `/hs/*` | the HearthShelf backend (`server/`) | HearthShelf clients using HS-native features |
| everything else | the HearthShelf SPA (static) | browsers loading the app |

So there are **two backends behind the one host**, and a client reaches both
through the same origin:

1. **ABS** - the source of truth for libraries, items, playback sessions, and
   progress. Reached via the `/abs-api/*` proxy (or raw ABS prefixes). ABS route
   knowledge is documented in `docs/abs-api-reference.md` and the paths are in
   `ABS_ENDPOINTS` (`src/lib/absEndpoints.ts`).
2. **The HearthShelf backend** (`HearthShelf/server/`) - HS-native features that
   ABS has no concept of (QuestGiver AI, Discover, settings sync, listening
   queue, social/leaderboard, clubs, notes, narrator photos, stats, RMAB/Audible
   integrations). Reached at `/hs/*`. These are HearthShelf's own endpoints -
   see `HS_ENDPOINTS` (`src/lib/absEndpoints.ts`).

## Which repo is which

Two classes of repo, and the distinction is the whole point of this doc.

### The HearthShelf host itself (`HearthShelf`)

The self-hosted product. It is the **only** repo that:

- runs nginx (the multiplexer above) and serves the SPA,
- runs the `/hs` backend (`server/`), and
- sits co-located with (or in front of) the internal ABS server.

Its browser SPA is the one client that reaches ABS "closest" - same-origin via
`/abs-api`, no CORS. But even it does not hold an ABS URL; it uses relative
`/abs-api/*` paths that nginx forwards.

### Remote-hosted clients (`HearthShelf-WebApp`, `HearthShelf-Mobile`)

These are **just more clients of a HearthShelf host**. They are not co-located
with ABS and never proxy to it themselves. They point at a HearthShelf origin and
use both surfaces through it:

- ABS data via that host's `/abs-api/*` (cross-origin; the host's nginx allows the
  one hosted origin via its CORS snippet),
- HS-native features via that host's `/hs/*`.

To a remote client, "the server" is a single HearthShelf origin. It should never
construct an ABS URL, assume ABS is directly reachable, or special-case ABS vs
HS beyond choosing the right path prefix.

> `HearthShelf-WebApp` also ships a control-plane Worker (pairing, redemption)
> that is a separate concern from the ABS/HS data plane described here.

## Authentication (shared across all clients)

Every client authenticates with an **ABS bearer token** (or a HearthShelf-minted
per-user ABS API key). That same token is used for both surfaces:

- ABS validates it natively on `/abs-api/*` calls.
- The `/hs` backend **identifies the caller by that ABS token** - it calls ABS
  `GET /api/me` to resolve `{ absUrl, absToken, serverId, userId, username, role }`
  (`server/lib/context.js`), then keys all HS-native state by `(serverId, userId)`.
  The `/hs` backend is not a generic ABS passthrough; it exposes only the fixed
  `/hs/*` feature routes and reaches ABS server-side only for the specific things
  it needs (token validation, user/key management).

So a client holds **one token** and hits **one origin**; the path prefix decides
which backend answers.

## Where things belong (the routing decision)

When adding an endpoint or type, decide which surface owns it:

- **Is it ABS data (library, item, playback, progress, ABS user/admin)?** It's an
  ABS endpoint. Document behavior in `docs/abs-api-reference.md`; add the path to
  `ABS_ENDPOINTS`; type the response in `src/types/abs.ts`. Clients call it via
  their `/abs-api` transport.
- **Is it HearthShelf-native (something ABS has no concept of)?** It's a `/hs/*`
  endpoint implemented in `HearthShelf/server/routes/`. Add the path to
  `HS_ENDPOINTS`; type its request/response in the relevant `src/types/*.ts`
  (e.g. `queue.ts`, `settings.ts`, `social.ts`). Clients call it via their `/hs`
  transport.
- **Is it pure logic or a shared shape?** It belongs in `@hearthshelf/core`
  (this repo) - no React, no DOM, no Node, no `fetch`. If it needs a runtime, a
  store, or a network call, it's app-specific and does not belong here.

## What core provides (and deliberately does not)

`@hearthshelf/core` holds the **contract**, not the **transport**:

- **Provides:** response shapes (`src/types/*`), endpoint path maps
  (`ABS_ENDPOINTS`, `HS_ENDPOINTS`), socket event names, offline-sync rule flags,
  and pure helpers (formatting, filtering, ranking, queue/settings logic).
- **Does not provide:** the HTTP client, the `/abs-api` vs `/hs` prefix, auth
  token storage, or anything that assumes an origin. Each app owns its transport
  layer and prepends the right prefix to the shared paths. That's why
  `ABS_ENDPOINTS.item(id)` returns `/api/items/:id` (the real ABS path) and the
  app's client turns it into `/abs-api/api/items/:id` at call time.

## Regenerating / verifying

- ABS route facts: the ABS server source at `C:\code\audiobookshelf\server`
  (routers, controllers, PlaybackSessionManager, User/MediaProgress models). See
  `docs/abs-api-reference.md` "Regenerating".
- HS route facts: `HearthShelf/server/index.js` (the dispatcher + the route list
  in its header comment) and `HearthShelf/server/routes/*`.
- Multiplexing/proxy facts: `HearthShelf/nginx/default.conf` +
  `nginx/abs_proxy.conf`.

# AudiobookShelf API Reference (Full Map)

> **Canonical, cross-repo reference for the ABS backend.** This lives in
> `@hearthshelf/core` so **every** HearthShelf surface sees it through the
> `packages/core` submodule - self-hosted web (`HearthShelf`), hosted
> (`HearthShelf-WebApp`), and mobile (`HearthShelf-Mobile`). Do not copy it into a
> consumer repo; link to it at `packages/core/docs/abs-api-reference.md`.
>
> Generated from direct reading of the AudiobookShelf **v2.35.1** server source at
> `C:\code\audiobookshelf\server`. ABS is HearthShelf's backend and the authority
> for all library data, playback sessions, and progress. This document maps
> **every** HTTP route, its request shape, response shape, auth/permission gate,
> and side effects (including the Socket.io events each emits).
>
> **Read `docs/architecture.md` first.** Clients never call ABS directly - they
> reach it through a HearthShelf host's `/abs-api/*` proxy (one connection, to
> us). The ABS routes below are what that proxy forwards to. The architecture
> guide explains the topology and the parallel `/hs/*` HearthShelf-native surface.
>
> **Companion module:** machine-readable endpoint paths and the offline-sync rule
> flags are exported from `@hearthshelf/core` as `ABS_ENDPOINTS` /
> `HS_ENDPOINTS` / `ABS_OFFLINE_SYNC_RULES` (`src/lib/absEndpoints.ts`). Import
> those in code instead of hardcoding paths; read this doc for ABS behavior.
>
> **Why this exists:** offline sync in the mobile app broke because the exact
> conflict-resolution rules of the session/progress endpoints weren't written
> down. Those rules are documented in full in
> [§ Offline Sync — the rules that matter](#offline-sync--the-rules-that-matter).
> Read that section before touching any progress/session code.

## How to read this doc

- **Base paths.** Three mounted routers plus a handful of server-level routes:
  - `/api/*` — the main API (bearer-authenticated). All routes in
    [§ /api routes](#api-routes).
  - `/public/*` — unauthenticated share + open-session-track routes.
  - `/hls/*` — HLS transcode segment delivery.
  - server-level: `/login`, `/logout`, `/auth/*`, `/init`, `/status`, `/ping`,
    `/healthcheck`, `/feed/*`.
- **Auth column meaning** (see [§ Authentication & permissions](#authentication--permissions)):
  - `user` — any authenticated user.
  - `self` — self-scoped (`req.user`); no elevation needed.
  - `access` — requires `checkCanAccessLibrary`/`checkCanAccessLibraryItem`.
  - `canUpdate` / `canDelete` / `canUpload` / `canDownload` — the named user
    permission flag.
  - `admin` — `isAdminOrUp` (admin or root).
  - `root` — root only.
  - `public` — no bearer token (share cookie or open session id only).
- **Old-JSON.** ABS models serialize to a legacy "old JSON" shape via
  `toOldJSON*()`. Response shapes below say "old-JSON" where that applies; the
  precise field lists live in `src/api/types.ts` in this repo — keep that as the
  single source for response field types.

---

## Authentication & permissions

### Token flow

- **Login:** `POST /login` (local username/password via passport `local`
  strategy, rate-limited). Send header `x-return-tokens: true` to get the refresh
  token in the JSON body (mobile); otherwise it is set as an httpOnly
  `refresh_token` cookie (browser). `Auth.js:320`.
- **Bearer:** every `/api/*` request authenticates via passport `jwt` strategy.
  The token is read from the `Authorization: Bearer <token>` header **or** a
  `?token=` query param. `Auth.js:123-133`.
- **Refresh:** `POST /auth/refresh`. Refresh token comes from the `refresh_token`
  cookie, or from an `x-refresh-token` header (mobile — the response then returns
  a rotated refresh token in the body). `Auth.js:329`.
- **Logout:** `POST /logout` — invalidates the refresh token, clears cookies; for
  OIDC also returns/uses the provider logout URL. `Auth.js:475`.
- **API keys** are JWTs too (same bearer path), minted via `/api/api-keys`,
  can carry an expiry, and are disabled when expired (expiration checked manually
  in `jwtAuthCheck` since `ignoreExpiration: true` is set). `Auth.js:128`.

### OIDC / OpenID

- `GET /auth/openid` — redirect to provider (supports mobile flow + PKCE
  `code_verifier`).
- `GET /auth/openid/callback` — provider callback; sets `openid_id_token` cookie.
- `GET /auth/openid/mobile-redirect` — redirects to app-link `audiobookshelf://oauth`.
- `GET /auth/openid/config?issuer=<url>` — admin-only helper to read a provider's
  `.well-known/openid-configuration`.

### Permission flags (on `req.user`)

`isAdminOrUp`, `isRoot`, `canUpdate`, `canDelete`, `canUpload`, `canDownload`,
`canAccessExplicitContent`, plus `checkCanAccessLibrary(libraryId)` and
`checkCanAccessLibraryItem(item)` (respect `librariesAccessible` +
`itemTagsSelected`). Guests are a restricted user type (e.g. cannot change
password).

> **Obfuscation quirk:** several admin-only endpoints return **404** (not 403) to
> non-admins to hide their existence — notably `GET /api/sessions`,
> `GET /api/sessions/open`, and all `EmailController` routes. Don't treat a 404
> from these as "not found."

---

## Socket.io events

HearthShelf connects to the same Socket.io server. Auth over the socket:
client emits `auth` with the bearer token after connect.

### Client → server

| Event | Purpose |
|---|---|
| `auth` | authenticate the socket with a bearer token |
| `ping` → `pong` | keepalive |
| `set_log_listener` / `remove_log_listener` | stream server logs (admin) |
| `search_covers` / `cancel_cover_search` | cover search over socket |
| `cancel_scan` | cancel a running library scan |
| `message_all_users` | admin broadcast |

### Server → client

Emit scopes: **broadcast** (all/filtered by library access),
**adminEmitter** (admin sockets), **clientEmitter(userId, …)** (one user).

| Event | Scope | Fired when |
|---|---|---|
| `user_online` / `user_offline` | admin | socket connect/disconnect |
| `user_stream_update` | admin | session start/close |
| `user_added` / `user_updated` / `user_removed` | admin / per-user | user CRUD |
| **`user_item_progress_updated`** | **per-user** | **progress written via any sync/progress path** |
| **`user_session_closed`** | **per-user** | **an open session was closed** |
| `library_added` / `library_updated` / `library_removed` | broadcast (filtered) | library CRUD |
| `item_added` / `item_updated` / `item_removed` | broadcast (filtered) | item CRUD |
| `items_updated` | broadcast | narrator/author rename or remove |
| `author_added` / `author_updated` / `author_removed` | broadcast | author CRUD/match |
| `series_added` / `series_updated` / `series_removed` | broadcast | series CRUD / becomes empty |
| `collection_added` / `collection_updated` / `collection_removed` | broadcast | collection CRUD |
| `playlist_added` / `playlist_updated` / `playlist_removed` | per-user | playlist CRUD |
| `episode_download_queued` / `_started` / `_finished` / `episode_download_queue_cleared` / `episode_added` | broadcast | podcast episode downloads |
| `metadata_embed_queue_update` | broadcast | embed-metadata task queue |
| `rss_feed_open` / `rss_feed_closed` | broadcast | RSS feed open/close |
| `backup_applied` | broadcast | backup restored |
| `task_started` / `task_finished` | broadcast | any long task (scan, encode, embed…) |
| `stream_reset` | broadcast | HLS stream reset (client should seek) |
| `batch_quickmatch_complete` | per-user | items batch quick-match finished |
| `notifications_updated` | broadcast | notification settings changed |
| `custom_metadata_provider_added` / `_removed` | broadcast | custom provider CRUD |
| `admin_message` | user | admin broadcast to users |

> For progress-tracking clients, the two that matter are
> **`user_item_progress_updated`** (payload:
> `{ id, sessionId, deviceDescription, data: <oldMediaProgress> }`) and
> **`user_session_closed`** (payload: the closed session id).

---

## Offline Sync — the rules that matter

**This is the section that would have prevented the mobile offline-sync bug.**
Everything about how the server merges offline listening into progress.

### The reconciliation primitive

Every progress write funnels through
`User.createUpdateMediaProgressFromPayload(payload)`
(`models/User.js:723`) → `MediaProgress.applyProgressUpdate(payload)`
(`models/MediaProgress.js:190`). Understand these two and you understand progress.

- **`progress` (0–1) is derived** from `currentTime / duration`, not stored
  directly (mirrored into `extraData.progress`).
- **Mark-as-finished is automatic** inside `applyProgressUpdate`: if
  `markAsFinishedPercentComplete` (> 0) is given it wins, else
  `markAsFinishedTimeRemaining` (default **10s**). These thresholds come from the
  **library settings**, injected by the server — *not* from the client.
  (`MediaProgress.js:224-248`.)
- **`lastUpdate` is the timestamp lever.** If a payload includes `lastUpdate`
  (epoch ms), after the normal save the server runs a raw
  `UPDATE "mediaProgresses" SET "updatedAt" = <date>` to force the row's
  `updatedAt` to the client-supplied time (`MediaProgress.js:253-263`). Invalid
  dates are ignored with a warning. This is how an offline change asserts *when*
  it happened.
- **`updatedAt` is the conflict key.** It is surfaced to clients as `lastUpdate`
  on the media-progress object (`MediaProgress.js:172`).

### The last-writer-wins guard (only on the local-session paths)

`PlaybackSessionManager.syncLocalSession` (`managers/PlaybackSessionManager.js:127`)
is the offline reconciler. Its conflict rule, at `:232`:

```js
if (userProgressForItem.updatedAt.valueOf() > session.updatedAt) {
  // SKIP — server progress is newer than this offline session, don't clobber
} else {
  // apply the offline session's progress
}
```

So a **stale offline session does not overwrite newer server progress** — but
only because the client set the local session's `updatedAt` to when the listening
actually happened. **If the mobile client sends a wrong/now `updatedAt` on a
queued offline session, it will clobber newer server progress.** That is the
class of bug to watch for.

### Which endpoints apply the guard

| Endpoint | Timestamp compared | LWW guard? | Notes |
|---|---|---|---|
| `POST /api/session/local` | session `updatedAt` vs progress `updatedAt` | **Yes** | single offline session |
| `POST /api/session/local-all` | same, per session | **Yes** | batch; per-item results in `results[]` |
| `PATCH /api/me/progress/:libraryItemId/:episodeId?` | `lastUpdate` backdates `updatedAt` | **NO** | **always applies — client must avoid conflicts** |
| `PATCH /api/me/progress/batch/update` | same | **NO** | errors silently skipped per item |
| `POST /api/session/:id/sync` (live) | — | **NO** | open session assumed authoritative; `timeListened` is a **delta** |
| `POST /api/session/:id/close` | optional final sync | **NO** | graceful flush |

> **Rule of thumb for offline flush:** use `POST /api/session/local-all`, not a
> loop of `PATCH /api/me/progress`. The session path (a) applies the LWW guard so
> a queued session can't clobber a newer read on another device, and (b) reports
> per-session success/failure in the response, which the `me/progress` batch path
> does not.

### Local-session id migration & matching

- A local session id starting with `play_local_` is remapped to a fresh `uuidv4`,
  cached in `oldPlaybackSessionMap` so repeat syncs of the same local session
  reuse the same server id (`PlaybackSessionManager.js:154-162`). This is how a
  device's local session is matched to a server session across reconnects.
- Stale `libraryItemId` / `bookId` / `episodeId` / `libraryId` on the incoming
  session are remapped to current ids if they drifted (`:163-177`).
- **A session with zero `timeListening` is never persisted** (`saveSession`,
  `:434`). Empty sessions vanish silently.

### Start-of-playback gotcha

`startSession` resets start time to **0 for already-finished items** so the
client restarts from the beginning (`PlaybackSessionManager.js:328-330`). If your
resume logic expects the finished item's `currentTime`, this will surprise you.

### Live sync semantics

`POST /api/session/:id/sync` body is `{ currentTime, timeListened, duration? }`
where **`timeListened` is a delta** added to cumulative `timeListening` — not an
absolute total (`PlaybackSessionManager.js:388`).

---

## Server-level routes (not under /api)

| Method | Path | Auth | What it does |
|---|---|---|---|
| POST | `/init` | none (only pre-init) | First-run: create root user + initialize DB. 500 if already initialized. |
| GET | `/status` | none | `{ app, serverVersion, isInit, language, authMethods, authFormData }`. Adds `ConfigPath`/`MetadataPath` when not yet initialized. Client polls this to see if server is set up. |
| GET | `/ping` | none | `{ success: true }` |
| GET | `/healthcheck` | none | `200` empty |
| POST | `/login` | rate-limited | local login → user login payload |
| POST | `/auth/refresh` | rate-limited | rotate access token |
| POST | `/logout` | user | invalidate refresh token |
| GET | `/auth/openid` · `/auth/openid/callback` · `/auth/openid/mobile-redirect` · `/auth/openid/config` | mixed | OIDC flow (see above) |
| GET | `/feed/:slug` · `/feed/:slug/cover*` · `/feed/:slug/item/:episodeId/*` | public | RSS feed XML + media for opened feeds |

---

## /public routes (no bearer auth)

Gated by a `share_session_id` cookie (share routes) or a valid open-session id.

| Method | Path | What it does |
|---|---|---|
| GET | `/public/share/:slug` | Resolve a media-item share by slug; creates a `web-share` playback session and sets a 30-day `share_session_id` cookie. `?t=` sets start time. 404 if missing/expired. |
| GET | `/public/share/:slug/cover` | Share cover image (needs matching session cookie). |
| GET | `/public/share/:slug/track/:index` | Share audio track by index (needs cookie). |
| GET | `/public/share/:slug/download` | Download the shared item (403 unless `isDownloadable`). |
| PATCH | `/public/share/:slug/progress` | Update in-memory share progress `{ currentTime }` (not persisted to a user). 204. |
| GET | `/public/session/:id/track/:index` | Audio track for an **open** session. Redirects TRANSCODE to HLS; X-Accel aware. |

---

## /hls routes

| Method | Path | What it does |
|---|---|---|
| GET | `/hls/:stream/:file` | Serve an HLS segment (`.ts`) or playlist (`.m3u8`) for an open transcode stream. Path-traversal guarded; unknown `.ts` segment triggers a `stream_reset` socket event and 404. |

---

## /api routes

Auth column uses the legend from [How to read this doc](#how-to-read-this-doc).
Side effects note the socket event(s) emitted.

### Libraries

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/libraries` | admin | Create library (name, folders[], mediaType, provider, settings). → `library_added` |
| GET | `/api/libraries` | user | All accessible libraries. `?include=stats`. |
| GET | `/api/libraries/:id` | access | `?include=filterdata` returns `{ filterdata, issues, numUserPlaylists, library }`. |
| PATCH | `/api/libraries/:id` | admin | Update; removing folders **deletes contained items**. → `library_updated` |
| DELETE | `/api/libraries/:id` | admin | Deletes library + all its items + collections. → `library_removed` |
| POST | `/api/libraries/order` | admin | Reorder: `[{ id, newOrder }]`. |
| GET | `/api/libraries/:id/items` | access | Paginated list. Query: `limit,page,sort,desc,filter,minified,collapseseries,include`. Returns `{ results, total, limit, page, sortBy, sortDesc, filterBy, … }`. |
| DELETE | `/api/libraries/:id/issues` | admin | Delete all missing/invalid items. |
| GET | `/api/libraries/:id/episode-downloads` | access | Podcast download queue for library. |
| GET | `/api/libraries/:id/series` | access | Paginated series. `?include=rssfeed`. |
| GET | `/api/libraries/:id/series/:seriesId` | access | One series. `?include=rssfeed,progress`. |
| GET | `/api/libraries/:id/collections` | access | Paginated collections (post-query slice). |
| GET | `/api/libraries/:id/playlists` | access | User's playlists in library (paginated). |
| GET | `/api/libraries/:id/personalized` | access | Home-page shelves. `?limit` per shelf, `?include`. |
| GET | `/api/libraries/:id/filterdata` | access | Filter/sort option data. |
| GET | `/api/libraries/:id/search` | access | `?q=` (required), `?limit` (default 12). Grouped matches. |
| GET | `/api/libraries/:id/stats` | access | Aggregate stats (authors, genres, sizes, durations). |
| GET | `/api/libraries/:id/authors` | access | Authors + book counts; paginated if `limit`+`page` given. |
| GET | `/api/libraries/:id/narrators` | access | `{ narrators: [{ id: base64(name), name, numBooks }] }`. |
| PATCH | `/api/libraries/:id/narrators/:narratorId` | canUpdate | Rename narrator (id = base64 name). → `items_updated` |
| DELETE | `/api/libraries/:id/narrators/:narratorId` | canUpdate | Remove narrator. → `items_updated` |
| GET | `/api/libraries/:id/matchall` | admin | Quick-match all items (async). |
| POST | `/api/libraries/:id/scan` | admin | `?force=1`. Responds 200 immediately, scans async. → `task_started/finished` |
| GET | `/api/libraries/:id/recent-episodes` | access | Podcast libraries only. `?limit,page`. |
| GET | `/api/libraries/:id/opml` | access | OPML XML of accessible podcasts. |
| POST | `/api/libraries/:id/remove-metadata` | admin | `?ext=abs|json`. Removes metadata files. |
| GET | `/api/libraries/:id/podcast-titles` | admin | Lightweight podcast title list. |
| GET | `/api/library/:id/download` | canDownload | `?ids=` comma list. Zips item folders. |

### Library items

Middleware loads expanded `req.libraryItem` (404 if no media), enforces
`checkCanAccessLibraryItem` (403). `PATCH`/`POST` need `canUpdate`, `DELETE`
needs `canDelete` — **except `/play` routes, which are exempt from `canUpdate`.**

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/items/batch/delete` | canDelete | `{ libraryItemIds }`, `?hard=1`. Per-item access enforced. |
| POST | `/api/items/batch/update` | canUpdate | `[{ id, mediaPayload }]`. → `item_updated` per item. |
| POST | `/api/items/batch/get` | user | `{ libraryItemIds }` → `{ libraryItems }`. **403 on empty payload** (quirk). |
| POST | `/api/items/batch/quickmatch` | admin | Async; → per-user `batch_quickmatch_complete`. |
| POST | `/api/items/batch/scan` | admin | Async folder rescan. |
| GET | `/api/items/:id` | access | `?expanded=1&include=progress,rssfeed,downloads,share&episode=<id>`. |
| DELETE | `/api/items/:id` | canDelete | `?hard=1` removes from disk. → `item_removed` |
| GET | `/api/items/:id/download` | canDownload | File or zipped folder. |
| PATCH | `/api/items/:id/media` | canUpdate | Update media/metadata; `url` downloads cover; validates podcast cron. → `item_updated` |
| GET | `/api/items/:id/cover` | public* | `?width,height,format,raw,ts`. Cached/resized. (*no permission gate in handler.) |
| POST | `/api/items/:id/cover` | canUpload | `url` or multipart `cover`. → `item_updated` |
| PATCH | `/api/items/:id/cover` | canUpdate | `{ cover: path }`. → `item_updated` |
| DELETE | `/api/items/:id/cover` | canDelete | → `item_updated` |
| POST | `/api/items/:id/match` | canUpdate | `{ provider, title, author, isbn, asin, overrideCover, overrideDetails }`. |
| **POST** | **`/api/items/:id/play`** | **access** | **Start playback session** → session-for-client JSON. → `user_stream_update` |
| **POST** | **`/api/items/:id/play/:episodeId`** | **access** | **Start episode playback session** (podcast). |
| PATCH | `/api/items/:id/tracks` | canUpdate | `{ orderedFileData: [{ ino, exclude? }] }`. Reorders audio; changes duration. → `item_updated` |
| POST | `/api/items/:id/scan` | admin | Rescan one folder item. |
| GET | `/api/items/:id/metadata-object` | admin | Metadata-embed preview object. |
| POST | `/api/items/:id/chapters` | canUpdate | `{ chapters: [{ title, start, end }] }`. → `item_updated` |
| GET | `/api/items/:id/ffprobe/:fileid` | admin | ffprobe JSON for an audio file. |
| GET | `/api/items/:id/file/:fileid` | access | Serve a library file (X-Accel aware). |
| DELETE | `/api/items/:id/file/:fileid` | canDelete | Remove file from disk + item. → `item_updated` |
| GET | `/api/items/:id/file/:fileid/download` | canDownload | Download a library file. |
| GET | `/api/items/:id/ebook/:fileid?` | access | Serve ebook (primary if no fileid). |
| PATCH | `/api/items/:id/ebook/:fileid/status` | canUpdate | Toggle primary↔supplementary ebook. → `item_updated` |

### Playback sessions

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/sessions` | admin (404 to others) | Paginated all-user session history. `?user,sort,desc,itemsPerPage,page`. |
| GET | `/api/sessions/open` | admin (404 to others) | In-memory open sessions + share sessions. |
| POST | `/api/sessions/batch/delete` | admin | `{ sessions: uuid[] }`. 400 on invalid. |
| DELETE | `/api/sessions/:id` | canDelete | Delete a persisted session (does **not** roll back progress). |
| **POST** | **`/api/session/local`** | **user** | **Sync ONE offline session.** LWW guarded. Body = full PlaybackSession JSON + `deviceInfo?`. → `user_item_progress_updated` |
| **POST** | **`/api/session/local-all`** | **user** | **Batch offline sync.** `{ sessions: [...], deviceInfo? }` → `{ results: [{ id, success, progressSynced?, error? }] }`. Per-item failures don't fail the request. |
| GET | `/api/session/:id` | own/admin | Get an **open** session (in memory only). |
| POST | `/api/session/:id/sync` | own/admin | Live sync `{ currentTime, timeListened (delta), duration? }`. → `user_item_progress_updated` |
| POST | `/api/session/:id/close` | own/admin | Close + optional final sync. → `user_session_closed`, `user_stream_update` |

### Current user (Me)

All self-scoped (`req.user`); item routes add `checkCanAccessLibraryItem`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/me` | Current user old-JSON. |
| GET | `/api/me/listening-sessions` | Paginated (`itemsPerPage,page`). |
| GET | `/api/me/item/listening-sessions/:libraryItemId/:episodeId?` | Item-scoped sessions (paginated). |
| GET | `/api/me/listening-stats` | Listening stats. |
| GET | `/api/me/progress/:id/:episodeId?` | Get one media progress. 404 if none. |
| **PATCH** | **`/api/me/progress/:libraryItemId/:episodeId?`** | **Create/update progress. NO LWW guard — always applies.** Body includes `currentTime,progress,duration,isFinished,ebookLocation,lastUpdate,…`. → `user_updated` |
| **PATCH** | **`/api/me/progress/batch/update`** | **Array of progress payloads. NO guard; per-item errors silently skipped.** 400 if empty. → `user_updated` |
| DELETE | `/api/me/progress/:id` | Delete a progress **record** (id = MediaProgress id). → `user_updated` |
| GET | `/api/me/progress/:id/remove-from-continue-listening` | Hide from continue listening. |
| GET | `/api/me/items-in-progress` | `?limit` (default 25). Unfinished items, sorted by last update. (Android Auto.) |
| GET | `/api/me/series/:id/remove-from-continue-listening` · `/readd-to-continue-listening` | Toggle series hide. |
| POST | `/api/me/item/:id/bookmark` | `{ time, title }`. Keyed by `(item, time)`, **no LWW**. → `user_updated` |
| PATCH | `/api/me/item/:id/bookmark` | Update bookmark (matched by `time`). |
| DELETE | `/api/me/item/:id/bookmark/:time` | Remove bookmark at `time`. |
| PATCH | `/api/me/password` | Rate-limited; guests 403. |
| GET | `/api/me/stats/year/:year` | Year 2000–9999. |
| POST | `/api/me/ereader-devices` | Update user's e-reader devices. |

### Collections

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/collections` | canUpdate + access | `{ name, libraryId, description, books[] }`. → `collection_added` |
| GET | `/api/collections` | user | All accessible. |
| GET | `/api/collections/:id` | access | `?include=`. |
| PATCH | `/api/collections/:id` | canUpdate | `{ name, description, books[] (reorder) }`. → `collection_updated` |
| DELETE | `/api/collections/:id` | canDelete | → `collection_removed` |
| POST | `/api/collections/:id/book` | canUpdate | `{ id }` (library item). → `collection_updated` |
| DELETE | `/api/collections/:id/book/:bookId` | canUpdate | (`:bookId` is a library-item id.) → `collection_updated` |
| POST | `/api/collections/:id/batch/add` | canUpdate | `{ books: [ids] }`. → `collection_updated` |
| POST | `/api/collections/:id/batch/remove` | canUpdate | `{ books: [ids] }`. **500 (not 400) on invalid body** (quirk). |

### Playlists (user-owned; middleware 403s non-owners)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/playlists` | `{ name, libraryId, description, items: [{ libraryItemId, episodeId? }] }`. → `playlist_added` |
| GET | `/api/playlists` | All user playlists (deprecated in favor of library-scoped). |
| GET | `/api/playlists/:id` | Owner only. |
| PATCH | `/api/playlists/:id` | `{ name, description, items[] (reorder, length must match) }`. → `playlist_updated` |
| DELETE | `/api/playlists/:id` | → `playlist_removed` |
| POST | `/api/playlists/:id/item` | `{ libraryItemId, episodeId? }`. |
| DELETE | `/api/playlists/:id/item/:libraryItemId/:episodeId?` | **Deletes playlist if it becomes empty.** |
| POST | `/api/playlists/:id/batch/add` · `/batch/remove` | `{ items: [{ libraryItemId, episodeId? }] }`. Empty → `playlist_removed`. |
| POST | `/api/playlists/collection/:collectionId` | Build a playlist from a collection. |

### Podcasts

Middleware loads podcast item, enforces access + method permission.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/podcasts` | admin | Create podcast `{ media, libraryId, folderId, path }`. → `item_added` |
| POST | `/api/podcasts/feed` | admin | `{ rssFeed: url }` → parsed `{ podcast }`. |
| POST | `/api/podcasts/opml/parse` | admin | `{ opmlText }` → `{ feeds }`. |
| POST | `/api/podcasts/opml/create` | admin | `{ feeds[], libraryId, folderId, autoDownloadEpisodes }` (async). |
| GET | `/api/podcasts/:id/checknew` | admin | `?limit` (default 3). |
| GET | `/api/podcasts/:id/downloads` | access | Current download queue. |
| GET | `/api/podcasts/:id/clear-queue` | admin | Clear download queue. |
| GET | `/api/podcasts/:id/search-episode` | access | `?title=`. |
| POST | `/api/podcasts/:id/download-episodes` | admin | `[episode objects]` (async). |
| POST | `/api/podcasts/:id/match-episodes` | admin | `?override=1`. → `item_updated` |
| GET | `/api/podcasts/:id/episode/:episodeId` | access | One episode. |
| PATCH | `/api/podcasts/:id/episode/:episodeId` | canUpdate | Update episode fields/chapters. → `item_updated` |
| DELETE | `/api/podcasts/:id/episode/:episodeId` | canDelete | `?hard=1` deletes file. → `item_updated` |

### Authors & Series

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/authors/:id` | user | `?include=items,series`. |
| PATCH | `/api/authors/:id` | canUpdate | Rename can **merge** into an existing same-library author (`{ author, merged: true }`). → `author_updated`/`author_removed`/`items_updated` |
| DELETE | `/api/authors/:id` | canDelete | → `author_removed` |
| POST | `/api/authors/:id/match` | canUpdate | `{ asin }` or `{ q, region }`. → `author_updated` |
| GET | `/api/authors/:id/image` | user | `?width,height,format,raw`. |
| POST | `/api/authors/:id/image` | canUpload | `{ url }`. → `author_updated` |
| DELETE | `/api/authors/:id/image` | canDelete | → `author_updated` |
| GET | `/api/series/:id` | access | **@deprecated** — use `/api/libraries/:id/series/:seriesId`. `?include=progress,rssfeed`. |
| PATCH | `/api/series/:id` | canUpdate | `{ name, description }`. → `series_updated` |

### Users (admin)

Middleware: non-admins may only GET their own `:id`; any write requires admin.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/users` | admin | `{ username, password, type?, email?, isActive?, permissions?, librariesAccessible?, itemTagsSelected? }`. → `user_added` |
| GET | `/api/users` | admin | `?include=latestSession`. Root token hidden unless caller is root. |
| GET | `/api/users/online` | admin | `{ usersOnline, openSessions }`. |
| GET | `/api/users/:id` | admin | Full user + decorated media progress. |
| PATCH | `/api/users/:id` | admin (root to touch root) | Username change **rotates API token + invalidates JWT sessions**. → `user_updated` |
| DELETE | `/api/users/:id` | admin | Can't delete root or self. → `user_removed` |
| PATCH | `/api/users/:id/openid-unlink` | admin | Clear OIDC link. → `user_updated` |
| GET | `/api/users/:id/listening-sessions` | self/admin | Paginated. |
| GET | `/api/users/:id/listening-stats` | self/admin | Stats. |

### API keys (admin)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/api-keys` | List (each with user + createdByUser). |
| POST | `/api/api-keys` | `{ name, userId, expiresIn?, isActive? }`. Plaintext `apiKey` returned **only at creation**. Root's key needs root caller. |
| PATCH | `/api/api-keys/:id` | Only `isActive`/`userId` mutable. |
| DELETE | `/api/api-keys/:id` | |

### Search (user)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/search/books` | `?provider,title,author,id`. |
| GET | `/api/search/covers` | `?title (req),author,provider,podcast`. |
| GET | `/api/search/podcast` | `?term (req),country`. |
| GET | `/api/search/authors` | `?q`. |
| GET | `/api/search/chapters` | `?asin (req),region`. |
| GET | `/api/search/providers` | Built-in + custom providers. |

### Backups (admin)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/backups` | `{ backups, backupLocation, backupPathEnvSet }`. |
| POST | `/api/backups` | Create backup. |
| DELETE | `/api/backups/:id` | → remaining `{ backups }`. |
| GET | `/api/backups/:id/download` | X-Accel or file. |
| GET | `/api/backups/:id/apply` | Restore. → `backup_applied` |
| POST | `/api/backups/upload` | Multipart `file`. |
| PATCH | `/api/backups/path` | `{ path }`. |

### Notifications / Email (admin)

Email routes return **404** to non-admins.

| Method | Path | Notes |
|---|---|---|
| GET/PATCH | `/api/notifications` | Get / update settings. |
| POST/DELETE/PATCH | `/api/notifications[/:id]` | CRUD a notification. |
| GET | `/api/notificationdata` | (deprecated) |
| GET | `/api/notifications/test` · `/api/notifications/:id/test` | Fire test events. |
| GET/PATCH | `/api/emails/settings` | Email settings. |
| POST | `/api/emails/test` | Send test email. |
| POST | `/api/emails/ereader-devices` | Update ereader devices. → `ereader-devices-updated` |
| POST | `/api/emails/send-ebook-to-device` | `{ libraryItemId, deviceName }`. Needs device + item access. |

### Shares (admin manage; public consume)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/share/mediaitem` | admin | `{ slug, mediaItemType, mediaItemId, expiresAt, isDownloadable? }`. 201. 409 on dup. |
| DELETE | `/api/share/mediaitem/:id` | admin | 204. |
| *(public)* | `/public/share/:slug*` | public | See [/public routes](#public-routes-no-bearer-auth). |

### RSS feeds (admin)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/feeds` | `{ feeds, minified }`. |
| POST | `/api/feeds/item/:itemId/open` · `/collection/:collectionId/open` · `/series/:seriesId/open` | `{ serverAddress, slug }`. Item must have audio. → `rss_feed_open` |
| POST | `/api/feeds/:id/close` | → `rss_feed_closed` |

### Tools / Cache / Custom metadata providers (admin)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/tools/item/:id/encode-m4b` | `?` options → merge task. |
| DELETE | `/api/tools/item/:id/encode-m4b` | Cancel encode. |
| POST | `/api/tools/item/:id/embed-metadata` | `?forceEmbedChapters,backup`. |
| POST | `/api/tools/batch/embed-metadata` | `{ libraryItemIds }`. → `metadata_embed_queue_update` |
| POST | `/api/cache/purge` · `/api/cache/items/purge` | Purge caches. |
| GET | `/api/custom-metadata-providers` | List. |
| POST | `/api/custom-metadata-providers` | `{ name, url, mediaType, authHeaderValue? }`. → `custom_metadata_provider_added` |
| DELETE | `/api/custom-metadata-providers/:id` | → `custom_metadata_provider_removed` |

### Stats

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/stats/year/:year` | admin | Server-wide year stats (2000–9999). |
| GET | `/api/stats/server` | admin | Book/podcast totals + sizes. ("Currently not in use.") |

### Filesystem & Misc

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/filesystem` | admin | `?path,level`. Directory listing (drives on Windows). |
| POST | `/api/filesystem/pathexists` | canUpload + access | `{ directory, folderPath }`. Traversal-guarded. |
| POST | `/api/upload` | canUpload + access | Multipart. Fields `title (req), author, series, folder (req), library (req)`. |
| GET | `/api/tasks` | user | `?include=queue`. |
| PATCH | `/api/settings` | admin | Update server settings (validated). |
| PATCH | `/api/sorting-prefixes` | admin | `{ sortingPrefixes: [] }`. Recomputes ignore-prefix on all items. |
| POST | `/api/authorize` | user | Returns the user login payload (re-auth). |
| GET | `/api/tags` · `/api/genres` | admin | Distinct tags/genres. |
| POST | `/api/tags/rename` · `/api/genres/rename` | admin | `{ tag/genre, newTag/newGenre }`. → `item_updated` |
| DELETE | `/api/tags/:tag` · `/api/genres/:genre` | admin | Param is **base64-encoded**. → `item_updated` |
| POST | `/api/validate-cron` | user | `{ expression }`. 400 if invalid. |
| GET/PATCH | `/api/auth-settings` | admin | Read/update auth settings; enables/disables strategies. |
| POST | `/api/watcher/update` | admin | `{ libraryId, path, type: add|unlink|rename, oldPath? }`. |
| GET | `/api/logger-data` | admin | Current daily logs. |

---

## Response-shape source of truth

Field-level types for every response body are the canonical ABS shapes in this
package: `@hearthshelf/core` → `src/types/abs.ts`. This document maps **routes
and behavior**; that file maps **shapes**; `src/lib/absEndpoints.ts` maps
**paths** (`ABS_ENDPOINTS`) and the **offline-sync rule flags**
(`ABS_OFFLINE_SYNC_RULES`). All three are shared across every repo via the
submodule. When they disagree, verify against the ABS source at
`C:\code\audiobookshelf\server` (the version this doc was generated from is
**2.35.1**).

## Regenerating this map

Re-derive from source when ABS is upgraded:
1. Route table: `server/routers/ApiRouter.js`, `PublicRouter.js`, `HlsRouter.js`,
   `Server.js` (server-level), `Auth.js` (`initAuthRoutes`).
2. Behavior/params/auth: the matching controller in `server/controllers/`.
3. Offline-sync semantics: `server/managers/PlaybackSessionManager.js`,
   `server/models/User.js` (`createUpdateMediaProgressFromPayload`),
   `server/models/MediaProgress.js` (`applyProgressUpdate`).
4. Socket events: grep `emitter('` / `clientEmitter(` under `server/`.

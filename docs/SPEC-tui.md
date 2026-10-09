# Spec: `dmm-tui` — a headless Torbox search-and-add client for DMM

Status: **draft, awaiting review**. Nothing is implemented.

This spec descends from a confirmed statement of intent (see §Provenance). Where the
intent said "recreate the basic functionality", this document turns it into things that
can be tested. Where the intent left a gap, the gap is either closed here with a stated
reason or raised in §Open Questions.

---

## Objective

`dmm-tui` is a keyboard-driven terminal client for the release grid that DMM's browser
movie and season pages provide, for a user who has no browser — an SSH session on the
same Debian host that already runs DMM, over `tmux`, with no Window Manager.

The loop it closes end to end:

1. Type a title. Get a ranked list of movies and shows from DMM.
2. Pick one. Get a grid of releases, sorted cached-first.
3. Every row is probed against Torbox's cache with the caller's own API key. Rows Torbox
   already holds are marked `INSTANT`; the rest are hidden by default.
4. Press a key on a row. The magnet is created on the Torbox account and the row is
   confirmed as present in the account's torrent list.

**User story.** As someone whose only access to a headless box is SSH, I want to find a
release and get it into my Torbox account without opening a browser, so that my existing
Torbox → Zurg → Jellyfin/Emby pipeline picks it up unchanged.

**Success is one sentence:** search a movie, press one key on a cached row, and the
torrent is in the Torbox dashboard.

**Not the goal:** replacing DMM's web UI. This is a narrow client for the search →
cached-check → add path, for one provider.

---

## Provenance

Derived from an interview that confirmed, line by line:

|              |                                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outcome      | TUI standing in for DMM's browser movie/TV pages: search a title, show a release grid, mark rows "Instant TB" from `checkcached`, push the magnet into the Torbox account. |
| User         | One person, alone, over SSH + `tmux` on the Debian box where DMM already runs.                                                                                             |
| Why now      | DMM is deployed and its search index is good; the only way to reach it is a browser, and `dmmProblemKey` is a browser-shaped flow. There is no headless path.              |
| Success      | Search a movie → grid with cached rows marked → press a key → it is in the Torbox dashboard. Same for a TV season.                                                         |
| Constraint   | Raw terminal only. Respect DMM's 1 req/2s on `/api/torrents/*` plus a fresh challenge token, and Torbox's 100-hash `checkcached` batches and ~1s `createtorrent` pacing.   |
| Out of scope | Playback / stream-URL resolution, anime, bulk multi-select, tracking what is already added, deleting from Torbox. Read-only against DMM; writes only to Torbox.            |

Two answers fixed placement and deployment: the client lives in this repository
(AGPL-compatible as a derivative), and DMM runs on the same host as the TUI.

### A correction to the intent, made during specification

The intent listed TV support as "movies + shows (seasons/episodes)" and I estimated at
interview time that this would roughly double the spec. **That estimate was wrong, and
the honest reason is worth recording.**

Per-episode file _selection_ is only needed to produce a playable URL, which is out of
scope. Per-episode _planning_ — the pack-versus-loose-episodes decision in
`src/utils/seasonPacks.ts` — is driven by library state (`getSeasonCoverage` reads
`UserTorrent[]` to work out what you already hold), and library tracking is also out of
scope. So for v1, a TV season is a release grid that knows how many episodes a season has,
so it can label a pack `Complete (8/8)` or `Incomplete (5/8)`. That is `getEpisodeCountLabel`
plus the `videos:` filter — both of which already exist and are pure.

TV therefore costs roughly one extra endpoint and one extra column. It does not double the spec.

---

## Assumptions

Listed before the rest of the document so they can be corrected cheaply. **Corrections
welcome; everything downstream depends on these.**

1. **Node 22+** on the Debian host, now declared in `package.json` `engines`. Ink 8
   requires it. See §Decisions — this was 20+ until implementation showed otherwise.
2. **The TUI runs on the host, alongside a native DMM install.** DMM runs directly on the
   Debian box against a local MariaDB, not in a container, so the two share a Node
   installation and a loopback address. `dmmBaseUrl` is therefore typically
   `http://localhost:3000`, but stays explicit configuration with no default — the port and
   bind address are facts about the deployment, and the TUI must not assume them.
3. **`TERM` is not trusted.** The client must render correctly under `dumb`, a 16-colour
   `$TERM`, and a detached `tmux` pane narrower than the content. Colour is decoration, never
   the only carrier of meaning — "cached" is also a text label.
4. **A 120-column terminal is the design target**, degrading by dropping columns right to
   left, title last.
5. **No state is persisted between runs** except the config file. There is no cache of
   previous searches, no history file, no library. (Deliberate: library tracking is out of
   scope, and a stale cache on a cache-probe whose whole value is freshness is a liability.)
6. **The Torbox API key lives in a `0600` config file or an environment variable**, never in
   shell history, never in a URL. `src/utils/torboxCastApiHelpers.ts:19-27` records why the
   query-string form is forbidden: it wrote thousands of keys into nginx access logs.
7. **Zipped downloads are never wanted.** The user does not intend to unpack archives, which
   turns out to constrain the _grid_ and not only the add parameters — see §Decisions.

### Decisions taken during review

Resolved against the questions this spec originally raised. Recorded here so a later
reader does not re-open them.

| Decision          | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TUI library       | **Ink**, confirmed. React-first and TS-native, matching React 19 + `strict` here. The cost is real and accepted: Ink has no fixed-width table primitive, so §Grid rendering specifies a hand-rolled _pure_ table function — which doubles as the most testable part of the client. `blessed` was rejected: untyped and effectively unmaintained.                                                                                                                                                                                                                                                                |
| `allow_zip`       | **Never sent.** Not because it is unused, but because zipped downloads are unwanted. This has a second-order effect recorded below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Dependencies      | `ink@^8` (runtime) and `tsx` (run TypeScript directly, so no build step on the Debian box). Both still require approval per §Boundaries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| React and Node    | **Both bumped, deliberately.** Ink 8 peer-requires `react >= 19.3` and `node >= 22`; this repo was on React 19.1.1. The first instinct was to pin Ink 6.4 instead, which accepts React 19.1, and leave the web app alone. That was wrong: it optimises "don't touch the web app" over "don't break it", pins a TUI library two majors back to dodge a one-line dependency bump, and leaves a version skew to explain later. React and `react-dom` are both now `^19.3.0` with matching types, `engines` declares `node >= 22`, and `npm run build` was re-run clean on 19.3 to prove the web app is unaffected. |
| Browser proxy fix | Not applicable. The external CORS proxy is `config.proxy` (`next.config.js:135`), read only by the browser branch of `getTorBoxBaseUrl()` (`src/services/torbox.ts:319`). A Node process is `isServer` and bypasses it, so the client talks directly to `api.torbox.app` and inherits none of the browser-only breakage that was fixed.                                                                                                                                                                                                                                                                         |

#### The second-order effect of never sending `allow_zip`

Worth stating plainly, because it changes a default and would otherwise look like an
unexplained omission.

`archiveOnly.tb` is set when Torbox's listing for a hash contains no video file but does
contain a `.zip` / `.rar` / `.7z` / `.r\d{2}` (`src/utils/instantChecks.ts:80`, `:105-107`).
It means "Torbox holds this release as a single archive" — adding it yields something to
unpack, not something to play. That is not a rare edge: 122 of 283 BDMV torrents TorBox held
were packed into one `.zip` when measured on 2026-10-03
(`src/utils/instantChecks.ts:130`), against the same torrents listed unpacked on
Real-Debrid.

If archives are unwanted, then an archive-only row is a row that **cannot** satisfy the
user, whether or not `allow_zip` is sent. `allow_zip` governs what Torbox may do when
creating a new download; `archiveOnly` describes what is already in the cache for a hash the
grid is offering. Sending `allow_zip` and hiding archives are different problems, and only
the second one is what actually prevents a useless add.

**Therefore: archive-only rows are hidden by default, alongside uncached rows.** The
default grid is therefore _cached and not archive-only_. This is expressed as its own
config flag (`showArchiveOnly`, default `false`) rather than as a filter token, because the
`quickSearch` grammar has no way to express it — `is:tb` tests availability and nothing
else.

---

## Capability map

One deliverable, five modules. They are specified together rather than as five
`SPEC-*.md` files because none of them ships or is useful alone — a Torbox client with no
UI is not a product, and a UI with no client is a mock. The module boundaries are still
worth fixing now, because they are what the tests attach to.

| id       | Responsibility                                                                             | Depends on      |
| -------- | ------------------------------------------------------------------------------------------ | --------------- |
| `config` | Load, validate, and normalise config; `0600` handling; env overrides                       | —               |
| `dmm`    | Read-only DMM client: challenge token, title search, movie/season releases, media info     | `config`        |
| `torbox` | Torbox client: key validation, `checkcached` probe, `createtorrent`, `mylist` verification | `config`        |
| `logic`  | Pure derivations: normalisation, video stats, archive detection, paging, sorting handoff   | `dmm`, `torbox` |
| `ui`     | Screens, keybindings, table rendering, filter line, terminal lifecycle                     | `logic`         |

Build order: `config` → `dmm` and `torbox` (parallel, no coupling) → `logic` → `ui`.

`logic` is the only module that knows how a DMM row and a Torbox probe join into a grid
row. Keeping it pure is what makes the interesting part testable without a terminal.

---

## Tech stack

|           |                                                                  |
| --------- | ---------------------------------------------------------------- |
| Language  | TypeScript 5.8, `strict`, path alias `@/*` → `./src/*`           |
| Runtime   | Node 22+ (declared in `engines`; developed on 24.5)              |
| TUI       | `ink` ^5 (new dependency)                                        |
| Execution | `tsx` (new dependency) — no build step on the target host        |
| Tests     | Vitest (existing), co-located `*.test.ts`                        |
| Types     | Existing `@/services/types` Torbox response types                |
| Reuse     | `parse-torrent-title` (already a dep, already a TorBox-App fork) |

---

## What is reused, and what is not

This is the section that decides how much of DMM the client actually inherits. It was
arrived at by reading the import graph of the existing Torbox path, not by assumption.

### Reused as-is

| Module                                                                          | Why it is safe                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@/services/mediasearch` `SearchResult`                                         | The client builds rows of this exact type, so the filter DSL and the sort helpers work unmodified.                                                                                                      |
| `@/utils/quickSearch` `quickSearch`                                             | The whole filter grammar — space-separated AND terms, `-` negation, `videos:N` / `videos:<N` / `videos:>N`, `is:tb`, bare regex, bare hash. ~90 lines of behaviour already tested. Not reimplemented.   |
| `@/utils/results` `sortByBiggest`, `sortByMean`, `totalFileSize`, `isAvailable` | The cached-first-then-biggest ordering, with the deliberate asymmetry that cached rows rank on the file you would actually watch and uncached rows rank on the total (`src/utils/results.tsx:106-117`). |
| `@/utils/episodeUtils` `getEpisodeCountLabel`, `getExpectedEpisodeCount`        | Pure, zero imports. Gives `Complete (8/8)` for free, including the 13-episode fallback.                                                                                                                 |
| `@/utils/selectable` `isVideo`                                                  | Pure, zero imports, and its `/rarbg` / `sample` / `trailer` exclusions are exactly right for deciding whether a Torbox file listing contains something playable.                                        |
| `@/utils/extractHashes` `toMagnetUri`                                           | Handles base32 and query-parameter magnets; `handleAddAsMagnetInTb` already normalises bare hashes this way.                                                                                            |

`@/utils/results` is a `.tsx` file with top-level `import { Download, Zap } from 'lucide-react'`.
Importing it under `tsx` pulls React and lucide into a Node process for two functions that
use neither. **Plan: import it and verify.** If it fails to load, the fallback is a
mechanical split of `results.tsx` into `results.ts` (pure) and `results.tsx` (components),
with every existing import site left pointing at the `.tsx`. That refactor is
behaviour-preserving and reviewable, but it touches shared files, so it is a decision for
§Boundaries, not a silent change.

### Deliberately not reused, with reasons

| Not reused                                                | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@/services/torbox` `createTorrent` / `checkCachedStatus` | Top-level `@/lib/observability/torboxOperationalStats`, which routes through `services/repository` to Prisma. Its guard is `typeof window === 'undefined'` (`src/lib/observability/torboxOperationalStats.ts:24`) — a Node process passes that guard, so every call would fire a Prisma write and log a connection error. It also brings `next/config`, which does degrade to a fallback (`src/services/torbox.ts:26-39`) but only because someone wrapped it in a `try`/`catch`. |
| `@/utils/torboxCache` `torboxCachedHashes`                | Its probe asks `format=list&list_files=false`, which returns no file listing. Without files there is no `videoCount`, no `noVideos`, no `archiveOnly`, and therefore no sort-by-watched-file and no `Complete (8/8)`. The TUI needs `format=object&list_files=true`, which is a different request.                                                                                                                                                                                |
| `@/utils/instantChecks` `processTbInstantCheck`           | Written against a React `setState` rather than a return value, and imports `react-hot-toast` at module top. The body is ~15 lines and is reimplemented in `torbox/probe.ts`.                                                                                                                                                                                                                                                                                                      |
| `@/utils/addMagnet`                                       | Imports `react-hot-toast`, toasts on every path including the silent ones, and mixes browser-only helpers.                                                                                                                                                                                                                                                                                                                                                                        |
| `@/utils/seasonPacks`                                     | Library-coverage driven. Out of scope with library tracking.                                                                                                                                                                                                                                                                                                                                                                                                                      |

`torbox/probe.ts` reuses the _constants_ from `torboxCache.ts` (`CHECKCACHED_CHUNK = 100`,
`TIMEOUT_MS = 8000`, and the 10-minute answer TTL reasoning) but not the function, because
the request shape differs. Those constants should be imported, not copied, so a Torbox
change lands in one place.

---

## The pipeline

Concrete, in order. Every endpoint here is verified against the current code; nothing is
from memory.

### DMM side (read-only)

**1. Challenge token.**
`GET {dmmBaseUrl}/api/challenge` → `{ token, hash }`.
Rate limit `default` (5 req/1s). Minted server-side since the signing key used to ship in
the browser bundle (`src/utils/token.ts:4-9`); the TUI must therefore ask for one rather
than compute it — this is the specific thing that makes the flow browser-shaped today.
Hold the pair for 2 minutes, matching `TOKEN_REUSE_MS`, and share one in-flight request
across concurrent callers the way `generateTokenAndHash` does. Reuse the whole shape of
that module, with the relative `/api/challenge` replaced by `{dmmBaseUrl}/api/challenge`.

**2. Title search — via Trakt, not `/api/search/title`.**
`GET {dmmBaseUrl}/api/trakt/search?query=<q>&types=movie,show` → an **array** of
`{ score, type, movie | show }`, where the payload object carries `ids.imdb`, `year` and
`title`. About 10 results.

This replaces the endpoint this spec originally named. `/api/search/title?keyword=` is the
obvious candidate — it is the "quick search" handler and it returns a clean
`{ id, type, year, title, imdbid }` shape — but it reads DMM's local `ImdbTitles` table and
**returns `{ "results": [] }` for every query on a fresh deployment** (verified against the
live instance: `dune`, `the matrix`, `breaking bad`, `alien` all empty). The Trakt endpoint
answers immediately and carries the IMDb id the rest of the pipeline needs. Trakt is also
what the web `SearchBar` actually calls for its dropdown
(`src/components/SearchBar.tsx:114-150`), so this is the same source the browser uses, not
a substitute for it.

Two consequences. The response is an array of two shapes rather than one, so a normaliser
picks `movie` or `show` by the `type` field. And the results are not curated — a search for
`breaking bad` returns `El Camino: A Breaking Bad Movie` and a behind-the-scenes feature
alongside the show — so the picker shows type, year and title per row and lets the user
choose, exactly as the browser does. No curation is attempted.

`/api/search/title` is kept as a documented fallback: if the `ImdbTitles` table is ever
populated on the target instance it is a better local index, and the two are easy to swap.
v1 does not call it.

This handler is exported bare — it is not wrapped in `withIpRateLimit` — so there is no
budget to respect here. Debounce is not required for a keypress-driven client; a request is
issued on Enter or on a 400 ms idle timer, and stale responses are dropped by a request
generation counter.

**3. Release grid — movies.**
`GET {dmmBaseUrl}/api/torrents/movie?imdbId=&dmmProblemKey=&solution=&page=0`
→ `200 { results: [{ hash, title, fileSize }] }` (`src/pages/api/torrents/movie.ts:129`).
Rate limit `torrents`: **1 request per 2 seconds, per IP.**

**4. Release grid — seasons.**
`GET {dmmBaseUrl}/api/torrents/tv?imdbId=&seasonNum=&dmmProblemKey=&solution=&page=0`
Same response shape. `seasonNum` is required and rejected with 400 when missing
(`src/pages/api/torrents/tv.ts:44-50`).

**5. Media info.**
`GET {dmmBaseUrl}/api/info/movie?imdbid=` and `/api/info/show?imdbid=`.
Needed for the display title/year, and for a show's `season_episode_counts` and
`last_episode_to_air`, which is what makes `Complete (8/8)` mean "all eight that have
actually aired" rather than "all eight that exist, including unaired ones"
(`src/utils/seasonPacks.ts:124-133`).

### Torbox side (writes)

**6. Key validation at startup.**
`GET https://api.torbox.app/v1/api/user/me`, `Authorization: Bearer <key>`.
**Torbox answers a rejected key with HTTP 200 and `success: false`**, not a 401
(`src/hooks/auth.ts:387-388`). A status-code-only check would accept a dead key and fail
later, confusingly, at the first add. Check `success` explicitly.

**7. Availability and file stats — one probe, two answers.**
`POST https://api.torbox.app/v1/api/torrents/checkcached?format=object&list_files=true`
with body `{ hashes: [...] }`, chunked at 100, 8 s timeout per chunk.

Two properties of this response drive the design:

- **It is hits only.** A miss is absent from `data`, never `false`
  (`src/test/fixtures/instantChecks/spiderman3-uhd-torbox-checkcached.json`). The client
  builds a `Set` of lowercased hashes and tests membership; it never assumes a positional
  line-up.
- **Torbox file ids are not array positions.** Measured 2026-08-24: 50 of 52 files across
  four season packs mismatched (`src/utils/instantChecks.ts:343-347`). File ids are read
  from `file.id`; array position is never used as an id.

One probe yields both availability and every per-file statistic the grid needs —
`videoCount`, `biggestFileSize`, `medianFileSize`, `meanFileSize`, `noVideos`, `archiveOnly`
— via the same `calculateFileStats` and `isVideo` logic `applyProviderFiles` uses. This is
the reason the client needs no separate RD-style availability pass and no metadata backfill.

**Failure is `unknown`, not `uncached`.** A timeout, a 429, or a body without `success: true`
yields no answer. An unknown row must be hidden or shown-as-unknown, never silently
presented as uncached — otherwise a Torbox hiccup looks like "Torbox doesn't have any of
this", which is the exact failure `torboxCachedHashes` was written to avoid
(`src/utils/torboxCache.ts:1-7`: 219 of 369 requests had failed on the uploader as
`uncached` for this reason).

**8. Create the torrent.**
`POST https://api.torbox.app/v1/api/torrents/createtorrent`, `multipart/form-data`,
`Authorization: Bearer <key>`, body `magnet` from `toMagnetUri(hash)`.
Success is `success === true` **and** (`data.torrent_id` present **or** `data.queued_id`
present) — `src/utils/addMagnet.ts:742-745` checks both and reports "added without an ID"
otherwise, which is a real observed response.

`add_only_if_cached` is **not** sent. The confirmed intent chose a UI-level guard
(cached-only grid, explicit toggle plus confirm for the rest) over a server-side rejection,
because a rejected request gives the user no explanation.

`allow_zip` is **not** sent, because zipped downloads are unwanted. `seed` is not sent
either — it exists on the endpoint and no DMM caller passes it, and v1 has no seeding
preference to express. Note that omitting `allow_zip` only governs what Torbox may do when
_creating_ a download; it does not stop the grid from offering a hash Torbox already holds
as an archive. That is handled in the grid, per §Decisions.

Pace adds at ~1 s, matching `TB_BATCH_MAGNET_DELAY` (`src/utils/addMagnet.ts:149`).
Respect `Retry-After` on a 429 rather than retrying into it.

**9. Verify the add landed.**
`GET https://api.torbox.app/v1/api/torrents/mylist`, then check the added hash is present.
This is what makes the confirmed success criterion ("appears in my Torbox Dashboard")
observable rather than assumed, and it is a read. Bounded timeout; **a failed verification is
a warning, never a failed add** — the create already succeeded, and reporting it as an error
would be a lie. Skippable via `DMM_TUI_VERIFY=0` for accounts with very large lists.

---

## Screens and keybindings

Three screens and one modal. No screen depends on a mouse.

### 1. Search

A prompt and a ranked list from §2 above. Each row: `[MOVIE|SHOW]  Title  (Year)`.
Matching the browser's own behaviour, a query that is already an IMDb id (`tt\d{7,}`)
goes straight to the grid.

| Key                            | Action         |
| ------------------------------ | -------------- |
| printable                      | edit query     |
| `Enter`                        | run search     |
| `↑` / `↓`, `Ctrl-P` / `Ctrl-N` | move selection |
| `PgUp` / `PgDn`                | page the list  |
| `Ctrl-C`                       | quit           |

### 2. Grid

The core screen. Columns, in priority order for truncation:

| Column           | Example                                 |
| ---------------- | --------------------------------------- |
| state            | `INSTANT` / `DL` / `ARCHIVE` / `—`      |
| title            | `Dune.Part.Two.2024.2160p.WEB-DL…`      |
| video count      | `1` or `8`                              |
| total            | `Total: 62.41 GB`                       |
| biggest / median | `Biggest: 58.20 GB` / `Median: 3.90 GB` |
| episodes (TV)    | `Complete (8/8)`                        |

A footer holds the filter line, a progress line while the probe is running, and the key
legend. Cached rows sort first, biggest watched file first; uncached rows follow, biggest
total first — `sortByBiggest` already encodes this and is reused unchanged.

| Key                             | Action                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `↑` / `↓`, `Ctrl-P` / `Ctrl-N`  | move selection                                                               |
| `PgUp` / `PgDn`, `Home` / `End` | scroll                                                                       |
| `/`                             | focus the filter line (uses the `quickSearch` grammar)                       |
| `a`                             | add the selected row to Torbox                                               |
| `u`                             | toggle visibility of uncached rows (**off by default**)                      |
| `z`                             | toggle visibility of archive-only rows (**off by default** — see §Decisions) |
| `Enter`                         | open the file list for the selected row (from the probe's `files`)           |
| `[` / `]`                       | previous / next result page — paced at 2.5 s                                 |
| `r`                             | re-run the `checkcached` probe on the current page                           |
| `y`                             | copy the selected hash                                                       |
| `q`                             | quit                                                                         |

**The default grid is cached and not archive-only.** Both toggles are off, so out of the
box the only rows reachable by `a` are ones Torbox already holds _and_ that yield a
playable file rather than an archive to unpack. Nothing reachable by a single keypress can
spend Torbox points or hand back an unusable download.

### 3. Confirm — uncached adds only

Shown only when the uncached toggle is on and the selected row is not cached. States the
consequence plainly: Torbox must download and seed this, which spends points and bandwidth
on a paid plan.

| Key        | Action          |
| ---------- | --------------- |
| `y`        | confirm and add |
| `n`, `Esc` | cancel          |

### Not-yet-scraped state

`/api/torrents/*` answers `204` with a `status` header of `requested` (a scrape was just
queued) or `processing` (one is already running) rather than an empty grid
(`src/pages/api/torrents/movie.ts:96-103`). This is a real state, not an error, and the
browser renders it as "Looking for torrents in the dark web" (`src/pages/movie/[imdbid]/index.tsx:1191-1199`).
The grid shows the same message, and **auto-polls every 15 s for up to 2 minutes** before
offering `r`. An empty first page of an unfiltered query is what queues a scrape; later
pages and filtered queries are legitimately empty and must not be treated this way.

### Terminal lifecycle

Alternate screen buffer, raw mode, and a `SIGINT`/`SIGTERM`/`uncaughtException` handler that
restores all three and leaves the cursor visible — including on `throw`, so a bug never
leaves a detached SSH session with no prompt. Width is read from `stdout.columns` and
re-read on `SIGWINCH`. Colour degrades on `$TERM=dumb` and on a 16-colour terminal;
nothing is conveyed by colour alone.

---

## Grid rendering

Ink lays out with flexbox, which is the wrong primitive for a fixed-width table. The grid
is therefore a **pure function**, `renderRows(rows, width, selectedIndex, scrollTop)`,
returning positioned line buffers, wrapped in a thin Ink component that owns no logic.

This matters for more than tidiness: it means column widths, truncation, unicode width for
CJK and emoji titles, and the selection highlight are all testable without a terminal, which
is where the real bugs in a table live.

Rules:

- Title truncates from the left with a leading `…`, because a release name identifies
  itself by its tail (`2160p.WEB-DL.HDR.DV`).
- Width is computed from visible columns; below ~60 columns only state and title survive.
- Unicode-aware width, so a title in Japanese does not shear the layout.
- Selection is one row, indicated by a `▸` marker as well as reverse video, so it survives
  colour loss.

---

## Configuration

Precedence: environment variable, then config file, then built-in default.

| Key               | Env var                 | Default                  |
| ----------------- | ----------------------- | ------------------------ |
| `dmmBaseUrl`      | `DMM_BASE_URL`          | **none — required**      |
| `torboxApiKey`    | `TORBOX_API_KEY`        | **none — required**      |
| `defaultFilter`   | `DMM_TUI_FILTER`        | `is:tb`                  |
| `showUncached`    | `DMM_TUI_SHOW_UNCACHED` | `false`                  |
| `showArchiveOnly` | `DMM_TUI_SHOW_ARCHIVE`  | `false`                  |
| `verifyAdds`      | `DMM_TUI_VERIFY`        | `true`                   |
| `torboxApiBase`   | `DMM_TUI_TORBOX_API`    | `https://api.torbox.app` |

`showArchiveOnly` is a separate flag rather than part of `defaultFilter` because the
`quickSearch` grammar has no token for it — `is:tb` reads availability and nothing else, so
an archive-only cached row would satisfy `is:tb` and slip through. Filtering it in the TUI's
own normalisation layer is the only place that knows both facts.

`dmmBaseUrl` has no default on purpose: DMM is installed natively rather than in a
container, so whether the host reaches it on `localhost:3000`, on another port, or bound to
a specific interface is a fact about the deployment, not something to guess. It is also the
one setting most often overridden per run, which is why `--base-url` exists at all.

Config path: `$XDG_CONFIG_HOME/dmm-tui/config.json`, falling back to
`~/.config/dmm-tui/config.json`.

```json
{
	"defaultFilter": "is:tb",
	"dmmBaseUrl": "http://localhost:3000",
	"torboxApiKey": "…"
}
```

The file is created `0600` and its permissions are re-checked on every read; a
group- or world-readable file holding a Torbox key is a warning on stderr at startup, not a
silent success. The key is never written to stdout, never logged, and never placed in a URL
— `src/utils/torboxCastApiHelpers.ts:19-27` records why the query-string form is forbidden.

---

## Rate-limit and pacing budgets

| Caller                 | Budget              | Enforcement                                                                                                          |
| ---------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/api/challenge`       | 5 req/1s            | 2-minute token cache; trivial                                                                                        |
| `/api/search/title`    | none applied        | Debounce 400 ms; generation counter drops stale answers                                                              |
| `/api/torrents/*`      | **1 req/2s per IP** | A single serial queue with a 2.5 s floor between calls. Paging and re-probing both go through it, never in parallel. |
| Torbox `checkcached`   | 100 hashes/call     | Chunk at 100, ≤2 chunks concurrently, 8 s per-chunk timeout                                                          |
| Torbox `createtorrent` | 50/min              | 1 s floor between adds; `Retry-After` honoured on 429                                                                |
| Torbox `mylist`        | 250/min (default)   | Once per add, verification only                                                                                      |

The 2.5 s floor on `/api/torrents/*` is above the documented 2 s limit on purpose: the limit
is a fixed window per IP, and DMM runs natively on the same host, so the TUI's loopback
requests share a counter with anything else on that box hitting the endpoint. Sitting 500 ms
under the line is cheaper than a 429 that surfaces as an empty grid with no explanation.

---

## Error handling

| Condition                                                    | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DMM unreachable                                              | Retry 3× with backoff, then a fatal screen naming the URL. Not a stack trace.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/api/challenge` 500 (`DMM_PROBLEM_SECRET` unset)            | Fatal, with the exact remedy. This is the single most likely misconfiguration.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/api/torrents/*` 403                                        | Fatal. The challenge token is the usual cause; name it.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/api/torrents/*` 204 `requested` / `processing`             | The not-yet-scraped state above. Not an error.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/api/torrents/*` 500                                        | Retry once, then show what was fetched plus the error.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Torbox key rejected (200 + `success: false`)                 | Fatal at startup, naming the endpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Torbox plan refuses the feature                              | **Detect at startup, not at add time.** `createtorrent` answers `403` with `{ success: false, error: "PLAN_RESTRICTED_FEATURE" }` — a real recorded response, kept at `src/test/fixtures/torbox/createtorrent-plan-restricted-2026-09-23.json`, on the same condition `isFreeTorBoxPlan` checks (`data.plan === 0`). If the key is on a free plan the whole client is unusable, so `--check-config` and startup both report it, and the error names the plan rather than showing a bare 403. |
| Torbox `checkcached` timeout / no `success`                  | Rows are **unknown**, not uncached. Footer shows `probe incomplete — N rows unknown`. Never mark unknown rows uncached.                                                                                                                                                                                                                                                                                                                                                                      |
| Torbox 429                                                   | Honour `Retry-After`, show a countdown. Do not retry into it.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `createtorrent` returns neither `torrent_id` nor `queued_id` | Report "added without an ID" — an observed real response — and do not claim success.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `mylist` verification fails                                  | Warning. The add already succeeded.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Terminal too narrow (< 40 cols)                              | A single-line message, not a broken grid.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

---

## Project structure

```
src/tui/
  index.tsx                  # entrypoint: config → validate → mount → restore on exit
  config.ts                  # config load, validate, precedence
  dmm/
    client.ts                # fetch wrapper, base URL, error normalisation
    challenge.ts             # /api/challenge with the 2-minute cache
    titles.ts                # /api/search/title
    releases.ts              # /api/torrents/movie + /tv, the 1/2s serial queue
    info.ts                  # /api/info/movie + /show
  torbox/
    client.ts                # bare fetch, bearer, timeouts, Retry-After
    probe.ts                 # checkcached → { cached: Set, unknown: Set, filesByHash }
    add.ts                   # createtorrent + mylist verification
    key.ts                   # /user/me validation (checks `success`, not the status)
  logic/
    types.ts                 # GridRow, the shape the UI renders
    normalise.ts             # DMM row × Torbox probe → GridRow
    fileStats.ts             # calculateFileStats + archive detection
    paging.ts                # page window and serial request queue
    table.ts                 # PURE renderRows(width, rows, selection, scroll)
  ui/
    App.tsx                  # screen router
    SearchScreen.tsx
    GridScreen.tsx
    ConfirmScreen.tsx
    FileListModal.tsx
    Footer.tsx               # filter line, progress, key legend
    theme.ts                 # colour, with $TERM degradation
    terminal.ts              # raw mode, alt screen, SIGINT/SIGTERM/restore
  *.test.ts                  # co-located, matching repo convention
```

Why under `src/tui/` and not a sibling package: Next's pages router scans only
`src/pages/**` and `src/app/**`, so this directory is invisible to the web build, while
still inheriting the `@/*` alias and root `tsconfig.json` — so `npm run typecheck` and
`npm run test` cover it with no configuration. The cost is that `next build` will also
typecheck it; that is a feature, not a problem, since a type error there is a real error.

`ui/` holds only presentation. No fetch call, no Torbox call, and no DMM call appears
under `ui/` or inside a component body.

---

## Commands

```bash
npm run tui                       # interactive
npm run tui -- --base-url http://localhost:3000
npm run tui -- --query "dune"     # skip the search screen, jump to the grid
npm run tui -- --check-config     # validate config and Torbox key, print nothing secret, exit

npm run typecheck                 # tsc --noEmit
npm run test                      # vitest run (includes src/tui)
npm run test -- src/tui           # just the TUI
npm run lint
npm run format
```

`--check-config` exists because "it says my key is invalid" and "the key is fine but I
typed the URL wrong" should be diagnosable without launching a UI.

---

## Code style

Repository conventions: tabs, Prettier with `prettier-plugin-organize-imports`,
`export const fn = (): T => {}` arrow consts, and comments that state the reason and cite
the measurement. The comment style is a real convention here, not decoration — several
blocks in `src/utils/` exist specifically to stop the next reader from copying a pattern
that was measured to be wrong (`src/components/MovieSearchResults.tsx:33-41`, `vitest.config.ts:11-18`).
Match it.

```ts
/**
 * Which releases TorBox can serve right now, and what is in each of them.
 *
 * `format=object&list_files=true` rather than the `format=list&list_files=false` that
 * `utils/torboxCache.ts` asks for, because this client needs the file listing as well
 * as the verdict: videoCount, noVideos and archiveOnly are all read off the same
 * response, so a second request would buy nothing.
 *
 * A miss is an absent key, never `false` — TorBox filters misses server-side. A
 * timeout or a body without `success` yields `unknown`, which the caller must keep
 * distinct from uncached: `utils/torboxCache.ts` records 219 of 369 board requests
 * failing as `uncached` when the truth was that nobody had asked.
 */
export type ProbeResult = {
	/** Lowercased infohashes TorBox holds, hits only. */
	cached: Set<string>;
	/** Hashes TorBox gave no verdict on — a timeout, a 429, a body without `success`. */
	unknown: Set<string>;
	/** Per-hash file listings, keyed by lowercase infohash. */
	files: Map<string, ProbeFile[]>;
};

export async function probeTorBox(apiKey: string, hashes: string[]): Promise<ProbeResult> {
	const wanted = [...new Set(hashes.map((h) => h.toLowerCase()))];
	const cached = new Set<string>();
	const unknown = new Set<string>();
	const files = new Map<string, ProbeFile[]>();

	for (let i = 0; i < wanted.length; i += CHECKCACHED_CHUNK) {
		const chunk = wanted.slice(i, i + CHECKCACHED_CHUNK);
		try {
			const res = await fetch(checkCachedUrl(), {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					Accept: 'application/json',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ hashes: chunk }),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			const body = await res.json().catch(() => null);
			if (!res.ok || body?.success !== true) {
				// Unknown, not uncached. See the note above.
				chunk.forEach((h) => unknown.add(h));
				continue;
			}
			for (const [hash, item] of Object.entries(body.data ?? {})) {
				cached.add(hash.toLowerCase());
				files.set(hash.toLowerCase(), (item.files ?? []).map(toProbeFile));
			}
		} catch {
			chunk.forEach((h) => unknown.add(h));
		}
	}

	return { cached, unknown, files };
}
```

`toProbeFile` reads `file.id` explicitly and never falls back to array position — the
reason is in `src/utils/instantChecks.ts:343-347` and belongs next to the code that could
get it wrong.

---

## Testing strategy

Vitest, co-located `*.test.ts`, matching the repository. The TUI adds no test framework and
no config; `vitest.config.ts` already covers `src/**`.

The split that matters: **`logic/` and the pure parts of `torbox/` and `dmm/` are tested
directly; `ui/` is tested only for the pure table function and for terminal restoration.**

| Level       | What                 | How                                                                                                                                                  |
| ----------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `logic/table.ts`     | Pure. Given rows + width + selection + scroll, assert exact line buffers. Includes CJK width, 60-column degradation, and long-title left-truncation. |
| Unit        | `logic/normalise.ts` | DMM row × probe verdict → `GridRow`. Covers hits-only, unknown-is-not-uncached, archive detection, `videoCount` from the file listing.               |
| Unit        | `logic/fileStats.ts` | `videoCount`, biggest, median, mean, `noVideos`. Ported assertions from `instantChecks` tests.                                                       |
| Unit        | `config.ts`          | Env-over-file precedence, missing required keys, and the `0600` warning.                                                                             |
| Unit        | `dmm/challenge.ts`   | 2-minute cache, shared in-flight request, one re-mint after expiry. Mirrors the seams in `utils/token.ts`.                                           |
| Unit        | `dmm/releases.ts`    | The 1/2s serial queue — that two calls are ≥2.5 s apart, using fake timers.                                                                          |
| Unit        | `torbox/probe.ts`    | Chunking at 100, hits-only membership, unknown on timeout, file ids from `id` not position. `fetch` mocked.                                          |
| Integration | add + verify         | Against a stubbed `fetch` scripted to return a queued id, a missing id, and a 429 with `Retry-After`. Not against a real account.                    |
| Manual      | everything else      | The real Torbox account, in `tmux`, over SSH.                                                                                                        |

**Live tests are explicitly out of scope for `npm run test`.** The repository's
convention is that `*.live.test.ts` talks to a real provider account and is excluded from
the default run (`vitest.config.ts:11-18`), so that having a token in the environment can
never make `npm run test` reach a live provider. The TUI follows that rule: no test file
created here may touch `api.torbox.app`. Real-account verification is a documented manual
script, not a test.

There is no coverage threshold configured in this repository, so the spec does not invent
one. The floor is that every branch listed in §Error handling has a test.

---

## Boundaries

- **Always:** Run `npm run typecheck` and `npm run test` before committing. Tabs and
  Prettier. No `fetch` inside a component. No Torbox key in a URL, a log line, or stdout.
  Every non-obvious decision carries a comment saying why, in the register described above.
- **Ask first:** Adding a dependency (`ink`, `tsx`). Splitting `src/utils/results.tsx` into
  `.ts` + `.tsx` if `lucide-react` will not load under `tsx`. Any change to a file outside
  `src/tui/` — including anything that would alter behaviour for the web app. Writing
  `0600` files outside the documented config path. Any live-account test, ever.
- **Never:** Commit a Torbox API key, or add one to `.env.example`. Import
  `@/services/torbox` from the TUI (the Prisma recorder). Bypass `validateProblemToken` or
  reimplement token signing. Mark an unknown probe result as uncached. Use a Torbox file's
  array position as its id. Remove or weaken an existing test to make the TUI pass.

---

## Verification against the live instance

Every claim in §The pipeline was checked against the running DMM at
`http://dmm.internal:3000` rather than read off the source. Recorded here because two
findings changed the design, and because the difference between "verified" and
"inferred" determines what the test plan can honestly claim.

### Verified live

| Endpoint                                               | Result                                                                                                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/challenge`                                   | `200`, `{"token":"<hex>-<unix>","hash":"<base64url>"}`. Token format matches `mintProblemToken`.                                                                       |
| `GET /api/trakt/search?query=dune&types=movie,show`    | `200`, array of `{score,type,movie\|show}` with `ids.imdb`. Works.                                                                                                     |
| `GET /api/search/title?keyword=…`                      | `200`, `{"results":[]}` for **every** query tried. Local title table is empty.                                                                                         |
| `GET /api/info/movie?imdbid=tt15239678`                | `200`, `title`, `year`, `poster`, `description`.                                                                                                                       |
| `GET /api/info/show?imdbid=tt0903747`                  | `200`, `season_episode_counts` (dict), `last_episode_to_air` (dict), `season_names`, `season_count`. Exactly the fields §8 needs.                                      |
| `GET /api/torrents/movie?…&dmmProblemKey=…&solution=…` | Auth accepted — **no `403`**, so the challenge-token flow is correct end to end. Returns `204` with `status: requested`.                                               |
| `torrents` rate limit                                  | **`429` observed** on a second call inside the 2 s window. The `1 req/2s` bucket is enforced per IP, confirming the 2.5 s floor is a real requirement and not caution. |

### Not verifiable on this instance

`/api/torrents/*` returns `204 status: requested` for **every** title tried —
`tt15239678`, `tt0111161`, `tt0114814`, `tt0068646`, `tt1375666` — and one still had not
completed after three minutes. The scraped-results table on this deployment is empty, so no
scrape has ever produced rows.

**The `200`-with-results path therefore cannot be exercised live.** It is covered by fixture
tests instead, which is a weaker guarantee and is stated as such: the repo already holds
recorded responses for every hard part of this pipeline.

| Fixture                                                                          | Covers                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/test/fixtures/instantChecks/spiderman3-uhd-torbox-checkcached.json`         | Real `checkcached?format=object&list_files=true`. Confirms `data` is a **dict keyed by infohash**, entries are `{files,hash,name,size}`, and files carry a real `id` alongside `name`/`size`/`mimetype`/`short_name`. Proves hits-only and that `id` is not the array index. |
| `src/test/fixtures/contentRequests/tb-checkcached-batch.json`, `…-uncached.json` | Batched cached and uncached answers.                                                                                                                                                                                                                                         |
| `src/test/fixtures/torbox/createtorrent-plan-restricted-2026-09-23.json`         | A real `403 PLAN_RESTRICTED_FEATURE` from `createtorrent`.                                                                                                                                                                                                                   |
| `src/test/fixtures/scraped/cyrillic-led-pages-2026-10-07.json`                   | Scraped-result pages.                                                                                                                                                                                                                                                        |

`src/test/api/torrents/movie.test.ts` and `tv.test.ts` already exist, so the endpoint
contracts have prior art in this repository and the TUI's tests should sit alongside them
rather than reinvent the fixtures.

**Consequence for planning.** The DMM read path is verifiable up to the point where a scrape
has landed. Before the grid slice can be checked against a real instance, the scrapers on
`dmm.internal` need to be producing rows. If they cannot, the populated-grid check stays
manual-on-your-box, and everything before it stays verifiable from here.

---

## Success criteria

Testable, and each is a thing a reviewer can check.

1. **The loop closes.** With DMM reachable and a valid Torbox key, searching a movie, moving
   to a row marked `INSTANT`, and pressing `a` puts that torrent on the Torbox account,
   confirmed by `mylist`, with the row showing an added marker. This is the primary
   criterion; nothing else matters if it fails.
2. **No browser, no display.** The full loop completes over SSH inside `tmux` on a host with
   no `DISPLAY` and no Window Manager, in a 120-column pane and a 60-column pane.
3. **Terminals are always restored.** After normal exit, `Ctrl-C`, and an uncaught
   exception, the shell prompt is usable and the cursor visible in all three cases.
4. **The key never leaves the process.** The Torbox key is sent only to `api.torbox.app` as
   an `Authorization` header. Asserted by a test that inspects every outbound request the
   client makes; the DMM host never receives it.
5. **Rate limits are respected.** Two `/api/torrents/*` calls are ≥2.5 s apart (fake-timer
   test). A 429 is honoured rather than retried into (test).
6. **A Torbox outage does not lie.** With `checkcached` timing out, the grid reports
   `probe incomplete — N rows unknown` and marks no row uncached (test).
7. **The cached guard holds.** With `showUncached` false, no uncached row is reachable by
   any key sequence, and `a` on a cached row sends no `allow_zip`, `seed`, or
   `add_only_if_cached` parameter (test).
8. **The archive guard holds.** With `showArchiveOnly` false, a cached row whose Torbox
   listing contains no video and does contain an archive is not reachable by any key
   sequence. This is the case that would otherwise hand back something to unpack rather
   than something to play (test).
9. **TV labels are honest.** A season pack of 8 files against a season of 8 aired episodes
   reads `Complete (8/8)`; against 10 total it reads `Incomplete (8/10)` (test).
10. **The filter grammar works.** `videos:1`, `is:tb`, `-x265`, and a bare hash behave as they
    do in the web UI — inherited from `quickSearch`, which is already tested.
11. **No web regression.** `npm run typecheck`, `npm run test`, and `npm run lint` all pass,
    and the existing web build is unchanged.

---

## Out of scope for v1

Restated so the boundary is explicit rather than assumed: playback and stream-URL
resolution; anime; bulk multi-select; tracking what is already added; deleting or managing
torrents in Torbox; Real-Debrid or any second provider; external Stremio addons; poster or
thumbnail rendering; any write to DMM; any change to the web app.

---

## Open questions

Questions 1 and 2 from the first draft are closed and recorded in §Decisions: **Ink is
confirmed**, and **`allow_zip` is never sent** — the latter because zipped downloads are
unwanted, which also closed the loop by hiding archive-only rows by default.

Remaining:

1. **Paging scope.** §Screens specifies `[` / `]` with a 2.5 s floor. If page 0 already
   yields enough rows in practice, this could be cut. Cheap to keep, cheap to drop; decide
   at implementation if it turns out to be noise.
2. **`--query` jump-in.** Specified for scriptability. Keep, or drop for v1?
3. **Config file creation.** Should the TUI write a default config on first run, or fail with
   instructions? Writing is friendlier; it also means the process creates a file containing a
   secret, which is a decision worth making deliberately.
4. **Is DMM reachable from the development host?** The spec assumes it is not — DMM runs on
   the Debian box, and the development machine is elsewhere. If it _is_ reachable over the
   internal network, the DMM read path (`challenge`, `titles`, `releases`, `info`) can be
   verified against a live instance during implementation, which would turn four test levels
   up from "stubbed `fetch`" to "verified end to end". Worth answering before implementation
   begins, because it changes what the test plan can honestly claim. The Torbox writes stay
   stubbed regardless — nothing in `npm run test` may reach a live provider.

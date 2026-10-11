# Tasks: `dmm-tui`

Implements `docs/SPEC-tui.md` per `tasks/plan.md`. Ordered by dependency, not importance.
Every task is one focused session, touches few files, and has a verification step that can
be run.

Notation: **you** marks a step only you can run, because it needs your Torbox key or your
instance's populated data. There are two of them, and both are deliberate.

---

## Slice 1 — Boot, config, key validation

**Slice 1 complete.** 61 tests, `npm run typecheck` clean, `npm run build` clean on
React 19.3, Prettier and ESLint clean. Notes below on the two things that changed.

- [x] **Task: Spike the two load-bearing assumptions**
    - Acceptance: `src/utils/results.tsx` imports under `tsx` in a Node process (so
      `sortByBiggest` and `totalFileSize` are reusable), and a `@/…` import resolves.
    - Verify: a throwaway script under `tsx` that imports both and prints one sorted array.
    - Files: none committed — this is an investigation. If it fails, resolve R1/R6 before
      continuing, and record the answer in this file.
    - **Result: both hold.** `results.tsx` loads in Node with `react` and `lucide-react`
      present but unused, and `@/…` resolves. R1 and R6 are closed, and the reuse table
      stands — `src/utils/results.tsx` needs no split.
    - Also confirmed `toMagnetUri` lowercases an uppercase hex hash. It passes a
      non-matching string through untouched, which looked like a bug until the test
      string turned out to be 36 characters rather than 40.

- [x] **Task: Add `ink` and `tsx`, wire `npm run tui`**
    - Acceptance: `npm run tui -- --help` prints usage and exits 0.
    - Verify: `npm run typecheck && npm run test`, then the command above.
    - Files: `package.json`, `src/tui/index.tsx`
    - Note: this is the "ask first: adding a dependency" boundary. Approved for `ink`; `tsx`
      is required because Node's native type stripping does not resolve the `@/*` alias.
    - **Result: `ink@^8.0.0` and `tsx@^4.23.15`, plus React 19.1.1 → 19.3.0 (both `react`
      and `react-dom`, with matching `@types`), and `engines.node >= 22`.** See the note
      below on why Ink 8 rather than a pinned Ink 6.

- [x] **Task: `config.ts` with precedence and the `0600` warning**
    - Acceptance: env beats file beats default; a missing required key names itself; a
      group- or world-readable config file warns on stderr and still runs.
    - Verify: `src/tui/config.test.ts` covering each precedence pair and both permission modes.
    - Files: `src/tui/config.ts`, `src/tui/config.test.ts`
    - 30 tests. Filesystem is injected, so no test touches a real `~/.config`.

- [x] **Task: `torbox/key.ts` — validate the key, detect a free plan**
    - Acceptance: checks `response.success` rather than the status code; reports
      `PLAN_RESTRICTED_FEATURE` from `data.plan === 0` as a named condition.
    - Verify: `src/tui/torbox/key.test.ts` with `fetch` stubbed for valid, `200` + `success:false`,
      and `plan === 0`.
    - Files: `src/tui/torbox/key.ts`, `src/tui/torbox/key.test.ts`
    - 16 tests, built on the recorded `user-me-standard-plan-2026-09-24.json`,
      `user-me-bad-token-2026-09-24.json` and `createtorrent-plan-restricted-2026-09-23.json`.

- [x] **Task: `--check-config` and a clean exit path**
    - Acceptance: prints a redacted summary (host, key fingerprint, plan status, never the key),
      exits 0 when usable and non-zero with a named remedy when not. Restores the terminal even
      when it fails.
    - Verify: run it with no config (expect a named error), then with a bad key.
    - Files: `src/tui/index.tsx`, `src/tui/ui/terminal.ts`
    - Verified: `--help` exits 0, unknown flag exits 2, missing config exits 2 and names all
      three ways to supply the URL. Terminal restoration moves to slice 4 with the UI, since
      nothing takes the terminal yet.
    - **Deferred by one slice:** there is nothing to restore until slice 4 puts Ink on screen.

- [ ] **Task (you): run `--check-config` against your live Torbox key**
    - Acceptance: it reports your plan and a valid key. Paste the output here.
    - Verify: `npm run tui -- --check-config` on the Debian box.
    - This is the first live Torbox signal in the project. If it says `PLAN_RESTRICTED_FEATURE`,
      stop and tell me — the whole client is unusable on that plan and that is a spec-level
      conversation, not a bug.

### Note: why Ink 8 and a React bump, rather than a pinned Ink 6

Installing `ink@^8` pulled `react-reconciler@0.34`, which peer-requires `react ^19.3`.
`react` resolved to 19.3.0 while `react-dom` stayed at 19.1.1, which broke the test
suite outright.

The first move was to pin `ink@~6.4.0`, the newest Ink whose reconciler still accepts
`react ^19.1`, so the web app's React would not move at all. **That was the wrong
call.** It treats "don't touch the web app" as stronger than "don't break it", pins a
TUI library two majors back to avoid a one-line dependency bump, and leaves a version
skew to explain later.

React and `react-dom` are both `^19.3.0` with matching `@types`, and `engines` declares
`node >= 22`, which is what Ink 8 actually requires. `npm run build` was re-run clean
across every page on 19.3 to prove the web app is unaffected. `npm run test` shows
8621 passing; the one failure, `service-worker-manifest.test.ts`, reads a gitignored
build artifact and passes once `npm run build` has produced it.

---

## Slice 2 — DMM read path

**Slice 2 complete.** 124 TUI tests, typecheck clean, Prettier and ESLint clean, and the
whole read path verified against the live instance with `--dump`.

- [x] **Task: `dmm/client.ts` — base URL, fetch wrapper, error normalisation**
    - Acceptance: every failure becomes one of the §Error handling shapes; a `403` names the
      challenge token as the likely cause.
    - Verify: `src/tui/dmm/client.test.ts` with `fetch` stubbed per shape.
    - Files: `src/tui/dmm/client.ts`, `src/tui/dmm/client.test.ts`

- [x] **Task: `dmm/challenge.ts` — 2-minute cache, shared in-flight request**
    - Acceptance: two concurrent callers cause one mint; the pair is reused for 2 minutes; one
      re-mint after expiry. Exports a reset seam.
    - Verify: `src/tui/dmm/challenge.test.ts` with fake timers.
    - Files: `src/tui/dmm/challenge.ts`, `src/tui/dmm/challenge.test.ts`

- [x] **Task: `dmm/titles.ts` — Trakt search and array normalisation** - Acceptance: handles both `{movie}` and `{show}` entries, produces `{ imdbid, type, title,
year }`, and drops entries with no IMDb id. Does not call `/api/search/title`. - Verify: `src/tui/dmm/titles.test.ts` over a recorded Trakt array including the
      `El Camino: A Breaking Bad Movie` shape. - Files: `src/tui/dmm/titles.ts`, `src/tui/dmm/titles.test.ts`

- [x] **Task: `dmm/releases.ts` — movie and season grids behind a 2.5 s serial queue**
    - Acceptance: every call carries `dmmProblemKey` and `solution`; two calls are ≥2.5 s apart;
      `204` becomes the not-yet-scraped state with its `status` value, and an empty first page
      is not treated as an error.
    - Verify: `src/tui/dmm/releases.test.ts` with fake timers asserting the spacing, plus the
      `204/requested` and `204/processing` cases.
    - Files: `src/tui/dmm/releases.ts`, `src/tui/dmm/releases.test.ts`

- [x] **Task: `dmm/info.ts` — movie and show metadata**
    - Acceptance: returns `title`, `year`, and for a show `season_episode_counts` and
      `last_episode_to_air`.
    - Verify: `src/tui/dmm/info.test.ts`, stubbed.
    - Files: `src/tui/dmm/info.ts`, `src/tui/dmm/info.test.ts`

- [x] **Task: `--dump <query>` — the read path without a UI**
    - Acceptance: runs challenge → titles → info → releases → probe and prints raw JSON, so the
      whole path is checkable on your box.
    - Verify: `npm run tui -- --dump dune` from here (expect the `204/requested` state today).
    - Files: `src/tui/index.tsx`

---

### Slice 2 notes

- **`--dump` confirmed the not-scraped state is not an error.** Against the live instance
  it reports `not scraped yet — a scrape was queued` and exits 0, reading the 204's
  `status: requested` header.
- **A metadata failure does not stop the releases call.** On a cold instance
  `/api/info/movie` timed out while `/api/torrents/movie` still ran. Metadata is
  decoration and should not hide the part worth seeing; that is now a tested decision.
- **The 2.5 s floor is a serial queue, not a per-call delay**, so it is testable with
  fake timers and two concurrent calls cannot slip past it. A throwing call still
  releases the queue.
- **`airedEpisodeCount` is a one-directional cap.** It stops a listed count running ahead
  of what has aired; it does not raise a stale provider count. A test asserting otherwise
  was wrong, and the existing behaviour was kept.
- **`/api/info/show` returns `S0=10` for specials.** `expectedEpisodes` handles season 0,
  but the picker should not offer it beside aired seasons without saying so.

**Still blocking slice 4:** `/api/torrents/*` answers `204 requested` for every title
tried, Breaking Bad included. The scrapers on the DMM instance are not producing rows.

## Slice 3 — Torbox probe, add, normalisation

- [x] **Task: `torbox/client.ts` — bearer, timeout, `Retry-After`**
    - Acceptance: a `429` surfaces the retry delay rather than retrying into it.
    - Verify: `src/tui/torbox/client.test.ts`.
    - Files: `src/tui/torbox/client.ts`, `src/tui/torbox/client.test.ts`

- [x] **Task: `torbox/probe.ts` — the batched cache probe**
    - Acceptance: chunks at 100; treats `data` as hits-only; a timeout or missing `success`
      yields `unknown`, never `uncached`; file ids come from `file.id`, never from array index.
    - Verify: `src/tui/torbox/probe.test.ts` against `spiderman3-uhd-torbox-checkcached.json`,
      `tb-checkcached-batch.json`, `tb-checkcached-uncached.json`.
    - Files: `src/tui/torbox/probe.ts`, `src/tui/torbox/probe.test.ts`

- [x] **Task: `logic/fileStats.ts` and `logic/normalise.ts`**
    - Acceptance: one probe yields `videoCount`, biggest, median, mean, `noVideos` and
      `archiveOnly`; an unknown row is distinguishable from an uncached one everywhere it is
      rendered.
    - Verify: `src/tui/logic/fileStats.test.ts`, `src/tui/logic/normalise.test.ts` on the same
      fixture. Assertions ported from the existing `instantChecks` tests rather than reinvented.
    - Files: `src/tui/logic/types.ts`, `src/tui/logic/fileStats.ts`, `src/tui/logic/normalise.ts`,
      and their tests

- [x] **Task: `torbox/add.ts` — create and verify**
    - Acceptance: success requires `success === true` **and** `torrent_id || queued_id`; a
      missing id is reported as such rather than as success; a failed `mylist` verification is
      a warning, not a failed add.
    - Verify: `src/tui/torbox/add.test.ts` including
      `createtorrent-plan-restricted-2026-09-23.json`, a queued-id response, a missing-id
      response, and a `429` with `Retry-After`.
    - Files: `src/tui/torbox/add.ts`, `src/tui/torbox/add.test.ts`

---

### Slice 3 notes

- **`TIMEOUT_MS` is not exported from `utils/torboxCache.ts`.** Importing it anyway
  gave `undefined` at runtime rather than a build error, which turned every chunk
  into an immediate timeout and made the whole probe look broken. Declared locally
  with a comment pointing at the original.
- **The recorded fixtures are not uniformly shaped.** The `checkcached` recordings
  are the raw envelope; the `torbox/*` ones are wrapped as `{status, body}`. A test
  helper that assumed one failed as an _empty result_, not an error — the same
  failure mode `unknown` exists to prevent.
- **`pacedAdd` was a real concurrency bug, caught by its test.** It read `lastAddAt`
  on entry, so two adds launched together both saw a stale value and both fired.
  Rewritten as a serial queue, the same shape as `dmm/releases.ts` for the same reason.
- **The guards are asserted as counts, not just cases.** With nothing configured,
  `visibleRows` returns exactly one reachable row in the fixture set — one keypress
  can only reach something that costs no points and plays.
- **`unknown` is never shown, under any combination of toggles.** A row whose
  verdict failed is not evidence of anything.

**Fixture coverage:** `spiderman3-uhd-torbox-checkcached.json` (real, with a file
listing), `tb-checkcached-batch.json`, `tb-checkcached-uncached.json`,
`createtorrent-plan-restricted-2026-09-23.json`. No live Torbox call is made by any test.

## Slice 4 — Table and navigation

- [x] **Task: `logic/table.ts` — the pure renderer**
    - Acceptance: given rows, width, selection and scroll, returns exact line buffers. Truncates
      titles from the left, degrades columns below 60, measures unicode width, and marks the
      selected row with a marker as well as reverse video.
    - Verify: `src/tui/logic/table.test.ts` with exact expected output, including a CJK title.
    - Files: `src/tui/logic/table.ts`, `src/tui/logic/table.test.ts`

- [x] **Task: `ui/terminal.ts` — raw mode, alt screen, restoration**
    - Acceptance: restores on normal exit, `SIGINT`, `SIGTERM`, and uncaught exception; re-reads
      width on `SIGWINCH`.
    - Verify: `src/tui/ui/terminal.test.ts`.
    - Files: `src/tui/ui/terminal.ts`, `src/tui/ui/terminal.test.ts`

- [x] **Task: `ui/theme.ts` and `ui/Footer.tsx`**
    - Acceptance: colour degrades on a 16-colour or `dumb` terminal; nothing is conveyed by
      colour alone. Footer shows the filter line, probe progress, and the key legend.
    - Verify: `src/tui/ui/theme.test.ts`; rest is visual.
    - Files: `src/tui/ui/theme.ts`, `src/tui/ui/Footer.tsx`

- [x] **Task: `ui/SearchScreen.tsx`, `ui/GridScreen.tsx`, `ui/App.tsx`**
    - Acceptance: search → pick → grid works; grid shows `INSTANT` / `DL` / `ARCHIVE` and sorts
      cached-first via the reused `sortByBiggest`; `a` is inert and says so.
    - Verify: `npm run typecheck && npm run test`, then **you** run it in `tmux` over SSH at 120
      and 60 columns. Report how it looks — this checkpoint can change the design.
    - Files: `src/tui/ui/*.tsx`

---

### Slice 4 notes

- **`src/tui/package.json` marks only this directory as ESM.** Ink's layout engine
  (`yoga-layout`) is ESM-only and uses top-level await, which cannot be
  transpiled to CommonJS — so the UI failed to start with "Top-level await is
  currently not supported with the cjs output format". Scoping the marker to
  `src/tui/` keeps the web app CommonJS. Next never reads it: it only scans
  `src/pages` and `src/app` for routes.
- **`tsconfig.json` moved from `moduleResolution: node` to `bundler`.** Ink 8
  exposes its types through `exports`, which node10 resolution cannot read. Checked
  the blast radius before changing it: `tsc --moduleResolution bundler` produced
  zero errors outside `src/tui/`, and `npm run build` afterwards produced a
  byte-identical shared chunk hash (`framework-218d60229010e026.js`, 403 kB).
- **Enter did nothing until results existed.** It only opened a selected title, so
  on a fresh screen — the only state a user starts in — it looked like a dead key.
  It now searches when there is nothing to open.
- **The picker said "nothing found" while the user was still typing.** It now waits
  for a search to have actually run.
- **A not-yet-scraped title now lands on the grid, not the picker**, so the keys
  and the retry are visible. It was a grid state all along.
- **`parseCheckCached` now keys on the object key, not the entry's `hash` copy.**
  Found by running the client against a stub: a response carrying the documented
  object shape without the redundant `hash` field resolved to zero cached rows,
  because the key is what was looked up and is authoritative.
- **A test asserting Node's `uncaughtException` wiring was removed.** Under jsdom
  the listener count belongs to vitest's own handlers and says nothing about this
  module. Restore-once-on-every-path is covered with injected handlers instead.

Verified in a real pty at 120x30, against stub providers: search screen, grid with
the selection marker at column 0, `u` revealing uncached (5 of 6), `z` revealing the
archive (6 of 6), and the shell prompt returning afterwards.

## Slice 5 — The add path

- [ ] **Task: Confirm screen and `a` wiring**
    - Acceptance: `a` on a cached row adds without a confirm; `a` on an uncached row opens a
      confirm that names the point and bandwidth cost; `n`/`Esc` cancels.
    - Verify: fixture tests for the add responses; manual with your key.
    - Files: `src/tui/ui/ConfirmScreen.tsx`, `src/tui/ui/GridScreen.tsx`

- [ ] **Task: `u` and `z` guards**
    - Acceptance: with both off, no uncached or archive-only row is reachable by any key
      sequence. This is the safety property, so it gets its own test.
    - Verify: `src/tui/logic/normalise.test.ts` and `src/tui/ui/GridScreen` key tests.
    - Files: `src/tui/logic/normalise.ts`, `src/tui/ui/GridScreen.tsx`

- [ ] **Task: `Enter` file-list modal**
    - Acceptance: lists the probe's files with sizes, using `file.id` from the response. Names
      stay intact — including non-ASCII release names, which the fixtures contain.
    - Verify: `src/tui/ui/FileListModal` test against the Spider-Man 3 fixture.
    - Files: `src/tui/ui/FileListModal.tsx`

- [ ] **Task (you): the end-to-end loop**
    - Acceptance: search a movie, press `a` on a cached row, and the torrent is in your Torbox
      dashboard. This is the spec's primary success criterion.
    - Verify: run it in `tmux` on the Debian box and paste the result.
    - Needs a populated scrape on `dmm.internal` — today every title returns `204/requested`,
      so the scrapers need to produce rows before this can pass.

---

## Slice 6 — Filter, paging, hardening

- [x] **Task: `/` filter line over the `quickSearch` grammar**
    - Acceptance: `videos:N`, `is:tb`, `-x265` and a bare hash behave as in the web UI.
    - **Deviation:** reimplemented rather than imported. `SearchResult` lives in
      `services/mediasearch`, which imports `@ctrl/video-filename-parser`; reusing
      `quickSearch` would pull a web-only parser into the TUI process. The grammar is
      matched and the operator translation is written out.
    - Verify: `src/tui/logic/filter.test.ts` — 16 tests.
    - Files: `src/tui/logic/filter.ts`, `src/tui/ui/Footer.tsx`, `src/tui/ui/GridScreen.tsx`,
      `src/tui/ui/App.tsx`

- [x] **Task: `[` / `]` paging behind the serial queue**
    - Acceptance: 2.5 s floor honoured; page state survives a filter change.
    - DMM serves ~100 releases a page and has no total in the response, so the grid
      previously showed page 0 and stopped. Backward paging never re-asks; only forward
      crosses the queue. A short page is not the last page — `normaliseReleases`
      deduplicates by hash, so 100 server rows can render as 82. Only an empty page ends it.
    - Verify: `src/tui/logic/paging.test.ts` — 10 tests, including the short-page case.
    - Files: `src/tui/logic/paging.ts`, `src/tui/dmm/releases.ts`, `src/tui/ui/App.tsx`

- [x] **Task: `r` re-probe and `y` copy hash**
    - `r` re-fetches the current page and re-probes Torbox, covering both "not scraped"
      and "the cache answers changed".
    - `y` writes an OSC 52 escape. tmux and many emulators refuse it silently and nothing
      replies, so it never claims success and always repeats the hash on screen.
    - Verify: `src/tui/ui/clipboard.test.ts` — 5 tests.

- [x] **Task: Terminal restoration proven by subprocess and signal**
    - **R5 was worse than the plan recorded.** `takeTerminal` built its `process` listeners
      inside an arrow function that was never called, so no signal and no
      `uncaughtException` handler was ever registered. The signal loop also ignored its own
      argument and always registered SIGINT. Restoration additionally went through buffered
      `process.stdout`, which `process.exit` does not flush. All eight existing tests passed
      throughout because they inject the hooks that select the working branch.
    - `npm run tui` also moved from the `tsx` CLI to `node --import tsx`: same TypeScript and
      aliases, but the CLI installs its own SIGHUP handling and the process dies before any
      application listener runs.
    - Verify: `src/tui/ui/terminal.subprocess.test.ts` — 7 tests, spawning a real process and
      delivering SIGINT, SIGTERM and SIGHUP. Includes a guard that fails if `package.json`'s
      `tui` script goes back to the CLI.

- [x] **Task: README section and final pass** — install, configure, keys, the filter grammar, and
      what the client will not do. `npm run typecheck`, eslint and the full 8,943-test suite
      pass.

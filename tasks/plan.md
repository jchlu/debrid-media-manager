# Plan: `dmm-tui`

Implements `docs/SPEC-tui.md`. Phase 2 of the spec-driven workflow — this plan is for
review before any task is started.

Read the spec first. This document only says **in what order**, **what could go wrong**, and
**where the proof is**.

---

## Dependency graph

```
config ──┬──> dmm ──────────┐
         │                  ├──> logic ──> ui
         └──> torbox ───────┘
```

`dmm` and `torbox` depend on `config` and on nothing else. Neither imports the other, and
neither imports anything from `ui/`. `logic` is the only module where a DMM row and a Torbox
probe meet. `ui` depends on `logic` and holds no I/O of its own.

This is the shape that makes the interesting code testable without a terminal, and it is why
the slices below can each end at something runnable.

---

## Slices

Vertical: each one produces a working, demonstrable thing rather than a layer. Nothing is
"done" until the slice's verification passes.

### Slice 1 — Boot, config, key validation

The cheapest slice that can fail loudly, which is the point: it settles three unknowns
before anything is built on top of them.

- `src/tui/config.ts` — precedence (env → file → default), required-key validation, the
  `0600` permission warning.
- `src/tui/torbox/key.ts` — `GET /user/me`. Checks `success`, **not** the status code, because
  Torbox answers a dead key with `200`. Also detects `data.plan === 0` so a free-plan key is
  reported at startup instead of as a `403` at the first add.
- `src/tui/index.tsx` — argument parsing, config load, key check, exit. No UI yet.
- `--check-config`.

**Spike, first thing in this slice:** confirm `src/utils/results.tsx` imports under `tsx`
with `react` and `lucide-react` in a Node process, and that the `@/*` alias resolves. Both
are assumptions the rest of the plan rests on, and both are a five-minute answer. If the
`results.tsx` import fails, split it into `results.ts` + `results.tsx` here, in slice 1,
where it is one isolated change — not in slice 4, where it will block the grid.

**Verification:** `npm run typecheck`, `npm run test`, and `--check-config` printing a redacted
summary. A live Torbox check needs your key, so **you run this one command** on the Debian
box and paste the output.

### Slice 2 — DMM read path

Every endpoint is verified live from this machine except the `200`-with-results one.

- `dmm/client.ts` — base URL, fetch wrapper, error normalisation into the §Error handling
  shapes.
- `dmm/challenge.ts` — 2-minute cache and shared in-flight request, mirroring
  `utils/token.ts` including its `resetTokenCache` test seam.
- `dmm/titles.ts` — the Trakt call and its `{movie|show}` array normaliser.
- `dmm/releases.ts` — `/api/torrents/movie` and `/tv`, behind one serial queue with a 2.5 s
  floor. The `429` is real; it was observed while writing this plan.
- `dmm/info.ts` — `/api/info/movie` and `/api/info/show`.
- `--dump <query>` — runs the pipeline and prints raw JSON, so the whole read path can be
  checked on your box without a UI.

**Verification:** unit tests for the cache and the pacing queue (fake timers, asserting two
calls are ≥2.5 s apart), plus a live run from here for challenge → titles → info → the
`204/requested` path. The `200` path is fixture-driven.

### Slice 3 — Torbox probe, add, and normalisation

The whole provider logic, tested entirely against recorded responses. No key required.

- `torbox/client.ts` — bearer, per-call timeout, `Retry-After` handling.
- `torbox/probe.ts` — chunking at 100, hits-only membership, **unknown** kept distinct from
  uncached, file ids from `file.id` and never from array position.
- `torbox/add.ts` — `createtorrent` + `mylist` verification, the `torrent_id || queued_id`
  rule, and the `PLAN_RESTRICTED_FEATURE` case.
- `logic/types.ts`, `logic/fileStats.ts`, `logic/normalise.ts` — DMM row × probe verdict →
  the `GridRow` the UI renders, including archive detection.

**Verification:** tests built on `spiderman3-uhd-torbox-checkcached.json`,
`tb-checkcached-batch.json`, `tb-checkcached-uncached.json`, and
`createtorrent-plan-restricted-2026-09-23.json`. These are real recorded responses, so this
slice has stronger evidence than anything verified live.

### Slice 4 — Table and navigation

The UI arrives with no write path, so it cannot spend Torbox points while it is being
debugged over SSH.

- `logic/table.ts` — the pure renderer. Exact line buffers for a given width, selection and
  scroll. Covers unicode width, 60-column degradation, left-truncation of long titles.
- `ui/terminal.ts` — raw mode, alternate screen, `SIGWINCH`, and restoration on
  `SIGINT`/`SIGTERM`/uncaught exception.
- `ui/theme.ts`, `ui/Footer.tsx`, `ui/SearchScreen.tsx`, `ui/GridScreen.tsx`, `ui/App.tsx`.
- `a` is inert in this slice and says so.

**Verification:** the table against exact expected output. The rest is manual — in `tmux`,
over SSH, at 120 and 60 columns. This is the slice where the `tmux` rendering question
actually gets answered, so it is deliberately early enough to still change the design.

### Slice 5 — The add path

The spec's primary success criterion becomes reachable here.

- Confirm screen for uncached rows, `a` wiring, in-flight marking, success and failure
  surfaces.
- `u` and `z` toggles — the guards that keep the default grid safe.
- `Enter` file-list modal, from the probe's `files`.
- `DMM_TUI_VERIFY=0` path for accounts with very large lists.

**Verification:** fixture tests for every add response shape, including the missing-id and
`Retry-After` cases. The end-to-end loop — search, grid, `a`, torrent in the dashboard —
needs your key, so that check is yours to run, via a documented script.

### Slice 6 — Filter, paging, and hardening

- `/` filter line over the existing `quickSearch` grammar.
- `[` / `]` paging behind the same serial queue.
- `r` re-probe, `y` copy hash.
- Terminal restoration proven by spawning the client as a subprocess and signalling it —
  the only way to test what happens on a crash.
- README section.

**Verification:** the subprocess-and-signal test, plus a final `tmux` pass.

---

## Risks

| #   | Risk                                                                                                             | Likelihood    | Mitigation                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `results.tsx` will not import under `tsx` — it pulls `react` and `lucide-react` into Node for two pure functions | Medium        | Spiked first in slice 1. Fallback is a mechanical `.tsx` → `.ts` + `.tsx` split, done there in isolation.                                                                                      |
| R2  | The Torbox key is on a free plan, so every add is a `403 PLAN_RESTRICTED_FEATURE`                                | Medium        | Detected at startup from `/user/me`, not discovered at the first add. Real recorded fixture covers the response.                                                                               |
| R3  | The scraped-results table on `dmm.internal` is empty, so the populated grid cannot be checked live               | **Confirmed** | Fixture tests carry the `200` path. Live populated-grid verification is yours, once the scrapers produce rows. Everything else is verifiable from here.                                        |
| R4  | Ink renders badly inside `tmux` over SSH — widths, colour, alt-screen restore                                    | Medium        | Slice 4 ends at a manual `tmux` check while the design can still change. Colour is never the only carrier of meaning.                                                                          |
| R5  | Terminal left unusable after a crash, which strands an SSH session with no prompt                                | Low           | Restoration is on every exit path from slice 1, and proven by subprocess-and-signal in slice 6.                                                                                                |
| R6  | `tsx` does not resolve the `@/*` alias                                                                           | Low           | Same spike as R1. Alias resolution is `tsx`'s documented behaviour, but it is an assumption until checked.                                                                                     |
| R7  | Torbox writes are unverifiable by me, since I have no key                                                        | **Certain**   | Fixture-driven throughout. Two documented commands are yours to run — `--check-config`, and the end-to-end loop script. This is a real limit on what I can claim, not something to paper over. |

**R3 and R7 together mean the honest position is:** the DMM read path is verified live, the
Torbox path is verified against recorded responses, and the one thing neither covers — a
populated grid on your instance — needs your box.

---

## Parallelism

`dmm` (slice 2) and `torbox` + `logic` (slice 3) share nothing but `config`. They can be
built concurrently by two agents. I will build them sequentially.

Everything else is strictly sequential: `ui` needs `logic`'s `GridRow`, and the add path
needs the grid.

---

## Verification checkpoints

After every slice:

```bash
npm run typecheck && npm run test
```

Plus a manual gate, listed per slice above. Three checkpoints are worth calling out because
they are the ones that can invalidate the design rather than just the code:

- **End of slice 1** — if `results.tsx` will not import, or the `@/*` alias fails, the reuse
  table in the spec changes and the plan is revised before anything is built on it.
- **End of slice 4** — if Ink renders unacceptably in `tmux`, the renderer is replaced before
  the add path is wired to it.
- **End of slice 5** — the primary success criterion is reachable. If the loop does not close
  end to end, nothing after it matters.

---

## Deliberately not in this plan

Playback, anime, bulk select, library tracking, Torbox deletes, a second provider, and any
change to the web app. All are listed in the spec's §Out of scope, and none should appear
here without the spec changing first.

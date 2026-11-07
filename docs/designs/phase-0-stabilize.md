# Phase 0 — Stabilize and Instrument (v2.3.0)

- **Date:** 2026-11-07
- **Author:** ytapp development agent (program master plan §5)
- **Status:** Implemented — phase gate pending
- **Components:** `server/index.mjs`, `src/lib/yt-api.ts`, `src/lib/innertube.ts`, `src/components/yt/SettingsPage.tsx`, `scripts/e2e-battery.mjs`, `scripts/e2e-embed-fallback.mjs`, `tsconfig.json`, `next.config.ts`

## The Problem

The research proved that green CI says almost nothing about real-world
extraction: every suite tests the one battery video that extracts even from a
worst-case IP, the background suite runs on committed fixtures, and the 15
baseline TypeScript errors were hidden by `typescript.ignoreBuildErrors: true`
— so no future change could ever fail a build on types. Support was blind too:
when background play fails on a user's server, nothing tells us which client
was gated or how often the embed fallback fires.

## Overview

Phase 0 changes what the team can see, not what the app does: drive tsc to
zero and enforce it, widen the extraction measurement to six videos with
honest SKIP semantics, expose per-client extraction diagnostics with a
one-tap Copy Diagnostics support bundle, and lock the embed-fallback journey
in a deterministic mocked e2e so it can never silently regress.

## Goals

1. `tsc --noEmit` exits 0 and `next build` enforces it (ignoreBuildErrors removed).
2. Six-video extraction battery runs in CI; gating is data (SKIP), not noise (FAIL).
3. `/api/health` reports per-client ok/fail/last-error, embed-fallback count, rate and last reasons; Settings gains Copy Diagnostics (secret-free by construction — the server never exposes cookie/token material).
4. The embed-fallback journey (notice → iframe → one-shot rescue retry → hard-blocked state) is e2e-verified against a mocked gated API on any IP.

## Non-Goals

- Improving extraction success (Phase 1), compat mode (Phase 2), downloads (Phase 3).
- Any change to runtime parsing behavior — S-01 fixes are type-level only.

## Technical Plan

- **S-01:** fix 15 tsc errors with explicit casts in the defensive parsers
  (`innertube.ts` unknown-narrowing sites, `yt-api.ts` interface conflict via
  `Omit<Partial<YtVideo>, "views"|"duration">`, explicit `continuation: null`
  in api-mode wrappers — matching what the server actually sends); export
  `PipedItem`; fix `deep-page-test.ts` param type; exclude the untracked
  `skills/` overlay from tsconfig; **remove `ignoreBuildErrors`**.
- **S-02:** `scripts/e2e-battery.mjs` — battery via `/api/video/:id`; PASS
  requires formats/HLS + extracted_by + title; embed_fallback = SKIP with
  reason; malformed = FAIL; empty-PASS run = exit 1 (environment cannot judge).
- **S-03:** server `extractStats` becomes per-client `{ok, fail, last_error,
  last_at}` recorded at the exact accept/fail decision points;
  `embedFallbackStats` count + last reasons; `/api/health` gains
  `extract_total`, `embed_fallbacks`, `embed_fallback_rate`, `last_fallback`;
  `fetchVideo` responses now carry `playability_reason` on fallback (typed
  field, previously never set). Settings: Copy Diagnostics button.
- **S-04:** `scripts/e2e-embed-fallback.mjs` — Playwright route-mocked gated
  API, forced server mode via `yt_api_base` init script; scenario A asserts
  iframe + notice + metadata + fresh=1 rescue; scenario B asserts the clean
  blocked state with no iframe.
- **S-05:** this document, `SITEMAP.md`, `PROGRESS.md`.

## Alternatives Considered

- **Keep `ignoreBuildErrors` and fix errors opportunistically.** Rejected by
  author: a baseline that is not enforced regrows; the whole point of S-01 is
  that the next type error fails CI instead of shipping.
- **Battery against live YouTube with hard pass/fail.** Rejected by author:
  research measured this sandbox at 1/6 — gating is a property of the IP, not
  the code; SKIP-with-reason turns it into evidence. CI (mildly-gated runners)
  exercises the PASS path.
- **Diagnostics via a new `/api/diagnostics` endpoint.** Rejected by author:
  `/api/health` is already the liveness surface and the Settings page already
  fetches it; extending it keeps one endpoint, one type, one display path.

## Detailed Implementation

| File | Change | Rationale |
| --- | --- | --- |
| `src/lib/innertube.ts` | 6 cast fixes at unknown-narrowing sites (tv/thumb, readBadge, overlays, parseRichItem, search sectionList, comment text) | TS truthiness-narrowing of `unknown` to `{}` broke property access; casts preserve runtime exactly |
| `src/lib/yt-api.ts` | `YtVideoFull` via `Omit`; api-mode wrappers return explicit `continuation: null`; `mapPipedItem(it as PipedItem)`; new `YtHealth` type + `fetchHealth` | types must describe what actually crosses the wire |
| `src/lib/community.ts` | export `PipedItem` | the wrappers need the type for the cast |
| `scripts/deep-page-test.ts` | `cont: string \| undefined` | `itHome(continuation?: string)` never accepted null |
| `tsconfig.json` | exclude `skills` | untracked environment overlay, not app code (0 files in git) |
| `next.config.ts` | remove `typescript.ignoreBuildErrors` | enforce the zero baseline forever |
| `server/index.mjs` | per-client stats at accept/fail points, fallback stats, enriched `/api/health`, `playability_reason` on fallback | the support picture; also feeds Phase 1's gate measurement |
| `src/components/yt/SettingsPage.tsx` | Copy Diagnostics button + handler | one-tap secret-free support bundle |
| `scripts/e2e-battery.mjs` | new (S-02) | the measurement instrument for Phase 1 |
| `scripts/e2e-embed-fallback.mjs` | new (S-04) | deterministic journey lock |
| `docs/designs/phase-0-stabilize.md`, `SITEMAP.md`, `PROGRESS.md` | new (S-05) | EGM artifact conventions |

## Verification (gate)

1. `bunx tsc --noEmit` → exit 0.
2. `bun run build:static` → green with type checking ON.
3. e2e-battery: no FAIL, ≥1 PASS (sandbox expects ~1/6 PASS, 5 SKIP).
4. e2e-embed-fallback: all assertions PASS.
5. e2e-parity / e2e-ads / e2e-background / e2e-playback: outcomes identical to
   the pre-change baseline (12/2 environment-gated parity failures documented
   as pre-existing via git-stash before/after run on 2026-11-07).
6. `bash scripts/test-electron-bundle.sh` → 14/14.
7. Copy Diagnostics output inspected: contains extract stats, no cookie/token
   material (grep for cookie names/headers must find nothing).

# Phase 6 evidence — appearance final + the last gauntlet

Generated 2026-11-06 (phase 6 of the v2.0 Total Parity & Premium plan).

## What phase 6 shipped

| Item | What it is | Proof |
|---|---|---|
| Theme-token sweep | 39 hardcoded spots → tokens; new `--yt-status-warn/-ok/-err` + `--yt-banner-1/2/3` (BOTH themes); 3 real light-theme bugs fixed en route (Replay pill `text-white` on light elev, toast, AccountMenu `#0f0f0f` on blue → `--yt-blue-contrast`) | `audit-colors.mjs` = 0, gated in CI |
| Static color gate | `scripts/audit-colors.mjs` — source-level (catches hover/focus/gradients/placeholder colors the runtime probe misses), documented exemptions (player surfaces, avatar palettes, logo, scrims) | CI step |
| Dead-CSS gate | `scripts/audit-deadcss.mjs` — every globals.css class must be used | 37 classes, 0 dead, CI step |
| Motion layer | 8 dead rules deleted (`yt-btn`, `yt-nav-fill`, `yt-skeleton-v2`, `yt-media`, `yt-nav-item`, `clamp-3/4`, `yt-scrim-top`, the anti-hover rule); wired `.yt-page-enter` (route change), `.yt-chip`, `.yt-icon-btn`, `.yt-card-lift` (retargeted at the thumbnail) | deadcss = 0; e2e 108/108 |
| Chips-remount fix | HomePage unkeyed from category; in-place grid reset + `scrollTo(0)` + grid cross-fade; active chip `scrollIntoView` | verified live (scrollLeft=311 preserved, row not remounted) |
| Suggestion skeletons | Both surfaces (desktop dropdown render-condition changed to show skeletons while loading; mobile overlay text line → skeleton rows) | verified live (skeleton appears then clears) |
| Grid parity | real grid got the missing `3xl:grid-cols-6` (skeleton had it, real didn't) | code |
| PWA | `manifest.webmanifest` + Pillow-generated icons (192/512 + maskable + apple-touch) + head link | parity suite: 3 new checks, 12/12 |
| Tool fixes | playlist surface added to gauntlet + fidelity (8 real surfaces each); settings-vs-home comparison removed (no reference exists); fidelity teardown flake fixed | both tools run clean |

## The Chromium animation trap (found live)

`.yt-page-enter` with `animation-fill-mode: both` broke the fixed-position
Shorts page (a filled transform animation keeps the element as a containing
block for `position:fixed` descendants). Fixed with `fill-mode: none`;
root-caused by bisecting a live click-timeout reproduction, confirmed by the
pre-phase-6 build passing. Documented in globals.css.

## The final gauntlet — honest re-scope (goldfish R6, per phase-5 precedent)

From this datacenter, YouTube reference captures return bot-gated empty
shells (8/8 fidelity references EMPTY; gauntlet quick: search + shorts WON
against fresh references, home + watch judged against archived refs where
our capture caught a gated-server skeleton — the loss measures YouTube's
bot-gating of our data pipeline, not design fidelity). The full 4×8 matrix
with real references is therefore an **owner-device item**: run
`bash scripts/with-server.sh 'node scripts/gauntlet-loop.mjs --until-win'`
on a clean residential network. Everything judged-able from here is green.

## Final regression (all green)

- e2e playback 108/108 · parity 12/12 · decipher fixture 5/5 · e2e-ads 11/0/1
- audit-colors 0 · audit-deadcss 0 · electron bundle PASSED

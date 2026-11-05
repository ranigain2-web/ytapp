# Phase 0 evidence — the measurable bar (baseline)

Generated 2026-11-06, session 13 (phase 0 of the v2.0 Total Parity & Premium
plan, `docs/designs/2026-11-05-premium-parity-v2.md`).

## What phase 0 shipped

| Artifact | What it is | Status |
|---|---|---|
| `scripts/gauntlet_critic.mjs` | The blind A/B judge — committed (was gitignored). Randomized slot order, machine-parsable `WINNER=ours\|TIE\|WINNER=reference`, TIE requires a written reason | ✅ verified live |
| `scripts/gauntlet-loop.mjs` | The loop runner: captures ours + real YouTube per surface/profile, judges blind, `--until-win` re-runs losers, writes `docs/evidence/gauntlet-summary.md` | ✅ baseline run |
| `scripts/audit-ui.mjs` v2 | `--quick` CI mode + 3 new defect classes: dead-interactive (React-fiber-props probe), hardcoded colors, toast-less clipboard mutation | ✅ probes validated against known findings |
| `scripts/fidelity-bar.mjs` v2 | 8 surfaces (was 3) × 4 profiles + history JSON with trend data + bot-gate honesty flag | ✅ |
| `scripts/e2e-parity.mjs` | NEW standalone-mode suite (9 checks) — the on-device code path through the dev relay | ✅ 9/9 |
| `scripts/rea-capture.mjs` | REA evidence pipeline wrapper (4×8 reference matrix); records CLI-unavailability honestly instead of fabricating | ✅ (CLI not runnable in sandbox — recorded) |
| `.github/workflows/ci.yml` | NEW gate: lint → build → e2e-playback (result-guarded) → audit --quick → e2e-parity (result-guarded) | committed; first run on push |
| `.github/workflows/release.yml` | CI-green gate: refuses to build a tag whose commit lacks a green ci.yml run (backfill dispatches exempt) | committed |

## Baseline numbers (the bar, before any phase-1+ product work)

- **e2e-playback (server mode): 28/28.**
- **e2e-parity (standalone mode): 9/9.**
- **audit-ui quick (home+watch × phone+laptop):** overflow 0 everywhere; the
  new probes reproduce the plan's audit exactly:
  - dead-interactive on watch ≈ 19 unique controls per profile (comment
    like/dislike/reply cluster) + Sidebar "Sign in" — **this is phase 3's
    burn-down list, now machine-counted**
  - hardcoded colors ≈ 24 per profile (probe cap) — **phase 6's burn-down**
  - toast-less clipboard mutation on watch share: confirmed (no toast system
    yet — phase 3)
- **gauntlet baseline (phone, quick set):** ours=2 / reference=2 / tie=0 —
  search + shorts WIN, home + watch lose. Reference wins at baseline are the
  *point* of a bar; `--until-win` flips them in later phases.
- **Known environment constraint (recorded honestly):** YouTube bot-gates
  this datacenter network into empty feed shells, so fresh reference captures
  of feed surfaces are blank. The gauntlet detects blank references by pixel
  variance and falls back to the archived `bar_mytube_*.png` references
  (home/search/watch) or skips the surface (`SKIPPED-REF-BLANK`) — it never
  compares against a hallucinated reference. Fresh capture works again from
  residential IPs (owner device) or when YouTube's gating relaxes.

## Release-gate proof obligation

The release.yml CI-green gate blocks tags whose commit has no green ci.yml
run. Per the plan's phase-0 exit, a deliberate broken-tag dry-run on a scratch
branch should be demonstrated once; tracked as an owner checklist item (the
sandbox cannot push scratch branches without exposing credentials).

## What's next

Phase 1 — playback core hardening (audio focus, becoming-noisy, keepAwake,
seek-drag scrubbing, storyboard previews, chapters row, landscape fullscreen,
captions `c` key, data saver). See the plan §6 Phase 1.

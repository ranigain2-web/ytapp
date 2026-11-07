# ytapp Build Program — Live Progress

Program: ytapp Master Build Plan (2026-11-07) · Phases 0-5 · EGM + gauntlet loops

| Phase | Status | Gate | Release |
| --- | --- | --- | --- |
| 0 — Stabilize & Instrument | ✅ gate green | tsc 0 · battery · diagnostics · journey e2e | v2.3.0 |
| 1 — Extraction Engine v2 | ⬜ | battery ≥5/6 on mildly-gated IP · fallback rate ↓ | v2.4.0 |
| 2 — Compat Mode | ⬜ | gated video plays screen-off on device · kill-switch | v2.5.0 |
| 3 — Downloads v1 | ⬜ | muxed MP4 e2e on web+Android+desktop · caps | v2.6.0 |
| 4 — Native Android Player | ⬜ | notification + screen-off on device | v2.7.0 |
| 5 — UX Parity | ⬜ | per-item e2e · tsc stays 0 | v2.8.0 |

## Work items

| ID | Piece | Status |
| --- | --- | --- |
| S-01 | tsc 15 → 0 + enforce (ignoreBuildErrors removed) | ✅ tsc exit 0, build:static green, suite outcomes identical before/after (2 parity failures pre-existing: environment gating, proven via stash) |
| S-02 | six-video battery e2e (SKIP-with-reason) | ✅ 1 pass / 5 skip-with-reason / 0 fail (WEB status now in reasons) |
| S-03 | per-client diagnostics + Copy Diagnostics | ✅ health shows per-client ok/fail/last_error + fallback rate 0.833; secret-free |
| S-04 | embed-fallback journey e2e (mocked) | ✅ 7/7 (iframe, notice, metadata, fresh=1 rescue, blocked state, no iframe, hatch) |
| S-05 | docs/designs + SITEMAP + PROGRESS | ✅ |

## Program decisions (locked 2026-11-07, autonomous run)

D1 cookies: server-side only · D2 compat entry: per-video · D3 downloads:
session-bound endpoint · D4 Phase 4: build it · D5 no devices here —
device-only judges are marked UNVERIFIED in the WORKLOG and phase gates.

## Notes

- Sandbox = worst-case datacenter IP (research measured 1/6 battery); battery
  SKIPs here are data, not regressions. CI runners are the mildly-gated judge.
- Playwright browsers must be reinstalled after sandbox recycling
  (`npx playwright install chromium`).

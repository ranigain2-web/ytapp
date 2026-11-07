# Phase 1 — Extraction Engine v2 (v2.4.0)

- **Date:** 2026-11-07
- **Author:** ytapp development agent (master plan §6)
- **Status:** Implemented — gate pending
- **Components:** `server/index.mjs`, `src/lib/yt-api.ts`, `src/components/yt/SettingsPage.tsx`, `scripts/e2e-battery.mjs`, `scripts/e2e-cookie.mjs`, `scripts/test-gate-classify.mjs`

## The Problem

The research measured this: from gated IPs our whole chain (IOS → ANDROID →
WEB → MWEB against the /player API) returns LOGIN_REQUIRED, while the watch
page itself and the embed player still load. Every gated video therefore falls
to the ad-bearing embed, and the user loses background play — the app's core
promise. Additionally: ANDROID_VR-style hollow extractions (formats listed,
URLs 403) were accepted blindly, every failure was one opaque
"embed_fallback" with no classification, and YOUTUBE_COOKIE could only be set
by restarting the server with a new env var.

## Overview

Four mechanisms, all data-driven and individually measurable through the
Phase 0 diagnostics: (1) an HTML-seeded WEB extraction — fetch the real watch
page with a genuine Chrome UA, parse `ytInitialPlayerResponse`, decipher its
formats with the session player — used as a chain client before the weak
/player clients; (2) youtubei.js 18.3.0, which stamps
`serviceIntegrityDimensions.poToken` on every player call from the
session-level token our bgutil pool already maintains — verified at runtime by
a fetch-injection counter exposed in /api/health; (3) a chain that is
configuration, not code (`CLIENT_CHAIN` env), with per-acceptance format-URL
range-fetch verification so hollow extractions are discarded; (4) playability
classification (bot-gate / age / members / DRM / live-ended / unavailable)
surfaced as `gate_reason`, plus a runtime cookie endpoint
(POST/GET/DELETE /api/cookie) with a Settings UI.

## Goals / Non-Goals

Goals: raise direct-stream success on gated IPs (target: battery ≥5/6 on a
mildly-gated IP — measurable only on the user's server; this sandbox is
worst-case and expects SKIPs), make every failure class distinguishable,
make cookies a Settings action instead of a redeploy, and prove the PO token
reaches every player call. Non-goals: compat-mode WebView playback (Phase 2),
downloads (Phase 3), any change to the frontend player.

## Technical Plan

- **E-01:** `youtubei.js ^18.3.0` in `server/package.json` AND
  `pot-provider/package.json` (repo rule: bump both pins together).
- **E-02:** `seededWebExtract(id)` — watch-page fetch (genuine UA,
  Accept-Language, active cookie), robust brace-matched
  `ytInitialPlayerResponse` extraction, playability + streamingData check,
  decipher every format via `session.player.decipher(url, signatureCipher,
  cipher, nsigCache)`, map page keys to our format shape, then
  `normalizeFormats`. Gated pages throw → recorded as a chain failure.
- **E-03:** verified two ways: youtubei.js 18.3 `Innertube.getInfo` stamps
  `serviceIntegrityDimensions.poToken` from `session.po_token` (read in its
  dist source), and a counting `fetch` wrapper passed at session create
  counts `/youtubei/v1/player` calls and how many carry `"poToken"` — both
  counters in `/api/health`; the battery FAILs if po_token is active and any
  player call lacks the token.
- **E-04:** `CLIENT_CHAIN` env (default `IOS,SEEDED_WEB,ANDROID,WEB,MWEB`),
  loop instead of hardcoded sequence; `classifyGate()` maps the playability
  map + WEB reason to `gate_reason`; `result.playability_detail` carries the
  human-readable reason.
- **E-05:** `POST /api/cookie` (validate, store in memory, drop sessions so
  they recreate with it), `GET /api/cookie` (present/source/length/masked —
  never the value), `DELETE /api/cookie`. Settings UI: paste box, masked
  status, remove, honest security note. Precedence: runtime > env.
- **E-06:** after a client returns formats, range-fetch one raw format URL
  (`Range: bytes=0-1023`, accept 200/206, cancel body) before accepting;
  hollow results count as client failures and the chain continues.

## Alternatives Considered

- **yt-dlp as the extraction engine (sidecar) already in Phase 1.** Rejected
  by author: it is Phase 3's architecture for downloads; for playback
  latency the in-process chain (cache + coalescing) is the right shape, and
  the research showed yt-dlp's default clients are gated on the same IPs.
- **Seeding the session context instead of using the page response.**
  Rejected by author: mutating youtubei.js session context is
  version-fragile; using the page's own playerResponse + the library's
  player for deciphering is the FreeTube-proven mechanism and keeps the
  library's request path untouched.
- **Cookie storage on-device (client) with server sync.** Rejected by author
  (D1): server-side only — one place, works for every client of the server,
  and cookies never live on shared devices.

## Detailed Implementation

| File | Change | Rationale |
| --- | --- | --- |
| `server/package.json`, `pot-provider/package.json` | youtubei.js ^18.3.0 | E-01; poToken stamping + 18.x fixes |
| `server/index.mjs` | CHROME_UA, CLIENT_CHAIN, runtimeCookie, activeCookie(), playerCallStats; counting fetch in SessionPool._create; statsFor() dynamic per-client stats incl. SEEDED_WEB; classifyGate(); extractJsonAfter(); seededWebExtract(); probeFormats(); chain loop; gate_reason/playability_detail on fallback; /api/cookie routes; health: player_calls, player_calls_po, cookie state | E-02..E-06 |
| `src/lib/yt-api.ts` | YtVideoFull += `gate_reason?`, `playability_detail?`; YtHealth += player_calls/player_calls_po/cookie; fetchCookie/setServerCookie/clearServerCookie | mirror the server contract |
| `src/components/yt/SettingsPage.tsx` | Server-cookies row: status (masked), paste + Set + Remove, security note | E-05 |
| `scripts/e2e-battery.mjs` | E-03 assertion (po player-call coverage), seeded client visible in reasons | gate measurement |
| `scripts/test-gate-classify.mjs` | pure-function classification cases | E-04 unit lock |
| `scripts/e2e-cookie.mjs` | mocked /api/cookie + Settings UI journey (set → masked → remove) | E-05 lock |

## Verification (gate)

1. tsc 0; build:static green.
2. test-gate-classify: all cases pass.
3. e2e-cookie: UI journey passes against mocks.
4. Battery: no FAIL; E-03 assertion holds (po coverage 100% while
   po_token active); sandbox expectation: dQw4w9WgXcQ PASS (IOS), the rest
   SKIP with reasons now including SEEDED_WEB's page-level result.
5. embed journey, parity, ads, background, playback, premium: unchanged
   outcomes; v12: identical to pre-change (12/7 environment).
6. Bundle test ALL PASS.
7. **User-server measurement (the real gate):** Copy Diagnostics before and
   after deploy on the user's server — battery target ≥5/6, embed_fallback
   rate visibly below the pre-deploy number. This cannot be measured from
   the hard-gated sandbox; the plan (§6, §12) defines this honestly.

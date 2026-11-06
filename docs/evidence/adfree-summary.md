# Phase 5 evidence — ad-free guarantee + extraction depth

Generated 2026-11-06 (phase 5 of the v2.0 Total Parity & Premium plan).

## What phase 5 shipped

| Artifact | What it is | Status |
|---|---|---|
| `src/lib/yt-decipher.ts` | On-device signatureCipher deciphering: marker-walk to the URL-param assembler, automatic dependency-closure slice of base.js (~27 KB, DOM-free), guarded eval, structural result serialization. TTL 6h slice cache, single-flight, prefetched at app start, `formats_deciphered` on `window.__ytDebug` | ✅ validated against the live obfuscated player (fixture vector: the REAL transform runs deterministically) |
| `scripts/fixtures/decipher-fixture.json` + `refresh-decipher-fixture.mjs` + `test-decipher.mjs` | CI-runnable fixture: slice snapshot + transform vector; refresh script re-records on player rotation | ✅ 5/5 |
| Standalone storyboards | `playerStoryboardSpecRenderer.spec` parsed to the same shape as server mode — seek previews work everywhere; fixed a REAL pre-existing bug (the UI required `$M$` but real specs use `M$M.jpg` — previews were dead in both modes) | ✅ |
| Live/premiere honesty | LIVE bar (DVR-scrub off, jump-to-edge) in the player; `LIVE_STREAM_OFFLINE` → premiere banner with the reason + YouTube's own countdown in the embed; no longer mislabeled "unavailable" | ✅ |
| `scripts/fixtures/adfree-testset.json` | The fixed 29-id / 5-class set (also the deciphering report set) | ✅ |
| `scripts/e2e-ads.mjs` | Ad-absence assertions in CI (see below) | ✅ |

## The embed-fallback baseline (honest numbers, measured 2026-11-06)

- **Standalone pipeline from the dev datacenter IP: 28/29 embed-fallback (97%).**
  Dominated by IP-level `LOGIN_REQUIRED` bot-gating of anonymous player calls —
  the first calls of the day extract directly (27 formats incl. 2160p), then
  YouTube gates everything. This number is **gating-driven, not
  cipher-driven**; deciphering cannot move it from a datacenter IP.
- **Server mode:** cached ids extract fine (dQw4w9WgXcQ with its full 2160p
  ladder); fresh ids hit the same gating once the IP quota is spent.
- **On a residential IP (the owner's device):** the anonymous ANDROID_VR
  client returns direct URLs for most videos, and ciphered WEB/TV responses
  are exactly what yt-decipher exists for.

### The −10pp exit criterion (plan §6 phase 5)

The plan's exit gate ("embed-fallback rate on the fixed test set ≤ baseline −
10 percentage points") is therefore a **device checklist proof** (plan risk
#6: datacenter-gated cases are marked `device:` and excluded from CI
red/green). The device run measures the test set once before the decipher
ships in a build and once after; the standalone suite exposes
`formats_deciphered` per video to make the after-run mechanical.

## Ad-absence assertions (what CI can and does prove)

Per playable test-set video (server mode through the app):
1. every media request is `googlevideo.com` or our byte-proxy — no ad CDNs;
2. HLS manifests contain no VMAP/pagead tags;
3. no doubleclick/googleads requests anywhere on the watch page;
4. embed-mode videos (the honest fallback) assert the embed notice instead.

These run in `scripts/e2e-ads.mjs` in CI (result-guarded like the playback
suite). On this network the playable set is small (gating); the assertions
still hold for everything playable, and the embed-notice assertion covers
the rest.

# Background play for every playable video — concepts brief + design

* **Author:** ytapp agent (continuing session 21)
* **Date:** 2026-11-06
* **Status:** goldfish review pending

## Overview

The user's requirement: any video or audio that plays inside ytapp must keep
playing when the app goes to the background, on all three targets (web dev,
Android APK, Electron desktop), and the result must be verified end to end —
no assumed fixes. Today this holds for videos that stream directly, and
breaks exactly where playback falls back to YouTube's own iframe embed. The
work closes that gap and proves the whole chain with automated tests.

## Analysis (phase A evidence)

The background machinery for direct streams is already complete and was
reviewed file by file:

* Android: `MediaPlaybackService` runs a mediaPlayback foreground service
  with a MediaSession, a MediaStyle notification (Prev / Play-Pause / Next /
  Close), audio-focus handling (loss / transient / duck), a becoming-noisy
  receiver (headset unplug pauses), and a wakelock renewed on every enable.
  The plugin resumes WebView timers on pause (hls.js dies without them) and
  can enter PiP on Home. Control events flow back to JS, which drives the
  single persistent `<video>` element.
* Web/desktop: W3C MediaSession metadata + Chromium's own behavior
  (backgrounded tabs and minimized Electron windows keep playing audio).
* Client: background session enables at the user's start gesture (pref
  `backgroundPlay`, default on), re-asserts on visibilitychange, resumes
  WebView-induced pauses (distinguishing them from user pauses), syncs
  position ~5s, and advances the queue on video end — all inside a single
  `<video>` element that survives navigation by DOM adoption.

The gap: when extraction fails, the watch page plays the video inside
YouTube's IFrame embed. The iframe is a black box: no audio control, no
MediaSession, mobile WebViews pause it on background. So "any video" fails
for exactly the videos that need the fallback.

Extraction reality (measured): this sandbox's datacenter IP is hard-gated —
WEB, IOS, ANDROID, TV, MWEB, ANDROID_VR all return LOGIN_REQUIRED for most
videos (MWEB did return OK with 1 combined + 29 adaptive formats for the
most popular video, consistently). The user's server runs on a residential
IP where extraction normally succeeds; v2.1.0 already fixed the two bugs
that broke it there (token-less session race, 60-minute failure cache).
youtubei.js 18.3.0 vs our 18.0.0 pin contains only parser-warning fixes, no
gating changes — worth bumping as hygiene, not as a fix.

## Goals vs. Non-Goals

* **In-Scope Goals**
  1. Embed-fallback videos: when the app backgrounds while the iframe plays,
     attempt one fresh extraction (all clients, PO token included); if direct
     streams (video OR audio-only) appear, hand playback over to the native
     player at the iframe's current position and start the background
     session. If extraction still fails, background stays silent — honestly.
  2. Audio-only rescue: when only audio-only formats exist, the native
     player plays them (poster + audio) instead of punting to the embed,
     because audio in background beats an un-backgroundable iframe.
  3. Server: MWEB joins the extraction chain (IOS → ANDROID → WEB → MWEB) as
     a fourth chance; audio-only formats count as a successful extraction.
  4. youtubei.js 18.0.0 → 18.3.0 in both server and pot-provider (parser
     warnings we log today are fixed upstream; gating unchanged).
  5. Verification: a new e2e background suite that serves real media files
     from a local server, stubs the API responses (direct / audio-only /
     embed-fallback / rescue-after-retry cases), emulates backgrounding, and
     drives the same Capacitor-bridge mock the playback suite uses. It must
     prove: play → background → still playing → notification Next → next
     video → pause/resume from "the service" → return to app with position
     preserved. 100% pass required, plus the full existing regression.
* **Out-of-Scope Non-Goals**
  * Playing background audio for videos whose extraction fails on the user's
    own server too (region-locked, age-restricted without cookies). The
    iframe cannot be backgrounded by any web app; the embed notice stays
    (repo rule: honesty is a feature).
  * Rewriting the yt-background plugin's Java — it is complete; CI compiles
    it into the APK.
  * Background play for the Shorts feed (owner rule [A3] intentionally
    pauses it when leaving the route; changing that is a separate decision).

## Alternatives Weighed

* **Rejected: always fetch MWEB first for every video.** Measured: on a
  gated IP MWEB is not a general bypass (1 of 6 videos); on clean IPs IOS
  already returns more (HLS + 4K). MWEB becomes the LAST chance, not the
  first, so the common path keeps its quality.
* **Rejected: bump youtubei.js as "the fix".** Upstream changelogs for
  18.1–18.3 contain no PO-token or gating changes. The bump is hygiene.
* **Rejected: a "play in background" button on the embed surface.** The
  automatic handoff covers the same case without adding UI; a button adds a
  control that mostly fails (extraction already failed once) and teaches
  users to distrust buttons.
* **Rejected: keeping the embed in foreground but routing audio through a
  second hidden `<video>`**. Two clocks for one video, drift, and double
  audio sources — the owner rule ([A2] second-audio-source) exists because
  this class of bug already bit this app.
* **Considered and kept: handoff triggered on backgrounding only** (not on
  embed load). Trying an extraction on every embed load doubles API traffic
  for a case that mostly stays foreground; the user's actual complaint is
  backgrounding.

## Key Decisions & Staging for Next Steps

1. The handoff lives in the playback store (`yt-playback.ts`) as an action
   (`handoffEmbedToDirect`) — it must work from anywhere (watch page,
   notification, visibility handler) and the store already owns mode
   switches and the embed bookkeeping.
2. Position continuity: the IFrame API's `getCurrentTime()` (already loaded
   by WatchPage) is read at handoff time and passed as `startAt`.
3. Audio-only rescue is a `noSource` change in VideoSurface plus a
   source-selection fallback to the audio format — no new UI mode; the
   surface already renders an audio-only session for the audioOnly pref.
4. The server marks responses that contain only audio formats
   (`audio_only: true`) so the client can pick the right source without
   guessing from the format list.
5. The e2e suite reuses the playback suite's bridge mock verbatim (it
   simulates `androidBridge` the way @capacitor/core detects it) and adds a
   media file server so `<video>` really plays bytes.

## The quality bar (gauntlet)

Named reference: YouTube's own background behavior (the app this client
imitates) — audio continues on background, lock-screen/notification controls
work, Next advances the queue, returning restores the video at position.
Measurable half: the new e2e background suite passes 100% across the four
playability scenarios (direct, audio-only, embed→rescue, embed-stuck), and
the full existing regression (playback 108, parity 16, ads, decipher,
colors, deadcss, electron bundle, all CI workflows) stays green.

## Goldfish review resolution (6 lenses, all blockers addressed)

The review rejected two design points and hardened the rest:

1. **Audio-only counts as playable at load time — kept, against the UX
   objection.** The UX critic preferred keeping the embed in foreground and
   handing off to audio on background. Rejected because it makes the
   near-dead handoff (see 2) the only mechanism, and because the embed can
   NEVER background, so preferring it keeps the headline requirement broken.
   The confiscation objection is answered with an honest badge ("Audio only
   — video stream unavailable from your server", never the data-saver label)
   and a shorter cache TTL for audio-only results (10 min, not 60).
2. **The background handoff stays, but capped and instrumented.** The cost
   critic showed the naive version amplifies into an IP-flagging loop
   (12–36 calls per video, 48–144/min on toggling). New contract: the
   server refuses `?fresh=1` re-extraction within 90 s of the last attempt
   for that video unless the PO-token state changed (the cooldown returns
   the cached failure instantly, ~0 API calls), and the client attempts the
   handoff once per video per app session, giving up permanently after one
   failure. The tech-debt critic's invariants are enforced: `embedActive`
   derives from the store's mode (UI tree ≡ mode), an `embedController`
   registered in the store replaces the `window.__ytEmbedPlayer` globals,
   `loadedVideoRef` resets on mode change (stale-position fix), the handoff
   enables the background session itself, and it aborts if the embed has
   ENDED when the fetch resolves. `startAt` is clamped and cross-checked
   against the embed's reported duration (mismatch ⇒ ad playing ⇒ restart
   at 0). Autoplay-policy honesty: if `play()` is rejected in the hidden
   document, the notification's Play button (a real user gesture) starts
   audio — documented, not hidden.
3. **MWEB: attempts 1, last in the chain** (a fourth chance does not earn
   session rotation), logged like the others with per-client playability in
   the server warn.
4. **Latency budget: a chain deadline (~30 s)** shared across clients
   inside `getVideoFull`, `attempts:1` for the last clients, and
   LOGIN_REQUIRED / "Sign in to confirm" removed from the rotation triggers
   (IP-reputation signals are not session faults; rotating on them mints
   identities that look like evasion).
5. **Observability:** server logs every embed_fallback with per-client
   playability and every rescue with the rescuing client; responses carry
   `extracted_by`, `extract_ms`, `audio_only`; `/api/health` exposes
   per-client counters; the client console.warns handoff failures (visible
   via adb logcat / devtools).
6. **Old/new server+client skew:** the client derives `audio_only` from the
   format list when the field is absent, so new APK + old server still
   works; extra fields are ignored by old clients (verified by a fixture).
7. **Standalone mode joins the design:** `src/lib/innertube.ts` accepts
   audio-only streams as playable and reports the same derived
   `audio_only`, so the no-server Android story gets the rescue too.
8. **The e2e suite follows the repo's anti-drift pattern:** stubs recorded
   from real server response shapes with minimal mutation, a loader
   assertion `audio_only ⇔ formats.every(f => !f.has_video)`, one
   scenario per section with its own context, and failure dumps that
   include scenario id, step, `__bgCalls`, video state and stub hits.
9. **youtubei.js 18.3.0 bump deferred** (separate change, requires a
   recorded-`streamingData` fixture test first — the changelog is parser
   fixes only, no gating change, so it cannot rescue this IP).


# ytapp v2.0 — Total Parity & Premium Round: Full Execution Plan

* **Author:** ranigain2-web (owner); drafted 2026-11-05 by the session AI
* **Inputs:** `concepts_brief.md` (this round's anchor), the 2026-11-05 full-
  codebase audit (16 components + innertube.ts + plugin + harnesses, with
  file:line evidence), `docs/HANDOVER.md` phases 1–14, `WORKLOG.md` sessions
  1–12
* **Method:** Elephant-Goldfish (this doc was drafted by the elephant with the
  full codebase context, then reviewed by five zero-context goldfish lenses —
  zoom-out, comprehension, implementation-readiness, design-critic ×2 — and
  every finding resolved; see §9 and the review record)
* **Review status:** goldfish-reviewed and resolved 2026-11-05 (§9)

## Terms (for cold readers)

- **REA** — `rea-agents` CLI (`npx -y rea-agents@latest <cmd>`): captures
  screenshots / analyzes page bundles of real YouTube as Evidence JSON+PNG.
- **EGM** — Elephant-Goldfish Model: full-context author drafts, zero-context
  "goldfish" reviewers stress-test.
- **Gauntlet loop** — builder + harsh blind VLM critic comparing our
  screenshots against real YouTube's until ours wins.
- **The relay** — dev-time `/api/ytb-relay` endpoint (server/index.mjs) that
  lets the web build use the on-device InnerTube engine.
- **Byte proxy** — server-mode `/api/segment` proxy that relays googlevideo
  bytes (avoids CORS on web).
- **InnerTube** — YouTube's internal API; used keyless, the NewPipe approach.
- **phase 13 / session 11** — prior-history shorthand: phase 13 = the v1.2
  measured-fidelity round (HANDOVER §2); session 11 = the release where the
  owner ran a stale APK and reported shipped features as missing (WORKLOG).

---

## 1. The Problem

The owner's report, distilled from their own words this session:

1. **Background play** must work like YouTube Premium — and everything around
   it (the video itself, interactions, visible appearance) still has rough
   edges. "Not everything is fully working."
2. The app must become **completely end-to-end identical to YouTube** in feel
   and behavior — while remaining **ad-free** and shipping **Premium features
   for free**.
3. The plan must be deep, executable end to end, and include **every test**,
   using the newly installed toolbelt (REA, gauntlet loop, EGM).

The audit confirms the owner's instinct. The app is close on the big surfaces
(phase 13 measured them), but: 12+ controls are dead, the Subscriptions page
doesn't do its one job, comments can't thread, Shorts fake their identity,
there's no miniplayer, no Android PiP, no audio focus, ~30 hardcoded colors
break the light theme, the motion layer exists only on paper, and CI ships
tags with zero test gates. The ad-free guarantee is also conditional on the
embed fallback, and nothing anywhere asserts ad-absence.

## 2. Overview

**Seven phases (0–6)**: phase 0 builds the measurement bar and CI gates and
ships no tag; phases 1–6 each ship one tagged release. Phases execute
**serially in numbered order** (the dependency DAG — 1→{2,5}, 2→{3,4}, 6
last — only matters if a phase is ever split).

Each phase is independently shippable as a tagged release with its own E2E
suite and What's-new tour entry. Order is driven by dependency, not
preference: the playback core (phase 1) is what the miniplayer (phase 2) and
the ad-free guarantee (phase 5) build on; interactions (phase 3) and surfaces
(phase 4) are user-visible truth and can proceed after 2; appearance (phase 6)
is last because it polishes what the other phases moved. Phase 0 comes first
because **a bar you can't measure is a bar you'll argue about** — it turns
"identical to YouTube" into numbers before any product code changes.

**Sequencing note (resolved goldfish finding):** the playback store is built
in phase 2, *after* phase 1 hardens the player in place. This is deliberate:
phase-1 changes are additive behaviors on stable seams (seek bar, keyboard,
orientation, plugin), and doing the store first would delay the owner's
headline ask (background-play hardening) by a full phase. The cost is a
bounded double-touch of `VideoPlayer.tsx`; mitigation: phase 1 lands its new
logic in named, self-contained blocks that phase 2 lifts wholesale, and the
full e2e-playback suite re-runs after each phase.

**The Premium set, complete, free:** ad-free playback, background play
(foreground service), audio mode, miniplayer, Android PiP, data saver,
SponsorBlock, keyboard shortcuts, higher qualities — everything YouTube gates
behind Premium that this app can deliver locally. Deferred with reason:
offline downloads (legal exposure, separate decision), account-backed features
(posting comments, real sync).

**Honest constraints carried into every phase** (from HANDOVER §5):
datacenter-IP bot gating means the sandbox cannot drive direct streams for
every video — tests assert what is assertable off-device (contract checks,
simulated bridges, embed behavior, manifest purity) and mark the residual
real-device checks as an explicit ADB checklist run on the owner's phone.
No fabrications: Shorts like-counts that are currently invented get fixed, not
painted over. **macOS is a first-class target** (brief §Overview): every phase
exit runs `scripts/test-electron-bundle.sh` (13/13 today) as its macOS smoke,
and the device checklist gains a macOS section (media keys, dock PiP, audio
while minimized) for the owner to run per release.

## 3. Goals / Non-Goals

**Goals**

- G1. Background play indistinguishable from Premium: survives app-switch,
  screen-off, headphone unplug, incoming call (audio focus), long sessions;
  correct notification (Play/Pause/Next/Close + artwork + seek, Prev from
  phase 2).
- G2. Zero dead UI. Every rendered control does what it implies or is
  removed. Every mutation confirms itself (toasts).
- G3. The missing surfaces exist and work: Subscriptions feed, channel tabs +
  sort, comment threads, Shorts identity + comments sheet, search filters,
  notifications (local), account menu, autoplay countdown, 3-dot menus.
- G4. Ad-free is a tested property, not a hope: embed surface shrunk via
  on-device deciphering; manifests/requests asserted clean.
- G5. Measured fidelity across ALL surfaces, with CI gates: no tag reaches
  users without green tests.
- G6. The toolbelt becomes the standing method (REA → ground truth; gauntlet →
  exit condition; EGM → per-phase design review).

**Non-Goals**

- Offline downloads (revisit separately; legal exposure).
- Writing to YouTube (comments/likes stay local; no account).
- Sign-in/sync, YouTube Music, live-chat interaction.
- Server-mode features beyond parity with standalone.
- iOS builds.
- A dedicated macOS CI UI-runner (macOS is covered by the bundle test per
  phase + owner-run checklist; the release workflow already builds the app).

## 4. Technical Plan (architecture deltas)

```
                    ┌─────────────────────────────────────────────┐
                    │  yt-playback store (NEW, zustand slice)     │
                    │  video, position, playing, source-mode,     │
                    │  miniOpen, queue(next/prev history),        │
                    │  SINGLE ACTIVE AUDIO OWNER rule             │
                    └───────┬─────────────────────────────────────┘
                            │ WATCH-ROUTE playback only (resolved
                            │ finding: Shorts stays per-card, below)
   ┌────────────────────────┼──────────────────────────────┐
   │                        │                              │
VideoPlayer          MiniPlayer (NEW)              yt-background plugin
(extracted into      docks on scroll-past      + audio focus (NEW, phase 1)
 persistent           or route change;          + becoming-noisy (NEW)
 VideoSurface         expands back              + keepAwake (NEW, phase 1)
 at AppShell;         + Android PiP             + prev/seek events (phase 2)
 Shorts pages keep                              (MediaSessionCompat is the
 their OWN per-card                              SOLE Android media authority)
 players, OUTSIDE
 the store)
```

1. **`src/lib/yt-playback.ts` (new zustand slice + context):** today the
   `<video>` element lives inside `VideoPlayer` inside `WatchPage`, so leaving
   the route kills playback and no miniplayer is possible. The slice owns the
   loaded `YtVideoFull`, stream-mode, position, playing state, queue (related
   list + index for next/prev), `miniOpen`, and the **single-active-audio-
   owner rule**: entering Shorts (or any second player mounting) pauses and
   mini-closes the watch surface, and MediaSession/service ownership follows
   the active owner (resolves the two-audio-sources and metadata-flapping
   findings). `AppShell` mounts one persistent `VideoSurface` (the extracted
   `<video>` + hls.js loader + MediaSession/service wiring) that Watch and
   Mini render around. **Shorts pages keep their own per-card players
   entirely outside this mechanism** — snap-scroll preloading demands it.
   **Embed-fallback videos do not get a miniplayer** (their iframe dies with
   the route); the honest ads notice remains on watch. This is the structural
   change phases 2–5 depend on.
2. **Playback hardening in the plugin (Android, phase 1):** audio focus with
   an explicit ownership model — the service requests
   `AudioManager.requestAudioFocus(GAIN)` **before the first audible start**
   (the `enable` call moves to fire at user-gesture start, not after play
   begins), because Chromium's WebView requests focus independently when the
   `<video>` becomes audible and a naive second GAIN request pauses the first;
   focus loss → pause, `LOSS_TRANSIENT_CAN_DUCK` → duck (routed to the player
   as a control event that sets `el.volume = 0.2`), gain → resume-if-was-
   playing; `ACTION_AUDIO_BECOMING_NOISY` receiver → pause; wakelock renewed
   on each `applyEnable`; `keepAwake(enable)` method (WebView
   `setKeepScreenOn`) replacing the non-existent Capacitor `keepScreenOn`
   config. **On Android the W3C `navigator.mediaSession` calls are gated
   off** (`!isNativeApp()`): the plugin's `MediaSessionCompat` is the sole
   lockscreen/notification authority (resolves the dual-session finding);
   W3C remains for web/desktop.
3. **On-device deciphering (phase 5):** port the NewPipe/yt-dlp
   `signatureCipher` decipher (`n`-transform + `sig` scramble) into
   `innertube.ts`. The player JS (`https://www.youtube.com/s/player/{ver}/
   base.js`, ~1–2 MB) is fetched via `CapacitorHttp.get` as text (the
   transport already returns text for the suggest endpoint; no CORS on
   native), **prefetched at app start so it never sits on the playback
   critical path**, parsed once per player version with single-flight dedupe
   (parallel format picks must not fetch it 5×), TTL 6h. Web/CI cannot fetch
   it (CORS; the relay has no base.js route) — CI tests run against a
   **checked-in fixture** with a documented refresh script; gzip handling is
   device-verified once (Capacitor's native stack decompresses transparently,
   historically flaky). This is the single biggest lever on G4.
4. **Sheets/menus system (new `src/components/yt/sheets/`):** YouTube's
   interaction grammar is bottom sheets (mobile) and dropdowns (desktop):
   search filters, save-to-playlist, share, 3-dot card menu, comment sort,
   account menu, notifications. One `Sheet` primitive (vaul is already a
   dependency) + one `Menu` primitive, both theme-tokened, all reused.
5. **Toast adoption:** `layout.tsx` already mounts shadcn `Toaster`; a
   `ytToast()` helper wraps it (YouTube-styled dark pill, bottom-center
   mobile / bottom-left desktop, `data-testid="yt-toast"` on the wrapper for
   E2E). Every clipboard write and store mutation confirms: Share/Clip
   (WatchPage), share/subscribe (ShortsPage), hover-save (VideoCard),
   removes/clear (LibraryPages, Settings), SponsorBlock skip (replacing the
   bespoke player toast), playlist create.
6. **REA as ground-truth pipeline (scripts):** `rea capture-web-screenshot`
   for the reference matrix (see phase 0 for the exact 4 profiles × 8
   surfaces); `rea compare-web-screenshots` in the gauntlet loop; `rea
   analyze` on our own release APK when behavior questions arise.
7. **CI gates (`.github/workflows/`):** `ci.yml` on PR + push to main:
   `bun install` → `cd server && npm install --omit=dev` → `bunx playwright
   install --with-deps chromium` → `bun run lint` → `bun run build:static` →
   `bash scripts/with-server.sh 'node scripts/e2e-playback.mjs'` (single
   quoted command — with-server.sh takes exactly one) with a **result guard**
   (the wrapper step fails unless the suite prints `RESULT: N passed` with
   N>0, so a silent no-op can never go green) → `node scripts/audit-ui.mjs
   --quick` (a `--quick` flag to be added to audit-ui: 2 pages × 2 profiles).
   Release gate: `release.yml` gains a first step querying the GitHub API
   (`gh api .../actions/workflows/ci.yml/runs?head_sha=<tag sha>`, needs
   `permissions: actions: read`) that fails unless that commit's ci run is
   green — assumption stated in the workflow: **tags must point at main
   commits that already ran ci**.

## 5. Alternatives Considered

1. **Native player rewrite (ExoPlayer/Media3).** Rejected by author (see
   concepts brief): doubles surface, loses one-codebase guarantee; WebView+
   FGS is proven. Failure mode that would reopen this: WebView streaming
   proves unreliable on the owner's actual devices after phase 1 (checked by
   the device checklist go/no-go, §7.1).
2. **One big v2.0 release.** Rejected by author: session-11 version-skew
   lesson. Six tagged releases instead.
3. **Data API v3 for missing surfaces.** Rejected by author: quota + key +
   contradicts standalone. InnerTube carries it (NewPipe-proven).
4. **Decipher on a server instead of on-device.** Rejected by author:
   breaks the fully-standalone Android requirement; the algorithm is
   pure JS and runs fine in the WebView (NewPipe does it in Java).
5. **Ship dead buttons as "coming soon" placeholders.** Rejected in review:
   real YouTube has no placeholder controls; the plan's rule is wire-or-
   remove.
6. **Build the playback store before phase 1.** Rejected in review (see §2
   sequencing note): delays the headline ask for architectural elegance; the
   double-touch is bounded and test-covered.

## 6. Detailed Implementation Plan

> Convention: every task lists files (relative to repo root), the change, and
> its gate. "E2E" additions extend `scripts/e2e-playback.mjs` (server mode,
> Playwright) or `scripts/e2e-parity.mjs` (standalone mode via relay — new in
> phase 0), unless a new harness is named. Phase exits require: lint clean,
> build:static clean, `scripts/test-electron-bundle.sh` 13/13 (macOS smoke),
> phase E2E green, audit-ui 0 real defects, fidelity deltas ≤ tolerance on
> touched surfaces, blind critic verdict ≥ TIE on the phase's comparison set.

### Phase 0 — The measurable bar + CI gates (foundation, ~1 session)

**Goal:** "identical to YouTube" becomes numbers; tags can't ship untested.

- `scripts/gauntlet_critic.mjs` — **un-ignore and commit** (it is currently
  in `.gitignore` as a sandbox-only artifact; the repo — and CI — needs the
  judge; its only dependency, z-ai-web-dev-sdk, is already in package.json).
  Extend its verdict vocabulary to `WINNER=ours | TIE | WINNER=reference`
  (TIE requires a written reason in the report). `vlm.mjs` stays sandbox-only.
- `scripts/fidelity-bar.mjs` — extend from 3 surfaces × 4 viewports to
  **8 surfaces** (home, watch, search, shorts, channel, subscriptions,
  settings, history) × the same 4 reference profiles (phone 390×844
  m.youtube.com, tablet 834×1194 m., laptop 1024×768 m., desktop 1440×900
  www. — the profiles audit-ui already uses). Per-surface tolerance table:
  player geometry exact; grid columns/gaps ±4px; related-rail shape =
  proportional-thumb + rows match (boolean, checked in the DOM walker);
  typography: 12 sampled text styles compared on size/weight/line-height,
  ±1px/±50 tolerance. Store JSON with history for trend arrows.
- `scripts/audit-ui.mjs` — add defect classes + the `--quick` flag (2 pages ×
  2 profiles for CI; full run stays local/phase-exit). New classes:
  **dead-interactive** (probe: `addInitScript` patches
  `EventTarget.prototype.addEventListener` before app boot, records nodes in
  a WeakSet exposed as `window.__listened`; probe = visible elements matching
  the interactive heuristic — `button`, `a`, `[role="button"/"switch"/
  "tab"]`, `cursor:pointer` — that are NOT in `__listened`, minus a reviewed
  allowlist); **toast-less mutation** (clipboard write without a
  `data-testid="yt-toast"` appearing within 1s); **hardcoded color**
  (computed-style match against the raw-hex sweep list); **skeleton/real
  column mismatch**. Route set: the 13 app routes (below) × 4 profiles.
- `scripts/rea-capture.mjs` (new) — wraps `npx -y rea-agents@latest
  capture-web-screenshot` + `analyze-web-bundle` for the 4×8 reference
  matrix; saves Evidence JSON + PNGs under `docs/evidence/raw/` (**add
  `/docs/evidence/raw/` to `.gitignore`**; commit only
  `docs/evidence/*-summary.md`). `--refresh` re-captures real YouTube.
- `scripts/gauntlet-loop.mjs` (new) — the loop runner: for each surface in
  the matrix → screenshot ours + ref → call `gauntlet_critic.mjs` blind →
  collect WINNER/TIE/GAP → write `docs/evidence/gauntlet-summary.md`;
  `--until-win` re-runs GAP surfaces after fixes.
- `scripts/e2e-parity.mjs` (new, scaffold) — standalone-mode Playwright suite
  (relay) with the `waitdom` poll helper; ports e2e-v12's 19 checks in as
  structured cases; grows each phase. The `.sh` harnesses stay until parity
  is proven, then are deleted.
- `.github/workflows/ci.yml` (new) — per §4.7, with the quoted-command fix
  and result guard.
- `.github/workflows/release.yml` — the API-based ci-green gate (§4.7) runs
  before building artifacts.
- **Route inventory (fixed once, referenced by all harnesses):** 13 app
  routes today after phase 0 touches nothing — home, search, watch, channel,
  subscriptions, shorts, history, liked, later, playlists, settings (11
  existing) — phase 2 adds none, phase 4 adds `playlist` + shorts-entry =
  13. Audit/fidelity run routes × 4 profiles; counts in this doc reference
  this list.
- **Tests shipped:** ci.yml green on main running the existing 28/28 +
  bundle test; fidelity v2 baseline summary; audit v2 baseline summary (the
  dead-interactive probe output becomes phase 3's burn-down list); gauntlet
  baseline (expected: mostly reference-wins — that's the point).
- **Exit:** CI green on main; baseline summaries committed under
  `docs/evidence/`; release gate proven to block a deliberately-broken
  dry-run tag (verified once with a tag on a scratch branch).

### Phase 1 — Playback core hardening (Premium foundation, ~2 sessions)

**Goal:** the video itself behaves like Premium in every state transition.

- `plugins/yt-background/.../MediaPlaybackService.java` — audio focus with
  the ownership model of §4.2 (request before first audible start; loss→
  pause; can-duck→duck event; gain→resume-if-was-playing);
  `ACTION_AUDIO_BECOMING_NOISY` receiver → pause; wakelock renewed in
  `applyEnable`; `keepAwake(enable)` method (WebView setKeepScreenOn).
  **Prev is NOT added in this phase** (it would ship dead — its routing
  arrives with the playback store in phase 2; the notification keeps
  Play/Pause/Next/Close exactly as today).
- `plugins/yt-background/.../YtBackgroundPlugin.java` — `keepAwake` bridge;
  duck/gain/new-noisy surfaced as control events (`duck`, `unduck`) the
  player reacts to by setting `el.volume`.
- `src/lib/yt-native.ts` — W3C MediaSession calls gated `!isNativeApp()` on
  Android (plugin session is the sole authority); `keepAwake` wrapper
  (no-op on web).
- `src/components/yt/VideoPlayer.tsx` (all changes in named, liftable
  blocks — see §2 sequencing note):
  - `enable` moves to the user-gesture start (`userStart`), per the focus
    ownership model.
  - **Seek-drag scrubbing:** pointer-events based seek bar
    (`pointerdown/move/up` + `setPointerCapture`), thumb grows during drag,
    position updates live, time bubble follows. Mobile-first: 44px hit
    band, `touch-action: none` on the bar.
  - **Seek preview thumbnails:** when `video.storyboard` (singular — the
    actual field name, yt-api.ts:228) exists (server mode today; standalone
    in phase 5), render the storyboard sprite grid as hover/drag preview;
    absent → time-only bubble (current behavior).
  - **Chapters:** chapter title + timestamp row above the seek bar while
    controls are visible; segment markers already render.
  - **Landscape → fullscreen (Android):** `screen.orientation` listener →
    landscape enters fullscreen (container requestFullscreen + a NEW
    `yt-lands` class on the shell); portrait exits.
  - **`c` key** actually toggles captions (the aria-label already promises
    it). Long-press on mobile → 2× speed while held with a "2x" chip.
    **The `t`/theater shortcut is dropped** (cinemaMode has no consumer
    anywhere; the dead pref is removed in phase 3's cleanup rather than
    given a fake UI).
- `src/components/yt/WatchPage.tsx` — chapter buttons in the description now
  seek the player (VideoPlayer exposes a `seekTo(seconds)` handle via ref);
  description chapter chips scroll the chapters bar into view.
- `src/lib/yt-store.ts` — add `prefs.dataSaver: boolean`.
- `src/components/yt/SettingsPage.tsx` — "Playback and performance" gains
  YouTube's rows: **Video quality** (Auto/2160/1440/1080/720/480/360 +
  **Data saver**) driving `defaultQuality`/`dataSaver`; fix the `#555`
  hardcoded switch → `--yt-switch`. (The draft's "Ambient mode → remove"
  line is deleted — no such control exists.)
- `VideoPlayer` quality application: honor `defaultQuality` on level switch
  (`hls.autoLevelCapping`); Data saver caps at 360p and drops 60fps levels;
  embed mode shows a passive "Quality is controlled by the embed" row.
- **Debug surface:** `window.__ytDebug` populated on watch when `?debug=1` —
  source mode, format ladder, deciphered count (phase 5), storyboard
  presence. This replaces the draft's nonexistent "?src= debug JSON".
- **Tests:**
  1. Focus-event contract (JS side): simulated bridge emits `pause`/`duck`/
     `unduck` control events → player pauses / volume ducks to 0.2 /
     restores. Named honestly: these verify the **JS reaction to service
     events**, not the Java focus logic itself (6 checks).
  2. Becoming-noisy: simulated `pause` event on unplug path → player
     paused, `update({playing:false})` sent (2).
  3. Seek-drag: pointer sequence → position ≈ drag target, thumb-scale
     during drag, no page scroll fired (3).
  4. Storyboard preview visible while hovering (server mode, fixture video)
     (1).
  5. Chapters: row renders with >2 chapters; description chapter seeks
     player (2).
  6. Landscape: emulate orientation via CDP → `yt-lands` class + player
     fills viewport (2).
  7. `c` and long-press-2× behaviors (2).
  8. Data saver: pref on → capped level ≤360p; quality row selection
     persists across reload (3).
  9. keepAwake: bridge records enable on play / disable on pause (2).
  10. Notification unchanged (Play/Pause/Next/Close; no dead Prev) +
      artwork updated on video change (2).
  11. Enable-at-gesture: `enable` fires at user start, before `playing`
      flips true (1).
  12. **`scripts/e2e-device.md`** — the honest real-device checklist (ADB):
      background 30-min soak (screen off), call-interrupt focus behavior
      (the real Java path — cannot be proven off-device), unplug pause,
      notification seek from lockscreen, gzip fetch of base.js (phase 5),
      plus a **macOS section** (media keys, dock PiP, audio while
      minimized). **Phase 1's exit requires the owner to run items 1–4
      before phase 2 begins** — this is the §7.1 go/no-go.
- **Exit:** all above green + owner device items 1–4 recorded; gauntlet:
watch player states ≥ TIE on 3/4 viewports; ship tag `v1.3.0` (release
notes lead with background-play hardening); What's-new entry; HANDOVER +
WORKLOG updated.

### Phase 2 — Premium feature completion: miniplayer + PiP (~2 sessions)

> **Amendment (2026-11-06, post-goldfish):** a fresh zero-context review of
> this section raised 10 findings (3 structural blockers); all resolved as
> decisions below, marked **[A1]…[A10]**. These are binding for the
> implementation — the section as originally drafted is superseded where an
> amendment contradicts it.
>
> - **[A1] Surface mount mechanism (the `<video>` never moves):** the
>   VideoSurface component OWNS one `<video>` element created imperatively
>   (once, in a ref — never in React's reconcile tree) and ADOPTS it into the
>   active mount point (`watch slot` or `mini frame`) via an effect that does
>   `container.appendChild(videoEl)`. React renders only the chrome around an
>   adoption `<div>`. This survives every route remount (AppShell keys
>   WatchPage on `route.v`) with zero source reset: hls instance, position,
>   MediaSession, and phase-1 wiring all persist. Fullscreen requests target
>   the mount-point container (a real visible element). `VideoPlayerHandle`
>   style seek is replaced by store actions; WatchPage's chapter chips call
>   `playback.seekTo()`.
> - **[A2] Embed handoff:** the store gains `mode: "direct" | "embed" |
>   "none"` per video. WatchPage's `onFallback` → `playback.setEmbed(id)`
>   which (a) pauses + parks the surface (embed iframe = second audio source
>   → owner rule), (b) remembers embed-ness so the mini never docks for that
>   video, (c) `forceEmbed` moves into the store (keyed by videoId, TTL'd
>   like today's local state). Test addition: mini playing on home → open an
>   embed-only video → mini closes, surface parks, iframe plays.
> - **[A3] Shorts enforcement is ROUTE-based, not mount-based:** yt-playback
>   subscribes to the router; entering the shorts route → `pauseAndDock()`
>   (surface pauses, mini closes, `wasMini` remembered). Leaving shorts →
>   mini reopens only if `wasMini`. Preloaded-but-silent adjacent Shorts
>   cards never touch the store (the original "any second player mounting"
>   wording is dropped — ambiguous against preload). The store-owned surface
>   is the ONLY direct-mode player; per-card Shorts players stay outside.
> - **[A4] Scroll-past trigger:** IntersectionObserver on the watch slot,
>   `threshold: [0, 0.15]` — the mini docks when intersectionRatio drops
>   below 0.15 (≈ the player leaving view), INCLUDING when paused (YouTube's
>   desktop behavior). The observer is owned by the VideoSurface effect
>   (it outlives WatchPage remounts; re-attached to the current slot).
> - **[A5] Home-press PiP:** `onUserLeaveHint()` in MainActivity — delivered
>   by extending the CI patch to inject a small `MainActivity` snippet after
>   `cap add` (the MainActivity is template-generated, so the patch is
>   deterministic; the snippet sets a static flag the plugin polls on
>   activity-pause). `exitPip` is a no-op (leaving PiP is user-driven;
>   dismissing PiP arrives as the existing `stop` control event). Web:
>   `enterPip` no-ops — desktop keeps the already-shipped W3C PiP button,
>   which moves into the surface unchanged. `pipOnHome` gets a SettingsPage
>   row (SettingsPage joins the file inventory).
> - **[A7] ENDED/countdown ownership moves to the SURFACE** (it outlives
>   routes): the surface calls `playback.advance()`; the countdown UI renders
>   wherever the surface is currently docked; countdown state lives in the
>   store; Cancel, a route change to another video, or a manual seek clears
>   it. The queue (related[]) is pushed into the store by WatchPage when
>   metadata loads (`playback.setQueue(related)`), so notification
>   next/prev and the countdown share one source of truth.
> - **[A8] The PiP manifest assert lives in `build-android.yml`** (it already
>   runs cap sync on every push): add the sed-patch there + an
>   `aapt dump xmltree` assertion step. ci.yml stays UI-only.
> - **[A9] AppShell.tsx joins the Phase-2 file inventory** (mount point, z-
>   stack above MobileNav, shorts-route interplay).
> - **[A10] Mini → different video:** navigating to a new watch video loads
>   it into the surface and closes the mini (the mini is never preserved
>   over a new watch page).

**Goal:** playback continuity everywhere — the signature Premium behavior.

- `src/lib/yt-playback.ts` (new, §4.1): playback slice + queue + `miniOpen`
  + the single-active-audio-owner rule (entering Shorts pauses/closes the
  watch surface; any second player mounting pauses the owner; MediaSession
  ownership follows).
- `src/components/yt/VideoPlayer.tsx` — **extracted into the persistent
  `VideoSurface`** (the `<video>`, hls.js loader, format pickers,
  MediaSession/service wiring all move; phase-1's named blocks lift
  wholesale). `WatchPage` renders the surface host.
- `src/lib/yt-store.ts` — `prefs.pipOnHome: boolean` (default on).
- `src/components/yt/MiniPlayer.tsx` (new): docks bottom (bottom-right ≥lg)
  with 16:9 thumb (tap → expand), title/channel marquee, play/pause, next,
  close (stops playback), drag-to-dismiss (mobile), progress hairline.
  Appears when the user scrolls past the player on watch, or navigates from
  watch to any non-watch, non-shorts route while playing (Shorts excludes
  it — the owner rule pauses playback instead). **Not for embed-fallback
  videos** (documented in-app: nothing; the surface simply never docks).
- Android **PiP** (mechanism decided now, not "by implementation"):
  `enterPip`/`exitPip` methods on the yt-background plugin
  (`enterPictureInPictureMode` with aspect ~16:9); the MainActivity manifest
  attributes (`android:supportsPictureInPicture="true"` +
  `android:configChanges="screenSize|smallestScreenSize|screenLayout"`)
  are applied by a **CI sed-patch of android/app/src/main/AndroidManifest.xml
  immediately after `cap sync`** (the same pattern as the versionCode stamp
  in release.yml) — a library manifest cannot set activity attributes and
  `android/` is regenerated per CI run. Player bar gains a PiP button on
  Android; home-press while playing → PiP (behind `pipOnHome`).
- `src/components/yt/WatchPage.tsx` — **autoplay countdown**: video ends +
  autoplay on → up-next card with 5s circular countdown + Cancel, exactly
  YouTube's pattern; the embed path's ENDED overlay gains the same card.
- `src/lib/yt-native.ts` + service — **Prev** arrives here as one coherent
  unit: `onSkipToPrevious` callback → plugin `prev` event → store queue-1
  (or restart current when queue empty); notification action list becomes
  Prev/Play-Pause/Next (+Close in expanded). Seek events route to the
  store's seek.
- **Tests:**
  1. Miniplayer dock (direct mode): scroll past player → mini visible,
     playback uninterrupted (readyState ≥2, position monotonic) (3).
  2. Miniplayer expand: tap → watch route restored, position preserved (2).
  3. Miniplayer close → playback stops, `disable` recorded (2).
  4. Navigation continuity: watch → home while playing → mini on home (1).
  5. Owner rule: entering Shorts while watch plays → watch paused, mini
     closed, no second audio source (2).
  6. Embed mode: navigating away from an embed video → no mini, no errors
     (1).
  7. Countdown: ENDED + autoplay → card + Cancel stops navigation; timeout
     navigates to related[0] (3; `__ytEmbedEnded` hook for embed, direct
     ended simulation for the surface).
  8. PiP: bridge records `enterPip` on home-press while playing; the CI
     android job asserts `supportsPictureInPicture` via `aapt dump
     xmltree` on the built APK (2).
  9. Notification prev: control event routes to queue-1; with empty queue
     restarts current video (2).
  10. Regression: all e2e-playback checks green post-refactor — including
      a hardened unmount check (assert `disable` appears in `__bgCalls`
      after teardown; the current check is vacuous).
  11. Device checklist additions: PiP resize/reposition, mini
      drag-dismiss, prev from lockscreen.
- **Exit:** gauntlet miniplayer + watch ≥ TIE (WIN or TIE-with-reason); ship
  tag `v1.4.0`; What's-new; HANDOVER/WORKLOG.

### Phase 3 — Interaction truth serum (~2 sessions)

**Goal:** zero dead UI; every action confirms itself.

- **Toast wiring** — `src/lib/yt-toast.ts` (`ytToast()`, `data-testid=
  "yt-toast"`). Mutation sites enumerated: WatchPage (share, clip,
  save, subscribe/un), ShortsPage (share, subscribe), VideoCard (hover
  save-later), LibraryPages (remove/clear history, remove liked/later,
  playlist create/delete), SettingsPage (clear history), VideoPlayer
  (SponsorBlock skip — replaces the bespoke toast).
- **Dead-button triage (wire or remove — the audit's list, §8):**
  - Header/SearchOverlay mic → **remove** (voice search is a project; a
    dead mic is a lie).
  - Cast → **remove** (Chromecast out of scope).
  - Bell → **remove in this phase** (wire-or-remove rule); phase 4 restores
    it WITH the notifications drawer.
  - SearchPage filter chips + Filters button → real filter sheet (below).
  - Shorts subscribe → wired to store with real channel identity (identity
    data itself is phase 4 — the button wires to the store now using the
    parsed channel id when present, else hides); dislike → local toggle;
    More → sheet (Report/Not interested/Playback speed).
  - Comments like/dislike → local store-backed; reply buttons and the fake
    composer → **removed** (posting needs an account; the input is a lie),
    replaced by an inline "Commenting needs a YouTube account — unavailable
    in ytapp" note. Reply THREADS (reading) are phase 4.
  - Sidebar "Sign in" → remove; "Your videos" → remove (duplicate of
    Liked).
  - Playlist card click → **dead link removed** (cards render inert until
    phase 4's detail page exists); `cinemaMode` dead pref removed from the
    store (no consumer — phase-1 decision).
  - `notinterested` memory slice — **added in this phase** (the 3-dot menu
    below needs it).
- `src/components/yt/sheets/` (new): `Sheet` (vaul) + `Menu` primitives,
  theme-tokened:
  - **Search filters sheet:** Upload date / Type / Duration / Sort by →
    InnerTube `sp=` params (the proto strings NewPipe/yt-dlp use,
    REA-verified against live search traffic); applies on tap, chip shows
    active count.
  - **Save-to-playlist sheet** (card 3-dot + Watch Save): checkbox list +
    create-new (store actions exist).
  - **Share sheet:** copy link / copy with timestamp (`&t=`) / native
    `navigator.share` when available.
  - **3-dot card menu** (VideoCard variants): Save to Watch later, Save to
    playlist, Share, Not interested (hides card + persists via the new
    slice), Don't recommend channel (session + persists), Remove from
    History (history contexts).
- `src/components/yt/VideoCard.tsx` — 3-dot on every variant; fix nested
  interactive HTML (outer `<a>` → div + real inner link, middle-click
  kept); watched progress bar on thumbnails; skeleton 6↔5 col fix.
- **Haptics:** first task `bun add @capacitor/haptics` + sync; selection
  tick on chip tap, heavy on double-tap seek, success on save; no-op web.
- **Pull-to-refresh:** HomePage (Subscriptions gets it in phase 4).
- **Keyboard nav:** ↑/↓ + Enter through search suggestions (desktop +
  overlay), Esc closes; `role="combobox"` + `aria-activedescendant`.
- **A11y:** WhatsNew Esc/backdrop/focus-trap; Sidebar drawer `inert` when
  closed + focus trap + Esc.
- **Tests (~24):** toast on share/save/subscribe via `yt-toast` testid (3);
  3-dot items work feed + history + watch (6); filter sheet changes results
  AND URL (2); save-to-playlist round-trip (store assert) (1);
  copy-with-timestamp → `&t=123` (1); Not interested hides + persists (2);
  pull-to-refresh refetches (1); keyboard nav selects suggestion (2);
  dead-interactive probe → **0 findings outside the phase-4-deferred
  allowlist (bell-removed, playlist-card-inert, Shorts-actions)** (1);
  invalid-nesting scan → 0 (1); haptics bridge calls (2); drawer inert/Esc
  (2).
- **Exit:** audit dead-interactive = 0 across the 13 routes **except the
  explicit phase-4-deferred survivors (each carrying a `// PHASE4-DEFERRED`
  code comment tracked to zero)**; gauntlet home + search ≥ TIE; ship tag
  `v1.5.0`.

### Phase 4 — Missing surfaces (~3 sessions)

**Goal:** every page does its real-YouTube job.

- **Subscriptions feed** (`LibraryPages.tsx` rewrite): videos from all
  subscribed channels, with the fetch budget the design review demanded:
  **one shared single-flight cached fetch** (TTL 20 min, stale-while-
  revalidate) that also feeds the phase-4 bell badge; **concurrency cap 4–6**
  channels in flight; **`Promise.allSettled` per channel** with a per-channel
  error chip (one dead channel never fails the feed); **progressive render**
  as results land; cap 3 videos/channel; ordering by publishedTimeText (day
  granularity — the API gives nothing finer; documented). Chips
  (All/Today/Continue watching/Unwatched); avatar strip demoted to a
  horizontal row; pull-to-refresh.
- **ChannelPage tabs:** browse params (Home/Videos/Shorts/Live/Playlists/
  Community/About — NewPipe-documented, REA-verified): Videos + sort chips
  (Latest/Popular/Oldest) + continuation; Shorts grid → Shorts feed;
  Live (render-only states); **Playlists → new `playlist` route: queue-style
  watch with index, prev/next, autoplay-all**; Community posts (read-only);
  About absorbed. Verified badge; theme-fixed banner gradient; bell sub-menu
  (local pref); share channel.
- **Comments threads:** reply continuation loading (replies token — parser
  scaffold exists); "N replies" expands inline; thread pagination; sort
  Top/New actually applied (the parser currently ignores `_sort`); pinned/
  hearted/creator-heart badges when present.
- **Shorts truth:** real channel identity + avatar (lockup payload parser
  extension), real subscribe, real view count (parsed), like count →
  **removed** (not public in lockup data — like button with local state
  only), **comments bottom sheet** (Comments component with the short's
  videoId), double-tap-to-like animation, remembered sound toggle,
  progress scrubber on direct-player shorts, back-chevron → history-back.
- **Notifications (local, honest):** bell restored; badge = new videos from
  subs since last visit (from the shared cached fetch); drawer lists them;
  tap → watch; header states "From your subscriptions — local only".
- **Account menu** (avatar): Your channel (→ subscriptions), Appearance
  (theme cycle), Your data in ytapp (local-only privacy page), Settings.
- **Router:** `playlist` route; shorts entry as a **query-param route
  (`?page=shorts&id=`)** — the router is query-param-only by design
  (Capacitor/static-export friendly); path routes would need WebView serving
  changes that are out of scope.
- **Tests (~30):** subscriptions feed renders videos from seeded subs (2);
  fetch budget honored (cap + allSettled isolation seeded with a dead
  channel) (2); channel tabs per-tab structural asserts (7); sort chips
  change order (1); playlist page plays index 0 → next advances (2);
  comments: replies expand (2), sort New vs Top differ (1), pinned badge
  (1); Shorts: real channel matches parser (1), comments sheet opens (1),
  like local state (1); notifications: badge count (2), item → watch (1);
  account menu rows (2); playlist round-trip from 3-dot save (1); shorts
  entry route (1); subs pull-to-refresh (1); **dead-interactive = 0 with
  zero phase-4-deferred survivors (1)**.
- **Fidelity:** phase 0 baselined all 8 surfaces; this phase **re-baselines
  subscriptions + channel after their rewrites** and adds the `playlist`
  surface (9 total).
- **Exit (gates explicit):** all e2e-parity checks above green for the
  surfaces that shipped; gauntlet channel + subs + shorts ≥ TIE-with-
  reason; dead-interactive survivors = 0; ship tag `v1.6.0`. §7.4 droppable
  surfaces if time bites: Community posts, Live tab (both render-only);
  required: Subscriptions feed, channel Videos+Shorts+Playlists tabs,
  comment threads, Shorts truth, notifications.

### Phase 5 — Ad-free guarantee + extraction depth (~2 sessions)

**Goal:** shrink the embed to a genuine last resort; prove ad-absence.

- `src/lib/innertube.ts` — on-device deciphering per §4.3: CapacitorHttp
  text GET of `base.js`, prefetched at app start, single-flight per player
  version, TTL 6h; decipher `signatureCipher` URLs; combined AND split
  formats become candidates for `fallbackFormat`/`audioFormat`;
  `formats_deciphered` exposed via `window.__ytDebug`.
- **Storyboard in standalone:** parse `storyboard` from the `player`
  response (same spec as server mode) → phase-1 preview UI works everywhere.
- **Live (basic, honest):** `LIVE_STREAM_OFFLINE` → premiere countdown;
  live HLS via hls.js when a URL exists; LIVE badge; DVR-scrub disabled;
  "LIVE" button → jump-to-edge. Chat: non-goal.
- **The fixed test set (resolved finding):** `scripts/fixtures/adfree-
  testset.json` — ~30 checked-in video IDs spanning: combined-codec,
  adaptive-only, live, premiere, embed-fallback-classic, bot-gated-classic.
  This set is ALSO the deciphering report set.
- **Ad-absence assertions (new `scripts/e2e-ads.mjs`, runs in CI):** per
  playable test-set video: (a) all media requests ⊆ googlevideo.com (or
  byte-proxy) via request logging; (b) HLS manifests contain no VMAP/pagead
  tags; (c) no doubleclick/googleads requests on watch in direct mode;
  embed-mode videos assert the honest notice instead.
- **Quality ladder proof:** ≥1440p playable on a known-4K fixture (server
  mode); standalone asserts deciphered format list contains itag 137/140
  class entries post-decipher.
- **Tests:** deciphering fixture tests (`scripts/test-decipher.mjs`, checked-
  in player-JS fixture with known URL+sig pairs + refresh script); e2e-ads
  green; storyboard preview standalone (1); live/premiere states (3);
  format-ladder (2); device checklist: gzip verification + a real gated
  video playing direct.
- **Exit (measurable):** embed-fallback rate on the fixed test set ≤
  phase-0 baseline − 10 percentage points (baseline recorded in
  `docs/evidence/adfree-summary.md`; before/after table in release notes);
  ship tag `v1.7.0`.

### Phase 6 — Appearance final + the last gauntlet (~1–2 sessions)

**Goal:** nothing left that a side-by-side would catch.

- **Theme-token sweep:** convert every hardcoded color from the audit list
  (~30 spots: Header 212/227, Settings 23, `#717171` ×15, `#888` ×3,
  Comments 137, ChannelPage 70 gradient, status colors ×6, VideoCard 167)
  to tokens; add `--yt-status-warn/-ok/-err`; enforced by audit-v2's
  hardcoded-color class = 0.
- **Motion layer:** wire or delete the 10 dead CSS classes (globals.css
  245–464): keep+wire `.yt-page-enter` (route change, reduced-motion
  respected), `.yt-chip`, `.yt-icon-btn`, `.yt-card-lift`; delete `.yt-btn`,
  `.yt-nav-fill`, `.yt-skeleton-v2`, `.yt-media`, `.yt-pop`, `.yt-nav-item`.
- **Skeletons:** suggestion-dropdown skeletons (both search surfaces);
  chips-remount fix (AppShell stops keying HomePage on category — preserve
  chips scroll, swap grid with a cross-fade); skeleton column parity.
- **Typography/spacing:** remaining fidelity deltas on all 9 surfaces →
  fixed to tolerance (the report is the burn-down list).
- **PWA niceties on web:** manifest + theme-color (installable).
- **Final gauntlet:** `gauntlet-loop.mjs --until-win` across the full 4×9
  matrix; every surface WIN or TIE-with-written-reason.
- **Tests:** hardcoded-color = 0 (1); dead CSS = 0 (1); reduced-motion kills
  all animations (1); PWA manifest loads (1); fidelity all-surfaces within
  tolerance (9); final gauntlet summary all WIN/TIE (1); full regression:
  e2e-playback + e2e-parity + e2e-ads + bundle test 100%.
- **Exit:** ship tag **`v2.0.0`** — release notes = the complete
  Premium-for-free story; What's-new rewritten; HANDOVER/WORKLOG updated;
  owner runs the full device checklist (Android + macOS).

### Cross-phase standing rules

- Every phase: HANDOVER.md + WORKLOG.md updated (owner's standing rule);
  What's-new list updated on every tag; version read from package.json
  (phase-13 lesson).
- Every phase's section in THIS doc gets a goldfish review before its code
  is written (EGM discipline; §9 records the review of this doc).
- REA re-capture when YouTube's reference surfaces visibly change (monthly
  or on a failed gauntlet that smells like a YouTube update).
- No feature ships without its test in the same phase. No test is counted
  green off-device for what only a device can prove — those live in
  `e2e-device.md` and gate the release notes, not CI.
- Serial execution; one phase per release train; no parallel phase branches.

## 7. Risks & mitigations

1. **WebView playback reliability on devices** (the phase-1 bet): the owner
   runs device-checklist items 1–4 **before phase 2 begins** (explicit
   go/no-go in phase 1's exit). Escalation path documented (Media3 rewrite
   is the fallback, rejected-by-default per §5.1).
2. **Audio-focus dual-ownership (WebView requests focus independently):**
   mitigated by the §4.2 ownership model (service requests before audible
   start; duck routed as events); the call-interrupt device item is the
   real proof. If the device run shows the WebView focus request still
   conflicts, fallback = service never requests GAIN, relies on becoming-
   noisy + notification controls only (documented degrade).
3. **Deciphering breakage when YouTube rotates player JS:** fixture-
   snapshot CI tests catch it; graceful degradation to today's behavior
   (skip + embed); TTL + re-parse self-heals.
4. **InnerTube params drift (channel tabs, filters):** REA-verified when
   implemented; failures degrade to the Videos tab.
5. **Scope creep on phase 4 (surfaces are many):** each surface is a
   separate commit + test cluster; §6 phase 4 names the droppable
   (Community, Live) vs required surfaces; shipping partial is allowed only
   within that list, and the exit gates only what shipped.
6. **Bot-gating in CI:** e2e-ads + parity suites use the fixed fixture set +
   relay; datacenter-gated cases are marked `device:` and excluded from CI
   red/green (documented per-case).
7. **Subscriptions fan-out storms** (rate limits, battery, bot-gating of the
   shared anonymous client): the shared single-flight TTL cache + concurrency
   cap + allSettled isolation (phase 4 spec) bounds it.
8. **The elephant writes the code, not the goldfish:** reviews stay
   zero-context; the builder never grades itself (gauntlet rule).

## 8. Appendix — audit evidence index (file:line, from the 2026-11-05 audit)

**Dead UI:** Header mic ×2 (Header.tsx:231, SearchOverlay.tsx:160) · Cast
(Header.tsx:255) · Bell (Header.tsx:258) · filter chips + Filters
(SearchPage.tsx:78–98) · Shorts subscribe/dislike/more (ShortsPage.tsx:107/
129/151) · comments like/dislike/reply/replies/composer (Comments.tsx:82–92,
128–140) · Sidebar sign-in (Sidebar.tsx:117) · playlist→later wrong route
(LibraryPages.tsx:188) · store playlist actions with no UI (yt-store.ts:54).
**Fake data:** Shorts like counts = views/30 (ShortsPage.tsx:58), Shorts
channel identity (ShortsPage.tsx:102–105).
**Theme-breakers (~30 spots):** Header 212/227 (`#2f2f2f`,`#222222`),
Settings 23 (`#555`), `#717171` ×15, `#888` ×3, Comments 137, ChannelPage 70,
status colors ×6, VideoCard 167.
**Dead CSS (10 classes):** globals.css 245–464 (§6 phase 6 list).
**A11y:** nested interactives SearchPage 139+162, VideoCard 129+161/172/177;
drawer (Sidebar 180–183); combobox semantics missing; `c`-shortcut promised
(VideoPlayer.tsx:886) not implemented (552–576); userScalable off (layout:24).
**Engine gaps:** signatureCipher skipped (innertube.ts:672), comment sort
ignored (859), no replies (884), channel videos-tab-only (928), Shorts
search-seeded (980), playlists skipped (274), live unsupported (752),
standalone storyboards absent; `video.storyboard` is the real field name
(yt-api.ts:228).
**Harness gaps:** no ad assertions; fidelity 3 surfaces; CI zero gates;
critic gitignored (sandbox-only) + manual; with-server.sh takes exactly ONE
quoted command (scripts/with-server.sh:4,30) and its static server corrupts
binary media (e2e-playback already routes around it).
**Keep-as-is (intentional divergences, documented):** WhatsNew tour (not a
YouTube surface), player/Shorts black surfaces in light theme, theme quick-
toggle in the header, local-only likes/subs (no account), embed ads notice.

## 9. Goldfish review record

- **2026-11-05, five fresh-context reviewers** (no conversation state; doc +
  codebase only): zoom-out, comprehension, implementation-readiness,
  design-critic (run twice — first run's output was corrupted in transit,
  re-run focused on the four remaining technical-risk questions).
- **43 findings total: 8 🔴 blockers, 24 🟡 majors, 11 🟢 nits.**
  Every finding was resolved by the elephant in the revision of this doc —
  the resolution notes are itemized in
  `docs/designs/2026-11-05-premium-parity-v2-review.md` (finding →
  resolution → where the doc changed). Headline resolutions: phase-3 exit
  re-scoped with an explicit deferred-allowlist; notification Prev moved
  whole into phase 2; the ad-free test-set manifest + numeric gate defined;
  the ci.yml quoting + result-guard + install steps fixed; gauntlet_critic
  un-ignored; phase-2 file inventory completed (VideoPlayer.tsx + yt-store
  added) with the embed-mode and Shorts-exclusion rules decided; audio-focus
  ownership model + W3C-session gating added; the subs fetch budget
  specified; keepScreenOn replaced with the plugin keepAwake method; the
  `t`/theater and Ambient-mode dangling specs deleted; `storyboard` field
  name, `yt-lands` new class, `__ytDebug` surface, and the query-param
  shorts route corrected; route/color/class counts reconciled; SITEMAP
  created.
- One more fresh-goldfish pass on §6 Phase 2 alone is recommended at the
  start of phase 2 (the phase with the most remaining design debt).

## 10. Sitemap

`docs/designs/SITEMAP.md` is created alongside this doc and registers it.

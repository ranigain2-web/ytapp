# HANDOVER — Complete Project Context

> Purpose: anyone (human **or** AI agent) picking up this project cold should
> be able to continue development after reading this file plus
> [WORKLOG.md](../WORKLOG.md). It captures intent, decisions, state, and
> gotchas — the things code can't say.
>
> **Standing rule from the owner: this file is updated on EVERY task.** If you
> finish work here and haven't touched this file, you're not done.

## 1. What this project is

A personal, **ad-free, YouTube-style client** ("YouTube" is even the app name
— the UI is deliberately pixel-faithful to real YouTube; that fidelity is a
hard product requirement, QA'd blind against the real app/site). Videos play
from YouTube's own CDNs through a custom HLS player, so no YouTube player
runtime runs and no ad slots exist. One React codebase → three products:

1. **Web** (Next.js 16 dev server / static export)
2. **Android APK** (Capacitor 7 — **fully standalone**: works out-of-the-box
   with NO server, NO proxy, NO setup)
3. **macOS Intel app** (Electron; **bundles the entire backend** — zero-config)

Owner: `ranigain2-web` (GitHub). Repo layout and quickstart: see
[../README.md](../README.md).

## 2. Origin story & phases (why things are the way they are)

- **Phase 1 — deep research** (2026-09-11/12): every known approach was
  tested live (embeds, Data API, public Invidious/Piped, raw InnerTube,
  youtubei.js, yt-dlp, PO tokens). Outcome: public proxy instances are dead;
  the only viable ad-free paths are **owning the extraction stack** with
  youtubei.js v18 + bgutil PO tokens (server mode) and **on-device InnerTube
  over CapacitorHttp** (standalone mode — the NewPipe approach). Full record:
  [RESEARCH.md](RESEARCH.md) + `docs/research/*.json`.
- **Phase 2 — build**: complete React frontend (YouTube-clone UI, custom
  player, all local library features) + yt-api backend (session pool, TTL
  cache, HLS rewrite, byte proxy, SponsorBlock relay) + Capacitor Android CI.
  Fidelity was iterated with a blind critic loop against real YouTube
  screenshots.
- **Phase 3 — repo + desktop**: backend canonicalized into `server/` +
  vendored `pot-provider/`; **macOS Intel Electron app** added (self-contained
  runtime, local E2E-proven); Docker deploy path; CI workflows; docs suite.
- **Phase 4 — first real CI green** (2026-09-12/13): repo push fixed (dead
  token), 4/4 artifacts verified, grid/typography critic fixes, honest
  datacenter-IP bot-gate audit.
- **Phase 5 — Android crash fix**: robust API client (JSON-shape guards),
  **community mode** auto-fallback (public Piped instances, CORS-open),
  friendly setup panel + connect flow, mode-aware UI.
- **Phase 6 — fully standalone Android + YouTube-parity UX**
  (2026-09-13): on-device **InnerTube engine** (`src/lib/innertube.ts`,
  CapacitorHttp native transport — no CORS, user's own IP), infinite scroll
  everywhere, 1-tap full-screen mobile search with live suggestions, Shorts
  feed, YouTube bottom-nav IA, blocked-video UX; 3 blind critic rounds green.
- **Phase 7 — bot-check playback fix** (2026-09-13): "Sign in to confirm
  you're not a bot" no longer blocks watching. Three stacked bugs fixed (see
  §4.11). Gated videos now play via the official embed; ungated videos play
  direct ad-free googlevideo streams.
- **Phase 8 — premium UI + playback-settings round** (2026-09-13, latest):
  responsive fixes (portrait/landscape overlaps, cut-offs), landscape theater
  mode, immersive Shorts, double-tap seek ±10s with ripple (YouTube
  signature), always-on Next-video button, Autoplay toggle in the player
  settings menu, PiP button, refreshed app icon (10/10 VLM-rated), search
  channel-header overlap fix, and this handover/worklog discipline.
- **Phase 9 — Premium features + theme system + Releases** (2026-09-13):
  background playback (Android foreground-service plugin), audio
  mode, app-level player bar (the skip-feature discoverability fix), the
  YouTube IFrame API for embed autoplay, full dark/light/device theming, and
  GitHub Releases automation (v1.0.0 + v1.1.0 published). See §3.
- **Phase 10 — v1.2.0: “the missing features” round** (2026-09-13,
  latest): user-reported issues root-caused to THREE things: (1) the user
  was still running the v1.0.0-era APK (community mode, no Premium
  features) — solved with a once-per-version What's-new tour + version
  display; (2) the embed player's own end-screen/pause “More videos” grid
  deep-links into the YouTube app — solved with an ENDED overlay that
  covers the iframe (Up next + Replay + Next, all in-app); (3) real gaps in
  the custom player — YouTube-mobile CENTER CONTROLS ([◀◀10] [⏯] [10▶▶]
  [+ ⏭]) added, theme quick-toggle in the header (moon/sun/monitor cycle),
  Audio button in the player bar, Share fixed to youtu.be (was
  `https://localhost/...` on Android!), fake Download pill removed,
  POST_NOTIFICATIONS runtime request (Android 13+, notification was
  invisible), and a CRITICAL upgrade bug: zustand persist's shallow merge
  dropped new pref keys for old installs → deep `merge` added (upgraders
  would have had background play silently OFF). E2E suite
  `scripts/e2e-v12.sh` (19 checks) + old suite still 14/14; blind critic:
  watch page OURS WINS.
- **Phase 12 — cold-start bring-up on a fresh checkout** (2026-09-13/14):
  the new checkout had no dependencies and no bun, so nothing was buildable
  or verifiable. Installed bun 1.4.2 + all three dependency trees (sub-project
  lockfiles reproduced byte-identically) and made `scripts/with-server.sh`
  path-portable.
- **Phase 13 — measured YouTube fidelity + the two dead features**
  (2026-09-14, latest): the user reported that background play and audio-only
  mode did nothing, and that parts of the UI were “getting cut out”. Both bugs
  were real (see §3/§5): the foreground service was torn down whenever
  `playing` went false, and background re-asserts called
  `startForegroundService()`, which Android 12+ forbids from the background;
  audio mode had no artwork layer and restarted from 0. “Looks like YouTube”
  was made falsifiable — `scripts/fidelity-bar.mjs` diffs our DOM against
  real m.youtube.com / www.youtube.com in the same browser at the same size,
  and `scripts/audit-ui.mjs` walks 24 route×viewport combinations for layout
  defects. Fixed from their output: 48px mobile app bar, tablet player
  802→834 (exact), 1024px two-column watch (exact), the dead `3xl:` variant,
  the related rail's shape, search thumbnail/container widths, a genuinely
  cut-off description, and the fact that YouTube picks its shell from the
  **user agent** rather than the viewport.

## 3. Current state (as of 2026-09-14, end of phase 13 — v1.2.1)

- ✅ **v1.2.0 shipped**: every Premium feature is now impossible to miss:
  center skip controls on the player, What's-new tour on each version bump,
  theme toggle in the top bar, Audio button under the player, and the
  Settings → About version line (the user's “am I missing something?”
  question is answered in-app).
- ✅ **Standalone mode is the default story on Android**: home/search/watch/
  comments/channels/Shorts/suggestions all hit YouTube InnerTube directly
  from the device via CapacitorHttp. Infinite scroll verified 172+ videos.
- ✅ **Premium-style background playback (Android)**: while a direct-stream
  video plays, the local `yt-background` Capacitor plugin runs a
  `mediaPlayback` foreground service — the WebView keeps streaming when the
  app is backgrounded or the screen is off; a MediaStyle lock-screen
  notification (Play/Pause/Next/Close) + native MediaSession round-trip
  control into the WebView player (`src/lib/yt-native.ts`). Toggle: Settings
  → Playback → Background play (default on). Verified to the fullest extent
  possible off-device: the APK with the plugin builds and carries both
  classes + merged manifest entries (local SDK build + CI).
  **Phase 13 repaired the actual device bugs** (see §5): the service used to
  be torn down the moment `playing` went false, and background re-asserts
  called `startForegroundService()` — which Android 12+ **forbids from the
  background**, so the call threw and `startSafe` swallowed it. Verified
  8/8 by `scripts/e2e-playback.mjs` §4 against a faithful Capacitor bridge
  stub (real plugin proxy, not a mock of our own wrapper).
- ✅ **Audio mode (Premium data saver)**: player settings menu + Settings
  toggle — swaps to the best audio-only stream (m4a/webm opus), keeps
  position, shows thumbnail + chip. Verified 7/7 by `e2e-playback.mjs` §3:
  `videoWidth === 0` proves no video track, the artwork layer replaces the
  black box, position survives the swap, and toggling back restores frames.
- ✅ **Measured YouTube fidelity (phase 13)**: “looks like YouTube” is now a
  number, not an opinion. `scripts/fidelity-bar.mjs` loads real
  m.youtube.com / www.youtube.com and our app in the same browser at the same
  viewport and diffs geometry. Fixed from its output: 48px mobile app bar
  (ours was 56 everywhere), tablet player 802→**834 exact**, 1024px two-column
  watch (656×369 **exact**), the dead `3xl:` breakpoint, the related rail's
  shape (proportional thumbnail + a 2-up grid in the tablet band), search
  thumbnail/container widths, and a genuinely cut-off video description.
- ✅ **Skip-video discoverability**: an app-level player bar under the player
  in BOTH modes (custom player AND official embed): `Autoplay` switch +
  `Skip video →` button (next related video). The YouTube IFrame API
  (`enablejsapi=1`, `src/lib/yt-embed-api.ts`) observes embed ENDED so
  autoplay-next works for embed-fallback videos too. This fixed the user's
  "can't find the skip feature" — those controls used to live only inside
  the custom player, which never renders in embed mode.
- ✅ **Theme system**: dark / light / device-theme with YouTube's exact
  palettes (CSS vars in globals.css, `html.yt-light` overrides, Appearance
  setting, pre-paint boot script). 292 colors converted across 13 components
  via `scripts/theme-convert.py`. Player internals + Shorts stay black by
  design (YouTube does the same).
- ✅ **Playback ladder (per video)**: server-mode direct streams → standalone
  ANDROID_VR direct googlevideo (combined-codec detection + TVHTML5
  visitorData recovery) → progressive MP4 → official embed (bot-gated videos;
  honest "ads may appear" notice).
- ✅ **Shorts**: vertical snap feed, true 9:16 sizing, immersive, per-short
  resolution (direct player first, embed fallback), oEmbed pre-validation.
- ✅ **Player UX**: double-tap ±10s seek with ripple; tap = show/pause;
  Next always skips the whole video; settings menu = Quality / Speed /
  Subtitles / Autoplay / Background play (native) / Audio mode; PiP
  (desktop); keyboard shortcuts; W3C MediaSession on web.
- ✅ **Releases**: `v*` tag push → `.github/workflows/release.yml` builds
  Android + macOS and attaches `ytapp-<v>-debug.apk`,
  `-release-unsigned.apk`, `-macos-intel.dmg/.zip` to a GitHub Release
  (versionCode stamped from the tag). `workflow_dispatch` inputs
  `tag_name`+`ref` backfill older commits. v1.0.0 + v1.1.0 + v1.2.0
  published.
- ⚠️ **Datacenter-IP caveat (sandbox only, NOT user devices)**: from this
  sandbox all InnerTube player clients are bot-gated for most videos and
  some embeds throw Error 153; the browse/home endpoint additionally
  throttles intermittently (`Precondition check failed` 400) after heavy
  testing. On real phone IPs, direct streams flow (architecture-verified;
  the user confirms playback on-device).
- ✅ **Verification gates (phase 13, all green on 2026-09-14)**: `bun run
  lint` clean, `bun run build:static` clean, `scripts/audit-ui.mjs` **0 real
  clipping / 0 overflow / 0 overlap across 24 route×viewport combos**,
  `scripts/e2e-playback.mjs` **28/28**, `scripts/test-electron-bundle.sh`
  **13/13**. Playwright is a devDependency; the harnesses save screenshots +
  reports under `docs/screenshots/{audit,fidelity}/` (**gitignored**, ~137 MB).
- ✅ **Fresh-checkout bring-up verified (phase 12)**: on a new machine this
  repo needs `npm i -g bun` FIRST (scripts + `bun.lock` assume bun; no deps
  ship with the checkout). After that: `bun install`, `npm install` in
  `server/` + `pot-provider/`, then `bash scripts/start-stack.sh`. Verified
  green here: PO token minted ~10 s after boot, search/home/video live (24
  formats + HLS, `embed_fallback:false`), `bun run lint` clean,
  `bun run build:static` OK, `test-electron-bundle.sh` **13/13**.
- ⚠️ **The sandbox cannot drive a real embed to ENDED** (bot-gated inside
  headless Chrome): the ENDED-overlay E2E uses the `window.__ytEmbedEnded`
  debug hook to verify the render + routing path; the IFrame-API event
  wiring (state 0 → overlay) is code-verified and fires on real devices.

## 4. The decisions that matter most

1. **Own the extraction stack** — no dependency on public Invidious/Piped
   (dead/block-prone). Server mode: `server/` + `pot-provider/` (PO tokens).
   Standalone mode: on-device InnerTube. Community mode: Piped failover.
2. **PO tokens are mandatory for server-mode stream extraction** from
   non-residential IPs — bgutil runs everywhere the API runs (hence
   one-container Docker and the self-contained desktop app). Standalone mode
   needs NO PO token (ANDROID_VR client), matching NewPipe's approach.
3. **youtubei.js v18 quirks** (server mode): WEB client = metadata (SABR, no
   URLs); IOS client = streams; `visitorData`+`poToken` must be a **matched
   pair** from one `/get_pot` call.
4. **Query-param routing** (`/?v=…`, `/?q=…`, `/?page=shorts`) — one bundle
   behaves identically on dev server, static hosting, Capacitor, Electron.
5. **yt-api serves the desktop frontend itself** (`STATIC_DIR`) →
   same-origin; the Electron preload injects the API base into localStorage
   every launch.
6. **Playback failure ladder**: HLS → progressive → official embed (labeled
   honestly). The embed is the universal fallback — it plays even
   bot-gated videos (the Shorts feed proved this on real devices).
7. **Polite-client behavior**: TTL cache + request coalescing + session
   rotation + multi-instance SponsorBlock with graceful degradation.
8. **Vendored pot-provider build** with minimal pure-JS deps (jsdom without
   canvas works) — cross-arch safe.
9. **Unsigned macOS build** (identity: null) — right-click-open documented.
10. **Android standalone-first**: CapacitorHttp is the transport (native
    HTTP, CORS-free, device's own residential IP). A hosted server remains
    an optional upgrade for ad-free streams everywhere, not a requirement.
11. **Bot-check handling (phase 7)**: three stacked bugs were the real
    cause — (a) bot-gated videos rendered as hard errors instead of mounting
    the embed; (b) combined itag 18/22 mp4s misdetected as `has_audio=false`
    (codec sniffing now: `mp4a|opus|ac-3` vs `avc1|vp9|av01`); (c)
    `crossOrigin="anonymous"` on `<video>` forced CORS on googlevideo which
    serves no ACAO — removed. Also: `onFallback` lives in a ref (inline
    closures in load-effect deps restart playback on host re-renders).
12. **Dev relay pattern**: `server/index.mjs` `/api/ytb-relay` +
    `/api/ytb-suggest` + `/api/ytb-oembed` let the EXACT on-device parsing
    code run in a normal browser for E2E (`?src=standalone`).
13. **Local Capacitor plugin (phase 9)**: `plugins/yt-background` is a
    `file:` dependency (name in package.json deps = how `cap sync`
    discovers it; `capacitor.plugins.json` + `capacitor.settings.gradle`
    are generated). The plugin's AndroidManifest MERGES into the app —
    permissions + the `mediaPlayback` service come from there, no CI
    patching. Keep `bun.lock` in sync (`bun install`) after touching it.
14. **Theme rule (phase 9)**: page-level colors must use the `--yt-*` CSS
    variables (see globals.css). `text-white`/`bg-black` are allowed ONLY on
    always-dark surfaces (player internals, Shorts, overlays on black).
    When adding UI, use vars — a hardcoded `text-white` made the wordmark
    invisible in light mode once. Run
    `rg -n "text-\[#f1f1f1\]|bg-\[#272727\]" src/components/yt` to audit.
15. **Releases (phase 9)**: tag `v*` → `release.yml` publishes. To backfill
    an older commit: create the tag on it, push, then dispatch `release.yml`
    with `tag_name` + `ref` (the tag's commit predates the workflow file,
    so the push alone triggers nothing).

## 5. Gotchas & known issues

- **This checkout ships without dependencies or bun.** `npm i -g bun` first,
  then `bun install` (root) + `npm install` (in `server/` and `pot-provider/`;
  their `package-lock.json` files ARE tracked — they must stay
  byte-identical, so install with npm, not bun, in those two).
- **The OLD gauntlet harness needs sandbox-only tooling** that is NOT part of
  this repo: `agent-browser`, the `z-ai` vision CLI, and a VLM API key.
  Without them `scripts/e2e-v12.sh`, `e2e-premium.sh` and `scripts/critic.py`
  (blind VLM A/B) cannot run. **Use the phase-13 harnesses instead** — they
  need only Playwright's Chromium (`bun add -d playwright`), which installs
  from public npm and is already a devDependency:
  `scripts/audit-ui.mjs` (24 route×viewport layout defects),
  `scripts/fidelity-bar.mjs` (measured diff against real YouTube),
  `scripts/e2e-playback.mjs` (28 functional checks incl. an Android bridge
  stub). Say what you did NOT run rather than implying E2E evidence.
- **Don't trust the audit's `clipped` count without reading it.** It now
  splits **real clipping** (overflow:hidden with no clamp — the "section cut
  out" defect) from **`ellipsis`** (a `clamp-2`/`clamp-3` explains it; card
  titles and the collapsed description are intentional). Both numbers appear
  in the report; only the first is a bug.
- **The shell is chosen by PLATFORM, not width.** Real YouTube picks its
  chrome from the user agent: at 834px an Android UA gets the 48px bar +
  bottom pivot bar, a desktop UA gets the 56px bar + guide rail. So
  `yt-theme.ts`'s boot script stamps `yt-android` on `<html>` pre-paint (via
  `window.androidBridge` / `Capacitor.getPlatform()`) and `globals.css` pins
  the mobile shell at any width. Width still drives layout *inside* the
  shell. When comparing against YouTube, **match the UA to the shell you are
  rendering** — `fidelity-bar.mjs` uses m.youtube.com + an Android UA for the
  phone profile and www.youtube.com + a desktop UA for tablet and up;
  comparing our desktop shell to YouTube's mobile layout reports a phantom
  "48 vs 56 header" mismatch.
- **`scripts/e2e-v12.sh` / `e2e-premium.sh` still hardcode `/home/z/...`
  paths** (`with-server.sh` was fixed in phase 12). Derive the root from
  `$BASH_SOURCE` before using them on another machine.
- `URL_SUFFIX` defaults to `&XTransformPort=3001` (dev-sandbox gateway
  artifact). **Production must set `URL_SUFFIX=""`** (Docker + desktop
  already do). If manifests contain garbage URLs, check this first.
- **The sandbox reaper kills background processes** started in a tool call;
  long-lived servers from older sessions survive. Use
  `bash scripts/with-server.sh '<commands>'` to run servers + browser E2E
  inside one process tree.
- **Datacenter-IP gating** (this sandbox): InnerTube player = LOGIN_REQUIRED
  for most videos; some embeds throw Error 153; m.youtube.com shows its
  empty state and watch pages captcha. All of these are IP-reputation
  artifacts, not app bugs — verify on a real device or trust the
  architecture-level E2E.
- m.youtube.com must be fetched with mobile device emulation
  (`agent-browser set device "iPhone 14"`) or it redirects to desktop.
- **`--yt-header-h` is the single source of truth for the app bar** (48px
  mobile / 56px desktop / 48px pinned on Android). Page padding, sticky
  offsets, guide height, the chips bar and the search overlay all read it —
  never hardcode `pt-14`/`h-14` again, that is exactly how the 8px drift
  happened.
- Tailwind v4 reads breakpoints from **CSS** (`@theme` in globals.css), not
  `tailwind.config.ts`. A `3xl:` variant generated nothing for months because
  it was only declared in the JS config. Register new breakpoints in BOTH
  places.
- Public-instance ecosystem rot: pointing anything at public Invidious/Piped
  today expects failure — that's why this architecture exists.
- SponsorBlock public API has outage history — the app degrades silently.
- `src/lib/db.ts` + prisma deps are inert template leftovers; safe to delete.
- `node_modules` inside `server/` and `pot-provider/` are gitignored — CI /
  Docker / desktop builds install them fresh.
- The sandbox `.zscripts/dev.sh` auto-starts the stack via the
  `mini-services/yt-api` shim — deleting that shim breaks sandbox auto-boot.
- Icons: regenerate with `python3 scripts/generate-icons.py` after edits;
  Android overlay lives in `icons/android/res/` and CI copies it after
  `cap add android` (the `android/` dir itself is gitignored).
- Feed titles are font-normal (400) by design — YouTube's real hierarchy.
  Do not "bold them up"; earlier critics found the bolder weight cheap.
- TypeScript: `ignoreBuildErrors: true` in next.config.ts — the lib layer
  has ~15 known loose-typing errors (pre-existing, harmless); components
  must stay at ZERO errors.

## 6. How to resume work (10-minute orientation)

1. Read this file + WORKLOG.md tail (through session 13).
2. Bring the environment up first (see §5) — the checkout ships with no
   deps and no bun: `npm i -g bun && bun install &&
   (cd server && npm install) && (cd pot-provider && npm install)`.
3. `bash scripts/start-stack.sh`, then `curl
   http://127.0.0.1:3001/api/health` → expect `ok:true, po_token:true`
   (takes ~10 s to mint). Then `bun run dev` → confirm the home grid; or
   `bun run build:static && bash scripts/with-server.sh '…'` for the APK
   artifact path (`http://127.0.0.1:3999/?src=standalone`).
4. Skim `src/lib/innertube.ts` (engine), `src/lib/yt-api.ts` (source
   layering), `server/index.mjs` (relay routes at the bottom).
5. E2E loop (no sandbox tooling needed beyond Playwright's Chromium):
   `bash scripts/with-server.sh 'node scripts/e2e-playback.mjs'` (28
   functional checks), `… 'node scripts/audit-ui.mjs'` (layout defects +
   screenshots for review), `… 'node scripts/fidelity-bar.mjs'` (numeric
   diff vs real m.youtube.com/www.youtube.com). The old VLM path
   (`scripts/critic.py <ours.png> <ref.png> <label>`) still exists but needs
   `agent-browser` + a VLM key.
6. `gauntlet-loop` skill lives at `.agents/skills/gauntlet-loop/` (install
   with `npx skills add robonuggets/gauntlet-loop --skill gauntlet-loop`).
7. Pick from the roadmap below or fix what's red in Actions.

## 7. Roadmap (ranked)

1. **On-device validation of standalone direct playback** (needs a real
   phone; the sandbox cannot verify due to IP gating).
2. **Signed + notarized macOS builds** (Apple Developer ID, CI secrets).
3. **YouTube cookie support in Settings** (paste cookie → server header) for
   VEVO coverage; plus cookie rotation helpers.
4. **GitHub Release automation** (tag push → APK/DMG attached to a Release).
5. **Apple Silicon / universal desktop target** (add `arm64` to builder).
6. **Playlists playback** (remote YouTube playlists via tabs API).
7. **Shorts: comment sheet on the rail button** (currently deep-links to the
   watch page); progress bar on embed shorts (needs YT IFrame API).
8. **Self-host quick-deploy button** (Railway one-click template).
9. **i18n** of the few UI strings; DASH/WebM path for >1080p60 vp9-only.

## 8. Where the bodies are buried (file-level notes)

- `src/lib/innertube.ts` — the standalone engine: transport (CapacitorHttp /
  relay / direct), all InnerTube parsers, endpoints, shorts feed,
  `itValidateShorts` (oEmbed). Largest lib file — read its header comment.
- `src/lib/yt-api.ts` — source layering (server > standalone > community),
  `?src=` debug override, continuation APIs, suggestions.
- `src/lib/community.ts` — Piped failover adapter + `resolveDataSource()`.
- `src/components/yt/VideoPlayer.tsx` — the player: HLS/progressive/embed
  ladder, settings menus (quality/speed/captions/autoplay/background-play/
  audio-mode), double-tap seek + ripple, minimal (Shorts) mode, SB markers,
  keyboard shortcuts, MediaSession + native background-service wiring.
  Touch events own the seek gesture; mouse owns click/dblclick semantics.
  NOTE: `audioOnly` is in the load-effect deps on purpose — toggling it
  re-runs the loader, and `loadedVideoRef` makes it preserve position.
  Effect ORDER matters: the control-handlers effect must stay BELOW the
  `poke`/`seekBy`/`userStart` useCallback definitions (TDZ).
- `src/components/yt/ShortsPage.tsx` — snap feed, per-short resolution
  (direct player → embed), oEmbed drop of dead cards, immersive chrome.
- `src/components/yt/WatchPage.tsx` — watch layout, action pills,
  `yt-player-shell`/`yt-watch-outer` landscape theater classes, the
  description expander (the collapsed clamp used to hide 1300–1560px of text
  with no way to reveal it), and the related list that becomes a 2-up grid in
  the tablet band (`sm:max-lg:`).
- `src/components/yt/VideoCard.tsx` — `compact` = rail row; add `responsive`
  to let one element reflow phone rows → tablet 2-up cards → rail rows. The
  rail thumbnail is a share of the column (65% at lg / 64% at xl), matching
  YouTube's measured 208px-in-320px and 256px-in-402px.
- `src/app/globals.css` — premium polish layer at the bottom (landscape
  player shell, shorts frame sizing, chips fade, seek ripple animations).
- `server/index.mjs` — read the header comment first; relay routes
  (`/api/ytb-relay`, `/api/ytb-suggest`, `/api/ytb-oembed`) near the
  bottom; HLS rewrite + `/api/segment` host allowlist are
  security-sensitive; `STATIC_DIR` block is desktop-only.
- `electron/main.cjs` — port resolution + health waits + child lifecycle.
- `scripts/with-server.sh` — the sandbox-reaper-safe way to run E2E (runs
  both backends + the static server in ONE process tree). Path-portable since
  phase 12: it derives the project root from `$BASH_SOURCE` and uses plain
  `node` for `serve-static.mjs`, so it works in any checkout without bun.
- `scripts/audit-ui.mjs` — **phase 13**, the layout-defect harness: 24
  route×viewport combinations (phone 390 / tablet 834 / small-laptop 1024 /
  laptop 1440 × home/watch/search/shorts/settings/channel). Reports
  horizontal page overflow, real clipping (vs intentional ellipsis),
  overlapping interactive elements, sub-44px tap targets, and saves
  screenshots + `REPORT.md`. Needs only Playwright's Chromium.
- `scripts/fidelity-bar.mjs` — **phase 13**, the fidelity bar: loads real
  m.youtube.com / www.youtube.com and our app in the SAME browser at the SAME
  viewport, then diffs grid columns, item/thumbnail geometry, gaps, radii,
  header/guide/player boxes and typography. Prints `grid el` (which element
  it measured) and skips comment threads, which otherwise win the "most
  uniform children" tie on watch pages. Reference + UA are per profile — see
  the note in §5 about matching the UA to the shell you render.
- `scripts/e2e-playback.mjs` — **phase 13**, 28 functional checks: hydration
  on 6 routes, light theme reaching `<body>`, audio-only mode (7), the
  background-play contract (8), and the Android shell at tablet width (8).
  Installs a faithful Capacitor **Android bridge stub** (`window.androidBridge`
  + `PluginHeaders` + `nativePromise`) so it drives the real `yt-background`
  plugin proxy rather than a mock of our own wrapper.
- `scripts/critic.py` — blind VLM A/B judgment harness (legacy; needs
  `agent-browser` + a VLM key).
- `src/lib/yt-native.ts` — native bridge wrapper: yt-background plugin calls
  + W3C MediaSession helpers. Web = silent no-ops. Also owns
  `isAndroidApp()` / `applyPlatformClass()` (platform → app chrome, see §5).
- `plugins/yt-background/android/.../MediaPlaybackService.java` +
  `YtBackgroundPlugin.java` — Android 12+ rules matter here: **never call
  `startForegroundService()` for an update from the background** (it throws
  `ForegroundServiceStartNotAllowedException` and the old `startSafe`
  swallowed it, so the service silently never started/updated). Use
  `startService()` when the service is already running, re-assert on
  background, and do NOT tear the service down on a WebView-induced pause.
  **Keep the `android.support.v4.media.*` imports.** The androidx.media
  equivalents (`androidx.media.MediaMetadataCompat`,
  `androidx.media.session.MediaSessionCompat` / `PlaybackStateCompat`) do NOT
  resolve on this module's compile classpath even with `androidx.media:media`
  declared — CI failed with `cannot find symbol … location: package
  androidx.media` while `androidx.media.app.NotificationCompat.MediaStyle`
  resolved fine. The support-4 names are supplied through Jetifier and are the
  configuration CI has proven green. Don't "modernise" them without an Android
  SDK to compile against.
- `src/lib/yt-embed-api.ts` — official YouTube IFrame API loader (embed
  autoplay-next on ENDED, ENDED → our overlay when autoplay is off). All
  failures are silent — the embed plays regardless.
- `src/lib/yt-theme.ts` — theme engine (apply/watch/boot-script) + the
  `THEME_BOOT_SCRIPT` inline in layout.tsx. The boot script ALSO stamps
  `yt-android` pre-paint (duplicating `yt-native.ts`'s `isAndroidApp()`
  detection on purpose, so it stays dependency-free and runs before any
  module loads) — that is what pins the mobile shell on Android at any width.
- `plugins/yt-background/` — the local Capacitor plugin (Android ONLY):
  `YtBackgroundPlugin.java` (bridge) + `MediaPlaybackService.java` (FGS +
  MediaSessionCompat + MediaStyle notification). JS dist is hand-written
  pure JS (no build step) — keep it ES5-ish, webpack resolves `module`.
- `scripts/theme-convert.py` — one-shot color→var conversion pass (rerun if
  new hardcoded colors creep in).
- `scripts/e2e-premium.sh` — the premium-feature E2E suite (14 checks).
- `scripts/e2e-v12.sh` — the v1.2.0 E2E suite (19 checks: whats-new, theme
  cycle + persistence, center controls, audio button, embed-ended overlay
  + in-app routing, related-card routing, home regression). Uses the
  `waitdom` poll helper — fixed sleeps are NOT reliable for hydration.
- `src/components/yt/WhatsNew.tsx` — once-per-version feature tour (checks
  `yt_whatsnew_seen` in localStorage against APP_VERSION). Update the
  feature list on every version bump.
- `src/lib/yt-store.ts` — persist has a custom deep `merge` for `prefs`:
  old installs lack newer keys (theme/backgroundPlay/audioOnly) and the
  default shallow merge would silently disable them. Keep it when adding
  prefs.
- `.github/workflows/release.yml` — tag-driven release builds (see §4.15).
- Local Android toolchain in the sandbox: Temurin JDK 21 at `/home/z/jdk21`,
  SDK at `/home/z/android-sdk` (platform 35 + build-tools 35). Use
  `JAVA_HOME=/home/z/jdk21 ANDROID_HOME=/home/z/android-sdk`, write
  `android/local.properties` (sdk.dir) after `cap add android`. Full
  `assembleDebug` takes ~4 min. `android/` is gitignored — CI regenerates.
- `.github/workflows/*` — keep Node 22 / Java 21 / Bun pins in sync with
  Capacitor major.

## 9. Credits & licenses

- Upstream enablers: [youtubei.js](https://github.com/LuanRT/YouTube.js)
  (MIT), [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider)
  (GPL-3.0, vendored build in `pot-provider/` — see NOTICE),
  [SponsorBlock](https://sponsor.ajay.app) (public API),
  [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0),
  [NewPipe](https://newpipe.net) / [FreeTube](https://freetubeapp.io)
  (design references), shadcn/ui + Tailwind (Apache-2.0).
- This repo's own code: MIT (LICENSE).

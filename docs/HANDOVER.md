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

## 3. Current state (as of 2026-09-13, end of phase 10 — v1.2.0)

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
- ✅ **Audio mode (Premium data saver)**: player settings menu + Settings
  toggle — swaps to the best audio-only stream (m4a/webm opus), keeps
  position, shows thumbnail + chip. E2E-verified itag 18 → 251 live swap.
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

1. Read this file + WORKLOG.md tail (sessions 1-9).
2. `bash scripts/start-stack.sh && bun run dev` → confirm the home grid; or
   `bun run build:static && bash scripts/with-server.sh '…'` for the APK
   artifact path (`http://127.0.0.1:3999/?src=standalone`).
3. Skim `src/lib/innertube.ts` (engine), `src/lib/yt-api.ts` (source
   layering), `server/index.mjs` (relay routes at the bottom).
4. E2E loop: `scripts/critic.py <ours.png> <ref.png> <label>` runs a blind
   VLM A/B; `agent-browser --session ours …` drives pages at
   390×844 / 844×390 / 1280×800.
5. Pick from the roadmap below or fix what's red in Actions.

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
  `yt-player-shell`/`yt-watch-outer` landscape theater classes.
- `src/app/globals.css` — premium polish layer at the bottom (landscape
  player shell, shorts frame sizing, chips fade, seek ripple animations).
- `server/index.mjs` — read the header comment first; relay routes
  (`/api/ytb-relay`, `/api/ytb-suggest`, `/api/ytb-oembed`) near the
  bottom; HLS rewrite + `/api/segment` host allowlist are
  security-sensitive; `STATIC_DIR` block is desktop-only.
- `electron/main.cjs` — port resolution + health waits + child lifecycle.
- `scripts/with-server.sh` — the sandbox-reaper-safe way to run E2E.
- `scripts/critic.py` — blind VLM A/B judgment harness.
- `src/lib/yt-native.ts` — native bridge wrapper: yt-background plugin calls
  + W3C MediaSession helpers. Web = silent no-ops.
- `src/lib/yt-embed-api.ts` — official YouTube IFrame API loader (embed
  autoplay-next on ENDED, ENDED → our overlay when autoplay is off). All
  failures are silent — the embed plays regardless.
- `src/lib/yt-theme.ts` — theme engine (apply/watch/boot-script) + the
  `THEME_BOOT_SCRIPT` inline in layout.tsx.
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

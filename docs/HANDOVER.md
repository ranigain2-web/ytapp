# HANDOVER — Complete Project Context

> Purpose: anyone (human **or** AI agent) picking up this project cold should
> be able to continue development after reading this file plus
> [WORKLOG.md](../WORKLOG.md). It captures intent, decisions, state, and
> gotchas — the things code can't say.

## 1. What this project is

A personal, **ad-free, YouTube-style client** ("YouTube" is even the app name
— the UI is deliberately pixel-faithful to YouTube; that fidelity was a hard
product requirement, QA'd blind against the real site). Videos play from
YouTube's own CDNs through a custom HLS player, so no YouTube player runtime
runs and no ad slots exist. One React codebase → three products:

1. **Web** (Next.js 16 dev server / static export)
2. **Android APK** (Capacitor 7; needs a hosted backend)
3. **macOS Intel app** (Electron; **bundles the entire backend** — zero-config)

Owner: `ranigain2-web` (GitHub). Repo layout and quickstart: see
[../README.md](../README.md).

## 2. Origin story & phases (why things are the way they are)

- **Phase 1 — deep research** (2026-09-11/12): every known approach was
  tested live (embeds, Data API, public Invidious/Piped, raw InnerTube,
  youtubei.js, yt-dlp, PO tokens). Outcome: public proxy instances are dead;
  the only viable ad-free path is **owning the extraction stack** with
  youtubei.js v18 + bgutil PO tokens + IOS-client streams. Full record:
  [RESEARCH.md](RESEARCH.md) + `docs/research/*.json`.
- **Phase 2 — build**: complete React frontend (YouTube-clone UI, custom
  player, all local library features) + yt-api backend (session pool, TTL
  cache, HLS rewrite, byte proxy, SponsorBlock relay) + Capacitor Android CI.
  Fidelity was iterated with a blind critic loop against real YouTube
  screenshots (5 search-page rounds; watch page scored 9/10).
- **Phase 3 — this repo**: backend canonicalized into `server/` +
  vendored `pot-provider/`; **macOS Intel Electron app** added (self-contained
  runtime, local E2E-proven); Docker deploy path for the Android story;
  CI workflows fixed/hardened; full documentation suite; pushed to GitHub
  with Actions building both installers.

## 3. Current state (as of 2026-09-12)

- ✅ Web app fully working (E2E: home 15–28 cards, search, watch plays 4K
  `dQw4w9WgXcQ`, channel pages, history persistence).
- ✅ `scripts/test-electron-bundle.sh` — ALL PASS (packaged-desktop runtime
  path: spawns both services, serves frontend, HLS master→variant→segment
  bytes all through the local origin).
- ✅ Static export builds clean (`BUILD_MODE=static` → `out/`).
- ✅ Android platform verified locally (Cap 7.6.9, Gradle 8.11.1, SDK 35,
  icons overlaid).
- ✅ CI: `build-android.yml` + `build-macos.yml` on push/dispatch (check the
  repo's Actions tab for the current color).
- ✅ Docs: this suite.

## 4. The ten decisions that matter most

1. **Own the extraction stack** — no dependency on public Invidious/Piped
   (they're dead/block-prone). Our `server/` + `pot-provider/` do it all.
2. **PO tokens are mandatory** for stream extraction from non-residential
   IPs — bgutil runs everywhere the API runs (hence one-container Docker and
   the self-contained desktop app).
3. **youtubei.js v18 quirks**: WEB client = metadata (SABR, no URLs); IOS
   client = streams; `visitorData`+`poToken` must be a **matched pair** from
   one `/get_pot` call.
4. **Query-param routing** (`/?v=…`) — one bundle behaves identically on dev
   server, static hosting, Capacitor, Electron http origin.
5. **yt-api serves the desktop frontend itself** (`STATIC_DIR`) → same-origin
   → no CORS/file:// landmines; the Electron preload injects the API base
   into localStorage every launch (dynamic ports stay correct).
6. **Failure ladder** in the player: HLS → progressive → official embed
   (labeled honestly as possibly-ad-bearing).
7. **Polite-client behavior**: TTL cache + request coalescing + session
   rotation + multi-instance SponsorBlock with graceful degradation.
8. **Vendored pot-provider build** with a minimal pure-JS dep set (verified:
   jsdom works without canvas) — cross-arch safe for Intel builds.
9. **Unsigned macOS build** (identity: null) — right-click-open documented;
   signing is a documented future step, not a blocker.
10. **Android needs a hosted backend** (Node can't live in an APK) — the
    zero-cost option is the Mac app's backend on LAN Wi-Fi; Docker/Railway
    for real hosting.

## 5. Gotchas & known issues

- `URL_SUFFIX` defaults to `&XTransformPort=3001` (dev-sandbox gateway
  artifact). **Production must set `URL_SUFFIX=""`** (Docker + desktop
  already do). If manifests contain garbage URLs, check this first.
- Public-instance ecosystem rot: if you point anything at public
  Invidious/Piped today, expect failure — that's the whole reason this
  architecture exists.
- Bot-walls: some VEVO/monetized videos refuse streams even with PO tokens
  from datacenter IPs → embed fallback (by design). Mitigations:
  `YOUTUBE_COOKIE`, residential IP.
- SponsorBlock public API has outage history — app degrades silently.
- `src/lib/db.ts` + prisma deps are inert leftovers from the sandbox
  template; nothing imports them (safe to delete in a cleanup pass).
- `node_modules` inside `server/` and `pot-provider/` are gitignored — CI /
  Docker / desktop builds `npm install --omit=dev` them fresh.
- The sandbox `.zscripts/dev.sh` auto-starts the stack via the
  `mini-services/yt-api` shim — deleting that shim breaks sandbox auto-boot.
- Icons: regenerate with `python3 scripts/generate-icons.py` after edits;
  Android overlay lives in `icons/android/res/` and CI copies it after
  `cap add android` (the `android/` dir itself is gitignored).

## 6. How to resume work (10-minute orientation)

1. Read this file + WORKLOG.md tail.
2. `bash scripts/start-stack.sh && bun run dev` → confirm the home grid.
3. Skim `server/index.mjs` top comment + route list, `src/lib/yt-api.ts`,
   `electron/main.cjs`.
4. Pick from the roadmap below or fix what's red in Actions.

## 7. Roadmap (ranked)

1. **Signed + notarized macOS builds** (Apple Developer ID, CI secrets).
2. **YouTube cookie support in Settings** (paste cookie → server header) for
   VEVO coverage; plus cookie rotation helpers.
3. **GitHub Release automation** (tag push → APK/DMG attached to a Release).
4. **Apple Silicon / universal desktop target** (add `arm64` to builder).
5. **Playlists playback** (remote YouTube playlists via backend tabs API).
6. **Watch page MiniPlayer / picture-in-picture polish**, more keyboard parity.
7. **Self-host quick-deploy button** (Railway one-click template).
8. **i18n** of the few UI strings (the app UI is English; video metadata is
   already whatever YouTube returns).
9. Optional: DASH/WebM path for >1080p60 vp9-only videos where HLS lags.

## 8. Where the bodies are buried (file-level notes)

- `server/index.mjs` — read the header comment first; the HLS rewrite
  (recursive!) and `/api/segment` host allowlist are the security-sensitive
  parts. `STATIC_DIR` block is desktop-only.
- `electron/main.cjs` — port resolution + health waits + child process
  lifecycle (kills children on quit). `additionalArguments` carries the API
  base to preload.
- `src/components/yt/VideoPlayer.tsx` — the largest frontend file; controls,
  SB integration, storyboards, embed fallback.
- `scripts/test-electron-bundle.sh` — the fastest regression net for backend
  changes; run it before pushing.
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

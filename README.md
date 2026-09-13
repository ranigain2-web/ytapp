# YouTube — Ad-Free Client (React · Android · macOS Intel)

A pixel-faithful, YouTube-style app that streams real YouTube videos through a
custom HLS player — **no ads, no tracking**. One React codebase, three targets:

| Target | How | Status |
|---|---|---|
| **Web** | Next.js 16 dev server / static export | ✅ verified |
| **Android APK** | Capacitor 7 wrap → GitHub Actions builds debug + release APKs | ✅ CI on every push |
| **macOS (Intel x64)** | Electron bundle — **fully self-contained** (frontend + backend + PO-token provider inside the .app) | ✅ CI on every push |

## 📦 Downloads (Releases)

Versioned releases with ready-to-install artifacts live at
**[github.com/ranigain2-web/ytapp/releases](https://github.com/ranigain2-web/ytapp/releases)**:

- `ytapp-v<version>-debug.apk` — install directly on Android (fully standalone:
  no server, no proxy, no setup). Background play, audio mode, playback
  settings, Shorts, comments — all included.
- `ytapp-v<version>-release-unsigned.apk` — same app, release build.
- `ytapp-v<version>-macos-intel.dmg` / `.zip` — self-contained macOS app
  (unsigned: right-click → Open on first launch).

Pushing a `v*` tag triggers [`.github/workflows/release.yml`](.github/workflows/release.yml),
which builds both platforms and attaches everything to a GitHub Release with
auto-generated notes.


```
┌──────────────────────────┐        ┌───────────────────────────────────┐
│   React app (frontend)   │  HTTP  │        yt-api backend             │
│   Next.js 16 + hls.js    │ ─────► │  youtubei.js v18 + PO tokens      │
│   static export:         │  JSON  │  HLS manifest rewrite + byte proxy│
│   · out/  (web/APK)      │        │  TTL cache + session rotation     │
│   · bundled in .app      │        └───────────────┬───────────────────┘
└──────────────────────────┘                        │ InnerTube (keyless)
                                                    ▼
                                    ┌──────────────────────────────┐
                                    │  pot-provider (bgutil v2.0.0)│
                                    │  BotGuard attestation →      │
                                    │  PO tokens (unlocks streams) │
                                    └──────────────────────────────┘
```

**How "ad-free" works:** the backend extracts direct stream URLs from
YouTube's InnerTube API using PO-token attestation (the same technique
yt-dlp/NewPipe use), then serves an HLS manifest whose segments are proxied
through the backend. No official YouTube player runs → no ad slots exist.
Bot-walled videos (some VEVO/music) gracefully fall back to the official
embed, which may show ads.

> ⚖️ **Honest note:** this circumvents YouTube ads, which conflicts with
> YouTube's ToS. Keep it for personal use. Full legal/enforcement analysis in
> [docs/RESEARCH.md](docs/RESEARCH.md).

## Verified feature set

| Feature | Status |
|---|---|
| Home feed (trending + category chips) | ✅ |
| Search (results, channel card, "Latest from" shelf, filters) | ✅ |
| Watch page with **custom ad-free player** | ✅ up to 4K (2160p) |
| HLS adaptive quality (Auto/144p→4K), speed, captions (VTT) | ✅ |
| Keyboard shortcuts (k/j/l/f/m/arrows/0-9) | ✅ |
| Comments (top/newest sort) | ✅ |
| Channel pages (banner, avatar, videos, About) | ✅ |
| Subscriptions / History / Liked / Watch later / Playlists (local) | ✅ |
| Seek-progress resume on history items | ✅ |
| SponsorBlock auto-skip (multi-instance, degrades gracefully) | ✅ |
| Embed fallback for bot-walled videos (VEVO etc.) | ✅ |
| Mobile layout (bottom nav, responsive grid) | ✅ |
| Desktop app bundles the entire backend (zero-config) | ✅ |

## Documentation map (read these)

| Doc | What's inside |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How every piece works — frontend, yt-api, PO tokens, HLS proxy, caches |
| [docs/BUILD_GUIDE.md](docs/BUILD_GUIDE.md) | Building & shipping: Android APK, macOS app, backend deploys, signing |
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | Dev environment, commands, code tour, testing, debugging |
| [docs/RESEARCH.md](docs/RESEARCH.md) | The full Phase-1 research: every approach tested, what failed and why |
| [docs/HANDOVER.md](docs/HANDOVER.md) | Complete project context for a new developer or AI agent |
| [WORKLOG.md](WORKLOG.md) | Dated log of everything that was done, session by session |
| [AGENTS.md](AGENTS.md) | Operating instructions for AI coding agents on this repo |

## Repository layout

```
├── src/                     # React frontend (Next.js 16, App Router)
│   ├── app/page.tsx         #   single-page entry (query-param routing)
│   ├── components/yt/       #   all YouTube UI: player, pages, sidebar…
│   ├── components/ui/       #   shadcn/ui primitives used by the app
│   └── lib/                 #   api client, router, store, formatting
├── server/                  # ⭐ yt-api backend (single-file Node API)
│   └── index.mjs            #   youtubei.js v18 + PO tokens + HLS proxy
├── pot-provider/            # ⭐ PO-token provider (vendored bgutil v2.0.0 build)
│   ├── build/               #   compiled server (GPL-3.0, see NOTICE)
│   └── package.json         #   minimal production deps (express/jsdom/…)
├── electron/                # macOS desktop app (Electron, Intel x64)
│   ├── main.cjs             #   spawns pot-provider + yt-api, opens the window
│   ├── preload.cjs          #   injects the runtime API base
│   └── builder.yml          #   electron-builder config (dmg + zip, x64)
├── deploy/                  # Docker single-container backend + compose
├── icons/                   # icon sources + Android overlay (generated)
├── scripts/                 # start-stack, icons, e2e tests
├── docs/                    # all documentation + research artifacts
├── capacitor.config.ts      # Capacitor 7 config (webDir: out)
└── .github/workflows/       # CI: build-android.yml + build-macos.yml
```

## Quickstart

### 0 — Run the full stack locally (web app)

```bash
bun install                                  # frontend deps
bash scripts/start-stack.sh                  # starts pot-provider (:4416) + yt-api (:3001)
bun run dev                                  # http://localhost:3000
```

The dev sandbox routes API calls through its gateway automatically
(`?XTransformPort=3001`). Outside the sandbox, point the app at your backend:
**Settings → API server → `http://localhost:3001`**, or bake it at build time
with `NEXT_PUBLIC_API_BASE`.

### 1 — Android APK (GitHub Actions builds it for you)

Push to `main` → `.github/workflows/build-android.yml` automatically:

1. builds the static web app (`BUILD_MODE=static` → `out/`)
2. adds/syncs the Capacitor Android platform + applies app icons
3. runs Gradle `assembleDebug` + `assembleRelease`
4. uploads both APKs as **Artifacts** — download and sideload

The APK needs a reachable yt-api URL: set it in the app's **Settings** page
after install, or bake it at build time (workflow input `api_base`, or repo
variable `API_BASE`). Deploy the backend in minutes with
[deploy/](deploy/) (Docker) — see [docs/BUILD_GUIDE.md](docs/BUILD_GUIDE.md).

> Tip: the macOS app's bundled backend also works as your phone's API — open
> the Mac app and point the phone at `http://<mac-ip>:3001` (same Wi-Fi).

### 2 — macOS Intel app (GitHub Actions builds it for you)

Push to `main` → `.github/workflows/build-macos.yml` builds an **unsigned
Intel x64** `.dmg` + `.zip`. The app is fully self-contained — it bundles and
runs pot-provider + yt-api on `127.0.0.1` at launch, so nothing to configure.

First launch (unsigned app): right-click the app → **Open** → confirm.
Backend logs: `~/Library/Application Support/YouTube/logs/backend.log`.

### yt-api environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | listen port |
| `BGUTIL_URL` | `http://127.0.0.1:4416` | PO-token provider |
| `URL_SUFFIX` | `&XTransformPort=3001` | **set to `""` in production** (default routes through the dev sandbox gateway) |
| `STATIC_DIR` | _(empty)_ | serve a static frontend build (used by the desktop app) |
| `PUBLIC_URL` | _(empty)_ | set when the API is on another domain, e.g. `https://api.example.com` |
| `YOUTUBE_COOKIE` | _(empty)_ | optional YouTube cookies — unlocks VEVO/music videos |
| `SB_INSTANCES` | sponsor.ajay.app,… | SponsorBlock instances |

## API endpoints (yt-api)

| Endpoint | Returns |
|---|---|
| `GET /api/home?category=` | trending / category feed |
| `GET /api/search?q=&type=&duration=&upload_date=` | videos + channel result card |
| `GET /api/video/:id` | metadata, formats (up to 4K), HLS URL, captions, storyboard, related, chapters |
| `GET /api/video/:id/comments?sort=top\|new` | comments |
| `GET /api/channel/:id` | channel info + videos |
| `GET /api/hls/:id` | rewritten HLS manifest (segments proxied) |
| `GET /api/segment?u=` | byte proxy (segments, captions, storyboards) |
| `GET /api/stream/:id?itag=` | progressive mp4 passthrough |
| `GET /api/oembed/:id` | oEmbed metadata (title/author) |
| `GET /api/sponsorblock/:id` | skip segments (multi-instance fallback) |
| `GET /api/health` | status + PO token state |

## Tech notes

- **Player**: hls.js over the proxied manifest → adaptive 144p–4K, with a
  progressive mp4 fallback and an IFrame embed fallback for walled videos.
- **Routing**: single page + query params (`/?v=…&q=…&channel=…`) — exactly
  what static export + Capacitor + the desktop app want.
- **State**: zustand + localStorage (subs, history, likes, playlists, prefs).
- **Session health**: the backend rotates Innertube sessions + PO tokens
  automatically and caches responses (30–60 min) to survive YouTube's
  transient 403s.

## License

MIT for this repository's own code — see [LICENSE](LICENSE). The vendored
`pot-provider/` is a compiled build of
[Brainicism/bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider)
v2.0.0 (GPL-3.0-only) — see [NOTICE](NOTICE). This project is for personal,
non-commercial use.

# Developer Guide

Day-to-day working on ytapp: environment, commands, code map, testing,
debugging. New here? Read [HANDOVER.md](HANDOVER.md) first for full context.

## 1. Environment

- **Node ≥ 20** (22 recommended), **Bun** (frontend installs), **Python 3 +
  Pillow** (icon generation only).
- No database. No API keys. Everything runs locally.

## 2. Commands

```bash
bun install                       # frontend deps (root package.json)

# --- full local stack ---
bash scripts/start-stack.sh       # pot-provider :4416 + yt-api :3001 (idempotent)
bun run dev                       # frontend dev server :3000

# --- build ---
bun run build:static              # static export → out/ (Capacitor/desktop/web)
bunx next build                   # standalone server build (rarely needed)

# --- desktop app (dev mode, no packaging) ---
cd electron && npm install && npm start

# --- tests & tooling ---
bun run test:desktop-bundle       # E2E of the packaged-desktop runtime path
bun run icons                     # regenerate all app icons (Pillow)
bun run lint                      # eslint
```

### Dev-sandbox note (where this project was born)

The original development sandbox auto-starts services via a shim in
`mini-services/yt-api` → `scripts/start-stack.sh`, and routes frontend API
calls through a Caddy gateway using `?XTransformPort=3001` (hence the
`URL_SUFFIX` env default in `server/index.mjs`). Outside that sandbox,
`URL_SUFFIX` must be `""` — the Docker image and the desktop app already set
this.

## 3. Code map (where things live)

```
src/app/page.tsx            → AppShell mount (single page)
src/components/yt/AppShell  → layout, sidebar, mobile nav, page switch
src/components/yt/Header    → search bar + logo + theme
src/components/yt/ChipsBar  → category chips
src/components/yt/HomePage  → grid + skeletons + infinite scroll
src/components/yt/SearchPage→ results, channel card, "Latest from" shelf
src/components/yt/WatchPage → player + info + comments + related (+embed fallback)
src/components/yt/VideoPlayer → hls.js player: quality/speed/captions, SB skip
src/components/yt/Comments  → threaded comments (top/new)
src/components/yt/ChannelPage → banner, tabs, videos
src/components/yt/LibraryPages → subs / history / liked / later / playlists
src/components/yt/SettingsPage → API base + health + toggles
src/lib/yt-api.ts           → API client + types + base-URL resolution
src/lib/yt-router.ts        → query-param router (zustand store)
src/lib/yt-store.ts         → persisted state (subs, history, prefs)
src/lib/yt-format.ts        → view/date/duration formatting
server/index.mjs            → THE backend (one file, ~780 lines)
pot-provider/               → vendored bgutil v2.0.0 build + deps
electron/main.cjs           → desktop shell (spawns backend, opens window)
electron/preload.cjs        → runtime API-base injection
deploy/                     → Dockerfile.server, compose, start script
scripts/                    → start-stack, generate-icons, test-electron-bundle
icons/                      → icon sources + android overlay
```

## 4. Data model (client)

`YtVideo` / `YtVideoFull` / `YtComment` / `YtChannel` / `SbSegment` are
declared in `src/lib/yt-api.ts` — the backend's JSON shapes map 1:1. Persisted
localStorage keys are managed by zustand persist in `yt-store.ts`
(subscriptions, history with resume positions, likes, watch later, playlists,
preferences incl. `yt_api_base` — note the API client ALSO reads that key
directly, so it stays in sync with Settings and the desktop preload).

## 5. Backend endpoints (quick reference)

`/api/health`, `/api/home?category=`, `/api/search?q=&type=`, `/api/video/:id`,
`/api/video/:id/comments?sort=`, `/api/channel/:id`, `/api/hls/:id`,
`/api/segment?u=<base64url>`, `/api/stream/:id?itag=`, `/api/oembed/:id`,
`/api/sponsorblock/:id`. Details in README.

## 6. Testing

- **Manual E2E (10 min)**: start stack → dev server → home grid loads →
  search "lofi" → open a video → confirm playback + quality menu + captions →
  check history entry → open a VEVO video → embed fallback badge shows.
- **`scripts/test-electron-bundle.sh`**: automates the packaged-desktop
  runtime path (spawns both services exactly like the .app, verifies
  frontend serving, HLS manifest rewriting, segment bytes). Run it before
  any backend/desktop change.
- **CI**: both workflows build end artifacts — treat red CI as release
  blocker; read the failing step's log via the Actions UI or API.

## 7. Debugging playbook

| Symptom | Look at | Typical cause / fix |
|---|---|---|
| Home grid empty / errors | `/api/health` | yt-api down; `bash scripts/start-stack.sh` |
| `po_token: false` in health | pot-provider logs | bgutil not running or BotGuard failing; restart stack |
| Videos always embed-fallback | server log for `LoginRequired` | bot-wall — add `YOUTUBE_COOKIE`, or run backend on residential IP |
| Playback stalls at low quality | browser DevTools network → `/api/segment` | upstream throttling; check server CPU (proxying is streaming) |
| Search 403 after heavy use | server log | IP reputation — back off, cache TTLs already mitigate |
| Desktop app window blank | `~/Library/Application Support/YouTube/logs/backend.log` | backend failed to start (ports? deps packaged?) |
| APK can't reach API | Settings → health check | wrong base URL, or API not exposed beyond localhost |

## 8. Conventions

- TypeScript everywhere on the frontend; the backend is plain modern ESM
  Node (`.mjs`) — keep it single-file and dependency-light.
- UI: shadcn/ui primitives + Tailwind; YouTube-faithful styling is a
  **product requirement** (fidelity was QA'd blind against real YouTube —
  see WORKLOG).
- No new runtime deps without strong justification; the backend especially
  stays `express + youtubei.js` only.
- Commit messages: imperative, one line ("Fix HLS rewrite for subtitle
  renditions"). Big changes get a WORKLOG.md entry.

## 9. Updating vendored components

- **youtubei.js**: bump `server/package.json` + `pot-provider/package.json`
  together (both must stay v18-compatible), then re-run the full test
  checklist — InnerTube breakage is the #1 maintenance event.
- **bgutil (pot-provider)**: upstream
  `Brainicism/bgutil-ytdlp-pot-provider` — to upgrade, clone the tag, copy
  `server/build/*` into `pot-provider/build/`, realign `package.json` deps
  with upstream's runtime imports (grep `build/*.js`), re-run
  `scripts/test-electron-bundle.sh`.
- **Capacitor**: major versions change required Java/SDK — the workflow pins
  Node 22 / Java 21 / SDK 35 for Cap 7.

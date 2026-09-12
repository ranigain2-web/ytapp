# Architecture

How the ytapp system works, end to end. Read this together with
[docs/RESEARCH.md](RESEARCH.md) (why these choices) and
[docs/HANDOVER.md](HANDOVER.md) (current state).

## 1. The three runtime shapes

The SAME React codebase ships as three products:

| Shape | Frontend lives | Backend (yt-api + pot-provider) lives | API discovery |
|---|---|---|---|
| **Web (dev)** | Next.js dev server `:3000` | local processes `:3001` / `:4416` | empty base → sandbox gateway (`?XTransformPort=3001`) or Settings |
| **Android APK** | Capacitor WebView (static `out/`) | **remote** — Docker/Railway/VPS, or the Mac app on LAN | Settings → API server, or baked `NEXT_PUBLIC_API_BASE` |
| **macOS app** | Electron window | **inside the .app** — spawned as child processes on `127.0.0.1` | `preload.cjs` injects `http://127.0.0.1:<apiPort>` into localStorage every launch |

The desktop app is the crown jewel: `electron/main.cjs` bundles
`server/`, `pot-provider/` and `web/` (static export) as extraResources,
spawns both Node services via `ELECTRON_RUN_AS_NODE`, waits for their health
endpoints, then opens a window on `http://127.0.0.1:<apiPort>/` — served by
yt-api itself (`STATIC_DIR`). Same-origin → no CORS, no file:// routing
problems, zero user configuration.

## 2. Frontend (`src/`)

- **Next.js 16, single page** (`src/app/page.tsx` → `AppShell`). The whole app
  is one route; navigation is query-param based (`/?v=ID`, `/?q=…`,
  `/?channel=ID`, `/?page=settings`). This is what makes static export +
  Capacitor + the desktop app trivial (no server-side routing anywhere).
- **Router** (`src/lib/yt-router.ts`): a tiny zustand-backed router.
  `navigate()` = `history.pushState` + store update; `popstate` syncs back.
  The route lives in a SHARED store so every `useRouter()` instance agrees
  (this fixed a real bug — see WORKLOG.md).
- **API client** (`src/lib/yt-api.ts`): base-URL resolution order is
  1. `localStorage["yt_api_base"]` (set by Settings page **and** by the
     desktop preload on every launch — that's how dynamic ports work),
  2. `NEXT_PUBLIC_API_BASE` (baked at build),
  3. empty → relative paths + `?XTransformPort=3001` (dev sandbox gateway).
  All endpoints have timeouts (8–60 s) and surface `ApiError`.
- **Store** (`src/lib/yt-store.ts`): zustand + localStorage persistence for
  subscriptions, history (with seek progress for resume), liked videos,
  watch later, playlists, and preferences (theme, SB toggles, API base).
- **UI** (`src/components/yt/`): `AppShell` (layout + sidebar states +
  mobile bottom nav), `Header` (search), `ChipsBar` (categories),
  `HomePage`, `SearchPage` (channel card + "Latest from" shelf + filters),
  `WatchPage` (player + info + comments + related), `ChannelPage`,
  `LibraryPages` (subs/history/liked/later/playlists), `SettingsPage`
  (API base + health check + toggles), `VideoCard`, `Comments`, skeletons.
- **Player** (`src/components/yt/VideoPlayer.tsx`): hls.js with custom
  controls — quality menu (from HLS levels), speed, captions (VTT via
  `<track>`), buffered-bar + SponsorBlock skip markers, keyboard shortcuts,
  auto-hide controls, storyboard hover previews, and an official-embed
  IFrame fallback when the backend reports `embed_fallback: true`.

## 3. Backend — yt-api (`server/index.mjs`, ~780 lines, zero DB)

Express service. Responsibilities:

1. **Metadata** — InnerTube `WEB` client (richest responses: related videos,
   chapters, storyboards, captions). Survives bot-walls because metadata
   parsing reads `primary_info`/`secondary_info`.
2. **Stream extraction** — InnerTube `IOS` client: after YouTube moved WEB to
   SABR-only (no direct URLs), IOS still returns **24 deciphered direct URLs
   (up to 2160p) + an HLS manifest** when the request carries a valid
   **PO token** (see §4).
3. **HLS manifest rewriting** — the upstream manifest (googlevideo URLs that
   are IP-locked and expire) is rewritten recursively: every variant
   sub-playlist and media segment becomes `/api/segment?u=<base64url>` on the
   yt-api origin. Master → variant → segment all flow through one proxy, so
   the client never talks to googlevideo directly (works on any client IP).
4. **Byte proxy** (`/api/segment`) — validates the target host allowlist
   (googlevideo/ytimg/yt3/youtube), streams bytes with Range passthrough,
   and recursively rewrites any sub-playlist it encounters. CORS `*` so
   Capacitor/deployed frontends can call it.
5. **Session pool** — several Innertube sessions created with different
   visitor data; rotated on `403`/`LoginRequired`; one warm-up session at
   boot.
6. **TTL cache + request coalescing** — identical concurrent requests share
   one upstream call (protects quota when a page fires 20 lookups); entries
   live 30–60 min.
7. **SponsorBlock relay** — `/api/sponsorblock/:id` tries a list of SB
   instances and degrades to `{segments:[], unreachable:true}` if all fail.
8. **Static hosting** — when `STATIC_DIR` is set (desktop app), yt-api also
   serves the frontend build; any non-`/api` GET falls back to `index.html`.

Env vars: `PORT`, `BGUTIL_URL`, `URL_SUFFIX`, `STATIC_DIR`, `PUBLIC_URL`,
`YOUTUBE_COOKIE`, `SB_INSTANCES`. See README for defaults.

## 4. PO tokens (`pot-provider/`, vendored bgutil v2.0.0)

**What:** a *Proof-of-Origin token* is an attestation YouTube requires on
stream requests from non-official clients. Without it, InnerTube returns
bot-wall responses ("Sign in to confirm you're not a bot") from datacenter
IPs — the exact thing that killed public Invidious/Piped instances.

**How it's made:** `bgutils-js` runs YouTube's own BotGuard challenge JS in a
jsdom environment (no browser, no canvas needed — verified), producing an
integrity token; combined with a `visitorData` content binding this yields a
`poToken` valid ~6 hours. youtubei.js v18 needs `visitorData` and `poToken`
as a **matched pair** (both from the same provider call — this was a real
integration bug, see WORKLOG).

**Ops:** the provider is an HTTP server (`/get_pot` POST, `/ping` GET) on
`:4416`. yt-api refreshes tokens 30 min before expiry and continues without
them on failure (metadata/search still work; streams degrade to embed).

We vendor the **compiled build** (`pot-provider/build/`, 76 KB) with a
minimal production dependency set — verified working: `express`, `commander`,
`axios`, `jsdom`, `proxy-agent`, `youtubei.js`, `bgutils-js` (all pure JS,
no native modules → cross-arch safe for the Intel build). Upstream:
[Brainicism/bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider)
@ tag `2.0.0`, GPL-3.0-only (see NOTICE).

## 5. The ad-free playback pipeline (one watch click)

```
 UI clicks video
   → GET /api/video/dQw4w9WgXcQ          (metadata + formats + hls path)
   → GET /api/hls/dQw4w9WgXcQ            (yt-api fetches IOS HLS manifest w/ PO token,
                                            rewrites ALL urls → /api/segment?u=…)
   → hls.js loads master, picks a variant (Auto: by bandwidth)
   → GET /api/segment?u=<variant m3u8>   (proxied sub-playlist, rewritten again)
   → GET /api/segment?u=<media segment>  (bytes streamed Range-passthrough)
   → <video> plays 4K, no ad slots anywhere in the chain
```

Failure ladder: HLS fails → progressive `/api/stream/:id` → official IFrame
embed (ads possible, banner shown in UI). Bot-walled videos (VEVO) start at
the embed rung directly (`embed_fallback: true`).

## 6. Persistence & privacy

All user data (subscriptions, history + resume points, likes, playlists,
settings incl. API base) lives in **localStorage on the client device**.
No accounts, no telemetry, no server-side state — yt-api is stateless except
its caches. The backend never sees who watched what.

## 7. Known limitations (be honest when handing over)

- **ToS/legality**: ad circumvention conflicts with YouTube ToS (personal
  use; enforcement typically targets *public instances*, not clients —
  analysis in RESEARCH.md).
- **Bot-walls**: some monetized/music videos refuse streams from datacenter
  IPs even with PO tokens → embed fallback (ads possible). Mitigations:
  residential IP for the backend, or `YOUTUBE_COOKIE`.
- **YouTube moves fast**: InnerTube shapes change; youtubei.js updates fix
  them. Pin nothing without testing (`server/package.json` uses ^18).
- **SponsorBlock public instances** have had outages; multi-instance +
  graceful degradation is already in place.
- **Unsigned desktop app**: Gatekeeper right-click-open on first launch
  (signing guide in BUILD_GUIDE.md).
- **Android needs a hosted backend** (Node can't run inside an APK); the
  macOS app or a $5 VPS covers it (deploy/).

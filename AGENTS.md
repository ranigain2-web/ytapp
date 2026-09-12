# AGENTS.md — Operating manual for AI coding agents on this repo

You are continuing **ytapp**, a personal ad-free YouTube client (React →
web / Android APK / macOS Intel app). Read `docs/HANDOVER.md` and `WORKLOG.md`
before changing anything. Ground rules:

## Non-negotiables

1. **Keep the three-target contract**: the same static bundle must work on
   (a) `bun run dev`, (b) Capacitor Android, (c) the Electron desktop app
   (frontend served by yt-api at `http://127.0.0.1:<port>`). No
   server-only Next features, no file:// assumptions, no absolute API paths
   in code (base-URL resolution lives ONLY in `src/lib/yt-api.ts`).
2. **Backend stays single-file, dependency-light** (`server/index.mjs`:
   express + youtubei.js only). Desktop/Docker bundle it as-is — heavyweight
   or native deps break the Intel cross-build.
3. **`URL_SUFFIX` defaults to the dev-sandbox gateway suffix.** Production
   paths (Docker `deploy/`, Electron `electron/main.cjs`) override it to `""`.
   Never "clean this up" without understanding that.
4. **Test before pushing**: `bash scripts/test-electron-bundle.sh` must pass
   for ANY backend/desktop change; run a static export (`bun run
   build:static`) for frontend changes. CI (both workflows) must stay green.
5. **Honesty is a feature**: embed fallback keeps its "may contain ads"
   notice; docs keep the ToS analysis. Don't quietly remove disclaimers.
6. No secrets in the repo (`.env*` is gitignored; cookies/tokens only via
   env/CI secrets).
7. Append what you did to `WORKLOG.md` (dated entry) — the next agent
   depends on it.

## Fast orientation

```bash
bash scripts/start-stack.sh   # backend up (pot-provider + yt-api)
bun run dev                   # frontend :3000
curl http://127.0.0.1:3001/api/health   # expect ok:true, po_token:true
```

Key files: `src/lib/yt-api.ts` (API client), `src/components/yt/*` (UI),
`server/index.mjs` (backend), `electron/main.cjs` (desktop shell),
`pot-provider/` (vendored GPL bgutil build — keep NOTICE accurate).

## Common tasks

- **Add a UI feature**: frontend only → `src/components/yt/*`, follow
  existing YouTube-faithful styling; bump nothing else.
- **Add an API field**: extend `server/index.mjs` response → mirror the type
  in `src/lib/yt-api.ts` → use it in UI → run the bundle test.
- **youtubei.js broke** (stream/metadata shapes changed): check upstream
  release notes, bump BOTH `server` and `pot-provider` pins, retest.
- **CI red**: read the failing step log (Actions UI or API), fix, push;
  artifacts must keep uploading (`if-no-files-found: error` guards them).

## Things that look wrong but aren't

- `mini-services/yt-api` shim in dev sandboxes (auto-start hook) — it
  launches `scripts/start-stack.sh`.
- `src/lib/db.ts` + prisma deps: inert sandbox-template leftovers.
- Query-param routing (`/?v=…`): intentional (see HANDOVER §4).
- Upstream returning 200 (not 206) for Range requests on segment URLs:
  upstream behavior; hls.js fetches full segments.

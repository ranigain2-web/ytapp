# Build & Ship Guide

Everything needed to produce the three artifacts: **Android APK**,
**macOS Intel app**, and the **deployed backend**. All three CI paths are
already wired (`.github/workflows/`) — this guide explains what they do and
how to do it by hand.

## 1. CI builds (zero effort path)

| Workflow | Trigger | Outputs (Actions → Artifacts) |
|---|---|---|
| `build-android.yml` | push to `main`, manual dispatch | `ytapp-debug-apk`, `ytapp-release-unsigned-apk` |
| `build-macos.yml` | push to `main`, manual dispatch | `ytapp-macos-intel-dmg`, `ytapp-macos-intel-zip` |

Find them at `https://github.com/<you>/<repo>/actions`. Download artifacts
from any run's page (retention: 90 days — attach to a Release for permanence).

### 1.1 Android APK

The workflow: bun install → static export (`BUILD_MODE=static`) → `cap add
android` (fresh Gradle project) → icon overlay from `icons/android/res/` →
`gradlew assembleDebug` + `assembleRelease`.

**Install the debug APK** on a phone: enable "Install unknown apps" for your
file manager/browser → open the APK → install. The release APK is unsigned —
sign it yourself (§3.1) if you want install-on-boot persistence / Play-less
updates.

**The APK needs an API server URL.** Options (pick one):
1. **Set it at runtime** (recommended): open the app → Settings → API server
   → `http://<your-backend>:3001`.
2. **Bake at build time**: workflow input `api_base` (manual dispatch), or
   repo variable `API_BASE` (Settings → Secrets and variables → Actions →
   Variables).

Where to get a backend URL:
- **Zero-cost**: launch the macOS app on a Mac on the same Wi-Fi → point the
  phone at `http://<mac-ip>:3001` (yt-api binds 0.0.0.0 and sends CORS `*`).
- **Self-host**: `deploy/` Docker image on any VPS (§2).
- **Managed**: Railway/Render/Fly free tiers (§2.2).

### 1.2 macOS Intel app

The workflow: bun install → static export → npm install for `server/` +
`pot-provider/` + `electron/` → `electron-builder --mac --x64` → dmg + zip.

**First launch (unsigned app):**
1. Open the DMG, drag **YouTube** to Applications.
2. In Finder: **right-click the app → Open → Open** (Gatekeeper warns once).
   macOS 15+ may require System Settings → Privacy & Security → "Open
   Anyway".
3. The app starts its bundled backend (pot-provider ~5–20 s on first token
   generation) then opens the window.

Logs if something looks wrong:
`~/Library/Application Support/YouTube/logs/backend.log`.

Requires macOS 10.15+ on an **Intel** CPU (x64). For Apple Silicon later:
add `arch: [arm64]` (or `universal`) to `mac.target` in
`electron/builder.yml` and rebuild.

## 2. Deploying the backend (yt-api + pot-provider)

Both services must run together — use the provided single-container image:

```bash
docker build -f deploy/Dockerfile.server -t ytapp-server .
docker run -d -p 3001:3001 --name ytapp-server ytapp-server
curl http://localhost:3001/api/health   # {"ok":true,"po_token":true,...}
```

or with compose (restart policy included):

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

### 2.1 Environment

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | public port |
| `POT_PORT` | `4416` | internal PO-token provider port |
| `PUBLIC_URL` | empty | set to your public URL so manifests carry absolute URLs |
| `YOUTUBE_COOKIE` | empty | YouTube cookies (see §4) — unlocks bot-walled videos |

### 2.2 Railway / Render / Fly (managed)

- **Railway**: New Project → Deploy from GitHub repo → it detects
  `deploy/Dockerfile.server` (set Start Command if prompted; add a domain;
  optionally set `PUBLIC_URL`). Free/low tier is enough for personal use.
- **Render**: New → Web Service → Docker → point at the repo; the Dockerfile
  is auto-detected from `deploy/`.
- **Fly.io**: `fly launch --dockerfile deploy/Dockerfile.server`.

### 2.3 Behind a reverse proxy

Caddy example (terminate TLS, keep Range support):

```
ytapi.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

Then set `PUBLIC_URL=https://ytapi.example.com` on the container and bake
that URL into the APK (or type it into Settings).

## 3. Local builds by hand

### 3.1 Android (needs Android Studio or CLI SDK + JDK 21)

```bash
bun install
BUILD_MODE=static NEXT_PUBLIC_API_BASE=https://your-api bunx next build
bunx cap add android          # first time only
bunx cap sync android
cp -r icons/android/res/* android/app/src/main/res/   # app icons
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Signing a release APK:

```bash
keytool -genkey -v -keystore release.keystore -alias ytapp \
        -keyalg RSA -keysize 2048 -validity 10000
# then add signingConfig to android/app/build.gradle, or:
apksigner sign --ks release.keystore --out app-release.apk app-release-unsigned.apk
```

(For CI signing, store the keystore as a secret and add a signing step to
`build-android.yml`.)

### 3.2 macOS (any Mac with Node 20+)

```bash
bun install
BUILD_MODE=static bunx next build          # empty NEXT_PUBLIC_API_BASE (preload injects it)
cd server        && npm install --omit=dev
cd ../pot-provider && npm install --omit=dev
cd ../electron   && npm install
npx electron-builder --mac --x64 --config builder.yml --publish never
# → electron/release/*.dmg + *.zip
```

Run the desktop shell locally without packaging:

```bash
cd electron && npm install && npm start
```

### 3.3 Web static build

```bash
BUILD_MODE=static NEXT_PUBLIC_API_BASE=https://your-api bunx next build
# → out/  (serve with any static file server)
```

## 4. YouTube cookies (unlock VEVO / age-gated content)

yt-api accepts a `YOUTUBE_COOKIE` env var (a logged-in browser's cookie
header). This significantly improves stream availability for music-label
videos from datacenter IPs. Trade-offs: the account's watch history may see
activity; cookies expire; treat them as a secret (env var / CI secret —
never commit). Rotation scripts are a future roadmap item.

## 5. Verification checklist (what "done" means)

1. `curl http://<api>/api/health` → `{"ok":true,"po_token":true,…}`
2. `curl "http://<api>/api/home?category=all"` → JSON with results
3. App home grid renders; search returns results
4. Watch page: video actually advances (currentTime > 5 s), quality menu
   shows 144p–4K options, captions selectable
5. Bot-walled video (try a VEVO title) → falls back to embed with the
   "official embed" notice
6. Desktop bundle test: `bash scripts/test-electron-bundle.sh` → ALL PASS
7. CI: both workflows green; artifacts download and open/install

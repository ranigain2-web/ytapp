# Phase-1 Research Record — "How do we build an ad-free YouTube app?"

This is the complete record of the investigation that produced this
architecture (raw search-result artifacts live in `docs/research/*.json`;
test scripts and screenshots from the period are summarized in WORKLOG.md).
Date of research: 2026-09-11 → 2026-09-12. Everything below was **verified
live**, not read about.

## TL;DR — the decision matrix

| Approach | Playback | Ads | Legal | Reliability | Verdict |
|---|---|---|---|---|---|
| Official IFrame embed | ✅ always | ❌ **ads on monetized videos** | ✅ ToS-clean | ✅ high | Kept as **fallback** |
| YouTube Data API v3 | metadata only | n/a | ✅ | ✅ but quota 10k units/day | Rejected (no playback, needs key) |
| Public Piped/Invidious instances | was ✅ | ✅ none | ⚠️ | ❌ **dead ecosystem-wide** | Rejected |
| Raw InnerTube (no PO token) | ❌ bot-walled | — | ⚠️ | ❌ from datacenter IPs | Rejected alone |
| **InnerTube + PO tokens (bgutil) + IOS client** | ✅ up to 4K | ✅ **none** | ⚠️ ToS conflict | ✅ with session rotation + cache | **CHOSEN** |
| yt-dlp server-side | ✅ w/ cookies | ✅ none | ⚠️ | ⚠️ needs cookies/residential | Alternative backend |
| NewPipe (Android native) | ✅ | ✅ none | ⚠️ | ✅ | Different stack (Java) — reference design |

## 1. What "no ads" actually requires

Ads are injected by **YouTube's own player runtime** (and its ad SDK
`googleads.g.doubleclick.net`), not baked into the video streams. Any client
that plays the raw `googlevideo.com` streams with its own player
(hls.js/dash.js/ExoPlayer) simply has no ad slots — this is the NewPipe /
FreeTube / Invidious / Piped model.

So the real problem is: **how do we get raw stream URLs reliably?**

## 2. Live-tested approaches

### 2.1 Official IFrame embed — works, but ads are real
- Embedded players verified in a headless browser: video bytes stream
  (`googlevideo.com/videoplayback`, SABR, `c=WEB_EMBEDDED_PLAYER`).
- **Ad observation**: monetized videos fire `googleads.g.doubleclick.net`
  requests; in testing, ad-monetized videos (Despacito, Veritasium) hit the
  bot-wall or stuck-buffering headlessly, while non-monetized (Rick Astley)
  played freely. Embeds are NOT an ad-free guarantee.
- Kept in the app as the reliability fallback rung (with an honest UI badge).

### 2.2 YouTube Data API v3 — metadata only
- Requires an API key; 10,000 units/day default quota (100 per search ⇒
  100 searches/day). No playback endpoints. Rejected — our backend gets
  richer metadata keyless (§2.5).

### 2.3 Public Piped / Invidious — the ecosystem is dead
- 5 public Piped instances tested: all failing (SSL errors, 502s, or
  `SignInConfirmNotBotException`). YouTube blocks datacenter IPs
  ecosystem-wide.
- Invidious public instance list collapsed to ~3–5, and remaining instances
  run with **API disabled** (web-only mode) to survive.
- Invidious's own guidance moved to self-hosting (docs/research/s04). Using
  public instances as an app's backbone = guaranteed breakage. Rejected.

### 2.4 Raw InnerTube (youtubei.js) without PO tokens
- Tested 6 client identities (WEB, ANDROID_VR, TVHTML5, WEB_EMBEDDED, IOS,
  MWEB): **all bot-gated from datacenter IPs** on stream requests.
- Search/comments/home-feed/metadata **do work keyless** (and still do —
  that's what the app uses).
- WEB client became SABR-only (no direct URLs) — dead end for direct
  streaming.

### 2.5 The breakthrough: PO tokens + IOS client (CHOSEN)
- **PO token** = Proof-of-Origin attestation (BotGuard challenge solved in
  Node via `bgutils-js` — no browser, no canvas; verified headless).
  Without it, stream extraction from datacenter IPs is bot-walled.
- `bgutil-ytdlp-pot-provider` v2.0.0 (server mode) generates matched
  `visitorData` + `poToken` pairs on `:4416`.
- youtubei.js v18 + that pair on the **IOS client** returns **24 direct
  deciphered stream URLs (up to 2160p) + an HLS manifest** — real bytes
  fetched (HTTP 206) during research.
- This runs fine on ordinary servers/desktops; it is what both `server/`
  (metadata via WEB + streams via IOS) and the desktop app bundle today.

### 2.6 Adjacent findings
- **yt-dlp** (2026.08.19): metadata works; streams need cookies/PO tokens —
  consistent with the above.
- **SponsorBlock** public API had a full outage during research (404s, status
  page confirmed); project alive (ext v6.1.7). Our backend therefore queries
  multiple instances and degrades gracefully.
- **oEmbed** (`https://www.youtube.com/oembed`) works keyless — used as a
  metadata fallback.
- **IP reputation degrades with use**: search throttled (403) after heavy
  testing in one session → the backend ships TTL caching + request
  coalescing + session rotation to be a good citizen.

## 3. Legal / enforcement picture (read before distributing)

- **YouTube ToS §4** prohibits access "using any technology other than our
  official clients". Ad circumvention additionally intersects
  anti-circumvention arguments. This app is a personal-use client — the same
  category as NewPipe/FreeTube (alive for years) rather than a public
  re-hosting service (Invidious instance operators received legal requests
  in 2022; public Piped instances get IP-blocked).
- **Enforcement pattern observed**: YouTube blocks *server IPs* and targets
  *public instances*; clients running on user devices with rotating sessions
  have stayed viable (NewPipe since 2015, FreeTube actively maintained).
- **Practical guidance**: personal use; self-host your backend; don't run a
  public multi-user instance off this code without accepting the risk;
  consider cookies on a residential IP for best availability.
- Prior art studied: NewPipe, FreeTube, GrayJay, Invidious, Piped,
  LibreTube, yt-dlp, SponsorBlock (see docs/research/*.json for sources).

## 4. Platform strategy research

- **React mandated** (user requirement) → Next.js 16 static export for the
  UI, because Capacitor needs a static bundle and the same bundle serves the
  desktop app.
- **Capacitor 7** for Android (web-tech wrap; generates a real Gradle
  project; debug APKs sideload directly).
- **Electron** for macOS: bundles Node.js → the whole backend stack can live
  INSIDE the app (Capacitor can't run Node servers; Termux-style hacks
  aren't production-viable). Intel x64 target per requirement; unsigned
  builds work via right-click-open (documented).
- **GitHub Actions** builds everything: free unlimited minutes on public
  repos (incl. macOS runners), artifacts downloadable per run.
- Frontend routing chosen as **query-params** (`/?v=…`) so the identical
  bundle works on: Next dev server, static hosting, Capacitor WebView, and
  Electron http origin. (A file:// + hash-router design was rejected to keep
  one behavior everywhere.)

## 5. Conclusions that shaped the build

1. **Own the extraction stack** — never depend on public instances.
2. **PO tokens are the load-bearing wall** — the bgutil provider must run
   wherever yt-api runs (hence the single-container Docker image and the
   self-contained desktop app).
3. **Fail gracefully down a ladder** — custom player → progressive → embed,
   and SponsorBlock unreachable ≠ broken app.
4. **Be a polite client** — cache, coalesce, rotate sessions, or YouTube's
   IP-reputation systems will throttle you.
5. **Honesty in the UI** — embed fallback is labeled ("may contain ads");
   docs tell users the ToS reality.

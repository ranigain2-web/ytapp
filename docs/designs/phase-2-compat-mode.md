# Phase 2 — Compat Mode (v2.5.0)

- **Date:** 2026-11-07
- **Author:** ytapp development agent (master plan §7)
- **Status:** Implemented — gate pending
- **Components:** `plugins/yt-compat/`, `src/lib/compat/`, `src/lib/yt-compat.ts`, `src/components/yt/CompatPage.tsx`, `src/components/yt/{AppShell,WatchPage,SettingsPage,VideoSurface}.tsx`, `src/lib/{yt-router,yt-store}.ts`, `scripts/{test-guard-core.ts,e2e-compat.mjs}`

## The Problem

When the server's whole extraction chain is gated (datacenter IPs, hard
bot-gating), every affected video falls back to the ad-bearing IFrame embed,
which means: ads, no background play (the #1 promise), no lock-screen
controls. The research showed the winning architecture — a native WebView
loading YouTube's real mobile site with injected hooks — requires being
inside a native app shell.

## Overview

A `yt-compat` Capacitor plugin overlays a fullscreen native WebView on the
app loading `m.youtube.com/watch?v=<id>` with a genuine mobile-Chrome UA.
At document start it injects a bundle built at runtime from unit-tested pure
functions: a visibility spoof (the page never learns it is hidden), a
background guard with user-intent attribution (auto-resume only when the
pause was not the user's, never during ads, max three attempts, auto-click
the one-button "Continue watching" dialog), an ad stripper (InnerTube
responses scrubbed of ad payloads across fetch, XHR, and the ytInitial*
globals), and a cookie collector. Player state flows back through a
`ytCompatNative` bridge into the existing lock-screen service; notification
controls flow forward via `evaluateJavascript`; the session's cookies can be
shared with the user's own server (the Phase 1 cookie endpoint) so downloads
and extraction benefit too. The entry point appears only on native, only on
embed-fallback videos, with an honest notice; a Settings toggle is the
kill-switch; an injected in-page pill plus the notification's Close tear it
down.

## Goals / Non-Goals

Goals: make every gated video playable with screen-off background audio,
lock-screen controls, and stripped ads on Android; keep the web/desktop
targets unaffected; never let a hook failure kill playback (every injected
section is fail-safe and reports `hookfail`). Non-goals: iOS (not one of the
three targets — dev web / Capacitor Android / Electron; the plugin interface
is platform-neutral if that ever changes), and any change to the direct
extraction path (Phase 1).

## Technical Plan (as built)

- **Plugin (Java):** fullscreen WebView added to the activity decorView,
  `onPageStarted` document-start injection (idempotent re-arm on
  `onPageFinished`), `addJavascriptInterface(CompatBridge, "ytCompatNative")`,
  `execute` (evaluateJavascript), `close` (remove+destroy), all URLs stay
  in-view (sign-in inside compat is allowed — that is what makes the cookie
  export valuable).
- **guard-core.ts:** pure, import-free functions (`shouldAutoResume`,
  `isContinueWatchingDialog`, `stripAdPayload` with cycle-cutting,
  `toNetscapeCookieFile`) — unit-tested directly.
- **compat-injection.ts:** composes the bundle from the guard-core function
  SOURCES via `Function.prototype.toString` (single source of truth; the
  test suite syntax-validates the composed output and checks it contains no
  template literals).
- **CompatPage:** the control room behind the native surface — relays media
  state to `YtBackground.update`, forwards `control` events into
  `compatControls` (pause stamps `__ytUserPauseAt` so the guard never fights
  a deliberate pause), shares cookies with the server when the toggle is on,
  exits cleanly on the injected pill or notification Close.

## Alternatives Considered

- **IFrame embed with postMessage.** Rejected: X-Frame-Options forbids
  framing and a cross-origin frame can never be scripted.
- **Seeding a youtubei.js session from the compat page's data.** Rejected for
  v1: the compat surface already plays; extraction-level fixes belong to
  Phase 1's chain.
- **iOS variant (WKUserScript).** Descoped: iOS is not one of this app's
  three build targets.

## Verification (gate)

1. tsc 0; `bun run build:static` green (both bundler paths verified).
2. `bun scripts/test-guard-core.ts` — 25/25 (attribution, dialog signature,
   ad-strip with cycles, Netscape format, bundle syntax + content).
3. `scripts/e2e-compat.mjs` — mocked native bridge (PluginHeaders +
   nativePromise/nativeCallback fakes): 8/8 — entry, open URL + injection
   content, background enable, media relay, user-attributed pause, close
   teardown, kill-switch.
4. The remaining suites unchanged: embed journey, battery, parity, ads,
   background, playback, premium, bundle test, v12 before/after.
5. **Device verification pending (honest limit):** the Java plugin cannot be
   compiled in this sandbox (no Android SDK). The e2e proves the app-side
   wiring against a faithful bridge fake; the WebView overlay itself needs
   one Android build on a device or CI.

## Post-mortem notes (kept for the record)

Three earlier defects were misdiagnosed during development and are documented
here because they shaped the committed tree: (1) the build failures were
caused by a 2.9GB core dump that an auto-commit swallowed into the repo
(Tailwind's source scan ingested it; purge + `core.*` gitignore fixed it —
commit 3855d01's message attributes them to a stub's type-level import,
which was wrong); (2) the "setPipOnHome 1200x/s app loop" was a
self-recursive mock bridge (the fake dispatched into `Capacitor.Plugins`,
which `registerPlugin` replaces with proxies that call back into
`nativePromise`) — the app was innocent, the fake now dispatches through a
private table; (3) commit 3855d01 claimed to restore the plugin import but
did not actually contain the change — the stub survived until this phase's
final pass. All three are now fixed with tests proving the real behavior.

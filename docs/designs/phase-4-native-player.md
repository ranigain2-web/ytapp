# Phase 4 — Native Android Player (v2.7.0)

- **Date:** 2026-11-07
- **Author:** ytapp development agent (master plan §9)
- **Status:** Implemented — app-side gate green; **native code UNVERIFIED (needs one Android build)**
- **Components:** `plugins/yt-player/` (Java), `src/lib/yt-player.ts`, `src/lib/yt-native-engine.ts`, `src/components/yt/{VideoSurface,SettingsPage}.tsx`, `src/lib/yt-store.ts`, `scripts/{test-native-url.mjs,e2e-native-player.mjs}`

## The Problem

The WebView `<video>` is the app's weakest foundation on Android: when the
screen turns off, WebView timers starve and HLS playback dies — the whole
v2.2.0 foreground-service machinery exists to fight that. A native Media3
engine makes screen-off playback the OS's problem: ExoPlayer in a
MediaSessionService with a real MediaSession, media notification, audio
focus, and becoming-noisy handling, all correct by construction.

## Overview

A `yt-player` Capacitor plugin (ExoPlayer + Media3 session service) plus a
store-facing engine adapter. The routing is surgical: when the experimental
toggle is ON and the plugin is present, the VideoSurface load effect hands
the SAME source selection (audio-only > HLS > progressive) to the native
engine instead of the element; native state events drive both the playback
store and the surface's local UI state; the surface's transport functions
(togglePlay/pause/seekTo/seekBy) and the store's registered engine route to
the native player. Everything else — seek bar, chapters overlay, mini
player, autoplay — keeps working because it reads the same state.

## Honest verification boundary

This sandbox has no Android SDK: the Java (plugin + service, written against
Capacitor 7 and Media3 1.5 APIs) **has never been compiled**. What IS
verified: the app-side wiring, end to end, against a faithful mocked bridge
(e2e-native-player 4/4 — prepare with the right source and metadata, native
position reaching the player UI through the store, transport routed
natively, engine swap release) plus the pure URL selection (unit 6/6).
The pref ships default-OFF ("Native player (experimental)") and the toggle
text says plainly that it is not yet device-verified. Flipping it on for
users requires one Gradle build and a device smoke test.

## Alternatives Considered

- **Fork the whole VideoSurface for native.** Rejected: 1,459 lines of
  UI logic keyed to element events; the adapter approach changes ~40 lines
  and keeps one UI for both engines.
- **Keep everything in the WebView forever.** Rejected: the plan's Phase 4
  exists precisely because timer starvation is unfixable at the WebView
  layer when the app is backgrounded.
- **Media3 in the existing yt-background plugin.** Rejected: mixing the
  WebView's service and a player service muddies both; a separate plugin
  keeps each release independently revertable.

## Verification (gate)

1. tsc 0; build:static green.
2. `bun scripts/test-native-url.mjs` — 6/6 (source selection parity with
   the WebView path, gateway-resolved URLs).
3. `scripts/e2e-native-player.mjs` — 4/4 against the mocked bridge.
4. All existing suites unchanged (the native path is feature-detected OFF
   on web — every prior suite exercises exactly the WebView path).
5. Bundle test ALL PASS. v12 baseline-identical.
6. PENDING (device): Gradle build of the plugin, screen-off playback,
   notification controls, PiP interplay — the honest open item.

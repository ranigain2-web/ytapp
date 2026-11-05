# Concepts Brief — ytapp v2.0 "Total Parity" Round

* **Author:** ranigain2-web (owner), drafted by the session AI (elephant)
* **Date:** 2026-11-05
* **Status:** finalized 2026-11-05 — reviewed by five zero-context goldfish
  lenses, all 43 findings resolved; the plan lives at
  `docs/designs/2026-11-05-premium-parity-v2.md` with its review record

## Overview

ytapp already looks and mostly behaves like YouTube (v1.2.1, phase 13: measured
fidelity on the big surfaces, 5/5 user-reported bugs fixed and verified). The
owner's next round asks for the remaining distance to be closed end to end: the
app must be **indistinguishable from real YouTube in daily use** — the video,
the interactions, and the visible appearance — while staying **ad-free** and
shipping the **full YouTube Premium feature set for free** (background play
front and center), on a fully standalone Android app, web, and macOS.

This brief anchors what "done" means and what the plan must contain. The full
design lives in `docs/designs/2026-11-05-premium-parity-v2.md`.

## Analysis (from the deep-dive audit, 2026-11-05)

A file-by-file audit of all 16 components, the InnerTube engine, the Android
background plugin, the theme system, and every existing test harness produced a
precise gap inventory:

1. **Premium features exist but the set is incomplete.** Background play
   (foreground service + MediaSession + notification controls), audio mode
   with artwork, ad-free direct streams, and desktop PiP are in. Missing from
   the Premium set: **in-app miniplayer** (none exists), **Android native
   PiP**, audio-focus/becoming-noisy handling (playback doesn't yield to calls
   or pause on headphone unplug), landscape→fullscreen, and a data-saver
   quality cap. Offline downloads are the only Premium feature deliberately
   deferred (legal + scope; marked as a non-goal this round).
2. **The ad-free guarantee is conditional.** Every direct stream is ad-free by
   construction, but bot-gated videos fall back to the official embed where
   YouTube can show ads. Standalone mode skips `signatureCipher` formats
   entirely, which pushes more videos into the embed than necessary. Shrinking
   the embed surface and asserting ad-absence in tests are both required.
3. **Dead UI is the single biggest interaction gap.** 12+ controls render but
   do nothing (mic, cast, bell, search filter chips, Shorts subscribe/dislike/
   more, comment like/reply/composer, sidebar sign-in, playlist cards). The
   toast system is mounted but never called — Share copies silently. Real
   YouTube has zero dead controls; we have a dozen.
4. **Whole surfaces are missing or skeletal.** Subscriptions page lists
   channels instead of a video feed (the page's entire purpose), channel pages
   have 2 of ~7 tabs with no sort, comments have no reply threads or working
   sort, Shorts use a fake channel identity and fabricated like counts, there
   is no 3-dot card menu (Not interested / Save / Share), no notifications
   surface, no search filters, no account menu, no autoplay countdown.
5. **Appearance polish is half-wired.** ~25 hardcoded colors bypass the theme
   tokens (several visibly wrong in light theme), a 12-class "motion layer" in
   globals.css is defined but never applied, and two store prefs
   (defaultQuality, cinemaMode) have no UI.
6. **The bar itself needs upgrading.** Fidelity measurement covers only 3
   surfaces; CI has **zero test gates** (a tag publishes to users untested);
   the blind critic is manual-only; no harness asserts ad-absence, captions,
   SponsorBlock, keyboard, or real-device background play.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  - Complete the Premium set (background play hardened, miniplayer, Android
    PiP, audio focus, data saver) — all free, all tested.
  - Make every visible control real (zero dead UI) and add the missing
    interaction layer (toasts, 3-dot menus, sheet patterns, haptics,
    pull-to-refresh).
  - Close the big surface gaps: Subscriptions feed, channel tabs + sort,
    comment threads, Shorts identity + comments sheet, search filters,
    notifications (local), account menu, autoplay countdown.
  - Shrink the embed fallback (decipher signatureCipher on-device like
    NewPipe) and make "ad-free" an asserted, tested property.
  - Wire the appearance polish: theme-token sweep, motion layer, skeletons,
    fidelity bar extended to all surfaces.
  - Turn the toolbelt into the method: REA for ground truth from real
    YouTube, gauntlet loops with the blind VLM critic as the exit condition,
    EGM goldfish reviews on every phase plan, CI gates on PR + release.
* **Out-of-Scope Non-Goals:**
  - Offline downloads (legal exposure; revisit separately).
  - Posting comments/likes to YouTube (needs an account; stays local).
  - Sign-in, Sync, YouTube Music, Live chat interaction.
  - Server-mode feature work beyond parity with standalone.

## Alternatives Weighed

* **Rewrite the player on a native Android media stack (ExoPlayer/Media3).**
  Rejected by author: doubles the surface for the same UX, loses the one-React-
  codebase guarantee, and the WebView+foreground-service approach is already
  proven for background play. (Revise only if WebView streaming proves
  unreliable on target devices.)
* **Ship Premium parity as one big v2.0 release.** Rejected by author: the
  version-skew lesson from session 11 (user ran a stale APK and reported
  shipped features as missing) says ship small, tagged, frequent releases with
  the in-app What's-new tour updated each time.
* **Use the Data API v3 for the missing surfaces.** Rejected by author: quota-
  capped, key-requiring, and contradicts the fully-standalone requirement.
  InnerTube (the NewPipe-proven path) already carries the app.

## Key Decisions & Staging for Next Steps

1. The plan is staged into 6 phases, each independently shippable as a tagged
   release, each with its own E2E suite additions and its own exit criteria.
2. The gauntlet bar is fixed up front: real `m.youtube.com` / `www.youtube.com`
   at 4 reference viewports, captured with REA as Evidence, judged by the
   blind VLM critic; measurable half = fidelity JSON geometry diff +
   audit-ui defect count + E2E pass rate.
3. EGM discipline: this brief + the design doc go through fresh-context
   goldfish review before implementation; each phase's section is reviewed the
   same way before its code is written.
4. Background play is hardened first (audio focus, becoming noisy, wake
   behavior, device-level verification via ADB) because it is the owner's
   headline Premium ask and everything else builds on the playback store the
   miniplayer needs anyway.

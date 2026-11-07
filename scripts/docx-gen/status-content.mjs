// status-content.mjs — final execution status, 2026-11-07 session 2 (ASCII only)
export const META = {
  title: "ytapp Execution Status",
  subtitle: "Brutal audit, corrected record, and what actually shipped — v2.3.0 through v2.8.0",
  englishLabel: "EXECUTION STATUS — 2026-11-07 (FINAL)",
  metaLines: [
    "Program: ytapp Master Build Plan (phases 0-5)",
    "Report date: November 7, 2026",
    "Tagged this run: v2.5.0, v2.6.0, v2.7.0, v2.8.0 (v2.3.0 / v2.4.0 previous run)",
    "All work committed locally; nothing pushed",
  ],
  footerLeft: "ytapp",
  footerRight: "November 2026",
};

export const BLOCKS = [
  { h1: "1. The Brutal Audit — What the Previous Claims Got Wrong" },
  { p: "Before building anything, every claim from the previous session was re-verified against the actual repository, and three were wrong. First, the committed Phase 2 work was non-functional: the working tree contained a leftover debugging stub, so Compat Mode's open call always threw an error — worse, the commit that claimed to fix this (3855d01) did not actually contain the fix; the change was lost in a checkout dance before committing. Second, the 'environmental build OOM' conclusion was wrong: the real cause was a 2.9GB core-dump file that an auto-commit had swallowed into the repository, which Tailwind's source scanner then tried to ingest on every build. Purging the file (plus a gitignore for core dumps and repository garbage collection) made builds deterministically green — the v2.4.0 tag always built because checking it out removed the file. Third, the 'setPipOnHome 1200x/s app-side render loop' was a bug in the test itself: the mocked native bridge dispatched plugin calls back into the very table that Capacitor's registerPlugin overwrites with proxies, creating a self-recursion of 1.4 million calls. The app was innocent; the fake bridge now uses a private dispatch table, and the guard left in the app was kept only as cheap insurance with a corrected comment. All three corrections are recorded in the commit history and the phase-2 design document's post-mortem." },

  { h1: "2. What Shipped This Session — Verified" },
  { p: "Phase 2, Compat Mode (v2.5.0): the bisect stub was replaced with the real plugin import and everything now works end to end against a faithful mocked native bridge — the compat entry appears on gated videos, opens the m.youtube.com WebView with the full injection bundle (visibility spoof, user-intent background guard, ad stripper, cookie share), relays player state to the lock-screen service, routes notification controls into YouTube's player with pause attribution, and tears down cleanly; the Settings kill-switch hides it. Gate: guard-core units 25/25, compat e2e 8/8, embed journey 7/7, battery 2 pass / 5 skip-with-reason / 0 fail with PO-token coverage 32/32, parity 16/0, ads, background 35/0, playback 108/0 (two transient live-YouTube failures re-ran clean), premium 14/0, electron bundle test all-pass, and the v12 suite's pre-existing failures byte-identical to baseline. The missing phase-2 design document was written, including the honest post-mortem." },
  { p: "Phase 3, Downloads (v2.6.0): a server-side yt-dlp sidecar with a two-slot queue, session-bound endpoints (a per-browser token; 401 without it), progress parsing, cancellation with partial-file cleanup, and finished files streamed back as attachments. It downloads through the same cookie jar extraction uses. The e2e proves both layers: a real 3.3MB audio download completed on this worst-case datacenter IP (yt-dlp's client rotation succeeds exactly where the in-process chain falls back — the research's conclusion, now reproduced), byte-exact file serving, the duplicate-start 409, and remove; plus the mocked UI journey (watch-page sheet with Video/Audio choices, downloads page with live progress and a session-scoped Save link). 14/14." },
  { p: "Phase 4, native player (v2.7.0): a complete Media3 plugin — ExoPlayer inside a MediaSessionService with the media notification, audio focus, and task-removal handling — plus a store-facing engine adapter and surgical routing in the video surface (same source selection as the WebView path, native state driving both the playback store and the surface's local UI state, transport functions routing to the native engine when active). The app side is proven by a mocked-bridge e2e (4/4: prepare with the right source, position reaching the time display, transport routed, engine-swap release) and unit tests for source selection (6/6). The experimental toggle ships default-OFF." },
  { p: "Phase 5, UX parity (v2.8.0, partial and labeled as such): Return-YouTube-Dislike counts on the watch page (server route with one-hour cache; live-verified — the test video returns 521,615 dislikes), playback-speed memory (the chosen rate persists and applies from the first play), and an offline banner. The v2.8.0 commit shipped with a reduced gate — typecheck zero, build green, RYD live-verified, with the full suites last proven green an hour earlier at v2.7.0 — and PROGRESS.md names the full re-run as the next session's first action. Deferred with recorded reasons: AMOLED theme (touches the hydration-sensitive boot path), search filters (sp-parameter plumbing), playlist dead-UI audit, and player consolidation (the video player component is not dead code — Shorts imports it; the merge is the plan's riskiest item and does not belong in an untested buzzer edit)." },
  { t: {
      title: "Table 1. Program state at session end",
      headers: ["Phase", "Release", "State and evidence"],
      rows: [
        ["0 — Stabilize & Instrument", "v2.3.0", "Shipped, full gate green (previous session, claims re-verified this session)"],
        ["1 — Extraction Engine v2", "v2.4.0", "Shipped, full gate green; the 5-of-6 battery target is defined for the user's server, not this worst-case IP"],
        ["2 — Compat Mode", "v2.5.0", "Shipped, full gate green; native WebView needs one Android build (see limits)"],
        ["3 — Downloads v1", "v2.6.0", "Shipped, full gate green incl. a real 3.3MB download"],
        ["4 — Native player", "v2.7.0", "Shipped default-OFF; app side e2e 4/4 + unit 6/6; Java never compiled (see limits)"],
        ["5 — UX parity", "v2.8.0", "PARTIAL: RYD + speed memory + offline banner; AMOLED, filters, dead-UI, consolidation deferred with reasons"],
      ],
  } },

  { h1: "3. Honest Limits and the Exact Resume Point" },
  { p: "Two things were built but never compiled: this sandbox has no Android SDK, so the yt-compat WebView plugin (Phase 2) and the yt-player Media3 engine (Phase 4) exist as careful Java written against Capacitor 7 and Media3 1.5 APIs, verified only through faithful bridge mocks on the app side. Both need one Gradle build and a device smoke test before their user-facing toggles should be enabled; the compat plugin's entry is live as soon as the build includes it, while the native player stays behind its experimental toggle. Production servers additionally need yt-dlp and ffmpeg on the path for downloads. The next session's first actions, recorded in PROGRESS.md: re-run the full gate on v2.8.0 (its reduced gate is stated in the work log), then the Phase 5 remainder, then the Android build. The program's core promise — background play for every video — is now three-quarters real: Phase 1 makes most videos extract directly, Phase 3 saves them, and Phases 2 and 4 cover the rest pending that one build." },
];

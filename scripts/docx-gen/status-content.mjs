// status-content.mjs — execution status report, 2026-11-07 (data only, ASCII)
export const META = {
  title: "ytapp Execution Status",
  subtitle: "Program execution report - phases shipped, verified, and blocked, with the exact resume point",
  englishLabel: "EXECUTION STATUS - 2026-11-07",
  metaLines: [
    "Program: ytapp Master Build Plan (phases 0-5)",
    "Report date: November 7, 2026",
    "Last tagged release: v2.4.0",
    "Working tree: committed (WIP phase 2 on top of v2.4.0)",
  ],
  footerLeft: "ytapp",
  footerRight: "November 2026",
};

export const BLOCKS = [
  { h1: "1. What Shipped and Is Verified" },
  { p: "Two of the six program phases are complete, gate-verified, and tagged. Phase 0 (v2.3.0) made the codebase measurable: the 15 TypeScript baseline errors are zero and build-enforced (ignoreBuildErrors removed), the six-video extraction battery runs with honest SKIP-with-reason semantics, /api/health reports per-client extraction diagnostics with a one-tap secret-free Copy Diagnostics button in Settings, and the embed-fallback journey is locked by a deterministic mocked e2e. Its gate ran everything: tsc zero, static build, battery (1 pass / 5 skip / 0 fail on this worst-case IP), embed journey 7/7, parity 16/0, ads 8/0, background 35/0, playback 108/0, premium 14/0, and the mandated electron-bundle test - all green, with the two environment-caused parity failures and the v12 suite's 7 failures proven pre-existing by stashing the changes and re-running." },
  { p: "Phase 1 (v2.4.0) rebuilt the extraction engine: youtubei.js 18.3.0 in both server and pot-provider pins; an HTML-seeded WEB client that fetches the real watch page with a genuine Chrome UA, parses ytInitialPlayerResponse with a string/escape-state parser, and deciphers formats through the session player - no /player API call at all; the PO token is now provably on every player call (a counting fetch wrapper showed 52/52 in /api/health, and the battery fails if coverage ever drops below 100 percent); the client chain became configuration (CLIENT_CHAIN env, default IOS, SEEDED_WEB, ANDROID, WEB, MWEB); every failed extraction is classified (bot_gate, age_gate, members_only, drm, live_ended, unavailable - 8/8 unit cases) and surfaced as gate_reason; a hollow-extraction probe range-fetches one format URL before accepting any client so 403-only results are rejected; and cookies became a Settings action (POST/GET/DELETE /api/cookie, masked display, value never returned or logged - e2e 6/6 including a no-DOM-leak assertion). The battery on this sandbox now extracts 2 of 6 videos (the research baseline was 1). The plan is explicit that the 5-of-6 target is measured on your server: deploy v2.4.0, tap Copy Diagnostics before and after." },

  { h1: "2. Phase 2: Built but Not Gated" },
  { p: "All Phase 2 (Compat Mode) code is written, type-clean, and committed on top of v2.4.0 - but v2.5.0 is NOT tagged because the phase gate could not run. What exists: the yt-compat Capacitor plugin (a fullscreen native WebView over the app loading m.youtube.com, document-start injection, a ytCompatNative message bridge, and evaluateJavascript control); the guard-core pure logic (auto-resume attribution that never fights the user, ads, or a 3-attempt cap; one-button Continue-watching dialog detection; a cycle-safe ad-payload stripper; a Netscape cookie-file renderer) - 25/25 unit tests, including a syntax validation of the composed injection bundle; the compat route and CompatPage that relay player state to the lock-screen service, forward notification controls into YouTube's player with user-intent attribution, share session cookies with your server through the Phase 1 cookie endpoint, and carry honest notices plus an injected in-page exit pill; the WatchPage entry button (native-only, kill-switched from Settings); and two Settings toggles. iOS was descoped with a documented reason: it is not one of this app's three targets (dev web, Capacitor Android, Electron)." },
  { p: "The gate is blocked by an environmental failure, and the blocked run still produced two valuable findings. First, a real pre-existing bug: the mocked-native e2e exposed that VideoSurface's pipOnHome effect re-fires roughly 1200 times per second once native promises resolve, spamming the Android bridge until the renderer dies - on a real device this burns the bridge continuously. A push-only-on-change ref guard is committed as the mitigation; the re-render trigger itself (the dep is a stable boolean selector, so the obvious explanations are exhausted) is the top open question for the next session. Second, the sandbox can no longer complete a production build: Turbopack's PostCSS worker is OOM-killed at a measured 3.4GB peak on this 4GB box. The identical tree built green earlier the same day, tsc is clean, and worker-count limits did not help - the resume path is a fresh build environment, building via CI (GitHub runners have more headroom), or trimming the CSS path." },
  { t: {
      title: "Table 1. Phase status",
      headers: ["Phase", "State", "Evidence"],
      rows: [
        ["0 - Stabilize and Instrument", "SHIPPED v2.3.0", "Full gate green; tagged 584c4a0"],
        ["1 - Extraction Engine v2", "SHIPPED v2.4.0", "Full gate green (sandbox-defined parts); PO coverage 52/52; tagged eee6406; user-server measurement pending by design"],
        ["2 - Compat Mode", "CODE COMPLETE, GATE BLOCKED", "tsc 0; guard-core 25/25; e2e entry+route proven; build OOM blocks the full suite; committed 555aea2, no tag"],
        ["3 - Downloads", "NOT STARTED", "Architecture decided (server-side yt-dlp sidecar) in the plan and design docs"],
        ["4 - Native Android Player", "NOT STARTED", "Optional phase; build-it decision locked"],
        ["5 - UX Parity", "NOT STARTED", "Work items enumerated in the plan"],
      ],
  } },

  { h1: "3. Exact Resume Point" },
  { p: "The next session should start from three artifacts: PROGRESS.md at the repo root (live phase and work-item table with the open questions), WORKLOG.md sessions 24-26 (what each phase changed and why), and docs/designs/ (phase-0 and phase-1 design docs with their verification sections). The recommended order: first fix the build OOM (try a fresh sandbox build, then CI, then the CSS worker path) and re-run bun run build:static until green; second, root-cause the setPipOnHome re-render loop with a React Profiler pass under the fake bridge in scripts/e2e-compat.mjs (the bridge fake that reproduces it is preserved in that file); third, run the full Phase 2 gate (build, guard-core units, e2e-compat, e2e-embed-fallback, battery, the four behavioral suites, bundle test, v12 before/after) and tag v2.5.0; then proceed to Phase 3 (Downloads) exactly as the master plan section 8 prescribes. Decisions already locked for the remaining phases: D3 session-bound download endpoint, D4 build Phase 4, D5 no devices in the sandbox - device-only judges (compat WebView behavior on a real phone, the native plugin compile) are marked UNVERIFIED and need one Android build from you or CI." },
  { p: "Nothing was pushed to the remote; all work is committed locally (v2.3.0, v2.4.0, and the phase-2 WIP commit on top). The two released tags and the WIP commit are the deliverables of this run, alongside the previously delivered master plan and research report. The program's core promise - background play for every video - is now two-thirds built: Phase 1 makes most videos extract directly, Phase 2's code makes the rest playable through the compat surface, and the remaining work is verification and the three feature phases." },
];

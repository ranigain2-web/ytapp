// plan-content1.mjs — ytapp master build plan, sections 1-6 (data only, ASCII text)
export const META = {
  title: "ytapp Master Build Plan",
  subtitle: "Phased execution from deep research to the premium experience, run through the EGM design cycle and gauntlet loops",
  englishLabel: "MASTER PLAN - PHASED EXECUTION",
  metaLines: [
    "Prepared for: ytapp project owner",
    "Prepared by: ytapp development agent",
    "Date: November 7, 2026",
    "Basis: ytapp Deep Research Report (Nov 6, 2026) + live codebase verification",
    "Status: Phase 0 ready to start upon approval",
  ],
  footerLeft: "ytapp",
  footerRight: "November 2026",
};

export const BLOCKS1 = [
  { h1: "1. Purpose and How to Use This Plan" },
  { p: "This document converts the November 6 deep-research report into the complete build program for ytapp: what gets built, in what order, under which quality gates, and by which method. It is written to be executed, not admired - every phase lists entry criteria, work items with identifiers, a concrete quality bar for each item, an acceptance gate, and the risks that could sink it. Nothing in this plan has been built yet. Execution starts when you approve a phase, and each phase ends at a tagged release, so you can stop or re-order the program at any phase boundary without orphaning work." },
  { p: "The plan is built on two methods you named. The Elephant and Goldfish Model (EGM) governs how each phase is designed and reviewed: a design document is drafted from the research, then reviewed by fresh-context reviewers (Goldfish) through a five-stage protocol, then resolved, before any code is written. The gauntlet loop governs how each work item is built: a named, fetchable quality bar is set up front; the work is split into the smallest pieces that can be judged on their own; and for each piece a builder implements while a separate, harsh critic - an agent with fresh context that never saw the builder's effort - compares the result blind against the bar and names the single biggest remaining gap. The loop repeats until the critic picks our version blind. No round counts, no self-grading, no soft exits." },
  { p: "Two things this plan deliberately does not do. It does not restate the research - each phase cites the findings it depends on, and the research report (download/ytapp-deep-research-report.docx) remains the evidence base. And it does not schedule calendar dates: phases are sequenced by dependency and effort class (S = one focused session, M = two to three, L = four to six), because extraction work against a live adversary does not respect calendars. What is fixed is the order of the gates: design before review, review before code, bar before build, critic before merge." },

  { h1: "2. Current State of the Project (verified November 6-7, 2026)" },
  { p: "The plan starts from the codebase as it is, not as the documents describe it. The repository was re-verified live before this plan was written: the working tree is clean (the research artifacts and this plan's toolchain were committed in f3e5687), the shipped version is v2.2.0 (commit b387d84, plus CI fixture fix f0331ee), and the WORKLOG records 22 sessions from the project's start through the research phase. The table below is the verified inventory; every number in it was measured, not remembered." },
  { t: {
      title: "Table 1. Verified current state",
      headers: ["Area", "Verified state"],
      rows: [
        ["Product", "Personal ad-free YouTube client: React frontend (web + Capacitor Android + Electron desktop), single-file Express backend (server/index.mjs, 1,213 lines) using youtubei.js 18.0.0, vendored bgutil PO-token server"],
        ["Frontend size", "92 TypeScript/TSX files, 16,927 lines; Electron shell 299 lines"],
        ["Shipped version", "v2.2.0 - background play for direct streams + audio rescue + one-shot embed handoff; v2.1.0 fixed the embed-fallback root cause; v2.0.0 was the appearance pass"],
        ["Test suites", "9 suites; mandated electron-bundle test passes 14/14 checks; e2e-playback (1,409 lines), e2e-background (499), e2e-parity (246), e2e-ads (166), e2e-premium (169), e2e-v12 (187)"],
        ["Known defects", "15 baseline TypeScript errors in the API mapping layer (re-verified November 7); tests exercise a single video (dQw4w9WgXcQ); e2e-background runs on committed fixtures, not real extraction"],
        ["Feature gaps", "No downloads, no dislike counts (RYD absent), no live chat, dead search-filters UI, playlist cards route to Watch Later, no offline detection, no speed memory, no AMOLED theme, no caption styling"],
        ["Core problem", "Background play fails exactly where server extraction fails: from gated IPs most videos fall to the embed iframe, which cannot background. Measured from a worst-case IP: our chain extracts 1/6 battery videos; all seven yt-dlp clients bot-gated; the embed player itself loads fine"],
        ["Research assets", "Deep-research report (19 pages) in download/; raw evidence in research/results/; nine shallow clones of reference projects in research/repos/ (NouTube, FreeTube, Materialious, Flow, NewPipe, LibreTube, Seal, Metrolist, cobalt); yt-dlp 2026.10.26 + bgutil plugin installed and verified"],
      ],
  } },
  { p: "The honest summary: the app's machinery is sound and tested on the happy path, but the happy path is narrow - one lucky video in the test battery - and the real-world path your network puts you on (embed fallback) is exactly the one with no background play and no test coverage. That inversion, verified hands-on, is what Phases 0 through 2 exist to fix, and it is why Phase 0 starts by widening the measurement before touching the engine." },

  { h1: "3. The Operating System: EGM and Gauntlet Loops" },
  { p: "Every phase of this program runs the same five-step cycle. Step 1 - Design (Elephant). A design document is drafted per phase using the EGM drafting flow, seeded by the research report's findings for that phase. It contains, in order: the Problem, Overview, Goals and Non-Goals; the Technical Plan; Alternatives Considered with explicit rejection reasons; and a Detailed Implementation section that enumerates every file to be created, changed, or deleted, each with a rationale. The draft lands in design_draft.md and is finalized to docs/designs/<phase>.md, registered in docs/designs/SITEMAP.md. Where a design decision has more than one defensible answer, the draft presents up to three options with mechanisms, trade-offs, and failure conditions - and you choose. The agent does not pre-pick defaults for contested architecture." },
  { p: "Step 2 - Review (Goldfish). The design document goes through the EGM review protocol in consolidated mode: five stages run in sequence - Initial Zoom Out (does the document hang together at altitude), Comprehension Test (can a fresh reader restate it correctly), Critic Review (design, structural, and style reviewers attack the feature spec), Intermediate Zoom Out (re-check after remediation), and the Implementation Readiness Test (the detailed plan is audited against the actual codebase). Every finding is classified as a Blocker, Major, or Nit, consolidated into a report with a traceability matrix, and resolved before code: PROPOSE FIX items are applied, contested items are documented as accepted trade-offs with reasons. One re-audit per stage, maximum - the protocol converges instead of looping forever." },
  { p: "Step 3 - Build (Gauntlet). Each work item in the phase runs its own gauntlet loop. The bar is named and fetchable - a real artifact the critic can open: the cloned reference implementation in research/repos/, the installed yt-dlp binary, the repo's own mandated test suite, the live YouTube or RYD endpoints. A builder implements the piece; a separate critic agent with fresh context inspects the actual output, puts it next to the bar blind with labels stripped, states which one is better and names the single biggest remaining gap; the builder iterates. The critic is instructed to be harsh - praise is not useful, and if ours does not win, it keeps going. The exit is winning the blind comparison or the user stopping the run, never a round count. Step 4 - Gate. The phase's acceptance gate runs: the mandated electron-bundle test, the phase's own acceptance tests, a static export build, and the three-target contract check. Work is tagged as a release, the WORKLOG gets its session entry, and PROGRESS.md - the live progress page at the repo root - is updated so you can watch the program move without reading diffs. Step 5 - Drift. After each phase, an EGM drift report compares the design documents against the code that shipped; divergence is either fixed or the document is amended, so the docs never rot." },
  { p: "Some rules apply to every loop, every phase, no exceptions - they are the program's global bars, and they come from the repository's own operating rules plus the research's licensing findings. Both the builder and the critic check against them." },
  { t: {
      title: "Table 2. Global bars (always on, every phase)",
      headers: ["Rule", "How it is enforced"],
      rows: [
        ["Three-target contract", "The same static bundle must work on dev, Capacitor Android, and Electron; base-URL resolution stays only in src/lib/yt-api.ts; no server-only Next features"],
        ["Backend stays single-file and dependency-light", "server/index.mjs takes no heavyweight or native deps; the yt-dlp sidecar (Phase 3) is a spawned subprocess, not a dependency"],
        ["Test before push", "bash scripts/test-electron-bundle.sh must pass for any backend/desktop change; bun run build:static for frontend changes; CI stays green"],
        ["Honesty is a feature", "Embed fallback keeps its 'may contain ads' notice; Compat Mode ships its own honest notice; disclaimers are not quietly removed"],
        ["License hygiene", "Code may be copied only from yt-dlp (Unlicense) and YouTube.js (MIT); every GPL/AGPL reference (NouTube, FreeTube, Flow, NewPipe, Seal) is technique-only - re-implemented, never pasted; the vendored pot-provider NOTICE stays accurate"],
        ["No secrets in the repo", "Cookies and tokens only via env or Settings-entered values; diagnostics output must be secret-free by construction"],
        ["WORKLOG + PROGRESS", "Every session appends to WORKLOG.md; every loop updates PROGRESS.md"],
      ],
  } },
  { p: "To make the gauntlet pattern concrete, here is the actual filled loop for the first work item of Phase 0 (S-01), ready to paste into a fresh agent session. Every other work item in this plan gets an equivalent prompt derived from its bar." },
  { q: "Drive the 15 baseline TypeScript errors in ytapp's API mapping layer to zero without changing runtime behavior. The bar is the repo's own mandated suite: run bash scripts/test-electron-bundle.sh (14 checks) and the e2e suites before and after; a fix that silences tsc but changes behavior loses. Break this into the smallest pieces that can be judged on their own - one error cluster per piece, each with its own before-and-after tsc count and test run. For each piece, fan out a builder and a separate critic with fresh context. The critic re-runs tsc and the suites on the actual diff, puts the before and after side by side blind, says which one is better, and names the single biggest remaining gap. Then it goes back to the builder. The critic should be a harsh critic. Praise is not useful. If ours does not win, it keeps going. Keep looping until the critic picks ours. Run the builders and critics as parallel subagents." },

  { h1: "4. Program Map: Phases, Dependencies, Releases" },
  { p: "Six phases, sequenced by dependency. Phase 0 (Stabilize and Instrument) comes first because every later phase needs its measurement: the extraction battery is the instrument that proves Phase 1 worked, and the tsc-zero baseline protects the mapping layer Phase 1 rewrites. Phase 1 (Extraction Engine v2) raises the direct-stream success rate. Phase 2 (Compat Mode) makes every remaining embed-only video playable in background on the user's device. Phase 3 (Downloads) ships the most-requested missing feature on a license-safe architecture. Phase 4 (Native Android Player) is optional and independently deferrable - it deepens robustness for extractable videos but rescues nothing that Phases 1-2 have not already covered. Phase 5 (UX Parity) closes the verified gaps and can interleave with Phases 2-4 once Phase 0 has landed, though it is written last so the program has a defined polish finish line." },
  { t: {
      title: "Table 3. Phase map",
      headers: ["Phase", "Goal", "Exit gate (acceptance)", "Effort", "Release"],
      rows: [
        ["0 - Stabilize and Instrument", "tsc to zero; multi-video battery; diagnostics panel; failure-journey tests", "tsc --noEmit exits 0; battery suite green in CI; Copy Diagnostics produces a secret-free report", "S-M", "v2.3.0"],
        ["1 - Extraction Engine v2", "HTML-seeded WEB session, PO tokens on every player call, client-chain rework, cookies", "Battery extracts at least 5 of 6 videos on a mildly-gated IP; embed_fallback rate visibly drops in diagnostics", "M", "v2.4.0"],
        ["2 - Compat Mode", "Full-screen m.youtube.com WebView with injected background-guard for embed-only videos", "A server-gated video keeps playing with the screen off on Android; lock-screen controls work; 'Continue watching?' auto-dismissed; kill-switch ships", "L", "v2.5.0"],
        ["3 - Downloads v1", "Server-side yt-dlp sidecar with ffmpeg mux; download UI on all three targets", "A muxed MP4 downloads end-to-end on web, Android, and desktop; temp files expire under the size cap", "M-L", "v2.6.0"],
        ["4 - Native Android Player (optional)", "Media3 MediaSessionService plugin playing direct streams natively", "Extractable video plays through the native player with notification controls and survives screen-off; web/desktop untouched", "L", "v2.7.0"],
        ["5 - UX Parity and Cleanup", "RYD dislikes, search filters, playlists page, dead-UI fixes, speed memory, offline detection", "Each item lands with its e2e check; tsc stays at zero; both player implementations consolidated behind suites", "M", "v2.8.0"],
      ],
  } },
  { p: "Dependencies, explicitly: Phase 1 requires Phase 0 (the battery and the clean mapping layer). Phase 2 requires Phase 1's playability routing - the Compat Mode entry point is triggered by the bot-gate classification, not by a generic timeout - and its diagnostics validate the whole design. Phase 3 requires Phase 1 for format listing; its gated-video item (D-05) additionally requires Phase 2's cookie export. Phase 4 depends only on Phase 1 (it plays the same direct streams). Phase 5 items depend only on Phase 0. The critical path is 0 -> 1 -> 2 -> 3; everything else can be scheduled around it, and Phase 4 can be cut entirely without weakening the program's core promise." },

  { h1: "5. Phase 0 - Stabilize and Instrument (v2.3.0)" },
  { p: "Goal: make the codebase measurable and the failure path visible, before any engine work. Why first: the research proved that today's green CI says almost nothing about real-world extraction - every suite tests the single video that happens to extract even from a worst-case IP, and the background suite runs on committed fixtures. Phase 0 does not change what the app does; it changes what the team can see. The design doc for this phase is deliberately thin (the work is mechanical), so the EGM cycle runs light: one design draft, one consolidated review pass, no open architecture decisions. Entry criteria: this plan approved; working tree clean; mandated suite green at the starting commit." },
  { t: {
      title: "Table 4. Phase 0 work items",
      headers: ["ID", "Piece", "Gauntlet bar", "Judge"],
      rows: [
        ["S-01", "Drive the 15 tsc baseline errors in the mapping layer to zero, no behavior change", "Mandated suite (14 checks) + all e2e suites, run before and after", "tsc exits 0; suites bit-identical in outcome"],
        ["S-02", "Six-video extraction battery e2e; gated results recorded as SKIP with reason, never FAIL", "The research battery scripts (research/results evidence) as ground truth", "CI green on a gated runner; extractable video asserts full path"],
        ["S-03", "Diagnostics: per-client last-error, embed_fallback rate counters, Copy Diagnostics button in Settings", "FreeTube's IP-block error surface (research/repos/FreeTube)", "Copied JSON lists per-client outcomes and rates; secret-free by construction"],
        ["S-04", "Embed-fallback journey e2e against a mocked gated API: notice, iframe, rescue attempt, handoff", "The app's own v2.1.0/v2.2.0 behavior spec (WORKLOG sessions 20-21)", "e2e asserts the full journey; no silent failure paths remain"],
        ["S-05", "Wire program conventions: docs/designs/ + SITEMAP.md, PROGRESS.md live page", "EGM artifact conventions (egm-draft, egm-review skills)", "Files exist and are referenced from the phase's design doc"],
      ],
  } },
  { p: "Acceptance gate: tsc --noEmit exits 0 in CI; the battery suite runs on every push; Copy Diagnostics output is verified secret-free by a critic reading the actual JSON; the embed journey test is red when any notice or handoff step regresses. Risks: the tsc fixes could tempt behavior changes (the bar forbids it - the judge compares suite outcomes, not diff size), and the battery could flake on YouTube's live gating (mitigated by SKIP-with-reason semantics, which turn gating variance into data rather than noise). Version v2.3.0 tags this phase. Effort: S-M." },

  { h1: "6. Phase 1 - Extraction Engine v2 (v2.4.0)" },
  { p: "Goal: make direct streams the norm again on real servers, so fewer videos ever reach the embed fallback. The research identified the exact recipe the active ecosystem converges on, and this phase implements it end to end: a WEB session seeded from the real watch page (FreeTube's pattern), PO tokens generated by our already-running bgutil server attached to every player request in serviceIntegrityDimensions, the client chain reordered per the yt-dlp PO Token Guide with format-URL fetch verification before accepting a client's results, playability-reason routing so bot-gate, age-gate, members-only, and DRM failures produce different messages and different actions, and user-supplied cookies surfaced in Settings for gated deployments. Entry criteria: Phase 0 gate green. The design doc has one genuinely open decision for you (see Section 13): whether the cookie feature stores cookies server-side only (simple, but single-server) or syncs per-device (complex, multi-server) - options with trade-offs will be presented in the design draft." },
  { t: {
      title: "Table 5. Phase 1 work items",
      headers: ["ID", "Piece", "Gauntlet bar", "Judge"],
      rows: [
        ["E-01", "youtubei.js 18.0.0 to 18.3.0 (server + pot-provider pins; handle target_duration_dec rename)", "YouTube.js 18.3.0 changelog (fetched) + mandated suite", "Suite green; battery at or above baseline"],
        ["E-02", "HTML-seeded WEB session: fetch watch page, reuse embedded playerResponse and context, genuine UA", "FreeTube local.js behavior (research/repos/FreeTube)", "Seeded WEB extracts a video that raw WEB fails on, on a mildly-gated IP"],
        ["E-03", "PO token in serviceIntegrityDimensions on every player call; token cache and renewal", "FreeTube poTokenGenerator + our live pot-provider", "mweb format URLs fetch without 403 when token present"],
        ["E-04", "Client chain rework + playability-reason routing (bot-gate / age / members / DRM as distinct outcomes)", "yt-dlp PO Token Guide client table + yt-dlp 2026.10.26 behavior", "Each failure class produces its own code, message, and action"],
        ["E-05", "YOUTUBE_COOKIE Settings surface: paste flow, masked display, security warning, server persistence", "yt-dlp --cookies UX conventions", "Cookies persist, never enter the repo or logs, gate visibly opens"],
        ["E-06", "ANDROID_VR acceptance only after format-URL range-fetch verification (the 403 lesson)", "Our own sandbox finding (research/results/ytdlp-battery.json)", "Battery records fetchability per client; hollow extractions discarded"],
      ],
  } },
  { p: "Acceptance gate: on a mildly-gated IP the battery extracts at least 5 of 6 videos; the Phase 0 diagnostics show the embed_fallback rate dropping after deploy; every e2e suite stays green; the three-target contract holds (the chain change lives only in server/index.mjs). Risks, led honestly: extraction is an arms race and today's client order can rot - mitigated by making the chain data-driven (client order and per-client acceptance are configuration, not code) and by the drift report catching doc-vs-code divergence; the headline 5-of-6 gate cannot be measured from this hard-gated sandbox, so the gate runs against your deployment with Copy Diagnostics producing the evidence - that is a deliberate design choice, not an oversight; and the youtubei.js bump carries one breaking rename, covered by E-01's judge. Effort: M. Version v2.4.0." },
];

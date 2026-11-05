# Goldfish Review Record — premium-parity-v2 plan

* Reviewed: `docs/designs/2026-11-05-premium-parity-v2.md` (first draft)
* Date: 2026-11-05
* Reviewers: five zero-context subagents (fresh session, doc + repo only):
  zoom-out lens, comprehension lens, implementation-readiness lens,
  design-critic lens (run twice — the first run's output was corrupted in
  transit; the re-run covered the four technical-risk questions the other
  lenses hadn't)
* Totals: 8 🔴 blockers, 24 🟡 majors, 11 🟢 nits = 43 findings
* Resolution: every finding resolved by the elephant in the doc revision of
  2026-11-05. Table below: finding (lens) → resolution → doc change.

| # | Sev | Finding (lens) | Resolution | Doc change |
|---|-----|----------------|------------|------------|
| 1 | 🔴 | Phase-3 exit "0 dead-interactive on all routes" unsatisfiable — bell/playlist/Shorts deferred to phase 4 (zoom-out, comprehension) | Exit re-scoped: explicit phase-4-deferred allowlist with `// PHASE4-DEFERRED` code comments; full-zero gate moved to phase 4's exit | §6 Phase 3 Exit, Phase 4 Exit |
| 2 | 🔴 | Phase-1 ships a dead Prev notification button (routing arrives phase 2) — violates wire-or-remove (zoom-out) | Prev removed from phase 1 entirely; arrives in phase 2 as one coherent unit (callback + event + store routing + notification action + tests) | §6 Phase 1 service bullet; Phase 2 |
| 3 | 🔴 | Phase-5 exit "embed-fallback rate drops measurably" unfalsifiable — no test set, no threshold (comprehension) | Fixed test-set manifest `scripts/fixtures/adfree-testset.json` (~30 IDs across 6 classes); numeric gate: ≤ baseline − 10pp, baseline recorded in evidence summary | §6 Phase 5 Exit |
| 4 | 🔴 | ci.yml e2e invocation runs zero tests and exits green — with-server.sh takes ONE command, unquoted args drop the script path (impl-readiness) | Single quoted command `bash scripts/with-server.sh 'node scripts/e2e-playback.mjs'` + result guard (fail unless `RESULT: N passed`, N>0) | §4.7, §6 Phase 0 |
| 5 | 🔴 | gauntlet_critic.mjs is gitignored (sandbox-only) — CI/fresh clones have no judge (impl-readiness) | Phase-0 task: un-ignore + commit it (z-ai-web-dev-sdk already a dep); vlm.mjs stays sandbox-only; verdict vocabulary extended with TIE | §6 Phase 0 |
| 6 | 🔴 | Phase-2 file list omits VideoPlayer.tsx + yt-store.ts; embed-mode miniplayer undefined (impl-readiness) | Both files added to inventory; embed-fallback videos get NO miniplayer (documented); tests scoped to direct mode | §6 Phase 2 |
| 7 | 🔴 | Audio-focus self-war: WebView requests focus independently; service GAIN pauses it; duck has no transport (design-critic) | Ownership model: service requests focus before first audible start (enable moves to user-gesture); duck/gain routed as control events setting el.volume; device checklist is the real proof; documented degrade fallback | §4.2, §6 Phase 1, §7.2 |
| 8 | 🔴 | Subs fan-out: no concurrency cap, no cache (re-fires per mount + feeds bell → bot-gating risk), no failure isolation, day-granularity ordering (design-critic) | Shared single-flight cached fetch (TTL 20min, SWR) feeding feed + badge; cap 4–6; allSettled + per-channel error chip; progressive render; granularity documented | §6 Phase 4, §4 added §7.7 |
| 9 | 🔴 | Plan contradicts itself: "Watch AND Shorts feed the VideoSurface" vs Shorts needing per-card players; two-audio-sources + metadata flapping edge cases (design-critic, zoom-out) | Shorts stays per-card OUTSIDE the store; single-active-audio-owner rule (Shorts mount pauses + mini-closes watch; MediaSession ownership follows); MiniPlayer trigger excludes Shorts | §4.1, §6 Phase 2 |
| 10 | 🟡 | Store ordering vs brief (phase 2 after phase-1 rewires player) (zoom-out) | Accepted explicitly with rationale + named-liftable-blocks mitigation | §2 sequencing note |
| 11 | 🟡 | `t`-key/cinemaMode dangling — no consumer, no Settings row (zoom-out, impl) | `t` dropped from phase 1; cinemaMode dead pref removed in phase 3 | §6 Phase 1, Phase 3 |
| 12 | 🟡 | keepScreenOn is not a real Capacitor config (zoom-out, impl) | Replaced: plugin `keepAwake(enable)` method + yt-native wrapper | §4.2, §6 Phase 1 |
| 13 | 🟡 | Audio-focus off-device 8-check overclaim (Java never runs in CI) | Renamed honestly: "JS reaction to service events"; Java path gated on device checklist go/no-go | §6 Phase 1 tests |
| 14 | 🟡 | Dead-interactive probe unspecced (React 19 delegated listeners) | Probe specified: addInitScript patches addEventListener, WeakSet `window.__listened`, heuristic + allowlist | §6 Phase 0 audit bullet |
| 15 | 🟡 | macOS zero coverage | Standing phase-exit line (bundle test 13/13) + macOS section in device checklist; dedicated macOS CI runner an explicit non-goal | §2, §3, phase exits |
| 16 | 🟡 | Ambient-mode instruction targets a nonexistent control | Deleted | §6 Phase 1 |
| 17 | 🟡 | ci.yml unbuildable: no server npm install, no playwright install, no --quick flag | All three steps/tasks added | §4.7, §6 Phase 0 |
| 18 | 🟡 | PiP mechanism "decided by implementation" — neither named option works | Decided now: plugin methods + CI sed-patch of MainActivity manifest after cap sync + aapt assertion | §6 Phase 2 |
| 19 | 🟡 | Toast wiring lists features not files; no test hook | Mutation sites enumerated per file; `data-testid="yt-toast"` specified | §4.5, §6 Phase 3 |
| 20 | 🟡 | `shorts/{id}` path route in a query-param router | Query-param route `?page=shorts&id=`; path routes out of scope | §6 Phase 4 router |
| 21 | 🟡 | Phase-1 cites nonexistent surfaces: storyboards (plural), yt-lands (as existing), ?src= debug JSON | Corrected: `video.storyboard`; yt-lands marked NEW; `window.__ytDebug` via `?debug=1` | §6 Phase 1 |
| 22 | 🟡 | docs/evidence gitignore missing while summaries are an exit deliverable | Task added: ignore `/docs/evidence/raw/`, commit summaries | §6 Phase 0 |
| 23 | 🟡 | Phase-0 fidelity "8 surfaces" vs Phase-4 "adds subscriptions/channel" duplication | Phase 4 re-baselines rewrites + adds playlist (9 total) | §6 Phase 4 fidelity |
| 24 | 🟡 | 4 reference profiles never enumerated; tolerances vague | Enumerated (390×844/834×1194/1024×768 m., 1440×900 www.); tolerances made concrete | §6 Phase 0 |
| 25 | 🟡 | TIE verdict not in critic vocabulary | Critic prompt extended; TIE requires written reason | §6 Phase 0 |
| 26 | 🟡 | Toolbelt terms undefined for cold readers | Terms block added at top | Terms |
| 27 | 🟡 | Phase-4 exit lacks gates; §7.4 partial-ship vs G3 tension | Exit gates explicit; droppable vs required surfaces named | §6 Phase 4 Exit, §7.5 |
| 28 | 🟡 | Device checklist timing — load-bearing check ungated | Phase-1 exit requires owner items 1–4 before phase 2 (go/no-go) | §6 Phase 1 Exit, §7.1 |
| 29 | 🟡 | Deciphering gotchas: bridge cost, web/CI blind, gzip, single-flight | Prefetch at start, single-flight per version, CI-on-fixture documented, gzip device-verified | §4.3, §6 Phase 5 |
| 30 | 🟡 | Release-gate mechanism unspecified (needs can't cross workflows; tags don't trigger ci) | gh api head_sha query with actions:read; tags-point-at-main assumption stated | §4.7 |
| 31 | 🟡 | Comprehension: paraphrase mostly passed; ambiguity concentrated in exit gates | The exit-gate rewrites above (findings 1,3,27) resolve the layer | (see above) |
| 32–42 | 🟢 | Nits: numbers drift (routes/colors/CSS classes), SITEMAP claim, serial-execution statement, prior-history glosses, vacuous unmount check, haptics install task, seven-not-six phases | All folded: counts reconciled (13 routes, ~30 colors, 10 classes), SITEMAP created, serial statement + glosses + Terms added, unmount check hardened, haptics install task added, "seven phases (0–6)" | Throughout |
| 43 | 🟢 | Design-critic first run corrupted in transit | Re-run focused on the 4 remaining risk questions (findings 7,8,9 + deciphering 29) | — |

**Standing recommendation kept:** re-run a single fresh-goldfish pass on
§6 Phase 2 at the start of phase 2 (the phase with the most design debt).

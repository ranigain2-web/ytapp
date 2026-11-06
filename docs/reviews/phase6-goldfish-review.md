# Phase 6 Goldfish Review — Appearance final + the last gauntlet

- **Reviewer:** fresh-context Goldfish (EGM discipline), 2026-11-06
- **Subject:** §6 "Phase 6 — Appearance final + the last gauntlet" of
  `docs/designs/2026-11-05-premium-parity-v2.md` (lines 695–722), reviewed
  against the CURRENT code (post phase 5, package.json version 1.7.0), not
  against the 2026-11-05 audit snapshot the plan quotes.
- **Method:** read the plan, `globals.css`, `scripts/audit-ui.mjs`,
  `scripts/gauntlet-loop.mjs`, `scripts/gauntlet_critic.mjs`,
  `scripts/fidelity-bar.mjs` (surfaces), `.github/workflows/ci.yml`,
  `scripts/with-server.sh`, `docs/evidence/{phase0-summary,gauntlet-summary,
  adfree-summary}.md`, WORKLOG sessions 17–18; grepped every component for
  hex/rgb colors and for usages of each of the 10 "dead" CSS classes; read
  AppShell/HomePage/ChipsBar/Header/SettingsPage/Comments/ChannelPage/
  VideoCard/SearchOverlay/SearchPage/PlaylistPage/layout.tsx at the cited
  lines. Every file:line below was verified in the working tree today.

---

## 1. What is wrong, missing, or risky

### R1 🔴 The dead-CSS list is stale — deleting `.yt-pop` would break 5 shipped surfaces

The plan (design doc:704–707) says: delete `.yt-btn, .yt-nav-fill,
.yt-skeleton-v2, .yt-media, .yt-pop, .yt-nav-item`. That list is the
2026-11-05 audit snapshot; phases 3–4 wired `.yt-pop` in the meantime.
Current usages, all verified:

- `src/components/yt/VideoCard.tsx:87` — the phase-3 3-dot card menu (`… yt-pop`)
- `src/components/yt/AccountMenu.tsx:21` and `:83` — the phase-4 account modal + dropdown
- `src/components/yt/Notifications.tsx:79` — the phase-4 notifications drawer
- `src/lib/yt-toast.tsx:47` — the phase-3 `ToastHost` (every mutation confirmation)

Deleting `.yt-pop` (globals.css:460–464) silently removes the entrance
animation from the toast, the card menu, the account menu and the bell
drawer — exactly the "premium polish" surfaces phases 3–4 shipped. It won't
fail a test (no test asserts these animations), so it would ship broken.

The list is incomplete in the other direction too: `.yt-card:hover
.yt-thumb-img` (globals.css:245) is dead — `yt-thumb-img` appears nowhere in
`src/` except that rule — and is not in the plan's 10. So "dead CSS = 0"
(see R2) is unachievable with the listed ten alone.

### R2 🔴 The keep/delete split for the motion layer is internally contradictory

The plan keeps+wire `.yt-card-lift` but deletes `.yt-media`. In the current
CSS, `.yt-card-lift` has no effect of its own — both of its rules target
`.yt-media` descendants:

- `globals.css:440` — `.yt-card-lift .yt-media { transform: scale(1); }`
- `globals.css:442` — `.yt-card-lift:hover .yt-media { transform: scale(1.045); filter: saturate(1.06); }`

Delete `.yt-media` and the "kept" `.yt-card-lift` styles nothing. Keeping the
hover-zoom behavior requires rewriting the selector to target the thumbnail
directly (e.g. `.yt-card-lift:hover img`), which is a redesign of the rule,
not a wiring task. The plan reads as if keep/delete is a checkbox list; for
this pair it is not.

### R3 🔴 "Hardcoded-color count = 0" does not measure what the plan claims

What `scripts/audit-ui.mjs` actually counts (verified in code):

- **Exactly 7 RGB values** — `HARDCODED_RGB` at audit-ui.mjs:363–371:
  `#2f2f2f, #222/#222222, #555, #717171, #888, #aaa, #ccc`. Any other hex is
  invisible to the gate.
- **Exactly 3 properties** — `color`, `backgroundColor`, `borderTopColor`
  (audit-ui.mjs:376). Not checked: hover/active/placeholder states,
  border-left/right/bottom, `outline-color`, `fill`/`stroke`, `box-shadow`,
  and anything inside `background-image` (gradients).
- **Only currently-visible elements** on the **8 pages** in `PAGES`
  (audit-ui.mjs:53–62: home, watch, search, shorts, settings, channel,
  subscriptions, history). The liked/later/playlists/playlist routes are
  never audited — including `PlaylistPage.tsx:66`, which the sweep list
  itself names a `#717171` spot on.
- **Capped at 24 elements** (audit-ui.mjs:383) — the phase-0 baseline
  "≈24 per profile (probe cap)" (docs/evidence/phase0-summary.md:28) was
  saturated, so mid-burn-down progress is hidden, though 0 is still 0.

Concrete theme-breakers the gate will never see, all verified today:

- `src/components/yt/Header.tsx:208` — `hover:bg-[#2f2f2f]` on suggestion
  rows (hover state; and `#2f2f2f` as a *hover* bg is wrong in light theme).
- `src/components/yt/Header.tsx:223` — search button `hover:bg-[#1f1f1f]`
  (the `bg-[#222222]` half of this line IS in the 7-list and IS gated).
- `src/components/yt/WatchPage.tsx:298` — `hover:bg-[#3f3f3f]` on a
  themed (`var(--yt-bg-elev2)`) button — breaks light theme on hover.
- `src/components/yt/Comments.tsx:181` — replies toggle
  `hover:text-[#6bc1ff]` — light theme wants a darker hover blue.
- `src/components/yt/AccountMenu.tsx:41` — `text-[#0f0f0f]` on
  `bg-[var(--yt-blue)]`; in light theme `--yt-blue` is `#065fd4` and text
  must be white. The `--yt-blue-contrast` token (globals.css:177, :202)
  exists for exactly this and is not used.
- `src/lib/yt-toast.tsx:47` — `bg-[#f1f1f1] text-[#0f0f0f]` toast: that is
  YouTube's DARK-theme snackbar; light theme uses a dark pill.
- `src/app/globals.css:304` — `:focus-visible { outline: 2px solid #3ea6ff }`
  is an app-wide hardcoded blue; should be `var(--yt-blue)` (#065fd4 in
  light). Outline color is not a probed property.
- `src/components/yt/ChannelPage.tsx:132` — the banner-fallback gradient
  `from-[#1a1a2e] via-[#16213e]` is only named in the manual list, never
  measurable by the gate (gradient, error/fallback state).
- Both remaining `#888`s are `placeholder:text-[#888]`
  (Header.tsx:188, SearchOverlay.tsx:166) — placeholder pseudo-class color
  never appears in `cs.color`, so the gate is blind to them even unfixed.

**Consequence:** the plan's exit gate ("audit-v2's hardcoded-color class =
0", design doc:702–703) can go green with real hardcoded colors still
shipping. Either the probe is extended (more colors, `:hover` computed
states via Playwright `hover()`, outline/fill, more routes) or the plan must
state plainly that the enumerated manual list is the real bar and the audit
count is only the CI-enforceable subset. As written, the gate is weaker than
the goal it claims to enforce.

Related: ci.yml:59–63 says explicitly that hardcoded-color counts are
"reported, not yet gated — they gate when the phases that fix them land."
Phase 6 must add that gate itself (e.g. fail on `hardc=[1-9]` in the audit
log, audit-ui.mjs:592) — the plan's test list assumes a gate that does not
exist yet. Note also the CI `--quick` set (home+watch × phone+laptop) is
nearly vacuous for this defect class: most surviving sweep-list colors live
in overlay/error/other-route states (see list above).

### R4 🔴 The "~30 spots" sweep list is stale — re-derive it before touching code

The list (design doc:700–702, from the 2026-11-05 audit) predates phases
1–5, which rewrote every file it names. Verified drift:

| Plan says | Current reality (verified) |
|---|---|
| Settings 23 (`#555`) | Already fixed in phase 1 — `SettingsPage.tsx:23` Toggle now uses `var(--yt-switch)` |
| Header 212/227 | Now Header.tsx:208 (`#2f2f2f` hover) and :223 (`#222222`/`#1f1f1f`) |
| `#717171` ×15 | ×10: SearchOverlay:186,218; SearchPage:119,121; Sidebar:113; PlaylistPage:66; ChannelPage:104; HomePage:186,212,214 |
| `#888` ×3 | ×2, both placeholders (Header:188, SearchOverlay:166) |
| Comments 137 | Now Comments.tsx:181 (`#6bc1ff` hover) + :9 (avatar palette) |
| ChannelPage 70 gradient | Now ChannelPage.tsx:132 |
| VideoCard 167 | Now VideoCard.tsx:265 (`#717171`), :273 (`#ff0000` LIVE), :288 (`#3ea6ff` fill) |
| status colors ×6 | ~8: SettingsPage:93,94,137,142; HomePage:67,174; WatchPage:190,327 |

And files the list does not mention at all: `AccountMenu.tsx:41`,
`yt-toast.tsx:47`, `PlaylistPage.tsx:66`, `Notifications.tsx:68`
(`#cc0000` badge — fine in both themes, but should be a decision, not an
accident). The first phase-6 action must be re-running `audit-ui.mjs` full +
re-grepping, and regenerating the burn-down list from today's tree. Building
from the appendix list as-is would fix dead spots and miss live ones.

### R5 🔴 The sweep has no exemption boundary, and over-sweeping breaks the documented design

The appendix "Keep-as-is" contract (design doc:794–796) — player/Shorts
surfaces stay hardcoded black in light theme — is not restated in the phase-6
task. "Convert every hardcoded color … to tokens" (design doc:699–701), read
literally, includes `VideoSurface.tsx` (17 hex occurrences), `VideoPlayer.tsx`
(18), `ShortsPage.tsx` (11), plus the scrim/volume-thumb rules in
globals.css:255–281. Tokenizing those (e.g. VideoSurface.tsx:1261
`text-[#f1f1f1]` → `var(--yt-text)`) would flip the player chrome light in
light theme and break both the keep-as-is contract and the watch-surface
gauntlet. The task needs a written exemption list: player + Shorts black
surfaces, scrims, avatar palettes (VideoCard.tsx:35, Comments.tsx:9), brand
red (Header.tsx:17, Sidebar.tsx:177 logos; LIVE badges), and the volume
thumb. `globals.css:280` (`.yt-progress-played` hardcodes `#ff0000` while
`--yt-red` exists at :179) is inside the exempt zone but is a freebie worth
taking.

### R6 🔴 The final gauntlet exit is not achievable in this environment, and the plan has no fallback clause

Verified chain:

- The datacenter is bot-gated into blank feed references — recorded in
  `docs/evidence/phase0-summary.md:34–40`.
- `gauntlet-loop.mjs:198` — archived-reference fallback applies **only when
  `prof.name === "phone"`**; every other profile of a blank-ref surface
  becomes `SKIPPED-REF-BLANK` (gauntlet-loop.mjs:202).
- Archived references exist for exactly three surfaces, phone only:
  `docs/screenshots/bar_mytube_{home,search,watch}.png`.
- Pass condition is `losses === 0 && errs === 0` (gauntlet-loop.mjs:253) —
  **skipped surfaces pass**. And `--until-win` only re-runs surfaces whose
  previous verdict was `WINNER=reference` or `ERROR` (gauntlet-loop.mjs:173–177);
  a `SKIPPED-REF-BLANK` surface is never retried, so it stays skipped forever.

So "gauntlet-loop.mjs --until-win across the full 4×9 matrix; every surface
WIN or TIE-with-written-reason" (design doc:714–715) cannot be executed from
this network for tablet/laptop/desktop profiles of the feed surfaces. Either
the archived reference set is expanded (owner captures on a clean/residential
network — a hard dependency on the owner with the longest lead time of
anything in this phase), or the exit must be re-scoped the way phase 5
already handled the identical problem: its −10pp gate became a documented
device-checklist item (`docs/evidence/adfree-summary.md`, "The −10pp exit
criterion … is therefore a device checklist proof (plan risk #6)"). Phase 6
has no device-checklist section and no skip policy for its own headline
gate. This must be decided before the phase starts, not discovered at the
end with v2.0.0 blocked.

Secondary gauntlet problems, same gate:

- **The "settings" surface is a fake comparison:** our settings page is
  judged against YouTube's HOME page (gauntlet-loop.mjs:52, `ref: "/"`;
  fidelity-bar.mjs CASES has the same with a comment admitting "YouTube has
  no settings page on the surface"). A blind VLM comparing a settings list
  to a home feed is a coin flip, not a parity test. Either drop settings
  from the gauntlet matrix or find a real reference surface.
- **Ours is never blank-checked:** the honesty layer validates only the
  reference (gauntlet-loop.mjs:197). In the phase-0 baseline our own home
  capture was content-blank (gauntlet-summary.md gap text: "lacks any actual
  feed content") — the critic then honestly rules reference-wins and
  `--until-win` chases a data problem as if it were a UI regression. A
  cheap `isBlank(oursPng)` check with an explicit environment verdict would
  prevent that wild-goose chase.

### R7 🔴 The "4×9 matrix" does not exist in either tool

- `gauntlet-loop.mjs:45–54` — SURFACES has **8** entries; there is no
  `playlist` surface.
- `scripts/fidelity-bar.mjs` — "The 8 measured surfaces (phase-0 bar)";
  CASES has 8, no playlist.

Phase 4 promised "adds the `playlist` surface (9 total)" (design doc:649–651)
but never landed it in either harness. Phase 6's "typography/spacing … on
all 9 surfaces" (design doc:711) and "fidelity all-surfaces within tolerance
(9)" (design doc:717) reference a tool state that does not exist. Adding the
playlist case to both tools — plus obtaining a playlist reference
(m.youtube.com/playlist?list=…, itself a feed surface, itself subject to
R6's gating) — is a missing pre-task, not a detail.

### R8 🟡 "Dead CSS = 0" and "skeleton column parity" have no measuring tool

- Nothing in `scripts/` counts dead CSS. `audit-ui.mjs` has dead-interactive
  only (verified by grep across scripts/). The phase-0 plan's promised
  "skeleton/real column mismatch" audit class (design doc:273–274) was never
  implemented — phase0-summary.md:12 lists only 3 new classes. So two of
  phase 6's named gates ("dead CSS = 0 (1)", "skeleton column parity") have
  no instrument. Either build a small checker (parse selectors in
  globals.css, grep usages in src/; for parity, read both grids' computed
  `grid-template-columns`) or these "tests" become one-time manual greps
  that rot immediately.
- The parity bug itself is real and verified — and it lives exactly where no
  tool looks: `VideoCard.tsx:320` (skeleton grid) has `3xl:grid-cols-6`
  while `VideoCard.tsx:339` (real grid) stops at `2xl:grid-cols-5`. The
  mismatch is at ≥1920px; fidelity-bar's widest profile is 1440px, so the
  fidelity report can never see it. Also note WORKLOG session 17 deferred
  the "subs feed skeleton col fix" out of phase 4 — LibraryPages has its own
  skeleton (LibraryPages.tsx:82 uses a 5-col-max grid; SubscriptionsPage
  renders `<VideoGrid loading skeletonCount={8}>` at :181, but its real grid
  at :254 is `lg:grid-cols-4`) — "skeleton column parity" must cover
  LibraryPages too, not just VideoGrid.

### R9 🟡 The chips-remount fix has three unstated failure modes

Current state verified: `AppShell.tsx:83` —
`<HomePage key={route.category || "all"} category={…} />`; `ChipsBar.tsx:25`
is inside HomePage, so every category tap remounts the chips row and resets
its scroll. The plan (design doc:708–710) says "AppShell stops keying
HomePage on category — preserve chips scroll, swap grid with a cross-fade".
What it doesn't say:

1. **Stale-content window.** HomePage's fetch effect already keys on
   `[category, retry]` (HomePage.tsx:134), so unkeying does not break data
   loading — good. But today the remount resets `videos → null → skeleton`
   on every category change. Without the key, the effect re-runs WITHOUT
   resetting state (only `load()` at HomePage.tsx:108–113 resets, and it is
   retry-only), so the OLD category's grid stays fully rendered under the
   NEW active chip until the fetch lands. The fix must explicitly reset feed
   state (or derive loading from category) on category change — this is a
   truthfulness bug if missed, on the app's most-used interaction.
2. **Scroll position.** Today the remount collapses page height and the
   browser clamps scroll; unkeyed, the user stays mid-page on the "new"
   category. YouTube scrolls to top on category change — an explicit
   `scrollTo(0,0)` on category change is needed.
3. **"Cross-fade" is really a fade-in.** With plain CSS (no animation
   library in deps; vaul is the only one) the old grid unmounts instantly —
   a true cross-fade needs both mounted. A 150–200ms fade-in of the new grid
   is the realistic behavior; the plan should say which it wants, and add
   `scrollIntoView` for the active chip (preserved scroll ≠ active chip
   visible after 13 chips).

### R10 🟡 The phase-6 test list has no home and two under-specified assertions

- The convention (design doc §6 preamble) is "tests extend e2e-playback.mjs
  or e2e-parity.mjs unless a new harness is named" — phase 6 names none, and
  its checks (hardcoded-color=0, dead-CSS=0, reduced-motion, PWA manifest,
  9× fidelity, gauntlet summary) are audit-tool and loop-runner concerns,
  not e2e-suite concerns. Where each gate lives (a new `e2e-phase6.mjs`?
  ci.yml grep steps? fidelity/gauntlet exit codes?) is undefined, and ci.yml
  needs the new gate steps added regardless (R3).
- "reduced-motion kills all animations (1)": globals.css:467–474 ALREADY
  forces `animation-duration: 0.001ms` + `transition-duration: 0.001ms` on
  everything via a global media query, and there is no JS-driven animation
  anywhere (grep for `.animate(` in src/ = 0). The test is therefore only
  meaningful as a future-proofing guard; it must assert the computed
  durations under `page.emulateMedia({ reducedMotion: "reduce" })` against
  **0.001ms** (not 0 — the CSS value), and it passes trivially today. Say so,
  or it will be mistaken for coverage of the new motion wiring.
- "PWA manifest loads (1)": "installable" cannot be asserted headlessly;
  the honest test is fetch `/manifest.webmanifest` from the static server
  (with-server.sh serves the export on :3999), parse it, and assert
  name/icons(192+512)/start_url/display exist. Also: icons must be copied
  into `public/` — `generate-icons.py` writes `icons/png/icon-{512,192,…}.png`
  which is not a web-served location; `public/` currently contains only
  logo.svg and robots.txt. `themeColor` metas already exist
  (layout.tsx:30–33); the manifest's static `theme_color` vs the in-app
  theme toggle is an acceptable divergence (install UI only) but should be
  stated. And a manifest shipping `name: "YouTube"` (layout.tsx:18–19
  already brands the app so) makes an installable PWA impersonating YouTube
  — fine for a personal app, but it's a decision to write down, not an
  accident.

### R11 🟢 Minor / nits

- `--yt-status-warn/-ok/-err` need light-theme values too (YouTube light
  uses different status colors); they go into BOTH blocks at
  globals.css:161–185 and :187–209. The plan only names the tokens.
- "suggestion-dropdown skeletons (both search surfaces)": the desktop
  dropdown doesn't render at all while loading — `Header.tsx:197` gates on
  `desktopList.length > 0` — so a skeleton requires changing the render
  condition, not just adding skeleton rows; the overlay currently shows a
  text line (`SearchOverlay.tsx:218` "Searching suggestions…"). Small, but
  the plan should name both changes.
- The audit's PAGES list omits liked/later/playlists/playlist (4 of the
  route inventory's 12–13 routes); even after phase 6, hardcoded-color = 0
  is a claim about 8 routes, not the app. Either add the routes or scope the
  claim.
- WORKLOG session 18 shows phase 5 closed clean (playback 108/108, parity
  9/9, decipher 5/5, ads 11/0/1, bundle pass) — phase 6 starts from a green
  baseline, which makes any regression in phase 6 unambiguous. Keep it that
  way: full regression before EVERY sub-task, not just at the end.

---

## 2. What holds up

- **The theme-token infrastructure is solid and the sweep is mechanically
  safe on themed surfaces.** The full `--yt-*` palette exists in both themes
  (globals.css:161–209), `--yt-blue-contrast` already exists for the exact
  AccountMenu case, the body-token rule and pre-paint boot script are proven
  (globals.css:211–223, layout.tsx), and the layout.tsx comment shows the
  team already understands the utility-class-outspecificity trap. Converting
  the ~20 genuinely-themed spots is low-risk work.
- **The status-token idea is correctly aimed**: ~8 live call sites
  (SettingsPage 93/94/137/142, HomePage 67/174, WatchPage 190/327) currently
  hardcode warn/ok/err colors.
- **The motion keep-list is genuinely dead (verified)**: `.yt-page-enter`,
  `.yt-chip`, `.yt-icon-btn`, `.yt-card-lift` all have 0 usages in src/;
  wiring them touches only classNames. The global reduced-motion rule
  (globals.css:467–474) automatically covers every new CSS animation they
  wire — "reduced-motion respected" comes for free as long as everything
  stays in CSS.
- **The chips-remount diagnosis is correct and the code is receptive to the
  fix**: HomePage's fetch already re-keys on `[category]` (HomePage.tsx:134),
  so unkeying cannot break data loading — the risk is confined to the state
  reset/scroll/transition details (R9), all fixable in one file plus
  ChipsBar.
- **Skeleton column parity is a real, verified bug** (VideoCard.tsx:320 vs
  :339) — the task is aimed at something true, it just needs the ≥1920px
  blind spot and the LibraryPages skeletons accounted for.
- **The gauntlet honesty layer is well designed for what it does**: blank-ref
  detection by pixel variance, archived fallback, skip-instead-of-hallucinate
  (gauntlet-loop.mjs:62–103, :195–206), blind randomized judging with no
  free ties (gauntlet_critic.mjs:37–41, :90–95). The problem is only that
  the phase-6 exit gate promises more than this design can deliver from this
  network (R6), not that the tool is wrong.
- **The CI result-guard pattern is established and extensible**
  (ci.yml e2e steps + `RESULT: N passed` grep; with-server.sh takes exactly
  one quoted command and both are already respected). Phase 6's new gates
  can follow it mechanically.
- **Phase ordering (appearance last) remains right**: phases 1–5 moved
  SettingsPage, Comments, ChannelPage, VideoCard, WatchPage and added
  VideoSurface/AccountMenu/Notifications/PlaylistPage — sweeping tokens
  before those rewrites would have been wasted work. Doing it now, once,
  against the final surfaces, is correct.
- **PWA scope is honest**: manifest + icons + theme-color is the right
  minimal installable set, icon generation already exists
  (generate-icons.py), and a manifest is inert in the Capacitor/Electron
  targets so the three-target contract is not at risk.

---

## 3. Recommended execution order (riskiest first)

1. **Re-baseline and re-derive every list (half a session, before any
   product code).** Full `audit-ui.mjs` run on all 8 pages × 4 profiles;
   regenerate the hardcoded-color burn-down from today's tree (R4); re-derive
   the dead-class list from current globals.css + usage grep — `.yt-pop`
   moves to KEEP, `.yt-card:hover .yt-thumb-img` (globals.css:245) joins the
   delete list (R1). Reason: every downstream task consumes these lists;
   building on the 2026-11-05 snapshot wastes the phase or breaks shipped
   surfaces.
2. **Decide the gauntlet exit policy and start the owner dependency
   immediately (R6, R7).** Either expand the archived reference set
   (home/search/watch today) to the missing surfaces × profiles via the
   owner's clean network, or re-scope the exit to "every JUDGED surface
   WIN/TIE + skips documented as device-checklist items" per the phase-5
   precedent (adfree-summary.md). Add the `playlist` case to gauntlet-loop
   SURFACES and fidelity-bar CASES at the same time (else "4×9" stays a
   fiction). Reason: this is the only task with an external human dependency
   and the longest lead time; if it's discovered at phase-end, v2.0.0 blocks
   on it.
3. **Build the missing gates before the fixes they gate (R3, R8, R10).**
   Dead-CSS checker; skeleton/real column-parity assert (computed
   `grid-template-columns` at ≥1920px too); extend or consciously accept the
   audit's 7-color probe and add the `hardc=0`/`dead=0` grep gates to ci.yml
   (which currently reports but does not gate); name the harness for the six
   phase-6 test groups. Reason: define "done" before doing — otherwise the
   gates get bent to match whatever the code ends up doing.
4. **Chips-remount fix (R9) — highest user-visible regression risk in
   product code.** Unkey HomePage, add the category-change state reset +
   `scrollTo(0,0)` + active-chip `scrollIntoView` + grid fade-in; write its
   e2e in the same commit (new chip active → old grid NOT still rendered;
   chips scroll preserved). Reason: it touches the home feed — the surface
   every other check screenshots; do it while the tree is otherwise quiet.
5. **Theme-token sweep with a written exemption list (R5).** Player/Shorts
   black surfaces, scrims, avatar palettes, brand red, LIVE badges stay; fix
   the R3 list including hover states, AccountMenu `--yt-blue-contrast`,
   toast, `:focus-visible` → `var(--yt-blue)`, banner gradient; add the
   three status tokens with BOTH theme values. Reason: mechanical once
   scoped, but widest diff of the phase — land it before motion/skeleton
   work so their screenshots are final.
6. **Motion layer (R1, R2):** wire the four keepers (retargeting
   `.yt-card-lift` at the thumbnail since `.yt-media` dies), delete the five
   true dead classes + the `.yt-card:hover .yt-thumb-img` rule, keep
   `.yt-pop` as-is. Reason: after the token sweep, so no class edits collide.
7. **Skeletons:** VideoGrid 3xl parity (decide 5-vs-6 col direction against
   YouTube at 1920+ first), LibraryPages subs skeleton, suggestion-dropdown
   skeletons on both surfaces (including Header's render-condition change,
   R11). 
8. **Typography/spacing burn-down** strictly per the fidelity report, all 9
   surfaces (after step 2 adds playlist to the tool).
9. **PWA manifest** (R10): copy icons to public/, add app/manifest.ts,
   manifest-fetch test. Low risk; anywhere after step 5.
10. **Final gauntlet full run → `--until-win` → full regression (playback +
    parity + ads + decipher + bundle) → tag v2.0.0.** Last, as planned — but
    with the step-2 policy deciding what "all WIN/TIE" means for skipped
    surfaces, and a full regression between every prior step, not just here.

**The one-sentence verdict:** the phase's goals are real and mostly
well-aimed, but its three load-bearing artifacts — the ~30-spot list, the
10-class dead-CSS list, and the 4×9 gauntlet matrix — are all stale or
nonexistent against the current tree, and its headline exit gates
("hardcoded-color = 0", "every surface WIN or TIE") are enforced by
instruments that do not currently exist or cannot run in this network; fix
the bar before polishing against it.

#!/bin/bash
# E2E — v1.2.0 session: user-reported issues verified end-to-end on the static
# APK artifact through the dev relay (= exact on-device parsing code path).
# Focus: center skip controls, embed end-screen escape blocker, theme toggle,
# what's-new tour, audio-mode discoverability + full regression.
# Run: bash scripts/with-server.sh 'bash scripts/e2e-v12.sh'
set -u
export AGENT_BROWSER_SESSION="ytapp-e2e-v12"
BASE="http://127.0.0.1:3999"
SS=/home/z/my-project/docs/screenshots
mkdir -p "$SS" /home/z/e2e
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $1"; }

# resilience: retry any agent-browser command once after relaunch
ab() {
  local out rc
  out=$("$@" 2>&1); rc=$?
  if [ $rc -ne 0 ]; then
    agent-browser close --all >/dev/null 2>&1
    sleep 1
    out=$("$@" 2>&1); rc=$?
  fi
  echo "$out"
  return $rc
}
# eval helper: strips JSON string quoting + backslashes
ev() { agent-browser eval "$1" 2>/dev/null | tr -d '\\' | sed 's/^"//; s/"$//'; }
# number extractor from eval JSON output
num() { echo "$1" | grep -o "\"$2\":[0-9-]*" | head -1 | cut -d: -f2; }
# poll until a JS expression is truthy (hydration / feed readiness)
waitdom() {
  local expr="$1" timeout="${2:-30}" i=0
  while [ $i -lt $((timeout * 2)) ]; do
    R=$(ev "(() => { try { return !!($expr); } catch { return false; } })()" | tr -d '"')
    [ "$R" = "true" ] && return 0
    sleep 0.5; i=$((i + 1))
  done
  return 1
}

echo "== 0. Fresh start: deterministic state + whats-new =="
ab agent-browser close --all >/dev/null 2>&1
ab agent-browser open "$BASE/?src=standalone" >/dev/null
ab agent-browser set viewport 390 844 >/dev/null
# cold-start race: if the app shell didn't come up, hard-retry once
if ! waitdom 'document.querySelector("[data-testid=theme-toggle]")' 20; then
  echo "  (cold-start flake — relaunching browser)"
  agent-browser close --all >/dev/null 2>&1; sleep 2
  ab agent-browser open "$BASE/?src=standalone" >/dev/null
  ab agent-browser set viewport 390 844 >/dev/null
  waitdom 'document.querySelector("[data-testid=theme-toggle]")' 30 || true
fi
# reset ALL prefs + whats-new so every run is deterministic
ab agent-browser eval '(function(){ try { localStorage.setItem("yt-app-store", JSON.stringify({state:{prefs:{sponsorblock:true,autoplay:true,defaultQuality:"auto",cinemaMode:false,theme:"dark",backgroundPlay:true,audioOnly:false}},version:0})); localStorage.removeItem("yt_whatsnew_seen"); } catch(e){} location.reload(); return "reset"; })()' >/dev/null
waitdom 'document.querySelector("[data-testid=theme-toggle]")' 30 || true
sleep 1
# prove the dialog appears for the new version, then dismiss for the rest
WN=$(ev '(() => { const d = document.querySelector("[data-testid=whats-new]"); const ver = d ? (d.textContent.match(/v\d+\.\d+\.\d+/) || [""])[0] : ""; return JSON.stringify({open: !!d, ver}); })()')
echo "  whatsnew: $WN"
echo "$WN" | grep -q '"open":true' && echo "$WN" | grep -q '1.2.0' && ok "What's-new dialog shows for v1.2.0" || bad "What's-new dialog missing"
ab agent-browser screenshot /home/z/e2e/v12_whatsnew.png >/dev/null
ev '(() => { document.querySelector("[data-testid=whats-new-got-it]")?.click(); return "ok"; })()' >/dev/null
sleep 1
WN2=$(ev '(() => JSON.stringify({open: !!document.querySelector("[data-testid=whats-new]"), seen: localStorage.getItem("yt_whatsnew_seen")}))()')
echo "  after dismiss: $WN2"
echo "$WN2" | grep -q '"open":false' && echo "$WN2" | grep -q '1.2.0' && ok "dismissal persists (yt_whatsnew_seen=1.2.0)" || bad "dismissal not persisted"

echo "== 2. Header theme toggle: dark → light → system cycle =="
T1=$(ev '(() => { document.querySelector("[data-testid=theme-toggle]")?.click(); return JSON.stringify({light: document.documentElement.classList.contains("yt-light")}); })()')
sleep 1
T1b=$(ev '(() => JSON.stringify({light: document.documentElement.classList.contains("yt-light"), dark: document.documentElement.classList.contains("yt-dark")}))()')
echo "  after 1st tap: $T1 → $T1b"
echo "$T1b" | grep -q '"light":true' && ok "1st tap → light theme applied" || bad "light theme not applied"
T2=$(ev '(() => { const t = document.querySelector("[data-testid=theme-toggle]"); const icon = t ? (t.innerHTML.match(/lucide-[a-z]+/) || ["?"])[0] : "none"; t?.click(); return JSON.stringify({icon}); })()')
sleep 1
T2b=$(ev '(() => { const t = document.querySelector("[data-testid=theme-toggle]"); const icon = t ? (t.innerHTML.match(/lucide-[a-z]+/) || ["?"])[0] : "none"; return JSON.stringify({icon}); })()')
echo "  icons: light→$T2 system→$T2b"
echo "$T2" | grep -q 'lucide-sun' && ok "light mode shows sun icon" || bad "sun icon not shown in light mode"
T3=$(ev '(() => { const t = document.querySelector("[data-testid=theme-toggle]"); t?.click(); return "tapped"; })()')
sleep 1
T3b=$(ev '(() => JSON.stringify({dark: document.documentElement.classList.contains("yt-dark"), light: document.documentElement.classList.contains("yt-light")}))()')
echo "  3rd tap: $T3b"
echo "$T3b" | grep -q '"dark":true' && ok "3rd tap returns to dark (full cycle)" || bad "theme cycle broken"
ab agent-browser screenshot /home/z/e2e/v12_theme_light.png >/dev/null 2>&1 || true
# persistence: switch to light, reload, verify pre-paint boot applies it
ev '(() => { const t = document.querySelector("[data-testid=theme-toggle]"); const ic = t ? (t.innerHTML.match(/lucide-[a-z]+/) || ["?"])[0] : "none"; if (ic !== "lucide-sun") t?.click(); return ic; })()' >/dev/null
sleep 1
TP=$(ev 'location.reload(); "ok"' >/dev/null; sleep 4; ev '(() => JSON.stringify({light: document.documentElement.classList.contains("yt-light")}))()')
echo "  after reload: $TP"
echo "$TP" | grep -q '"light":true' && ok "theme survives reload (pre-paint boot)" || bad "theme lost on reload"
# back to dark
ev '(() => { const t = document.querySelector("[data-testid=theme-toggle]"); const ic = t ? (t.innerHTML.match(/lucide-[a-z]+/) || ["?"])[0] : "none"; if (ic === "lucide-sun") t?.click(); return ic; })()' >/dev/null
sleep 1

echo "== 3. CENTER CONTROLS on the direct-stream player =="
ab agent-browser open "$BASE/?src=standalone&v=dQw4w9WgXcQ" >/dev/null
waitdom 'document.querySelector("video") && document.querySelector("h1")' 40 || true
sleep 3
CC=$(ev '(() => { const cc = document.querySelector("[data-testid=center-controls]"); const btns = cc ? [...cc.querySelectorAll("button[aria-label]")].map(b => b.getAttribute("aria-label")) : []; return JSON.stringify({present: !!cc, btns}); })()')
echo "  center controls: $CC"
echo "$CC" | grep -q '"present":true' \
  && echo "$CC" | grep -q 'Rewind 10 seconds' \
  && echo "$CC" | grep -q 'Pause (k)' \
  && echo "$CC" | grep -q 'Forward 10 seconds' \
  && echo "$CC" | grep -q 'Next video' \
  && ok "center cluster: rewind10 + pause + forward10 + next" || bad "center controls incomplete"
SEEK=$(ev '(async () => { const v = document.querySelector("video"); if (!v) return JSON.stringify({err: 1}); const sleep = (ms) => new Promise(r => setTimeout(r, ms)); await sleep(600); const t0 = v.currentTime; [...document.querySelectorAll("[data-testid=center-controls] button")].find(b => b.getAttribute("aria-label") === "Forward 10 seconds")?.click(); await sleep(500); const t1 = v.currentTime; [...document.querySelectorAll("[data-testid=center-controls] button")].find(b => b.getAttribute("aria-label") === "Rewind 10 seconds")?.click(); await sleep(500); const t2 = v.currentTime; [...document.querySelectorAll("[data-testid=center-controls] button")].find(b => (b.getAttribute("aria-label") || "").startsWith("Pause"))?.click(); await sleep(300); return JSON.stringify({t0: Math.round(t0), t1: Math.round(t1), t2: Math.round(t2), paused: v.paused}); })()')
echo "  seek/pause probe: $SEEK"
FWD=$(( $(num "$SEEK" t1) - $(num "$SEEK" t0) ))
BACK=$(( $(num "$SEEK" t1) - $(num "$SEEK" t2) ))
[ "$FWD" -ge 8 ] && ok "forward-10 button seeks +10s (delta $FWD)" || bad "forward-10 delta $FWD"
[ "$BACK" -ge 8 ] && ok "rewind-10 button seeks -10s (delta $BACK)" || bad "rewind-10 delta $BACK"
echo "$SEEK" | grep -q '"paused":true' && ok "center pause button pauses playback" || bad "center pause did not pause"
ab agent-browser screenshot /home/z/e2e/v12_center_controls.png >/dev/null 2>&1 || true

echo "== 4. Audio mode toggle in the player bar =="
AM=$(ev '(() => { const b = document.querySelector("[data-testid=audio-mode-toggle]"); return JSON.stringify({present: !!b, label: b ? b.textContent.trim() : ""}); })()')
echo "  audio button: $AM"
echo "$AM" | grep -q '"present":true' && ok "Audio button in player bar (direct video)" || bad "audio-mode toggle missing on direct video"
AMS=$(ev '(async () => { const sleep = (ms) => new Promise(r => setTimeout(r, ms)); document.querySelector("[data-testid=audio-mode-toggle]")?.click(); await sleep(2600); const v = document.querySelector("video"); const chip = [...document.querySelectorAll("div,span")].some(e => e.textContent.trim() === "Audio mode"); return JSON.stringify({t: v ? Math.round(v.currentTime) : -1, ready: v ? v.readyState : -1, chip, paused: v ? v.paused : null}); })()')
echo "  after audio-mode on: $AMS"
echo "$AMS" | grep -q '"chip":true' && echo "$AMS" | grep -q '"paused":false' && ok "audio-mode swap keeps playback live + chip visible" || bad "audio mode swap broke playback"
ab agent-browser screenshot /home/z/e2e/v12_audio_mode.png >/dev/null 2>&1 || true
ev '(() => { document.querySelector("[data-testid=audio-mode-toggle]")?.click(); return "audio off"; })()' >/dev/null
sleep 2

echo "== 5. Embed video: end-screen escape blocker (user issue #2) =="
# NOTE: sandbox headless Chrome + datacenter IP = the real embed itself is
# bot-gated ("Sign in to confirm you're not a bot") and never reaches ENDED,
# so the overlay RENDER + in-app routing are driven via the __ytEmbedEnded
# E2E hook; the IFrame-API wiring (state 0 → overlay) is code-verified and
# fires on real devices where the embed plays.
ab agent-browser open "$BASE/?src=standalone&v=aqz-KE-bpKQ" >/dev/null
waitdom 'document.querySelector("iframe[src*=youtube]") && document.querySelector("h1")' 40 || true
sleep 2
API=$(ev '(() => JSON.stringify({api: !!window.__ytEmbedPlayer, iframe: !!document.querySelector("iframe[src*=youtube]"), hook: typeof window.__ytEmbedEnded}))()')
echo "  embed wiring: $API"
echo "$API" | grep -q '"api":true' && echo "$API" | grep -q '"iframe":true' && ok "IFrame API attached to the embed player" || bad "embed API not attached"
# autoplay OFF so ENDED renders the overlay (not auto-navigation)
AO=$(ev '(() => { const s = [...document.querySelectorAll("[role=switch]")].find(x => (x.getAttribute("aria-label") || "").includes("Autoplay")); if (s && s.getAttribute("aria-checked") === "true") s.click(); return s ? s.getAttribute("aria-checked") : "none"; })()')
echo "  autoplay now: $AO"
sleep 1
ev '(() => { window.__ytEmbedEnded?.(true); return "ended forced"; })()' >/dev/null
sleep 1
EO=$(ev '(() => { const ov = document.querySelector("[data-testid=embed-ended-overlay]"); const next = document.querySelector("[data-testid=embed-ended-next]"); return JSON.stringify({overlay: !!ov, next: !!next, host: location.host}); })()')
echo "  ended state: $EO"
echo "$EO" | grep -q '"overlay":true' && echo "$EO" | grep -q '"next":true' && ok "our Next-video overlay covers the embed end screen" || bad "embed ended overlay did not render"
echo "$EO" | grep -q '127.0.0.1:3999' && ok "still INSIDE the app (no escape to youtube.com)" || bad "page escaped to external YouTube!"
ab agent-browser screenshot /home/z/e2e/v12_embed_ended.png >/dev/null 2>&1 || true
NAV=$(ev '(async () => { const sleep = (ms) => new Promise(r => setTimeout(r, ms)); document.querySelector("[data-testid=embed-ended-next]")?.click(); await sleep(4500); return JSON.stringify({host: location.host, q: location.search.slice(0, 40)}); })()')
echo "  after clicking next: $NAV"
echo "$NAV" | grep -q '127.0.0.1:3999' && echo "$NAV" | grep -q 'v=' && ok "next video opens IN-APP (internal route)" || bad "next video did not route internally"

echo "== 6. Related videos below the player route internally (compact cards are buttons) =="
ab agent-browser open "$BASE/?src=standalone&v=dQw4w9WgXcQ" >/dev/null
waitdom 'document.querySelector("aside button h3")' 40 || true
sleep 2
REL=$(ev '(async () => { const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const card = document.querySelector("aside button h3")?.closest("button"); if (!card) return JSON.stringify({card: false}); card.click(); await sleep(5000); return JSON.stringify({card: true, host: location.host, q: location.search.slice(0, 40)}); })()')
echo "  related click: $REL"
echo "$REL" | grep -q '"card":true' && echo "$REL" | grep -q '127.0.0.1:3999' && echo "$REL" | grep -q 'v=' && ok "related video opens in-app (never external)" || bad "related video routing broken"

echo "== 7. Regression: player bar in BOTH modes =="
PB=$(ev '(() => { const skip = [...document.querySelectorAll("button")].filter(b => b.textContent.trim() === "Skip video").length; const auto = [...document.querySelectorAll("[role=switch]")].filter(s => (s.getAttribute("aria-label") || "").includes("Autoplay")).length; return JSON.stringify({skip, auto}); })()')
echo "  player bar: $PB"
echo "$PB" | grep -q '"skip":1' && echo "$PB" | grep -q '"auto":1' && ok "player bar: Autoplay + Skip video present" || bad "player bar missing"

echo "== 8. Regression: home feed loads deep =="
ab agent-browser open "$BASE/?src=standalone" >/dev/null
if ! waitdom 'document.querySelectorAll("a[href*=v=]").length > 4' 25; then
  # the InnerTube home fetch occasionally throttles from this datacenter IP —
  # one reload is the standard self-heal (same thing the Retry button does)
  echo "  (home feed slow — reloading once)"
  ev 'location.reload()' >/dev/null; sleep 2
  waitdom 'document.querySelectorAll("a[href*=v=]").length > 4' 40 || true
fi
for Y in 800 1600 2400 3200 4000; do ev "window.scrollTo(0, $Y)" >/dev/null; sleep 0.8; done
HOME=$(ev '(() => JSON.stringify({imgs: [...document.querySelectorAll("img")].filter(i => i.complete && i.naturalWidth > 40).length, cards: document.querySelectorAll("a[href*=v=]").length}))()')
echo "  home: $HOME"
IMGS=$(num "$HOME" imgs)
CARDS=$(num "$HOME" cards)
[ "${IMGS:-0}" -ge 15 ] || [ "${CARDS:-0}" -ge 15 ] && ok "home feed renders cards (imgs $IMGS / cards $CARDS)" || bad "home feed empty (imgs $IMGS / cards $CARDS)"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] && exit 0 || exit 1

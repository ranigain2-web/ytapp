// audit-colors.mjs — phase 6 gate: ZERO hardcoded colors outside the written
// exemption list. Static (source-level) on purpose: the runtime probe in
// audit-ui.mjs only sees visible computed styles and misses hover states,
// gradients, focus rings and placeholders — this catches them all at the
// source. Run: node scripts/audit-colors.mjs
import fs from "node:fs";
import { execSync } from "node:child_process";

// ---- the exemption boundary (goldfish R5): keep this list honest ----
// Player/Shorts black surfaces: the video player is intentionally
// theme-independent (YouTube's player chrome is always dark-on-black).
const EXEMPT_FILES = [
  // The compat injection bundle runs INSIDE YouTube's page, where this app's
  // CSS custom properties do not exist — every style it applies (the exit
  // pill, the continue-watching dialog) must carry raw literals.
  "src/lib/compat/compat-injection.ts",
  "src/components/yt/VideoPlayer.tsx",
  "src/components/yt/ShortsPage.tsx",
  "src/components/yt/CountdownCard.tsx",
  "src/app/globals.css", // tokens themselves live here
  "src/components/ui/chart.tsx", // vendored shadcn chart kit, not our UI
];
// VideoSurface embeds the player's settings overlay (dark player chrome,
// same class as VideoPlayer) — lines from the overlay down are exempt
const PLAYER_OVERLAY_START = 1100;
// Line-level exemptions (kept minimal; each says why it stays raw):
//  - avatar palette arrays (Comments/VideoCard): decorative, not themed
//  - the YouTube logo wordmark: always white like YouTube's own logo
const EXEMPT_LINE_PATTERNS = [
  /const colors = \[/,      // avatar palette (the array literal + its line)
  /M27\.4 3\.1s/,           // logo path (white-on-dark like YouTube)
  /fill="#fff" \/>\s*$/,    // logo play-button triangle
  /linear-gradient\(rgba\(0,0,0/, // watch-page thumb scrim (always dark scrim)
];

const files = execSync("find src -name '*.tsx' -o -name '*.ts' | grep -v node_modules", { encoding: "utf8" })
  .split("\n").filter(Boolean).filter(f => !EXEMPT_FILES.includes(f));

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGB = /rgba?\(\s*\d/;
let violations = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  const overlayStart = f.endsWith("VideoSurface.tsx") ? PLAYER_OVERLAY_START : Infinity;
  lines.forEach((line, i) => {
    if (i + 1 >= overlayStart) return;
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("{/*")) return; // comments
    if (/hex-ok/.test(line)) return; // explicit per-line exemption marker
    if (EXEMPT_LINE_PATTERNS.some(re => re.test(line))) return;
    if (HEX.test(line) || RGB.test(line)) {
      // var(...) usage is the goal — lines that ONLY contain tokens pass
      violations++;
      console.log(`✗ ${f}:${i + 1}: ${line.trim().slice(0, 110)}`);
    }
  });
}

if (violations === 0) {
  console.log("hardcoded colors: 0 (exemptions: player surfaces, avatar palettes, logo, scrims)");
  console.log("RESULT: 1 passed, 0 failed");
  process.exit(0);
}
console.log(`\nRESULT: 0 passed, ${violations} failed`);
process.exit(1);

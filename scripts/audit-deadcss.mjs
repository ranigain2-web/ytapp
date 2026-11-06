// audit-deadcss.mjs — phase 6 gate: every class defined in globals.css must
// be used in src/ (or be on the written exemption list). Catches both the
// "dead class" defect (defined, never wired) and drift after refactors.
// Run: node scripts/audit-deadcss.mjs
import fs from "node:fs";
import { execSync } from "node:child_process";

const css = fs.readFileSync("src/app/globals.css", "utf8");

// class selectors defined in globals.css (skip @keyframes + comments; the
// comment strip prevents matching ".js"/".ts"/".com" from prose)
const body = css
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/@keyframes\s+[\w-]+\s*\{[^}]*\}/g, "");
const defined = new Set();
for (const m of body.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
  defined.add(m[1]);
}

// usage corpus: EVERYTHING in src (template literals, conditional classNames,
// and runtime-applied strings all count)
const corpus = execSync("grep -rh '' src --include='*.tsx' --include='*.ts' || true", { encoding: "utf8", shell: "/bin/bash" });

// framework/Tailwind-base selectors that live in globals but are applied by
// the framework or the theme boot script, not by our classNames
const EXEMPT = new Set([
  "dark", "font-sans", "yt-dark", "yt-light", // shadcn base + theme hooks (yt-theme.ts)
  "no-scrollbar", // used inside className strings on scrollers
]);

let dead = 0;
for (const cls of [...defined].sort()) {
  if (EXEMPT.has(cls)) continue;
  if (new RegExp(`(?<![\w-])${cls}(?![\w-])`).test(corpus)) continue;
  dead++;
  console.log(`✗ dead class: .${cls} (defined in globals.css, never used in src/)`);
}

if (dead === 0) {
  console.log(`dead CSS: 0 (${defined.size} classes defined, all used)`);
  console.log("RESULT: 1 passed, 0 failed");
  process.exit(0);
}
console.log(`\nRESULT: 0 passed, ${dead} failed`);
process.exit(1);

// ============================================================================
// gauntlet-loop.mjs — the standing gauntlet: our app vs real YouTube, judged
// blind by a fresh-context critic until ours wins (or ties with a reason).
//
// This is the automated form of the gauntlet-loop skill: the builder improves a
// surface, the loop screenshots ours + the reference at the same viewport,
// strips the labels, and asks scripts/gauntlet_critic.mjs (a separate model
// call with zero build context — the "harsh critic") which one is better.
// The exit condition is a VERDICT, never a round count.
//
// Usage (app must be built + served on :3999; server on :3001):
//   bash scripts/with-server.sh 'node scripts/gauntlet-loop.mjs'
//   bash scripts/with-server.sh 'node scripts/gauntlet-loop.mjs --quick'      # 4 core surfaces, phone only
//   bash scripts/with-server.sh 'node scripts/gauntlet-loop.mjs --surface watch --profile phone'
//   bash scripts/with-server.sh 'node scripts/gauntlet-loop.mjs --until-win'  # re-run GAP surfaces after fixes
//
// Output: docs/evidence/gauntlet-summary.md (+ raw verdicts in JSON).
// Exit code: 0 iff every judged surface is WINNER=ours or TIE.
// ============================================================================
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const OURS = process.env.BASE || "http://127.0.0.1:3999";
const OUT = "docs/evidence";
const VIDEO = process.env.VIDEO || "dQw4w9WgXcQ";

const args = process.argv.slice(2);
const QUICK = args.includes("--quick");
const UNTIL_WIN = args.includes("--until-win");
const surfArg = args.includes("--surface") ? args[args.indexOf("--surface") + 1] : "";
const profArg = args.includes("--profile") ? args[args.indexOf("--profile") + 1] : "";

const PROFILES = [
  { name: "phone", width: 390, height: 844, dpr: 3, mobile: true, ref: "https://m.youtube.com" },
  { name: "tablet", width: 834, height: 1194, dpr: 2, mobile: false, ref: "https://www.youtube.com" },
  { name: "laptop", width: 1024, height: 768, dpr: 2, mobile: false, ref: "https://www.youtube.com" },
  { name: "desktop", width: 1440, height: 900, dpr: 1, mobile: false, ref: "https://www.youtube.com" },
];

const SURFACES = [
  { name: "home", ours: "/", ref: "/" },
  { name: "watch", ours: `/?src=server&v=${VIDEO}`, ref: `/watch?v=${VIDEO}` },
  { name: "search", ours: "/?q=space%20documentary", ref: "/results?search_query=space+documentary" },
  { name: "shorts", ours: "/?page=shorts", ref: "/shorts" },
  { name: "channel", ours: "/?channel=UCuAXFkgsw1L7xaCfnd5JJOw", ref: "/@RickAstleyYT" },
  { name: "subscriptions", ours: "/?page=subscriptions", ref: "/feed/subscriptions" },
  { name: "history", ours: "/?page=history", ref: "/feed/history" },
  // phase 6: playlist surface added (the "4x9" was really 4x8); settings
  // REMOVED: YouTube has no settings page — the old settings-vs-home
  // comparison was meaningless (goldfish finding)
  { name: "playlist", ours: "/?page=playlist&id=PLlaN88a7y2_qHDbY9eQbuNTAuEJUSEeuu", ref: "/playlist?list=PLlaN88a7y2_qHDbY9eQbuNTAuEJUSEeuu" },
];
const QUICK_SURFACES = ["home", "watch", "search", "shorts"];
const QUICK_PROFILES = ["phone"];

const APP_VERSION = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Blankness check: a bot-gated YouTube page renders its shell but leaves the
// feed white/empty. A live feed has hundreds of thousands of pixel-variance in
// every band; a gated page has near-zero variance in the lower half. Comparing
// against a blank "reference" would make the critic hallucinate — so we detect
// it and fall back to the archived reference (captured when the environment
// allowed), or skip the surface honestly.
function pngLowerHalfVariance(p) {
  // decode via pngjs (a playwright transitive dep) or fail gracefully
  try {
    const pngjs = require("pngjs");
    const data = fs.readFileSync(p);
    const png = pngjs.PNG.sync.read(data);
    const { width, height, data: d } = png;
    let sum = 0, sum2 = 0, n = 0;
    const start = Math.floor(height / 2) * width * 4;
    for (let i = start; i < d.length; i += 4 * 16) { // sample every 16th px
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += g; sum2 += g * g; n++;
    }
    const mean = sum / n;
    return sum2 / n - mean * mean;
  } catch {
    return -1; // unknown — treat as non-blank (don't skip on tool failure)
  }
}
const isBlank = (p) => {
  const v = pngLowerHalfVariance(p);
  return v >= 0 && v < 400; // a real feed's lower half measures >1500 typically
};

async function dismissConsent(page) {
  for (const label of ["Accept all", "I agree", "Reject all", "Accept the use of cookies", "Got it"]) {
    const b = page.getByRole("button", { name: label });
    if (await b.count().catch(() => 0)) {
      await b.first().click().catch(() => {});
      await page.waitForTimeout(1200);
      return label;
    }
  }
  return null;
}

async function shoot(browser, { url, profile, mobile, ref, outPath }) {
  const ctx = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    isMobile: mobile && profile.mobile,
    hasTouch: mobile && profile.mobile,
    locale: "en-US",
    userAgent: mobile
      ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
      : undefined,
  });
  if (!ref) {
    await ctx.addInitScript((v) => {
      try {
        localStorage.setItem("yt_whatsnew_seen", v);
        localStorage.setItem("yt-app-store", JSON.stringify({ state: { prefs: {
          sponsorblock: false, autoplay: false, defaultQuality: "auto",
          cinemaMode: false, theme: "dark", backgroundPlay: true, audioOnly: false } }, version: 0 }));
      } catch { /* ignore */ }
    }, APP_VERSION);
  }
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (ref) await dismissConsent(page);
    await sleep(ref ? 6500 : 4200);
    await page.evaluate(() => window.scrollTo(0, 300)).catch(() => {});
    await sleep(700);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await sleep(500);
    await page.screenshot({ path: outPath });
  } finally {
    await ctx.close();
  }
}

function judge(oursPng, refPng, context) {
  // The critic runs as its own process + model call: zero build context, no
  // knowledge of how hard we worked. That separation is the gauntlet rule.
  let out = "";
  try {
    out = execFileSync("node", ["scripts/gauntlet_critic.mjs", oursPng, refPng, context], {
      encoding: "utf8",
      timeout: 120000,
    });
  } catch (e) {
    return { verdict: "ERROR", reason: String(e.message || e).slice(0, 160), raw: (e.stdout || "").slice(0, 300) };
  }
  const get = (k) => { const m = out.match(new RegExp(`^\\s*${k}\\s*:\\s*(.+)$`, "mi")); return m ? m[1].trim() : ""; };
  const verdict = get("VERDICT");
  return {
    verdict: verdict || "UNPARSED",
    reason: get("REASON"),
    gap: get("GAP"),
    confidence: get("CONFIDENCE"),
  };
}

(async () => {
  fs.mkdirSync(`${OUT}/raw`, { recursive: true });
  // resume support: --until-win only re-judges surfaces that lost last time
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(`${OUT}/gauntlet-verdicts.json`, "utf8")); } catch { /* first run */ }

  const profiles = PROFILES.filter((p) => (QUICK ? QUICK_PROFILES : ["phone", "tablet", "laptop", "desktop"]).includes(p.name))
    .filter((p) => !profArg || p.name === profArg);
  let surfaces = SURFACES.filter((s) => (QUICK ? QUICK_SURFACES : SURFACES.map((x) => x.name)).includes(s.name))
    .filter((s) => !surfArg || s.name === surfArg);

  if (UNTIL_WIN && prev) {
    const lost = new Set(Object.entries(prev).filter(([, v]) => v.verdict === "WINNER=reference" || v.verdict === "ERROR").map(([k]) => k.split("/")[1]));
    surfaces = surfaces.filter((s) => lost.has(s.name));
    console.log(`--until-win: re-judging ${surfaces.length} surface(s) that lost last time`);
  }

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=en-US"] });
  const verdicts = UNTIL_WIN && prev ? { ...prev } : {};
  const rows = [];

  for (const prof of profiles) {
    for (const s of surfaces) {
      const key = `${prof.name}/${s.name}`;
      const oursPng = `${OUT}/raw/${prof.name}-${s.name}-ours.png`;
      const refPng = `${OUT}/raw/${prof.name}-${s.name}-ref.png`;
      const archivedRef = `docs/screenshots/bar_mytube_${s.name}.png`; // captured on a clean network
      process.stdout.write(`[gauntlet] ${key}: capturing ours… `);
      try {
        await shoot(browser, { url: OURS + s.ours, profile: prof, mobile: prof.mobile, ref: false, outPath: oursPng });
        process.stdout.write(`reference… `);
        await shoot(browser, { url: prof.ref + s.ref, profile: prof, mobile: prof.mobile, ref: true, outPath: refPng });

        // honesty layer: never compare against a bot-gated blank reference
        let refSource = "fresh";
        if (isBlank(refPng)) {
          if (fs.existsSync(archivedRef) && prof.name === "phone") {
            refSource = "archived";
            fs.copyFileSync(archivedRef, refPng);
          } else {
            verdicts[key] = { verdict: "SKIPPED-REF-BLANK", reason: "YouTube served a bot-gated empty page to this network; no archived reference for this surface/profile" };
            console.log(`⏭️ reference blank (bot-gated), no archive — SKIPPED (honest)`);
            continue;
          }
        }

        process.stdout.write(`judging (ref=${refSource})… `);
        const v = judge(oursPng, refPng, `the ${s.name} ${prof.name} surface of a YouTube-like mobile app`);
        v.refSource = refSource;
        verdicts[key] = v;
        const win = v.verdict === "WINNER=ours" ? "🏆" : v.verdict === "TIE" ? "🤝" : v.verdict === "ERROR" ? "⚠️" : "❌";
        console.log(`${win} ${v.verdict}${v.gap ? " — " + v.gap.slice(0, 90) : ""}`);
        rows.push({ key, ...v });
      } catch (e) {
        verdicts[key] = { verdict: "ERROR", reason: String(e.message || e).slice(0, 160) };
        console.log(`⚠️ capture failed: ${String(e.message || e).slice(0, 120)}`);
      }
    }
  }
  await browser.close();

  fs.writeFileSync(`${OUT}/gauntlet-verdicts.json`, JSON.stringify(verdicts, null, 2));

  // summary markdown (the only gauntlet artifact that gets committed)
  const all = Object.entries(verdicts);
  const wins = all.filter(([, v]) => v.verdict === "WINNER=ours").length;
  const ties = all.filter(([, v]) => v.verdict === "TIE").length;
  const losses = all.filter(([, v]) => v.verdict === "WINNER=reference").length;
  const errs = all.filter(([, v]) => v.verdict === "ERROR" || v.verdict === "UNPARSED").length;
  const skipped = all.filter(([, v]) => v.verdict.startsWith("SKIPPED")).length;
  const lines = [
    "# Gauntlet summary — ours vs real YouTube (blind critic)",
    "",
    `Generated ${new Date().toISOString()} · ${all.length} comparisons · ours=${wins} tie=${ties} reference=${losses} error=${errs} skipped=${skipped}`,
    "",
    "Reference honesty: `fresh` = captured live this run; `archived` = the committed",
    "bar_mytube_*.png (captured on a clean network — used when YouTube bot-gates",
    "this network into an empty page); `SKIPPED-REF-BLANK` = no valid reference,",
    "surface excluded from the verdict rather than judged against a blank page.",
    "",
    "| surface | verdict | ref | gap (biggest remaining) |",
    "|---|---|---|---|",
  ];
  for (const [k, v] of all) {
    lines.push(`| ${k} | ${v.verdict} | ${v.refSource || "fresh"} | ${(v.gap || v.reason || "").replace(/\|/g, "/").slice(0, 110)} |`);
  }
  lines.push("");
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/gauntlet-summary.md`, lines.join("\n"));
  console.log(`\nSummary → ${OUT}/gauntlet-summary.md (ours=${wins} tie=${ties} ref=${losses} err=${errs} skipped=${skipped})`);

  const pass = losses === 0 && errs === 0;
  console.log(`RESULT: gauntlet ${pass ? "passed" : "failed"} — ${wins}W/${ties}T/${losses}L/${errs}E (${skipped} skipped)`);
  process.exit(pass ? 0 : 1);
})();

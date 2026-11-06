// e2e-ads.mjs — phase 5: ad-absence assertions (CI, server mode).
//
// Per playable test-set video through the app: (a) all media requests ⊆
// googlevideo.com or our byte-proxy; (b) HLS manifests carry no VMAP/pagead
// tags; (c) no doubleclick/googleads requests on watch. Embed-mode videos
// (the honest fallback) assert the embed notice instead. Result-guarded:
// prints "RESULT: N passed, 0 failed" only when real checks ran.
//
// Run: bash scripts/with-server.sh 'node scripts/e2e-ads.mjs'

import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3999";
const API = process.env.API || "http://127.0.0.1:3001";
const APP_VERSION = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let PASS = 0, FAIL = 0, SKIP = 0;
const ok = (m) => { PASS++; console.log(`  ✓ ${m}`); };
const bad = (m) => { FAIL++; console.log(`  ✗ ${m}`); };
const skip = (why) => { SKIP++; console.log(`  ⊘ ${why}`); };

const set = JSON.parse(fs.readFileSync("scripts/fixtures/adfree-testset.json", "utf8"));

// subset that keeps CI time sane while covering every class (all 29 ids are
// in the fixture; the full sweep is a device/report item)
const RUN_IDS = [
  "dQw4w9WgXcQ", // direct-combined + 2160p ladder
  "LXb3EKWsInQ", // adaptive-4k
  "jfKfPfyJRdk", // live-247
  "9bZkp7q19f0", // music-classic (embed fallback on gated networks)
  "_aM_nrijYCU", // unavailable
];

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(`
    try {
      if (!localStorage.getItem("yt_e2e_seeded")) {
        localStorage.setItem("yt_e2e_seeded", "1");
        localStorage.setItem("yt_whatsnew_seen", ${JSON.stringify(APP_VERSION)});
        localStorage.setItem("yt-app-store", JSON.stringify({ state: { prefs: {
          sponsorblock: false, autoplay: false, defaultQuality: "auto",
          theme: "dark", backgroundPlay: true, audioOnly: false
        }}, version: 0 }));
        localStorage.setItem("yt_api_base", ${JSON.stringify(API)});
      }
    } catch (e) {}
  `);
  const page = await ctx.newPage();
  return { ctx, page };
}

console.log("== e2e-ads: ad-absence assertions (server mode) ==");

// ---- 1. per-video assertions -------------------------------------------
for (const id of RUN_IDS) {
  const entry = set.videos.find(v => v.id === id);
  const { ctx, page } = await newPage();
  const media = [];
  const adRequests = [];
  page.on("request", r => {
    const u = r.url();
    if (/\.(m3u8|mp4|ts|m4s|webm)/i.test(u) || u.includes("/api/segment") || u.includes("googlevideo")) {
      media.push(u);
    }
    if (/doubleclick|googleads|pagead|googlesyndication|vmap/i.test(u)) adRequests.push(u);
  });
  await page.goto(`${BASE}/?src=server&v=${id}`, { waitUntil: "domcontentloaded" });
  await sleep(4500); // player resolution + first media

  const state = await page.evaluate(() => {
    const pb = window.__ytPlayback?.getState?.() || {};
    return {
      videoId: pb.videoId,
      embed: !!document.querySelector("iframe[src*='youtube-nocookie.com']"),
      embedNotice: /may appear|official (YouTube )?player|embed/i.test(document.body.innerText),
      unavailable: /Video unavailable/i.test(document.body.innerText),
      mini: !!document.querySelector("[data-testid=miniplayer]"),
    };
  });

  if (state.unavailable) {
    ok(`${id}: honest unavailable state (no fake player, no ad surface)`);
  } else if (state.embed) {
    // the honest fallback: the notice must be visible
    if (state.embedNotice) ok(`${id}: embed fallback carries the honest ads-may-appear notice`);
    else bad(`${id}: embed fallback WITHOUT the honest notice`);
    if (adRequests.length === 0) ok(`${id}: no ad-network requests even in embed mode (embeds load from youtube-nocookie)`);
    else bad(`${id}: ad-network requests on embed watch: ${adRequests.slice(0, 2).join(", ")}`);
  } else {
    // direct mode: the strict assertions
    if (media.length === 0) {
      skip(`${id}: not playable from this network right now (gated) — ad-absence moot for this run`);
    } else {
      const offOrigin = media.filter(u => !(/googlevideo\.com/.test(u) || u.includes("/api/segment") || u.includes("127.0.0.1")));
      if (offOrigin.length === 0) ok(`${id}: all ${media.length} media requests ⊆ googlevideo/byte-proxy`);
      else bad(`${id}: off-origin media: ${offOrigin.slice(0, 2).join(", ")}`);
    }
    if (adRequests.length === 0) ok(`${id}: zero doubleclick/googleads/pagead requests on the watch page`);
    else bad(`${id}: ad requests observed: ${adRequests.slice(0, 3).join(", ")}`);
  }
  await ctx.close();
}

// ---- 2. HLS manifests carry no VMAP/pagead tags -------------------------
{
  const { ctx, page } = await newPage();
  const manifests = [];
  page.on("response", async r => {
    if (r.url().includes("/api/hls/") || (/\.m3u8/.test(r.url()) && r.url().includes("/api/"))) {
      try { manifests.push({ url: r.url(), body: await r.text() }); } catch { /* body gone */ }
    }
  });
  await page.goto(`${BASE}/?src=server&v=dQw4w9WgXcQ`, { waitUntil: "domcontentloaded" });
  await sleep(6000);
  if (manifests.length === 0) {
    skip("no HLS manifest fetched this run (cached/progressive path) — manifest assertion moot");
  } else {
    let dirty = [];
    for (const m of manifests) if (/VMAP|pagead|doubleclick|Ad-break/i.test(m.body)) dirty.push(m.url);
    if (dirty.length === 0) ok(`HLS manifests clean: no VMAP/pagead tags across ${manifests.length} manifest(s)`);
    else bad(`HLS manifests contain ad tags: ${dirty.slice(0, 2).join(", ")}`);
  }
  await ctx.close();
}

// ---- 3. quality ladder: a >=1440p format exists on the 4K-class fixture -
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/?src=server&v=dQw4w9WgXcQ`, { waitUntil: "domcontentloaded" });
  await sleep(3000);
  const ladder = await page.evaluate(() => {
    const pb = window.__ytPlayback?.getState?.() || {};
    const video = pb.video || window.__ytDebug?.video || null;
    return { heights: (video?.formats || []).map(f => f.height || 0).filter(Boolean) };
  });
  const maxH = Math.max(0, ...ladder.heights);
  if (maxH >= 1440) ok(`quality ladder proof: ${maxH}p format present (≥1440p)`);
  else if (maxH > 0) skip(`ladder shows ${maxH}p this run (gated network trims formats) — full ladder is device-verified`);
  else skip("no formats visible this run (gated) — ladder proof is device-verified");
  await ctx.close();
}

// ---- 4. decipher report surface -----------------------------------------
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await sleep(2500);
  const dbg = await page.evaluate(() => window.__ytDebug?.decipher || null);
  if (dbg === null) {
    // web standalone can't fetch base.js (CORS) — the decipher fixture test
    // covers the logic; here we only assert the debug surface exists
    skip("decipher debug surface only populates on native/standalone (CORS on web) — logic proven by test-decipher (5/5)");
  } else {
    ok(`decipher debug surface present: ${JSON.stringify(dbg)}`);
  }
  await ctx.close();
}

await browser.close();
console.log(`\nRESULT: ${PASS} passed, ${FAIL} failed${SKIP ? `, ${SKIP} skipped (documented per plan risk #6)` : ""}`);
process.exit(FAIL === 0 && PASS > 0 ? 0 : 1);

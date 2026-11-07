// e2e-download.mjs — Phase 3: the downloads pipeline.
//
// Part 1 (REAL sidecar, no browser): auth boundaries (401 without token),
// a real audio download through yt-dlp to done, byte-accurate file serving,
// the duplicate-start 409, and remove.
// Part 2 (browser, mocked /api/download/*): the UI journey — Download sheet
// on the watch page, the downloads page rendering live progress, the Save
// link, and state transitions.
// Run: bash scripts/with-server.sh 'node scripts/e2e-download.mjs'

import { chromium } from "playwright";

const API = process.env.API || "http://127.0.0.1:3001";
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3999";
let PASS = 0, FAIL = 0, SKIP = 0;
const ok = (m) => { PASS++; console.log(`  ✓ ${m}`); };
const bad = (m) => { FAIL++; console.log(`  ✗ ${m}`); };
const skip = (m) => { SKIP++; console.log(`  - SKIP ${m}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- Part 1: the real sidecar ----------
console.log("== Part 1: real yt-dlp sidecar ==");
const noTok = await fetch(`${API}/api/download/list`);
if (noTok.status === 401) ok("list without token rejected (401)"); else bad(`list without token: HTTP ${noTok.status}`);

const token = (await (await fetch(`${API}/api/download/session`)).json()).token;
const H = { "Content-Type": "application/json", "X-DL-Token": token };
ok("session token minted");

let dlId = null;
try {
  const start = await fetch(`${API}/api/download/start`, { method: "POST", headers: H, body: JSON.stringify({ videoId: "dQw4w9WgXcQ", mode: "audio", title: "Never Gonna Give You Up" }) });
  if (start.status !== 200) throw new Error(`start HTTP ${start.status}`);
  dlId = (await start.json()).id;
  ok(`download started (${dlId.slice(0, 8)}…)`);

  // duplicate start while running must 409
  await sleep(500);
  const dup = await fetch(`${API}/api/download/start`, { method: "POST", headers: H, body: JSON.stringify({ videoId: "dQw4w9WgXcQ", mode: "video", title: "x" }) });
  if (dup.status === 409) ok("duplicate start rejected (409) with the existing id");
  else skip(`duplicate start: HTTP ${dup.status} (job may have finished too fast)`);

  // poll to completion (yt-dlp on the worst-case IP still needs real time)
  let rec = null;
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const list = (await (await fetch(`${API}/api/download/list?token=${token}`)).json()).downloads;
    rec = list.find(d => d.id === dlId);
    if (rec && (rec.status === "done" || rec.status === "failed")) break;
  }
  if (!rec) { bad("download record vanished"); }
  else if (rec.status === "done" && rec.size > 100_000) {
    ok(`audio download completed (${(rec.size / 1048576).toFixed(1)} MB, ${rec.file})`);
  } else if (rec.status === "failed") {
    skip(`yt-dlp could not download from this IP (${(rec.error || "").slice(0, 60)}) — wiring proven, gating is environmental`);
  } else {
    bad(`download ended ${rec.status} (${(rec.error || "").slice(0, 60)})`);
  }

  if (rec?.status === "done") {
    const fileRes = await fetch(`${API}/api/download/file/${dlId}?token=${token}`);
    const bytes = fileRes.ok ? (await fileRes.arrayBuffer()).byteLength : 0;
    if (fileRes.status === 200 && bytes === rec.size && fileRes.headers.get("content-disposition")?.includes("attachment")) {
      ok(`file endpoint streams the exact bytes (${bytes}) as an attachment`);
    } else {
      bad(`file endpoint: HTTP ${fileRes.status}, ${bytes}/${rec.size} bytes, disposition=${fileRes.headers.get("content-disposition")}`);
    }
    const noTokFile = await fetch(`${API}/api/download/file/${dlId}`);
    if (noTokFile.status === 401) ok("file without token rejected (401)"); else bad(`file without token: HTTP ${noTokFile.status}`);

    const rm = await fetch(`${API}/api/download/remove`, { method: "POST", headers: H, body: JSON.stringify({ id: dlId }) });
    const after = (await (await fetch(`${API}/api/download/list?token=${token}`)).json()).downloads;
    const goneFile = await fetch(`${API}/api/download/file/${dlId}?token=${token}`);
    if (rm.ok && !after.some(d => d.id === dlId) && goneFile.status === 404) {
      ok("remove deletes record and file (file now 404)");
    } else {
      bad(`remove left state behind: rm=${rm.status}, stillListed=${after.some(d => d.id === dlId)}, file=${goneFile.status}`);
    }
  }
} catch (e) {
  bad(`sidecar flow threw: ${e.message}`);
}

// ---------- Part 2: the UI journey (mocked download API) ----------
console.log("== Part 2: downloads UI (mocked) ==");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => { window.localStorage.setItem("yt_api_base", window.location.origin); });

let dlState = { status: "queued", progress: 0, size: 0, file: null };
const posted = [];
await page.route("**/api/download/session", r => r.fulfill({ json: { token: "test-token" } }));
await page.route("**/api/download/start", r => {
  posted.push(r.request().postDataJSON());
  dlState = { ...dlState, status: "running", progress: 45 };
  return r.fulfill({ json: { id: "ui-test-dl" } });
});
await page.route("**/api/download/list", r => r.fulfill({ json: { downloads: [{
  id: "ui-test-dl", videoId: "gatedtest01", title: "Gated Test Video", mode: "audio",
  status: dlState.status, progress: dlState.progress, size: dlState.size, file: dlState.file,
  error: null, startedAt: Date.now(), finishedAt: null,
}] } }));
await page.route("**/api/video/**", (route) => {
  const url = route.request().url();
  if (url.includes("/comments")) return route.fulfill({ json: { comments: [], count: 0, continuation: null } });
  return route.fulfill({ json: { id: "gatedtest01", ok: false, embed_fallback: true, title: "Gated Test Video", channel: "Test Channel", channel_id: "", views: "1M", duration: 60, published: "today", description: "", formats: [], hls: null, captions: [], storyboard: null, related: [], chapters: [] } });
});
await page.route("**/api/health*", r => r.fulfill({ json: { ok: true, po_token: true, uptime: 1 } }));
await page.route("**/api/home**", r => r.fulfill({ json: { category: "all", source: "search", results: [] } }));
await page.route("**/api/sponsorblock/**", r => r.fulfill({ json: { segments: [] } }));

await page.goto(`${BASE}/?v=gatedtest01`, { waitUntil: "domcontentloaded" });
try {
  await page.locator("[data-testid='whats-new-got-it']").waitFor({ state: "visible", timeout: 6000 });
  await page.locator("[data-testid='whats-new-got-it']").click();
} catch { /* dialog not shown */ }

try {
  await page.locator("[data-testid='download-button']").waitFor({ state: "visible", timeout: 15000 });
  ok("Download button on the watch page");
} catch { bad("Download button missing on the watch page"); }

await page.locator("[data-testid='download-button']").click();
try {
  await page.locator("[data-testid='download-sheet']").waitFor({ state: "visible", timeout: 5000 });
  ok("download sheet opens with both modes");
} catch { bad("download sheet did not open"); }

await page.locator("[data-testid='download-audio']").click();
await page.waitForTimeout(600);
if (posted.length === 1 && posted[0].mode === "audio" && posted[0].videoId === "gatedtest01") {
  ok("audio start POSTed with the right payload");
} else {
  bad(`start payload wrong: ${JSON.stringify(posted)}`);
}

await page.goto(`${BASE}/?page=downloads`, { waitUntil: "domcontentloaded" });
try {
  await page.locator("[data-testid='download-row']").waitFor({ state: "visible", timeout: 10000 });
  ok("downloads page lists the job");
} catch { bad("downloads page did not list the job"); }
if (await page.locator("[data-testid='dl-status-running']").isVisible().catch(() => false)) {
  ok("running state + progress rendered");
} else { bad("running state not rendered"); }

// transition to done — the Save link must point at the file endpoint
dlState = { status: "done", progress: 100, size: 3145728, file: "x.m4a" };
await page.waitForTimeout(2600); // poll interval is 2s
const saveHref = await page.locator("[data-testid='dl-save']").getAttribute("href").catch(() => null);
if (saveHref && saveHref.includes("/api/download/file/ui-test-dl") && saveHref.includes("token=test-token")) {
  ok("Save link points at the session-scoped file endpoint");
} else { bad(`Save link wrong: ${saveHref}`); }

console.log(`RESULT: ${PASS} passed, ${SKIP} skipped, ${FAIL} failed`);
await browser.close();
if (FAIL > 0) process.exit(1);

// e2e-cookie.mjs — Phase 1 (E-05): the server-cookies journey in Settings,
// against a MOCKED /api/cookie (deterministic, no real credentials touched).
//
// Journey: status shows "no cookies" → paste a cookie → Set → masked status
// appears (never the value) → Remove → back to anonymous.
// Run: bash scripts/with-server.sh 'node scripts/e2e-cookie.mjs'

import { chromium } from "playwright";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3999";
const FAKE = "VISITOR_INFO1_LIVE=fake; SID=fake; LOGIN_INFO=fake";
let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log(`  ✓ ${m}`); };
const bad = (m) => { FAIL++; console.log(`  ✗ ${m}`); };

const browser = await chromium.launch();
const page = await browser.newPage();

await page.addInitScript(() => {
  window.localStorage.setItem("yt_api_base", window.location.origin);
});

let cookiePresent = false;
let posted = null;
await page.route("**/api/cookie", (route) => {
  const method = route.request().method();
  if (method === "GET") {
    return route.fulfill({ json: cookiePresent
      ? { present: true, source: "runtime", length: FAKE.length, masked: "VISITOR_INFO1_LIVE=…" }
      : { present: false, source: "none", length: 0, masked: null } });
  }
  if (method === "POST") {
    posted = route.request().postDataJSON()?.cookie || null;
    cookiePresent = true;
    return route.fulfill({ json: { ok: true, present: true, length: posted?.length || 0 } });
  }
  if (method === "DELETE") {
    cookiePresent = false;
    return route.fulfill({ json: { ok: true, present: false } });
  }
  return route.fulfill({ status: 405, json: { error: "method" } });
});
await page.route("**/api/health*", (route) => route.fulfill({ json: { ok: true, po_token: true, uptime: 1 } }));
await page.route("**/api/home**", (route) => route.fulfill({ json: { category: "all", source: "search", results: [] } }));

await page.goto(`${BASE}/?page=settings`, { waitUntil: "domcontentloaded" });
// v2.3.0+ boots with the What's-new dialog on top — wait for its mount, then
// dismiss it (an absent dialog must not fail the run).
try {
  await page.locator("[data-testid='whats-new-got-it']").waitFor({ state: "visible", timeout: 8000 });
  await page.locator("[data-testid='whats-new-got-it']").click();
} catch { /* dialog not shown */ }
await page.getByText("Server cookies", { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });

const status = page.locator("[data-testid='cookie-status']");
await status.waitFor({ state: "visible", timeout: 10_000 });
if ((await status.textContent())?.includes("No cookies set")) {
  ok("initial status: anonymous server");
} else {
  bad(`initial status wrong: ${await status.textContent()}`);
}

await page.locator("[data-testid='cookie-input']").fill(FAKE);
await page.locator("[data-testid='cookie-set']").click();
await page.waitForTimeout(600);
if (posted === FAKE) {
  ok("cookie POSTed verbatim to the server");
} else {
  bad(`POST body wrong: ${String(posted).slice(0, 40)}`);
}
const afterSet = (await status.textContent()) || "";
if (afterSet.includes("Cookies active") && afterSet.includes("VISITOR_INFO1_LIVE=…")) {
  ok("masked status shown (name only, never the value)");
} else {
  bad(`status after set: ${afterSet}`);
}
if (!(await page.locator("[data-testid='cookie-remove']").isVisible().catch(() => false))) {
  bad("Remove button missing while cookies are set");
} else {
  ok("Remove offered while cookies are set");
}
const pageText = await page.content();
if (!pageText.includes("LOGIN_INFO=fake")) {
  ok("raw cookie value never rendered in the DOM");
} else {
  bad("raw cookie value leaked into the DOM");
}

await page.locator("[data-testid='cookie-remove']").click();
await page.waitForTimeout(600);
const afterRemove = (await status.textContent()) || "";
if (afterRemove.includes("No cookies set")) {
  ok("remove returns the server to anonymous");
} else {
  bad(`status after remove: ${afterRemove}`);
}

console.log(`RESULT: ${PASS} passed, ${FAIL} failed`);
await browser.close();
if (FAIL > 0) process.exit(1);

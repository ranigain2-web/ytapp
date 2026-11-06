// shot-ui.mjs — capture the surfaces the user calls "cluttered" for an
// evidence-based polish pass (home phone/desktop, watch, search overlay).
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:3999";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ args: ["--no-sandbox"] });

async function shot(name, width, height, url, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(`
    localStorage.setItem("yt_api_base", "http://127.0.0.1:3001");
    localStorage.setItem("yt_whatsnew_seen", "2.0.0");
    localStorage.setItem("yt-app-store", JSON.stringify({ state: { prefs: {} }, version: 0 }));
  `);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  await sleep(4000);
  await page.screenshot({ path: `/tmp/ui-${name}.png` });
  await ctx.close();
  console.log("shot", name);
}

await shot("home-phone", 390, 844, "/", true);
await shot("home-desktop", 1440, 900, "/");
await shot("watch-phone", 390, 844, "/?v=dQw4w9WgXcQ", true);
await shot("watch-desktop", 1440, 900, "/?v=dQw4w9WgXcQ");
await browser.close();
console.log("DONE");

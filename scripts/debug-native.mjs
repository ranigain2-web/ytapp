// debug-native.mjs — Compat Mode mount diagnostics against the fixed fake
// bridge (private __impls dispatch; see e2e-compat.mjs for the documented
// fake). Throwaway tool for the Phase 2 loop investigation.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("EXC " + String(e).slice(0, 150)));
page.on("console", (m) => { if (m.type() === "error") errs.push("ERR " + m.text().slice(0, 150)); });

await page.addInitScript(() => {
  const listeners = {};
  window.__compatLog = { opens: [], execs: [], bgEnabled: 0, bgUpdates: [], closed: 0 };
  const log = window.__compatLog;
  const promiseMethods = (names) => names.map(n => ({ name: n, rtype: "promise" }));
  window.androidBridge = {};
  // Private dispatch table — NEVER Capacitor.Plugins (registerPlugin replaces
  // those with proxies and a Plugins-dispatch self-recurses).
  window.__impls = {
    YtCompat: {
      open: (o) => { log.opens.push(o); return Promise.resolve(); },
      execute: (o) => { log.execs.push(o.js); return Promise.resolve({ value: "ok" }); },
      close: () => { log.closed++; return Promise.resolve(); },
      removeAllListeners: () => Promise.resolve(),
    },
    YtBackground: {
      enable: () => { log.bgEnabled++; return Promise.resolve(); },
      update: (o) => { log.bgUpdates.push(o); return Promise.resolve(); },
      disable: () => Promise.resolve(),
      setPipOnHome: () => Promise.resolve(),
      keepAwake: () => Promise.resolve(),
      enterPip: () => Promise.resolve(),
      removeAllListeners: () => Promise.resolve(),
    },
  };
  window.Capacitor = {
    PluginHeaders: [
      { name: "YtCompat", methods: [...promiseMethods(["open", "execute", "close", "removeAllListeners"]), { name: "addListener", rtype: "callback" }] },
      { name: "YtBackground", methods: [...promiseMethods(["enable", "update", "disable", "keepAwake", "enterPip", "setPipOnHome", "removeAllListeners"]), { name: "addListener", rtype: "callback" }] },
    ],
    nativePromise: (plugin, method, options) => {
      const impl = window.__impls[plugin] && window.__impls[plugin][method];
      return impl ? impl(options) : Promise.reject(new Error("not faked: " + plugin + "." + method));
    },
    nativeCallback: (plugin, method, options, cb) => {
      if (method === "addListener") {
        const key = plugin + ":" + (options && options.eventName);
        (listeners[key] = listeners[key] || []).push(cb);
      }
      return { remove: () => {} };
    },
    Plugins: {},
  };
  window.__fireCompat = (m) => (listeners["YtCompat:message"] || []).forEach(cb => cb(m));
  window.__fireControl = (e) => (listeners["YtBackground:control"] || []).forEach(cb => cb(e));
  window.localStorage.setItem("yt_api_base", window.location.origin);
});

await page.route("**/api/video/**", (route) => {
  const url = route.request().url();
  if (url.includes("/comments")) return route.fulfill({ json: { comments: [], count: 0, continuation: null } });
  return route.fulfill({ json: { id: "gatedtest01", ok: false, embed_fallback: true, title: "Gated Test Video", channel: "Test Channel", channel_id: "", views: "1M", duration: 60, published: "today", description: "", formats: [], hls: null, captions: [], storyboard: null, related: [], chapters: [] } });
});
await page.route("**/api/health*", (r) => r.fulfill({ json: { ok: true, po_token: true, uptime: 1 } }));
await page.route("**/api/home**", (r) => r.fulfill({ json: { category: "all", source: "search", results: [] } }));
await page.route("**/api/sponsorblock/**", (r) => r.fulfill({ json: { segments: [] } }));
await page.route("**/api/cookie", (route) => {
  if (route.request().method() === "POST") return route.fulfill({ json: { ok: true, present: true, length: 40 } });
  return route.fulfill({ json: { present: false, source: "none", length: 0, masked: null } });
});

await page.goto("http://127.0.0.1:3999/?page=compat&id=gatedtest01", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000).catch(() => {});
const diag = await page.evaluate(() => ({
  opens: (window.__compatLog || { opens: [] }).opens.length,
  openUrl: ((window.__compatLog || { opens: [{}] }).opens[0] || {}).url || null,
  bgEnabled: (window.__compatLog || {}).bgEnabled,
  compatPage: !!document.querySelector("[data-testid='compat-page']"),
  status: (document.querySelector("[data-testid='compat-status']") || {}).textContent || null,
  compatText: (document.querySelector("[data-testid='compat-page']") || { innerText: "" }).innerText.slice(0, 220),
})).catch(e => ({ dead: String(e).slice(0, 60) }));
console.log("DIAG:", JSON.stringify(diag).slice(0, 500));
console.log("ERRORS:", errs.slice(0, 4));
await browser.close();

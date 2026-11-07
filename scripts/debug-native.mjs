import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
page.on("console", (m) => { const t = m.text(); if (t.startsWith("DBG")) console.log(t); else if (m.type() === "error") errs.push("C:" + t.slice(0, 150)); });
await page.addInitScript(() => {
  const listeners = {};
  const promiseMethods = (names) => names.map(n => ({ name: n, rtype: "promise" }));
  window.androidBridge = {};
  window.Capacitor = {
    PluginHeaders: [
      { name: "YtCompat", methods: [...promiseMethods(["open", "execute", "close", "removeAllListeners"]), { name: "addListener", rtype: "callback" }] },
      { name: "YtBackground", methods: [...promiseMethods(["enable", "update", "disable", "keepAwake", "enterPip", "setPipOnHome", "removeAllListeners"]), { name: "addListener", rtype: "callback" }] },
    ],
    nativePromise: (plugin, method, options) => {
      const impl = window.Capacitor.Plugins[plugin] && window.Capacitor.Plugins[plugin][method];
      return impl ? impl(options) : Promise.reject(new Error("not faked: " + plugin + "." + method));
    },
    nativeCallback: (plugin, method, options, cb) => {
      if (method === "addListener") {
        const key = plugin + ":" + (options && options.eventName);
        (listeners[key] = listeners[key] || []).push(cb);
      }
      return { remove: () => {} };
    },
    Plugins: {
      YtCompat: { open: () => Promise.resolve(), execute: () => Promise.resolve({ value: "ok" }), close: () => Promise.resolve(), removeAllListeners: () => Promise.resolve() },
      YtBackground: { enable: () => Promise.resolve(), update: () => Promise.resolve(), disable: () => Promise.resolve(), setPipOnHome: () => Promise.resolve(), keepAwake: () => Promise.resolve(), enterPip: () => Promise.resolve(), removeAllListeners: () => Promise.resolve() },
    },
  };
  window.__fireCompat = (m) => (listeners["YtCompat:message"] || []).forEach(cb => cb(m));
  window.localStorage.setItem("yt_api_base", window.location.origin);
  setInterval(() => { const d = window.__dbg; if (d) console.log("DBG renders=" + d.renders + " calls=" + d.calls + " vals=" + JSON.stringify(d.vals) + " pip=" + String(d.pipVal)); }, 500);
});
await page.route("**/api/video/**", (route) => {
  const url = route.request().url();
  if (url.includes("/comments")) return route.fulfill({ json: { comments: [], count: 0, continuation: null } });
  return route.fulfill({ json: { id: "gatedtest01", ok: false, embed_fallback: true, title: "Gated Test Video", channel: "Test Channel", channel_id: "", views: "1M", duration: 60, published: "today", description: "", formats: [], hls: null, captions: [], storyboard: null, related: [], chapters: [] } });
});
await page.route("**/api/health*", (r) => r.fulfill({ json: { ok: true, po_token: true, uptime: 1 } }));
await page.route("**/api/home**", (r) => r.fulfill({ json: { category: "all", source: "search", results: [] } }));
await page.route("**/api/sponsorblock/**", (r) => r.fulfill({ json: { segments: [] } }));
await page.goto("http://127.0.0.1:3999/?v=gatedtest01", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const info = await page.evaluate(() => ({
  platform: window.Capacitor?.getPlatform?.(),
  native: window.Capacitor?.isNativePlatform?.(),
  entry: document.querySelectorAll("[data-testid='compat-entry']").length,
  iframe: document.querySelectorAll("iframe").length,
  notice: document.body.innerText.includes("ads may appear"),
  bodySnippet: document.body.innerText.slice(0, 80),
})).catch(e => ({ crashed: String(e).slice(0, 80) }));
console.log("STATE:", JSON.stringify(info));
console.log("ERRORS:", errs.slice(0, 5));
await browser.close();

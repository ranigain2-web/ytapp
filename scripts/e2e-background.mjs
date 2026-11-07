// e2e-background.mjs — phase 8: background playback, end to end.
//
// The bar (docs/designs/background-play-everything.md): like YouTube's own
// app — audio continues on background, notification controls work, Next
// advances the queue, returning restores position. Proven here for four
// named scenarios, each in a fresh context with the Capacitor bridge mock
// (the same androidBridge simulation e2e-playback uses — it exercises the
// REAL yt-background proxy), real media bytes served locally (VP8/Opus so
// bundled Chromium can decode), a stub API whose shape is RECORDED from a
// real server response, and backgrounding emulated the way the app observes
// it (document.visibilityState + visibilitychange).
//
//   DIRECT        video with combined format → play, background, controls,
//                 Next, return-with-position
//   AUDIO-ONLY    only audio formats → poster+audio direct (not the embed),
//                 honest badge, background continuity
//   EMBED-RESCUE  embed fallback → background → handoff to the direct player
//                 at the embed's position (fake IFrame-API controller, as the
//                 EmbedController contract is duck-typed for exactly this)
//   EMBED-STUCK   embed fallback that never yields streams → background
//                 attempt fails honestly, embed stays, no double audio
//   EMBED-PIP     embed PLAYING pushes setEmbedActive to the plugin (Home
//                 can PiP it — the iframe cannot background), pausing
//                 releases eligibility, and an unextractable embed explains
//                 itself on return (embedBgNote) instead of dying silently
//
// Failure output dumps scenario id, step, bridge calls, video element state
// and store state — six months from now CI will still name the culprit.
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import fs from "node:fs";

const APP_VERSION = JSON.parse(readFileSync("package.json", "utf8")).version;
const BASE = "http://127.0.0.1:3999";
const STUB = "http://127.0.0.1:3998";
const MEDIA = { video: "/tmp/bgmedia-video.webm", audio: "/tmp/bgmedia-audio.webm" };
let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log(`  ✓ ${m}`); };
const bad = (m) => { FAIL++; console.log(`  ✗ ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// media: VP8/Opus WebM (bundled Chromium decodes these — not H.264/AAC).
// COMMITTED fixtures under scripts/fixtures/ so CI needs no system deps
// (the ubuntu runner image dropped ffmpeg — red run b387d84). The /tmp
// fallback regenerates via ffmpeg for local runs against a fresh sandbox;
// if neither exists the suite FAILS loudly — never a fake pass.
import { execSync as _execSync } from "node:child_process";
import { copyFileSync as _cp } from "node:fs";
const FIXDIR = "scripts/fixtures";
for (const [which, p] of [["video", MEDIA.video], ["audio", MEDIA.audio]]) {
  const committed = `${FIXDIR}/bgmedia-${which}.webm`;
  if (!existsSync(p)) {
    if (existsSync(committed)) _cp(committed, p);
    else {
      try {
        if (which === "video") _execSync(`ffmpeg -y -loglevel error -f lavfi -i "testsrc=size=320x180:rate=15:duration=62" -f lavfi -i "sine=frequency=440:duration=62" -c:v libvpx -b:v 150k -c:a libopus ${p}`);
        else _execSync(`ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=330:duration=62" -c:a libopus ${p}`);
      } catch (e) { console.error(`no ${p} and no ${committed} (ffmpeg missing) — cannot run without real media`); process.exit(2); }
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures — field-for-field the shape of the RECORDED real response
// (scripts/fixtures/bg-playback-real-response.json). The loader below asserts
// the invariant audio_only ⇔ formats.every(!has_video) so a lying fixture
// fails loudly instead of passing while production breaks.
// ---------------------------------------------------------------------------
const RELATED_NEXT = {
  id: "NEXT01", title: "Queue Next Video", channel: "Queue Channel", channel_id: "UCnext",
  duration: 60, views: "1K", published: "yesterday", thumb: "https://i.ytimg.com/vi/NEXT01/mqdefault.jpg",
  thumb_lg: "https://i.ytimg.com/vi/NEXT01/hqdefault.jpg", is_live: false, shorts: false,
};
const baseMeta = (id, title) => ({
  id, ok: true, embed_fallback: false,
  extracted_by: "IOS", audio_only: false, extract_ms: 1200,
  title, channel: "Test Channel", channel_id: "UCtest",
  channel_thumb: "", channel_subs: "1M subscribers",
  views: "1M views", likes: 1000, duration: 60, published: "today", description: "test",
  formats: [], hls: null, captions: [], storyboard: null,
  chapters: [], keywords: [], related: [RELATED_NEXT],
});
const videoFmt = (url) => ({
  itag: 18, mime: "video/mp4", url, quality_label: "360p", height: 180, width: 320,
  fps: 15, has_video: true, has_audio: true, bitrate: 300000, codecs: "vp8,opus", duration: 60,
});
const audioFmt = (url) => ({
  itag: 140, mime: "audio/mp4", url, quality_label: "tiny", height: 0, width: 0,
  fps: 0, has_video: false, has_audio: true, bitrate: 96000, codecs: "opus", duration: 60,
});

const FIXTURES = {
  DIRECT01: { ...baseMeta("DIRECT01", "Direct Background Video"), formats: [videoFmt(`${STUB}/media/video.webm`)] },
  NEXT01: { ...baseMeta("NEXT01", "Queue Next Video"), formats: [videoFmt(`${STUB}/media/video.webm`)] },
  AUDIO01: (() => { const f = { ...baseMeta("AUDIO01", "Audio Only Rescue Video"), formats: [audioFmt(`${STUB}/media/audio.webm`)] }; f.audio_only = true; f.extracted_by = "MWEB"; return f; })(),
};
// scenario fixtures whose responses depend on fresh-call counts
const freshCounts = { EMBED01: 0, EMBED02: 0, STUCK01: 0, EMBED03: 0 };
const embedPayload = (id) => ({
  ...baseMeta(id, `Embed ${id} Video`), ok: false, embed_fallback: true,
  extracted_by: "", audio_only: false, formats: [], related: [RELATED_NEXT],
});

// fixture invariants (anti-drift): must hold for every DIRECT payload
for (const [id, f] of Object.entries(FIXTURES)) {
  const derivedAudioOnly = f.formats.length > 0 && f.formats.every((x) => x.has_audio && !x.has_video);
  if (f.audio_only !== derivedAudioOnly) { console.error(`fixture ${id}: audio_only (${f.audio_only}) disagrees with the format list`); process.exit(2); }
}

// ---------------------------------------------------------------------------
// Stub API + media server (in-process) — CORS open, Range-aware media
// ---------------------------------------------------------------------------
const stubHits = [];
const stubServer = http.createServer((req, res) => {
  const url = new URL(req.url, STUB);
  const send = (code, body, type = "application/json", extra = {}) => {
    res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", ...extra });
    res.end(body);
  };
  if (url.pathname.startsWith("/media/")) {
    const file = url.pathname === "/media/video.webm" ? MEDIA.video : MEDIA.audio;
    const stat = statSync(file);
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      res.writeHead(206, {
        "Content-Type": "video/webm", "Access-Control-Allow-Origin": "*",
        "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1,
      });
      createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": "video/webm", "Access-Control-Allow-Origin": "*", "Content-Length": stat.size, "Accept-Ranges": "bytes" });
      createReadStream(file).pipe(res);
    }
    return;
  }
  const videoMatch = /^\/api\/video\/([\w-]+)/.exec(url.pathname);
  if (videoMatch && !url.pathname.includes("/comments")) {
    const id = videoMatch[1];
    const fresh = url.searchParams.get("fresh") === "1";
    stubHits.push({ id, fresh });
    let payload;
    if (id === "EMBED01" || id === "EMBED02") {
      if (fresh) {
        freshCounts[id]++;
        // fresh #1 = WatchPage's load-time retry (fails); fresh #2 = the
        // background handoff (succeeds) — mirrors a PO token coming online.
        // EMBED02 (scenario 5) has its own counter so scenarios are isolated.
        payload = freshCounts[id] >= 2
          ? { ...baseMeta(id, `Embed ${id} Video`), formats: [videoFmt(`${STUB}/media/video.webm`)] }
          : embedPayload(id);
      } else payload = embedPayload(id);
    } else if (id === "STUCK01" || id === "EMBED03") {
      if (fresh) freshCounts[id]++;
      payload = embedPayload(id);
    } else {
      payload = FIXTURES[id] || embedPayload(id);
    }
    return send(200, JSON.stringify(payload));
  }
  if (url.pathname.endsWith("/comments")) return send(200, JSON.stringify({ comments: [], count: 0, continuation: null }));
  // fake YouTube IFrame API: the production loader (yt-embed-api.ts) fetches
  // this when __YT_API_BASE points at the stub. YT.Player keeps a live
  // registry so the test can drive the SAME instance the app created —
  // this exercises the REAL registration path (YT.Player → onStateChange →
  // registerEmbedController), not a hand-rolled controller.
  if (url.pathname === "/iframe_api") {
    const js = `
      (function () {
        window.YT = window.YT || {};
        window.YT.PlayerState = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
        window.__ytPlayers = [];
        window.YT.Player = function (el, opts) {
          this.__el = el;
          this.__opts = opts;
          this.__state = 1; // PLAYING
          this.__pos = 42; // mid-video, like the EMBED-RESCUE scenario
          window.__ytPlayers.push(this);
          // async-ready like the real API
          if (window.onYouTubeIframeAPIReady) setTimeout(window.onYouTubeIframeAPIReady, 0);
        };
        window.YT.Player.prototype.destroy = function () { this.__destroyed = true; };
        window.YT.Player.prototype.getCurrentTime = function () { return this.__pos; };
        window.YT.Player.prototype.getDuration = function () { return 60; };
        window.YT.Player.prototype.getPlayerState = function () { return this.__state; };
        window.YT.Player.prototype.pauseVideo = function () {
          this.__state = 2;
          if (this.__opts && this.__opts.events && this.__opts.events.onStateChange) {
            this.__opts.events.onStateChange({ data: 2 });
          }
        };
        window.YT.Player.prototype.playVideo = function () { this.__state = 1; };
        window.YT.Player.prototype.seekTo = function (s) { this.__pos = s; };
        if (window.onYouTubeIframeAPIReady) setTimeout(window.onYouTubeIframeAPIReady, 0);
      })();
    `;
    return send(200, js, "text/javascript");
  }
  if (url.pathname === "/api/health") {
    return send(200, JSON.stringify({ ok: true, po_token: true, pot_reachable: true, token_expires: null, sessions: 1, extract_stats: { ios: 1 }, cache_size: 0, hls_cache: 0, uptime: 1 }));
  }
  if (url.pathname === "/api/home") return send(200, JSON.stringify({ videos: [], categories: [], shorts: [] }));
  return send(200, JSON.stringify({ videos: [], results: [], shorts: [] }));
});

// ---------------------------------------------------------------------------
// Bridge mock — same semantics as e2e-playback.mjs (the REAL proxy path)
// ---------------------------------------------------------------------------
const initScript = `
  try {
    if (!localStorage.getItem("yt_e2e_seeded")) {
      localStorage.setItem("yt_e2e_seeded", "1");
      localStorage.setItem("yt_whatsnew_seen", ${JSON.stringify(APP_VERSION)});
      localStorage.setItem("yt-app-store", JSON.stringify({ state: { prefs: {
        sponsorblock: false, autoplay: false, defaultQuality: "auto",
        cinemaMode: false, theme: "dark", backgroundPlay: true, audioOnly: false
      }}, version: 0 }));
      localStorage.setItem("yt_api_base", ${JSON.stringify(STUB)});
    }
  } catch (e) {}
  (function () {
    window.__bgCalls = [];
    window.__bgListeners = [];
    window.__bgWarns = [];
    window.androidBridge = { postMessage: function () {} };
    window.Capacitor = {
      PluginHeaders: [
        { name: "YtBackground", methods: [
          { name: "enable", rtype: "promise" },
          { name: "update", rtype: "promise" },
          { name: "disable", rtype: "promise" },
          { name: "keepAwake", rtype: "promise" },
          { name: "enterPip", rtype: "promise" },
          { name: "setPipOnHome", rtype: "promise" },
          { name: "setEmbedActive", rtype: "promise" },
        ] },
      ],
      nativePromise: function (plugin, method, options) {
        window.__bgCalls.push([method, options || null]);
        return Promise.resolve({ callbackId: method + "-" + window.__bgCalls.length });
      },
      nativeCallback: function (plugin, method, options, cb) {
        window.__bgCalls.push([method, options || null]);
        if (method === "addListener" && cb) {
          window.__bgListeners.push(function (data) { cb(data); });
        }
        if (cb) cb({}, method + "-" + window.__bgCalls.length);
      },
      addListener: function (pluginName, eventName, callback) {
        window.__bgCalls.push(["addListener", { eventName: eventName }]);
        var fn = function (data) { callback(data); };
        window.__bgListeners.push(fn);
        return { remove: function () {
          var i = window.__bgListeners.indexOf(fn);
          if (i >= 0) window.__bgListeners.splice(i, 1);
          window.__bgCalls.push(["removeListener", { eventName: eventName }]);
        } };
      },
      removeListener: function () {},
    };
    window.__emitControl = function (data) {
      window.__bgListeners.forEach(function (fn) { fn(data); });
    };
  })();
`;

// backgrounding emulation: the app listens to visibilitychange on document
const goBackground = (page) => page.evaluate(() => {
  document.__hidden = true;
  Object.defineProperty(document, "visibilityState", { get: () => (document.__hidden ? "hidden" : "visible"), configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});
const goForeground = (page) => page.evaluate(() => {
  document.__hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
});

async function newPage(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  });
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "warning") page.__warns = [...(page.__warns || []), m.text()]; });
  // YouTube's iframe API + embed must not load in CI — scenarios register a
  // fake EmbedController instead (the contract is duck-typed for this)
  await ctx.route(/youtube\.com|ytimg\.com/, (route) => route.abort());
  return { ctx, page };
}

const dump = async (page, scenario, step) => {
  const state = await page.evaluate(() => {
    const v = document.querySelector("video");
    const pb = window.__ytPlayback?.getState?.();
    return {
      video: v ? { paused: v.paused, t: +v.currentTime.toFixed(1), ready: v.readyState, muted: v.muted, src: (v.currentSrc || v.src || "").slice(-40) } : null,
      store: pb ? { mode: pb.mode, videoId: pb.videoId, playing: pb.playing, startAt: pb.startAt, handoff: pb.handoffAttempts } : null,
      bgCalls: (window.__bgCalls || []).slice(-8),
      iframe: !!document.querySelector("iframe"),
      warns: (window.__bgWarns || page.__warns || []).slice?.(-3),
    };
  }).catch((e) => ({ error: String(e) }));
  console.log(`  DUMP [${scenario} / ${step}]`, JSON.stringify(state).slice(0, 700));
};
const check = async (page, scenario, step, fn, msg) => {
  try { if (await fn()) ok(msg); else { bad(msg); await dump(page, scenario, step); } }
  catch (e) { bad(`${msg} (threw: ${String(e).slice(0, 80)})`); await dump(page, scenario, step).catch(() => {}); }
};
const waitFor = (page, fn, timeout = 20000) => page.waitForFunction(fn, { timeout }).then(() => true).catch(() => false);

// ---------------------------------------------------------------------------
(async () => {
  await new Promise((r) => stubServer.listen(3998, "127.0.0.1", r));
  // serve the static build if nothing already owns :3999 (with-server.sh may
  // have left one up in CI); EADDRINUSE would otherwise hang the suite
  let staticProc = null;
  const up = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
  if (!up) {
    staticProc = spawn("node", ["scripts/serve-static.mjs", "out", "3999", STUB], { stdio: "ignore", detached: true });
    staticProc.unref();
  }
  await sleep(staticProc ? 1200 : 300);
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });

  // anti-drift: the fixture template's keys must be a subset of a real
  // server response's keys (recorded reference, committed with the suite)
  try {
    const real = JSON.parse(readFileSync("scripts/fixtures/bg-playback-real-response.json", "utf8"));
    const fixtureKeys = Object.keys(FIXTURES.DIRECT01);
    const missing = fixtureKeys.filter((k) => !(k in real));
    if (missing.length === 0) ok(`fixture shape matches the recorded real response (${fixtureKeys.length} fields)`);
    else bad(`fixture drift: fields not in real response: ${missing.join(", ")}`);
  } catch (e) { bad(`fixture reference unreadable: ${e.message}`); }

  // ===================== SCENARIO 1: DIRECT =====================
  console.log("== scenario DIRECT: play → background → controls → next → return ==");
  {
    const { ctx, page } = await newPage(browser);
    const S = "DIRECT";
    await page.goto(`${BASE}/?v=DIRECT01`, { waitUntil: "domcontentloaded" });
    await waitFor(page, () => { const v = document.querySelector("video"); return v && v.readyState >= 2 && v.currentTime > 0.3; }, 30000);
    await page.click("button:has-text('Tap to unmute')").catch(() => {});
    await sleep(1200);
    await check(page, S, "started", () => page.evaluate(() => { const v = document.querySelector("video"); return v && !v.paused && !v.muted && v.currentTime > 0.5; }), "video plays audibly in the foreground");
    await check(page, S, "bg-enabled", () => page.evaluate(() => window.__bgCalls.some((c) => c[0] === "enable")), "background service enabled at the start gesture");

    await goBackground(page);
    await sleep(2500);
    const tHidden = await page.evaluate(() => document.querySelector("video")?.currentTime || 0);
    await sleep(2000);
    await check(page, S, "still-playing", () => page.evaluate((t) => { const v = document.querySelector("video"); return v && !v.paused && v.currentTime > t + 0.5; }, tHidden), "audio KEEPS PLAYING while backgrounded");

    // notification pause → resume
    await page.evaluate(() => window.__emitControl({ action: "pause" }));
    await sleep(700);
    await check(page, S, "notif-pause", () => page.evaluate(() => document.querySelector("video")?.paused === true), "notification Pause pauses playback");
    await page.evaluate(() => window.__emitControl({ action: "play" }));
    await sleep(700);
    await check(page, S, "notif-resume", () => page.evaluate(() => { const v = document.querySelector("video"); return v && !v.paused; }), "notification Play resumes playback");

    // notification Next advances the queue
    await page.evaluate(() => window.__emitControl({ action: "next" }));
    await waitFor(page, () => window.__ytPlayback?.getState?.().videoId === "NEXT01", 25000);
    await check(page, S, "notif-next", () => page.evaluate(() => window.__ytPlayback?.getState?.().videoId === "NEXT01"), "notification Next advances the queue (NEXT01)");
    await waitFor(page, () => { const v = document.querySelector("video"); return v && v.readyState >= 2 && !v.paused && v.currentTime > 0.5; }, 25000);
    await check(page, S, "next-playing", () => page.evaluate(() => { const v = document.querySelector("video"); return v && !v.paused && v.currentTime > 0.5; }), "next video is playing (background continuity across tracks)");

    // return to the foreground: position continues, still playing
    const beforeReturn = await page.evaluate(() => document.querySelector("video")?.currentTime || 0);
    await goForeground(page);
    await sleep(1500);
    await check(page, S, "return", () => page.evaluate((b) => { const v = document.querySelector("video"); return v && !v.paused && v.currentTime >= b; }, beforeReturn), "return to app: same video, position preserved, still playing");
    await ctx.close();
  }

  // ===================== SCENARIO 2: AUDIO-ONLY =====================
  console.log("== scenario AUDIO-ONLY: audio-only streams → direct poster+audio, not the embed ==");
  {
    const { ctx, page } = await newPage(browser);
    const S = "AUDIO-ONLY";
    await page.goto(`${BASE}/?v=AUDIO01`, { waitUntil: "domcontentloaded" });
    await waitFor(page, () => { const v = document.querySelector("video"); return v && v.src.includes("audio") && v.readyState >= 2; }, 30000);
    await page.click("button:has-text('Tap to unmute')").catch(() => {});
    await sleep(1000);
    await check(page, S, "audio-source", () => page.evaluate(() => { const v = document.querySelector("video"); return v && /audio\.webm/.test(v.src) && !v.paused; }), "audio-only format plays directly (no embed)");
    await check(page, S, "no-iframe", () => page.evaluate(() => !document.querySelector("iframe")), "no embed iframe for an audio-only video");
    await check(page, S, "honest-badge", () => page.evaluate(() => !!document.body.innerText.match(/Audio only/i) && !document.body.innerText.match(/data saver/)), "honest 'Audio only' badge (not the data-saver label)");

    await goBackground(page);
    const tHidden = await page.evaluate(() => document.querySelector("video")?.currentTime || 0);
    await sleep(2200);
    await check(page, S, "still-playing", () => page.evaluate((t) => { const v = document.querySelector("video"); return v && !v.paused && v.currentTime > t + 0.5; }, tHidden), "audio-only KEEPS PLAYING in the background");
    await check(page, S, "bg-enabled", () => page.evaluate(() => window.__bgCalls.some((c) => c[0] === "enable")), "background service enabled for the audio session");
    await ctx.close();
  }

  // ===================== SCENARIO 3: EMBED-RESCUE =====================
  console.log("== scenario EMBED-RESCUE: embed → background → handoff to direct at position ==");
  {
    const { ctx, page } = await newPage(browser);
    const S = "EMBED-RESCUE";
    await page.goto(`${BASE}/?v=EMBED01`, { waitUntil: "domcontentloaded" });
    await waitFor(page, () => window.__ytPlayback?.getState?.().mode === "embed", 30000);
    await check(page, S, "embed-active", () => page.evaluate(() => window.__ytPlayback?.getState?.().mode === "embed"), "video falls back to the embed (extraction failed at load)");
    await sleep(800);
    // register the fake IFrame-API controller (duck-typed contract)
    await page.evaluate(() => {
      window.__embedPaused = false;
      window.__ytPlayback.getState().registerEmbedController({
        getPosition: () => 42,
        getDuration: () => 60,
        getPlayerState: () => 1,
        pause: () => { window.__embedPaused = true; },
      });
    });
    // verify the load-time retry happened (fresh #1 failed) before backgrounding
    await check(page, S, "load-retry", () => stubHits.some((h) => h.id === "EMBED01" && h.fresh), "the load-time fresh retry fired (and failed) before the embed showed");

    await goBackground(page);
    await waitFor(page, () => window.__ytPlayback?.getState?.().mode === "direct" && !document.querySelector("video")?.paused, 30000);
    await check(page, S, "handoff", () => page.evaluate(() => window.__ytPlayback?.getState?.().mode === "direct"), "handoff moved the video onto the direct player while backgrounded");
    await check(page, S, "iframe-stopped", () => page.evaluate(() => window.__embedPaused === true), "the embed's audio was stopped (no double audio)");
    await check(page, S, "position", () => page.evaluate(() => { const t = document.querySelector("video")?.currentTime || 0; return t >= 40 && t <= 60; }), "playback resumed at the embed's position (~42s)");
    await check(page, S, "bg-session", () => page.evaluate(() => window.__bgCalls.some((c) => c[0] === "enable")), "background session enabled after the handoff");
    await check(page, S, "attempt-once", () => page.evaluate(() => window.__ytPlayback?.getState?.().handoffAttempts?.EMBED01?.outcome === "done"), "handoff attempt recorded as done (once per video)");
    await sleep(1200);
    await check(page, S, "playing", () => page.evaluate(() => { const v = document.querySelector("video"); return v && !v.paused && v.currentTime > 41; }), "audio playing in the background after the handoff");
    await goForeground(page);
    await sleep(1200);
    await check(page, S, "return", () => page.evaluate(() => { const v = document.querySelector("video"); return v && !v.paused && !document.querySelector("iframe"); }), "return: direct player still going, no iframe remount");
    await ctx.close();
  }

  // ===================== SCENARIO 4: EMBED-STUCK =====================
  console.log("== scenario EMBED-STUCK: extraction never yields → honest failure, no double audio ==");
  {
    const { ctx, page } = await newPage(browser);
    const S = "EMBED-STUCK";
    await page.goto(`${BASE}/?v=STUCK01`, { waitUntil: "domcontentloaded" });
    await waitFor(page, () => window.__ytPlayback?.getState?.().mode === "embed", 30000);
    await page.evaluate(() => {
      window.__ytPlayback.getState().registerEmbedController({
        getPosition: () => 5, getDuration: () => 60, getPlayerState: () => 1,
        pause: () => { window.__embedPaused = true; },
      });
    });
    await goBackground(page);
    await waitFor(page, () => window.__ytPlayback?.getState?.().handoffAttempts?.STUCK01?.outcome === "failed", 30000);
    await check(page, S, "failed-honestly", () => page.evaluate(() => window.__ytPlayback?.getState?.().handoffAttempts?.STUCK01?.outcome === "failed"), "handoff attempted once and recorded the failure");
    await check(page, S, "mode-embed", () => page.evaluate(() => window.__ytPlayback?.getState?.().mode === "embed"), "mode stays embed (nothing to hand off to)");
    await check(page, S, "no-double-audio", () => page.evaluate(() => { const v = document.querySelector("video"); return !v || v.paused; }), "direct player is NOT playing (no double audio)");
    await check(page, S, "warn-logged", () => (page.__warns || []).some((w) => /handoff failed/.test(w)), "failure is observable (console.warn '[playback] embed→direct handoff failed')");
    // second backgrounding: no second attempt (once per video)
    const freshBefore = stubHits.filter((h) => h.id === "STUCK01" && h.fresh).length;
    await goForeground(page); await sleep(300);
    await goBackground(page); await sleep(1500);
    const freshAfter = stubHits.filter((h) => h.id === "STUCK01" && h.fresh).length;
    if (freshAfter === freshBefore) ok("second backgrounding does NOT re-attempt (API amplification capped)");
    else bad(`second backgrounding re-attempted (${freshBefore}→${freshAfter} fresh calls) — cap broken`);
    await ctx.close();
  }

  // ===================== SCENARIO 4b: EMBED-PIP =====================
  // The reported bug (session 29): embed playing → minimize → NOTHING. Root
  // causes fixed here: (1) the embed never told the plugin it was eligible,
  // so the Home press could not PiP it; (2) when the handoff had nothing to
  // hand off to, the user got silence with no explanation.
  console.log("== scenario EMBED-PIP: embed playing → PiP eligibility + explained background failure ==");
  {
    const { ctx, page } = await newPage(browser);
    const S = "EMBED-PIP";
    await page.goto(`${BASE}/?v=EMBED03`, { waitUntil: "domcontentloaded" });
    await waitFor(page, () => window.__ytPlayback?.getState?.().mode === "embed", 30000);
    await sleep(600);
    // idle embed: eligibility must NOT be on
    await check(page, S, "idle-not-eligible", () => page.evaluate(() => !window.__bgCalls.some((c) => c[0] === "setEmbedActive" && c[1] && c[1].on === true)), "an embed that never played does not claim PiP eligibility");
    // IFrame-API state 1 (PLAYING) mirrors through the surface to the plugin
    await page.evaluate(() => window.__ytPlayback.getState().setEmbedPlaying(true));
    const eligible = await waitFor(page, () => window.__bgCalls.some((c) => c[0] === "setEmbedActive" && c[1] && c[1].on === true));
    await check(page, S, "playing-eligible", () => eligible, "embed PLAYING pushes setEmbedActive(on:true) — Home can PiP it (the iframe cannot background)");
    // pause releases eligibility (a paused embed must not capture Home)
    await page.evaluate(() => window.__ytPlayback.getState().setEmbedPlaying(false));
    const released = await waitFor(page, () => {
      const calls = window.__bgCalls.filter((c) => c[0] === "setEmbedActive");
      return calls.length >= 2 && calls[calls.length - 1][1] && calls[calls.length - 1][1].on === false;
    });
    await check(page, S, "pause-releases", () => released, "pausing the embed releases PiP eligibility");
    // backgrounding with nothing to hand off to: the failure is EXPLAINED
    await page.evaluate(() => {
      window.__embedPaused = false;
      window.__ytPlayback.getState().registerEmbedController({
        getPosition: () => 30, getDuration: () => 60, getPlayerState: () => 1,
        pause: () => { window.__embedPaused = true; },
      });
      window.__ytPlayback.getState().setEmbedPlaying(true);
    });
    await goBackground(page);
    const noteSet = await waitFor(page, () => !!window.__ytPlayback?.getState?.().embedBgNote, 30000);
    await check(page, S, "note-set", () => noteSet, "no extractable stream → embedBgNote set (not silent death)");
    await check(page, S, "no-fake-session", () => page.evaluate(() => !window.__bgCalls.some((c) => c[0] === "enable")), "no background session faked for an unextractable embed");
    await goForeground(page);
    const noteVisible = await waitFor(page, () => !!document.querySelector("[data-testid='embed-bg-note']"));
    await check(page, S, "note-visible", () => noteVisible, "returning shows the explanation under the player");
    // Dismiss clears it
    await page.click("[data-testid='embed-bg-note'] button[aria-label='Dismiss']");
    const noteCleared = await waitFor(page, () => !window.__ytPlayback?.getState?.().embedBgNote);
    await check(page, S, "note-dismiss", () => noteCleared, "Dismiss clears the note");
    await ctx.close();
  }

  // ===================== SCENARIO 5: PRODUCTION-API REGISTRATION =====================
  console.log("== scenario PRODUCTION-API: real registration path (yt-embed-api → YT.Player → controller) ==");
  {
    const { ctx, page } = await newPage(browser);
    const S = "PRODUCTION-API";
    // point the PRODUCTION loader at the fake API (same mechanism a dev
    // sandbox could use); youtube.com stays blocked for everything else
    await ctx.addInitScript(() => { window.__YT_API_BASE = "http://127.0.0.1:3998"; });
    await page.goto(`${BASE}/?v=EMBED02`, { waitUntil: "domcontentloaded" });
    // the app's own loader must fetch the fake API and construct a Player
    await waitFor(page, () => (window.__ytPlayers || []).length > 0, 30000);
    await check(page, S, "api-loaded", () => page.evaluate(() => (window.__ytPlayers || []).length > 0), "the production loader constructed a YT.Player through the fake API");
    // production code registered the store controller (no hand-rolled one)
    await check(page, S, "controller-registered", () => page.evaluate(() => {
      const st = window.__ytPlayback.getState();
      return !!st.embedController && typeof st.embedController.getPosition === "function" && st.embedController.getPosition() === 42;
    }), "registerEmbedController wired the production player (position readable: 42)");
    await check(page, S, "state-mirror", () => page.evaluate(() => window.__ytPlayback.getState().embedController.getPlayerState() === 1), "controller reports PLAYING from the real instance");
    // pause flows through the production wrapper into the fake player
    await page.evaluate(() => window.__ytPlayback.getState().embedController.pause());
    await check(page, S, "pause-path", () => page.evaluate(() => window.__ytPlayers[0].__state === 2), "controller.pause() reaches the real YT.Player instance");

    // end-to-end through the PRODUCTION controller: background → handoff
    await goBackground(page);
    await waitFor(page, () => window.__ytPlayback?.getState?.().mode === "direct" && !document.querySelector("video")?.paused, 30000);
    await check(page, S, "handoff", () => page.evaluate(() => { const v = document.querySelector("video"); return window.__ytPlayback?.getState?.().mode === "direct" && v && !v.paused; }), "background handoff succeeds THROUGH the production controller");
    await check(page, S, "iframe-paused", () => page.evaluate(() => window.__ytPlayers[0].__state === 2), "the embed player was paused (no double audio)");
    await check(page, S, "position", () => page.evaluate(() => { const t = document.querySelector("video")?.currentTime || 0; return t >= 40 && t <= 60; }), "direct playback resumed at the production controller's position (~42s)");
    await ctx.close();
  }

  console.log(`\nRESULT: ${PASS} passed, ${FAIL} failed${FAIL ? " — DUMPS ABOVE" : ""}`);
  await browser.close();
  stubServer.close();
  if (staticProc) { try { process.kill(-staticProc.pid); } catch {} }
  process.exit(FAIL ? 1 : 0);
})();

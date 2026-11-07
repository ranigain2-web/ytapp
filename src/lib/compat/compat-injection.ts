// compat-injection.ts — builds the Compat Mode injection bundle (Phase 2).
//
// The bundle runs inside m.youtube.com in the native compat WebView — a
// foreign page with no access to our app. It is assembled at runtime by
// embedding the guard-core function sources verbatim (Function.prototype
// .toString keeps a single source of truth: the unit tests run against the
// exact code the WebView executes). The wiring below each section is
// deliberately defensive: every hook is wrapped in try/catch and reports a
// "hookfail" message instead of throwing — if injection degrades, playback
// must survive (the plan's fail-safe rule).
//
// The bundle string must contain NO backticks and no template syntax — it is
// concatenated as plain ES2017 source.

import { shouldAutoResume, isContinueWatchingDialog, stripAdPayload } from "./guard-core";

export function buildCompatInjection(): string {
  const srcShouldAutoResume = shouldAutoResume.toString();
  const srcIsContinueWatching = isContinueWatchingDialog.toString();
  const srcStripAdPayload = stripAdPayload.toString();

  return (
"(function(){\n" +
'"use strict";\n' +
"var send = function(m){ try { window.ytCompatNative && window.ytCompatNative.postMessage(JSON.stringify(m)); } catch(e){} };\n" +

// ---- embedded pure logic (verbatim from guard-core) ----
srcShouldAutoResume + "\n" +
srcIsContinueWatching + "\n" +
srcStripAdPayload + "\n" +

// ---- 1. visibility spoof (C-02) ----
"try {\n" +
"  Object.defineProperty(document, 'hidden', { get: function(){ return false; }, configurable: true });\n" +
"  Object.defineProperty(document, 'webkitHidden', { get: function(){ return false; }, configurable: true });\n" +
"  Object.defineProperty(document, 'visibilityState', { get: function(){ return 'visible'; }, configurable: true });\n" +
"  Object.defineProperty(document, 'webkitVisibilityState', { get: function(){ return 'visible'; }, configurable: true });\n" +
"  var swallow = function(e){ e.stopImmediatePropagation(); };\n" +
"  document.addEventListener('visibilitychange', swallow, true);\n" +
"  document.addEventListener('webkitvisibilitychange', swallow, true);\n" +
"} catch (e) { send({ type: 'hookfail', hook: 'visibility', detail: String(e && e.message) }); }\n" +

// ---- 2. background guard (C-02) ----
"try {\n" +
"  var guard = { attempts: 0 };\n" +
"  var lastUserAt = 0;\n" +
"  var playerEl = function(){ var el = document.getElementById('movie_player'); return (el && (el.getPlayerState || el.playVideo)) ? el : null; };\n" +
"  var userPauseAt = function(){ return window.__ytUserPauseAt || 0; };\n" +
"  ['pointerdown','keydown'].forEach(function(ev){ document.addEventListener(ev, function(){ lastUserAt = Date.now(); }, true); });\n" +
"  setInterval(function(){\n" +
"    try {\n" +
"      var p = playerEl(); if (!p) return;\n" +
"      var st = p.getPlayerState ? p.getPlayerState() : -1;\n" +
"      var adPlaying = !!(p.getAdState && p.getAdState() > 0);\n" +
"      if (st === 2) {\n" +
"        var isUserPause = (Date.now() - lastUserAt) < 800 || (Date.now() - userPauseAt()) < 60000;\n" +
"        if (shouldAutoResume({ isUserPause: isUserPause, attempts: guard.attempts, ended: false, adPlaying: adPlaying })) {\n" +
"          p.playVideo && p.playVideo();\n" +
"          guard.attempts++;\n" +
"          send({ type: 'log', detail: 'guard auto-resumed (attempt ' + guard.attempts + ')' });\n" +
"        }\n" +
"      } else if (st === 1) { guard.attempts = 0; }\n" +
"      var dialog = document.querySelector('yt-confirm-dialog-renderer, tp-yt-paper-dialog');\n" +
"      if (dialog && dialog.offsetWidth > 0) {\n" +
"        var buttons = dialog.querySelectorAll('button');\n" +
"        if (isContinueWatchingDialog({ text: dialog.textContent || '', buttonCount: buttons.length })) buttons[0].click();\n" +
"      }\n" +
"      send({ type: 'media', playing: st === 1, position: p.getCurrentTime ? p.getCurrentTime() : 0, duration: p.getDuration ? p.getDuration() : 0 });\n" +
"    } catch (e) { /* the guard must never kill the page */ }\n" +
"  }, 5000);\n" +
"} catch (e) { send({ type: 'hookfail', hook: 'guard', detail: String(e && e.message) }); }\n" +

// ---- 3. ad strip (C-03): fetch + XHR + ytInitial globals ----
"try {\n" +
"  var scrub = function(data){\n" +
"    try {\n" +
"      if (typeof data !== 'string' || data.length < 2) return data;\n" +
"      var stats = { stripped: 0 };\n" +
"      var cleaned = stripAdPayload(JSON.parse(data), stats);\n" +
"      if (stats.stripped === 0) return data;\n" +
"      send({ type: 'log', detail: 'stripped ' + stats.stripped + ' ad nodes' });\n" +
"      return JSON.stringify(cleaned);\n" +
"    } catch (e) { return data; }\n" +
"  };\n" +
"  var of = window.fetch;\n" +
"  if (of) window.fetch = function(input, init){\n" +
"    return of.call(window, input, init).then(function(resp){\n" +
"      try {\n" +
"        var u = (typeof input === 'string') ? input : (input && input.url) || '';\n" +
"        if (u.indexOf('/youtubei/') !== -1 && resp.status === 200) {\n" +
"          return resp.clone().text().then(function(t){\n" +
"            var cleaned = scrub(t);\n" +
"            if (cleaned === t) return resp;\n" +
"            return new Response(cleaned, { status: resp.status, statusText: resp.statusText, headers: resp.headers });\n" +
"          });\n" +
"        }\n" +
"      } catch (e) {}\n" +
"      return resp;\n" +
"    });\n" +
"  };\n" +
"  var oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;\n" +
"  XMLHttpRequest.prototype.open = function(m, u){ this.__ytUrl = u; return oo.apply(this, arguments); };\n" +
"  XMLHttpRequest.prototype.send = function(){\n" +
"    var xhr = this;\n" +
"    if (String(xhr.__ytUrl || '').indexOf('/youtubei/') !== -1) {\n" +
"      xhr.addEventListener('readystatechange', function(){\n" +
"        if (xhr.readyState === 4 && xhr.status === 200 && (xhr.responseType === '' || xhr.responseType === 'text')) {\n" +
"          try {\n" +
"            var cleaned = scrub(xhr.responseText);\n" +
"            if (cleaned !== xhr.responseText) {\n" +
"              Object.defineProperty(xhr, 'responseText', { get: function(){ return cleaned; } });\n" +
"              Object.defineProperty(xhr, 'response', { get: function(){ return cleaned; } });\n" +
"            }\n" +
"          } catch (e) {}\n" +
"        }\n" +
"      });\n" +
"    }\n" +
"    return os.apply(this, arguments);\n" +
"  };\n" +
"  var armInitial = function(){\n" +
"    ['ytInitialPlayerResponse','ytInitialData'].forEach(function(k){\n" +
"      try {\n" +
"        var v = window[k];\n" +
"        if (v && typeof v === 'object') {\n" +
"          var stats = { stripped: 0 };\n" +
"          var cleaned = stripAdPayload(v, stats);\n" +
"          if (stats.stripped > 0) { try { delete window[k]; } catch (e) {} window[k] = cleaned; }\n" +
"        }\n" +
"      } catch (e) {}\n" +
"    });\n" +
"  };\n" +
"  armInitial(); setTimeout(armInitial, 1500); setTimeout(armInitial, 4000);\n" +
"} catch (e) { send({ type: 'hookfail', hook: 'adstrip', detail: String(e && e.message) }); }\n" +

// ---- 4. cookie collection (C-07): the compat session's cookies go to the
// user's own server (their choice, Settings toggle) so extraction and
// downloads can use them.
"try {\n" +
"  var share = function(){ send({ type: 'cookies', value: document.cookie || '' }); };\n" +
"  setTimeout(share, 3000);\n" +
"  document.addEventListener('visibilitychange', function(){ setTimeout(share, 1500); });\n" +
"} catch (e) {}\n" +

// ---- 5. close affordance: a floating pill on top of YouTube's UI; the
// notification's Close does the same, but an in-page exit must be obvious.
"try {\n" +
"  var btn = document.createElement('div');\n" +
"  btn.textContent = 'back to ytapp';\n" +
"  btn.setAttribute('style', 'position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);right:8px;z-index:2147483647;background:rgba(0,0,0,0.65);color:#fff;font:600 12px/1 system-ui,sans-serif;padding:9px 14px;border-radius:999px;cursor:pointer;');\n" +
"  btn.onclick = function(){ send({ type: 'close' }); };\n" +
"  if (document.body) document.body.appendChild(btn);\n" +
"  else document.addEventListener('DOMContentLoaded', function(){ document.body.appendChild(btn); });\n" +
"} catch (e) { send({ type: 'hookfail', hook: 'closebar', detail: String(e && e.message) }); }\n" +

"})();"
  );
}

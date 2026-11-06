// yt-decipher — phase 5: on-device signatureCipher deciphering.
//
// The current player (control-flow-flattened, string-table obfuscated) cannot
// be statically parsed — but it doesn't need to be. We slice a self-contained
// piece of base.js around the URL-param assembler (the function containing
// `a.set("alr","yes")`, which the player uses to apply the deciphered
// signature), eval that slice (pure JS, no DOM), and call it. Validated
// against the live player; any failure degrades to today's behavior
// (skip the format → embed plays it) — never a crash, never a fake.
//
// Web/CI cannot fetch base.js (CORS) — the fixture tests exercise the slice
// logic against a checked-in snapshot (see scripts/fixtures/ + refresh script).

"use client";

interface SigApply {
  (url: string, sp: string, s: string): { [k: string]: unknown };
}

export interface Decipher {
  /** deciphered URL, or null when the transform failed (degrade to embed) */
  applySig(url: string, sp: string, s: string): string | null;
  playerVersion: string;
}

// ----------------------------------------------------------------------------
// base.js acquisition (native: CapacitorHttp — no CORS; web: fetch where the
// transport allows). Cached SLICE (not the 2.6 MB file) in localStorage, 6h.
// ----------------------------------------------------------------------------

const SLICE_KEY = "yt_decipher_slice";
const TTL_MS = 6 * 60 * 60 * 1000;

async function fetchText(url: string): Promise<string> {
  if (typeof window !== "undefined" && (window as unknown as { Capacitor?: unknown }).Capacitor) {
    try {
      const { CapacitorHttp } = await import("@capacitor/core");
      const res = await CapacitorHttp.get({ url, responseType: "text", connectTimeout: 15000, readTimeout: 30000 });
      return String(res.data || "");
    } catch { /* fall through to fetch */ }
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function fetchPlayerJsUrl(): Promise<{ url: string; version: string }> {
  const html = await fetchText("https://www.youtube.com/");
  const m = /jsUrl":"([^"]+base\.js)"/.exec(html) || /["']([^"']*\/s\/player\/[^"']*base\.js)["']/.exec(html);
  if (!m) throw new Error("player jsUrl not found");
  const url = m[1].startsWith("http") ? m[1] : `https://www.youtube.com${m[1]}`;
  const ver = /\/s\/player\/([\w.-]+)\//.exec(url)?.[1] || "unknown";
  return { url, version: ver };
}

// ----------------------------------------------------------------------------
// The slicer (mirrors scripts/probe-slicer.mjs — keep them in sync; the
// refresh fixture test catches drift when YouTube rotates the player)
// ----------------------------------------------------------------------------

function extractDef(js: string, name: string): string | null {
  // NAME=function(params){body}
  const fnRe = new RegExp(`[;\\n}]${name}=function\\s*(?:[A-Za-z_$][\\w$]*\\s*)?\\(`);
  const fm = fnRe.exec(js);
  if (fm) {
    const start = fm.index + 1;
    let i = fm.index + fm[0].length, depth = 1;
    while (i < js.length && depth > 0) {
      const ch = js[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    if (js[i] !== "{") return null;
    let bd = 0, str: string | null = null;
    for (; i < js.length; i++) {
      const ch = js[i], prev = js[i - 1];
      if (str) { if (ch === str && prev !== "\\") str = null; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { str = ch; continue; }
      if (ch === "{") bd++;
      else if (ch === "}") { bd--; if (bd === 0) return js.slice(start, i + 1); }
    }
    return null;
  }
  // (var|let|const )NAME=<literal-ish expr>  (the w string table etc.)
  const exRe = new RegExp(`(?:[;\\n}]|(?:var|let|const)\\s+)${name}=(?![=])(?=["\`\\[\\{\\d!-])`);
  const e = exRe.exec(js);
  if (!e) return null;
  const start = e.index + e[0].indexOf(name + "=");
  let depth = 0, str: string | null = null;
  for (let i = start; i < js.length; i++) {
    const ch = js[i], prev = js[i - 1];
    if (str) { if (ch === str && prev !== "\\") str = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { str = ch; continue; }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if ((ch === ";" || ch === "\n") && depth === 0) return js.slice(start, i);
  }
  return null;
}

function stripStrings(code: string): string {
  let out = "", str: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i], prev = code[i - 1];
    if (str) { if (ch === str && prev !== "\\") str = null; out += " "; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { str = ch; out += " "; continue; }
    out += ch;
  }
  return out;
}

const KEYWORDS = new Set(["function", "return", "var", "let", "const", "if", "else", "for", "while", "new", "this", "typeof", "catch", "try", "switch", "case", "break", "continue", "throw", "in", "of", "do", "default", "delete", "void", "instanceof", "true", "false", "null", "undefined", "arguments", "async", "await", "yield", "class", "extends", "super", "static", "get", "set"]);

function refsOf(code: string, defName: string): Set<string> {
  const bare = stripStrings(code);
  const paramM = /function\s*(?:[A-Za-z_$][\w$]*\s*)?\(([^)]*)\)/.exec(bare);
  const locals = new Set((paramM?.[1] || "").split(",").map(x => x.trim().split(/[=\s]/)[0]).filter(Boolean));
  for (const l of bare.match(/(?:var|let|const)\s+[A-Za-z_$][\w$]*/g) || []) locals.add(l.replace(/(?:var|let|const)\s+/, ""));
  const names = new Set<string>();
  const re = /(?<![\w$.])([A-Za-z_$][\w$]*)(?!\s*:)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bare))) {
    if (!KEYWORDS.has(m[1]) && !locals.has(m[1]) && m[1] !== defName) names.add(m[1]);
  }
  return names;
}

export interface SliceResult {
  rootName: string;
  defs: Map<string, string>; // name -> code ("g.x" keys for namespace members)
}

/** Slice base.js around the sig-apply function. Throws when the player shape changes. */
export function buildSlice(js: string): SliceResult {
  const marker = 'a.set("alr","yes")';
  const mi = js.indexOf(marker);
  if (mi < 0) throw new Error("sig-apply marker not found");
  const fnStart = js.lastIndexOf("=function(", mi);
  const nameStart = js.lastIndexOf("\n", fnStart) + 1;
  const header = js.slice(nameStart, fnStart + 60);
  const rootName = /^([\w$.]+)\s*=\s*function/.exec(header)?.[1];
  if (!rootName) throw new Error("sig-apply function name not found");

  const GLOBALS = new Set(["String", "Array", "Math", "Object", "JSON", "Number", "Boolean", "encodeURIComponent", "decodeURIComponent", "parseInt", "parseFloat", "isNaN", "Error", "TypeError", "RangeError", "RegExp", "Date", "Promise", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "BigInt", "Infinity", "NaN", "console", "window", "self", "globalThis", "location", "navigator", "document", "XMLHttpRequest", "fetch", "setTimeout", "clearTimeout", "TextEncoder", "TextDecoder", "Uint8Array", "ArrayBuffer", "DataView", "Int8Array", "Float32Array", "URL", "Blob", "Worker", "history", "screen", "performance", "crypto", "atob", "btoa"]);

  const defs = new Map<string, string>();
  const queue = [rootName];
  const dead = new Set<string>();
  while (queue.length) {
    const name = queue.shift() as string;
    if (defs.has(name) || GLOBALS.has(name) || dead.has(name) || name.includes(".")) continue;
    const def = extractDef(js, name);
    if (!def) { dead.add(name); continue; }
    defs.set(name, def);
    for (const r of refsOf(def, name)) if (!defs.has(r) && !GLOBALS.has(r)) queue.push(r);
  }
  // g.* namespace members (functions AND ES6 classes like the URLSearchParams)
  for (let pass = 0; pass < 6; pass++) {
    const needed = new Set<string>();
    for (const code of defs.values()) for (const m of stripStrings(code).matchAll(/\bg\.([\w$]+)/g)) needed.add(m[1]);
    let added = false;
    for (const gm of needed) {
      const key = `g.${gm}`;
      if (defs.has(key)) continue;
      const dm = new RegExp("g\\." + gm + "=(function\\s*(?:[A-Za-z_$][\\w$]*\\s*)?\\(|class[\\s\\w]*(?:extends\\s+[\\w$.]+\\s*)?\\{)").exec(js);
      if (!dm) continue;
      let i = dm.index + dm[0].length;
      if (dm[0].endsWith("{")) i -= 1;
      else if (dm[0].includes("(")) {
        let depth = 1;
        while (i < js.length && depth > 0) { const ch = js[i]; if (ch === "(") depth++; else if (ch === ")") depth--; i++; }
      }
      if (js[i] !== "{") continue;
      let bd = 0, str: string | null = null;
      for (; i < js.length; i++) {
        const ch = js[i], prev = js[i - 1];
        if (str) { if (ch === str && prev !== "\\") str = null; continue; }
        if (ch === '"' || ch === "'" || ch === "`") { str = ch; continue; }
        if (ch === "{") bd++;
        else if (ch === "}") { bd--; if (bd === 0) break; }
      }
      defs.set(key, js.slice(dm.index, i + 1));
      added = true;
      for (const r of refsOf(defs.get(key) as string, key)) if (!defs.has(r) && !GLOBALS.has(r) && !r.includes(".")) queue.push(r);
    }
    // drain the queue between passes
    while (queue.length) {
      const name = queue.shift() as string;
      if (defs.has(name) || GLOBALS.has(name) || dead.has(name) || name.includes(".")) continue;
      const def = extractDef(js, name);
      if (!def) { dead.add(name); continue; }
      defs.set(name, def);
      for (const r of refsOf(def, name)) if (!defs.has(r) && !GLOBALS.has(r)) queue.push(r);
    }
    if (!added) break;
  }
  if (!defs.has(rootName)) throw new Error("root def lost");
  return { rootName, defs };
}

/** a def must at least PARSE on its own — fragments of local statements
 *  (name collisions in minified code) are dropped before assembly */
function syntaxOk(code: string): boolean {
  try { new Function(code); return true; } catch { return false; }
}

/** eval the slice and return the callable sig-apply function (or throw) */
export function evalSlice(slice: SliceResult): SigApply {
  // per-def guarded assignment: minified name collisions mean a few extracted
  // "defs" are actually local statements from other scopes — a broken one is
  // skipped, and the smoke probe below is the arbiter of a complete slice
  const valid = [...slice.defs.entries()].filter(([, code]) => syntaxOk(code));
  const plain = valid.map(([n]) => n).filter(n => !n.startsWith("g."));
  const decls: string[] = ["var g = {};"];
  decls.push(`var ${plain.join(", ")};`);
  decls.push("function __try(f) { try { f(); } catch (e) {} }");
  for (const [name, code] of valid) {
    if (name.startsWith("g.")) decls.push(`__try(function () { g.${name.slice(2)} = ${code}; });`);
    else decls.push(`__try(function () { ${name} = ${code}; });`);
  }
  const prog = decls.join("\n") + `\nreturn ${slice.rootName};`;
  const wrapper = new Function(prog) as () => SigApply;
  const apply = wrapper();
  if (typeof apply !== "function") throw new Error("sig-apply not resolvable after eval");
  // smoke-test: a throw here means the slice is incomplete — never ship blind
  const probe = apply("https://example-probe/videoplayback?c=WEB", "sig", "probe");
  if (!probe || typeof probe !== "object") throw new Error("sig-apply returned nothing");
  return apply;
}

/** the instance keeps the original URL and the overridden params in
 *  version-specific minified fields — find them structurally */
function serializeResult(out: { [k: string]: unknown }): string | null {
  let origUrl: string | null = null;
  let params: Record<string, string> | null = null;
  for (const v of Object.values(out)) {
    if (typeof v === "string" && /^https?:\/\//.test(v) && !origUrl) origUrl = v;
    if (v && typeof v === "object" && !Array.isArray(v) && !params) {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length && entries.every(([, x]) => typeof x === "string")) params = v as Record<string, string>;
    }
  }
  if (!origUrl || !params) return null;
  try {
    const u = new URL(origUrl);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  } catch { return null; }
}

// ----------------------------------------------------------------------------
// Public surface: single-flight, TTL-cached, prefetched at app start
// ----------------------------------------------------------------------------

let inflight: Promise<Decipher | null> | null = null;
let cached: Decipher | null = null;

export function getDecipher(): Promise<Decipher | null> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async (): Promise<Decipher | null> => {
    try {
      // localStorage slice cache (27 KB, not the 2.6 MB player)
      const cachedSlice = (() => {
        try {
          const raw = localStorage.getItem(SLICE_KEY);
          if (!raw) return null;
          const parsed = JSON.parse(raw) as { version: string; defs: [string, string][]; root: string; ts: number };
          if (Date.now() - parsed.ts > TTL_MS) return null;
          return parsed;
        } catch { return null; }
      })();

      let slice: SliceResult;
      let version: string;
      if (cachedSlice) {
        slice = { rootName: cachedSlice.root, defs: new Map(cachedSlice.defs) };
        version = cachedSlice.version;
      } else {
        const { url, version: ver } = await fetchPlayerJsUrl();
        version = ver;
        const js = await fetchText(url);
        slice = buildSlice(js);
        try {
          localStorage.setItem(SLICE_KEY, JSON.stringify({
            version, root: slice.rootName, defs: [...slice.defs.entries()], ts: Date.now(),
          }));
        } catch { /* quota — fine, next start refetches */ }
      }

      const apply = evalSlice(slice);
      cached = {
        playerVersion: version,
        applySig(url, sp, s) {
          try {
            const out = apply(url, sp, s);
            return serializeResult(out);
          } catch { return null; }
        },
      };
      return cached;
    } catch {
      return null; // graceful: no deciphering this session (embed as today)
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** app-start prefetch so deciphering never sits on the playback critical path */
export function prefetchDecipher(): void {
  if (typeof window === "undefined") return;
  getDecipher().then(d => {
    try {
      const dbg = (window as unknown as { __ytDebug?: Record<string, unknown> }).__ytDebug || {};
      dbg.decipher = d ? { player: d.playerVersion, ok: true } : { ok: false };
      (window as unknown as { __ytDebug: Record<string, unknown> }).__ytDebug = dbg;
    } catch { /* ignore */ }
  });
}

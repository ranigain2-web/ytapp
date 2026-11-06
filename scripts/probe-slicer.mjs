// probe-slicer.mjs — extract a self-contained code slice for the sig transform:
// marker-walk to Bs, then iteratively resolve referenced identifiers (the
// NewPipe/yt-dlp approach) and eval the slice WITHOUT any DOM.
import fs from "node:fs";
import vm from "node:vm";

const js = fs.readFileSync("/tmp/base.js", "utf8");

// --- find a top-level-ish definition of NAME and extract it by brace matching
function extractDef(name) {
  // "NAME=function(params){body}" — or "NAME=<expr>"
  const fnRe = new RegExp(`[;\\n}]${name}=function\\s*(?:[A-Za-z_$][\\w$]*\\s*)?\\(`);
  const m = fnRe.exec(js);
  if (m) {
    const start = m.index + 1;
    // skip the parameter list to its matching ')'
    let i = m.index + m[0].length, depth = 1;
    while (i < js.length && depth > 0) {
      const ch = js[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    // expect '{' now; brace-match the body
    if (js[i] !== "{") return null;
    let b = i, bd = 0, str = null;
    for (; i < js.length && i < b + 200000; i++) {
      const ch = js[i], prev = js[i - 1];
      if (str) { if (ch === str && prev !== "\\") str = null; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { str = ch; continue; }
      if (ch === "{") bd++;
      else if (ch === "}") { bd--; if (bd === 0) return js.slice(start, i + 1); }
    }
    return null;
  }
  // non-function expr: NAME=...; up to the statement end at depth 0.
  // Only accept literal-ish RHS (strings/arrays/objects/chains on them) —
  // bare `x=y` / `x=y.z` matches are LOCAL statements in minified code.
  const exRe = new RegExp(`(?:[;\\n}]|(?:var|let|const)\\s+)${name}=(?![=])(?=["\`\[\{\d!-])`);
  const e = exRe.exec(js);
  if (!e) return null;
  const start = e.index + e[0].indexOf(name + "=");
  let i = start, depth = 0, str = null;
  for (; i < js.length && i < start + 300000; i++) {
    const ch = js[i], prev = js[i - 1];
    if (str) { if (ch === str && prev !== "\\") str = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { str = ch; continue; }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === ";" && depth === 0) return js.slice(start, i);
    else if (ch === "\n" && depth === 0) return js.slice(start, i);
  }
  return null;
}

// identifiers referenced in a code snippet (heuristic: bare word tokens)
function stripStrings(code) {
  let out = "", str = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i], prev = code[i - 1];
    if (str) { if (ch === str && prev !== "\\") str = null; out += " "; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { str = ch; out += " "; continue; }
    out += ch;
  }
  return out;
}

function refsOf(code, defName) {
  code = stripStrings(code);
  // exclude the def's own parameter names and local var declarations
  const paramM = /function\s*(?:[A-Za-z_$][\w$]*\s*)?\(([^)]*)\)/.exec(code);
  const params = new Set((paramM?.[1] || "").split(",").map(x => x.trim().split(/[=\s]/)[0]).filter(Boolean));
  const localM = code.match(/(?:var|let|const)\s+[A-Za-z_$][\w$]*/g) || [];
  for (const l of localM) params.add(l.replace(/(?:var|let|const)\s+/, ""));
  const names = new Set();
  const re = /(?<![\w$.])([A-Za-z_$][\w$]*)(?!\s*:)\b/g;
  let m;
  const KEYWORDS = new Set(["function", "return", "var", "let", "const", "if", "else", "for", "while", "new", "this", "typeof", "catch", "try", "switch", "case", "break", "continue", "throw", "in", "of", "do", "default", "delete", "void", "instanceof", "true", "false", "null", "undefined", "arguments", "async", "await", "yield", "class", "extends", "super", "static", "get", "set"]);
  while ((m = re.exec(code))) {
    if (!KEYWORDS.has(m[1]) && !params.has(m[1]) && m[1] !== defName) names.add(m[1]);
  }
  return names;
}

// 1) marker-walk → Bs
const marker = 'a.set("alr","yes")';
const mi = js.indexOf(marker);
const fnStart = js.lastIndexOf("=function(", mi);
const nameStart = js.lastIndexOf("\n", fnStart) + 1;
const header = js.slice(nameStart, fnStart + 60);
const rootName = /^([\w$.]+)\s*=\s*function/.exec(header)?.[1];
console.log("root fn:", rootName);

// 2) iterative closure
const GLOBALS = new Set(["String", "Array", "Math", "Object", "JSON", "Number", "Boolean", "encodeURIComponent", "decodeURIComponent", "parseInt", "parseFloat", "isNaN", "Error", "TypeError", "RangeError", "RegExp", "Date", "Promise", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "BigInt", "Infinity", "NaN", "console", "window", "self", "globalThis", "location", "navigator", "document", "XMLHttpRequest", "fetch", "setTimeout", "clearTimeout", "TextEncoder", "TextDecoder", "Uint8Array", "ArrayBuffer", "DataView", "Int8Array", "Float32Array", "URL", "Blob", "Worker", "history", "screen", "performance", "crypto", "atob", "btoa", "alert", "ErrorUtils"]);
const defs = new Map(); // name -> code
const queue = [rootName];
const skipped = new Set();
while (queue.length) {
  const name = queue.shift();
  if (defs.has(name) || GLOBALS.has(name) || skipped.has(name)) continue;
  const def = extractDef(name);
  if (!def) { skipped.add(name); continue; }
  defs.set(name, def);
  for (const r of refsOf(def, name)) if (!defs.has(r) && !GLOBALS.has(r)) queue.push(r);
}
// extract g.* members as "g.NAME=function..." assignments
let pass = 0;
while (pass < 6) {
  pass++;
  const needed = new Set();
  for (const code of defs.values()) for (const m of stripStrings(code).matchAll(/\bg\.([\w$]+)/g)) needed.add(m[1]);
  let added = false;
  for (const gm of needed) {
    const key = "g." + gm;
    if (defs.has(key)) continue;
    const dm = new RegExp("g\\." + gm + "=(function\\s*(?:[A-Za-z_$][\\w$]*\\s*)?\\(|class[\\s\\w]*(?:extends\\s+[\\w$.]+\\s*)?\\{)").exec(js);
    if (!dm) continue;
    // skip the parameter list (functions) then brace-match the body
    let i = dm.index + dm[0].length;
    if (dm[0].endsWith("{")) i -= 1;
    else if (dm[0].includes("(")) {
      let depth = 1;
      while (i < js.length && depth > 0) { const ch = js[i]; if (ch === "(") depth++; else if (ch === ")") depth--; i++; }
    }
    if (js[i] !== "{") continue;
    let b = i, bd = 0, str = null;
    for (; i < js.length; i++) {
      const ch = js[i], prev = js[i - 1];
      if (str) { if (ch === str && prev !== "\\") str = null; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { str = ch; continue; }
      if (ch === "{") bd++;
      else if (ch === "}") { bd--; if (bd === 0) break; }
    }
    defs.set(key, js.slice(dm.index, i + 1));
    added = true;
    for (const r of refsOf(defs.get(key), key)) if (!defs.has(r) && !GLOBALS.has(r) && !r.includes(".")) queue.push(r);
  }
  if (!added) break;
}
console.log("closure size:", defs.size);
console.log("unresolved (skipped):", [...skipped].join(", "));

// 3) also extract the g-namespace members used (g.zs etc.) — find "g.zs=function" style
const gMembers = new Set();
for (const code of defs.values()) {
  for (const m of code.matchAll(/\bg\.([\w$]+)/g)) gMembers.add(m[1]);
}
console.log("g.* members needed:", [...gMembers].join(", "));

// 4) try to eval the slice
const slice = [...defs.values()].map(d => d.endsWith(";") ? d : d + ";").join("\n");
console.log("slice length:", slice.length);
// per-def eval: definitions that fail at def-time are polluted local
// statements (name collisions in minified code) — skip them, the call is
// the arbiter of whether the slice is complete
const sb0 = { String, Array, Math, Object, JSON, Number, RegExp, Date, Error, TypeError, Map, Set, Symbol, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, URLSearchParams, console: { log(){}, warn(){}, error(){} }, __g: {} };
vm.createContext(sb0);
vm.runInContext("var g=this.__g;", sb0);
let okDefs = 0, skippedDefs = [];
for (const [name, d] of defs) {
  try {
    vm.runInContext(name.startsWith("g.") ? `this.__g.${name.slice(2)}=${d};` : `var ${name}=${d};`, sb0);
    okDefs++;
  } catch (e) { skippedDefs.push(name); }
}
console.log("defs evaluated:", okDefs, "/", defs.size, "| skipped:", skippedDefs.slice(0, 12).join(","));
try {
  vm.runInContext(`this.__fn=${rootName};`, sb0);
  const testUrl = "https://rr4---sn-test.googlevideo.com/videoplayback?vtag=test&clen=123&expire=9999999999&ei=abc&ip=1.2.3.4&id=o-TEST&c=WEB&fexp=x";
  const out = sb0.__fn(testUrl, "sig", "TESTSIGVALUE1234567890");
  console.log("CALL OK, proto methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(out)).join(","));
  for (const meth of ["toString", "get", "getUrl"]) {
    try { const v = out[meth]?.(); if (typeof v === "string") console.log(`${meth}() →`, v.slice(0, 180)); } catch (e) {}
  }
  try {
    const fields = {};
    for (const k of Object.keys(out)) {
      const v = out[k];
      fields[k] = typeof v === "object" && v !== null ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 100);
    }
    console.log("instance fields:", JSON.stringify(fields, null, 1));
    try { console.log("Ue() →", String(out.Ue()).slice(0, 150)); } catch (e) { console.log("Ue failed:", String(e).slice(0, 80)); }
  } catch (e) { console.log("inspect failed:", String(e).slice(0, 80)); }
  fs.writeFileSync("/tmp/slice.js", [...defs.entries()].map(([n, d]) => (n.startsWith("g.") ? `g.${n.slice(2)} = ${d};` : `var ${n} = ${d};`)).join("\n"));
  console.log("SLICE COMPLETE");
} catch (e) {
  console.log("CALL FAILED:", String(e).slice(0, 220));
}
try {
  const sb = { String, Array, Math, Object, JSON, Number, RegExp, Date, Error, TypeError, Map, Set, Symbol, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, URLSearchParams, console: { log(){}, warn(){}, error(){} }, __g: {} };
  vm.createContext(sb);
  // g namespace + all defs, then the call
  const prelude = "var g=this.__g;";
  vm.runInContext(prelude + "\n" + slice + "\nthis.__fn=" + rootName + ";", sb, { timeout: 10000 });
  console.log("SLICE EVAL OK — root:", typeof sb.__fn);
  const testUrl = "https://rr4---sn-test.googlevideo.com/videoplayback?vtag=test&clen=123&expire=9999999999&ei=abc&ip=1.2.3.4&id=o-TEST&c=WEB&fexp=x";
  const out = sb.__fn(testUrl, "sig", "TESTSIGVALUE1234567890");
  console.log("CALL OK →", String(out).slice(0, 200));
  console.log("alr param:", String(out).includes("alr=yes"), "| sig param:", (String(out).match(/[?&]sig=[^&]*/) || ["(none)"])[0].slice(0, 50));
  fs.writeFileSync("/tmp/slice.js", slice);
  console.log("slice saved:", slice.length, "bytes");
} catch (e) {
  console.log("SLICE EVAL FAILED:", String(e).slice(0, 250));
}
process.exit(0);

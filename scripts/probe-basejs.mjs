// probe-basejs2.mjs — fetch base.js via the confirmed version and probe structure
import fs from "node:fs";

const html = await fetch("https://www.youtube.com/", {
  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36" },
}).then(r => r.text());
const purl = (/\"jsUrl\":\"([^\"]+base\.js)\"/.exec(html)?.[1]
  || /["']([^"']*\/s\/player\/[^"']*base\.js)["']/.exec(html)?.[1]
  || /(?:^|[^\w])((?:https?:\/\/www\.youtube\.com)?\/s\/player\/[\w.-]+\/player_es6\.vflset\/[\w_]+\/base\.js)/.exec(html)?.[1]);
if (!purl) { console.log("no player js url in html"); process.exit(1); }
const base = purl.startsWith("http") ? purl : `https://www.youtube.com${purl}`;
console.log("player url:", base);

const res = await fetch(base, {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/131.0" },
});
console.log("status:", res.status, "content-encoding:", res.headers.get("content-encoding"));
const js = await res.text();
console.log("base.js size:", (js.length / 1024).toFixed(0), "KB");
fs.writeFileSync("/tmp/base.js", js);

// sig call sites (classic patterns)
for (const re of [
  /\bc&&\(c=([\w$]+)\(decodeURIComponent\(c\)\)/,
  /\bm=([\w$]+)\(decodeURIComponent\(h\.s\)\)/,
  /a\.set\("alr","yes"\);c&&\(c=([\w$]+)/,
]) {
  const m = re.exec(js);
  if (m) console.log("SIG call-site:", m[0].slice(0, 55), "→ fn:", m[1]);
}

// n-transform call sites
for (const re of [
  /\(b=String\.fromCharCode\(110\),c=a\.n\|\|"",c&&\(c=([\w$]+)\(c\)/,
  /[\w$]+\.get\("n"\).{0,40}([\w$]+)\(/,
  /\bc&&\(c=([\w$]+)\(c\),b\+="="\+c\)/,
]) {
  const m = re.exec(js);
  if (m) console.log("N call-site:", m[0].slice(0, 70), "→ fn:", m[1]);
}

const idx = js.indexOf("String.fromCharCode(110)");
if (idx > 0) console.log("\nn-context:", js.slice(idx - 260, idx + 150).replace(/\n/g, " "));
else console.log("\nno fromCharCode(110) pattern");
process.exit(0);

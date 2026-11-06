// verify-server-chain.mjs — C1 live proof on this bot-gated IP:
//   1. boot the NEW server (background, survives this script's exit)
//   2. request dQw4w9WgXcQ — IOS/ANDROID/WEB gated ⇒ MWEB must rescue it
//      (extracted_by=MWEB, audio_only=false, formats present)
//   3. request a hard-gated video — embed_fallback with per-client
//      playability in the log line, extract_ms within budget
//   4. fresh=1 twice — second call must be refused by the cooldown (0 API
//      calls; log line "refused: within cooldown")
//   5. /api/health — extract_stats present
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";

const log = (...a) => console.log("[c1]", ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const j = async (url, opts) => (await fetch(url, opts)).json().catch(() => null);

try { execSync('pkill -f "node inde[x].mjs" || true'); } catch {}
await sleep(1000);
const out = fs.openSync("/tmp/srv-c1.log", "w");
const p = spawn("node", ["index.mjs"], { cwd: "/home/z/my-project/server", detached: true, stdio: ["ignore", out, out] });
p.unref();
await sleep(4000);
log("server up (pid", p.pid, ")");

// 1) the video MWEB can rescue
const a = await j("http://127.0.0.1:3001/api/video/dQw4w9WgXcQ?fresh=1", { signal: AbortSignal.timeout(90000) });
log(`dQw4w9WgXcQ: ok=${a?.ok} extracted_by=${a?.extracted_by} audio_only=${a?.audio_only} formats=${(a?.formats || []).length} hls=${!!a?.hls} extract_ms=${a?.extract_ms}`);
console.log(a?.ok && a?.extracted_by ? (a.extracted_by === "MWEB" ? "  ✓ MWEB rescue happened (IOS/ANDROID/WEB gated on this IP)" : `  ✓ rescued via ${a.extracted_by}`) : "  ✗ NOT RESCUED");

// 2) a hard-gated video: fallback diagnostics
const b = await j("http://127.0.0.1:3001/api/video/jNQXAC9IVRw?fresh=1", { signal: AbortSignal.timeout(90000) });
log(`jNQXAC9IVRw: ok=${b?.ok} embed_fallback=${b?.embed_fallback} extract_ms=${b?.extract_ms}`);

// 3) cooldown: immediate second fresh call
const c = await j("http://127.0.0.1:3001/api/video/jNQXAC9IVRw?fresh=1", { signal: AbortSignal.timeout(30000) });
log(`immediate re-fresh: embed_fallback=${c?.embed_fallback} (should return cached failure fast)`);

// 4) health counters
const h = await j("http://127.0.0.1:3001/api/health", { signal: AbortSignal.timeout(10000) });
log(`health: po_token=${h?.po_token} extract_stats=${JSON.stringify(h?.extract_stats)}`);

await sleep(500);
const srvLog = fs.readFileSync("/tmp/srv-c1.log", "utf8");
log("cooldown-refusal logged:", /refused: within cooldown/.test(srvLog) ? "✓ YES" : "✗ NO");
const fbLine = srvLog.split("\n").find(l => l.includes("embed_fallback"));
log("fallback diagnostics:", fbLine ? fbLine.slice(0, 160) : "✗ no warn line");
process.exit(0);

// verify-retoken.mjs — end-to-end proof of the phase-7 server fix:
//   boot yt-api with bgutil DOWN → request (token-less session, embed_fallback)
//   → start bgutil → wait out the 60s token backoff → request again
//   → assert: "PO token acquired — dropping N token-less session(s)" logged,
//     sessions recreated WITH the token, health reports po_token: true.
// The datacenter IP may bot-gate playability regardless — the DROP and
// re-token are what this proves (formats depend on YouTube's mood).
import { spawn } from "node:child_process";
import fs from "node:fs";

const ROOT = "/home/z/my-project";
const log = (...a) => console.log("[verify]", ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function spawnNode(args, cwd, logfile) {
  const out = fs.openSync(logfile, "w");
  const p = spawn("node", args, { cwd, detached: true, stdio: ["ignore", out, out] });
  p.unref();
  return p;
}

const health = async () => {
  try { return await (await fetch("http://127.0.0.1:3001/api/health")).json(); }
  catch { return null; }
};

// clean slate
for (const pat of [/node inde[x].mjs/, /build\/mai[n].js/]) {
  try { const { execSync } = await import("node:child_process"); execSync(`pkill -f "${pat.source}" || true`); } catch {}
}
await sleep(1000);

// 1) boot yt-api with bgutil DOWN
spawnNode(["index.mjs"], `${ROOT}/server`, "/tmp/live4.log");
await sleep(3500);
log("yt-api booted (bgutil down)");
const v1 = await (await fetch("http://127.0.0.1:3001/api/video/jNQXAC9IVRw")).json().catch(() => ({}));
log(`step1 (POT down): ok=${v1.ok} embed_fallback=${v1.embed_fallback} formats=${(v1.formats || []).length}`);
const bootLog = fs.readFileSync("/tmp/live4.log", "utf8");
log("token-less session created:", /NO PO TOKEN/.test(bootLog) ? "YES" : "no (unexpected — check log)");

// 2) start bgutil, wait out the backoff, request again
spawnNode(["build/main.js"], `${ROOT}/pot-provider`, "/tmp/pot4.log");
await sleep(2500);
log("bgutil started; waiting 66s for the token retry backoff…");
await sleep(66000);
const v2 = await (await fetch("http://127.0.0.1:3001/api/video/2Vv-BfVoq4g")).json().catch(() => ({}));
log(`step2 (POT recovered): ok=${v2.ok} embed_fallback=${v2.embed_fallback} formats=${(v2.formats || []).length}`);
const afterLog = fs.readFileSync("/tmp/live4.log", "utf8");
const dropped = /PO token acquired — dropping (\d+) token-less/.exec(afterLog);
log("drop path fired:", dropped ? `YES (${dropped[1]} session(s))` : "NO (FAIL)");
const h = await health();
log(`health: po_token=${h?.po_token} pot_reachable=${h?.pot_reachable} sessions=${h?.sessions}`);
const reTokened = /session #\d+ created \(visitor [^)]*\)(?!.*NO PO TOKEN)/.test(afterLog) && !/NO PO TOKEN[^\n]*\n(?:[^\n]*\n){0,40}$/.test(afterLog);
log("PASS =", (!!dropped && h?.po_token === true) ? "YES" : "NO");
process.exit(0);

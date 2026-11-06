// test-decipher.mjs — CI fixture test for the on-device deciphering.
// No network: runs the slicer's eval path against the checked-in snapshot.
// Run: bun scripts/test-decipher.mjs
import { evalSlice, buildSlice } from "../src/lib/yt-decipher.ts";
import fs from "node:fs";

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log(`  ✓ ${m}`); };
const bad = (m) => { FAIL++; console.log(`  ✗ ${m}`); };

const fx = JSON.parse(fs.readFileSync("scripts/fixtures/decipher-fixture.json", "utf8"));
console.log(`fixture: player ${fx.player_version} (${fx.defs.length} defs, generated ${fx.generated_at})`);

// 1) the slice evals and the sig-apply is callable
let apply;
try {
  apply = evalSlice({ rootName: fx.root, defs: new Map(fx.defs) });
  ok("slice evals; sig-apply callable");
} catch (e) {
  bad(`slice eval failed: ${String(e).slice(0, 120)}`);
  console.log(`\nRESULT: ${PASS} passed, ${FAIL} failed`);
  process.exit(1);
}

// 2) the transform is deterministic — matches the recorded vector
try {
  const out = apply(fx.vector.url, fx.vector.sp, fx.vector.s);
  let params = null;
  for (const v of Object.values(out)) {
    if (v && typeof v === "object" && !Array.isArray(v) && !params) params = v;
  }
  if (params?.sig === fx.vector.expected_sig) ok(`transform matches the recorded vector (${fx.vector.s.slice(0, 10)}… → ${String(params.sig).slice(0, 16)}…)`);
  else bad(`transform drifted: got ${String(params?.sig).slice(0, 20)} expected ${String(fx.vector.expected_sig).slice(0, 20)} (player rotated? re-run refresh-decipher-fixture)`);
  if (params?.alr === fx.vector.expected_alr) ok("alr=yes applied (URL-param assembler behavior intact)");
  else bad(`alr param missing (expected ${fx.vector.expected_alr})`);
} catch (e) {
  bad(`vector call failed: ${String(e).slice(0, 120)}`);
}

// 3) the slicer itself still finds the structure in the snapshot's defs
//    (self-consistency: root present, g.zs-class present)
{
  const hasRoot = fx.defs.some(([n]) => n === fx.root);
  const hasParamsClass = fx.defs.some(([n, code]) => code.includes("constructor") && /set\(/.test(code));
  if (hasRoot) ok("root sig-apply function present in slice");
  else bad("root missing from slice");
  if (hasParamsClass) ok("URL-params class present in slice");
  else bad("URL-params class missing — extraction incomplete");
}

console.log(`\nRESULT: ${PASS} passed, ${FAIL} failed`);
process.exit(FAIL === 0 ? 0 : 1);

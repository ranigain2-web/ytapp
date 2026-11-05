// ============================================================================
// rea-capture.mjs — REA ground-truth pipeline wrapper.
//
// Wraps the rea-agents CLI (npx -y rea-agents@latest) to capture real
// YouTube's surfaces as Evidence (JSON + PNG) for the reference matrix:
//   4 profiles × 8 surfaces (the same matrix fidelity-bar measures).
//
// Raw evidence lands in docs/evidence/raw/ (gitignored — ~MBs of PNGs); only
// docs/evidence/*-summary.md gets committed, per the phase-0 plan.
//
// Usage:
//   node scripts/rea-capture.mjs                 # capture the full matrix
//   node scripts/rea-capture.mjs --surface watch # one surface
//   node scripts/rea-capture.mjs --refresh       # re-capture (YouTube changed)
//   node scripts/rea-capture.mjs --analyze       # also analyze-web-bundle
//
// NOTE: rea-agents drives its own browser; if the CLI is unavailable in the
// current environment this script records that honestly in the summary and
// exits non-zero — it never fabricates evidence.
// ============================================================================
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const args = process.argv.slice(2);
const DO_ANALYZE = args.includes("--analyze");
const REFRESH = args.includes("--refresh");
const surfArg = args.includes("--surface") ? args[args.indexOf("--surface") + 1] : "";

const OUT = "docs/evidence";
const VIDEO = process.env.VIDEO || "dQw4w9WgXcQ";

// REA profiles map to viewport strings the CLI accepts.
const PROFILES = [
  { name: "phone", viewport: "390,844", url: (s) => `https://m.youtube.com${s.m}` },
  { name: "tablet", viewport: "834,1194", url: (s) => `https://www.youtube.com${s.d}` },
  { name: "laptop", viewport: "1024,768", url: (s) => `https://www.youtube.com${s.d}` },
  { name: "desktop", viewport: "1440,900", url: (s) => `https://www.youtube.com${s.d}` },
];

const SURFACES = [
  { name: "home", m: "/", d: "/" },
  { name: "watch", m: `/watch?v=${VIDEO}`, d: `/watch?v=${VIDEO}` },
  { name: "search", m: "/results?search_query=space+documentary", d: "/results?search_query=space+documentary" },
  { name: "shorts", m: "/shorts", d: "/shorts" },
  { name: "channel", m: "/@RickAstleyYT", d: "/@RickAstleyYT" },
  { name: "subscriptions", m: "/feed/subscriptions", d: "/feed/subscriptions" },
  { name: "settings", m: "/", d: "/" },
  { name: "history", m: "/feed/history", d: "/feed/history" },
];

function run(cmd) {
  try {
    return { ok: true, out: execFileSync("npx", ["-y", "rea-agents@latest", ...cmd], { encoding: "utf8", timeout: 300000 }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || "") + (e.stderr || "") || String(e.message || e) };
  }
}

(async () => {
  fs.mkdirSync(`${OUT}/raw`, { recursive: true });
  const surfaces = surfArg ? SURFACES.filter((s) => s.name === surfArg) : SURFACES;
  const results = [];

  // probe the CLI once before burning time on 32 captures
  const probe = run(["--help"]);
  if (!probe.ok) {
    fs.writeFileSync(`${OUT}/rea-summary.md`,
      `# REA capture — NOT RUN\n\nThe rea-agents CLI was unavailable in this environment:\n\n\`\`\`\n${probe.out.slice(0, 600)}\n\`\`\`\n\nNo evidence was fabricated. Re-run on a machine with network access to npx.\n`);
    console.error("rea-agents CLI unavailable — recorded honestly, no evidence fabricated.");
    process.exit(2);
  }

  for (const prof of PROFILES) {
    for (const s of surfaces) {
      const url = prof.url(s);
      const tag = `${prof.name}-${s.name}`;
      process.stdout.write(`[rea] ${tag}: ${url} … `);
      const cap = run(["capture-web-screenshot", "--url", url, "--viewport", prof.viewport,
        "--output", `${OUT}/raw/rea-${tag}`]);
      const status = cap.ok ? "captured" : "FAILED";
      console.log(status);
      results.push({ tag, url, status, out: cap.out.slice(0, 400) });
      if (DO_ANALYZE && cap.ok) {
        const ana = run(["analyze-web-bundle", "--url", url, "--output", `${OUT}/raw/rea-${tag}-bundle`]);
        results.push({ tag: tag + "-bundle", url, status: ana.ok ? "analyzed" : "FAILED", out: ana.out.slice(0, 400) });
      }
    }
  }

  const okCount = results.filter((r) => r.status === "captured" || r.status === "analyzed").length;
  const lines = [
    "# REA evidence capture summary",
    "",
    `Generated ${new Date().toISOString()}${REFRESH ? " (refresh)" : ""} · ${okCount}/${results.length} ok`,
    "",
    "Raw Evidence (JSON+PNG) lives in `docs/evidence/raw/` (gitignored by design).",
    "",
    "| capture | status |",
    "|---|---|",
    ...results.map((r) => `| ${r.tag} | ${r.status} |`),
  ];
  fs.writeFileSync(`${OUT}/rea-summary.md`, lines.join("\n"));
  console.log(`\nSummary → ${OUT}/rea-summary.md (${okCount}/${results.length} ok)`);
  process.exit(okCount === results.length ? 0 : 1);
})();

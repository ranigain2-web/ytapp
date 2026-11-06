// repo-activity-audit.mjs — deep-research helper: verify which candidate
// YouTube-client / extractor repos are ACTUALLY active (user's requirement:
// recently updated, not 5-6-months-stale) + license + stars. GitHub API.
import { execSync } from "node:child_process";

const token = (() => {
  try {
    const u = execSync("git remote get-url origin").toString();
    const m = u.match(/:\/\/[^:]*:([^@]+)@/);
    return m ? m[1] : null;
  } catch { return null; }
})();
const H = { ...(token ? { Authorization: `token ${token}` } : {}), "User-Agent": "ytapp-research" };

const REPOS = [
  "shreybaviskar/YouTube-Premium-IPA",
  "yt-dlp/yt-dlp",
  "imputnet/cobalt",
  "TeamPiped/Piped",
  "iv-org/invidious",
  "TeamNewPipe/NewPipe",
  "TeamNewPipe/NewPipeExtractor",
  "polymorphicshade/Tubular",
  "libre-tube/LibreTube",
  "z-huang/InnerTune",
  "vfsfitvani/ViMusic",
  "maxrave-dev/SimpMusic",
  "yattee/yattee",
  "FreeTubeApp/FreeTube",
  "JunkFood02/Seal",
  "yausername/youtubedl-android",
  "Materialious/Materialious",
  "KRTirtho/momentum? no-op",
].filter((r) => !r.includes("?"));

const days = (iso) => Math.round((Date.now() - new Date(iso)) / 864e5);

console.log("== per-repo activity (as of " + new Date().toISOString().slice(0, 10) + ") ==");
for (const slug of REPOS) {
  try {
    const r = await fetch(`https://api.github.com/repos/${slug}`, { headers: H });
    if (!r.ok) { console.log(`${slug} | HTTP ${r.status} ${r.status === 404 ? "(not found)" : ""}`); continue; }
    const d = await r.json();
    console.log(
      `${slug} | pushed ${String(days(d.pushed_at)).padStart(4)}d ago | stars ${String(d.stargazers_count).padStart(6)} | issues ${String(d.open_issues_count).padStart(5)} | ${d.archived ? "ARCHIVED" : "live"} | ${d.license?.spdx_id || "none"} | ${(d.description || "").slice(0, 65)}`
    );
  } catch (e) { console.log(`${slug} | ERR ${String(e.message).slice(0, 50)}`); }
}

console.log("\n== discovery searches ==");
const SEARCHES = [
  ["active youtube clients (pushed since 2026-09)", "youtube client pushed:>2026-09-15 stars:>200"],
  ["metrolist (ViMusic successor)", "metrolist music youtube"],
  ["grayjay", "grayjay"],
  ["background play youtube open source", "youtube background play"],
];
for (const [label, q] of SEARCHES) {
  try {
    const r = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=6`, { headers: H });
    if (!r.ok) { console.log(`search ${label}: HTTP ${r.status}`); continue; }
    const d = await r.json();
    console.log(`\n-- ${label} --`);
    for (const it of d.items) {
      console.log(`${it.full_name} | pushed ${String(days(it.pushed_at)).padStart(4)}d | stars ${String(it.stargazers_count).padStart(6)} | ${(it.description || "").slice(0, 60)}`);
    }
  } catch (e) { console.log(`search ${label}: ERR ${e.message}`); }
}

// Verify deep pagination: home feed chain across many pages
import { itHome } from "../src/lib/innertube";
let total = 0;
let cont: string | null | undefined;
let pages = 0;
for (let i = 0; i < 6; i++) {
  const page = await itHome("all", cont);
  pages++;
  total += page.videos.length;
  console.log(`page ${pages}: +${page.videos.length} (total ${total}), next token: ${!!page.continuation}`);
  cont = page.continuation || undefined;
  if (!cont) break;
}
// search chain too
import { itSearch } from "../src/lib/innertube";
import { itSearchRaw } from "../src/lib/innertube";
const s = await itSearch("minecraft");
let stotal = s.videos.length;
let scont = s.continuation;
for (let i = 0; i < 3 && scont; i++) {
  const p = await itSearchRaw("", scont);
  stotal += p.videos.length;
  console.log(`search page ${i + 2}: +${p.videos.length} (total ${stotal}), token: ${!!p.continuation}`);
  scont = p.continuation;
}

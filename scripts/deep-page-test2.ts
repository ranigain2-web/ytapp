import { itHome } from "../src/lib/innertube";
let total = 0, cont: string | undefined, pages = 0;
for (let i = 0; i < 8; i++) {
  const page = await itHome("all", cont);
  pages++;
  total += page.videos.length;
  console.log(`page ${pages}: +${page.videos.length} (total ${total}), cont: ${page.continuation ? page.continuation.slice(0, 12) + "…" : "END"}`);
  cont = page.continuation || undefined;
  if (!cont) break;
}

# Gauntlet summary — ours vs real YouTube (blind critic)

Generated 2026-11-05T17:16:32.428Z · 4 comparisons · ours=2 tie=0 reference=2 error=0 skipped=0

Reference honesty: `fresh` = captured live this run; `archived` = the committed
bar_mytube_*.png (captured on a clean network — used when YouTube bot-gates
this network into an empty page); `SKIPPED-REF-BLANK` = no valid reference,
surface excluded from the verdict rather than judged against a blank page.

| surface | verdict | ref | gap (biggest remaining) |
|---|---|---|---|
| phone/home | WINNER=reference | archived | Image 1 lacks any actual feed content (video cards, thumbnail grid, chips row), leaving two-thirds of the scre |
| phone/watch | WINNER=reference | archived | Image 2 contains no watch-page UI whatsoever — no player, title, channel row, action chips, or comments — maki |
| phone/search | WINNER=ours | fresh | Image 1's layout is desktop-derived rather than the mobile search pattern (edge-to-edge results, condensed met |
| phone/shorts | WINNER=ours | fresh | Image 1's bottom metadata row is broken — overlapping subscribe button, garbled timestamp "00/0:00" colliding  |

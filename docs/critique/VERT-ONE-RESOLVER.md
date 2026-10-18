# VERT-ONE-RESOLVER critique — VERT-1 · CTR-2 · CMP-1 · VERT-8 (written before code, 2026-10-18)
Base: api main a023ae8e, web main f6c24565. Area docs: C:/dev/docs/vertical has no README (VERTICAL-BACKLOG.md only); worked from
VERTICAL-BOX-AUDIT-2026-10-18.md, NAMING-AND-MEANING.md decision 1, DISCIPLINES.md §6-7, the GOV 7-layer card.

(a) Brief assumptions, checked
- "five separate reads" — TRUE: adopt.js:71 verticalOf(sectors)→pack key; readiness.js:182 sectors[0]; profile.js:337 (and :362, same leak) sectors[0];
  stock-from-chit.js:243 its own SELECT sectors; entity-header.js:84 packFor([identities.vertical]+sectors) — the only join.
- "constitution row" — the constitution table has a `vertical` column (b72; base = NULL) and identities.vertical (b229, default 'general', no writer).
- "else packFor(sectors)" — PARTLY: readiness keys vertical_category by the DECLARED word ('paint','food','textiles'), not the pack key
  ('chemical'). Falling back to the pack key would drop paint's categories. So the resolver returns BOTH: `key` (constitution → identities →
  declared sector) and `pack` (packFor over key + sectors, entity-header's join). adopt keeps comparing pack keys (VB7 changes that, not tonight).
- CTR-2 TRUE: till.html:22127 `if (kotOn() || purposeHas('open_orders')) return false`; master is api tools/tally-connector/till.html (vendor-till.cjs:142).
- CMP-1 TRUE, and wider: cap-readiness.js has 'paint'/'IN' fallbacks at 31, 43, 49, 162 (saveLane WRITES sectors:['paint']), 268, 278, 299, 302.
- VERT-8 TRUE: product-lab.html picks DATA.lists[0] (veg) for every shop; /api/products/lists names no pick.

(b) Conflicts: govresolve is the one reader of the governance tables (govresolve-ctp test) — the constitution-vertical statement lives there.
No setting key added. Box logic unchanged: lotfields (an adopted engine file) is NOT edited — stock-from-chit hands the resolved trade words to its sectors door; readiness/adopt/header read the trade from one place.

(c) Simpler: no new module — widen lib/govresolve.js with verticalFrom (pure) + verticalOf (one readBatch, 3 statements). Blueprints get a
`trades` word list (starter data, owned by the vertical) and forVertical(); the lists route returns `pick`.

(d) Risks: a shop stamped on a constitution with a vertical (e.g. service-desk) now reads that trade before its declared sector in readiness.
Header batch gains one statement (same trip). Twin landing: web carries the till copy → WEB FIRST, then re-run api CI (till-vendor reads web main).

(e) VERDICT: BUILD WITH CHANGES — resolver returns key + pack (not packFor alone); CMP-1 covers the sibling fallbacks in the same file.

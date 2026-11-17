# READ-1 · how human-readable is our own code? — BASELINE (2026-10-15, read-only)
Measured by `tools/readability.cjs` (web repo; acorn AST over `.js/.cjs` and the inline `<script>` of each `.html`). Re-run:
`mkdir /tmp/acorn && (cd /tmp/acorn && npm i acorn) && NODE_PATH=/tmp/acorn/node_modules node tools/readability.cjs --roots web=.,api=../chitbridge-api,engines=../chitbridge-engines --json out.json`
(`--detail <repo> R2|R3|R4` lists every offender). Code measured: web main (includes integrate/1014d), api `integrate/1014d` @ d5dbf93d, engines main.
Scope = MAINT-1: own code only. Excluded: files headed `ADOPTED from chitbridge-engines` (web 29, api 49), web `public/till.html`, `qr.js`, `vendor/`, `*.min.*`, tests, e2e, fixtures, docs, migrations, seed, data. The api's `tools/tally-connector/till.html` is the master, so it counts there.
**Reuse note:** `tools/graph/scan.cjs` (KG1) has names and spans but no params, comments or nesting, and its lexer is hand-written; widening it would mean a second parser inside it, so this is a separate AST tool that adds NO dependency (acorn is loaded from NODE_PATH). `prims.cjs` / `lists.cjs` exist in none of the three repos (searched) — counters written from scratch.

## Numbers (one table)
| metric | web | api | engines | −20% target (web · api · engines) |
|---|---|---|---|---|
| files · functions | 170 · 13,172 | 448 · 11,270 | 54 · 2,108 | |
| **R1** cryptic declarations (1–3 chars, not for-counter / catch `e` / `_` / `$` / x,y) | 15,246 (896 distinct) | 14,935 (913) | 3,655 (418) | 12,197 · 11,948 · 2,924 |
| **R2** named fns >10 lines with no what-line above | 812 of 1,688 (48%) | 420 of 1,409 (30%) | 27 of 249 (11%) | 650 · 336 · 22 |
| **R3** fns >40 lines / >80 lines / nesting >4 | 337 / 120 / 13 | 503 / 183 / 25 | 53 / 17 / 0 | 270·96·10 · 402·146·20 · 42·14·0 |
| **R4** files lacking a header with owns + called-by + flow (of all) | 158 of 169 (none: 2) | 442 of 448 (none: 133) | 54 of 54 (none: 4) | 126 · 354 · 43 |
| **R5** narrative comment lines (blocks >3 lines or ⭐/⚠️) of all comment lines | 18,656 of 23,344 (80%) | 26,334 of 33,539 (79%) | 4,306 of 5,199 (83%) | 14,925 · 21,067 · 3,445 |
| **R6** values repeated in >2 places (numbers / strings) | 2,650 (145 / 2,505) | 2,049 (151 / 1,898) | 676 (85 / 591) | 2,120 · 1,639 · 541 |
Parse failures: 0 in all three. Commented-out code lines: web 50 · api 66 · engines 5.

## How each is counted (so a re-run is comparable)
R1 declarations = vars, params, functions, classes; name length 1–3; dropped: for-header `i j k`, catch params, `_ $ e err x y`, and ~100 conventional abbreviations (`id req res db el ok row key ctx …`, listed in the tool's output) — with those added back, totals are web 18,080 · api 20,202 · engines 4,138. "Uses" = identifier occurrences of that spelling in the files that declare it (scope-blind; an upper bound). R2 = function with a comment ending on the line directly above its statement. R3 length = lines from `function` to `}`; an IIFE module wrapper over 150 lines is excluded and counted separately (web 34, api 10, engines 38). R4 = the leading comment (≤80 lines, before the first statement; for HTML also the first `<!-- -->`) matched for owns / called-by / flow-or-init words. R5 = a comment block (adjacent `//` lines, or one `/* */`) is *narrative* when >3 prose lines or it carries ⭐/⚠️; commented-out code is separate. **Caveat:** ">3 lines" is the brief's definition and is generous — 80% narrative mostly means module headers and `/* */` explanations, not that every one is a story; the ⭐/⚠️ share is the sharper signal. R6 skips |n|≤10, 100, 1000, require paths, property keys, short/common UI words, dates; strings ≥4 chars. Many R6 strings in web are data-table cells (`Control`, `Engine`, `Popup` in cap-cmdb/cap-testing) — a table is a legitimate home; treat the numbers (HTTP codes) as the real offenders.

## R1 · top 30 cryptic names by use count, with a proposed explicit name
Proposed names come from each name's typical initialiser (shown in the tool output); where one letter means two things the proposal lists both — the rename codemod must be per scope, never global.
| name | web uses | api uses | engines uses | proposed (by what it holds) |
|---|---|---|---|---|
| `r` | 6,011 | 6,350 | 1,091 | `response` (web `await api()`), `rows`/`row` (api query), `rule`/`result` (engines) |
| `c` | 4,608 | 3,487 | 788 | `chit`, `column`, `client` (db connection), `count` — by scope |
| `p` | 3,651 | 2,615 | 646 | `product`, `params`, `pack` (engines), `pref` |
| `k` | 2,984 | 2,305 | 905 | `key` (non-loop) |
| `s` | 2,921 | 2,226 | 838 | `state`, `text`, `shop` |
| `d` | 2,788 | 2,648 | 638 | `data`, `detail`, `dateValue`, `delimiter` |
| `n` | 2,562 | 1,872 | 391 | `count`, `number` |
| `a` | 2,306 | 1,795 | 824 | `action`, `amount`, `after` |
| `m` | 2,271 | 1,685 | 649 | `match`, `mode`, `model` |
| `v` | 2,161 | 2,034 | 501 | `value` |
| `t` | 2,102 | 1,697 | 343 | `target`, `title`, `timestamp` |
| `i` (non-loop) | 2,068 | 1,907 | 492 | `index`, `item` |
| `f` | 2,018 | 1,242 | 172 | `field`, `file`, `filter` |
| `b` | 1,901 | 2,870 | 382 | `button`, `body`, `before`, `balance` |
| `o` | 1,859 | 1,549 | 931 | `options` |
| `UI` | 1,632 | – | – | `uiState` (module state object in app.html — rename via alias, not search/replace) |
| `h` | 1,547 | 1,863 | 269 | `host`, `header`, `hours`, `html` |
| `l` | 1,536 | 1,966 | 795 | `line`, `list`, `label` |
| `S` | 1,134 | 874 | – | `screenState` / `store` |
| `g` | 1,097 | 760 | 306 | `group`, `gst` |
| `T` | 1,073 | – | – | `translate` (the string-layer function) |
| `q` | 784 | 553 | 144 | `query`, `quantity` |
| `I` | 753 | – | – | `listInstance` (list-ctl.js) |
| `w` | 688 | 762 | 261 | `word`, `width`, `warning` |
| `it` | 648 | 828 | 226 | `item` |
| `L` | 528 | – | 143 | `ledger`, `lines` |
| `j` (non-loop) | 526 | 930 | – | `json`, `inner` |
| `u` | 494 | – | – | `url`, `user` |
| `st` | 474 | 486 | 127 | `status` |
| `ns` | 435 | – | – | `namespace` (cart.js `'cbcart-'` prefix → `cartIdPrefix`-style) |
Also in api top 30: `esc` (784 uses, 6 declarations — one shared `escapeHtml`, lib/forms.js:306 first), `me` (`signedInUser`), `cur` (`currentRow`/`currency` — decide per file), `who`, `raw`, `B`. Top-30 names are 76% of web declarations (11,516 of 15,246), 71% of api (10,567 of 14,935) and 72% of engines (2,642 of 3,655) — **thirty names carry the whole problem.**

## Top offenders (file:line) — full lists with `--detail`
**R2 uncommented, longest:** web `public/app/cap-testing.js:865 testPaint 623L`, `cap-admin.js:1983 iamGovernedRows 402L`, `testing.html:2445 paintReport 352L`, `testing.html:3009 matrixHTML 293L`, `core.js:925 apiOnce 243L`. api `lib/catalogue-view.js:199 buildPublicView 416L`, `lib/raiseticket.js:218 raise 259L`, `routes/catalogue.js:183 repriceAgainstCatalogue 240L`, `routes/signin.js:415 verify 209L`, `middleware/auth.js:16 auth 210L`. engines `tools/in-snapshot.cjs:19 compute 350L`, `tools/new-pack.cjs:61 packSource 287L`, `src/offers.js:232 apply 103L`.
**R3 longest:** web `public/app/cart.js:71` and `:1911` (two wrapper-sized closures, 1,800 and 1,160 L), `catalogue-model.js:19 705L`, `cap-testing.js:865 testPaint 623L`, `tools/graph/graph.cjs:66 build 520L`, `app/shell.js:246 mount 330L`. api `routes/till.js:132 777L depth7`, `routes/entities.js:1553 634L`, `tools/tally-connector/till.js:1047 595L`, `routes/testing.js:2324 501L`, `lib/catalogue-view.js:199 416L depth6`. engines `src/screen.js:34 924L`, `src/locale.js:49 873L`, `src/rewards.js:43 539L`, `tools/in-snapshot.cjs:19 350L`, `src/tax.js:238 determine 193L`.
**R3 deepest (>4):** web `cap-admin.js:1983` (6), `core.js:925 apiOnce` (6), `app.html:6748 sendChit` (6), `app.html:14410 makeMovable` (6), `cap-workforce.js:216 awFinish` (6). api `routes/till.js:132` (7), `tally-connector/core.js:357 watchOrders` (7), `till.html:5674 drain` (7), `routes/signin.js:415 verify` (6), `lib/move-in.js:437 apply` (6). engines: none.
**R4 biggest files without a full header:** web `public/app.html` (16,486 lines), `app/screens.js` (13,191), `app/cap-testing.js` (8,375), `cap-admin.js` (5,946), `assets.js` (4,484). api `routes/chits.js` (5,565), `routes/testing.js` (3,290), `routes/till.js` (2,740), `routes/entities.js` (2,257, no header at all), `routes/products.js`, `routes/actors.js`. engines `src/offers.js` (1,113), `src/screen.js`, `src/locale.js`, `src/posting.js`, `src/bank-recon.js` — **no engines file has all three** (owns 5 · called-by 2 · flow 4 of 54). Web has owns 93 · called-by 35 · flow 68; api owns 81 · called-by 39 · flow 68.
**R5 longest story blocks (⭐/⚠️):** web `app/signin-ui.js:1` (44 lines), `rail-thread.js:1` (41), `attach-ui.js:1` (31), `cap-testing.js:1`/`:44` (29/28), `cap-admin.js:849` (28). api `lib/handle.js:267` (49), `tools/sim-load.cjs:2` (44), `lib/catalogue-blueprint.js:5` (40), `scripts/sql.cjs:2` (39), `lib/identity.js:5` (36). engines `src/posting.js:7` (59), `src/variant.js:2` (55), `src/gst-returns.js:6` (44), `src/gst-2b.js:6` (41).
**R6 repeated numbers (api, all HTTP statuses and limits):** `400` ×548, `500` ×534, `200` ×455, `404` ×290, `409` ×170, `403` ×154, `503` ×110, `60` ×186, `20` ×146, `120` ×123, `12` ×121, `40` ×119 (first sites `lib/ai.js:330`, `lib/books-cashflow.js:176`, `lib/bill-use.js:133`, `lib/amend.js:211`). Web numbers: see `--json` (`R6.top`). Engines: `12` ×44 (months; `src/bank-recon.js:91`, `src/chart.js:115`), `15` ×33; strings are account-class names (`operating_expenses` ×54 `src/reg-ae.js:87`, `expense` ×43 `src/posting.js:208`, `'2026-27'` ×41 `tools/in-snapshot.cjs:86`).

## The 5 cheapest moves (biggest metric drop per hour of work)
1. **Rename the top 8 letters per scope with a codemod, not by hand** (`r c p k s d n a`: 41% of web / 36% of api declarations). acorn's scope info gives a safe rename; initialiser shape picks the name (table above). One PR per repo, behaviour-neutral, guarded by existing tests; alone it clears more than the −20% R1 target. Add a ratchet so a new cryptic name fails `readability --changed`.
2. **A module-header skeleton, generated, then edited**: owns (from the file's top exports) · called by (KG1 `calls` edges, which already exist) · FLOW line. Start with the 12 biggest files per repo — engines first (0 of 54 complete, so any 11 files make the −20%). Fills R4 mostly from data we already have.
3. **Name the HTTP statuses once** (api `lib/http-status.js`: `OK · BAD_REQUEST · FORBIDDEN · NOT_FOUND · CONFLICT · SERVER_ERROR · UNAVAILABLE`) and codemod the literal in `res.status(…)`: up to ≈2,260 of the api's repeated-number uses vanish (some 200/400/500 are limits, not statuses — the codemod keys on `res.status(`), which alone is the whole R6-number target; a lint then keeps it so.
4. **A what-line on the 100 longest uncommented functions**: they are exactly the R2 worst list; one line each (WHAT + WHY). ~100 lines of comment move web R2 from 812 to ≈710 and api 420 to ≈320 — most of the −20%. Do it in the same PR that splits the function (also lowers R3).
5. **Move ⭐/⚠️ stories out of code into the doc card** (leave a 1–2 line why + a `CARD` pointer): the ten longest story blocks per repo are 30–59 lines each; ~400 lines per repo out of ≈18–26k narrative lines is small, so also cap new header comments at 12 lines in the ratchet. Do second-last: it needs the doc cards (`C:/dev/docs/<area>/functions/`, absent on this runner).
Not cheap (by design left out): splitting the 1,000+-line closures (`cart.js`, `routes/till.js`, `engines src/screen.js`/`locale.js`) — each is its own round; the baseline names them so the ratchet can stop them growing.

## Limits of this measure (said plainly)
Static, name-based; scope-blind for "uses"; R4/R2 test for words/presence, not for whether the text is *good*; HTML pages' non-JS-script blocks (JSON, templates) are skipped; the web `public/till.html` is excluded though users read it (its master is counted in the api). `docs/FIELDS.md`, doc cards and `C:/dev/...` were not reachable here.

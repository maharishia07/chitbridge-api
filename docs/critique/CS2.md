# CS2 critique — country at first-time setup readies the whole shop; fixed once a product or transaction exists
**VERDICT: BUILD WITH CHANGES** (listed under e).

(a) What the brief assumes, checked against the code
- "a second save with a DIFFERENT country is refused always" — TRUE once the step is done: `lib/country-setup.js:122` refuses on `cur.done`, whatever the shop holds. Before `country_setup_at` it is allowed. CS2 moves the line to `isConstituted`.
- "the time zone is not derived" — TRUE: `country-setup.js:50,80` only read `identities.timezone`; M196 writes it at register from the browser clock (`routes/entities.js:331`). M210 `books-hooks.zoneOf` (lib/books-hooks.js:205) reads it, COUNTRY_ZONE has no AU (multi-zone).
- "the chart comes from accounts-packs, which has no AU or AE chart" — TRUE and WORSE: api `lib/accounts-packs.js` is engines v1.20.0 (PACKS = {IN}); `lib/books.js:858 enable()` calls `packFor('AU')` → the INDIA chart with `fallback:true` nobody reads. The engines' accounts-packs (v1.21+) is already the facade over `regulation.list()` — the fix is to ADOPT it (+ `chart`), not to widen a second time.
- "party-fields SCHEMES has no ABN" — TRUE (`lib/party-fields.js:26`); reg-au `abn.check` and reg-ae `trn.check` exist in the adopted packs (lib/reg-au.js, lib/reg-ae.js v1.39.0).
- "formats follow India where hard-coded" — TRUE; counts in the PR (web: till.html 11 en-IN · 64 ₹; app.html 23 ₹; cart.js 23 ₹; api lib: 73 files with INR/GSTIN/₹, most are the money engine's own fallback). The ONE helper exists: `CBLocale` (money · number · date, hydrated from the shop's country via `REGIONS`). AU is absent from `REGIONS` (engines src/locale.js:97) — CL1's finding, item 6, TRUE.
- UNKNOWN: whether any live non-Indian shop has posted entries under the India chart (b299 backfilled Indian shops only).

(b) Conflicts with DECISIONS-level rules and existing constructs
- DECISIONS 2026-10-03 "a country change is a NEW entity" is kept for the constituted shop; the owner's 2026-10-13 sharpening (free before any product/transaction) is the new line. No conversion path is built.
- One place per thing: `timeZones` and `locale` are Part-A members of docs/COUNTRY-STANDARD.md whose HOME is still govcontext.js / locale.js (a named Part-B breach) — CS2 puts them on the packs (engines) so the step reads the pack, never a second table.
- The engines' `tests/in-snapshot.test.js` fails on main already (receivables 28→29, since v1.39.0) — not touched here.

(c) Simpler way: none for the constitution (one EXISTS query over catalogue_items · chit_header · journal_entry, `schema.hasTable` for the ledger). For (3) the simpler way IS the adoption — zero new chart code.

(d) Risks
- Adopting accounts-packs ≥v1.21 while posting/ledger/bookpack/period stay at v1.20: the chart, year and codes come from the pack (what CS2 needs); AU/AE POSTING RULES still name India's roles (output_cgst…) so a non-Indian sale parks in books_outbox, named — the engines' core-vs-packs rollout (posting · ledger · bookpack · period → v1.42) is a separate one-engine-at-a-time round. A v1.20 reader of `pack.fy_start_month` (lib/period.js:85, books.enable) gets it from the adapter (`books-engines.packs()` fills it from `fiscalYear`).
- Re-seeding a chart that was switched on but never posted: deletes books_account/books_period/books_counter rows of that shop and runs enable() again in the SAME transaction — guarded by isConstituted (no journal_entry) so nothing posted can be touched.
- Twin landing: engines v1.42.0 (tag) → api (adopts) → web (adopts the tax bundle; the step reads the server's `countries`). The web works without the api change (falls back to CBLocale.REGIONS, the old behaviour).
- No migration: identities.timezone (b176) and the b299 columns already exist. New response keys get their docs/FIELDS.md rows.

(e) Changes to the brief: (1) the constituted check is `isConstituted(h, entity)` on a db handle (it reads tables), not `(entity)`; (2) item 3 is an adoption + the adapter widening, not a new chart reader; (3) item 5 is done on the till (vendored from api tools/tally-connector/till.html) and the web's shared helpers; the rest is the PR's row list, not rewritten this round; (4) the country list on the step comes from the server (`countries` = `regulation.list()`), which is CS1's rule, with CBLocale.REGIONS only as the offline fallback.

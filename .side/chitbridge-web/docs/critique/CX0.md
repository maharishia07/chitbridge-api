# Critique · CX0 — Country coverage audit (IN · AU · AE) across the product, before any code

**VERDICT: BUILD WITH CHANGES** — audit + COUNTRY-COVERAGE.md as briefed; fixes limited to gates and labels that read the pack or the shop's country; the simulator's AE row is a sim-load change, not a sim-plan one (why in (c)).

## (a) What the brief assumes, checked
- "Country-specific is completed" — TRUE for the ENGINES (reg-in · reg-au · reg-ae registered; COUNTRY-MATRIX v1.41.0: IN 72 ✅/15 ❌, AU 76/14, AE 80/8 — the ❌ are MAY members: taxId for IN, locale/timeZones for AU, formats.* for all). UNKNOWN for the api and the web until this audit: the api adopts engines per engines.lock; the web's vendored `tax-engine.browser.js` carries reg-in/au/ae too (api lib/tax-engine.browser.js:487 has msmeCheck).
- The country is a real, gated fact — TRUE: CS1 `lib/country-setup.js` (no silent IN fallback; `identities.country` the one home; books routes refuse a pack-less country with 422 + sentence, api routes/books.js:51,84,112).
- Everything downstream reads that fact — FALSE in places found before the sweep: till `docCountry()` → `'IN'` when the shop has none (public/till.html:5852, :18129); `tax-lines.invoiceFor` currency default `'INR'` (api lib/tax-lines.js:150); `bookpack` pack default `'IN'` (api lib/bookpack.js:110); `books-hooks.zoneOf` "nothing known → India" (api lib/books-hooks.js:190). These are the brief's "ungated India assumption" class; the sweep classifies every one.
- MSME is India-only and hidden elsewhere — TRUE at the engine: `receivables.msmeFlags` reads `pack.checks.msme` (api lib/receivables.js:359-360), only reg-in carries it. The SCREEN gate (finance.html / cap-finance.js) is checked in the sweep.
- Tally is India — TRUE as a feature (Tally XML in reg-in `export`; no AU/AE `export`, matrix A6). What an AU/AE shop SEES on the connector screen is checked in the sweep.
- `sim-load.cjs --country` loads IN and AU — PARTLY: AE is REFUSED (api tools/sim-load.cjs:75); the loader's year (`fyOf` April–March, :87-89) and clock offset (+05:30 / +10:00, :86) are hard-coded even for AU, so AU books are stamped with India's year. The plan (`sim-plan.cjs`) is rate-agnostic data (rates re-mapped at :294) — no plan addition is needed, only a country table in the loader.
- Payroll is out of scope per country — TRUE in the packs (`scope.out.payroll` in all three, matrix A9); whether employees.html SAYS it is checked.

## (b) Conflicts with DECISIONS-level rules and existing constructs
- Country rule (13 Oct): fixed once a product/transaction exists; no conversion — the audit must not propose "convert on view". A fix is: read the pack (`regulation.packFor(country)` · `CBTax.packOf`), or a `CBLocale` helper, never a new per-country `if`.
- One place per thing: the words for heads (CGST/SGST/IGST vs GST vs VAT) live in `pack.taxHeads` + `tax.scheme`; the statement words in `pack.sch3`/`presentation.labels`; the tax-id word in `pack.taxId` (gstin · abn · trn). A screen that spells them is a copy. The audit names the pack member for each row, not a new table.
- Known Part-B breaches are already named by the Standard (locale.js REGIONS, govcontext ZONES, profilemap India address, jurisdiction.REGISTRATION) — they are listed as ⚠️ with the Standard's own sentence, not re-reported as new bugs.
- Engines are serial and this round does not own them: anything that needs a pack member (e.g. IN `taxId.gstin`, AU `locale`, `formats.phone`) is written up as an engines request, not built.

## (c) A simpler way
- The simulator: one `COUNTRY_ROWS = { IN, AU, AE }` table in sim-load.cjs (currency · fy start · UTC offset · standard rate · tax number · sample TRN/ABN) replaces the scattered `COUNTRY === 'AU' ?` ternaries; sim-plan.cjs stays untouched (its rates are the DRAW; the loader maps them to the pack's menu, as it already does for AU). AE's fiscal year is January: `fyOf` must take the start month from the table, which also fixes AU.
- The audit table is written ONCE (web docs/design/standards/COUNTRY-COVERAGE.md) and the api is pointed at it; no twin doc.

## (d) Risks
- Volume: ~1,900 India-word hits in web public/ and ~800 in api lib/ + routes/ (the count table in the report). Many are comments and engine citations; the classification is per CODE line, so the fan-out reads context, not matches. A missed row is a missed row, not a wrong fix.
- The trivial fixes touch till.html — VENDORED from api `tools/tally-connector/till.html`: the master changes there and the copy comes via `scripts/vendor-till.cjs`; twin landing api → web. If the vendor script cannot run offline, the till fix is deferred to the bug table rather than hand-edited (BRIEF-RULES 2).
- `sim-load.cjs` AE needs `/api/books/enable` to accept the country (it takes none, :269-270: AU goes through `B.enable(... { country })` directly) — AE follows the AU path; no route change.
- Other rounds: K1 (docs guard), TO1b (tasks) touched docs/ and tasks.html on main this week; this round's docs are new files, the code fixes are single lines.

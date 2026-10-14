# T2-NATDEF — critique before build (no India for an unstated country · one date reader)
(a) Assumptions, checked (api @ 1b65db4a; ../chitbridge-docs is EMPTY on this runner — baseline P, BACKLOG [STD3], RECONCILIATION not readable;
    counts below measured from code, lib+routes+till master, comment lines included as the grep sees them):
  - "`|| 'INR'` sites exist in api lib/routes and the till" — TRUE: 49 (37 lib/routes + 12 till). P's 94 also counted web/vendored copies — unknown.
  - "`|| 'IN'` sites" — TRUE: 11 (9 api + till docCountry:5889, 18289). tax-lines.partyOf 'IN' (tax-lines.js:70) is a state-split test, not a default.
  - "books-engines ymd is THE date reader" — TRUE (books-engines.js:95). "books-hooks dayOf for a moment" — TRUE (books-hooks.js:250).
  - "NO_MONEY / NO_COUNTRY sentences exist" — TRUE: country-setup.MONEY_UNSTATED (country-setup.js:53), regulation NO_COUNTRY (regulation.js:181).
  - "a chit's currency envelope reader exists" — PARTLY: tax-lines.currencyOf(seller) (tax-lines.js:167) reads regulation.lookup, whose
    no-country answer is the DEFAULT (India) pack — the engines' lenient form (regulation.js:143, vendored).
  - "48 toISOString().slice(0,10)" in lib/routes — TRUE, but 17 are VENDORED engine copies (ledger, bookpack, receivables, chart, rollup,
    tax-slab, tax-engine.browser) — rule 12: engines are serial and not this round's; left as is, outside the guard, named for the coordinator.
  - Hidden sibling: books-hooks.zoneOf ends `|| COUNTRY_ZONE.IN` (books-hooks.js:224) — every `dayOf(x, s || 'IN')` was India twice. In scope.
(b) Conflicts: "refactor-only" vs removing a default — the brief names the fix, so behaviour changes ONLY for an unstated country/currency.
  - regional.FALLBACK_CURRENCY='INR' (regional.js:73) feeds money.stampItem, which REFUSES a null currency (422 in technical words) — removing it
    would break catalogue writes for an unstated shop without shopkeeper words. Deferred, named in the report (sibling of this round).
(c) Simpler: ONE currency reader `stated(code)` (uppercase ISO-3 or null) beside MONEY_UNSTATED; ONE `addDays` in books-engines for the
    epoch-day arithmetic three files typed privately; the till gets ONE `shopCur()` (null, never INR). Unstated → the money is printed without
    a symbol (r2 · toFixed), the zone is UTC (neutral, no country's), the snapshot keeps money_why for the words.
(d) Risks: data — a frozen invoice/chit minted with currency NULL instead of 'INR' for an unstated shop (columns are nullable, b400);
    money — decimals(null)=2, identical to INR, so no amount moves; books already refuse an unstated ledger (books.enable NO_MONEY);
    twin landing — till change is web+api, same branch, WEB FIRST (api till-vendor reads web main); no migration (b442–b444 unused);
    other rounds touching till.html/books.js may conflict on merge.
(e) VERDICT: BUILD WITH CHANGES — vendored engine copies excluded (named for an engines round: regulation.lookup default pack, tax-slab
    asOf, ledger/bookpack/receivables ymd_); regional.FALLBACK_CURRENCY deferred (needs catalogue refusal words); zoneOf India fallback included.

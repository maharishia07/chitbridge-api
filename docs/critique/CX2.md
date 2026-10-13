# CX2 · Accounts for IN · AU · AE — critique before build (2026-10-13)

(a) What the brief / coverage doc (web docs/design/standards/COUNTRY-COVERAGE.md §1 rows 68-79, §2 A1-A9) assumes, checked:
- A1 "accounts-packs is v1.20, `packFor('AU')` = India's chart" — FALSE now: CS2 adopted accounts-packs v1.42 (registry facade, `lib/accounts-packs.js:53`, `lib/books-engines.js:63`). TRUE for the rest: posting · ledger · bookpack · period still v1.20 (`engines.lock.json`), the pre-pack code (set-off heads, statement form, depreciation law typed for India; engines CHANGELOG b2-b7 moved them into the pack at v1.23-v1.28).
- A2 "BAS / VAT201 unreachable" — FALSE now: `B.packOf({country:'AU'}).returns.id === 'BAS'`, AE `VAT201` (`lib/books.js:52`); the web paints the return first (`app/cap-period.js:454`).
- A3 `|| 'INR'` ×15 — TRUE (`lib/books-period.js:102…497`, `routes/books.js:97`, `books-manual.js:220`, `books-cashflow.js:170`). The "refuse when empty" half is already the gate: no books route runs without a country (`routes/books.js on` → `CS.gate`).
- A4 April months — TRUE (`app/cap-books.js:987, 1320, 1716, 1838`; `app/cap-period.js:461-462`). And CX0's `SESSION.country` line (`accounts.html:658`) never fires: `/health` sends no `country` (`routes/books.js:175`).
- A5 Income-tax WDV note — TRUE (`books-period.js:186`, default basis `'proprietor'`, a key AU/AE packs do not have; web `cap-period.js:146` knows two bases).
- A6 AU day cut at IST — TRUE (`books-hooks.js:197,209` `COUNTRY_ZONE` has no AU, falls to Kolkata); every pack now carries `timeZones` (engines v1.42).
- A7 "more than a rupee" — TRUE (`books-hooks.js:398,429`).
- A8 bank presets — TRUE, but the web's `engine/bank-recon.js` is v1.18 and bank-recon is being changed by round BR1 right now (tags v1.44.0/1 on a side branch).
- A9 `tally.why` never painted — TRUE; retention 8 y (`books-pack.js:119`) vs `pack.retentionYears` AU 5 / AE 5.

(b) Conflicts: a basis WORD (Div 40 / IAS 16) is not in any pack — typing it in the api is copy, not a rule (the basis itself stays the pack's); engines request queued. Retention: the area truth says a ≥ 8-9 y product floor — keeping AU/AE detail 8 y outlives their 5 y law, so it is NOT shortened (deleting earlier is a business call, not a fix).
(c) Simpler: A1 is a PIN MOVE (tools/adopt.cjs), no engines release; A4 needs no new route — `fy_start_month` and the CS status ride the `/health` call the page already makes (0 new trips).
(d) Risks: posting v1.20→v1.42 changes India's answers? — engines in-snapshot froze IN against v1.20 (b1-b7 "same answers"); the api books tests prove it here. bank-recon left to BR1 (two rounds on one engine = the v1.35/v1.38 dead-tag trap). No migration (b337-b339 unused). Twin: api first, then web (web reads two new optional keys, tolerant of their absence).
(e) VERDICT: BUILD WITH CHANGES — A1 = pin move (no engines tag); A2 closed by CS2/BAS1 (doc updated); A8 left to BR1 (queued); retention kept at the floor; A3-A7, A9 (tally.why) built.

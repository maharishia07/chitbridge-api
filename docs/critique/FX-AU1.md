# FX-AU1 · critique before build (2026-10-14)

**(a) What the brief assumes, checked**
- F7 "registration leaves the drop to the owner" — TRUE, and sharper: routes/entities.js:89 `registerNew` INSERTs no country, so the DB default 'IN' (000_baseline:577) lands; the browser's guess arrives only at verify, where routes/signin.js:481 `COALESCE(country, $2)` can never fill it (it is not NULL). The guess is lost on every non-Indian sign-up, not only when the owner leaves early.
- "settings shows India 'your registration'" — TRUE: web app/cap-country.js:123 labels any un-sourced server value "your registration"; settings.html does not load govcontext.js, so the CX0 clock override (cap-country.js:129) never fires there.
- F8 "fiscal_period stays India's" — TRUE, root cause: lib/books.js reseedUnposted relabels only when the old year LABEL differs (`oldFy … filter(y !== fy)`); IN and AU both call Oct-2026 "2026-27", so April–March rows stay (AE '2026' differed, so the existing test passed).
- F8 "chart keeps 7 CGST/SGST/IGST" — TRUE but they ARE parked (books-store parkChart: active=false, role NULL); GET /api/books/accounts (routes/books.js:209) returns parked rows and the web paints them. No DELETE grant exists (b272:118) — "replace" = park + hide, never delete.
- "an account with a journal line is kept and named" — VACUOUS here: the correction is refused when ANY journal_entry exists (country-setup.constitution, reseedUnposted BOOKS_CONSTITUTED), so no parked account can hold a line. No extra code; stated.
- "refuse in words if anything is posted" — ALREADY TRUE (save → 409 COUNTRY_CHANGE_IS_NEW_ENTITY). But save wraps reseed in trySavepoint, which SWALLOWS a failure and still saves the country → not one transaction. Fix: call it directly (no-ledger is already `null`, settingOf 42P01).

**(b) Conflicts** — none with DECISIONS: no conversion path (nothing posted); country pack decides the year (A.fyRange/periodRange, one calculation); setup_source is an existing key (b299, entity_governance) — no new key; the server computes the source words from the evidence, the browser's label is not trusted.

**(c) Simpler** — fix at verify only (stop COALESCE losing to the default) would also land AU. Brief asks registration; doing both: register stores the guess explicitly, verify unchanged.

**(d) Risks** — ~40 e2e/API fixtures register WITHOUT a browser context: writing NULL for "no guess" would turn their Indian shops into NO_COUNTRY mid-walk. So: a guess is written explicitly; NO guess = the column is not named (today's behaviour) and NO source is stored; the screen then says "not confirmed yet", never "your registration". Twin landing: api first (web sends `context` at register; an old api ignores it). No migration, no engines change.

**(e) VERDICT: BUILD WITH CHANGES** — (1) no-guess registrations keep the default but carry no source label; (2) "kept and named" is vacuous (refusal precedes it); (3) parked rows hidden from the chart read, not deleted (no DELETE grant); (4) reseed no longer swallowed (one transaction).

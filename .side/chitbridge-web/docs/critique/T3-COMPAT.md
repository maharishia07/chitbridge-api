# T3-COMPAT critique — "Works with" on the Standards page. Written before any code.
(a) What the brief assumes, checked:
- STANDARDS-GAP-2026-10-14.md + the area homes (C:/dev/docs/…) — UNKNOWN: ../chitbridge-docs is empty on this runner; built from the code and the brief's inline DISCIPLINES.
- "compat.json is the data, no second list" — TRUE: public/data/compat.json (12 rows) is read once by standards.html:514 and mapped by stdCompatRows (cap-standards.js:1226) as Kind = Compatibility.
- "Tally, Zoho, Xero, CSV, Beckn-compatible …" — PARTLY: Tally ×5, Zoho, Xero ×3, QuickBooks, NetSuite, CSV are rows; Beckn is NOT a compat row (only the register's std rows beckn-core / ondc-* at cap-standards.js:733); GoFrugal has an adapter (api tools/tally-connector/adapters/gofrugal.js) but no row.
- "each row = what moves, direction, status, evidence (code + test)" — PARTLY: service/status/proof_ref exist; NO direction field, and code and test are mixed in one free-text proof_ref.
- "a tab" — TRUE as a construct: CBList already has saved views as tabs (list-ctl.js:487 `views`, used by cap-crm.js:475). No new tab style needed.
- "Home door Compatibility → built" — TRUE: manifest.json:46, state coming, route null, facts null.
- "the workshop door in app.html stays reachable" — FALSE: app.html has no Compatibility screen (N04 never built); nothing to keep or move.
- "Home card shows the server's facts" — no /api/facts read covers compatibility; compat.json is a static web file. A facts route would be a second store (the api would need its own copy).
- "small app loads cap-*.js through page-frame" — standards.html already loads cap-standards.js directly with its own frame (not page-frame); kept as is.
(b) Conflicts: one list → the tab is a FILTER of the same CBList (Kind = Compatibility), not a second list or page. One shape → `dir`, `code`, `test` are new keys on compat.json rows; their dictionary entry goes in the file's own `about` (web has no docs/FIELDS.md). Beckn: the compat row cites the same code+test as beckn-core and states the same recorded decision (Beckn-compatible, not ONDC-registered) — not a second claim.
No money, no engines, no country default, no server route, no migration (b490–b492 unused).
(c) Simpler: no new screen, no new component — a `views` tab on the existing mount + a pinned "Moves" column shown only in that view + #works-with selecting it. Home facts stay null (honest: no figure invented) rather than a new api route.
(d) Risks: e2e/standards-page.cjs counts every row and measures the head — the views row adds height (run it). Other rounds touching standards.html / manifest.json (merge on manifest line only). Evidence must be real paths — each checked to exist in ../chitbridge-api.
(e) VERDICT: BUILD WITH CHANGES — the tab is a CBList view (no new list); add `dir`/`code`/`test` to compat.json (dictionary in `about`); add Beckn and GoFrugal rows; Home card facts stay null (no server read exists; noted); no workshop door to keep.

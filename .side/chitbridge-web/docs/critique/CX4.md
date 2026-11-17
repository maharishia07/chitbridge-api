# CX4 critique — CRM, shop and catalogue for IN · AU · AE (written before any code, 2026-10-13)

(a) Assumptions checked against the code
- CX0's api half is on api `main` — FALSE: api `round/CX0-38327916667` is unmerged; api main has CS2 (party-fields ABN/TRN check, `lib/party-fields.js:30-35`). CX4 branches from api main; the one shared line (`routes/identity-docs.js:72 schemesFor`) is written byte-identical to CX0's so the two merge clean.
- R1 "a party's tax id is never checked" — PARTLY: ABN/TRN are checked since CS2 (`party-fields.js:33-34`); GSTIN is not. `profile-map.gstinChecksum` (`lib/profile-map.js:50`) is the one GSTIN check — reuse it.
- R3 the client's country is trusted — TRUE (`routes/identity-docs.js:99` `req.query.country || 'IN'`, `:161` `req.body.country || 'IN'`); `app/cap-iddocs.js` sends `SESSION.country`.
- R4 an ABN's first digits read as a state — TRUE (`lib/profile.js:286, 294, 302`); `missing: gstin` and the fix sentence name India's id.
- S1 the shop payload carries no country — TRUE (`lib/catalogue-view.js:533-535`). S2 UPI gated on `upi_id` only, "GSTIN" typed — TRUE (`shop.html:589, 669`).
- S3 "`|| ''` → the locale engine shows the code" — FALSE: `CBLocale.money(n, '')` itself falls back to ₹ (`app/locale.js`, checked by running it). Changing the call sites' `|| 'INR'` alone changes nothing; the locale fallback is CX7's (L1). Only `myCur()` (`app.html:2096`) can read the pack now.
- S4 orders in INR — TRUE at `routes/catalogue.js:1061` (`entity.currency_code || 'INR'`) and `routes/chits.js:598`. chits.js:598 is the same line as CX5's N2 (currency on a chit) — left to CX5 to avoid two rounds editing it.
- C2 "Code / HSN", the exposure switch "HSN code", the "GST Rule 46" note — TRUE (`app.html:12749, 13007, 13648, 13928`); `pack.tax.hsn_digits` is IN's own (checked: AU/AE undefined).
- C4 no VAT header alias — TRUE (`lib/csv-preflight.js:60`).

(b) Conflicts with rules / constructs
- Rule "read the pack, never a second `if (country === 'IN')`": every gate reads `regulation.packFor` / `shopReg()` — the web gets one helper beside `packSplitsByState` (`packHasHsn`). The shop page has no pack engine (250 KB `tax.js`); the SERVER reads the pack and sends `country` + `tax_id_word` and withholds `upi_id` where the pack has no UPI (FIELDS entries in the same change).
- R1 changes India's answer for a WRONG GSTIN (refused in words) — that is the IN ❌ the doc lists; a valid GSTIN is byte-identical. One existing test fixture holds a malformed GSTIN and is corrected.

(c) Simpler: gate UPI at the source (catalogue-view withholds `upi_id`) instead of shipping the pack to the shop page.

(d) Risks: twin landing (api first: the web reads `shop.tax_id_word` with a GSTIN fallback, so web-first is harmless); R1 refuses a stored-elsewhere bad GSTIN only on its next edit, never on read; no migration (b340-b342 unused); engines not touched (R2 · C1 · C3 queued).

(e) VERDICT: BUILD WITH CHANGES — S3 limited to `myCur()`; chits.js:598 left to CX5 (N2); subject dates (en-IN) left to CX7 (REGIONS has no AU); R2 · C1 · C3 queued as engines requests.

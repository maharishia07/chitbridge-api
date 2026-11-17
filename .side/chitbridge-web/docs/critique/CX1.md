# CX1 critique — Till and the bill for IN · AU · AE (COUNTRY-COVERAGE §2 rows T1–T7), written before any code

**(a) What the brief assumes, checked**
- The coverage doc is on main — FALSE: it is on `round/CX0-38327916667` (web #170, api #129, both OPEN). CX0's till helpers (`shopPack · taxIdLabel · schemeWord · packSplitsByState`) exist only there → CX1 branches FROM CX0 in both repos.
- `pack.taxInvoice` is never read (T1) — TRUE: api `lib/reg-au.js:269`, `lib/reg-ae.js:352` define it; no caller in till.html, tax-lines, tax-copy. reg-in has NO `taxInvoice` member (`grep taxInvoice lib/reg-in.js` = 0) → India's slip cannot change: the new reader returns null for IN.
- The till can reach it offline — TRUE: web `public/engine/tax.js` bundles CBRegulation with reg-au/reg-ae (`buyer_identity_from_minor` present); till `shopPack()` reads it.
- A place for the buyer's ABN/TRN "beside cust.gstin" is needed — PARTLY FALSE: the snapshot customer already carries `gstin` from `identities.gstn` (api `routes/till.js:400`), the generic registration column CX0 writes ABN/TRN into, and the chit already has the slot `business_json.customer.gstin` (read by `lib/books-hooks.js:431`, `lib/tax-copy.js:76`). No new key: the counter fills the slot that exists.
- Counts use `toLocaleString('en-IN')` (T2) — TRUE: till.html `:6778, 14213, 18206`. Voice list fixed (T4) — TRUE: `:3756`, `langLabel :26425`, default `'en-IN'` ×5.
- T5 — TRUE: `routes/invoice.js:33,44`, `lib/tax-lines.js:151` (`|| 'INR'`), `lib/tax-copy.js:77` (`|| 'IN'`). T6 — TRUE: `lib/bill-privacy.js:61-63` (en-IN grouping for every currency).
- T3 (docnumber July year) and T7 (AU cashRounding) need engines — TRUE; this round does NOT own engines (rule 12) → queued in the report, nothing built around them.

**(b) Conflicts with rules / constructs**
- One reader of the pack: everything goes through the till's own `shopPack()` (till has no helpers.js) and api `regulation.packFor` — no new `if (country === 'AU')`.
- Counts: the locale engine's `moneyTag(currency)` is the one "which convention writes this shop's figures" table; a second en-IN/en-US switch would be a copy. Server: `lib/bill-privacy` has no locale engine of its own (api `locale.browser` is a v1.4 page global) — one tag choice, INR → en-IN else en-US, the same rule as `MONEY_LOCALE`; named in the PR as the copy it is.
- A missing buyer identity on an AU bill ≥ A$1,000 — the honest construct already exists: `bill.not_invoice` ("BILL — NOT A TAX INVOICE", M41). Reused with a reason value, never a second title path.

**(c) Simpler way** — none smaller for T1: one reader (`invoiceRule`) + the existing title rule + one buyer row on the slip. AE's FULL invoice also wants the buyer's ADDRESS; the snapshot carries none (no address on `identities`) → said, left for CX4 (party address shape, R2).

**(d) Risks** — India byte-identical: every new branch is gated on a pack member India lacks (`taxInvoice`) or on the INR/IN path unchanged; proven by api tax-truth / tax / till-* tests and the web till harnesses. Twin landing: till change → api master + web vendored copy, same branch; order CX0 (#129/#170) → CX1, web first. CX0's api branch already conflicts with main (books.js, party-fields.js vs CS2) — CX0's to resolve; CX1 touches neither file. No migration (b328–b330 unused). No engines change. Other rounds on till.html (any CX*/WX*) — vendor-till re-run resolves the copy.

**(e) VERDICT: BUILD WITH CHANGES** — (1) stack on CX0; (2) no new buyer key, fill `customer.gstin`; (3) AE buyer address and T3/T7 left with their reason; (4) the till walk is the existing till harness with an AU and an AE shop (no new screen).

# Critique · W2-BOOKS (written before any code, 2026-10-15) — A2: retention per pack (BK-RETAIN) · AU/AE close & pay (BAS-PAY)

## (a) What the brief assumes, checked
- "Retention is a fixed 8 years" — TRUE: api `lib/books-pack.js:123` `addYears(…, 8)` ("per country pack later"). engines: reg-au.js:599 and reg-ae.js:735 already carry `retentionYears: 5`; reg-in has NONE (docs/COUNTRY-MATRIX.md:128 ❌) — the India number must enter the IN pack, not stay typed in the api.
- "AU/AE cannot close and pay in the app" — TRUE: `lib/books-period.js:329-331` `indiaOnly` refuses gstClose/gstPay (NOT_FOR_COUNTRY); `:38` HEADS = cgst… and `:294-297` read `'output_' + head` ledger ROLES — India's rules sitting in the core. web `cap-period.js:453-470` paints the return for AU/AE and the India-shaped month form only when there is no return.
- "Engine changes are needed" — PARTLY: the engine ALREADY does the sums for any pack — posting.js:363-383 (tax_setoff · tax_payment read `pack.setOff · payHeads · taxLedgers · messages`), :761 gstSetOff; reg-au.js:388 and reg-ae.js:535 carry their set-off. Needed in engines: IN `retentionYears`/`records` (Companies Act s.128(5): 8 FY; CGST s.36: 72 months) and ONE per-pack word for the payment reference (IN challan/CPIN · AU ATO payment reference · AE EmaraTax reference) so no screen says "challan" to an AU shop.
- "INT6/INT7a may have closed part" — FALSE: both lines above are still on main (13b8b65c web · 6eef061c api).

## (b) Conflicts with DECISIONS-level rules
- Country packs: a country = one pack; the core never holds a country rule → HEADS / `'output_'+k` / `['cgst','sgst','igst']` in books-period.js are replaced by the pack's `taxHeads` + `taxLedgers` (one reader `headsOf(pack)`). India's answers unchanged (the IN contract examples hold byte-for-byte; books-rcm test is the proof).
- The server's may/why: a refusal ships a CODE (RCM_NETTING_NOT_BUILT · PERIOD_NOT_ENDED · NOT_FOR_COUNTRY stays for a pack with no `returns`).
- One shape per slot: no new table/column — `books_pack.delete_after` exists (b274); the manifest gains `retention { years, from, cite, floor_years }` (docs/FIELDS.md row). gst/close answer gains ADDITIVE keys for a non-IN pack (`form · heads · period{…} · ref_label · carried_kind`) — IN untouched. books-todo.js:69 (India's GST to-do line, GOV-AU1) stays India-only by its own decision.
- Money: minor-unit integers; the engine's taxSetOff is the one calculation; the api converts once (toRupees/toMinor, as today).

## (c) A simpler way
- No new route, no migration (b691-693 unused): POST /gst/close and /gst/pay are WIDENED. For AU/AE the body names the RETURN period the way GET /returns names it (`period: '2026-Q1' | '2026-02/2026-04'`, with `frequency`/`stagger`) — one period table (gst-returns.periodsFor via `returnPeriods`), so the web's return screen closes and pays "this period" beneath the boxes with the same card (`peGstSetOff` · `peGstPayForm`, heads from the server — no second form).

## (d) Risks
- Engines are SERIAL: tags fetched; v1.48.0 above v1.47.0. The IN snapshot guard (tests/in-snapshot.test.js) must not move: only ADDITIVE keys on reg-in (`retentionYears`, `records`, `messages.paymentRef*`).
- AE reverse charge: the engine pays RCM in cash (India's s.49(4)); the AE pack (reg-ae.js:531) says Box 3 is netted on the form. The figures agree whenever due tax ≥ recoverable tax; the one edge (an RCM balance AND recoverable > due) is REFUSED with a code until the engine's tax_setoff nets rcm_vat — described in the report, never a second answer in the api.
- A pack with no `retentionYears` → `delete_after` null, the manifest says "no period stated by the <id> pack", logged — never a national number. The platform's 9-year records floor (policy.RECORDS_FLOOR_YEARS, CO3) still governs any sweep; the manifest names it beside the pack's years.
- Contract: web-api.json examples for gst/close · gst/pay stay the IN ones (new keys optional) → `--write` then a byte copy to web. Twin landing: engines tag → api (pins reg-in/reg-au/reg-ae/regulation → 1.48.0, adopted by tools/adopt.cjs) → web (works against an older api: the close card paints only when the server answers `heads`).
- Other rounds touch cap-period.js / books-period.js (INT7a landed) — edits stay inside the GST section (§4) and the return's paint.

## (e) VERDICT: BUILD WITH CHANGES
1. The AU/AE close is per RETURN period (the pack's table), not a month. 2. The AE RCM edge is refused in words with a code (engine netting named in the report). 3. No `retentionYears` → null + said, never 8. 4. The payment-reference word is the pack's (engines v1.48.0), one word per country.

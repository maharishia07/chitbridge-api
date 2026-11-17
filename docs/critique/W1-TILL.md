# W1-TILL critique — the counter to 100%: no national default · no silent /verify or scale failure · vendored copy byte-equal
**VERDICT: BUILD WITH CHANGES** (listed under e). Base: api `integrate/1014d` (d5dbf93d, not yet in main) · web `main` (1014d landed, f5e973c6).

(a) What the brief assumes, checked against the code
- "13 INR/IN defaults at till.html:4033/14459/11648/5875 and till.js:1465/1974/2411/2648" — FALSE as numbered: the lines drifted and T2-NATDEF (api #190, in the base) already removed the money/country/locale ones (`shopCur()` 4049, `docCountry()` 5916, `taxIdLabel()` 5921, `voiceLangs()` 5947). Still answering India for an UNSTATED country: `schemeWord()` → 'GST' (5922) · `packSplitsByState()` no pack → true, India's CGST/SGST (5925) · `packHasUpi()` no pack → true (5927) · `offerState()` `currency:'INR'` (14530) · `fyOf()` April year, a second copy of CBDoc's IN rule (5913, fallback of nextNumber 6191) · `shopTz()` reads `sh.country || sh.country_code` and `S.currency` inline and guesses Kolkata from INR (19710-19712) · routes/till.js `/price` `.catch(() => 'INR')` (1511) · tools/tally-connector/till.js `fyOf` April (281) — the shop PC's own series. en-IN at 3774/5954 only reach an Indian shop (voiceLangs returns null for 'IN' alone) — not defaults.
- "no silent failures on /verify" — TRUE: `keyWatch` (19608) branches on `/40[13]/` over the prose `why:'HTTP 401'` (a sentence the client branches on, no code), drops the server's sentence, and its `catch (_) { /* comment */ }` passes the STD-CATCH guard yet records nothing.
- "the scale" — TRUE: `weighRead` (11719) `catch (_) { return null; }` turns an engine failure into "an ordinary barcode", so the scan falls through to product search with nothing said; `weighExample` hides the example on a failure (shadowed `e`).
- "vendored web copy byte-equal" — ALREADY TRUE on the base (`cmp` equal, 27656 lines); re-vendored after the edits. STD-CATCH's cbQuiet ring is there (491 catches) — built on.

(b) Conflicts with DECISIONS-level rules and existing constructs
- One place per thing: the FY label lives in lib/docnumber (CBDoc.rules(country).yearLabel, '*' = calendar year); the page's `fyOf` and the PC's `fyOf` are copies → both ask the engine. tests/till-vendor.test.js:210 pins the copy ("starts in April, as India's does") — rewritten to pin the delegation. e2e/docnumber-continuity.cjs carries its own fyOf stand-in (Windows path, does not run here) — updated to hand CBDoc in.
- The server's may/why: a shop with no money gets the ONE sentence (country-setup.MONEY_UNSTATED, code NO_MONEY — books-store, /snapshot) — `/price` refuses 422 with it instead of writing INR into a price. Same trips (one identities read replaces currencyFor's one).
- `shopPack()` null means two things (no country · registry not loaded); both now answer the neutral (one head, no UPI, 'Tax'); a missing engine is already listed by engineMissed().

(c) Simpler way: none beyond deleting the two fyOf copies (the engine already answers every country).

(d) Risks: a PC that has never synced (no snapshot, no cached engine) numbers under the calendar label until the snapshot names the country — the label then changes and the sequence restarts at 1 (distinct strings, no duplicate; before, India was assumed). · Twin landing: web first (vendor check reads web main), api second. · No migration (b652–b654 unused). · Engines untouched.

(e) Changes: build the eight remaining spots above (not the brief's line list); add nothing new — widen `verify()` to carry the server's sentence + status (the code), `keyWatch` branches on status.

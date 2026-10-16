# Critique · PRICE-FIX (review round 3, F1–F6 + functional Lows)
(a) Assumptions checked
- F1 true: lib/network-offers.js forStore copies applies_to unchanged (only ADDS names/ids); engine inLists is a union, so a whole-catalogue offer reaches every till line. Single caller path (till.js:772, forFinishes) → one fix point.
- F2 true: till.html lineOf carries category NAME, offers store ids; vendored copy of the api master (tools/tally-connector/till.html) — fix there, then vendor. Needs the shared line builder; not a one-liner.
- F3 true: date-only windows are read as UTC in the engines offers.js; the fix lives in ENGINES (serial, tag) and needs the shop's tz passed by every caller.
- F4 true: adapters/tally.js accountingVoucherBody writes ACTION="Create" with no REMOTEID; books-tally.js has entry_id per entry.
- F5 true: till.js:754 holds back only price<=0; a network line takes the brand price when the store set none.
- F6 true: line-guard.js:22 qty==null→1 then QTY_OK; capture.js prices an unmatched line at the model's rate unchecked.
(b) Conflicts: none with the chit/rail. Offers stay in ONE engine (CBOffers); no second scope maths is added — F1 narrows the DATA handed to the engine, not the engine.
(c) Simpler: F1 by narrowing applies_to to the brand's store line ids in forStore (no engine change). F4 by an optional remote_id on the existing voucher builder.
(d) Risks: F2/F3 touch vendored till + engines (serial; tag + adopt + vendor); a big surface for one headless round. F4 REMOTEID behaviour is unproven in a real TallyPrime (live check #6). No migrations needed.
(e) VERDICT: BUILD WITH CHANGES — build F1, F4, F6 (+F5 if small) with tests now; F2, F3 reported as LEFT with the engine/till plan; Lows left.

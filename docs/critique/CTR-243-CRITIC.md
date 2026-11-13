# CTR-243 critic (rev-ctr243), 2026-11-13
Design read: CTR-243-DESIGN.md. Checked against api origin/main c32056f2 (routes/till.js recheckPick ~2330, migrations/b845), web main till.html (sendableRows/refusedRow/queueCount/qReady), PM/CTR-212-PLAN section 3 and R1/R2/R6/R7.
Consulted: none live. cb-accounting advice is only what the design quotes; item 5 needs it for real.

## VERDICT: CHANGE (not STOP). Three blockers (B): items 1, 2 (mid-sale popup), 3 (drain concurrency).

### 1. Second calculation: YES, remove it (B)
"At today's prices it would be 283.20" is a re-total of a finalised bill. CTR-212 plan section 3 forbids repricing a finalised bill, and R2 says S3 is stamp/value equality only. It also needs the live CART/price() state, which a queued bill does not have, so the helper would rebuild a cart from a stored bill (new path, new failure). It hands the cashier a second total for a bill the customer holds at 236.00.
Change: show only carried values per line: "sold at 100.00, shop price now 120.00" (price and rate come back in the recheck answer). No total, no "would be". The 283.20 / 224.00 figures stay in cases 1, 5, 6 only as the hand oracle for S2a, not as popup text.

### 2. Popup words and buttons
Title and reach line are good. Add the cost of "Not yet" to the reach line: "Until it is sent it is not in your books or stock." Not yet is only a delay: a finalised bill cannot be refused (REV-02), the other exit is a credit note, and day close is blocked meanwhile. Say so or the owner reads it as a veto.
Question for Athi: for a PRICE-only move there is no real alternative to sending, so the confirm asks nothing the shopkeeper can act on and blocks day close. My recommendation: price-only = send, record stale_ack (via 'auto'), show the chip "Sent at an old price", feed S3's ticket; keep popup and hold for rate move / no longer sold only. If he wants the confirm for all, the design stands with the extra sentence.
Blocker (B): the popup must NOT open while a sale is being rung (CART non-empty, payment or PIN dialog open) or while the till is idle-locked. Chip/banner only; popup at the next idle moment or on chip tap. The design covers "unattended" but not "attended mid-sale".

### 3. Never lose a bill (B on drain concurrency)
- Field names: queue rows use underscored fields (_tries, _nextAt, _parked, _status; till.html 4331-4348), not "tries" / "price_hold". Use `_price_hold`, test "never attempted" as !row._tries. `_parked` already means "refused for good" and counts in QUEUED.parked; do not reuse it. STATE.queued = rows.length already counts held rows; test that queueCount() does not double count (1 held bill => 1).
- The popup must not be awaited inside drain's send loop (its _busy flag would hold every other bill behind an unanswered popup, contradicting section 6). Order: drain marks candidates held (DB.put) first, sends the rest, releases _busy, THEN a separate function raises the popup. Re-read the row by key before each put: a hold put on a row object read earlier can be overwritten by refusedRow's put of the older copy.
- Every sender passes the gate: sendNow, refresh / key-change drains (till.html ~5480-5540), "send this bill" in the bill list, drainSoon. Test: sendNow on a held row sends nothing; qReady() (clears _nextAt only) never clears the hold.
- Day close, wipeDevice, clear-store refuse while a hold exists (as designed, good). A credit note against a held, unsent bill sits behind it (WAITS_FOR_BILL): the "cancel / credit note" exit in section 5 is NOT proven; until a test shows it, Send as sold is the only exit and the chip says so.
- Reload and crash: hold put before chip, good. A failed put = not sent this pass, with words: keep.

### 4. Stale test edges (rules a/b/c sound for the core case)
- ONE stamp = the LATEST change. 09:00 100->120, bill 10:00 at 100, 10:30 120->125: changed_at 10:30 > billed_at so rule a calls it "after the sale, silent": a stale bill is missed. A change then a revert AFTER the bill is also silent. Accept as a stated false negative (the stamp has no history; catalogue_item_version.valid_from has per-version history if exactness is wanted: ask cb-catalogue) and write both as tests that expect silence, so the gap is named.
- Change then revert BEFORE the bill (09:00 to 120, 09:30 back to 100, bill 10:00 at 100): stamp 09:30, figures equal, silent: correct. Add as a test.
- Clock skew: billed_at is the TILL clock; changed_at and snapshot_at are SERVER clocks, so rule a compares across two clocks. A till 2 h fast makes a correct 10:00 bill read 12:00 and a change at 11:00 look earlier: a false popup. Slow clock: a miss. Use the offset the till already has (server `at` of the recheck/snapshot against local receipt time), or accept a tolerance in the false-popup direction only, and word the line neutrally ("the shop price is now 120.00"), never "sold wrongly". Test both directions.
- null changed_at: b845 is NOT run on production, and network (src:) items and adopted / inherited-rate lines have no row stamp (plan lines 136-138: compare VALUES). Say what the till does: adopted/inherited line = values-only (rule c); plain row with the column absent = silent plus ONE toast per reconnect, "Price changes could not be checked yet" (silence is the bug). Test both.
- Case 12 (tries>0 never asked): confirm a network-failed first attempt does not bump _tries before the gate ever ran, else a stale bill is never asked.

### 5. The PIN: who confirms (cb-accounting and Athi; not consulted live, open)
Owner PIN for a rate move is the careful default; I keep it. But "Send as sold" at 18% after the rate went to 12% records tax the customer may be owed back; in India the rate is the one at the time of supply, so the real remedy is a credit note, and the PIN gates sending, not correctness. The words "the owner must say to send it" are right; stale_ack should carry reason 'rate_moved' so a later credit-note reader finds it. Use the law pack's dated band (CTRY-139 asOf) as the truth of "the rate moved", not the catalogue stamp alone: a catalogue edit at 09:00 for a law effective next month is not a stale bill. cb-accounting + Athi to confirm: gate yes/no, credit note as the stated exit. If they say no gate, drop it (design already allows).

### 6. API field and the twin trap
- recheckPick (routes/till.js ~2330) is a whitelist: a new key is dropped silently unless added there, and the row read must select commercial_changed_at. Behind the schema check (CAT-264b): column absent => changed_at null, never a 500. One read, no per-row query (round-trips budget).
- Additive contract: docs/contracts/web-api.json master + web byte copy (node tests/web-api-contract.test.cjs --write), api-register row, FIELDS.md rows for `changed_at` and `price_basis.stale_ack`; cb-api signs the shape.
- Twin trap: the till lives in api master (tools/tally-connector/till.html) and is vendored into web; a web till landing first reds api CI. Keep the order: api field first (old tills ignore it), then till master, then vendor. A new till against an api without changed_at gets undefined and must act as the null case in item 4 (toast, no silent pass). Bump TILL_BUILD so pageStale reloads.
- CTR-212 S3 must honour stale_ack (design says so). R6 says no ticket for reason offline except deletes; the S3 ticket and this confirm must not both fire for one bill: file one line in S3.

### 7. Hand cases (checked line by line)
Arithmetic is correct: case 1 236.00 / 283.20; case 5 224.00; case 6 7.63 x2 = 15.26, 84.74 taxable, 9.15 x2 = 18.30, 101.70; case 9 354.00; case 3 283.20.
Weakness: case 3 passes by rule c alone (prices equal), so it does not prove rule b. Add a variant where b alone decides: a kept/adopted line sold at 100 with changed_at 07:30 before the snapshot (expect silent).
Missing cases to add: (16) later change after the bill hides an earlier stale (silent, named false negative); (17) change then revert before bill (silent); (18) skew both ways; (19) null changed_at / column absent / src: line; (20) popup not raised while CART open; (21) drain with an unanswered popup: other 19 bills sent, held one stays, count right; (22) sendNow on a held row sends 0; (23) credit note against a held bill; (24) 250 item_ids = two chunks; (25) hold put racing refusedRow put. Drop "would be" from every popup test.

### Scope note
Reconnect confirm only: agreed. Plan R6/R7 treat the offline finish confirm as the consent; if that finish-time confirm is not built, the reconnect popup is the only consent a bill sold offline gets. Athi to see the two items as a pair.

## Hand back
cb-counter amends the design (items 1, 2, 3, 4, 6). cb-accounting + Athi answer item 5 and the price-only question in item 2. Critic re-reads the amended design, then build (cb-counter), then critic again on the branch.

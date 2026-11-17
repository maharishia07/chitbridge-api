# RAIL-146b critique — the work reads carry the purchase price (written before code, 2026-10-29)
Base: #568 (RAIL-147) on #567 (RAIL-146) on #563. Area docs read: RAIL-BACKLOG RAIL-146b, RAIL-146-DESIGN, #567's cb-security sections (six rounds).

(a) The backlog's claims, checked against the code
- "lib/work-rows.js:179 price" — TRUE (linesOf maps item.price; it only reaches the wire as price_minor on the sheet at :330).
- ":227 total_minor" — TRUE (minorOf(pickValue(r)) on every list row, the sheet and the unbilled sum).
- "work.js has no canRead" — TRUE; the three handlers authenticate, refuse key/customer, and answer.
- "facts" carries money — TRUE only with ?unbilled=1 (figures.unbilled.minor); the plain facts are counts.
- unbilledByParty (lib/crm.js:338 -> the parties list) carries the same sum per party — TRUE, a different area (cb-crm): reported, not edited.

(b) Conflicts: none. ONE predicate (cost-view costSideOf), ONE prune, ONE can_see_costs read (cost.isCostBlind in who()). The work row gets its own allowlist spec BESIDE the others (WORK_ROW_KEEP).
(c) Simpler way: none that stays safe — a denylist of total_minor/price_minor would pass a new money key; the six chit-read rounds say allowlist.
(d) Risks: the side read is one more blind-only trip per request (two statements for a page, none for the owner); a row from a buyer not yet on the customer list hides (fail closed, the same as the chit read); the owner's bytes must not move (--compare); closed output shape of the sheet loses three required keys (address, remark, total_minor) because a blind answer lacks them; stack lands after #568.
(e) VERDICT: BUILD AS BRIEFED.

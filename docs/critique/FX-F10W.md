# Critique · FX-F10W (written before any code, 2026-10-14) — five fixes from the local walk of F10

## (a) What the brief assumes, checked
1. "The first cell's text sits inside the caret wrapper (list-ctl.js ~841)" — FALSE on main: the caret is a 14 px SIBLING span before the label (`list-ctl.js:646,668`); a probe on accounts.html#waiting (captured receipt row, 1360 + 390 px) and on a bare CBList: a click on the name calls `onOpen` → the sheet opens, nothing expands. No list-ctl change is needed; the harness test (label → onOpen, never toggles; caret → toggles, never opens; every list) is still added as the guard.
2. "The sheet still showed To accept after PUT /status answered pending → accepted" — TRUE, cause found: a captured receipt IS a bill (`folder-inventory.js:75`), so the api writes its step as a `bill_step` row (`routes/chits.js:3486-3492`), but `chit-sheet.js:69` reads a captured receipt's step from `header.current_status` (the sent copy, still pending). Second tap → noop "Already accepted".
3. Home "2 waiting for the ledger" (`index.html:169`) and the card "2 posts waiting" (api `lib/home-facts.js:150`) — TRUE. bkTodoCounts splits by REGEX on the sentence (`cap-books.js:859`); the server already parks each wait with its kind (`books-hooks.js` job `waiting: acceptance|party|state|use|dispute`) but `waitingRow` (`:899`) drops it.
4. Till snapshot without `suppliers` until the 15-min refresh — TRUE: `load()` refreshes on start only when there is NO snapshot (`till.html:6694` FIRST_READ). The server sends `suppliers` on every snapshot, delta too (`routes/till.js:817`).
5. "The existing chit update path" for party_id — FALSE: there is no generic chit update route. The one writer of a buyer's fact on MY bill copy before acceptance is `PUT /chits/:id/use` (lib/bill-use.set: my copy · billReceived (captured included) · open status only).

## (b) Conflicts with rules / constructs
- One classifier: the server's wait kind travels on each Waiting row (`todo`: accept · add_supplier · record); bkTodoCounts, Home and the card all count by it — no second regex on Home. (FIELDS entry in the api.)
- The server decides the link: the web sends `party: { party_no }` (or the exact name when a candidate has no number); bill-use resolves it in MY supplier list — a web-sent id is never trusted.
- Repaint locally ([[feedback-repaint-locally]]): the sheet paints the step from the status ANSWER; the Waiting row is flipped out of BK.waiting, not a tab reload.

## (c) Simpler way
- Item 1 is test-only. Item 4 widens the existing FIRST_READ condition (no new timer, no new route). Item 5 widens `PUT /use` + the existing `receiptFacts` read (one more statement only on the unknown-name branch) instead of a new route.

## (d) Risks
- Contract: `waiting[].todo` / `.candidates` are new keys → api `web-api.json --write`, web fixture byte copy, stand-in updated; landing is a twin (web first — till vendor check reads web main; the contract copy must match).
- Money: none moves; candidates carry names + party_no only (no amounts). No migration (b385-b387 unused). Engines untouched.
- PUT /use gains one statement when `party` is sent (budget line by hand).

## (e) VERDICT: BUILD WITH CHANGES
1. Item 1: no list-ctl change (assumption false) — harness test only. 2. Item 2: the sheet reads a captured receipt's step like any bill (bill_step, falling back to the status) and repaints from the answer. 3. Item 5: the link goes through `PUT /chits/:id/use { party }`, resolved by the server.

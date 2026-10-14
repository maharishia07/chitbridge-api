# Critique · FX-F10W2 (written before any code, 2026-10-14) — the rest of QA-W1's F10 findings
(C:/dev = ../chitbridge-docs is EMPTY on this runner: SPEC-one-bill-money.md and the area READMEs could not be read — the brief's inline packs were used.)

## (a) What the brief assumes, checked
1. Two totals — TRUE. Counter: `gap = goods − theirs` (`till.html:22416`, goods = counted × rate, before tax). Books: `round_off = total − byRateOf(inv).total` = taxable + tax (`books-hooks.js:346`), one unit tolerated. Two operands, two tolerances (counter: 0).
2. Accept does not clear Waiting — TRUE. Accept fires `afterChit` (`routes/chits.js:3482`); a post that succeeds never marks its `books_outbox` row done — only `retryOutbox` does (`books-hooks.js:916`). Reject fires no hook at all (regex is accepted|in_progress|completed). FX-F10W only flipped the row on screen (`chit-sheet.js:419`).
3. No Reject — TRUE (`chit-sheet.js:140`: a captured receipt gets Accept only; a bill received Accept · Dispute · Goods in). The rail answers `actions.reject` on the read; the reason rule exists (`lib/workflow.js:118 needsOf: reject → ['reason']`) but PUT /status does not enforce it.
4. "—" / "GST not recorded" — PARTLY. A captured receipt's money is `{ total }` only (`chit-sheet.js:87`), so the GST block says "not recorded" although `business_json.input_tax {taxable, tax, heads, supply}` is on the chit. Line totals ride `line_items[].total` (= the line's value, till `chitOfDoc`); per-line taxable/tax are NOT on the chit (only in the counter's local doc).
5/6. 390 px Receive and the Waiting column prio (`cap-books.js:2200` Bill no prio 4 < Step 3) — TRUE by code; 390 px to be measured in the till harness.

## (b) Conflicts with rules / constructs
- ONE comparison: its right home is the tax ENGINE (CBTax, both hosts) — engines are serial and NOT owned by this round (rule 12). So the rule lands as ONE pure file in the api, `lib/their-bill.js`, delivered to the page the way `/app/signin-ui.js` already is (vendor-till byte copies: web `public/app/` + the kit; served by till.js; on the service worker's shelf). No second formula anywhere; the engines lift is queued (report).
- Status: Reject goes through PUT /chits/:id/status (moveStatus, the one writer); the reason is the existing `note` → state_log. Closing the outbox row widens `closeDone` (one UPDATE), no new route, no migration.
- The client branches on codes only (`code: agrees|round_off|apart`), never on the sentence.

## (c) Simpler way
- No new route or column: the chit read's `actions.reject` gains `needs: ['reason']` (workflow.needsOf) in `forBill`; the popup paints it.

## (d) Risks
- Twin PRs (till master + vendored copy): land WEB first (api till-vendor reads web main). Kit gains one file (KIT_NAMES, kitUpdate live list) — an old kit without it shows figures without the verdict, said.
- closeDone now also closes outbox rows of a posted purchase; a self-sent receipt that posts moves to `completed` (the "stuck ideally zero" rule it already applies to counter sales).
- Reject without a reason on a bill copy becomes a 400 (new server rule, bills only — tasks keep their client-side ask).
- No migration (b403–b405 unused). No engines change (queued: CBTax.theirBill).

## (e) VERDICT: BUILD WITH CHANGES
1. The comparison lives in `lib/their-bill.js` (UMD, both hosts via vendor-till) until the engines round lifts it into CBTax. 2. Line taxable/tax are not on the chit: the popup reads `input_tax` (totals + heads) and the lines' own `total`. 3. The reason is enforced by the server only for a bill copy.

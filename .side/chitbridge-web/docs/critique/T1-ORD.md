# Critique · T1-ORD (written before any code, 2026-10-14)

## (a) What the brief assumes, checked
- LM1 "a line edit ERASES task / due / note" — TRUE: api `lib/assign.js:76-84` binds `r.task ? … : null` etc., so an edit that leaves a key out appends a row with NULL. Callers that omit them: web `cap-tasks.js:408` (tkAssignLine — who/state only), `cap-chit2.js:1188` (bulk assign), `cap-worklist.js:1519/1528` (no task/note). The table is append-only (seq), so "merge-patch" = an unsent key carries the previous row's value; a key sent as null clears it (RFC 7386, as routes/products.js mergePatch).
- Also TRUE and the same defect: an unsent `state` writes 'open' (`assign.js:68`) — a done line reopens on any reassign. Fixed the same way.
- SH-MY1 "shop.html ~789 throws away the sign-in token" — TRUE: `sfLoginVerify` (shop.html:789) calls render() and drops `res.j.token`; the keeper is `_MYTOK` (shop.html:1261, memory only by design) — reused, no second store.
- "my-orders / my-documents adopt the pager" — TRUE they are unpaged: api `routes/catalogue.js:1317` (all rows), `:1336` (LIMIT 200, no total).
- "the existing pager" — PARTLY: the web `PG` lives inside app.html (:15546), not loadable by the public shop page. The shop uses the SERVER contract (total/page/limit) with Show more + count + end marker; lifting PG out of app.html is not this round.
- CART-REG1 "one-cart.cjs RED on main" — TRUE (ran it: cap-network-member.js holds 1 outlet, registry lists 0; registry still names app/cap-network.js, which holds 0).
- "cart.js 'INR' defaults" — TRUE: cart.js:460,477,492,562,895,912,1710,1739,1917,2080.

## (b) Conflicts with rules / constructs
- None for LM1 (one writer, one table). Siblings of INR: `locale.js` symbol()/money() also default INR — the cart stops handing it a guess; locale.js itself is shared by every surface and is left (named in the report).
- NO_MONEY: the one sentence is api `country-setup.MONEY_UNSTATED`; the shop catalogue does not send it today → add `shop.money_why` (same shape as till snapshot, docs/FIELDS.md entry) rather than typing it on the web.

## (c) Simpler way
- LM1 in SQL, not JS: one INSERT … SELECT from a LATERAL of the previous row with a "sent" flag per field — no extra trip.

## (d) Risks
- Twin landing: api first (assign merge, paged lists, money_why) — web works with either (reads `total` if present, `orders` always).
- Pre-b153 fallback insert keeps working (no state column → unchanged path). No migration (b421–b423 unused).

## (e) VERDICT: BUILD WITH CHANGES — state carried like task/due/note; shop pager uses the server contract (PG not lifted); money_why sent by the api.

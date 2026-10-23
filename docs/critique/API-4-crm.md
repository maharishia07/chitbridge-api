# Critique · API-4 sweep: crm (24 routes of routes/crm.js) · written with the capture, before the first route edit

(a) The brief assumes, checked against the code
- 24 routes at /api/crm, all in routes/crm.js, none an alias of another file: TRUE (702 lines; the register counts 24 rows, all "not started").
- ONE refusal helper, fail(res, e) (routes/crm.js:72), plus noKey (403 SIGN_IN, :67) and idOf (400 BAD_ID, :82): TRUE. Three handlers also write a raw 404 (GET /parties/:id, GET /timeline, DELETE /followups/:id). Every 5xx goes through safeErr: TRUE (message is always the one safe sentence).
- Codes come from the libraries' `bad(msg, status, code)` (40 distinct, 28 of them not in docs/ERROR-CODES.md); a codeless `bad()` answers REFUSED. The status is dynamic, so the register cannot read it from the handler: 409 / 503 stay in an `x-crm-refusals` list, not declared responses.
- Earlier owner questions (API-4c (2), PLATFORM-BACKLOG): segments/:key/send and privacy-requests/:id/answer on a missing id (400 BAD_KEY / 409 ANSWERED, never 404); leads/import dry answers 200 while the contract says 201: TRUE, all three are these routes. Kept as they are; these two routes stay PARTIAL on error_tests (the declared 404 is never answered).

(b) Conflicts with existing rules
- LAW AND CONSENT live here. Not touched: privacy.gate and its 403 { code, why } (interactions, outcome, send), the append-only consent rows, the request due dates and the answer-once rule, the send gate (dry = the count, by code), the may { write, remove } objects, the import rules and the 500 cap, the walk-in points move, every success body. No SQL is edited.
- The 9th world: DELETE /parties/:id, POST /privacy-requests/:id/answer and DELETE /groups/:name refuse a non-owner at the door BEFORE any lookup: reported "door-gated", not a leak. POST /segments/:key/send and /answer have no 404 for an id.

(c) Simpler way: none. lib/contract-kit.js, lib/orders-contract.js (said · repeatFault) and tests/lib/problem-world.cjs are the construct of the merged sweeps. Widened, not forked: problem-world.cjs gains one hook (`options.before`); tests/support/crm-stub.cjs gains `signedOut`. No validateAsProblem needed (schemaValidate with `legacy` options does the job).

(d) Risks
- A body that is not an object, or a query value given twice, is a NEW 400 (CRM_BAD_REQUEST, in the route's { code, error, message } shape). Before it was taken as an empty body or the first value. No web caller was found sending either.
- A refusal's body gains the Problem fields (type, title, status, detail, hint, request_id); the old keys stay in their order. The web-api.json refusal entries (#400/#404/#409/#503) are regenerated and the web keeps a byte copy.
- Other sweeps touch scripts/guards.cjs, tests/engine-manifest.js, the register and the error table: merged from origin/main before the final regenerate.
- A 200 that carries an exception's text: none found in this file (a first read; re-checked with the test's 5xx leak rule).

(e) VERDICT: BUILD WITH CHANGES — POST /segments/:key/send and POST /privacy-requests/:id/answer stay partial (error_tests: the declared 404 is not answered); POST /leads/import documents 201 only (the dry 200 is the filed question); the register is read for the rest.

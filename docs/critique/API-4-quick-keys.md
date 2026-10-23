# Critique · API-4 sweep: quick-keys (9 routes of routes/quick-keys.js) · written before the first route edit

(a) The brief assumes, checked against the code
- 9 routes, mounted at /api/quick-keys (the register counts 9 rows of routes/quick-keys.js, all "not started"); the logic is lib/quick-keys.js, an engine over a `db` already bound to the shop: TRUE.
- Every refusal is a bare `res.status(N).json({...})`; every 500 goes through safeErr: TRUE. No `e.message` reaches an answer except three, traced to the library's own throws:
  - POST /groups (line 46): `e.code === 'validation'` is thrown only by lib/quick-keys.js createGroup, with the fixed words "name required". A database error carries a five-character SQLSTATE, never "validation".
  - PATCH /groups/:id (line 59) and DELETE /groups/:id (line 72): `e.code === 'conflict'` is thrown only by updateGroup and deleteGroup, with the fixed words "changed since you last read it". `current` is the group's own row (`SELECT *` of quick_key_group), not error text.
  So: fixed words, no database text can ride; these three stay answered from the library's sentence (read only when its own code says so) and the body-scan test throws a database error into each to prove it. Nothing here is a finding for cb-security.
- The sessionOnly door (an API key gets 403 before anything) is a door-level 403 with one identical body for every id: door-gated, kept first in the chain, never turned into a 404.
- Seven of the nine have no caller in the shipped screens (PM/ENDPOINT-USAGE-2026-10-23.md section 5.4 row 6; the authoring screen is planned). A grep of the web checkout finds the routes only in e2e/tests/till-shopgroups.spec.js (POST /groups, POST /groups/:id/items) and in comments of till.html. FLAGGED, nothing removed.
- A malformed id (not a uuid) in :id or :productId reaches the database and answers 500 "Failed" today (22P02). Making it a 400 is a behaviour change: left as it is, listed for API-4c.
- An unknown or foreign id answers: PATCH/DELETE /groups/:id 404, POST /groups/:id/items 404 (group not found); DELETE /groups/:id/items/:productId 200 {removed:false}; PATCH /groups/:id/items 200 {ok:true} (the one UPDATE touches no row and an audit row is written). Those last two stay PARTIAL on the foreign-id column: not a leak (the same answer for a foreign and an unknown id, nothing of the other shop is read or changed), a design choice for API-4c.

(b) Conflicts with existing rules
- The 409 body {error:'conflict', message, current} is read by the planned authoring screen (it re-reads `current`): kept key for key, `current` byte for byte.
- A body that is not an object is a new 400 in the route's own body {error:'validation', message}. Before, a list was taken as an empty body (PATCH /groups/:id with a list bumped the version for nothing). No caller sends one (grep of web and the e2e spec: objects only). Said in the PR.
- tests/till-t2a.test.cjs and the quick-key tests read lib/quick-keys.js and routes/till.js, not this file: unchanged. routes/till.js's /quick-keys/* (Level 2) and lib/quick-keys.js are not touched.

(c) Simpler way: none. lib/contract-kit.js, lib/products-contract.js (said), lib/crm-contract.js (the shape of a small contract file) and tests/lib/problem-world.cjs + foreign-id-world.cjs are the construct of the merged sweeps. One widening of the kit: a DELETE row that names a `body` gets the request body in its operation (DELETE /groups/:id carries `version`); no existing row names a body on a DELETE, so no other contract moves.

(d) Risks
- Behaviour: none intended. The proof is a capture of the pristine base (git archive of HEAD) replayed byte for byte after the change.
- DELETE /groups/:id/items/:productId takes nothing but two path arguments: its input check can never refuse, so the 400 the kit declares for a route with path arguments cannot be tested. It stays PARTIAL on error_tests (and so quick-keys.js is not added to HELD_FILES).
- Other sweeps touch scripts/guards.cjs, tests/engine-manifest.js, the register and the error table: main is merged in before the final regeneration.

(e) VERDICT: BUILD WITH CHANGES. Eight routes can reach seven of seven; DELETE /groups/:id/items/:productId stays partial (error_tests) and the two silent-200 item routes stay partial on the foreign-id column. HELD_FILES is not extended.

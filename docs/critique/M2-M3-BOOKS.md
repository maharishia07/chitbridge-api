# Critique · Wave M · M2 + M3, the one routes/books.js visit (cb-finance, 5 Nov 2026)

**VERDICT: BUILD WITH CHANGES** (M2 as briefed on three doors + confirm; M3's root cause is the generator's world, not the handlers — proved below, the books area test carries the evidence instead).

(a) What the brief assumes, checked:
- "FIN-63 → routes/books.js:1427 confirm → lib/books.js writeAllocation" — TRUE (confirm is at :1443 after #732; postEntry type 'allocation' → writeAllocation). No client_ref on that door; every other books write has one.
- "widen middleware/idempotency.js requireKey() the way catalogue order/confirm does" — TRUE that requireKey exists (:285) but it is the PUBLIC form: it scopes by (shop, hashed contact) and needs shopOf/contactOf. A bearer door needs the token's entity (the global pass in server.js:359 already holds a sent key for it). Widened: requireKey() with no reader = the bearer form; the gate refuses a missing key and holds it only when server.js's pass did not (a router served alone in a test).
- "the web keys booksPayRecord, booksPayPatch, perGstPay" — TRUE on web origin/main cc7cdc51 (#447): idem:'attempt' on all three; core.js cbIdemKey.
- "foreign_id_404 on 24 books routes fails because the handlers answer 403/500" — FALSE. docs/contracts/api-hardening-results.json says "an unknown id answered 422, not 404" for every one; the probe (scratch m23/probe-books.cjs) shows own, missing AND foreign all answer 422 NO_COUNTRY_PACK: the generator's stand-in row answers `country: 'x'` and `enabled: false`, so lib/country-setup's gate stops EVERY books route before any handler. No books route can earn foreign_id_404 (or idempotent_money_write past the gate) from tools/api-contract-tests.cjs as it stands. The second sanctioned evidence path is the area test's file (api-register.cjs:34-36, api-hardening-evidence-areas.json, written by tests/api-problem-books.test.cjs).
- "POST /payments/:id/propose is a read" — TRUE (B.proposeFor computes; nothing written) → money_reviewed_not.

(b) Conflicts: none with DECISIONS. The one-rule check: a missing key is refused BEFORE the ledger's own gates (`on`), so a shop without a pack gets the key refusal first — a refusal, not a write, on every path. Till doors, chit payment, supplies untouched (ATHI-DECISIONS M2).

(c) Simpler way: none for M2. For M3 the simplest TRUE fix is one line in the generator (a `country` column answering a real code and the ledger switch on), which is G-PLATFORM's tool and would move every router's evidence — not this visit.

(d) Risks: the hardening files are regenerated whole (collides with #683 and any sibling; the batch regenerates once). Four handler hashes move (POST /payments, PATCH /payments/:id, POST /payments/:id/confirm, POST /gst/pay via route()) → re-sign by a non-builder. Test harnesses that mount the books router alone must now send a key on the four doors (books-payments, books-routes, books-fixes, books-period, books-close-country, contract-books, rail146m, api-problem-books) and the two scripts that post payments (seed-local, sim-scale) and the realstack j() must send one — all in this PR; no other live caller found (till.html and tools/tally-connector/till.html call no books door).

(e) Consulted: G-PLATFORM api (the register's columns and evidence files; cb-api's _area pack not present under briefs, api-register.cjs read instead), G-PLATFORM security (S6/S35 wording).

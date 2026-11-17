# sit/run6 — joining origin/sit/grundfos (1a68240b, 67 commits) with origin/main (2df6760b) · 2026-10-31

Merge, not rebase (the 67 SIT commits stay traceable). Merge-base 907d1f58; main had moved 791 commits. 41 conflicts: 19 code, 22 tests and generated registers.
Rule applied to every file: keep BOTH behaviours; a money/tax/mint conflict is composed, never picked blind. Where a test pinned one side's spelling it was re-aimed at the rule, never deleted.

## The structural fact that decided most of routes/chits.js
Main lifted `moveStatus` (the ONE status writer) into `lib/chit-move.js` and `postMessageCopies` into `lib/chit-crossing.js`; the branch's RAIL-106 emits rode inside those functions in routes/chits.js. The emits were re-applied INSIDE the libs, so the one writer stays one: `ctpReturn.onStatusMoved` after the timeline write in `chit-move.moveStatus` (never for a bill step), in `cancelSentCopy`, `onCancelConfirmed` in `confirmCancelToSender`, `ringStatus` + the two cancel stamps moved to chit-move (exported; routes/chits.js and lib/ctpreturn.js call them there); `message_id` reuse + `lib/message-limit` + `onMessagePosted` in `chit-crossing.postMessageCopies`. The branch's duplicate moveStatus block in routes/chits.js was removed (323 lines).

## Code conflicts (19)
| File | main changed | branch changed | joined as | proves main | proves branch |
|---|---|---|---|---|---|
| lib/ctpkeys.js | `_reset` clears `warnedPeers` | `held` map per env name | both cleared | ctp-conformance 21/21 | network-door 34 |
| lib/rail-status.js | header: moveStatus lives in lib/chit-move | header: ctpreturn mirror calls it | one header line naming both | rail-status 27/27 | ctp-return-path (mirror) |
| lib/ctpquery.js | RAIL-140 farRefusal/unreachable | exports NETWORK_WANTS | both | ctp-query 16/16 | network-door |
| lib/ctpaddress.js | RAIL-142: every row, `known` set, placeStamp | domain+label in the map; inactive = remote, refused in words | main's structure; the map carries domain/label; an inactive stamp is `local:false, inactive:true` (mint refuses CTP_PEER_INACTIVE, playbook C5) not `resolved:false`; domain lookup LIMIT 2 so the two-active refusal still works | ctp-address 22/24 (2 open, below) | SIT run 4 E-table |
| lib/ctpenvelope.js | RAIL-141: `no()` objects, hashOrNull, no verifier = refusal | `kind:'event'` envelopes | main's structure + the event kind; branch's duplicate boundary/seal helpers dropped | ctp-conformance | ctp-return-door 10/10 |
| lib/mint.js | RAIL-142 awayCopies/refuseUnresolved, refusal(), refusedCrossing log | sendAway (inactive refusal, RAIL-98 recipient bridge id, RAIL-99 farEndFailure 409/502) | both: deliver → awayCopies → sendAway; farEndFailure + refusedCrossing log (detail merged) | crm-traded 5 | send-seller-currency 7/7, money-origin 4/4 |
| lib/amend.js | RAIL-147 `inside` step; RAIL-133 no value echoed | prepare()/guard() extracted for proposals | branch's split + main's `inside` runs before guard; main's error shape (frozen legacy has no code) | rail147-amend-cost-gate 62/62 | chit-proposals (2 open, below) |
| lib/tax.js, lib/tax-engine.browser.js | ACC-191 adopted from engines v1.72.2 (holdsTax) | SIT-only shim, same formula | main (identical arithmetic: `priceIncludesTax && levied`) | money-origin | — (shim retired) |
| lib/entities-contract.js | 22 of 24 (lookup retired, api#638) | 24 of 26 (search, lookup) | 23 of 25 (search declared, lookup gone) | api-problem-entities (2 open, below) | net-39-search |
| lib/relationships-contract.js (add/add) | API-4 contract, 14 operations | 6 supplier doors + remote words | main's, plus `remoteRefused` + `ADDRESS_GATE_STATUSES` | api-problem-relationships 1252/1252 | net-39-search (1 open, below) |
| routes/ctp.js | RAIL-138/139/140: sealedBy first, senderOf, deliverOnce (repeat 200), fixed manifest note | RAIL-97 membership in manifest, RAIL-104 openEnvelope re-read, RAIL-107 localParties stub, event door, bell | main's door order; manifest adds membership + network_fingerprint; openEnvelope over sealed.publicKey; deliverOnce on the LOCALISED copy; `repeat` and `duplicate` both said; onChitArrived bell | api-problem-ctp (all), ctp-door (3 open) | ctp-return-door 10/10, network-door 34 |
| routes/chits.js (15 hunks) | chit-move/chit-crossing lift, RAIL-146 cost strip, RAIL-147 cost door, RAIL-133 words, S34 shapes, CTRY-76 sendPaper, logMessageSent in tx | RAIL-106 emits, proposals on amend, REP-50 per-currency rollup, ctp marks on reads, API-6 words, checkCounterInvoice | see above; rollup = (key, currency) rows → cost-view strip per row → fold by key (by_currency + cost_hidden); amend = proposeAmendment first, then costWrite.recordAmend; GET /:chit_id and /messages carry ctp_unconfirmed inside the S34 shapes (ANSWER_KEEP gains the key); reprice/costs say the library's words; checkCounterInvoice restored (main's inline check was auto-dropped by the branch's extraction) | api-problem-chits 3602/3604 (2 open), rail146 (2 open), rail147 | rollup-currency 4/4, chit-proposals (2 open), ctp-return-gaps 29/30 |
| routes/entities.js | S34 searchRowOf over the old LIKE | NET-39 one search Here and There | branch (decided 25 Oct, proven G4) | api-problem-entities (2 open) | net-39-search 30/31 |
| routes/relationships.js (24 hunks) | API-4 words/partyRefusal/removeFault, SEC-91 | checkedSupplier, remoteAddress gate, remote-catalogue | main everywhere + `remoteAddress` on POST /suppliers + remote-catalogue after SEC-91; main's express-validator chains restored (the branch had deleted them) | api-problem-relationships | net-39-search (1 open) |
| routes/attachments.js | API-4 contract/problem | RAIL-106 attachment by reference | both | api-problem-attachments | ctp-return-gaps G3 |

## Tests and generated files (22)
tests/*: main's version, then the branch's additions (api-problem-ctp stubs both; api-problem-entities both requires; problem-world `genericOk` + `added`; rail-actions main's RAIL-133 tolerance; api-problem-chits main's scenes — the branch's four amend scenes NOT added, they need frozen legacy rows). scripts/guards.cjs lists the branch's eight offline tests. Generated JSON: main's file, then the branch's key-level deltas against the base (`merge3.cjs`: api-legacy +5 routes +1 changed, hardening-evidence +2, evidence-areas +5; the rest unchanged), serialised at each file's own indent. docs/API-REGISTER.md, api-register.json, SEAMS.md, ERROR-CODES/error-codes.json, readability.ratchet.json, round-trips.budget.json, fn-size.json: MAIN's — NOT regenerated yet (step 5 open). MANIFEST.md: both rows (b790 renumbered to row 14).

## Migrations (none renumbered, none run)
b790_network_member, b791_ctp_return_path, b792_ctp_event_kinds_disputes, b793_ctp_event_kinds_gaps, b796_chit_proposal. Main stops at b783; b784–b789 and b794–b795 are gaps, no clash. ⚠️ b790 already RAN in production on 25 Oct (db ledger: five tables lacked RLS, DB-85 proposed b797 in plain text) — Athi decides the remaining four; the fresh-db apply on cb-local-pg was NOT run in this pass (RAM, time).

## Pass 2 (31 Oct): what was open, and what it became
Every check was re-aimed at its RULE; none deleted. One line each:
1. ctp-door: stubs answer RAIL-107's localisation (stubFor) and the sender's bridge id; an unknown sender is written under the local row.
2. ctp-internal-wire: RAIL-105 re-aimed at `deliverOnce` (a repeat is true, CTP_CHIT_ID_TAKEN 409, written once); RAIL-104's fetch stub serves `body.getReader` (RAIL-140 c reads the manifest as a capped stream); RAIL-99 refused re-aimed: names the business, `refused: true`, the far end's words NOT said (Q19 beats RAIL-99's "give their words": flagged for cb-security).
3. ctp-address: slices re-aimed at `sendAway` (`farEndFailure(` then `throw failure;`; the refusal before `sendAway(`).
4. chit-proposals + ctp-window-shopping: stubs answer RAIL-128's holdsCopy probe and RAIL-142's topology read.
5. api-problem-chits (API-6): words:true kept; the new sentences ("No.", "No rows.") frozen BY HAND in docs/contracts/api-legacy.json, in its format. Needs cb-api sign-off.
6. api-problem-entities: GET /api/entities/search's shape gains `answers` (open); contract tests regenerated.
7. rail146: expectations in the wire's key order. 8. net-39-search: chain regex re-aimed. 9. ctp-return-gaps/path: real ed25519 signer + verifier; no verifier = refused (RAIL-141 a).
10. Money (ACC-192 x the offer): `keepOffer` composes the carried origin invoice with the offer's savings (gross = net + savings), so send-golden keeps 618/50. Flag for cb-accounting.
11. RAIL-106 answers: `ctp` (attachments, messages, disputes, resolve, void) and `ctp_unconfirmed` (GET /:chit_id) declared in api-output-shapes.json as open objects; guards run OUTPUT_ALLOWLIST=enforce and had pruned them.
12. DB-85: b797 carried from api #443 (RLS on + forced on b790's five tables; #443 is superseded). Fresh db `fresh_run6` on cb-local-pg: 22 files applied, 0 failed; b790-b797 in the ledger; 8 tables RLS on + forced, 2 policies each; dropped after.
13. Servers heat-map fix (Athi 31 Oct, PM/SERVERS-STATUS.md): the access log writes `(req.originalUrl || req.url).split('?')[0]`, not `req.path`, so a route inside a mounted router logs its full path. Only that line; the origin-refused log and middleware/idempotency.js unchanged. Nothing routes or meters on the field; tests/request-log pins it (red before, green after). Own commit.
14. Generated: fn-size (223 -> 219), API-REGISTER, api-register.json, error codes (duplicate CTP_REFUSED joined into the rail row), SEAMS, hardening evidence. POST /api/relationships/suppliers loses strict_input against the branch (main never had it).

## Pass 3 (31 Oct): #443 merged, readability to 0 failures
Coordinator: take the fixes, do not accept the debt. origin/db/db-85-b790-rls (#443, 20 commits) MERGED (not cherry-picked) as 3cce9b72; #443 is superseded and closes once this lands.
1. lib/chit-proposal.js: #443 whole (pass 2 had only duplicated its money.round + requestLinesOf fixes).
2. lib/ctpaddress.js: #443's split (notResolved, resolveOwnNamespace, installationForDomain) carrying ours: RAIL-140(e) Q19 fixed sentences, RAIL-140(g) LIMIT 2, RAIL-142(e) ownDomainAnswer; peerOfDomain gone.
3. lib/ctpquery.js: #443's ASK_NEEDS + askProblem with NET-39's MIN_SEARCH_TEXT and search need.
4. routes/attachments.js: #443's audienceFor with main's header and the ONE problem shape.
5. routes/chits.js: ours (moveStatus lives in lib/chit-move, the ONE status writer); #443's F15 carried into chit-move ringStatus (the status event rings with the new status, no early return); ctp-return-gaps' F15 check aimed at lib/chit-move.
6. Tests: ours for api-problem-ctp, bills-private, engine-manifest, write-route-gate (orphan subMountsOf removed); generated files rebuilt by their own tools.
7. F5 style, behaviour unchanged: cryptic names spelled out (netmember, netsync, netcert, installer-token, ctpaddress, storage, routes/ctp, the network tools); network-seed-root's empty catch now logs; new tests/network-tools.test.cjs (9 checks, enrolled in guards).
8. Long steps split into named steps (chit-move, chit-crossing, ctpenvelope, ctptransport, netsync, remote-catalogue, otp, chit-proposals, network-seed-root); legacy handlers back within main's sizes (routes/chits.js send/amend/message/dispute/withdraw; routes/ctp.js deliver 184L c26, query 36L c16; routes/relationships.js GET /suppliers via supplierListSql, SQL byte for byte).
9. tests/ctp-query re-aimed at the rule (the classify call, the three-kind gate), not the old variable names.
10. Readability guard: 0 failures, 12 warnings. fn-size 219 -> 217. Contract tests 1543/0.

## Still open (each with its owner)
- DONE 31 Oct (cb-api): the 5 re-signed after review; rollup gained by_currency in its output shape (enforce had pruned it), entities/search says the register's sentence instead of echoing `where`; ratchet 484 of 636 (allowed 484), the 5 added output_allowlist failures are new SIT routes (proposals x4, search/places).
- migration-lint vocabulary (runs only where PM/NAMING-AND-MEANING.md sits beside the repo, so not in CI): chit_proposal.currency_code, chit_proposal.note, membership_certificate.note. These columns already exist on the SIT servers; renaming them is cb-db's call (D8 says columns keep currency_code).
- tax-vendor: red on pristine main too (api 2df6760b vs web d8acc41f pin different reg-* releases for IN slip/taxInvoice/tax) -> cb-accounting / release; not this merge.
- raida-close-route: 10/10 pass; a libuv assertion on exit on Windows, the same on main.
- migration-lint: green in pass 3 (#443's F4 allowance came with the merge).

- B1 NET-47 fixed: Here finds every known shop by name (main LIKE, same exclusions), There keeps public + exporter; lib/business-search.js, tests/net-39-search.test.cjs.

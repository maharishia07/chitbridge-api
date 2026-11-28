/**
 * guards-list-3.cjs — PART 3 OF 4 OF THE OFFLINE GUARD LIST (moved out of scripts/guards.cjs, 22 Nov 2026, filesize ratchet: a new file stays under 500 lines).
 *
 * OWNER     cb-qa
 * OWNS      GUARDS_PART: 445 consecutive entries of the declared offline list, in run order (first: parallel-run.test.cjs). Add a guard to the LAST part (guards-list-4.cjs), the day it becomes true, not before.
 * CALLED BY scripts/guards-list.cjs (joins the three parts, order kept) · tests that read the list as text: every-test-is-enrolled, junit-board, filesize-ratchet, readability-guard, junk-fuzz, sec-75-entity-schemas (via tests/support/guards-list-text.cjs).
 * FLOW      guards-list.cjs requires this file ──▶ one array, no entry changed ──▶ scripts/guards.cjs ──▶ scripts/guards-run.cjs
 * CARD      qa/offline-guards
 */
'use strict';
const GUARDS_PART = [
  'parallel-run.test.cjs', // MNT-47: their Tally/Xero period beside ours, each difference with why
  'fx-rates.test.cjs', // MNT-47: foreign-currency trade end to end, rates and revalue
  'register-country-guess.test.cjs', // MNT-47: a new shop country is what the owner was shown
  'policy-defaults.test.js', // MNT-47: what an entity that never opened Settings actually does
  'policy-set.test.js', // MNT-47: the units set policy flag
  'beckn-map.test.js', // MNT-47: Beckn/ONDC mapping and the boundary it must not cross
  'crm-calls.test.cjs', // QA wave 2: the call desk: queue, outcomes, the follow-up the call answered is closed (a uuid; a non-uuid closes nothing)
  'csv.test.js', // QA wave 2: the CSV round trip - what comes out goes back in
  'csv-preflight.test.js', // QA wave 2: import preflight: every refusal named before a row is written
  'visibility-cap.test.js', // QA wave 2: a visibility choice bounded by an operator cap; an absent declaration closes nobody
  'visibility-mirror.test.cjs', // QA wave 2: the two visibility columns hold one fact, every writer writes both
  'exposure-cost.test.js', // QA wave 2: cost never reaches a customer-facing surface
  'ai-vision.test.js', // QA wave 2: photo to item: the vision request body, caps-only, injection through the image path
  'gs1.test.js', // QA wave 2: the GS1 check digit and the judgement around it
  'units-alias.test.js', // QA wave 2: a rename is never a conversion
  'schedule-apply.test.cjs', // QA wave 2: publish on a date: applyDue picks only this shop's due rows, one writer, b203 absent answers not enabled
  'schedule-apply-claim.test.cjs', // NET-98 critic MUST 3: two readers at one due moment lay a parked patch once (claim: FOR UPDATE SKIP LOCKED + guarded stamp)
  'mis-practice-marks.test.cjs', // MIS 0b/0c: the practice row's queries open and entries checked = the client's own page (review-mark openCount, coverage), a mark altered by a seal included
  'speed17-marks-key-uncast.test.cjs', // l17 speed: the marks key (entry_id) is compared as a uuid, never entry_id::text, so its index serves the practice read at depth
  'sold-one-rule.test.cjs',
  'aj-today-sales.test.cjs', /* AJ-F-08: today's sales one figure, net of credit notes, a return is no bill */ // MIS 0a: ONE SOLD fragment, windowed soldByDay, practice paging and year on year
  'onerule-practice-page.test.cjs', // l16 onerule: the practice row equals the client's own page for every fact (months not locked = periodAdvice's rule, bank = unexplainedOf), every seeded client; real-Postgres on the 150-client seed: onerule-practice-page.realstack.cjs
  'net-98-reducers.test.cjs', // NET-98 S1: the pure reducers split out of the view's libs, one definition each (guard); the real-Postgres differential is net-98-differential.realstack.cjs (local stack)
  'openapi-services.test.cjs', // QA wave 2: the public services API document documents every real route of offers, pricing, tax, invoice, keys - and no phantom
  'api-foreign-bite.test.cjs', // API-1 S35 bite: a foreign-id case can FAIL (a store that ignores the owner is caught, on the helper and on the real chits routes); every public_ids / cannot_answer exemption carries a reason and names a real route
  'regression-harness.test.cjs', // MNT (11 Nov): scripts/regression.js never claims a pass it did not see (HARNESS ERROR, PASS 0; non-party checks accept only 403/404); offline, no server
  'incidents.test.js', // CMP-29: an incident is refused without an account of what happened, in words, before anything is written
  'line-complete.test.cjs', // 1 line model (wave 3): a line that asked for nothing is not done; the roll-up counts only genuinely finished lines
  'work-rows.test.cjs', // 1 line model (wave 3): GET /api/work list / row / sheet through the real router: folders, stage words, per-line delivery, truncation, RLS, one batch not a query per row
  'work-client.test.cjs', // W16: a practice job chit names its client (country, money, next return): ONE trip, a failed read is an empty map and a row with the name only (fail-closed), no client for a task or order
  'worklist-unassigned.test.cjs', // 1 line model (wave 3): work nobody picked up still appears on the worklist (no assignment row is not invisible)
  'docnumber.test.js', // 9 returns (wave 3): the numbering rules per jurisdiction, the credit-note series, no Indian rule escapes into a country not studied
  'user-id-rule.test.cjs', // 18 user id (wave 3): the User ID rule through the real route handlers over a stubbed database
  'round-trips.test.cjs', // 28 performance (wave 3): GET /me has a round-trip budget and it is enforced
  'round-trips-chit.test.cjs', // 28 performance (wave 3): opening a chit has a round-trip budget too
  'trips-headers.test.cjs', // 28 performance (wave 3): the round-trip counter answers the right people and nobody else
  'may-trade.test.cjs', // 28 worlds (wave 3): mayTrade is the database rule asked at the door; the trigger clauses and the helper SQL agree
  'sit-load-evidence.test.cjs', // 28 load simulation + performance (wave 3): the RECORDED SIT knee/stress/load runs agree with themselves and are not stale (a record, not a live run)
  'books-cashflow.test.cjs', // 16 cash position (wave 3): lib/books-cashflow.project shortfall and no-shortfall to the minor unit, GET /cashflow and the cheques pdc_reminders over the in-memory books (repaired: payments need an Idempotency-Key)
  'lv15-cashflow-open-items.test.cjs', // LV-15 (1129): the cash view reads the OPEN documents; project() answers the same on them as on every row (incl. a bill dated after today)
  'lv-counters-list-no-lock.test.cjs', // speed-counter-01 F6 (1129): the counters list reads without FOR UPDATE; a key to adopt falls through to the locked read
  'combo-templates.test.cjs', // 7 combo templates (wave 3): save / reopen / rename / delete a combo, push CREATES the product once then UPDATES, cross-entity isolation (repaired: the stub now states the shop currency)
  'till-counter-doors.test.cjs', // 9 verify and reconcile + customer display (wave 3): POST /reconcile ok / absorbed / missing / unknown in one query, GET /verify spread sample, read-only; pair a screen by code, a screen key and nothing else, spent on first read, expiry, guess lock-out
  'till-names.test.cjs', // 9 three counter controls named by title only now carry an aria-label (axe select-name; Wave 1b customer pages)
  'live-trips-network.test.cjs', // SPD-42: the driven network scenario counts the highest 2xx trips and reports every route unreached when the load shop has no node (fake client, offline)
  'api-card-helpers.test.cjs', // API-1 (MNT-12): the register's derived reads/writes follow a function split into private same-file helpers; a shared helper beyond the depth does not leak
  'channels.test.js', // b123 channel map; the webhook gets the RAW body (a probe in the real app: Buffer, not an object)
  'whatsapp-out.test.js', // b126 outbound: every refusal with a recipient leaves a receipt (fake handle), one bare exception; the window, templates
  'sec-95-provider-text.test.cjs', // SEC-95: a refused WhatsApp send leaves our sentence in the receipt and sent[].reason, the provider text only in the log
  'acc-223-238-cancel.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'rail-173-assign.test.cjs', // RAIL-173: PUT /assign pull and push leave a taken-back bill rejected / cancelled (409 taken_back), a never-posted one reopens
  'rail-173-mutation.test.cjs', // RAIL-173: with the taken-back guard removed from lib/chit-move.js the cancel test goes red on the RAIL-173 cases
  'acc-231-move-in-role-ledgers.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'acc-232-parallel-run.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'acc-234-actor-tester-code.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'acc-241-move-in-currency.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'acc-244-move-in-credit-type.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'amend-guard.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'auth-before-validate.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'auth-middleware.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'books-auto-post.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'books-cash-waiting.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'case-fields.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'catalogue-columns.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'catalogue-read.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'catalogue-visibility.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'column-parity.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'column-rules.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'con-30-connector-csv-core.test.cjs', // CON-30 (proof 2026-11-14): tools/tally-connector core + csv adapter: products up once (receipts), offers back, orders down, receipts out
  'con-54-storefront-presence.test.cjs', // CON-54 (proof 2026-11-14): storefront away sentence from connector last_seen
  'con-55-zoho-refresh.test.cjs', // CON-55 (proof 2026-11-14): Zoho refresh_token renewal
  'con-74-send-via-whitelist.test.cjs', // CON-74 (proof 2026-11-14): via whitelist on /send
  'con-90-notify-channel.test.cjs', // CON-90 (proof 2026-11-14): sendOtp chooses the channel
  'conf-cache.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'connector-rows.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'consolidate-units.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'cors-headers.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'crm-204-contact-email.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'crm-groups.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'ctp-repair.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'ctp-return-tool.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'currency-envelope.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'current-actor.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'db-coldstart.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'defaults.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'dev-otp.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'exports-exist.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'finance-followup.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'form-handshake.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'groupsum-selection.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'handle.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'identity.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'idoc-normalise.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'item-cost.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'itemmatch-qualifier.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'jurisdiction.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'k1-chits-guard.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'me-include.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'meters.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'money.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'network-build.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'numerals.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'offerable.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'offers-engine.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'order-input.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'party-no-at-add.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'per-copy-design.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'ppl-21-login-format.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'price-provenance.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'proof-exit.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'pulse.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'raida.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'rail-158-service-errors.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'read-batch.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'repeat-supply.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'reporting.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'retired-entities-lookup.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'rev04-cost-leak.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'route-auth.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'run-tests-exit.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'schedule.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'acc-313-pack-shop-day.test.cjs', // ACC-313: the exit pack reads the shop's local day (api #1346)
  'con-98-adapter-total.test.cjs', // CON-98: the GoFrugal and Tally adapters book the one bill total; an order syncs once
  'schema-probe.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'sec-126-network-store-public.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'sec105-dispute-queue.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'sec127-dispute-reads.test.cjs', // SEC-127: every dispute read names the caller's shop in its own SQL (two shops, row security off)
  'acc-237-actors-list-level.test.cjs', // ACC-237
  'sec116-actors-connector-config.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'sec118-employee-code.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'sec91-supplier-catalogue.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'sec92-readiness-passport.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'select-received-party.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'set38-signup-stamp.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'sheet.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'slab-cites.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'sql-placeholders.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'tax-governance.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'tax-registration.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'tax-scheme.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'tax-slab.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'tax-shop-day.test.js', // M3 12 Nov 2026: a slab's effective_from is judged on the shop's day (Mumbai 00:30 on 13 Nov = 19:00Z on 12 Nov)
  'till-bills-credit-note.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'till-line-answer.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'till-retain.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'till-shop-move.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'till-t2f.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'trend-reads-books.test.cjs', // test sweep 7 Nov 2026: was in no runner, passes offline
  'ye-f03-last-year.test.cjs', // YE-F-03: last year from the books' prior range
  'ye-f04-carried-line.test.cjs', // YE-F-04: the retained-earnings roll named
  'ye-f05-reopen-by-state.test.cjs', // YE-F-05: a year-closed month says by_year, no Reopen month
  'ye-f06-closed-evidence.test.cjs', // YE-F-06: closed year evidence (when, who, how, profit)
  'ye-f06-return-stage.test.cjs', // YE-F-06: one stage word per return period
  'ye-f09-twelve-months.test.cjs', // YE-F-09: the practice row counts 12 months in a year
  'ye-f07-overdue-return.test.cjs', // YE-F-07: an overdue BAS is named (firm row + To do)
  'vault-sections.test.js', // test sweep 7 Nov 2026: was in no runner, passes offline
  'vertical-readers-characterisation.test.cjs', // P1-14: the 21 trade-reader answers pinned; the 7 that change under the one resolver are listed
  'acc-215-half-step.test.cjs', // U1 (8 Nov, was run by no CI job): ACC-215 (Athi 2026-11-07, HALF step): an AU cash gap posts as round-off only up to ceil(step/2)-1
  'acc-221-blank-rate-route.test.cjs', // U1 (8 Nov, was run by no CI job): tests/acc-221-blank-rate-route.test.cjs — ACC-221/222 live fault (SIT part 6, 2026-11-07): a BLANK gst_rate with no shelf rate ans
  'acc-230-expense-gst.test.cjs', // U1 (8 Nov, was run by no CI job): ACC-230: AN EXPENSE CHIT WITH GST POSTS NET + INPUT TAX, NOT GROSS.
  'acc-240-lock-trail.test.cjs', // U1 (8 Nov, was run by no CI job): ACC-240 (AU-AUDITOR-READINESS §A7): A MONTH LOCK CAN BE LIFTED, BUT NEVER SILENTLY.
  'acc-75-cost-ledger-only.test.cjs', // ACC-75 (proof 2026-11-14): cost is ledger-only (no chit_header cost column); cost.read sums chit_line_cost per currency and takes the mar
  'acc-141-named-customer-credit.test.cjs', // ACC-141 (proof 2026-11-14): a customer added by name is an ordinary party and receives a credit on credit (Cr debtors on his party_id)
  'acc-118-cmdb-documents-records.test.cjs', // ACC-118 (proof 2026-11-14): the CMDB holds a record for the till, accounts.html, the chit sheet, one-person and the Labs
  'acc-168-freeze-no-second-read.test.cjs', // ACC-168 (proof 2026-11-14): freezeOnComplete takes the row the transaction already holds (no second chit_header read)
  'inbooks-1128.test.cjs', // WALK M M-F-04/M-F-05 (1128): a credit note waits for its own sale (hand case in paise); one open waiting row per bill
  'money01-1129.test.cjs', // VERIFY-MONEY-01 (1129): next-return cash date, one csv guard, consent = allow-list, flags/party/ref/minor refuse, hand figures in paise
  'acc-263-credit-refund.test.cjs', // U1 (8 Nov, was run by no CI job): ACC-263: A TILL CREDIT NOTE REFUNDED "ON CREDIT" POSTS AGAINST THE CUSTOMER'S RECEIVABLE.
  'acc-268-unread-bills.test.cjs', // U1 (8 Nov, was run by no CI job): tests/acc-268-unread-bills.test.cjs — ACC-268: A RETURN NEVER GOES OUT WITH A BILL SILENTLY MISSING.
  'acc-269-expense-itc.test.cjs', // U1 (8 Nov, was run by no CI job): tests/acc-269-expense-itc.test.cjs — ACC-269: GSTR-3B 4A READS AN EXPENSE CHIT'S INPUT TAX (the tax ACC-230 posts to input_cgst / 
  'acc-269-live-expense.test.cjs', // U1 (8 Nov, was run by no CI job): tests/acc-269-live-expense.test.cjs — ACC-269 LIVE PATH: the till's REAL expense chit (SIT P1 run part 16) has NO summary_json.mon
  'acc-270-reversed-named.test.cjs', // U1 (8 Nov, was run by no CI job): tests/acc-270-reversed-named.test.cjs — ACC-270: A BILL THE BOOKS NO LONGER HOLD IS NAMED IN THE RETURN, AND THE FILED MONTH DOES 
  'acc-273-send-reads-registration.test.cjs', // U1 (8 Nov, was run by no CI job): tests/acc-273-send-reads-registration.test.cjs — ACC-273: THE PARTY A SEND PRICES READS THE SHOP'S OWN REGISTRATION (hand-computed
  'acc-277-compute-said-no.test.cjs', // U1 (8 Nov, was run by no CI job): tests/acc-277-compute-said-no.test.cjs — ACC-277: AN AU SHOP WHOSE OWNER SAID "NOT REGISTERED" IS NOT CHARGED GST on POST /api/tax
  'acc192-debit-note.test.cjs', // U1 (8 Nov, was run by no CI job): tests/acc192-debit-note.test.cjs — ACC-192 slice 2: a priced RAISE on an issued invoice is a DEBIT NOTE over the CHANGED LINES ONL
  'api-47-closed-bodies.test.cjs', // U1 (8 Nov, was run by no CI job): API-47 (S33): the 12 doors only our web calls refuse an unknown body key, 400 by name, and still take every body the web sends.
  'api-8-strict-money.test.cjs', // U1 (8 Nov, was run by no CI job): OWNS API-8 (S33): the money bodies are allow-lists, and each still names every key its handler reads.
  'api-43-pricing-tolerant.test.cjs', // API-43 (k78, enrolled with the merge): POST /api/pricing/price ignores unknown body keys again
  'api-tolerant-outward.test.cjs', // API-43 (k78, enrolled with the merge): the tolerant_outward scope list: strict_input does not apply, a short reason counts for nothing
  'api-tolerant-till.test.cjs', // S33-T: the counter's queued doors (flags, stock, stock/bulk, reward, reward/claim, quick-keys hide/unhide) and POST /api/chits/send ignore zz_unknown, take the keys older counters sent, refuse a wrong kind 400 in the problem shape
  'identity-secret.test.cjs', // before and after b874: the sign-in reads run with or without ops.identity_secret; a failed ask keeps the view SQL (fail closed)
  'api-tolerant-doors.test.cjs', // S33-T (#1105-#1108): every tolerant door ignores an unknown key and refuses a known key of the wrong kind; the strict catalogue doors name the key they refuse (44 checks)
  'till-queue-poison.test.cjs', // S33-T: the counter's own drain parks a refused queued row (400) with the server's words and sends the rows behind it; a refused bill is never deleted
  'till-park.test.cjs', // till-park (12 Nov): a queued CHANGE refused for good (400/404/409/422) is parked once with the server's words, never retried; a bill never parked; Drop is the owner's; the price grain (JPY 0, INR 2, KWD 3) refuses a finer typed price and rounds a bulk step
  'till-refund-tender-1129.test.cjs', // AF-F-01 (1129): a refund defaults to the bill's own tender; another needs a reason and an owner/manager seat; the drain parks a credit note refused 409/422, never loops
  'ctr-204-till-hold.test.cjs', // CTR-204 (till half, api #1240): a sale answered 409 CHIT_REPLAY_DIFFERS is HELD (no retry, the server's words), one cashier confirm renumbers it; TILL_SERIES_COLLISION still auto-renumbers
  'ctr-227-no-country-bill.test.cjs', // CTR-227 (k78, enrolled with the merge): a bill with no country is refused in words
  'ctr-155-114-till.test.cjs', // CTR-155 + CTR-114: a 403 MEMBERSHIP_SUSPENDED holds that one bill and the queue goes on (a plain 403 still stops it); usignBecome clears busy when becomeShop throws
  'ctry-72-no-country-refusal.test.cjs', // CTRY-72: a shop with no country gets words, never the rupee (products lists money_why, tax slabs, legacy catalogue service)
  'walki-ae-vat-slab.test.cjs', // WALK I I-F-06: b892 puts the AE standard-rate slab (VAT 5%, DL Art. 3) on the regional layer; 476 fils of 10000 inclusive
  'walki-ae-buyer-trn.test.cjs', // WALK I I-F-03: a counter sale to an AE buyer with a TRN keeps name + TRN (B2B), no state from the TRN's digits; IN still reads the GSTIN's state
  'walki-named-customer-party.test.cjs', // WALK I I-F-07: a named counter customer joins the one party list after the send (source guard)
  'till-walky-1129.test.cjs', // WALK Y Y-F-01: a return on a credit bill comes off what they owe, the rest stays as credit (walk cents)
  'walky-rate-menu-1129.test.cjs', // WALK Y Y-F-03: a gst_rate the country pack's menu does not list is refused in words
  'till2-start-country-1128.test.cjs', // fixTill2 1128: the counter's starter mint (POST /catalogue) hands the shop country to mintPlan: no Chennai hotel list outside India
  'till2-docdtls-no-1128.test.cjs', // fixTill2 1128: the invoice stamped at send carries the bill number in DocDtls.No, not null
  'till2-buyer-tax-field-1128.test.cjs', // fixTill2 1128: till buyer tax-number box (#cgstin): pack word + pack check, rides business_json.customer.gstin
  'ctry-139-band-asof.test.cjs', // CTRY-139 (engines v1.86.0): the law-set price band is read as of the shop's day of the document
  'ctry-139-number-at.test.cjs', // CTRY-139: the number-at read of the adopted engine
  'ctry-139-till-band.test.cjs', // CTRY-139: the till's band, same as the api's
  'ctr-242-till-shop-day.test.cjs', // CTR-242+CTR-180: every till day cut (lists, close, closed mark, summary key) is the shop's day, 00:10 IST/AEDT
  'set86-country-setup-merge.test.cjs', // SET-86 (P1): PUT /country-setup is a merge-patch; omitted tax unchanged (4.76 on 100.00 at 5% inclusive), confirmed de-registration, stray key refused
  'tax01-1128-country-setup.test.cjs', // TAX01 rows 3, 7, 11, 14 (1128): a scheme the pack lacks is refused; a re-save keeps a flag the form never sent; a number with no answer is refused
  'tax01-1128-shelf.test.cjs', // TAX01 rows 1, 4, 5 (1128): a failed identities read refuses (503); the no-id gate is the pack's; a rate-less slab is never a live 0%
  'taxp1-1129-shelf-closed.test.cjs', // TAX-01 r1 (1129): sendSeller rethrows TAX_SHELF_UNREADABLE (503): a send whose shop tax details cannot be read is refused, never billed with no tax (118000 owed, not 100000)
  'tax-line-modules-1129.test.cjs', // tax-line-status + tax-engine-line (moved out of tax-lines): RATED/ZERO/UNAVAILABLE, the refusal, the engine line's fallbacks
  'route-modules-1129.test.cjs', // the small modules moved out of the four big route files (till credit-note money, books statement shape, products media/import, chits send steps): one rule each, the refusal, the fail-closed case
  'tax-explicit-1129.test.cjs', // TAX-EXPLICIT (1129): every bill line is RATED, ZERO with a reason, or UNAVAILABLE (refused in words, TAX_LINE_UNAVAILABLE); IN 1,000 at 18% → 1,180 · exempt · AU GST-free · AE 5% · no rate · unreadable cess
  'rcm-input-1129.test.cjs', // AQ-F-01 (1129): ONE resolver says which lines are reverse charge (lib/rcm-lines): the line's category, or reverse_charge:true + the pack's HSN list; HSN alone only asks; an unreadable word is a 422 RCM_INPUT_UNREADABLE
  'rcm-return-1129.test.cjs', // AQ-F-03 (1129): a credit note on a reverse-charge bill posts Dr RCM payable / Cr Input per rate and takes 3.1(d) and the credit back in the 3B (needs the engines posting + gst-returns change)
  'gstr1-rchrg-1129.test.cjs', // AQ-F-02 (1129): the seller's GSTR-1 rchrg is Y where the invoice's own RegRev is Y (needs the engines gst-returns change)
  'bill-no.test.cjs', // lib/bill-no: the one reader of a bill's number (bill_no, printed_as, invoice_no, doc_no), as typed and compared
  'as-1129-order.test.cjs', // AS-F-03: blank number assigned from the seller's series, drafts never refused, invoice_no read, duplicate refused - through routes/chits.js SEND_STEPS in the real order
  'as-1129.test.cjs', // AS-F-03/04/07/11 (1129): rail invoice number required, in format, unique per FY; a note names its bill (number, date); opening refuses 100.5 paise; GSTIN verify uses the write's check character
  'ay-1129.test.cjs', // AY-F-01/03/04/06 (1129): a credit note follows its bill's place of supply (IGST, CDNUR); PO quantity 0 refused; a receipt dated ahead refused; the e-invoice block names Version and DocDtls
  'ops121-oversell.test.cjs', // OPS-121 (1129): selling more than the shelf shows: allow and flag by default (no shelf read on the send, the post names the item below zero), block = online 409 STOCK_SHORT before it posts, an offline replay always posts; negative_stock owner-only
  'as-rcm-1129.test.cjs', // AS-F-01 (1129): RCM from an unregistered supplier with no state is taxed at the buyer's state (needs the engines tax change adopted)
  'books-bill-ref.test.cjs', // AZ-F-03: the one resolver of a booked bill's names (stored ref, client_ref, entry id, entry no, rail bill no); a name no bill carries is refused; a down read is not swallowed (9 checks)
  'books-return-registration.test.cjs', // GREY-AU U-F-09: the not-registered answer of GET /returns in the pack's own words, the empty form, the base kept (6 checks)
  'books-store-gstclass.test.cjs', // AU BAS G10: the net tax of entries that also carry a line on given roles; nil for no row; a down read is thrown (7 checks)
  'home-facts-sold.test.cjs', // M144 / BD-F-01: the Home Till card's books day from the Day book rows, no figure across two currencies, a quiet unprovisioned ledger (9 checks)
  'policy-stock.test.cjs', // OPS-121: the below-zero switch row, an enum of two ways, allow as the default, owner words passed in (7 checks)
  'signin-provider-door.test.cjs', // SEC-112 P1a: every refusal has its sentence and status, one answer for spent / foreign-device codes (6 checks)
  'signin-provider-handoff.test.cjs', // SEC-112 P1a: the handoff route: NO_DEVICE first, the door's refusal, a 503 in true words, DEVICE_REVOKED, the token in the body only (7 checks)
  'signin-provider-connect.test.cjs', // SEC-112 P1a: connect/list/unlink at the handler: the list contract, a fault never leaks, blind 401/403, an unlink twice is 404 (13 checks)
  'stock-below-zero.test.cjs', // AT-F-03: the refusal below zero: flag, in words, a resend is not refused, an unreadable log throws (7 checks)
  'tax-zero-guard.test.cjs', // TAX-EXPLICIT (1129): no new `<taxish> || 0` / `?? 0` and no swallowing catch in the tax files unless tests/support/tax-zero-allow.json names it with its reason
  'walkr-1129.test.cjs', // WALK R (1129): zero-rated / exempt sales on their own ledgers and VAT201 boxes 4/5 (hand case in fils), the issuer posts its rail credit note, the buyer's note waits for the supplier list
  'walkt-1129.test.cjs', // WALK T (1129) T-F-01: VAT201 Box 9 counts only a bill's 5% lines (hand 12000 / 600 in fils, not 41000), 0% lines of the same bill out, a reversal nets away
  'ae-f02-trn-dashes.test.cjs', // AE-F-02: a TRN typed with dashes or spaces is cleaned to 15 digits by the pack's rule (was a 500 at gstn varchar(15)); wrong lengths refused in words
  'ae-f03-setup-asks.test.cjs', // AE-F-03: the pack's setup questions (Emirate · VAT period · zone) asked once, kept in tax_registration.asked, read by the return
  'till-walkaa-1129.test.cjs', // Walk AA (1129): the slip's Taxable never holds a zero-rated or unrated line (own rows), the credit note's title in both languages from the pack, the reason-not-stated word from the pack's scheme word
  'till-zero-lines-1129.test.cjs', // Walk R-F-02/R-F-05/AU P-F-08 (1129): a 0% line says its reason (Zero-rated · Exempt · GST-free · VAT 0%, with the pack's other-language words), the taxable is split by class on the slip foot and the day close; hand figures in fils and cents
  'till-slip-read-1129.test.cjs', // the slip split into named steps prints byte for byte what it did: 16 golden slips (IN, AU, AE, JP, US; credit note, zero-rated, multi-rate, foreign buyer) + each step
  'till-takings-1129.test.cjs', // Walk R-F-04 (1129): the till summary's live day counts counter bills only (a rail credit note is not a sale): 158.00 AED = the day close
  'till-walkq-1129.test.cjs', // Walk Q (1129): Q-F-02 a credit note carries the original bill's taxable and tax (read from the invoice's ItemList) and the slip prints them · Q-F-03 a return into a closed day asks to reopen · Q-F-05 a view-only seat is greyed with its reason · Q-F-07 the day close's rate rows read the invoice (the books' figures); hand figures in paise
  'al-credit-note-tax.test.cjs', // AL-F-01 (1129): a till credit note prints the tax it reverses per rate through the slip's tax block, from the posted by_rate; hand figures in paise
  'al-move-in-gstin-sources.test.cjs', // AL-F-02/03 (1129): move-in source list greys Tally/Zoho with a sentence; the contacts preview and the write share ONE GSTIN check (party-fields.checkTaxId)
  'ap-1129-order.test.cjs', // AP-F-08: the rate list of the document's own day (a back-dated IN bill at 12/28, a note on it, a stated export) through routes/chits.js SEND_STEPS in the real order
  'ap-move-in.test.cjs', // AP-F-01..08 (1129): QBO Account # is the code, Business ID No. the ABN, title-row hint, reversed opening frees the file, locked month refuses an opening, MYOB greyed, body currency judged, rate outside the pack refused
  'ay-till-1129.test.cjs', // AY-F-01 till half (1129): the till's credit note takes its supply and place of supply from the original bill it holds (or its frozen invoice), says in words when it cannot; the server steps give IGST for an inter bill, CGST+SGST for an intra one
  'till-day-returns-1129.test.cjs', // Walk U (1129) U-F-02: after a return the day close's rate rows, the F10 sheet and the returns line equal the books (a credit note's by_rate is taken back whatever shape the read gave); AU walk + IN 5%/18% in cents; api creditNoteMoney carries by_rate
  'ae-day-report-tax-word.test.cjs', // Walk AE: the till day report names the tax in the pack's word (VAT), never a fixed GST
  'ae-f18-expense-vat.test.cjs', // AE-F-18: Pay expense takes the pack's tax rate + supplier TRN; 420.00 at 5% inside posts Dr 400.00 / Dr input VAT 20.00 / Cr bank 420.00 (needs BOOKS_ENGINES_SRC)
  'set80-currency-lock.test.cjs', // SET-80/81 (k80, enrolled with the batch): a traded shop's currency is locked on every door; unknown codes refused
  'plt85-gone-lease.test.cjs', // PLT-85/87 (k80, enrolled with the batch): an abandoned request keeps its place until its work ends; pool busy = 503
  'api-strict-input-status.test.cjs', // U1 (8 Nov, was run by no CI job): PINS what an unknown body key answers, per route, on the real app (the cases of tools/api-contract-tests.cjs: stand-in database, r
  'bell-delivery.test.js', // U1 (8 Nov, was run by no CI job): A BELL IS WATCHED FOR DELIVERY, NOT FOR CONNECTION ([TILL-167], BACKLOG TILL-146).
  'books-date-given.test.cjs', // U1 (8 Nov, was run by no CI job): ACC-274: a date the caller GIVES is read once, by books-period.dateGiven (dateOf and routes/books.js dateQ both go through it).
  'books-month-given.test.cjs', // FIN-103 / ACC-333 / ACC-334: a given date, month or GSTR form is read once (books-period.dateGiven / monthGiven, years 1900-2100); a bad one is a 400, never a 500 or a default.
  'cat-305-pricing-input-guards.test.cjs', // CAT-305/306/312: pricing/price and offers/evaluate refuse a qty not above 0, a price below 0 or blank, an unknown structure; the break test
  'cat-258-unpriced-bands.test.cjs', // U1 (8 Nov, was run by no CI job): CAT-258: an UNPRICED tiered line is "no price set", never a free band, and no bill prices it at 0.
  'ctp-query-answer-keys.test.cjs', // U1 (8 Nov, was run by no CI job): API-7 (S34): the answer to a signed CTP question names its keys.
  'ctr-186-till-deliver-to.test.cjs', // U1 (8 Nov, was run by no CI job): tests/ctr-186-till-deliver-to.test.cjs — CTR-186: THE COUNTER RECORDS WHERE THE GOODS GO.
  'ctry-77-cash-step.test.cjs', // U1 (8 Nov, was run by no CI job): tests/ctry-77-cash-step.test.cjs — CTRY-77 / AU-02b: THE API REFUSES A CASH PART NO COIN CAN MAKE.
  'ctry-77-send-route.test.cjs', // U1 (8 Nov, was run by no CI job): tests/ctry-77-send-route.test.cjs — CTRY-77: THE REAL SEND STEP, OVER A REAL EXPRESS APP, FOR AN AU SHOP.
  'tender-sum-1129.test.cjs', // walk P P-F-01: the api refuses a counter bill whose tenders do not add up to its total (422 TENDER_SUM_MISMATCH, minor units, replay accepted)
  'till-tender-sum-1129.test.cjs', // walk P P-F-01 + TAX-EXPLICIT: the till stops a short tender and a line with no tax answer before the send
  'walkf-1128-core.test.cjs', // ⭐ WALK F (1128): GSTIN state code 01-38/97/99 · FY month fixed once books exist · bill_no refused in words (16 chars, charset, empty) · a composition/unregistered seller cannot issue a tax invoice
  'ctry-77-till-cash-parts.test.cjs', // U1 (8 Nov, was run by no CI job): tests/ctry-77-till-cash-parts.test.cjs — CTRY-77: THE TILL TAKES EVERY CASH PART ON THE PACK'S COIN STEP.
  'ctry-81-send-stamp-delivery.test.cjs', // U1 (8 Nov, was run by no CI job): tests/ctry-81-send-stamp-delivery.test.cjs — CTRY-81 live fault (SIT part 6, 2026-11-07): the invoice STAMPED AT SEND reads the ch
  'ctry-94-invoice-no-country.test.cjs', // U1 (8 Nov, was run by no CI job): tests/ctry-94-invoice-no-country.test.cjs — POST /api/invoice/build for a shop with NO country answers 422 NO_COUNTRY, never a 500
  'ctry75-regof-unknown.test.cjs', // U1 (8 Nov, was run by no CI job): tests/ctry75-regof-unknown.test.cjs — CTRY-75 prerequisite: AN UNKNOWN TAX REGISTRATION IS ASKED, NEVER READ AS REGISTERED.
  'ctry75-tax-registration-unknown.test.cjs', // U1 (8 Nov, was run by no CI job): tests/ctry75-tax-registration-unknown.test.cjs — CTRY-75: b841 resets ONLY the tax answer migration b299 assumed, never an owner's
  'customer-by-name.test.cjs', // U1 (8 Nov, was run by no CI job): POST /customers { name } adds a customer who is NOT on ChitBridge (Athi, 2026-10-02:
  'dispute-audience.test.cjs', // U1 (8 Nov, was run by no CI job): tests/dispute-audience.test.cjs — RAIL-187: lib/dispute-audience.audienceOf, the ONE reading of who receives a dispute's message.
  'docnumber-gate.test.js', // U1 (8 Nov, was run by no CI job): ── tests/docnumber-gate.test.js · THE SERVER CHECKS THE NUMBER, AND NEVER REFUSES IT ────────────────────────
  'finance-terms.test.cjs', // U1 (8 Nov, was run by no CI job): CB FINANCE · TERMS (F2): shop default + per-party override (resolver), the limit check, one change event per
  'idem3-payment-clear.test.cjs', // U1 (8 Nov, was run by no CI job): tests/idem3-payment-clear.test.cjs — DELETE /api/chits/:chit_id/payment ("Mark unpaid") is SAFE TO REPEAT (contract pass, 7 Nov 20
  'idem3-till-reward.test.cjs', // U1 (8 Nov, was run by no CI job): tests/idem3-till-reward.test.cjs — the counter's two points writes are SAFE TO REPEAT (contract pass, 7 Nov 2026).
  'idoc-subject.test.cjs', // U1 (8 Nov, was run by no CI job): tests/idoc-subject.test.cjs — who may file a document against whom.
  'net-94-release-time.test.cjs', // NET-94/NET-87 (9 Nov): a GIVEN release time that is not a date is a 400 DATE_INVALID, never the next opening or no end
  'net-56-withdraw-earlier-end.test.cjs', // B13 (12 Nov): NET-56 a second withdraw keeps the EARLIER end and answers 200 with it (ATHI-DECISIONS 6 Nov)
  'net-76-ask-by-bridge-id.test.cjs', // B13 (12 Nov): NET-76 an ask by childBridgeId makes a local shop's node; a remote one is refused, nothing written
  'plt-67-register-member-taken.test.cjs', // B13 (12 Nov): PLT-67 register refuses a retired or local key (NET_KEY_TAKEN); an active member needs --update (spin.sh passes it)
  'rail-30-meter-chit-send.test.cjs', // RAIL-30 (proof 14 Nov): a sent chit writes one chit.send ledger row with its basis, a draft none, a failed meter never fails the send
  'rail-65-labelled-never-converted.test.cjs', // RAIL-65 (proof 14 Nov): an amount is labelled never converted: money.sum refuses mixed, the bill door 409s a foreign cell, no rail file reaches a rate table
  'rail-71-with-transaction.test.cjs', // RAIL-71 (proof 14 Nov): withTransaction commits/rolls back, and the /send fan-out and dispute creation run inside it
  'rail-121-dispute-participants-both-sides.test.cjs', // RAIL-121 (proof 14 Nov): the seller's copy of a dispute names raiser AND party, written and read
  'net-77-remote-dealer-409-mutation.test.cjs', // U1 (8 Nov, was run by no CI job): NET-77 mutation checks: break the refusal two ways and tests/net-77-remote-dealer-409.test.cjs MUST go red each time.
  'net-77-remote-dealer-409.test.cjs', // U1 (8 Nov, was run by no CI job): NET-77 (owner cb-network): asking to connect to a business on ANOTHER installation (a supplier stub here) is refused, nothing save
  'net-edge-answer-keys.test.cjs', // U1 (8 Nov, was run by no CI job): NET-EDGE (owner cb-network): the five POST /api/network/connections/:id/{approve,decline,suspend,resume,disconnect} answers name t
  'not-migrated.test.cjs', // U1 (8 Nov, was run by no CI job): OWNS the proof that lib/not-migrated.js words a "waiting for the update" answer in plain words with its required "meanwhile", and 
  'ops-81-one-payable.test.cjs', // U1 (8 Nov, was run by no CI job): OPS-81 · A SUPPLIER BILL POSTS ONE PAYABLE, WHICHEVER PAPER ARRIVES FIRST.
  'ops82-match-invoice.test.cjs', // U1 (8 Nov, was run by no CI job): tests/ops82-match-invoice.test.cjs — OPS-82: GET /api/till/match attaches to each purchase order the supplier invoice that BILLS i
  'ops100-match-open.test.cjs', // OPS-100 (13 Nov): tests/ops100-match-open.test.cjs - the match says open, not differs, while the delivery is open; an absorbed short is no difference
  'ops351-billed-qty.test.cjs', // OPS-351 (13 Nov): tests/ops351-billed-qty.test.cjs - the match sets billed beside received per line; billed above received is differs
  'ops83-match-money.test.cjs', // OPS-83: tests/ops83-match-money.test.cjs — GET /api/till/match compares tax-in with tax-in through lib/their-bill.check on carried figures (received_with_tax, money_code); pins the till-written order.from (OPS-124)
  'pack-words.test.cjs', // U1 (8 Nov, was run by no CI job): AU-WORDS (2026-10-15): the words a screen says for a shop's country come from ONE reader (lib/pack-words), per pack.
  'plt86c-bills-inflight-503.test.cjs', // U1 (8 Nov, was run by no CI job): PLT-86c: a database connection killed under GET /api/till/bills answers 503 DB_CONNECTION_LOST.
  'prove-session.test.cjs', // U1 (8 Nov, was run by no CI job): tests/prove-session.test.cjs — tools/tally-connector/prove.js session(): every write is ONE attempt with its OWN Idempotency-Key.
  'reset-and-seed.test.cjs', // U1 (8 Nov, was run by no CI job): tests/reset-and-seed.test.cjs: the reset wipe clears the identity-owned tables before identities (SEC-130 residual). Fake db, no d
  'rev01-price-includes-tax.test.js', // U1 (8 Nov, was run by no CI job): [REV-01] "Every server-side invoice is 18% too high, and it is frozen
  'rev02-no-rerate-on-send.test.js', // U1 (8 Nov, was run by no CI job): ── ⭐⭐⭐ [REV-02] "A BILL THE CUSTOMER HAS PAID IS RE-PRICED AT TODAY'S OFFERS WHEN IT SYNCS" ─────────────────
  'sec-149-soft-token.test.cjs', // U1 (8 Nov, was run by no CI job): tests/sec-149-soft-token.test.cjs — SEC-149: a public door that serves MORE to the owner (GET /api/catalogue/:bridge?preview=1, th
  'preview-token.test.cjs', // CUSTOMER-DELINK 2: the owner preview token (aud cb-shop-preview, 15 min, this shop, the preview read only): reads the preview, refused on a back-office route, after expiry and for another shop
  'testnews.test.cjs', // U1 (8 Nov, was run by no CI job): THE LOOP CLOSES, AND IT CLOSES ON THE RIGHT PERSON.
  'till-no-country-boot.test.cjs', // U1 (8 Nov, was run by no CI job): CTRY-94 regression: a shop with no country must not abort the counter's boot. billMoney() (reached from paintTotals at load) calle
  'change-pin-lock.test.cjs', // U1 (8 Nov, in no GUARDS array): PPL-30: change-pin counts a wrong current PIN and honours the lock (was named only in NEEDS_ENGINES, which skips and never runs)
  'change-pin-lock-mutation.test.cjs', // U1 (8 Nov, in no GUARDS array): PPL-30: with the count-and-lock removed the test above goes red (was named only in NEEDS_ENGINES)
  'signin-otp-budget-m1.test.cjs', // M1 (batch 1128): asking for a code again keeps the wrong-guess count while the old code is live
  'pin-timed-lock-m3.test.cjs', // M3 (batch 1128): the PIN lock is timed with a doubling back-off, never permanent
  'pin-lock-lift-micro.test.cjs', // GF-SECURITY#L73 (secreopen 1130): the lift is decided in SQL, a microsecond lock time lifts after its window
  'sec3-s1-tester-secret.test.cjs', // S1 (batch 1128): the tester code needs 8 secret characters outside the public date; misses counted per caller address too
  'sec3-s2-no-live-otp-in-log.test.cjs', // S2 (batch 1128): notify.js never prints a live OTP to a log off a developer's own stack (+ S14 name escaped)
  'sec3-s7-weak-pin.test.cjs', // S7 (batch 1128): 0000, 1234, repeated and counting PINs refused when set
  'sec3-s6-legacy-renew.test.cjs', // S6 (batch 1128): a legacy token's renewal keeps its own issue time as born
  'session-limits-m5.test.cjs', // M5 (batch 1128): absolute session life, till surface only on a paired device, first-PIN door refuses a seat that has a PIN
  'signin-account-budget-one-counter.test.cjs', // M1 follow-up (batch 1128): one attempt counter, never reset by an ask, per ACCOUNT across codes and the PIN (NIST 800-63B 5.2.2); column absent = as before; read fails = refused
  'otp-one-counter-never-reset-by-ask.test.cjs', // M1 class (batch 1128): lib/employee-code.js issue, routes/connectors.js reissue-code, routes/network-design.js reissueClaim keep the guess count while the old code is live
  'otp-writers-hashed.test.cjs', // VERIFY-EL-DB A11: the four other sign-in code writers store the keyed hash through employee-code.codeSet
  'migrate-stops-and-locks.test.cjs', // VERIFY-EL-DB A6: the runner takes an advisory lock and stops at the first failed numbered file
  'signin-compare-race-m2.test.cjs', // M2 (batch 1128): the lock/budget is re-checked in the spend (conditional update), not on the row read before the request
  'audit-ip-trusted-proxy-m8.test.cjs', // M8 (batch 1128): audit IP = req.ip under trust proxy (rightmost untrusted hop), never the typed left end of X-Forwarded-For
  'sec-nits-n2-n5-n6.test.cjs', // N2 N5 N6 (batch 1128): ids not addresses in the sign-in log, no constant tour secret outside test/local, sealed = not on the open list
  'db-error-survives.test.cjs', // U1 (8 Nov, in no GUARDS array): PLT-86: a database fault survives the mutation routes (was named only in NEEDS_ENGINES)
  'db-error-survives-mutation.test.cjs', // U1 (8 Nov, in no GUARDS array): PLT-86: with each handler removed the test above goes red (was named only in NEEDS_ENGINES)
  'itemmatch-corpus.test.cjs', // U1 (8 Nov, in no GUARDS array): the item-match corpus (was named only in NEEDS_ENGINES)
  'itemmatch-corpus-mutation.test.cjs', // U1 (8 Nov, in no GUARDS array): the corpus mutation set (was named only in NEEDS_ENGINES)
  'query-shape.test.js', // QA-172 (14 Nov): the per-file query budget (a query inside a loop) and the trigram check; was red and unenrolled
  'acc-176-grants-contract.test.cjs', // ACC-176: the member's grant routes against their contract; the pure rules (end date, purpose, no database = typed 503 in words); the consent words equal the allow-list
  'books-grants-seats.test.cjs', // frame P0: GET /api/books-grants answers seats and per-row may_use from holdsSeat / mayUseGrant (no second permission rule)
  'mark-offline.test.cjs', // MARK & QUERY (CAP-25): the adopter CI check (no detector, an unmapped word, an empty set, an unknown table or column fail), the core grep fixture (no adopter word in the core), the marks write-door classification (exactly two POST doors), the seal hygiene, the policy forms, the core's refusals with a recording stub
  'message-post.test.cjs', // MARK & QUERY PR1: the one message writer; a mark post is the mark definer only (no chit_message_deliver, no timeline, no CTP)
  'acc-176-grant-classification.test.cjs', // ACC-176: every books GET is classified for an auditor grant (a new GET is born refused); the synthetic auditor is not an owner, a commenter, read-only; the look failing answers 503 //
  'l16-statement-box.test.cjs', // l16 Statements box (b872): the ONE hash, refusals in words, duplicate and overlap by dates, the account by month grid, the grant doors (owner, adviser, auditor read-only, ended grant)
  'bkbeh-books-grants-behaviour.test.cjs', // BEHAVIOUR of PATCH /api/books-grants/:id and POST /:id/revoke: the end date moves, the grant ends, one audit row each, the wrong seat writes nothing
  'bkbeh-books-actions-behaviour.test.cjs', // BEHAVIOUR of GET /api/books-actions/:id and POST review / return / accept: steps, seats, the accept money (confirmed = prepared = written) and the posted lines
  'bkbeh-marks-thread-behaviour.test.cjs', // BEHAVIOUR of GET and POST /api/marks/:thread_id/messages: who replies, the class never changes, refusals write nothing
  'bkbeh-books-doors-behaviour.test.cjs',// BEHAVIOUR of party bills, evidence file, statement file and POST /bank/statements: scoping, bytes, audit event, carried BRS figures stored as carried
  'b3-bank-statements-cost-blind.test.cjs', // B3: a cost-blind reader gets 403 COST_BLIND on the bank statement files list, the file download and /bank/log (the one lib/cost.isCostBlind),
  'l16-audbank.test.cjs', // l16 audbank (W15-71, W15-97): the auditor reads the bank log, every books write route refuses the auditor seat, a month opens newest first
  'acc-176b-adviser-doors.test.cjs', // ACC-176b: every books-actions route is an adviser door or the owner's accept (a new one is born refused); no direct adviser write; the synthetic adviser is an editor, never an owner; who may use which grant
  'canon-rfc8785.test.cjs', // batch 1119 (std10 standards lane): enrolled the day it passes
  'deprecation.test.cjs', // batch 1119 (std10 standards lane): enrolled the day it passes
  'emvco-qr.test.js', // batch 1119 (std10 standards lane): enrolled the day it passes
  'json-schema-catalogue.test.cjs', // batch 1119 (std10 standards lane): enrolled the day it passes
  'problem-http-semantics.test.cjs', // batch 1119 (std10 standards lane): enrolled the day it passes
  'std10-ids-incoterms.test.cjs', // batch 1119 (std10 standards lane): enrolled the day it passes
  'every-test-is-enrolled.test.cjs', // U1 (8 Nov, the guard): U1 (8 Nov): every tests/*.test.(js|cjs) is run by a CI job or is on a named, ratcheted known list; the api half of the map measure tests_not_in_ci
  'country-literals.test.cjs', // CTRY-DATA (11 Nov): the country-literal ratchet — every file of lib/ routes/ middleware/ outside the packs holds its baseline [code ccy name law], class a (belongs in a pack) b (generic) c (adapter); a rise or an unexplained fall fails; the twin of engines #116
  'assist-resolve-retired-gone.test.cjs', // API-49: the retired POST /api/assist/resolve is deleted and nothing still names it
  'assist-resolve-retired-gone-mutation.test.cjs', // API-49: with the route put back the test above goes red
  'books-backfill.test.cjs', // lateBooks (1129): a late switch-on posts the earlier bills once, from the owner's start date (P-F-02, S2-F-07)
  'books-reconcile.test.cjs', // ACC-302 (13 Nov): one unreadable copy is NAMED in `dropped`, never throws the month (was on KNOWN_NOT_ENROLLED) // API-49: with the route put back the test above goes red
  /* RC gate (17 Nov): today's tests, offline, enrolled: */
  'bank-as-at.test.cjs', 'bankfix-signed-as-at.test.cjs', // the bank figure as at a date · the signed bank fix as at a date
  'grey-au-seat-and-registration.test.cjs', // GREY-AU 1129: Lock greyed for a seat that is not the owner · no BAS for a shop not registered, in the server's words
  'books-before-books-lock.test.cjs', // E3: months before the books start are not work to lock
  'books-sql-window-first.test.cjs', // MIS SPEED: the ledger window is found first, lines tested by account id
  'dues-zero-party.test.cjs', // E15: Who owes whom omits a party whose bills are all paid
  'e11-events-ticket-readonly.test.cjs', // E11: the auditor seat may POST /api/events/ticket
  'period-control.test.cjs', // the ONE period a firm looks at (16 Nov)
  'acct-c-f06-supplier-abn.test.cjs', // Walk C C-F-06: a taxed debit note asks for the supplier's ABN in the pack's word, with the box named (21 Nov)
  'practice-bands.test.cjs', // REP-73 slice 1: year-end pipeline, seat, bands, withheld reasons
  'prac150-practice-page.test.cjs', // PRAC150 (21 Nov): the practice list at 150 clients; limit=200 honoured, band over all rows
  'new-firm-access.test.cjs', // Athi 21 Nov: a NEW firm starts on client_access = assigned; a stored row keeps its value; no SQL
  'stale-kind-rate-change.test.cjs', // supply kind: a rate change clears the stale tax_kind (one reader)
  'staffpick-seen.test.cjs', // STAFFPICK: a staff seat reaches its own clients and the unassigned
  'supply-kind-door.test.cjs', // supply kind: the door (AE/AU/IN) refuses a kind the pack does not define
  'supply-kind-in-gstr.test.cjs', // IN supply kind: GSTR-3B 3.1(c)/(e) and GSTR-1 Table 8 on the api path, the ask from 2027-01-01
  'till-catalogue-door-gstfree-1133.test.cjs', // TILL-new-1: a GST-free item seeded through POST /api/till/catalogue keeps tax_kind; BAS G3 reads it
  'till-supply-kind.test.cjs', // a till return of a kinded line posts to its own kind ledger
  'products-supply-kind.test.cjs', // products POST/PATCH refuse a kind the pack does not define
  'in-f02-shop-gstin-state.test.cjs', // IN-F-02 a shop GSTIN opens with a state code
  'in-f03-party-state-follows-gstin.test.cjs', // IN-F-03 a party state follows its GSTIN
  'in-f04-one-rate-list.test.cjs', // IN-F-04 one rate list
  'in-f05-upi-tender.test.cjs', // IN-F-05 UPI is a way to pay
  'in-f08-gstr3b-setoff.test.cjs', // IN-F-08 the GSTR-3B set-off preview
  'in-f09-expense-input-credit.test.cjs', 'in-v-f06-supplier-gstin-bill.test.cjs', 'in-v-f07-offrail-itc-3b.test.cjs', // IN-F-09 Pay expense with GST; walk V V-F-06 (bill's supplier GSTIN), V-F-07 (off-rail ITC in 3B)
  'rail-buyer-supplier.test.cjs', // AE-F-19 add the rail seller as supplier and post
  'practice-words.test.cjs', // REP-73 B6: last-stage words from the country pack
  'w22-lock-line.test.cjs', // W22: the lock line
  /* QA-122 (14 Nov, enrolled from the known-red list; the test was stale, the behaviour held): */
  'iam-access.test.cjs', // IAM-SPEC §12/§18/§27/§29: closed hides the catalogue, read-only may message internally and never externally, only the entity provisions an actor, the level picked on create is the level saved
  'products-bulk.test.cjs', // CAT-W1: the bulk routes hand the set to the one writer once, validate every row before writing any, are capped and ordered before /:id; categorise is one request (reads the web app)
  'requirements.test.js', // a requirement raised while testing needs both evidence and rule, a rejection its reason, the list defaults to not-actioned and sorts as a backlog
  'test-board.test.js', // the test board: run kinds the screens offer are the route's, append-only results, identity from the token, the panel movable and its header balanced (reads the web panel)
  'tier2-record.test.js', // T2: an offer carries no total, captured fields are the shop's own and fail closed, the storefront pager is capped, an unsupported declaration is refused when written
  'read-batch-rls-guard.test.cjs', // OPS-27: a scoped readBatch runs with no [RLS-GUARD] warning and no throw fallback; an unscoped one is still guarded
  'read-batch-rls-guard-mutation.test.cjs', // OPS-27: exemption removed, or too wide, and the test above goes red
  'pm-18-log-taxonomy.test.cjs', // PM-18 (proof 2026-11-14): the five log levels, the LOG_LEVEL floor, stdout/stderr routing, fellBack = warn, the written rule
  'rail-141b-seal-v11.test.cjs', // RAIL-141b (#475): the versioned CTP seal 1.1 refuses alg none, a smuggled key and an old seal; the 1.0 seal still verifies
  'starter-fields.test.cjs', // COV2: the standard column set a trade starts from: base + own in one display_order, a relabel replaces not duplicates, unknown trade = base
  'boilerplate-source.test.cjs', // COV2: resolveBoilerplate (newest active, sources folded to brand + standards, locale over region_layer, null when absent) + registerSource idempotent rename
  'workroute-cascade.test.cjs', // COV2: routeFor rung order kind > network above (destination only) > entity default, why sentences, memo, failed read not cached
  'profile-map-ladder.test.cjs', // COV2: GSTIN check digit, PAN/state/PIN reads, assess fills + rungs, merge never lowers a rung
  'gateway-sim-run.test.cjs', // COV2: the gateway simulator sends the device-key ingest or the token chits/send, refusal exits 1
  'returns-sql-parity.test.cjs', // SHRINK: the fuzz tool's seeded draw, windows, row normaliser and local-only refusal (the fuzz itself needs Postgres)
  'speed17-marks-explain.test.cjs', // SHRINK: which indexes an EXPLAIN plan reads and the verdict (a journal_entry Seq Scan or no key index fails)
  'repoint-firm-clients-to-agency.test.cjs', // SHRINK: the repoint script refuses a production host, moves only governance edges
  'sim-history.test.cjs', // SHRINK: the demo-history entry builders, month readings and the day loop over stand-in doors (refusals counted and said)
  'bank-open.test.cjs', // SHRINK: the split parts' unit rules, refusals and fail-closed doors
  'books-bill-bands.test.cjs', // SHRINK: the split parts' unit rules, refusals and fail-closed doors
  'books-dues-units.test.cjs', // SHRINK: the split parts' unit rules, refusals and fail-closed doors
  'books-lock-note.test.cjs', // SHRINK: the split parts' unit rules, refusals and fail-closed doors
  'books-split-parts.test.cjs', // SHRINK: the split parts' unit rules, refusals and fail-closed doors
  'lib-leaf-units.test.cjs', // SHRINK: the split parts' unit rules, refusals and fail-closed doors
  'lib-opening-bills.test.cjs', // SHRINK: the split parts' unit rules, refusals and fail-closed doors
  'lib-period-units.test.cjs', // SHRINK: the split parts' unit rules, refusals and fail-closed doors
  'split-1138-units.test.cjs', // SHRINK: the split parts' unit rules, refusals and fail-closed doors
  'shrink-parts.test.cjs', // SHRINK: the split parts' unit rules, refusals and fail-closed doors
  'sim-load-api.test.cjs', // SHRINK: the loader's api door: one request, stop-on-error, /health wait, tracked and drained ledger hooks
  'api-fuzz500.test.cjs', // api-fuzz500 (junk-fuzz lane): a NUL byte, a 3000-char handle, a 20 KB field, a bad date reach every route over a stand-in db and answer a Problem, never a 5xx
  'api-ownerscope.test.cjs', // SEC-117: only the platform seat registers a network business owned by the PLATFORM (OWASP API3/API5), the route gate found on the loaded app
  'api-problem-chits-holds.test.cjs', // API-4 sweep, routes/chits-holds.js (holds, my-work, hand-over-all): every refusal a Problem, statuses tested, success answers held to the closed schema
  'api-problem-chits-jobs.test.cjs', // API-4 sweep, routes/chits-jobs.js: every refusal a Problem with its old keys frozen, over a stand-in db and auth
  'api-problem-signin-provider.test.cjs', // API-4 sweep, routes/signin-provider.js (3 doors): every refusal a Problem, statuses tested, redirects closed (register columns)
  'assign-holder-rule.test.cjs', // ASSIGN-1 W1: ONE rule for may this person hold this work (lib/access.levelOf), no database
  'assign-jobs-not-counted.test.cjs', // ASSIGN-1: assigning a job is not counted as a task, stand-in database, no server
  'assign-register.test.cjs', // ASSIGN-1: the generic assign capability register and its rules, a stand-in transaction records the statements
  'assign-holds.test.cjs', // ASSIGN-NET L11 + L9: what a person holds, hand over all (through the one writer), my work; a stand-in shop
  'readab-units.test.cjs', // READ-GUARD §7 unit evidence (1118v2 batch): auto-assign fail closed, books-readers, crm-followup-heir, own-limiters, policy-signin, public-base, chit service, resource-cap-live refusals; no database
  'books-ledger-reads-gate.test.cjs', // SEC-161 / BOOKS-GATE: trial-balance, periods, pl, bs and year status take the one ledger-reader test (owner, grant, auditor with can_see_costs)
  'crm-followup-assign.test.cjs', // CRM follow-up assign, offline over tests/support/crm-stub.cjs
  'dues-tb-control.test.cjs', // FC-M10: GET /dues?control=1 carries tb_control beside the trial balance control, offline
  'catalogue-owner-empty.test.cjs', // WALK S S-F-07: the owner of a shop with nothing published gets 200 and an empty answer; a stranger the one 404
  'dues-ledger-off-empty.test.cjs', // WALK S S-F-07: GET /dues with the ledger off is 200 and empty, not a 404
  'assign-race-r9.test.cjs', // enrolled 2026-11-20 (every-test-is-enrolled): passes offline on Linux
  'books-evidence-attach.test.cjs', // enrolled 2026-11-20 (every-test-is-enrolled): passes offline on Linux
  'books-yearclose-reopen.test.cjs', // enrolled 2026-11-20 (every-test-is-enrolled): passes offline on Linux with the books engines
  'delegation.test.cjs', // enrolled 2026-11-20 (every-test-is-enrolled): passes offline on Linux
  'gor-fullproof-1120.test.cjs', // enrolled 2026-11-20 (every-test-is-enrolled): passes offline on Linux
  'gorilla-1120-shared-input.test.cjs', // enrolled 2026-11-20 (every-test-is-enrolled): passes offline on Linux
  'heir-of-plug.test.cjs', // enrolled 2026-11-20 (every-test-is-enrolled): passes offline on Linux
  'products-bulk-twice.test.cjs', // enrolled 2026-11-20 (every-test-is-enrolled): passes offline on Linux
  'vol-2026-11-20-books-doors.test.cjs', // enrolled 2026-11-20 (every-test-is-enrolled): passes offline on Linux
  'practice-sql-inline.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): batch 1128 S41, the practice cash statement inlines clean (no lone apostrophe or ; in a SQL comment); offline
  'readab-1130-bill-step-units.test.cjs', // READ-GUARD §7: lib/chit-bill-step.js (written, retried, held, lost); offline
  'readab-1128-units.test.cjs', // READ-GUARD §7 unit evidence, batch 1128 (receipt-lines, shop-country, profilemap); offline
  'readab-1128a-units.test.cjs', // READ-GUARD §7: einvoice-note, message-client-id, weak pin refusals; offline
  'readab-1128-g0-units.test.cjs', // READ-GUARD §7: client-ip fail-closed; offline
  'readab-1128-chits-parts-units.test.cjs', // READ-GUARD §7: lib/chits-parts small steps (payment clear, withdraw, tax refusal); offline
  'year-close-warnings-store.test.cjs',
  'till-rate-repeat-press.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): S41 year-close warnings read the queue with the entity id; offline
  'api-junk-types-api9394.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'fin-15-advance-key.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'books-lib-units.test.cjs', // READ-GUARD §7 unit evidence for the small 20 Nov modules (input, reversal date, debit check, event guard, balance rows, locks, year reopen, switch audit, ask cap, no-store)
  'bankfix-signed-as-at.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'in-v-f06-supplier-gstin-bill.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'in-v-f07-offrail-itc-3b.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'reviews3-catalogue-gates.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'reviews3-shrinkage-lot-join.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'reviews3-stock-value-unit.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'at-1129-shop-day-ahead.test.cjs', // fixAT 1129 AT-F-04: a request dated the shop's own today is not tomorrow (the shop's zone, not UTC)
  'at-1129-supply-issue-below-zero.test.cjs', // fixAT 1129 AT-F-03: a supply used beyond what is on hand is refused in words; the till path still warns
  'reviews4-catalogue-price-parse.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'reviews4-crm.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'reviews4-network-security.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'reviews4-stock-gates.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'till-xss-handlers.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'walku-bank-write.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'ba-1129.test.cjs', // enrolled 2026-11-22 (walk BA): passes offline
  'be-1129.test.cjs', // enrolled 2026-11-22 (walk BE): passes offline
  'delivery-closed.test.cjs', // enrolled 2026-11-22 (walk BA): passes offline
  'walkw-1129.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'walkw-credit-qty-1129.test.cjs', // enrolled 2026-11-21 (every-test-is-enrolled): passes offline
  'books-split-units-1129.test.cjs', // readability 1129 (g1): the units split out of books, books-hooks and catalogue-write keep their rules
  'retest-1130-catalogue-failclosed.test.js', // retest 1130: EL-catalogue-01#L53/#L62 and GF-catalogue-01#L48 fail closed (gate read, source read, cost strip)
  'retest-1130-supply-kind.test.cjs', // retest 1130: AJ-F-01 supply_kind word reaches the engine, an unknown kind is refused
  'accw2-gst-gap.test.cjs', // sitclean 1130: enrolled (every-test-is-enrolled)
  'rw2acc-basis.test.cjs', // RW2-04: each BAS box says its basis, one line says why two quarters differ
  'at0204-default-period.test.cjs', // sitclean 1130: enrolled (every-test-is-enrolled)
  'finw2-earlier-tax.test.cjs', // sitclean 1130: enrolled (every-test-is-enrolled)
  'policy-words-1130.test.cjs', // sitclean 1130: enrolled (every-test-is-enrolled)
  'signoffw-till-chips.test.cjs', // sitclean 1130: enrolled (every-test-is-enrolled)
  'signoffw-unbroken-run.test.cjs', // sitclean 1130: enrolled (every-test-is-enrolled)
  'till-earlier-window-1130.test.cjs', // sitclean 1130: enrolled (every-test-is-enrolled)
  'till-start-mode-1130.test.cjs', // sitclean 1130: enrolled (every-test-is-enrolled)
  'ufo2-1130.test.cjs', // sitclean 1130: enrolled (every-test-is-enrolled)
  'eprred-thrown-refusal.test.cjs', // wave4 1130: enrolled (every-test-is-enrolled)
  'home-bank-signed-to.test.cjs', // wave4 1130: enrolled (every-test-is-enrolled)
  'open-items-timed.test.cjs', // wave4 1130: enrolled (every-test-is-enrolled)
  'rw127-1130.test.cjs', // wave4 1130: enrolled (every-test-is-enrolled)
  'rw1acc-1130.test.cjs', // wave4 1130: enrolled (every-test-is-enrolled)
  'rw1ctr-1130.test.cjs', // wave4 1130: enrolled (every-test-is-enrolled)
  'rw1fin-needs.test.cjs', // wave4 1130: enrolled (every-test-is-enrolled)
  'rw2ctr-1130.test.cjs', // wave5 1130: enrolled (every-test-is-enrolled)
  'rw2fin-1130.test.cjs', // wave5 1130: enrolled (every-test-is-enrolled)
  'p2wave-sec-1130.test.cjs', // wave5b 1130: enrolled (every-test-is-enrolled)
  'pathreds-1130.test.cjs', // wave7 1130: enrolled (every-test-is-enrolled)
  'homespeed-plan-once.test.cjs', // wave7 1130: enrolled (every-test-is-enrolled)
  'w4acc-bas-wages-boxes.test.cjs', // wave7 1130: enrolled (every-test-is-enrolled)
  'cat353-offer-scope-save.test.cjs', // CAT-353: an offer with an unreadable scope is refused at save
  'home-facts-network.test.cjs', // firm-connect-1138: the Home network card, owner only
  'firm-connect-1138.test.cjs', // firm-connect-1138 (UX-215/216/220): owner gates, direction pin, caps, fixed invite, costs consent, visits, Home card, bell; its --mutants mode is a CI step
];
module.exports = { GUARDS_PART };

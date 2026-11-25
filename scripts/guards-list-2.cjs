/**
 * guards-list-2.cjs — PART 2 OF 3 OF THE OFFLINE GUARD LIST (moved out of scripts/guards.cjs, 22 Nov 2026, filesize ratchet: a new file stays under 500 lines).
 *
 * OWNER     cb-qa
 * OWNS      GUARDS_PART: 455 consecutive entries of the declared offline list, in run order (first: connectors-ingest-not-money.test.cjs). Add a guard to the LAST part (guards-list-3.cjs), the day it becomes true, not before.
 * CALLED BY scripts/guards-list.cjs (joins the three parts, order kept) · tests that read the list as text: every-test-is-enrolled, junit-board, filesize-ratchet, readability-guard, junk-fuzz, sec-75-entity-schemas (via tests/support/guards-list-text.cjs).
 * FLOW      guards-list.cjs requires this file ──▶ one array, no entry changed ──▶ scripts/guards.cjs ──▶ scripts/guards-run.cjs
 * CARD      qa/offline-guards
 */
'use strict';
const GUARDS_PART = [
  'connectors-ingest-not-money.test.cjs', // POST /api/connectors/ingest is a device reading, in money_reviewed_not and not in money_writes (Athi 12 Nov)
  'catalogue-strict-input.test.cjs', // S33: catalogue enquiry and photo-extract bodies refuse an unknown key by name and still take every key a caller sends (API-30 bulk pass)
  'books-replay.test.cjs', // FIN-63 step 2: the fingerprint and the replay rule of a repeated confirm (pure; window 2 min, latest live batch by item_id)
  'books-payments.test.cjs', // ⭐⭐⭐ M26: /payments/preview + one-call record — W1–W4 (PAY D5, 24 h) → 409 unless acknowledged; allocations in the SAME tx; one client_ref posts once; outcome words
  'books-payment-replay-body.test.cjs', // AW-F-01: POST /payments, same client_ref + another amount = 409 EVENT_REF_REUSED (books-event-guard.refuseOtherPayment); same body still 200 duplicate
  'lock-wait-1129.test.cjs', // AW-F-02 + AM-F-05: a till day close or a bank sign-off in a LOCKED month waits on the one Waiting list in words; only the owner's press (POST /outbox/retry { forward: true }) posts it into the first open month
  'books-ref-guard-doors.test.cjs', // AX-F-02: loans, instalment, accruals, closing stock, contra, write-off: same client_ref + another amount = 409 EVENT_REF_REUSED (books-period postOwn / guardOf)
  'books-ref-guard-scan.test.cjs', // AX-F-02: static scan, every client_ref write door is guarded or exempt with a reason (a new door cannot forget)
  'books-staff-advance-handle.test.cjs', // AX-F-01: staff_advance / advance_recovered read the chart on a handle (a null handle was a 500)
  'walkax-credit-note-before-bill.test.cjs', // AX-F-03: a till credit note dated before its own bill = 409 CREDIT_NOTE_BEFORE_BILL
  'walkax-reads-and-zero.test.cjs', // AX-F-07/08: cashflow garbage days + future asOf, dues garbage side, write-off 0 = "How much?"
  'books-bank-rail.test.cjs', // BR1: GET /bank/rail — my advice + bank-question copies, on-rail parties, may.ask by the rail ladder; one read each
  /* ⭐⭐ THE TWO-SIDED COUNTER BILL (2026-10-01) — broken once each by scripts/two-sided-breaks.cjs */
  'tax-copy.test.cjs', // who sells on each copy: a counter bill I RECEIVED is my purchase, never in my GSTR-1
  'c11-10c-tax-month.test.cjs', // C11 10c: ACC-302 one unreadable expense chit is named in dropped and the month keeps every other bill's ITC; SPD-18 a month's parties are one identities read, ledger identical to the per-copy path; ACC-276 whole-minor words
  'fable-r6-country.test.cjs', // ⭐ R6-01/02/03 (Fable country review): is_export is carried by one reader; a registered buyer's bill without HSN and a rate off the dated menu are HELD (INVOICE_HELD_HSN / INVOICE_HELD_RATE)
  'bill-paper.test.cjs', // ⭐ CTRY-76: a tax invoice of A$1,000 or more names its buyer (reg-au s.29-70(1)(c)(ii)) — held under not_invoice, never a stop; a bad buyer ABN/GSTIN is refused by the ONE check (profile.taxIdRefusal)
  'page-name.test.cjs', // ⭐ N03: every chit names its detail page at mint (base by default); an unknown name is refused; nothing rewrites it
  'two-sided-bill.test.cjs', // a till sends its own on-rail customer their copy — and nobody else; one shop row; replay-safe
  'goods-in-accepts.test.cjs', // goods-in, every line in → accepted through the SAME transition as Intake
  'two-sided-books.test.cjs', // one bill, two ledgers: sale at save, purchase on acceptance
  'bill-use.test.cjs', // what a bill I received is for — resale · use · asset — and what each posts; stock only for resale
  /* ⭐⭐⭐ ONE INVOICE, EVERYWHERE (2026-10-02) — broken once each by scripts/tax-truth-breaks.cjs */
  'tax-truth.test.cjs', // one counter bill read six ways (bill · chit · both ledgers · reprint · buyer's read), equal to the paisa; place of supply = the shop's state
  'tax-copy-pos.test.cjs', // CTRY-81: a composed chit is supplied where the goods go (delivery.state_code), bill-to-ship-to in the buyer's state, no fact keeps the labelled GSTIN fallback
  /* ⭐⭐ THE BILLS FOLDER (2026-10-01) — broken once each by scripts/bills-folder-breaks.cjs */
  'marketing-results.test.cjs', // ⭐ MKT-4: Who came back counts only SENT offers matched to real bills inside the shop's came_back_days (14 → 20 moves 3 to 4); a 0 carries its reason; before b776 a code, never a 500
  'marketing-outbound.test.cjs', // ⭐ MKT-2/17: Offers sent are receipts with the person, purpose, send and consent basis (b776 columns only once they exist); refusals in one INSERT; the list pages; select takes counterparty_ids/until
  'bills-folder.test.cjs', // the folder inventory numbered with the ledger; view folders; the step function; bills leave Task — nothing else
  'bills-private.test.cjs', // ⭐⭐ a bill's steps stay with the shop that took them, at the folder's messaging level; only the dispute always crosses
  'fin71-step-ticket.test.cjs', // ⭐ FIN-71: a bill's R-1400 step that fails raises ONE deduped Sev-3 ticket (client_ref r1400:payment:bill), never silent; no payment id in the step
  /* ⭐⭐ THE SHOP'S NAME IS THE PROFILE'S NAME (2026-10-01) — broken once each by tests/shop-name-breaks.test.js */
  'shop-name.test.js', // the account's name wins invoiceParty/profileValues; a vault name only fills an empty one; a difference is reported, case-blind
  'shop-name-breaks.test.js', // each of those four rules, broken once, turns shop-name.test.js red
  /* ⭐⭐ CB CRM, PHASES 3–4 (2026-10-02, API side) — offline: the real router over an in-memory stand-in (tests/support/crm-stub.cjs) */
  'crm-maytrade.test.cjs', // one mayTrade (onRail + population) with the verdict as a word; tillMaySend and the till snapshot ask it; mint kind 'cus'
  'crm-segment.test.cjs', // high_value in SEGMENT_SQL (top 10 %, >= 3 bills, override wins) and the fall-back before party_item exists
  'crm-read.test.cjs', // a both-roles party is ONE row; a merged / hidden / other-population party is never listed; dues = the stored figures; no per-row fetch
  'crm-interactions.test.cjs', // log a call / note (party_interaction stubbed); the 503 before b276
  'optout.test.cjs', // ⭐ CON-2: a STOP reply withdraws marketing consent for every party on the number (whatsapp + sms, source reply), whole-message match, per-country words, the offer footer, the signed webhook dismisses it and confirms after the 200
  'crm-followups.test.cjs', // follow-ups CRUD, assignment (owner or assignee), late in the SHOP's day, the 503 before b276
  'crm-sweep.test.cjs', // the nightly sweep rings the bell once a day per assignee, nothing sensitive on the event
  /* ⭐⭐⭐ THE WEB'S CONTRACT (2026-10-03: the CRM list failed live - roles an OBJECT, the page read a list) — chitbridge-web keeps a copy and holds its stand-ins to it */
  'api-17-query-day.test.cjs', // API-17: a ?since= that is not a day (7, -1, abc, 2026-02-30, twice) answers 400 VALIDATION_FAILED on folders/mis, relationships/scorecard and capture/consolidate, the db never asked
  'folders-split-pin.test.cjs', // MNT-59 pin: GET /messages, POST /messages/:id/mark, GET /rules/vocabulary and GET /rules answer the bodies they answer today (red under the kept filter dropped, the read flag flipped, a key renamed, the entity filter removed)
  'round-trips-parts.test.cjs', // MNT-59: a split route file is listed under its parent by tools/round-trips.cjs (folders-inbox and folders-totals under folders.js, chits-trace under chits.js)
  'api-invalid-json.test.cjs', // API-14: a body that is not JSON (cut off, null, a string, a number) answers 400 INVALID_JSON on every route, not 500
  'api-auth-first.test.cjs', // API-37: every route that needs a sign-in answers 401 signed out, with a uuid in each :param and a junk body - never 404, 400, 422 or 500 (S6 auth first)
  'api-nul-input.test.cjs', // API-15: a NUL byte in a body or query answers 400 INVALID_CHARACTER at the door, not 500 from Postgres
  'api-fuzzfix-shared.test.cjs', // column 17: a lone % is 400 ADDRESS_NOT_READABLE, a huge page is clamped, a shopper's 401 and the validator's 400 are the Problem shape
  'ctr-p2-174-190-225.test.cjs', // CTR-174 CTR-190 CTR-225: the shop header refuses a junk e-mail/phone/PIN, screen-config answers an object, GET /till/bills reads its page and answers the whole window's total
  'body-shape-and-range.test.cjs', // CAT-329 CAT-335 CTR-174 CTR-240 SEC-154 SET-70 AI-36 API-26 API-27: a junk body field is refused in words, never a 500 or stored
  'path-id-guard.test.cjs', // API-25 + RAIL-159 RAIL-206 RAIL-209 ORD-78 NET-92 CAT-230 CTR-169 ACC-217 FIN-86 CMP-28: a path, query or body id that is no uuid is refused in words, never a 500 from the cast
  'cmp-22-23-input.test.cjs', // CMP-22/23: a non-uuid identity_id on the identity-document routes answers 403 IDOC_SUBJECT_FORBIDDEN and a badly typed or impossible (2026-02-30) field of POST /api/kyb/credential 400 VALIDATION_FAILED, before the database
  'api-18-text-cap.test.cjs', // API-18: kind/name of POST /api/definitions, name of POST /api/keys and id of POST /api/integrations/heartbeat are capped at 200 characters; longer is a 400 before the database
  'api-problem.test.cjs', // API-1 slice 1a: the one error body (lib/problem.js), the legacy keys frozen, routes/keys.js + the 404 and error handler answer it
  'api-4b-auth-problem.test.cjs', // API-4b: the sign-in 401 and the requireScope 403 of middleware/auth.js are a Problem (problem+json, registered code) with error/message/code/pending frozen and the same status; a good token still passes
  'api-problem-till.test.cjs', // API-4 sweep, till: every refusal of routes/till.js (the counter's 41 routes) is a Problem with its old keys frozen; the till's offline answers keep every key; no 5xx says its cause
  'reward-check.test.cjs', // CAT-272: the numbers of a reward programme, one case per rule
  'cat-m9a-product-doors.test.cjs', // M9a re-landed without money (CAT-232/246/281/310): gst_rate 0..100, a unit is a word, price ceiling, combo price ceiling, availability refusal ('connector' accepted, stored unknown; per-row bad in the feed), source_key cap 200
  'cat-308-price-decimals-route.test.cjs', // CAT-308 M9b: INR 10.999 is 400 PRICE_DECIMALS at the product door, an unchanged legacy price passes, JPY 10.5 refused
  'cat-m9b-definition-doors.test.cjs', // M9b (CAT-272/273/333): reward numbers bounded, parallel definition saves lock + stale version 409, freeze list capped at 500 uuids
  'api-problem-books-grants.test.cjs', // API-4 sweep, ACC-176 member grant routes: every refusal of routes/books-grants.js is a Problem with its keys frozen; success answers hold only their closed keys
  'api-problem-books-actions.test.cjs', // API-4 sweep, ACC-176b adviser maker-checker routes: every refusal of routes/books-actions.js is a Problem with its keys frozen; success answers hold only their closed keys
  'api-problem-books.test.cjs', // API-4 sweep, accounts and finance: every refusal of routes/books.js, routes/tax.js and routes/invoice.js is a Problem with its old keys frozen; no 5xx says its cause
  'api-problem-network-offers.test.cjs', // API-4 sweep, the network-offers doors (Lane B2, 4 Nov): every refusal of the 8 routes of routes/network-offers.js is a Problem with its old keys frozen; a key is refused 403; no 5xx says its cause; a failed member read keeps its 503
  'api-problem-marketing.test.cjs', // API-4 sweep, marketing: every refusal of routes/marketing.js, offers.js and combo-templates.js is a Problem with its old keys frozen; no 5xx says its cause
  'offers-published-contract.test.cjs', // api #350 hold: the offer service's published OpenAPI is typed (body, required, 429) while the enforced schema stays loose
  'api-problem-governance.test.cjs', // API-4 sweep, governance: every refusal of routes/governance.js is a Problem with its old keys frozen; the foreign id of GET /entities/:id is the unknown id's 404; no 5xx says its cause
  'api-problem-chits.test.cjs', // API-4 sweep, chits: every refusal of routes/chits.js is a Problem with its old keys frozen; no 5xx says its cause; the schemas agree with the validator chains they replaced
  'api-problem-finance.test.cjs', // API-4 sweep, folders, Home facts and pricing: every refusal of routes/folders.js, routes/facts.js and routes/pricing.js is a Problem with its old keys frozen; no 5xx says its cause
  'api-problem-offers.test.cjs', // CAT-220: POST /api/offers/evaluate and /explain at the route: the discount and its reason in words, an expired or not-yet-started offer skipped, the shop's own shelf, a key not scoped 403
  'cat-m9c-till-doors.test.cjs', // M9c (CAT-223/230/207): the counter adds a product to a live offer only if it does not clash (409), ids that are no uuid are refused, the starter list is adopted without image
  'cat-324-capture-negative-price.test.cjs', // CAT-324: a message line matched to a negative catalogue price never becomes a negative total (lib/capture.js reads lib/sellable-price.js)
  'cat-324-till-negative-price.test.cjs', // CAT-324: a stored negative price reaches the counter as no price, by the rule the order door refuses with (lib/sellable-price.js)
  'api-problem-pricing.test.cjs', // CAT-221: POST /api/pricing/price at the route: the tier price at each quantity, below the first break the list price, fixed and range, an unpriced line null never 0
  'api-problem-till-price.test.cjs', // CAT-222: POST /api/till/price (what is written, was, now, refusals in words) and GET /api/till/worth-an-offer (each reason in words, urgency order, clamped window) at the route
  'cat-54-money-truth.test.cjs', // CAT-54: the money-truth matrix, hand-computed: tax-inclusive prices split out, one rounder per ISO 4217 minor unit, a split payment against the AU 5c cash step (cash only) and India's exact paisa
  'shop-actors.test.cjs', // SEC-103: actorOwned is true only for an actor of this shop; foreign, unknown and no-uuid are false, a database that is down is an error
  'sec100-folder-fk.test.cjs', // SEC-100: no write puts another shop's folder into a folder foreign key (rules, parent on create and move, routing); a foreign id and an unknown id answer alike, nothing is written
  'repeat-supply-status.test.cjs', // REPEAT-500: the repeat store reads a copy's status from chit_status through lib/select.rows, never h.current_status
  'api-problem-orders.test.cjs', // API-4 sweep, orders and workflow: every refusal of routes/repeat-supply.js, routes/work.js and routes/counters.js is a Problem with its old keys frozen; no 5xx says its cause; another shop's id answers as an unknown one (S35)
  'ord-73-repeat-input.test.cjs', // ORD-73 (BH-7): /api/repeat accept · counter · decline · skip answer 400 for a chit_id that is not a uuid (abc, true, -1, 1e21) and 404 for a bad agreement id, never 500 with driver text
  'ord-b9-repeat-supply.test.cjs', // B9 (ORD-88..93): one live agreement per bill, a withdrawn or all-zero agreement ends with its cause, a passed start is refused at agree()
  'ops-74-supplies-id.test.cjs', // OPS-74: PATCH /api/supplies/:id and POST /:id/issue answer 404 NOT_FOUND for an id that is not a uuid, never 500 with driver text
  'ops-70-one-number-check.test.cjs', // OPS-70: a purchase line's quantity and cost go through one number check; a line at no cost is said so
  'ops-70-one-number-check-mutation.test.cjs', // OPS-70: breaking the store or the words turns the test red
  'api-problem-crm.test.cjs', // API-4 sweep, the CRM: every refusal of routes/crm.js (24 routes) is a Problem with its old keys frozen (consent, privacy requests, the send gate unchanged); no 5xx says its cause; another shop's id answers as an unknown one (S35)
  'api-problem-relationships.test.cjs', // API-4 sweep, the relationships: every refusal of routes/relationships.js (14 routes) is a Problem with its old keys frozen; no answer carries a thrown error's text; another shop's list row answers as an unknown one
  'api-problem-schemas.test.cjs', // API-4 sweep, the schema engine: every refusal of the 7 routes of routes/schemas.js is a Problem with its old keys frozen; no success answer moved; no answer of any status carries a thrown text bar the one listed relay; every body is closed (an unknown key is refused by name) and the web's keys are accepted; another shop's column key answers as an unknown one
  'bounds.test.cjs', // SHARED-CHECKS 0a (2026-11-09): lib/bounds.js fragments (qty, minor, day, flag, text, page, limit, list, oneOf) refuse what they say with the field named and the sentence; the two day formats read isCalendarDay and isDay
  'ajv-formats-registered.test.cjs', // SHARED-CHECKS 0a: a format a contract names that ajv has not registered is silently ignored — fails on any such format (one documented-only exception, shrink-only)
  'sql-no-concat.test.cjs', // API hygiene: no value concatenated into SQL in the 14 route files once flagged by parameterised_query; frag() marks a built fragment, pick() is the own-key sort lookup
  'api-reported.test.cjs', // CAP-17 slice 1: the three reported register columns (BFLA role gates, parameterised SQL, rate limit) are counted from the real routes and never enter meets; a role gate refuses a lower role 403
  'role-matrix.test.cjs', // register column 14 (role_matrix, OWASP API5:2023), static half: every books / books-actions / books-grants / flags route declares its seats, in step with the gates and the grant allow-lists
  'junk-fuzz.test.cjs', // register column 17 (junk_fuzz, OWASP API4/API8), unit half: the seeded junk generator is deterministic, a 5xx / timeout / stack text / non-Problem refusal counts as a fail, a 429 is void, the reported column reads only the live tool's evidence
  'resource-cap.test.cjs', // register column 16 (resource_cap, OWASP API4:2023), static half: a list read's page-size cap through bounds or page-limit, a named limiter on every route, a tighter own limit on a mail, SMS or AI write; every rateLimit( carries a name; reported, never in meets
  'fable-r2-access.test.cjs', // Fable review 2 (14 Nov 2026): R2-01 reissue only while unclaimed, R2-03 an erased or closed business opens no door, R2-05 owner-only PC approval
  'api-problem-integrations.test.cjs', // API-1 slice 1c: every refusal of routes/integrations.js is a Problem with its old keys frozen; no 5xx says its cause
  'api-problem-ctp.test.cjs', // API-1 slice 1d: routes/ctp.js — every answer to another installation a Problem that keeps `accepted`/`ok` and `why`, on both mounts
  'api-problem-storefront.test.cjs', // API-1 slice 1e: the 11 public storefront doors of routes/catalogue.js — a Problem that keeps the old body, strict input, closed 200s, one 404
  'api-problem-products.test.cjs', // API-4 sweep, the catalogue items: every refusal of the 26 routes of routes/products.js is a Problem with its old keys frozen, no success answer moved, the old chains agree with the schemas; no 5xx says its cause
  'api-problem-network.test.cjs', // API-4 sweep, the network: every refusal of src/routes/network.js, routes/network-design.js and routes/connections.js (23 routes) is a Problem with its old keys frozen; no 5xx says its cause; the writes switched off answer 503; another shop's id is asked as an unknown one (S35, findings printed, evidence pinned); the schemas agree with the connections' old validator chains
  'api-problem-actors.test.cjs', // API-4 sweep, the people: every refusal of the 17 swept routes of routes/actors.js (GET /check-login, POST /set-pin and POST /login are routes/signin.js's aliases: recorded byte for byte, never judged) is a Problem with its old keys frozen; no success answer moved; no answer carries the database text; the frozen 503s are replayed; another shop's id is asked as an unknown one (S35, findings printed, evidence pinned)
  'ppl-26-actors-input.test.cjs', // PPL-26/BH-12: settings, person edits, check-key, suggest-key and delegate refuse a list or an object in words (400 INVALID_INPUT, field named), a non-uuid person id is a 404, the database never asked, nothing written; valid calls still 200
  'ppl-28-actors-create.test.cjs', // PPL-28: POST /api/actors (add a person) refuses a list, an object, or a string where a number or flag belongs (400 INVALID_INPUT, field named), 0 writes; a valid add still succeeds
  'api-problem-entities.test.cjs', // API-4 sweep, the entities: every refusal of the 25 routes of routes/entities.js (sign-in apart, which is recorded byte for byte, never judged) is a Problem with its old keys frozen; no success answer moved; no 5xx says its cause; the platform doors answer in the Problem body; another shop's id is asked as an unknown one (S35, findings printed, evidence pinned)
  'api-problem-signin.test.cjs', // API-4 sweep, Lane B2 (4 Nov): the 8 routes of routes/signin.js answer only the statuses their contract declares, no 5xx says its cause, and a NUL byte in a typed id, e-mail, handle, shop or username is answered as an unknown one (K-1, S41); the doors' own words stay byte for byte (signin-routes golden)
  'api-problem-service.test.cjs', // API-4 sweep, Lane B2 (4 Nov): the 7 routes of routes/service.js answer only the statuses their contract declares, no 5xx says its cause, and a value no column can hold (a NUL byte in text, a time Postgres cannot read) is a 400 in words, never a 500; no success answer moved
  'api-problem-assist.test.cjs', // API-4 sweep, the assistant: every refusal of the 22 routes of routes/assist.js is a Problem with its old keys frozen; the assistant's 503 and 502 (the answers the web client falls through on) are replayed word for word; no success answer moved; no answer of any status says a failure's cause; the two public reference reads are listed as findings by the foreign-id world
  'api-problem-catalogue.test.cjs', // API-4 sweep, the rest of the catalogue: the shopper's orders and documents, the product enquiries, the photo read and the catalogue face — every refusal a Problem with its old keys frozen, no success answer moved
  'api-problem-small.test.cjs', // API-4 sweep, Lane B2 (4 Nov): every refusal of routes/adopt.js (2 routes) and routes/people.js is a Problem with its old keys frozen; a non-uuid chit_id is a 404 (K-1); no 5xx says its cause
  'api-problem-csp-report.test.cjs', // API-4 sweep, the public CSP report door (routes/csp-report.js): a junk body 400, an 8 KB+ body 413, a flood 429, a fault 500 are Problems; a report is still 204; no sign-in is asked
  'api-problem-plumbing.test.cjs', // API-4 contract pass, the plumbing doors (GET /health, OPTIONS *, GET /api/openapi.json): the replies the probe, a browser and a tool read, and a fault as a Problem 500
  'api-problem-chit-proposals.test.cjs', // API-4 sweep, the proposal doors (RAIL-106): every refusal of the 5 routes of routes/chit-proposals.js is a Problem with its keys frozen at the first contract; every body closed (S33); no answer says a failure's cause; another shop's chit id answers as an unknown one (S35)
  'ctp-return-path.test.cjs', // RAIL-106: the return path — a status another installation decided is mirrored on the shadow row through the one status write; sequence, repeat, late message (db and transport stubbed)
  'ctp-return-disputes.test.cjs', // RAIL-106 part 2: a dispute raised or resolved elsewhere is recorded here through recordRaise / recordResolve; confidential scoping kept
  'ctp-return-gaps.test.cjs', // RAIL-106 part 3: void, cancel flags, attachments by reference, the bell, every local party's timeline row, the message limit
  'ctp-return-door.test.cjs', // RAIL-106: the event kind at the one door (routes/ctp.js): same checks as a copy, applied to our rows only
  'ctp-window-shopping.test.cjs', // RAIL-107: a chit from a business this installation holds no row for — the sender is found by bridge id and a stub is made
  'fin-70-bank-rec-log.test.cjs', // FIN-70: the bank reconciliation record: marks and signed statements appended, read back, refusals, the posted-line cross-check, insert-only SQL
  'ctr-213-invoice-lease.test.cjs', // CTR-213 (ACC-192 S2): a till leases blocks of invoice numbers from the one counter: two tills, expiry, offline block, gap, outside, refill, the lock key
  'ctr-213-till-lease-client.test.cjs', // CTR-213: the till's lease client draws AE invoice numbers from the server block: pointer saved before the number leaves, refill at 20 percent, a used-up block stops the bill in words, never-leased numbers the old way; 8 checks
  'acc192-credit-note.test.cjs', // ACC-192 1b: IN/AU/AE credit note over the changed lines only, half-up per line, the books keep the original and add the note
  'chit-proposals.test.cjs', // RAIL-106 part 4: one proposal mechanism on ONE chit (rounds, seller computes, accept stores the seller's invoice byte for byte); ACC-192 1b: a decrease on an issued invoice is one credit note, a raise is refused, the buyer applies only when the seller confirms
  'acc192-invoice-issued.test.cjs', // ACC-192 slice 1a: an issued invoice (books entry · frozen_at · a carried tax invoice) is never rewritten by a round or an amend; the money edits are told from a comment fix; quotations and pro-formas still re-issue
  'send-seller-currency.test.cjs', // RAIL-106: a send is priced in the SELLER's money; a seller on another installation prices its own goods
  'ao-bill-books.test.cjs', // AO-F-02/03: a USD bill posts in AED at the day's rate (USD kept); an invoice with no lines waits in words; a rail credit note waits for its bill's resolve
  'ar-1129-order.test.cjs', // AR-F-02/06: the reason step through routes/chits.js SEND_STEPS in the real order from {}; a declared clearance stays declared
  'ar-1129.test.cjs', // AR-F-01..07 (walk AR): a partial money block refused, the credit note's reason, address and CRN type and shop-day date on the document, no evidence is not met, preflight asks the import's gate
  'aj-currency-door.test.cjs', // AJ-F-02: the money stated on a body (currency_code / currency / business_json.currency) is carried or refused in words, never dropped (invoice booked as AED at face value)
  'ao-reward-return.test.cjs', // AO-F-05: a return takes back the points its bill earned, pro rata, never below zero, once per note
  'ai-rail-credit-note-bill.test.cjs', // AI-F-02: a rail credit note names a bill of the sender's (422 CREDIT_NOTE_NEEDS_BILL) and cannot take back more than it (409 CREDIT_NOTE_OVER_BILL)
  'ai-usd-order-fx.test.cjs', // AI-F-01: US$650.00 carried on an order posts in the shop's money at the day's rate through the one fx engine (A$1,007.50 at 1.55)
  'bb-foreign-invoice.test.cjs', // BB-F-01: an IN/AU/AE invoice in usd1 / XXX is refused (422), in USD or EUR refused in words (409), never stored at face value in the shop's money
  'bb-thread-seat-words.test.cjs', // BB-F-04: the adviser's refusal on a client's chit thread names the adviser seat (lib/books-grant.threadReadOnlyWords), never 'an auditor'
  'bb-p3-doors.test.cjs', // BB-F-06/09/10: grantee judged before who posts; usage days 1..365 or 400; a vault value over its limit is refused, not cut
  'ai-received-bill-locked-month.test.cjs', // AI-F-04b: a received bill moved out of a hard-locked month says so (needs fix/af-1129)
  'am-summary-claim.test.cjs', // AM-F-03: a filed day summary claiming more than its bills is read from the bills, the gap told in words
  'am-bank-twice.test.cjs', // AM-F-04/05: the same statement is not signed twice (409 STATEMENT_ALREADY_SIGNED); a locked month takes no sign-off (the entries' lock rule)
  'am-relock.test.cjs', // AM-F-07: a soft lock pressed again on a soft-locked month is refused, the first record stays
  'api-problem-testing.test.cjs', // API-4 sweep, the test board: every refusal of routes/testing.js (33 routes) is a Problem with its old keys frozen; no 5xx says its cause; another shop's id answers as an unknown one (S35)
  'api-problem-attachments.test.cjs', // API-4 sweep, the attachments: every refusal of routes/attachments.js (2 routes) is a Problem with its old keys frozen; a copy for every participant and one for an internal message; the S2 download headers; no 5xx says its cause; another shop's id answers as an unknown one (S35)
  'api-problem-bell.test.cjs', // API-4 sweep, the bell: every refusal of routes/events.js and routes/notifications.js (6 routes) is a Problem with its old keys frozen; the stream opens with a ticket in ?t= and ?ticket=, its frames and heartbeat unchanged; no answer says its cause; notif_dismissed has no foreign key, so a foreign log_id is no oracle
  'lenssec-1129.test.cjs', // LENS-SEC 1129: a forged network receipt is dropped and builtPaths is created_by-fenced; supplies writes carry writeGate; a viewer cannot upload an attachment; money resolve names a bill of this shop
  'lenssec-1129-network.test.cjs', // LENS-SEC 1129: the party read drops otp_contact; connections respond is owner-only (403 in words); a suspended member cannot read stores/availability; a design over 500 nodes is refused 413
  'api-problem-supplies.test.cjs', // API-4 sweep, the supplies: every refusal of the 5 routes of routes/supplies.js (what a shop buys to use: list, add, edit, purchase, issue) is a Problem with its old keys frozen; no success answer moved; no answer of any status carries a thrown text; another shop's supply id answers as an unknown one (S35); an id in a body reaches no statement unscoped
  'c11-10a-supplies-bounds.test.cjs', // C11 10a: the supplies doors refuse a figure past its column, a day that is no day or past tomorrow and a blank name (422, field named); numeric text read against the same bounds; the Idempotency-Key as the ref of an issue
  'ops-72-duplicate-bill.test.cjs', // OPS-72: a bill number used before is answered in words — the same bill again is "already recorded" (0 counted), the same supplier's number with other lines is a 409, another supplier's bill counts
  'ops-80-fefo-replay.test.cjs', // OPS-80: a replayed FEFO issue of batch-tracked stock (twice, concurrent, half-done, short) takes the goods out once and answers the first call's batches
  'api-problem-privacy.test.cjs', // API-4 sweep, the privacy routes: every refusal of the 4 routes of routes/privacy.js (the public facts and the shopper's own page) is a Problem with its old keys frozen; no success answer moved; no answer of any status carries a thrown text or another shopper's data; the shopper and the shop come from the token alone; a write appends one row
  'api-problem-identity-docs.test.cjs', // API-4 sweep, a person's own identity documents: every refusal of the 4 routes of routes/identity-docs.js is a Problem with its old keys frozen; no success answer moved (masking, code flow, stamp); no answer of any status carries a thrown text or a full document number; a status a library carries is passed on; Aadhaar is never stored; another shop's record answers as no record
  'api-problem-kyb.test.cjs', // API-4 sweep, Know your business: every refusal of the 5 routes of routes/kyb.js is a Problem with its old keys frozen; no success answer moved; no answer of any status carries a thrown text; a status a library carries is passed on; POST /field charges nothing while no provider is connected; a foreign chit named as evidence answers as an unknown one
  'api-problem-channels.test.cjs', // API-4 sweep, the channels: every refusal of routes/channels.js (10 routes) is a Problem with its old keys frozen; the relay modes are kept; the platform doors keep their key; another shop's binding id answers as an unknown one (S35)
  'api-problem-capture.test.cjs', // API-4 sweep, capture: every refusal of the nine signed-in routes of routes/capture.js is a Problem with its old keys frozen, no success answer moved, no answer carries the text of a thrown error; the three webhooks (Meta, the e-mail provider) answer exactly as before, byte for byte; another shop's capture id answers as an unknown one
  'api-problem-connectors.test.cjs', // API-4 sweep, the connectors: every refusal of routes/connectors.js (14 routes, the device and ERP doors included) is a Problem with its old keys frozen, no success answer moved, no 5xx says its cause; another shop's connector id answers as an unknown one
  'api-problem-definitions.test.cjs', // API-4 sweep, the definitions shelf: every refusal of routes/definitions.js (6 routes) is a Problem with its old keys frozen (the two old chains kept word for word); no answer of any status carries thrown text; another shop's id answers as an unknown one (S35); the frozen 5xx are replayed
  'api-problem-simulator.test.cjs', // API-4 sweep, the tour: every refusal of routes/simulator.js (3 PUBLIC routes) is a Problem with its old keys frozen; the lead gate's token (separate secret, S1), its e-mail wording and the three doors where it is not sent are byte for byte; no answer of any status says its cause; the lead id of a feedback is a foreign-key existence oracle (a FINDING, modelled)
  'api-problem-forms.test.cjs', // API-4 stage-2 sweep, the authority forms: every refusal of the 8 routes of routes/forms.js is a Problem with its old keys frozen; no success answer moved; no answer of any status carries a thrown text; a status a library carries is passed on; another shop's form id answers as an unknown one (3 routes, plus a chit of another shop named on the caller's own form); a body key the route never named is refused (Q18)
  'ctr-172-quick-key-items.test.cjs', // CTR-172 (BH-17): PATCH /api/quick-keys/groups/:id/items — a non-uuid group id is 404 before the database, an unknown group 404 with nothing written, a wrong-typed items body 400 QUICK_KEY_INVALID, a real group still ok
  'api-problem-quick-keys.test.cjs', // API-4 sweep, the quick-key groups: every refusal of the 9 routes of routes/quick-keys.js is a Problem with its old keys frozen (the 409 keeps `current`); no answer carries database text; another shop's group answers as an unknown one (S35)
  'sec102-readiness-evidence.test.cjs', // SEC-102: a clearance's evidence chit counts only when the ownership check ran and found this shop's copy; a failed check stores NULL (declared), never documented
  'api-contract.test.cjs', // API-1 slice 1b: schemaValidate (ajv) and the contract cases generated from each route's schema
  'api-allowlist.test.cjs', // API-1 output allow-list (S34): the pruning rule, the res.json filter, the shape derivation from recorded answers (identity on every answer it saw, a key it never saw dropped and named)
  'generated-files.test.cjs', // point 3 (11 Nov): a feature PR carries no derived file, the sign-offs and readability ratchet stay one entry per line and merge by union, the ratchet refuses a count going backwards
  'api-tools.test.cjs', // API-1 slice 1a: the ratchet rules, the register normaliser, the error-code table, as units
  'web-api-contract.test.cjs', // every route the web reads, called for real (offline), held to docs/contracts/web-api.json: same keys, nesting and types
  'crm-leads.test.cjs', // L1: leads as parties, the memberships table's one writer (entity + group checks), 503 in words before b297, the b297 RLS lines
  'crm-leads-import.test.cjs', // L3: leads from a CSV — the one phone helper, dedupe in the file and against the shop, the cap, who may, set-based (300 rows = 6 rows in statements), 503 before b297
  'crm-leads-import-email.test.cjs', // A-F-47: the import's e-mail column is kept as the party's e-mail (fillMany), one statement, never over an address held
  'crm-remove-walkin.test.cjs', // "Remove from my parties" (owner, no dues, hides, deletes nothing); walk-in → party moves the points by rewards.claim
  /* ⭐⭐⭐ DISPUTE CONFIDENTIALITY — THE USP RULE (N02, 2026-10-07): written before any extraction; per-copy RLS modelled, definers transcribed */
  'dispute-scoping.test.cjs', // roster-only visibility · no notice to a non-party · per-party resolve; KNOWN BREAKS printed loud (section 5)
  'message-once.test.cjs', // RAIL-136 (d): a message's copies and its timeline line commit together, so a retry after a 500 posts it once
  'rail-msg-type.test.cjs', // a message kind outside chk_chit_messages_msg_type is a 400 "Pick a message type" before any write (23514 never reaches the table)
  'catalogue-enquiry-msg-type.test.cjs', // the product enquiry door refuses a message kind outside message-limit MSG_TYPES with a 400 "Pick a message type" (stacks on rail-msg-type)
  'sec-fix3.test.cjs', // SEC-FIX3: S1-S11 — one scenario each, red on main, green on the fix
  /* ⭐⭐ THE BOARD HEARS ABOUT IT (2026-10-07) — offline: the real route over a stand-in db */
  'junit-board.test.js', // a report folds to one row per (run, case, layer); the guards' own JUnit reads back by the board's key; the testing scope; CI posts after red
  'cost-never-to-employees.test.cjs', // [OFFR-04] cost off every export/history/till/supplies read for an actor without can_see_costs
  'cat239-adopt-cost-blind.test.cjs', // CAT-239: the adopt offer drops the supplier cost (any depth) for a cost-blind co-assist; a blind combo push is refused
  'rail146-chit-cost-blind.test.cjs', // RAIL-146: the chit reads (GET /:chit_id · /inbox · /folder · /sent · /rollup) carry no cost to a cost-blind co-assist; a sales chit stays priced; the owner's answer is untouched
  'rail146b-work-cost-blind.test.cjs', // RAIL-146b: the work reads (GET /api/work/list · /facts?unbilled=1 · /:chit_id) carry no purchase money to a cost-blind co-assist; a sales row stays priced; whole-body scan, fail closed
  'ctr-178-stock-repost.test.cjs',
  'stock-bill-one-transaction.test.cjs',
  'books-cashflow-open-items.test.cjs', // (the last two: SPEED 1129, a bill's stock in ONE transaction; /cashflow on open documents) CTR-178: a counter sale whose after-commit stock post failed or was lost is found (no movement under its ref) and posted again; a post that still fails is said; sendStock and sendReplay call the sweep
  'p2-ops-doors.test.cjs', // P2 lane 2 (12 Nov): OPS-85 the match reads past counter bills and drops closed orders · OPS-87 another-unit count is not 'awaited' · OPS-79 the trace says when it cut · OPS-6 the send answer names a receipt line with no product
  'ops-5-delivered-stock.test.cjs', // OPS-5 (ST-19): goods counted in against a supplier bill I received (deliver-lines, resale) post purchase rows GI:<delivery_id> once; own use / asset / charge / unmatched name / receipt already raised move nothing and say why
  'rail156-po-cost-blind.test.cjs', // RAIL-156 (enrolled by OPS-98): a cost-blind co-assist cannot SEND a priced buy-side chit (403 COST_BLIND); a quantity-only PO and every sale still go; the stand-in answers the engine's seller+buyer read
  'rail146c-receipt-carry.test.cjs', // RAIL-146c: a cost-blind co-assist's goods receipt carries the order's stored price (RAIL-149's carry widened), a figure of his is a 403, a null price is a no_cost skip, never rate 0
  'rail146c-till-cost-blind.test.cjs', // RAIL-146c: the till reads (GET /api/till/tasks · /match) carry no purchase money to a cost-blind co-assist; a sales order stays priced; the owner and the paired till key read as before; whole-body scan, fail closed
  'crm-d7-unbilled-by-currency.test.cjs', // CRM-D7: a party's unbilled figure is one total per currency (never added across), a currency-less order counted not summed, a blind reader hidden whole; the record door carries the list row's figure
  'rail146e-crm-unbilled-cost.test.cjs', // RAIL-146e: the Parties list's per-party unbilled money is partial for a cost-blind co-assist (RAIL-146b rule per party); owner byte-identical; whole-body scan
  'rail146i-dues-cost-blind.test.cjs', // RAIL-146i: a party's supplier-side balance (what the shop owes) and supplier credit limit never reach a cost-blind co-assist on GET /api/crm/parties, /parties/:id or GET /api/books/dues; a customer's balance stays; owner byte-identical; whole-body scan
  'rail146h-timeline-cost-blind.test.cjs', // RAIL-146h: GET /api/crm/parties/:id/timeline sends a supplier bill's value and a supplier-side ledger amount_minor as null + cost_hidden to a cost-blind co-assist; a sale and a customer-only ledger stay; owner and cost-allowed byte-identical
  'rail146m-payment-cost-blind.test.cjs', // RAIL-146m: a payment to a supplier (preview · record + 409 · propose · advice) never tells a cost-blind co-assist the bills' figures, the advance or the balance; a customer's payment and the owner byte-identical; whole-body scan
  'rail146n-books-doors-cost-blind.test.cjs', // RAIL-146n: GET /party/:id/statement, GET /ledger/:account, GET /cheques and the chit Mark-paid 409 carry no purchase money to a cost-blind co-assist (dues-view R9); a customer side and the owner byte-identical; whole-body scan
  'rail146o-books-reports-cost-blind.test.cjs', // RAIL-146o (B4): GET /pl, /trial-balance, /bs, /daybook carry no purchase money to a cost-blind co-assist (blindBooks widened, no new 403); SEC-119 canRead reads the auth row; SEC-150 a co-assist's Idempotency-Key is its own
  'm3-invoice-one-builder.test.cjs', // M3: the invoice answer of a copy is built once (lib/tax-copy invoiceFrom); a connector key reaches /api/invoice/:id (200) and not /api/tax/invoice/:id (403)
  'cat-249-invoice-cart-shares.test.cjs', // CAT-249: /api/invoice/build takes a basket offer's per-line share from the engine (cart_shares), not by gross
  'rail146g-doors-cost-blind.test.cjs', // RAIL-146g: the rail's chit list (GET /api/facts/rail/chits), the bell, GET /api/folders/groupsum and the tax invoice (GET /api/invoice/:id · /api/tax/invoice/:id) carry no purchase money to a cost-blind actor (a viewer without can_see_costs included); a sale stays priced; whole-body scan, fail closed
  'rail146j-folder-cost.test.cjs', // RAIL-146j: GET /api/folders/:id/chits (filed and view folder) and /:id/metrics hide the purchase money from a cost-blind co-assist
  'rail146k-blind-measure.test.cjs', // RAIL-146k: ONE blind-aware measure (money only over the shop's own sales, else null + cost_hidden) for reconcile, mis, the scorecard, folder metrics and who-came-back; the routes/ guard: no route measures itself
  'rail147-amend-cost-gate.test.cjs', // RAIL-147: POST /:chit_id/amend and /reprice refuse a cost-blind co-assist's price or money key on a cost-side chit (403 COST_BLIND, nothing written); a quantity-only amend keeps the stored price; a sales chit and the owner as before
  'rail149-draft-cost-carry.test.cjs', // RAIL-149 HOTFIX: POST /chits/send with promote_draft_id from a cost-blind co-assist carries the draft's stored line money (never null over it); a figure sent is 403 COST_BLIND; an added line carries no money; the owner and a sale-side draft as before
  'rail-r11-connector-frozen.test.cjs', // RULE-MATRIX p15 (R11): POST /integrations/books and /books/skip change only the books · books_log · books_skip riders (the rest byte-identical); tools/tally-connector/core.js never calls a chit writer (scan + a recorded run)
  'con98-voucher-total-unknown.test.cjs', // CON-98: a registered buyer's Tally voucher with no invoice total is refused with a reason (never the order's net); b2bOf says the total is unknown and carries the currency
  'cat235-create-cost-gate.test.cjs', // CAT-235 part 2: a cost-blind co-assist creates items but never a cost key (POST / · /bulk · /import), same 403 COST_BLIND
  'qa130-bulk-categories.test.cjs', // QA-130: POST /categories/bulk adds or removes a category per product; repeat = unchanged and no write; no other key moves; the single attach's gate
  'offr04-cost-gate.test.cjs', // [OFFR-04] CAT-234/236: GET / and PATCH /:id strip cost at any depth for a cost-blind actor; status-only PATCH allowed, price/cost refused; parked list stripped
  'agent-signin-body.test.cjs', // M01: the shop-PC agent sends mode:'login' via CBSignin.ask()/verify() — a login never creates an identity
  'employee-code.test.cjs', // M02: first code e-mailed, never shown in a sealed env (Resend required), single-use, 24 h
  'offer-clash.test.cjs', // T2-LABS: an offer saved LIVE that overlaps another live discount → 409 OFFER_CLASH in words (CBOffers.clashes); drafts · pauses · renames · basket offers untouched
  'ctr-191-till-money-stop.test.cjs', // CTR-191 (ACC-206 H): the till stops a bill whose engine bridge is not ok; the owner PIN + a typed reason write business_json.money_override
  'cat-247-offer-window-zone.test.cjs', // CAT-247: every evaluate caller hands the engine the shop's zone; a date-only window ends on the shop's own day, and an open offer costs no trip
  'ctr-157-offer-live-signal.test.cjs', // CTR-157: PUT /api/definitions/:id (an offer made live, paused, changed) rings the shop-changed bell so every open counter hears it; a refused save rings nothing
  'auth-first.test.cjs', // M04: POST /api/chits/send — auth before the body is read (401 not 400/413, validators never run); before/after matrix: no allow/deny change
  'person-session.test.cjs', // M05: a person session is listed, bound to one device (DEVICE_MISMATCH), revocable within 60 s (fake clock); sign-in on B never revokes A; legacy tokens unchanged
  'rail-actions.test.cjs', // ⭐⭐ R01: GET /chits/:id `actions` and the writing doors are ONE engine (lib/rail.js) — 14 situations; before/after: same outcome, `why` added
  'ord-fix.test.cjs', // ORD-FIX O1–O7: closed orders unlisted · amended lines billed · CAS status write · rejected bill reverses its posting · one-shot shopper code · bill-based delivery
  'rail-status.test.cjs', // ⭐⭐ T1-RAIL: every status change goes through lib/rail-status statusGate (the one write); void of a completed chit 409s; no SQL writes current_status elsewhere
  'ctry-28-order-subject-currency.test.cjs', // CTRY-28 (proof 2026-11-14): a network order subject says "AED 180" (code), summary_json.currency_code is AED, no rupee sign or INR in any minted copy
  'rep-22-move-one-transaction.test.cjs', // REP-22 (proof 2026-11-14): a status move reads, validates and writes in one transaction (read, header read and write share one withEntity)
  'rep-9-detached-keys.test.cjs', // REP-9 (proof 2026-11-14): detachedKeys names exactly the overlay keys matching no item name and no formerly name
  'qa-131-status-bulk.test.cjs', // QA-131: a bulk status step names its from (a moved copy is refused, never moved back), folds the use choice into the one call, and a replayed key answers once
  'qa-142-cost-figures.test.cjs', // QA-142: the cost door refuses 1e308, 2^53, a boolean, a text and minutes past an integer (422, field named); takes real figures
  'sec-140-prototype-keys.test.cjs', // SEC-140: a place of supply / GSTIN / HSN that is an object word (__proto__, constructor) is an ordinary key in the GSTR-1 maps
  'housekeeping-guards.test.cjs', // ⭐⭐ W2-RAIL R2: delete/archive/purge fail CLOSED (co_held_record · dispute_open · disputes_unknown), reprice asks the rail, ONE status table (no second spelling), a cap says so
  'claim-series.test.cjs', // M11: ONE series allocator for a counter PC (key) and a phone (device); label by PHONE number (D9); no prefix ever on two holders; a pre-M11 key claims the prefix it has today; a phone's till.by/device_id = the session
  'sec-148-register-address-cap.test.cjs', // SEC-148 (C12): a per-address hourly cap on POST /api/entities/register (held and free alike, one 429), and a mailer outage reads the same on the held path and the new one
  'sec-97-storefront-public-ids.test.cjs', // SEC-97 (C12): the five storefront routes keyed by a published shop/network id are public by design (api-hardening-scope public_ids) and an unknown shop is the family's one 404
  'signin-routes.test.cjs', // M06: every old sign-in path answers as before the move (golden) and IS the new door's handler; one signin_events row per attempt; b282 missing never blocks
  'sec-157-ended-tokens.test.cjs', // SEC-157 (C12): the signed-out legacy token list is pruned by exp only and its cache is bounded
  'sec-109-pending-user-id.test.cjs', // SEC-109 (C12): registering again with a changed User ID only STAGES it (policy_flags.pending_user_id); verify applies it after the code proved the mailbox; a stranger renames nothing
  'signin-sessions-routes.test.cjs', // 1 Nov walk: devices/sessions/renew/logout/revoke DO their job through the real auth: SEC-131 a logged-out token is 401 and cannot renew; one person cannot end another's session (403); devices owner-only
  'signin-ask-pin-register.test.cjs', // 1 Nov walk: ask/pin and entities register/verify behaviour: code or PIN asked, unknown id refused alike, wrong/6x-wrong code no token, new e-mail = one INSERT, PIN stored hashed
  'measure.test.cjs', // INT7b: lib/measure's own unit test — median to one decimal (never NaN), OPEN/CLOSED = the rail's one status table, an empty set measures to zeros
  'home-facts.test.cjs', // N18: GET /api/facts/:card — each Home card's shape, <= 2 trips, a figure the server cannot compute is omitted (never 0), cost never travels, unknown card 404
  'home-narrow-fields.test.cjs', // 1129 homeNarrow: field trace — Home's counts read only select COUNT_FIELDS; a rule reading a dropped field fails
  'b5a-counter-reads.test.cjs', // B5a (CTR-205/195/209): till reads by= in SQL, today's live bills in the day summary with live_capped, the shop day for offers
  'till-trend.test.cjs', // RPT2: GET /api/till/summary?compare=1 — Reports › Trend is rollup.series over the summaries, the shop's own year (never April), 422 NO_COUNTRY/NO_MONEY, one trip
  'settings-owner-gate.test.cjs', // T3-SETTINGS: ONE owner gate (lib/owner.gate) on every counters write - a co-assist 403 OWNER_ONLY, db never asked; GET /counters + GET /entities/policy say may/why with the refusal's own sentence
  'chit-crossing.test.cjs', // LEAN-PLAN §8 #3: lib/chit-crossing (lifted with moveStatus) - definer vs legacy fallback, 9-arg retry only when no line was named
  'chits-files.test.cjs', // LEAN-PLAN §8 #4: tools/chits-files.cjs is the ONE list of chits files; no test or script reads routes/chits.js by a literal path
  'money-deadline.test.cjs', // PLT-70: the money doors keep the request deadline: 503 at the deadline, the late write commits once, the keyed retry replays; bulk routes keep none
  'timeout-idempotency.test.cjs', // PLT-69: a keyed request past REQUEST_TIMEOUT_MS gets its 503 (problem shape); retry = 409 while it runs, the stored answer after; the handler runs once
  'plt85-admission.test.cjs', // PLT-85 / SPD-45: over API_MAX_INFLIGHT the answer is 503 SERVER_BUSY + Retry-After before any handler; aborted requests give their place back once; a busy pool at the idempotency claim never runs the handler on memory
  'stuck-close.test.cjs', // round 2: a counter sale / summary chit sent to its own shop closes when the books hold it - through moveStatus, only an open own copy
  'governance-report.test.cjs', // E04: the nightly governance report is red for each failing line; never green while main is unprotected or /health says development
  'iso8601.test.cjs', // N11: every moment that leaves storage or transport (sent chit, copies, pack, Tally, JUnit) is RFC 3339 UTC
  'legacy-token-refuse.test.cjs', // K-SEC PR A landing check: LEGACY_TOKEN_REFUSE off = a no-jti token passes (counted); on = 401 SESSION_UPGRADE; a listed session and the 60 s auto-raise token pass either way; customer mints counted apart
  'ppl-27-viewer-writes.test.cjs', // PPL-27 (Q42): a View-only/Comment-only login gets the free catalogue draft with intro null and 0 model calls; editor/owner 1; anonymous 0
  'api-csp.test.cjs', // K-SEC PR A (SEC-68): strict CSP on JSON and /.well-known (ctp.json still 200 JSON); the 5 old public pages untouched; POST /api/csp-report 204, shaped log only, own limiter, 8 KB cap
  'prove-security-fixes-gated.test.cjs', // SEC-132 (C12): the live proof script still parses and its S1 step has the sealed-box (gated 404) branch
  'sec-132-simulator-gate.test.cjs', // SEC-132 (C12): /api/simulator/* answers only off a sealed environment (or with SIMULATOR_ENABLED=1); sealed, it is exactly an unknown path
  'sec-125b-db-boot-wait.test.cjs', // SEC-125b (C12): DB_BOOT_WAIT_MS goes through intFromEnv (typo / blank / negative = 15 s, 0 = do not wait)
  'scoped-access-count.test.cjs', // AI-15: ratchet on chit read routes that skip lib/access seesWholeEntity (43 on 21 Oct); all_task_visible still unread; why wiring waits for Athi
  'jwt-rotation.test.cjs', // E10: JWT_SECRET then JWT_SECRET_PREV through ONE verifier (lib/jwt-verify.js); PREV token = 200 logged rotated; neither = 401 TOKEN_INVALID; PREV unset = byte-for-byte today
  'iddocs-verify.test.cjs', // M18: phone/e-mail identity documents verified by a code (lib/otp.js engine); 5 wrong -> locked; PUT clears; an unverified contact is never used for recovery
  'review-platform-1129.test.cjs', // batch 1129: platform review findings real at head (events ticket spend, tighten-only unknown tier, %00 path door, id-doc code count + keyed hash, test-DB guard on DB_POOLER_URL, signForm race)
  'sec101-iddoc-hash.test.cjs', // SEC-101: Aadhaar (store:false) stored with a KEYED hash (HKDF of VAULT_ENC_KEY), legacy sha256 still recognised, no key = 503; PHONE/EMAIL hashes byte for byte unchanged, sign-in + device-key match still find the person
  'sec106-staff-code-hash.test.cjs', // SEC-106: a staff first code is kept as a KEYED hash (HKDF of VAULT_ENC_KEY, otp_code_hash), never plain; verifyOtp compares the hash, every issue zeroes the attempts and writes a code_issued trail row; an idempotent answer carrying a code is never stored; b781 written, not run
  'b860-guard.test.cjs', // VERIFY-EL-DB A2: b860 raises unless cb_app has lost SELECT on otp_code, otp_code_hash, pin_hash; guard before the first ALTER; proof file kept beside it
  'sec01-r3-form-signer.test.cjs', // VERIFY-SEC-01 R3: an editor typing the owner name signs as themselves; only the owner types a name; signed_by always the real identity
  'register-gate.test.cjs', // RAIL-90: the register is a per-shop capability — off (403 CAPABILITY_OFF) for a shop with no key and no rows; on with the key; on with existing rows and no key
  'raida-close-route.test.cjs', // RAIL-93: POST /api/chits/:chit_id/raida/:raida_id/close passes the worklist's disposition (and carried-forward register, evidence) to raida.close; a full register's ending writes its closing row
  'sides.test.cjs', // CB Sides: driftOf (resolver) + the impact walk (lib/impact, shared with raida.walk) + GET /api/entities/sides is ONE read; a source with no data is a 'not yet' row, never a number
  'entities-header.test.cjs', // N19: GET /api/entities/header is ONE read (<= 3 trips); planted compliance rows -> bands from lib/licence-rules.js; unverified PHONE -> check false; no rule -> days only; no fee amount hard-coded
  'prefs-merge.test.cjs', // CU2: every ui_prefs / locale_prefs write is an RFC 7386 merge-patch — a theme save keeps product_rows and the keys it did not send; '' / null removes; no `= $n` whole-column write
  'limiter-paths.test.cjs', // M07: every public door (walked from the real app) has a limiter of its own; pair/claim, check-login, storefront sign-in on the strict auth budget; existing limits unchanged
  'con-100-101-capture-input.test.cjs', // CON-100/101 (BH-8, BH-15): capture convert and stores answer a plain 4xx (a non-uuid id 404 NOT_FOUND; a chit_id or a phone that is not text 400 VALIDATION_FAILED), the db never asked, no driver text; a valid call still 200
  'limiter-answer.test.cjs', // API-16 (BH-5): every limiter (the 240/min service one through the real app, the rest at max 1) answers 429 problem+json RATE_LIMITED with Retry-After and the same seconds in params; first request passes
  'k1-path-uuid.test.cjs', // K-1 (API-10): an address id that is not a uuid -> 404 NOT_FOUND problem+json through lib/problem.js uuidParam, the database never asked; one row per closed route
  'r2-09-admin-key.test.cjs', // R2-09: the platform key of the three channel doors needs 32 characters, is compared as two hashes, and sits under the sign-in budget
  'retired-routes-404.test.cjs', // retire-7 (12 Nov): the 7 retired routes answer 404 JSON with a token; their neighbours still answer
  'rail146l-suppliers-cost-blind.test.cjs', // RAIL-146l: GET /api/relationships/suppliers puts balance_minor on a row only for a reader who may see costs (null + cost_hidden for a cost-blind login)
  'net-48-connection-input.test.cjs', // NET-48 (BH-9): POST /api/network/connections and /api/connections/request name someone who cannot exist (bad uuid, wrong type, bad handle or bridge id) -> 404 problem+json before the database; a valid call still reaches the service
  'rail-161-service-catches.test.cjs', // RAIL-161: GET, resolve, pause and answer on /api/service answer a fault as problem+json 500 INTERNAL (no driver text), a known Postgres refusal as its mapped 4xx, a success unchanged
  'employee-first-signin.test.cjs', // 2026-10-08 Athi: employee's first code (unsealed, DEV_OTP) signs in AND answers requires_pin_setup on every door; PIN then works; sealed never takes the fixed code
  'tester-code.test.cjs', // SEC1: TESTER_CODE (env, 8+, timing-safe over SHA-256) signs in on verify only; fixed codes on a LOCAL stack only; TESTER_NAMES; never logged/answered; no fixed code in what ships; SEC1b daily {yymmdd} code (IST, yesterday until 06:00) + TEMPORARY boot warning
  'people-srv1.test.cjs', // PEOPLE-SRV1: switch-off/remove signs the person out (sessions by person, keys by maker: counter closed, others revoked) in one transaction; owner marks away (OWNER_ONLY · NOT_FOUND · SWITCHED_OFF; stand-in in the shop); may.remove/away; GET /api/facts/people
  'shop-bookkeeper-approves.test.cjs', // SHOPBK slice A+B: the shop Bookkeeper seat (preset by hat, may.post, every owner-only door OWNER_ONLY, the opening only before the books run); books_owner_approves off = direct post, on = 202 held entry (event | journal) for that seat only, an unreadable setting never lets an entry through, staff cannot prepare lock/unlock/year_close/reverse, the setting is the owner's and defaults off; a held event with no date is frozen to the shop's today (withTheDate)
  'l1c-payment-gate.test.cjs', // LV sec-money-01 M2: POST /payments carries paymentGate: owner-approves shop + Bookkeeper seat = 403 OWNER_ONLY, nothing written; off / owner / unreadable setting
  'books-action-date.test.cjs', // SHOPBK-B: a held Day book event with no date is frozen to the shop's today
  'lens2-1129.test.cjs',
  'lensp2-1129.test.cjs', // LENS2 money-01 M2: prepare locks the body hash as well as the ref · LENS-P2: negative inlined in parentheses, accept one transaction, reward same-ref other-spend 409, counter period never back
  'shop-bookkeeper.test.cjs', // SHOPBK slice A: the shop Bookkeeper seat, its owner-only doors, the opening only before the books run
  'books-split-modules.test.cjs', // batch 1123: policy-books · home-waiting · books-action-queue, one unit per rule each (closed when the table is absent)
  'people-writes-sec2.test.cjs', // SEC2: no answer of any /api/actors route holds a code (pin_state instead); every people write is the owner's (403 OWNER_ONLY + why); e-mail stored + edited; connector code through generateOTP('connector')
  'limit-settings.test.cjs', // SEC-125: a typo, empty, negative, huge numeric setting fails CLOSED to the safe default (164 checks; real server.js sign-in limiter, every converted site)
  'limits.test.cjs', // E01: 9 MB on a non-upload route -> 413 BODY_TOO_LARGE; 30 s request deadline -> 503 REQUEST_TIMEOUT (late answer swallowed); 57014 -> 503 STATEMENT_TIMEOUT; parsers after id+logger
  'request-log.test.cjs',
  'request-log-keys.test.cjs', // ERR-14: seat and route on the request line, no e-mail; // E07: request id minted (uuid) or kept (plain token), echoed and on the log line; every line JSON with entity/person/bytes; slow query -> one line, fingerprint only, no SQL text; /health db + version
  'signin-contact.test.cjs', // M14: sign in by a MOBILE or an E-MAIL — verified contact (M18 reader) / own sign-in e-mail / customer contact -> the stored id behind the scenes; several -> 409 CHOOSE_IDENTITY; unverified opens nothing; old doors byte-identical
  'signin-enumeration.test.cjs', // SEC-139: before a secret is proven an unknown account, a known one sent no secret and a wrong secret get ONE answer (and about the same time) on actors/login, entities/verify, signin/verify; no CHOOSE_IDENTITY list at verify; check-login one constant answer
  'sec-desk-why-and-verify-trips.test.cjs', // SEC-139 class + S8: a routing fault gives route.why one fixed sentence (no exception text in preview or raise); login/verify answers unknown, wrong, locked and expired alike with the same DB round trips
  'sec-130a-duplicate-email.test.cjs', // ⭐ SEC-130 (A): a duplicate e-mail answers a stranger the same as a free one (register, party PATCH); the owner keeps honest words about their own list
  'party-live.test.cjs', // CRM-247/248: "deleted" is hidden_at, read in ONE place (lib/party-live): partyOn live/removed, an import never matches a deleted party's phone or merges into its name, refused like a stranger
  'b10-crm-mint.test.cjs', // B10 CRM-226/230/231/247: five adds at once take turns on the shop's mint lock (lib/xact-lock), a residual 23505 sits in a savepoint, a name that matches a deleted customer restores it
  'b10-crm-door.test.cjs', // B10 CRM-246/244/243/227/237: a held cheque stops remove, the tax id on the customer door is bounded (pack check only for a stated country), the import matches phones by their last 9 digits, due_at is a real day
  'p2-crm-lane1.test.cjs', // P2 lane 1: PATCH followup done must be a JSON boolean (CRM-239, BAD_FLAG); the door pass tests of CRM-233/237/243/251 pinned
  'sec-130r-party-contact.test.cjs', // ⭐ SEC-130 residual: a party e-mail lives in party_contact (per shop, not unique): the same address in two shops answers alike, no email_held, RLS text, b840 predicate = isMinted, sign-in never reads it
  'sec-130-minted-email-signin.test.cjs', // ⭐⭐ SEC-130 (P0): a party a shop minted is not an account — no sign-in by its e-mail, ~ handle or name; real accounts unchanged
  'f13-creator-edit.test.cjs',
  'sec-185-identities-sweep.test.cjs', /* F13: the one creator-edit rule, the b909 text, the refusal in words | */ // ⭐⭐ SEC-185 B: the identities sweep ratchet, the held migration RUN-2026-11-14-b860 (policies, header, not in the chain), the bound-read doors, no fallback in signin-lookup
  'signin-provider.test.cjs', // ⭐⭐ SEC-112 P0: provider sign-in — registry, stand-in rule, claim checks (S2/S3/S4), migrations b878-b880, user-id suggestions, start + callback against oauth2-mock-server (needs the dev dependency: CI installs it; absent outside CI = section D skipped, said)
  'sec-75-entity-schemas.test.cjs', // ⭐⭐ SEC-75: entity_schemas + schema_fields — the widened sweep ratchet and its break checks, the two held RUN files (b861 doors, b862 policies), the boot check, one defaultSchemaId, bound readers, the freeze through the definer, T8
  'bound-db.test.cjs', // ⭐ SEC-75: the offline shop-binding double keeps its claims (blank id, other-shop predicate, schema_id-only, the documented limits)
  'sec-75-order-freeze.test.cjs', // ⭐ SEC-75: POST /:bridge_id/order/confirm through the real router, commerce AND payload pipeline, b50 AND pre-b50: the freeze reads the shop's default schema through the ONE definer with the shop id, and the copies carry it
  'sec-184-signin-lookup.test.cjs', // ⭐⭐ SEC-184 A: the SECURITY DEFINER sign-in lookup (b857) — function text, fallback with one warning, every pre-binding caller through it, role must not bypass RLS, break check per fix
  'move-in-country-gate.test.cjs', // move-in W1: books from another country are refused whole (an unknown country never gets India's rules); unmatched codes / units held; X-1; the proof
  'move-in-meter.test.cjs', // move-in W1.6: items written inside the move-in are metered only after it commits; a rolled-back one meters nothing
  'move-in-added-via.test.cjs', // QM-1: the move-in writes only an added_via the migrations' CHECKs allow (read from the .sql); a 23514 is a 422 sentence
  'local-kind.test.cjs', // K-DB OPS-41: a minted party is 'local' once b769's CHECK allows it, 'supplier' + a log line before; an unreadable CHECK never fails a mint
  'retention-archive-gate.test.cjs', // K-DB DB-21/PM-16: a retention commit without an archive receipt is BLOCKED, deletes 0, sends no write; every attempt is one flush event
  /* QA coverage 2026-11-06 (areas 08 · 13 · 27): units with no proof until now. Each header names its UNIT and CARD. */
  'rewards-customer-view.test.cjs', // 08 Customer's rewards view: no programme is a sentence · points never a currency · the balance is the whole-ledger SUM · reading never writes · a NUL id is 400
  'points.test.js', // 08 a point can never be added to a rupee (it was green and reached by no runner)
  'retention-never-early.test.cjs', // 27 Retention rules: an open dispute never retires · a resolved one is a FLOOR · the extension is bounded · a sender cannot shorten a copy · a runaway sweep is blocked
  'retention-floor.test.js', // 27 the receiver-side retention floor (it was green and reached by no runner)
  'purge-erase-guards.test.cjs', // 27 Auto-purge / erase: a sent or received copy is never purged · an open or unreadable dispute refuses · only the creator, only my entity · erase is platform-only, tombstone not delete
  'storage-ownership.test.cjs', // 27 Object storage: a key not under the owner is NOT_OWNER before any read · one replicated row per participant · a replay stores once · a half-set config falls back to the db
  'trace-edge.test.cjs', // 13 Batch traceability: no silent holes · is_origin only a true boolean · parents a UUID set · units to one base, unknown unit says so (the qty coercion holes: trace-edge-qty.known-failing.cjs)
  'inventory-engine.test.cjs', // 13 On hand & movements: the sign comes from the reason · every refusal says why · weighted average and its three edges · replay equals applying one by one (null-rate hole: inventory-null-rate.known-failing.cjs)
  'stocked-counted.test.cjs', // 13 what is not stock never moves a balance: the product flag wins · else the trade · one query · an unreadable flag keeps items counted
  /* QA-79 (22 Oct): tests that passed offline (stub db, no server) and no runner reached. Their output is counted as '<n> passed' too. */
  'account-sessions.test.cjs',
  'actors-create-level.test.cjs',
  'actors-max-tasks-cap.test.cjs',
  'ai-box.test.cjs',
  'books-events-batch.test.cjs', // red1129: the bank Add batch route, 15 checks
  'ad-f04-rail-tax-invoice.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'ad-f05-past-year-lock.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'aj-double-count.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'books-replay-locked-month.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'error-trace.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'lv-counter-1129.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'queue1-crm-dues-seat.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'queue1-rail-credit-against.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'rate-limit-identity.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'till-inline-handler-xss.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'walkab-1129-bill-number.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'walkac-claim-cap.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'walkac-moved-note.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'walkac-pay-order.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'walkae2-line-scheme.test.cjs', // red1129: enrolled by the integrator, green on sit-in
  'ai-one-pipe.test.cjs',
  'assign-merge-patch.test.cjs',
  'connect-10d-input-shape.test.cjs', // C11 batch 10d (12 Nov): a chit line goes to someone on the team (one reader with the follow-up door, nothing written for a stranger), an offer's text is text, a shopper name fits its column, a new quick-key group is typed like a changed one; 42 checks
  'auth-first-routes.test.cjs',
  'baseline-from-snapshot.test.cjs',
  'books-close-country.test.cjs',
  'books-day-bills.test.cjs',
  'books-day-country.test.cjs',
  'books-hooks-kinds.test.cjs',
  'acc355-buyer-credit.test.cjs', // ACC-355 (19 Nov): an unregistered or composition buyer's purchase events carry input_credit:false; unknown/regular untouched
  'g-f06-stray-tax-key.test.cjs', // G-F-06 (1128): a tax figure under a key no door reads is refused in words, never dropped
  'home-crm-leads.test.cjs', // E-F-05 (1128): the Home CRM card does not count a lead as a customer
  'in-export-3b.test.cjs', // VERIFY-GF-TAX F6 (1128): a stated India export is GSTR-3B 3.1(b), not 3.1(a)
  'marketing-plain-reason.test.cjs', // walk E (1128): marketing refusals read in plain words
  'readiness-registration-word.test.js', // E-F-02 (1128): the registration word comes from the country pack
  'supply-kind-1128.test.cjs', // supplykind-1128: supply kind follow-ups on the api path
  'supply-kind-export.test.cjs',
  'ag-counter-kinds.test.cjs', /* AG-F-01/02 (1129): a till bill's tax kind is the catalogue's */ // G-F-01 (1128): a sale that states it is an export lands on the export ledger
  'till-never-ok-hold-1128.test.cjs', // walk F (1128): a till sale refused 422 with a code a retry cannot fix is held, not retried
  'till-park-agent-1129.test.cjs', // 1129 tillPark4xx: the shop PC's queue parks a refused entry once with the server's words; 503/429 retry; a 409 duplicate is sent; 401 stays re-sign-in
  'till-stock-warn-noslab-1129.test.cjs', // counterSmall (1129): till 'Only N in stock' warns never blocks; a stated rate is not 'No tax rate'
  'p3s-send-subject-cap.test.cjs', // AT-F-11 (1129): the Compose subject is capped at 500 like manual_subject
  'till-shop-zone.test.cjs', // E-F-06 (1128): till times in the shop's zone; the person's cb_tz wins
  'leak-1128-starter.test.cjs', // leak 1128: the hotel starter set is per country, not one country's names for all
  'walkl-credit-note-customer-1128.test.cjs', // L-F-03 (1128): a credit note with no customer slot takes the recipient on the rail
  'tax01b-country-of-number.test.cjs', // VERIFY-TAX-01 row 6 (1128): a tax number is read by format, never India by default; enrolled by red1128
  'books-reclass-rate.test.cjs', // enrolled by red1128 (was missing: the every-test-is-enrolled guard)
  'supply-kind-in-note-day.test.cjs', // enrolled by red1128 (was missing)
  'walkh-list-country.test.cjs', // enrolled by red1128 (walkh, was missing)
  'walkx-sample-country.test.cjs', // WALK-X X-F-01: AE/AU lists hold no India shelf or item
  'walkl-measure-credit-note-sign-1128.test.cjs', // L-F-08 (1128): a pile's money subtracts credit notes (measure.signedValue)
  'walkn-counts-1129.test.cjs', // N-F-03/04 (1129): work counts only received work; a draft is not on the rail and does not bill an order
  'supplier-added-retry-1128.test.cjs', // ⭐ J-F-07 (1128): adding the supplier a waiting bill names posts the bill at once (afterSupplierAdded, both doors of POST /suppliers)
  'rail-service-bill-expense-1128.test.cjs', // ⭐ J-F-06 (1128): a service line on a rail invoice (SAC 99…) posts to an expense class, reverse charge riding the purchase_bill accepted for use; Purchases 0
  'walkk-month-lock-running.test.cjs', // WALK K K-F-01 (1128): the running month is refused a lock in words (the one period-end check, books-period.refuseUnfinished); an ended month locks, today posts
  'walkk-readiness-home-country.test.cjs', // WALK K K-F-06 (1128): an AU shop's readiness lists its own country's standards (readiness.homeRuleHolds), not the UAE's
  'walkk-copy.test.cjs', // WALK K K-F-04/05 (1128): GRANT_ROUTE_NOT_LISTED title names no role; the view-only refusal says Employees
  'books-returns.test.cjs',
  'acc-290a-needs-answer.test.cjs',
  'p1-7-bas-basis.test.cjs',
  'au-g10-inclusive.test.cjs',
  'books-tally-remoteid.test.cjs',
  'chit-currency-default.test.cjs',
  'country-registry-callers.test.cjs',
  'crm-fix.test.cjs',
  'crm-late.test.cjs',
  'crm-traded.test.cjs',
  'health-line.test.cjs',
  'integrations-country.test.cjs',
  'line-guard-missing-qty.test.cjs',
  'lint-ratchet.test.cjs',
  'network-member-rows.test.cjs',
  'network-offer-scope.test.cjs',
  'open-orders-counts.test.cjs',
  'ops-stock.test.cjs',
  'pay-fix-delivery.test.cjs',
  'pay-fix.test.cjs',
  'rail-lab.test.cjs',
  'rcm-post.test.cjs',
  'register-spin-country.test.cjs',
  'call-log.test.cjs', // QA 12 Nov: the harness logs METHOD + path + status per case; the SIT lifecycle and gorilla junits turn them into endpoint rows the map credits
  'run-target.test.cjs', // QA 12 Nov: the one run-target allow-list (production refused, SIT boxes named)
  'scripts-target.test.cjs', // PLT-101: no api script names the live host; apiBase refuses unset and production
  'schema-fingerprint.test.cjs',
  'sec4-server-gates.test.cjs',
  'seed-local-refusals.test.cjs',
  'select-counter-customer.test.cjs',
  'showcase-policy.test.cjs',
  't2e-orders.test.cjs',
  'tax-compute.test.cjs',
  'till-network-unpriced.test.cjs',
  'till-rail.test.cjs',
  'till-since-word.test.cjs',
  'till-s4-ctr158-footer.test.cjs', // CTR-158 (2026-11-14): fails under CTR158_MUTATE=1
  'till-s4-ctr161-kit-taxslab.test.cjs', // CTR-161 (2026-11-14): fails under CTR161_MUTATE=1
  'till-kit-signin-halves.test.cjs', // the sign-in window's two halves ride the till kit (served, refreshed, vendored byte-equal)
  'till-s4-ctr166-supply-buyer.test.cjs', // CTR-166 (2026-11-14): fails under CTR166_MUTATE=1
  'till-s4-ctr253-freetext-gate.test.cjs', // CTR-253 (2026-11-14): fails under CTR253_MUTATE=1
  'till-t2d.test.cjs',
  'till-t2j.test.cjs',
  /* QA-80 (22 Oct): six whose expectations had gone stale (US pack, hasColumn probe, compare-and-set, N1 move, re-wrapped routes) - updated to the current truth */
  'country-crm-shop.test.cjs',
  'crm-viewer.test.cjs',
  'pay-fix-renumber.test.cjs',
  'pay-fix-void.test.cjs',
  'auae-1129.test.cjs', // AU-F-01 (a withdrawn goods receipt takes its stock back, once, in words) and AU-F-05 (a quantity below 0 on a sale is refused)
  'rail-216-void-paid.test.cjs', // RAIL-216: a payment on the invoice blocks the seller's void (also in NEEDS_ENGINES: runs over the books harness)
  'rail-paid-reject.test.cjs', // RAIL-216 follow-up: a paid invoice is refused for rejected as for cancelled (the rail's own WITHDRAWN list)
  'rail-218-reject-paid.test.cjs', // RAIL-218: a buyer cannot reject a received invoice it has marked paid (statusGate paidRefusal, the one writer; the way out is a credit note); real-Postgres: rail-218-reject-paid-truth.realstack.cjs
  'rail-1128-gates.test.cjs', // RAIL-1128: the three-way match hold (match_tolerance_pct, goods gap, minor-unit sums), buyer cancel of a paid bill, rejected/cancelled never to completed, a taken credit note not withdrawn, an unknown peer status refused, the status outbox row in the move's own transaction
  'books-lock-moves-billed-at.test.cjs', // L-F-05 (1128): a sender-typed billed_at on or before the books' lock date posts on the first open day with a note; hand case 15 Aug, locked to 31 Aug -> 1 Sep; 7 checks
  'bill-step-held.test.cjs', // F3 (1128): a failed bill step is retried once then held as a ticket on the owner's desk (audience here); 4 checks
  'ctp-status-redrive.test.cjs', // F11a (1128): a status event that spent its 40 tries is redriven by the owner (5 more tries); the chit says not delivered with the redrive offered; 4 checks
  'idempotency-status-conflict.test.cjs', // F1 (1128): a 409 status_conflict (a lost compare-and-set) is not stored 48 h as the key's answer; 4 checks
  'message-client-id.test.cjs', // F5b (1128): an optional client_msg_id on POST /messages is scoped to sender+chit, a retry is answered from my copy and posts nothing twice; 5 checks
  'state-log-guard-migration.test.cjs', // F8b (1128): migration b901 (NOT RUN, Athi runs it) adds the state_log UPDATE and TRUNCATE guard for every login; 4 checks
  'std2-one-reading.test.cjs',
  'till-t2c.test.cjs',
  /* QA (24 Oct): two landed walk fixes no runner reached - R14 a party's phone and e-mail are kept or refused in words; R58 the shop's sales offer never cuts a supplier's receipt */
  'party-contact-patch.test.cjs',
  'crm-45-changed-named.test.cjs',
  'crm-47-party-keys.test.cjs', // CRM-47: tax_ids that is not a list and two keys for one credit limit are refused by name
  'crm-l16-root-not-a-party.test.cjs', // l16: the installation root (system supplier) is not a party: no list, count or chip
  'crm-46-party-exact.test.cjs', // CRM-46: a party field that cannot be stored exactly is refused in words
  /* CRM-43 (29 Oct): merged_into names only a party of this shop; the b782 trigger function reads each table's own column only inside its own IF branch */
  'party-merge-target.test.cjs',
  'party-merge-guard-sql.test.cjs',
  'r58-no-sales-offer-on-receipt.test.js',
  'books-payables.test.cjs', // MNT-47: CB FINANCE payables ageing, MSME day 45, early-pay offer
  'move-in.test.cjs', // MNT-47: move in from Xero / QuickBooks - guessed columns, dry run, write through the doors
  'move-proof.test.cjs', // D1 (1130): a moved route handler is proven the same code (verbatim, require path, declaration join, local rename) and every other change is refused
  'api-resign-moves.test.cjs', // D1+D3 (1130): the re-sign judge, the line patch of api-signoffs.json (one line, same key order), and the signed-at-fold check of the ratchet
  'api-openapi-diff.test.cjs', // D1 (1130): breaking changes in the published operations (answer key lost, request key now required, narrowed type/enum/limit, status removed)
];
module.exports = { GUARDS_PART };

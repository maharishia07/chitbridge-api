# api modules

One row per `lib/` and `routes/` module: what it OWNS, and the area card it belongs to (`docs/<area>/<slug>` on the docs master).
Built from each module's own header (OWNS · CALLED BY · CARD · FLOW) on 2026-11-15 from api main, plus `docs/SEAMS.md` for reuse points.
A row marked "(to confirm)" had no sourced OWNS line or CARD in the header: fill it from the file when you next touch it, and the header is the master.
The header lines carry CALLED BY and FLOW; this index does not repeat them, so it cannot drift from them.

| module | owns | card |
|---|---|---|
| `lib/access-events.js` | the IAM access-change audit trail: before/after diffs of a person's access, written as access_events rows (b172), and lostCount() of the rows that could not be written | 18-identity-sign-in-and-access/access-events |
| `lib/access.js` | what an identity may do: the three levels (viewer · commenter · editor), mayWrite, and writeGate (a refused write is a 403 Problem in the rail's own word). | 18-identity-sign-in-and-access/access-levels |
| `lib/accounts-packs.js` | ADOPTED engine copy, never edited here (engines release then adopt). WHAT A COUNTRY'S LEDGERS ARE CALLED, NUMBERED AND HOW THEY BEHAVE, AS DATA (v1.8.0, 2026-09-29). (from the title line, to confirm) | (to confirm) |
| `lib/actors-contract.js` | the contract of the people routes (17 of the 20): routes/actors.js (/api/actors) — each route's OpenAPI operation (S9) and the one way their refusals and faults are … | 17-people-employees-hr-and-payroll/functions |
| `lib/adopt-contract.js` | the contract of routes/adopt.js (/api/adopt, 2 routes): each route's OpenAPI operation (S9) and the words its refusals answer in (words, failed). | 03-catalogue/adopt |
| `lib/adopt.js` | consider / considerAll (may this line be adopted) | 06-catalogue-pim/adopt-a-supplier-s-delivery-into-my-catalogue |
| `lib/ai.js` | the AI CO-ASSIST. ONE co-assist per entity runs MANY skills; a skill = one purpose. Every skill is (from the title line, to confirm) | 25-ai-cb-assist-and-support-desks/ai-skills-usage-and-ai-drafting |
| `lib/amend.js` | the amendment record of a line (chit_line_amendment) and the ONE definition of what a line reads as now: liveSet / liveLines | 01-rail-core-the-chit/amend-reprice-costs |
| `lib/api-keys.js` | The API-key list on an entity (identities.policy_flags.api_keys) and the counter / phone series allocator: mint, list, end by | 18-identity-sign-in-and-access/keys |
| `lib/assign-chit.js` | chit_status.assigned_to_actor_id · assigned_to_actor_display_name · assigned_at · assignment_type | 01-rail-core-the-chit/assign |
| `lib/assign.js` | who holds each LINE of a chit, its due date and its state (chit_line_assignment, append-only by seq): assign · current · byPerson. | 01-rail-core-the-chit/line-model |
| `lib/assist-contract.js` | the contract of routes/assist.js (22 routes, /api/assist — CB Assist and the brand's catalogue-source authoring): each route's OpenAPI operation (S9) and the one way … | 28-platform-and-operations/assist |
| `lib/assist-kb.js` | the one template string of grounding facts the assistant LLM is given: what is built, and what is NOT YET BUILT | 25-ai-cb-assist-and-support-desks/cb-assist-knowledge-base |
| `lib/attachments-contract.js` | the contract of routes/attachments.js (2 routes, /api/attachments — a file on a chit, a copy of it for every participant): each route's OpenAPI operation (S9), the … | 01-rail-core-the-chit/README |
| `lib/autoraise.js` | a captured message becoming a chit with nobody present (b131): a task-only inquiry marked "sender not verified", raised through the one send path | 22-channels-capture-and-messaging/capture-webhooks-in-pending-structure-raise-conv |
| `lib/availability.js` | the stamped stock figure { qty, source, as_of } (stamp) and the refusal of a typed or fed figure that stamp would have quietly changed (refusal, ACCEPTED_SOURCES … | 06-catalogue-pim/schedule-and-availability |
| `lib/beckn-map.js` | the Beckn <-> chit mapping table and its applier; the supplier's currency is final (a different or unchecked one is refused, CTRY-24). | 23-connectors-and-integrations/beckn-ondc-compatibility |
| `lib/bell-contract.js` | the contract of the bell's two routers (6 routes): routes/events.js (/api/events: the ticket, the live stream, the platform counts) and routes/notifications.js … | 22-channels-capture-and-messaging/notifications-and-the-bell |
| `lib/bill-paper.js` | the server's read of the shop's country pack for the BUYER line of a tax invoice: `held` when the pack asks for the buyer | 15-tax-and-country-packs/invoice-front-door |
| `lib/bill-privacy.js` | what one shop may see of the other shop's copy of a bill, and at which messaging level (none, internal, external) each bill step is written (bill_step rows) | 01-rail-core-the-chit/folders |
| `lib/bill-steps.js` | where a bill is in its life, derived from my copy, my ledger and what the other party chose to share: received and issued steps, no status column | 01-rail-core-the-chit/folders |
| `lib/bill-use.js` | the use of a received bill or line (USES, chosenOf, inCatalogue, effective, needsCatalogue, catalogueOf, forCopy, validate, set, linkParty) | 12-suppliers-and-procurement/functions |
| `lib/boilerplate.js` | resolving a boilerplate (the sealed mould: its declared sources, locale and standards) and the boilerplate an entity was minted from | 20-settings-governance-and-plan/boilerplate-and-sources |
| `lib/bookpack.js` | ADOPTED engine copy, never edited here (engines release then adopt). the pack handed to the shop from given rows: the code book, a SAF-T-shaped JSON (saft), Tally-style import XML (tallyXml, written by the pack's own export rules), the … | 14-accounting/functions |
| `lib/books-assets.js` | the fixed-asset register: one row per asset, read and written through a withEntity handle (depreciation figures come from the engines). | 14-accounting/books-assets |
| `lib/books-cashflow.js` | the cash position (project · read) and the api's ONE major <-> minor pair, toMinor · fromMinor (money.round + money.decimals; ACC-179 folded the copies) | 16-finance/books-cashflow |
| `lib/books-contract.js` | the contract of routes/books.js: each route's OpenAPI operation (S9), the ledger's refusal mapper (refusalOf) and the sentences its gates answer in. | 16-finance/books-routes |
| `lib/books-engines.js` | the one adapter between the books tables' rows and the engines' shapes (itemOf · itemRow · dues · the engine loaders) | 14-accounting/ledger-accounts-day-book-entries-reverse |
| `lib/books-events-batch.js` | CAP-BOOKS-EVENTS-BATCH: postEventsBatch(ctx, events), 1..100 events through the one event writer, ALWAYS a receipt { ok, capability, request_id, written, held, refused } and one trace line; callable by the route, bank Add, move-in, the till day close | 14-accounting/ledger-accounts-day-book-entries-reverse |
| `lib/books-hooks.js` | the posting hooks (a saved chit → its event), the outbox park, the shop's day (dayOf), and classify's major → minor (toMinor: the api's one, books-cashflow). | 16-finance/books-posting |
| `lib/books-manual.js` | the hand-keyed event builders (BUILD), the grid (catalogue) and the typed-lines reader givenLines (minor → major in the shop's currency, ACC-179). | 14-accounting/ledger-accounts-day-book-entries-reverse |
| `lib/books-nightly.js` | the ledger's nightly check (named differences, never auto-fixed) and its in-process 6-hour timer. | 14-accounting/books-health-to-do-outbox |
| `lib/books-pack.js` | the sealed books pack: its manifest (retention per country pack), its files, the Tally export beside it. | 16-finance/books-pack |
| `lib/books-payables.js` | CB Finance payables: each supplier's open bills aged 0-30 / 31-45 / 46-60 / 60+, the India MSME day-45 flag and risk, and the supplier's early-pay offer with its owner … | 16-finance/books-cashflow |
| `lib/books-period.js` | the period-end entries: closing stock · depreciation · accruals · the tax set-off and payment (gst/close · gst/pay, country-first) · the return read · year close. | 16-finance/month-and-year-end |
| `lib/books-reconcile.js` | the frequent finder of a posting-purpose chit that has no entry (the derived outbox), its pool guard and cap, and the figures GET /health reads | 14-accounting/books-health-to-do-outbox |
| `lib/books-recurring.js` | recurring entries (b281): templates that are events not journals, the daily sweep that proposes or auto-posts a due one, and the accrual reversals due that day | 14-accounting/recurring-entries |
| `lib/books-replay.js` | allocationHash · replayOf · ALLOC_REPLAY_WINDOW_MS — nothing else decides what a replay is | 16-finance/collections |
| `lib/books-store.js` | every SQL statement of the books: entries · lines · balances · the pages · the tax entry lines. | 16-finance/books-store |
| `lib/books-tally.js` | the pack's Tally files (masters + vouchers, one voucher per entry, REMOTEID = the entry id). | 16-finance/books-pack |
| `lib/books-todo.js` | the books to-do: what a period still needs before it closes (unposted · unmatched · unpaid), in the shop's words. | 16-finance/books-todo |
| `lib/books.js` | postEntry — the one writer of journal · lines · balances · party items; the period-open rule (postingDateFor); the allocation lock (lockedItems). | 16-finance/books-posting |
| `lib/bound-read.js` | boundRead, boundEach, idArrayParams | 18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data |
| `lib/bounds.js` | the ajv schema fragments a route's OpenAPI body or query names for a quantity, a minor-unit amount, a day, a flag, a text, a page, a limit, a list and a word list | api-surface/input-bounds |
| `lib/bridgeid.js` | the ONE bridge-id generator (alphabet, length, check character). | 18-identity-sign-in-and-access/sign-in |
| `lib/business-search.js` | the ONE search for a listed business (and, for kind=product, for a product in a listed shop's public catalogue). "Listed" = the shop chose | 04-network/directory-and-search |
| `lib/canon.js` | the one canonical form (canon), its sha256 (hash), and a field-listed seal (seal / verify). | 05-ctp-and-cross-installation/seal-rail |
| `lib/capture-contract.js` | the contract of the authenticated intake routes of routes/capture.js (9 of its 12 routes, mounted at /api/capture): each route's OpenAPI operation (S9) and the one way … | 11-crm-and-marketing/capture |
| `lib/capture.js` | the raise: an inbound message read by the AI becomes a priced inquiry chit (quantity + rate guarded by lib/line-guard). | 01-rail-core-the-chit/capture |
| `lib/cash-step.js` | the server's check of a counter bill's cash parts against the shop pack's `cashRounding` { step_minor, tender, cite } (reg-au 5c; reg-my 5 sen). | counter/bill-slip |
| `lib/catalogue-blueprint.js` | the starter lists (BLUEPRINTS), which list a trade opens on (forVertical, VERT-8) and the product-code sequence | 06-catalogue-pim/blueprints |
| `lib/catalogue-build.js` | the AI handler that turns a catalogue source into a schema and items (the proposal a business confirms); the DB-backed source rows load through loadSource. | 06-catalogue-pim/catalogue-build |
| `lib/catalogue-columns.js` | the declare-first column writer and resolver for product fields. | 03-catalogue/catalogue-columns |
| `lib/catalogue-contract.js` | the contract of the signed-in routes of routes/catalogue.js (the shopper's own orders and documents, the product enquiries, the photo read) and of … | storefront-and-catalogue/products-routes |
| `lib/catalogue-read.js` | one catalogue, many channels. (from the title line, to confirm) | 06-catalogue-pim/catalogue-read |
| `lib/catalogue-search.js` | searchWhere(q, paramNo) → { sql, param } : the SQL condition and its LIKE parameter for GET /api/products?q= | 06-catalogue-pim/README |
| `lib/catalogue-view.js` | one catalogue read for every principal (public storefront, B2B, network) and the shop's pack words it carries (tax id word, UPI only where the pack has it) | storefront-and-catalogue/catalogue |
| `lib/catalogue-write.js` | the one path that writes products: resolve schema, read rules, validate every row before any write, declare columns, stamp money, insert, meter (TILL-107) | storefront-and-catalogue/catalogue-write |
| `lib/categories.js` | a shop's own category master, read without the tax gate: the list, the id to name map, and the names a product cites | 06-catalogue-pim/categories-and-fields |
| `lib/channels-contract.js` | the contract of routes/channels.js (10 routes, /api/channels — Settings › Channels: which number or address belongs to this shop, its provider reference, its templates … | 11-crm-and-marketing/channels |
| `lib/channels.js` | the channel map: which inbound number / address belongs to which entity, and who may grant it. | 11-crm-and-marketing/channels |
| `lib/chart.js` | ADOPTED engine copy, never edited here (engines release then adopt). THE CHART AND THE CALENDAR AS A MECHANISM (core-vs-packs step b1, v1.22.0, 2026-10-03). (from the title line, to confirm) | (to confirm) |
| `lib/chit-ceiling.js` | ceilingOf (the exclusive upper bound of one chit money column, 10^(precision - scale), read off the column's own declared type) · COLUMNS (the three the chit write | 01-rail-core-the-chit/chits-routes |
| `lib/chit-crossing.js` | crossing / crossingIn (run a delivery-agent definer inside withEntity, fall back before the migration), definersReady (the cached b50 probe), postMessageCopies (one … | 01-rail-core-the-chit/chit-crossing |
| `lib/chit-move.js` | moveStatus(entity_id, chit_id, new_status, by, note, me) and its legs (cancelSentCopy, readThenWriteMove, readMoveHeader, writeOrConflict), the two cancel flags … | 01-rail-core-the-chit/chit-move |
| `lib/chit-paid.js` | the "paid" fact of the invoice I sent (tender on my copy · a receipt allocated in my books · the buyer's payment notice in my own timeline); the notice's two words. | 01-rail-core-the-chit/status-the-one-status-writer |
| `lib/chit-proposal.js` | the ONE proposal mechanism on a chit: the seller's pro-forma (round N), the buyer's counter (a request, never a computation), an amendment after agreement — propose · … | 01-rail-core-the-chit/chit-proposal |
| `lib/chit-proposals-contract.js` | the contract of routes/chit-proposals.js (API-STANDARD S9): each door's OpenAPI operation (its strict body, its closed answer, the statuses it declares), | 01-rail-core-the-chit/chit-proposal |
| `lib/chits-contract.js` | the contract of routes/chits.js: each route's OpenAPI operation (S9) and the one way its refusals and faults are worded (said, faultOf, failed, railRefusal). | 01-rail-core-the-chit/chits-routes |
| `lib/chits-input.js` | the input rules of the chit routes that used to be express-validator chains (send, status, payment, messages, disputes, resolve, priority, priority-flag, void … | 01-rail-core-the-chit/chits-routes |
| `lib/cmdb.js` | the one shape a CMDB record may take (fields ledger and skill block included) and the flags it raises about itself. | 20-settings-governance-and-plan/cmdb |
| `lib/column-rules.js` | who may remove or retype a catalogue column: a column is free while empty and locked once used (LOCKED, SYSTEM_FIELDS, why, retypeWhy) | 06-catalogue-pim/categories-and-fields |
| `lib/combo-templates-contract.js` | the contract of routes/combo-templates.js: each route's OpenAPI operation (S9), how a malformed save keeps its old 400 (validationOptions), and the words of a refusal … | 07-offers-pricing-and-combos/combo-templates |
| `lib/compliance.js` | the deterministic conform-check: the compliance template per standard and evaluate(template, payload) giving a verdict, no model involved | 21-compliance-attestation-and-trade/attestation-and-verification |
| `lib/confcache.js` | PLATFORM CONFIG, asked once and remembered for a minute. (from the title line, to confirm) | 28-platform-and-operations/api-standard |
| `lib/conformance.js` | LIGHT, ADVISORY conformance check (proof of "the standard actively governs at runtime"). (from the title line, to confirm) | (to confirm) |
| `lib/connector-rows.js` | the checked-in-connector statement (KIT_ROWS), its row shape (rowOut) and the one read (connectorsOf). CALLED BY routes/integrations.js (status · streams · paged list) … | 28-platform-and-operations/home-facts |
| `lib/connectors-contract.js` | the contract of routes/connectors.js (14 routes, /api/connectors — a shop's devices and ERP connectors: make one, its connections, its key, and the two doors a device … | 28-platform-and-operations/connectors-routes |
| `lib/consolidate.js` | the wholesaler consolidation: many shops' messy requests folded into one requirement (what he must source) and the attribution (who asked), synonyms collapsed, variants … | 22-channels-capture-and-messaging/capture-webhooks-in-pending-structure-raise-conv |
| `lib/container.js` | the container model: a stable product identity pointing at its current immutable version (author mints the next version, resolve reads current or pinned). | 06-catalogue-pim/catalogue-read |
| `lib/contract-kit.js` | the building blocks of an area's contract (API-STANDARD S9): the schema shorthands, and contractOf(), which turns a table of routes into OpenAPI operations | 28-platform-and-operations/api-standard |
| `lib/convert.js` | ADOPTED engine copy, never edited here (engines release then adopt). The conversion engine. Pure: no database, no network, no clock it is not handed. Proven by (from the title line, to confirm) | (to confirm) |
| `lib/cost-view.js` | costSideOf (buy · sell · unknown — from the READER's own view only: the document kind, whether the reader sent it, the counterparty's role on the reader's | 01-rail-core-the-chit/chits-routes |
| `lib/cost-write.js` | sideOf (the side for the WRITING shop: lib/cost-view costSideOf over ONE small header read and ONE role read) · lockedLines (the stored lines under FOR UPDATE, by | 01-rail-core-the-chit/chits-routes |
| `lib/cost.js` | canRead · canReadSafe · record · read (cost rows and margin) · writeRefusal (a cost-blind co-assist writes `status` only) · costKeyRefusal (a cost-blind CREATE carries … | 07-offers-pricing-and-combos/cost-and-margin-per-item |
| `lib/counter-bill.js` | nothing — it READS the chit the counter sent with the bill number as `client_ref` (till.html chitOf → POST /api/chits/send | 08-rewards-and-loyalty/points-and-reward-ledger |
| `lib/counters-store.js` | The counter register on an entity (identities.policy_flags.counters): read it under a lock, patch one counter, the narrow list | 09-counter/counters-and-keys-pair-enrol-open-release |
| `lib/country-setup.js` | the entity's country · currency · year start · tax registration, and countries() — the registered packs as the setup step offers them | 20-settings-governance-and-plan/country-setup |
| `lib/country.js` | ADOPTED engine copy, never edited here (engines release then adopt). the country table a screen draws (rulesTable, meta, packFor, taxId, returnInfo): each pack's words and rules, read from the registered packs, never decided here. | 15-tax-and-country-packs/country-packs-jurisdiction |
| `lib/credit-cap.js` | the cap on a counter credit note: which bill it is against (against.chit_id, else against.bill_no), the one lock per bill, the notes already issued against it, | 14-accounting/README |
| `lib/crm-calls.js` | the OUTCOMES table (no table of its own — party_interaction · party_followup · memberships are the stores). | 11-crm-and-marketing/crm-calls |
| `lib/crm-contract.js` | the contract of the CRM routes (24): routes/crm.js (/api/crm) — each route's OpenAPI operation (S9) and the one way its refusals and faults are worded | 11-crm-and-marketing/crm-routes |
| `lib/crm-followups.js` | party_interaction · party_followup (b276) — the only writer of both. | 11-crm-and-marketing/crm-followups |
| `lib/crm-groups.js` | segments and groups as one answer, and the consented group send. | 11-crm-and-marketing/crm-groups |
| `lib/crm-leads.js` | the lead import (normalise · plan · importLeads) | 11-crm-and-marketing/crm-leads |
| `lib/crm.js` | the CRM's one party list/record read, the dues net, and removeParty (hide, never delete) | 11-crm-and-marketing/crm-parties |
| `lib/csp-report-contract.js` | the contract of routes/csp-report.js (/api/csp-report, 1 route): its OpenAPI operation (S9). | 28-platform-and-operations/limits-idempotency-rate-limits |
| `lib/csv-preflight.js` | read the file BEFORE it becomes data. (from the title line, to confirm) | 06-catalogue-pim/import-export-workbook-preflight |
| `lib/csv.js` | the catalogue CSV round trip: toCSV (export), parseCSV (RFC 4180 read) and toItems / templateFor / columnsFor mapping rows to items | 06-catalogue-pim/import-export-workbook-preflight |
| `lib/ctp-contract.js` | the contract of routes/ctp.js: each door's OpenAPI operation (S9), the codes of its refusals, and the answers those doors gave | 28-platform-and-operations/api-standard |
| `lib/ctp-repair.js` | repairing copies that arrived over CTP before RAIL-107 and name their sender by an id from the SENDER's database (no row of that id exists here) | 05-ctp-and-cross-installation/ctp-return-path |
| `lib/ctpaddress.js` | where an entity or an address lives (local or which installation) · parse/format of bridge_id@domain · the shared-link reader (fromShared) · the peer lookup both CTP … | 05-ctp-and-cross-installation/discovery-well-known-ctp-json-address-bridge-id |
| `lib/ctpdirectory.js` | manifestFor / publicKeyFor (a peer's signed manifest, cached) | 01-rail-core-the-chit/ctp-outbound-guard |
| `lib/ctpenvelope.js` | the CTP envelope: build · buildEvent (a copy / one change to a chit that crossed, RAIL-106) · sign (digest + seal) · open (shape → boundary → seal) → copy / event | 05-ctp-and-cross-installation/seal-rail |
| `lib/ctpkeys.js` | this installation's CTP signing identity: the Ed25519 key from CTP_PRIVATE_KEY, its public half, and sign/verify; unset degrades to "unsigned and it says so", never an … | 05-ctp-and-cross-installation/seal-rail |
| `lib/ctpquery.js` | CTP's READ verb: a signed question to a peer installation (the catalogue pull by store id), and the check of who is asking on the answering side | 05-ctp-and-cross-installation/deliver-query-across-domains |
| `lib/ctpreturn.js` | the CTP RETURN PATH (RAIL-106, takes in RAIL-114): a change to a chit that already crossed reaches the party on the other installation · the queue (ctp_event_out) and … | 05-ctp-and-cross-installation/ctp-return-path |
| `lib/ctptransport.js` | send (one signed envelope to one peer) | 01-rail-core-the-chit/ctp-outbound-guard |
| `lib/currency-cells.js` | which cells of a bill or a journal can carry a currency (billCellsOf, journalCellsOf) and the ONE refusal of a cell that names another | 14-accounting/README |
| `lib/customer-groups.js` | which customer groups a viewer carries in a seller's own customer_list (segment or customer:<id>), and which offers those groups may honestly be promised | 07-offers-pricing-and-combos/customer-groups-and-customer-only-offers |
| `lib/dayopen.js` | ADOPTED engine copy, never edited here (engines release then adopt). SETTING A COUNTER UP FOR THE DAY. The order, the questions, and what each answer means. (from the title line, to confirm) | (to confirm) |
| `lib/db-role.js` | the one SELECT + the verdict | 28-platform-and-operations/db-role |
| `lib/dbwatch.js` | the slow-statement timing and its fingerprint (watch, fingerprint, normalise, verbOf, slowMs) | 28-platform-and-operations/functions |
| `lib/defaults.js` | the catalogue declares it, a row overrides it, and we know which answered. (from the title line, to confirm) | 06-catalogue-pim/items-create-edit-bulk-status |
| `lib/definition-check.js` | the value a definition kind cannot do without (missingValue): the sentences the form shows, refused by the API for a hand-made request or an older client | 07-offers-pricing-and-combos/README |
| `lib/definitions-contract.js` | the contract of routes/definitions.js (6 routes, /api/definitions): each route's OpenAPI operation (S9), the words its refusals answer in (words), the one way a fault is | 07-catalogue-and-pricing/definitions |
| `lib/deliverline.js` | chit_line_delivery writes (record) and the summed reads (progress · summarise); the replay key (client_ref, b730). | 01-rail-core-the-chit/line-model |
| `lib/dev-otp.js` | the sealed-environment test, the fixed local codes, the tester code + TESTER_NAMES door, the boot preflight list | platform/dev-otp |
| `lib/dispute-alert.js` | the sentence a raised dispute answers with (who was told, or why it is a record on the raiser's own copy only). | 01-rail-core-the-chit/chits-routes |
| `lib/dispute-audience.js` | audienceOf (the dispute's audience as the party asking sees it: a roster of entity ids, the wide flag, or "not a party"). | 01-rail-core-the-chit/chit-crossing |
| `lib/dispute-may.js` | may I raise / resolve, and the one open-dispute COUNT the housekeeping guards read (delete · archive · close). | 03-disputes-service-and-register/dispute-may |
| `lib/docnumber.js` | ADOPTED engine copy, never edited here (engines release then adopt). The numbering RULES, per jurisdiction. Built 2026-09-11; the counter adopts it in the same change. (from the title line, to confirm) | (to confirm) |
| `lib/dues-view.js` | the rule above, for the party list / record (lib/crm), the books' dues page (GET /dues), the payment answers (R7) and the timeline's ledger entries (R8) | 16-finance/collections |
| `lib/employee-code.js` | an employee first code from mint to the screen: made once (issue), kept as a keyed hash, timed, e-mailed, refused in words when it cannot be kept or sent. | 18-identity-sign-in-and-access/sign-in |
| `lib/entities-contract.js` | the contract of routes/entities.js (23 of its 25 routes, /api/entities — the shop itself: the public vertical list, search and lookup, the profile, policy, the person's … | 28-platform-and-operations/entities-routes |
| `lib/entity-header.js` | the header answer (business · licences · trade_ready) | 28-platform-and-operations/entity-header |
| `lib/entitykind.js` | WHAT AN IDENTITY IS, AND THE ONE PLACE A GUESS SURVIVES. (from the title line, to confirm) | 19-onboarding-and-shop-setup/entity-kind-constitution-vertical-plan-type |
| `lib/erp-receipt.js` | the receipt of an ERP document (connector_receipt): which key identifies a document, the claim that makes one effect, the re-claim of a retry that must run again, the … | 28-platform-and-operations/connectors-routes |
| `lib/events.js` | the mailbox bell: server push over SSE with one-time tickets, per-entity subscribers and emit() / notifyAfter() | 22-channels-capture-and-messaging/notifications-and-the-bell |
| `lib/exposure.js` | exposureOf (the switches) · apply (the public copy of an item, cost-side keys always deleted) | 06-catalogue-pim/visibility-and-exposure |
| `lib/facts-contract.js` | the contract of routes/facts.js: each route's OpenAPI operation (S9) and the words its refusals answer in. | 28-platform-and-operations/facts-route |
| `lib/field-ledger.js` | the field ledger's facts read from the repo: migration columns, product form inputs, the readers of a not-used field, settings keys | 20-settings-governance-and-plan/field-ledger-fields-dictionary |
| `lib/finance-terms.js` | credit terms, the credit-limit check and who may override it. | 16-finance/finance-terms |
| `lib/folder-inventory.js` | WHICH FOLDERS A SHOP HAS UNDER ITS WORK, AND WHERE EACH ONE GOES IN THE LEDGER. (from the title line, to confirm) | 01-rail-core-the-chit/folders |
| `lib/folder-rules.js` | condition-to-folder filing rules (b132): list, add, remove and the evaluation hook that files a chit copy into a folder; self-healing before the migration | 01-rail-core-the-chit/folders |
| `lib/folder-views.js` | WHAT IS IN A VIEW FOLDER, AND HOW MANY ARE STILL OPEN. (from the title line, to confirm) | 01-rail-core-the-chit/folders |
| `lib/folders-contract.js` | the contract of routes/folders.js: each route's OpenAPI operation (S9) and the one way its refusals and faults are worded (said, faultOf, invalidFolder). | 01-rail-core-the-chit/folders |
| `lib/form-handshake.js` | WHICH INPUTS FILL WHICH FORM, computed from declarations alone. (from the title line, to confirm) | (to confirm) |
| `lib/forms-contract.js` | the contract of routes/forms.js (8 routes, /api/forms — the authority-forms engine): each route's OpenAPI operation (S9) and the one way their faults are worded … | 21-compliance-attestation-and-trade/functions |
| `lib/forms.js` | the authority-forms engine: the registry of forms, the fill (resolve), the freeze (issue), the signature and the filing onto a chit, over the shop's own rows. | 21-compliance-attestation-and-trade/functions |
| `lib/fx-rates.js` | foreign-currency trade in the books: the typed or imported rates (b391), the rate a foreign entry posts at, the settlement of a foreign bill and the period-end … | 16-finance/fx-rates |
| `lib/gherkin.js` | (to confirm) | (to confirm) |
| `lib/govcontext.browser.js` | ADOPTED engine copy, never edited here (engines release then adopt). WHAT THE APPLICATION CAN KNOW WITHOUT ASKING ([TILL-72] / registration) (from the title line, to confirm) | (to confirm) |
| `lib/governance-contract.js` | the contract of routes/governance.js: each route's OpenAPI operation (S9) and the one way its refusals and faults are worded (said, faultOf, thrownAs, vaultFault … | 21-compliance-attestation-and-trade/governance |
| `lib/govresolve.js` | resolveEntityGovernance · resolveInstallationGovernance · currencyRefusal · mintedOf · verticalOf / verticalFrom (VERT-1) · tradeWordsOf · sectorsOrTrade (VERT-13) | 20-settings-governance-and-plan/governance-7-layers-govcontext |
| `lib/groupsum.js` | requirement (what a folder or a ticked set adds up to) · gather · attachValue · lineKey — the sum of the shop's own copies, a cost-blind reader's counting only its … | 01-rail-core-the-chit/folders |
| `lib/gs1.js` | ADOPTED engine copy, never edited here (engines release then adopt). GS1 identification keys, actually checked. (from the title line, to confirm) | (to confirm) |
| `lib/gst-returns.js` | ADOPTED engine copy, never edited here (engines release then adopt). a month's GSTR-1 and GSTR-3B read from the frozen invoices, their reconciliation to the Ledger, s.50 interest, and returnFor / periodsFor (the shop's own return by its … | 15-tax-and-country-packs/gst-returns-bas-vat |
| `lib/handle.js` | the human-readable names of the namespace (the store handle like athi.clothing and its sibling kinds): grammar, validation and building; pure, uniqueness is the … | 18-identity-sign-in-and-access/user-id |
| `lib/holder.js` | WHO HOLDS A REQUEST (M04, 2026-10-07). middleware/auth.js sets req.till = holderOf(decoded, keyRecord) on (from the title line, to confirm) | 18-identity-sign-in-and-access/access-levels-and-roles |
| `lib/home-facts.js` | what each Home card says (GET /api/facts/:card): one read per card answering { lines, figures, state }, no money or time formatted, a figure it cannot compute omitted … | 28-platform-and-operations/home-facts |
| `lib/id-guard.js` | the ONE place a path id that must be a uuid is checked for every router that did not check it itself: a malformed id answers 404 NOT_FOUND, never the database's 22P02 … | 28-platform-and-operations/api-standard |
| `lib/iddoc-verify.js` | the code that proves a phone / e-mail document, and the ONE reader of which identity holds a verified contact | 18-identity-sign-in-and-access/sign-in |
| `lib/identity-auth.js` | the one place that signs somebody in: verifyCredential (OTP or PIN, attempt lock), issueToken, openSession and signToken for every kind of login | 18-identity-sign-in-and-access/sign-in |
| `lib/identity-docs-contract.js` | the contract of routes/identity-docs.js (4 routes, /api/identity — a person's own phone, e-mail and government IDs): each route's OpenAPI operation (S9) and the one way | 18-identity-sign-in-and-access/README |
| `lib/identity.js` | which line is this, and which product does it belong to? (from the title line, to confirm) | 06-catalogue-pim/catalogue-face |
| `lib/impact.js` | the impact walk: walk() over the open dependency edges and reach() counting businesses and filings, one engine for both callers | 03-disputes-service-and-register/raida-register-and-report |
| `lib/input-hygiene.js` | the one door check for text the database cannot hold: a NUL byte (\u0000) in a body, a query or a path is refused 400 INVALID_CHARACTER. | 28-platform-and-operations/api-standard |
| `lib/installer-token.js` | the ONE-TIME INSTALLER TOKEN: the code that lets the installer make an installation's first private root entity through the ordinary register + verify door. | 18-identity-sign-in-and-access/platform-root |
| `lib/instruments.js` | the commercial-instrument catalogue for EXIM (insurance, hedging, guarantees) and its resolver. | 21-compliance-attestation-and-trade/instruments |
| `lib/integrations-contract.js` | the contract of routes/integrations.js: each route's OpenAPI operation (S9) and the answers those routes gave before the standard (S2, S14). | 28-platform-and-operations/integrations |
| `lib/inventory.js` | apply · check · replay · signedQty · the reasons (what a movement does to a balance, the weighted average) | 13-inventory-stock-and-traceability/on-hand-and-movements |
| `lib/invoice-issued.js` | "is this chit's invoice already ISSUED on this copy?" and the one refusal a money change on an issued invoice gets (ACC-192 slice 1a) | 14-accounting/README |
| `lib/invoice-lease.js` | The block LEASE of invoice numbers (CTR-213, ACC-192 S2, Athi 8 Nov 2026: "the SERVER owns the AE invoice counter"): a till asks for a block of numbers of the issuer's … | 09-counter/ae-invoice-lease |
| `lib/issued-invoice.js` | the server's one check of an issued invoice: check() only NAMES a difference between two invoices, it never computes one | 15-tax-and-country-packs/tax-compute-rate-invoice-tax |
| `lib/istest.js` | the one answer to "does this entity count?" (is_test, b246) and the cached probe for whether the database has that column yet, so no caller SELECTs a missing column | 19-onboarding-and-shop-setup/entity-kind-constitution-vertical-plan-type |
| `lib/item-cost.js` | THE ONE PLACE AN ITEM'S ROUGH COST IS READ AND WRITTEN. (from the title line, to confirm) | 06-catalogue-pim/catalogue-read |
| `lib/itemmatch.js` | match(phrase, comment, catalogue) · norm · lev · exactTokens (numbers, units, sizes, grades match EXACTLY, CAT-261) · candidate · keyOf · stampOf | 06-catalogue-pim/items-create-edit-bulk-status |
| `lib/itemstatus.js` | the four lifecycle words, the one status stamp (stamp · stampInto) and the question each reader asks of a row (statusOf · isMatchable · isOfferable) | 06-catalogue-pim/README |
| `lib/junitresults.js` | READ A JUNIT REPORT INTO BOARD RESULTS, AND FOLD THEM TO ONE PER CASE. (from the title line, to confirm) | 29-qa-test-tooling-ux-locale-and-design-system/test-board |
| `lib/jurisdiction.js` | ADOPTED engine copy, never edited here (engines release then adopt). WHERE A PARTY IS, AND WHAT THAT DECIDES. Pure: no database, no network, no state. (from the title line, to confirm) | (to confirm) |
| `lib/jwt-verify.js` | the one jwt.verify: JWT_SECRET first, JWT_SECRET_PREV only on a bad signature. | 18-identity-sign-in-and-access/sessions-and-devices |
| `lib/knownerr.js` | database refusals, one-shot conflicts and refusals thrown on purpose (refused + a 4xx status + a code), answered in words. | 01-rail-core-the-chit/chits-routes |
| `lib/kyb-contract.js` | the contract of routes/kyb.js (5 routes, /api/kyb — the "Know your business" panel): each route's OpenAPI operation (S9) and the one way their faults are worded | 21-compliance-attestation-and-trade/know-your-business |
| `lib/kyb.js` | the Know-Your-Business facts, each with its trust rung, computed from data already held | 21-compliance-attestation-and-trade/know-your-business |
| `lib/ledger.js` | ADOPTED engine copy, never edited here (engines release then adopt). , independent closing figure (bookpack's tie check). Month-end asOf only. | (to confirm) |
| `lib/licence-rules.js` | the words and bands for a held licence, as data keyed by country. | 21-compliance-attestation-and-trade/licences |
| `lib/limiter-key.js` | the ONE bucket key for the per-caller limiters (services, public doors, till mint): a value the caller cannot invent. | 18-identity-sign-in-and-access/rate-limits |
| `lib/limits.js` | the body-size table (LARGE → 8 MB, else 256 KB), the request deadline, the statement deadline and the admission cap (PLT-85 / SPD-45) | 28-platform-and-operations/limits-idempotency-rate-limits |
| `lib/line-guard.js` | the ONE quantity + negation guard over an AI reading of someone's words (T1-AI, 2026-10-14). (from the title line, to confirm) | 25-ai-cb-assist-and-support-desks/message-order-extraction |
| `lib/line-shape.js` | what a send's line items are checked for BEFORE the money engine reads them: a line_id that is not a uuid or is repeated, and a figure-like key the engine does not read. | 01-rail-core-the-chit/chits-routes |
| `lib/list-filters.js` | which of a chit list's filters (?assigned_to, ?date_from, ?date_to) cannot be read, judged before the query casts them. | 01-rail-core-the-chit/chits-routes |
| `lib/local-identity.js` | minting a local (never-registered) party and the one add-customer sequence (addCustomer, by phone first — R7) | 11-crm-and-marketing/local-identity |
| `lib/locale.browser.js` | ADOPTED engine copy, never edited here (engines release then adopt). THE LOCALISATION LAYER. One roof for every decision that changes across a border. (from the title line, to confirm) | (to confirm) |
| `lib/logger.js` | the one leveled, structured logger (one JSON line per event). | 28-platform-and-operations/api-standard |
| `lib/lotfields.js` | ADOPTED engine copy, never edited here (engines release then adopt). WHAT A VERTICAL MUST CAPTURE ABOUT A CONSIGNMENT (2026-09-08). (from the title line, to confirm) | (to confirm) |
| `lib/marketing-contract.js` | the contract of routes/marketing.js (/api/marketing): its route's OpenAPI operation (S9), the Marketing read's fault (faultOf) and the sentence the sign-in fence … | 11-crm-and-marketing/crm-routes |
| `lib/marketing-results.js` | "Who came back" — which customers a shop SENT an offer to, and which of them then bought. Buckets the sends against the bills; computes no sum of its own. | 12-marketing/README |
| `lib/match.js` | DOES THIS CHIT MEET A DECLARED CONDITION. The third shared primitive. (from the title line, to confirm) | 01-rail-core-the-chit/user-folders-and-auto-file-rules |
| `lib/measure.js` | the one measurement of a set of chits — open · overdue · ageing · per-currency sums — that Home, the folder pane and Reports read. | 01-rail-core-the-chit/measure |
| `lib/memberships.js` | the memberships table's one writer and its latest-row read | 11-crm-and-marketing/crm-parties |
| `lib/message-limit.js` | how long ONE message may be (RAIL-106 part 3, the gorilla test's 100,000-character message) and the refusal in words when it is longer | 01-rail-core-the-chit/chits-routes |
| `lib/meter.js` | ONE way to record a billable event. (from the title line, to confirm) | 28-platform-and-operations/usage-metering |
| `lib/mint-product.js` | validation for a person. This is the act, once the decision is made — keeping the two apart is what stops a | storefront-and-catalogue/mint-product |
| `lib/mint.js` | the shape of a chit (header, copies) and deliver(): address every copy, send the remote ones, then ONE chit_deliver | 01-rail-core-the-chit/send-mint-a-chit |
| `lib/mintuserid.js` | the combinations of a user id: who it belongs to and how it is built (mint, entity, network, employee, customer, minted, bridge, ownerOf, KINDS) | 18-identity-sign-in-and-access/functions |
| `lib/money-check.js` | the COMPARE-and-RAISE for a chit's stored money: billTotalOf (the pick, plus the shop's sentence), billTotalWire (the `bill_total` key a chit list and detail carry) and … | 14-accounting/README |
| `lib/money.js` | ADOPTED engine copy, never edited here (engines release then adopt). an amount is never a bare number. (from the title line, to confirm) | (to confirm) |
| `lib/move-in-gate.js` | gate(): the shop's pack + its move-in map through engines country.moveInFor (never a fallback pack, never India for an unknown) · | 14-accounting/move-in-from-xero-quickbooks |
| `lib/move-in-proof.js` | build(plan, applied, ctx) → the proof (pure) · store(h, entity, rec) — one insert-only row in move_in_import, on the import's own | 14-accounting/move-in-from-xero-quickbooks |
| `lib/move-in.js` | the move-in readers, the column guess, plan() and apply(); a cell's figure → minor units (toMinor: the loose reading here, the conversion books-cashflow's). | 14-accounting/move-in-from-xero-quickbooks |
| `lib/namedentity.js` | ONE WAY TO NAME A SPECIAL ENTITY IN THE ENVIRONMENT. (from the title line, to confirm) | 28-platform-and-operations/api-standard |
| `lib/netcert.js` | the shape of a membership certificate and of any document the network master signs (the directory), how it is sealed, and the pure check of one. | 28-platform-and-operations/network-control-panel |
| `lib/netmember.js` | what this installation is in the network (standalone / member / master), who it pinned as master, the door's membership verdict, the master's answers | 28-platform-and-operations/network-control-panel |
| `lib/netsync.js` | the network's PULLS: a member fetches its certificate and the signed directory from the pinned master; the master reads each member's registry_change by sequence; | 28-platform-and-operations/network-control-panel |
| `lib/network-build-run.js` | THE BUILD, AS NAMED STEPS (round T2-SPLIT, 2026-10-14). (from the title line, to confirm) | 04-network/network-design-builder |
| `lib/network-build.js` | turning a saved network design into a build plan: what would be created (owned), invited (partner), skipped or refused; pure, no DB, the route executes the plan | 04-network/network-design-builder |
| `lib/network-catalogue.js` | the network catalogue: what a brand publishes to its stores, the diff between releases, the store marks | network-and-trade/network-catalogue |
| `lib/network-contract.js` | the contract of the network routes (23): src/routes/network.js (/api/network, 12 — the tree, the edges between businesses), routes/network-design.js … | 04-network/connections-and-invitations |
| `lib/network-membership.js` | governance edge is SUSPENDED. JOINED an existing business with an ACTIVE `commercial` edge from the brand — it asked and the brand approved, or the | 04-network/connections-and-invitations |
| `lib/network-offers-contract.js` | the contract of routes/network-offers.js: each route's OpenAPI operation (S9), the answer a refused catalogue step gets (refusalOf), a read that failed (faultOf) and … | network-and-trade/network-offers |
| `lib/network-offers.js` | the brand's released offers and what a store is handed (forStore → narrowToBrandLines). | 07-offers-pricing-and-combos/network-offers |
| `lib/network-search.js` | "find a business or a product" across installations (NET-39): Here (this installation) and There (one other installation, or every one we | 04-network/directory-and-search |
| `lib/network-view.js` | one shopfront, many departments. (from the title line, to confirm) | 04-network/network-app-member-view |
| `lib/not-migrated.js` | the ONE sentence a shopkeeper reads when a part of the product waits for a database update (a 503 "not migrated"). | 28-platform-and-operations/api-standard |
| `lib/notify.js` | sending: the OTP (e-mail via Resend, SMS provider-pluggable), a generic notice e-mail, and the support alert OUR side gets when a money mismatch is found (ACC-206 B). | 25-ai-cb-assist-and-support-desks/support-desks |
| `lib/numerals.js` | ADOPTED engine copy, never edited here (engines release then adopt). the CLOSED CLASS. Numbers, negation, and the words that are never either. (from the title line, to confirm) | (to confirm) |
| `lib/offer-clash.js` | TWO LIVE DISCOUNTS ON ONE SHELF, REFUSED AT SAVE (T2-LABS · OFF-E1, 2026-10-14). (from the title line, to confirm) | 07-offers-pricing-and-combos/offer-lab |
| `lib/offers-contract.js` | the contract of routes/offers.js (the offer engine as a service): each route's OpenAPI operation (S9), the words of its one refusal and of a fault. | 07-offers-pricing-and-combos/offers-engine-as-service |
| `lib/offers-engine.js` | ADOPTED engine copy, never edited here (engines release then adopt). the offer kinds (percent off · amount off · tier price · threshold · bundle · buy X get Y · mix and match · shipping · price range), their stacking order, the running … | 07-offers-pricing-and-combos/offers-engine-public-service |
| `lib/offers-live.js` | the seller's live offers applied to a set of lines: the one function every path calls (storefront order and the send path), customer-only offers included | 07-offers-pricing-and-combos/offers-engine-public-service |
| `lib/open-orders.js` | the open-orders definition (which orders are tasks, their live lines, billed / despatched marks). | 02-tasks-orders-and-workflow/open-orders-queue |
| `lib/optout.js` | a STOP reply on WhatsApp: the withdrawal of marketing consent it means, its one confirmation, and the opt-out line every offer carries. | 23-connectors-and-integrations/functions |
| `lib/order-input.js` | what a catalogue receives, declared as a JSON Schema fragment: presets, resolve / forItem, bounds, validate, validateDocuments and mergePatch | 06-catalogue-pim/catalogue-face |
| `lib/orderhub.js` | ADOPTED engine copy, never edited here (engines release then adopt). ONE SET OF ORDERS, SHARED BY DEVICES THAT CANNOT SEE THE INTERNET. (from the title line, to confirm) | (to confirm) |
| `lib/orders-contract.js` | the contract of the orders and workflow routes (23): routes/repeat-supply.js (/api/repeat, 14), routes/work.js (/api/work, 3) and routes/counters.js (/api/counters, 6) — | 02-tasks-orders-and-workflow/everyones-work |
| `lib/orders.js` | ADOPTED engine copy, never edited here (engines release then adopt). AN ORDER HELD OPEN AGAINST A SUBJECT. The rules, with no screen anywhere near them. (from the title line, to confirm) | (to confirm) |
| `lib/otp.js` | OTP generation, the attempt cap, the shopper's one-shot code, and the keyed hash a staff code is kept as (SEC-106). | 10-online-shop-and-storefront-orders/order-start-confirm |
| `lib/output-allowlist.js` | the output allow-list (API-STANDARD S34): a success answer leaves a route holding ONLY the keys its success schema lists, at every level the schema closes | 28-platform-and-operations/api-standard |
| `lib/owner.js` | the one owner test: isOwner(req), gate(message), may(req, message). | 28-platform-and-operations/api-standard |
| `lib/pack-kit.js` | ADOPTED engine copy, never edited here (engines release then adopt). THE COUNTRY HELPERS (R1). Athi, 2026-10-16: "each country should have its own engine … if there are shared functionalities, (from the title line, to confirm) | (to confirm) |
| `lib/pack-words.js` | the country pack's words the engines packs do not carry yet: the tax's name (GST · VAT), the registration kinds a shop may | 15-tax-and-country-packs/pack-words |
| `lib/page-limit.js` | the page a list route is asked for (`?page=` · `?limit=`) and the envelope it answers (`total · page · limit`). | 28-platform-and-operations/page-limit |
| `lib/parallel-run.js` | reading their statements into rows, mapping their lines to our ledgers, the line-by-line compare with its WHY, the auditor's csv. Pure: no database, no posting. | 14-accounting/parallel-run |
| `lib/party-contact.js` | the e-mail a shop keeps for a party it minted (party_contact, b839): the ONE writer (set) and the ONE read fragment (emailSql). | 11-crm-and-marketing/parties-one-record-timeline-interactions |
| `lib/party-fields.js` | the party fields on the customer and supplier lists, their contact (phone, e-mail) and tax ids. | 11-crm-and-marketing/parties-one-record-timeline-interactions |
| `lib/party-live.js` | the live-row predicate · its mirror (hiddenSql) · the answer words of a restored party (the way back itself is lib/party-restore) | 11-crm-and-marketing/crm-parties |
| `lib/party-restore.js` | the way back from removeParty: a deleted party's list rows un-hidden on both lists | 11-crm-and-marketing/crm-parties |
| `lib/people-contract.js` | the contract of routes/people.js (/api/people, 1 route): its OpenAPI operation (S9) and the one way its fault is worded (failed). | 17-people-employees-hr-and-payroll/people-list |
| `lib/people.js` | P1: THE SHOP'S PEOPLE, WITH WHAT THIS LOGIN MAY DO TO EACH. Pure; no DB, no network. (from the title line, to confirm) | 17-people-employees-hr-and-payroll/people-list |
| `lib/period.js` | ADOPTED engine copy, never edited here (engines release then adopt). WHICH MONTH IS OPEN, WHERE AN ENTRY LANDS, AND WHEN A YEAR MAY CLOSE (v1.20.0, 2026-10-03). (from the title line, to confirm) | (to confirm) |
| `lib/person-session.js` | A PERSON SIGNED IN ON A DEVICE: listed, bound, revocable (M05, SPEC-iam-build §3.3/§3.4, D3, D14). (from the title line, to confirm) | 18-identity-sign-in-and-access/sessions-and-devices |
| `lib/plans.js` | the subscription plan catalogue and its quota / feature mechanism (a HELD foundation, @stage held): quotaOf, hasFeature, withinQuota, resolveBundle | 20-settings-governance-and-plan/plan-and-usage-entitlements-metering |
| `lib/platformroot.js` | the deployment's root entity and the platform role (isPlatform), and the platform doors' refusals (refuseUnlessPlatform, refuseUnlessRoot: a 403 or 404 Problem, the old … | 18-identity-sign-in-and-access/platform-root |
| `lib/plumbing-contract.js` | the contract of the three plumbing doors: GET /health (routes/health.js), OPTIONS * (routes/preflight.js) and GET /api/openapi.json (routes/openapi.js): each one's … | 28-platform-and-operations/api-standard |
| `lib/points.js` | a reward point is NOT money, and this file exists so the two can never be confused. (from the title line, to confirm) | 08-rewards-and-loyalty/points-and-reward-ledger |
| `lib/policy.js` | the per-entity policy flags (b130), server-side: the whitelist of flags, coercion, validated patch writes, the proxied self_copy_pref column and the pack's words for them | 28-platform-and-operations/policy |
| `lib/posting.js` | ADOPTED engine copy, never edited here (engines release then adopt). the double-entry posting rules: one event in, balanced Dr/Cr lines out (refused unless debits equal credits to the minor unit), plus the walk-in day summary, tax … | 14-accounting/ledger-accounts-day-book-entries-reverse |
| `lib/price-drift.js` | driftOf(bill, rows, currency) → { skip } / { lines[], unknown, billed_at, snapshot_at } · answeredOf(business_json) → the reason a bill is exempt, or null · … | 09-counter/README |
| `lib/price-moved.js` | movedOf(lines, rows, since, currency) → { lines: [fact], prices } · whoAsks(req) → 'person' / 'till' / 'unattended' · actorOf(req) · repricedLines(lines, found) · … | 09-counter/README |
| `lib/price-note.js` | the credit or debit note an accepted price change on an issued invoice issues (ACC-192 slices 1b + 2): the changed lines only, the direction, the note chit's body, the … | 14-accounting/README |
| `lib/pricing-contract.js` | the contract of routes/pricing.js: each route's OpenAPI operation (S9) and the words its refusals answer in. | 28-platform-and-operations/pricing-service |
| `lib/pricing-engine.js` | ADOPTED engine copy, never edited here (engines release then adopt). | (to confirm) |
| `lib/privacy-contract.js` | the contract of routes/privacy.js (4 routes, /api/privacy — the public privacy facts and a storefront shopper's own privacy answer): each route's OpenAPI operation (S9) | 11-crm-and-marketing/privacy-consent |
| `lib/privacy.js` | consent rows (party_contact_pref), the send gate, the request register and the per-country law words | 11-crm-and-marketing/privacy-consent |
| `lib/problem.js` | the one error body (RFC 9457 problem details plus our `code`): build it, send it, and turn a thrown error into it. | 28-platform-and-operations/api-standard |
| `lib/product-categories.js` | idsOf(item_data) · applyChange(item_data, { add, remove }, names) → { changed, item_data } · changeCategories(db, entity_id, change) (the locked read, the per-product … | 06-catalogue-pim/categories-and-fields |
| `lib/products-contract.js` | the contract of routes/products.js: each route's OpenAPI operation (S9), the words its refusals answer in (words), and the one way a fault is worded (faultOf · failed · … | storefront-and-catalogue/products-routes |
| `lib/profile-map.js` | ADOPTED engine copy, never edited here (engines release then adopt). WHAT WE LOOK FOR ABOUT A STORE, WHERE IT COMES FROM, AND HOW MUCH TO TRUST IT. (from the title line, to confirm) | (to confirm) |
| `lib/profile.js` | the entity profile and its vault (read · save · merge-patch) | 28-platform-and-operations/know-your-business |
| `lib/public-base.js` | WHERE THIS INSTALLATION IS REACHED FROM OUTSIDE, FROM CONFIG (HX1). Never a platform's host name in code (from the title line, to confirm) | (to confirm) |
| `lib/public-facts.js` | WHAT A COUNTERPARTY MAY SEE ABOUT AN ENTITY, WITH HOW WELL IT IS KNOWN. (from the title line, to confirm) | 21-compliance-attestation-and-trade/know-your-business |
| `lib/qty.js` | ADOPTED engine copy, never edited here (engines release then adopt). 500 GRAMS OF SOMETHING SOLD BY THE KILO IS 0.5. (from the title line, to confirm) | (to confirm) |
| `lib/quick-keys-contract.js` | the contract of routes/quick-keys.js (9 routes, /api/quick-keys — the manager's quick-key groups, Level 1): each route's OpenAPI operation (S9) and the one way its … | 28-platform-and-operations/quick-keys-routes |
| `lib/quick-keys.js` | the Level-1 groups (list · create · change · delete · keys · order) and the Level-2 counter state, as engine functions over a db already bound to the shop. | 28-platform-and-operations/quick-keys-routes |
| `lib/raida.js` | the RAIDA register: entries, revisions and closures (risks · assumptions · issues · dependencies · actions), state computed never stored. | 28-platform-and-operations/raida |
| `lib/rail-actions.js` | the api's door to the adopted rail engine — who is asking, what my copy holds, how a route refuses, and the ONE table of | 01-rail-core-the-chit/rail-actions |
| `lib/rail-status.js` | the ONE write of a chit copy's status (compare-and-set). | 01-rail-core-the-chit/status-the-one-status-writer |
| `lib/rail.js` | ADOPTED engine copy, never edited here (engines release then adopt). | (to confirm) |
| `lib/raiseticket.js` | raising a support ticket as a chit from a shop to the operator: choosing the desk (resolveDesk), previewing what would be raised (preview) and minting it (raise). | 25-ai-cb-assist-and-support-desks/support-desks |
| `lib/rate-door.js` | setsRate(req) · RATE_ASK_OWNER · RATE_OWNER_ONLY (the code) · refusal(rows) (the 403 as problem() takes it) · rateChanged(next, stored) · rateNamed(item_data) · RATE_KEYS | storefront-and-catalogue/products-routes |
| `lib/rate-limit.js` | the ONE way a limiter is built and the ONE answer it gives when a caller is over the limit: 429 problem+json, code RATE_LIMITED, Retry-After. | 28-platform-and-operations/limits-idempotency-rate-limits |
| `lib/rates.js` | what a billable event costs, as a stamped card: the rate card whose id and numbers are copied into each usage_ledger row, zero on purpose until the owner sets a price | 20-settings-governance-and-plan/plan-and-usage-entitlements-metering |
| `lib/readiness.js` | the trade-readiness roll-up: the entity's standards, the gathered documents and the destination-resolved lanes | 23-compliance-trade-and-attestation/trade-readiness |
| `lib/receivables.js` | ADOPTED engine copy, never edited here (engines release then adopt). which bills a party owes and what reduced them: party-item rows, the proposal, the check, reversals and their releases. | 16-finance/payments |
| `lib/reference-store-lists.js` | which entity is the store of which list (STORES) and reading a list's rows back out of its store. | 06-catalogue-pim/README |
| `lib/reference.js` | THE SELF-PROVING REFERENCE. A "reference check" on ChitBridge is not a chased-down PDF or a phone (from the title line, to confirm) | 21-compliance-attestation-and-trade/reference |
| `lib/reg-ae.js` | ADOPTED engine copy, never edited here (engines release then adopt). the UAE regulation pack: its chart, IFRS lines, VAT 5% with its supply kinds, the VAT201 periods, the corporate-tax facts and the dated records retention by tax, as data. | 15-tax-and-country-packs/country-packs-jurisdiction |
| `lib/reg-au.js` | ADOPTED engine copy, never edited here (engines release then adopt). the Australia regulation pack: its chart, AASB 101 lines, Division 40 depreciation, GST 10% with its supply kinds, the BAS periods and labels, the dated penalty unit … | 15-tax-and-country-packs/country-packs-jurisdiction |
| `lib/reg-in.js` | ADOPTED engine copy, never edited here (engines release then adopt). the India regulation pack: its chart, Schedule III lines, depreciation, GST tax pack (rates, dated rate menu, dated price bands, dated late fee, return calendar) … | 15-tax-and-country-packs/country-packs-jurisdiction |
| `lib/reg-jp.js` | ADOPTED engine copy, never edited here (engines release then adopt). THE JAPAN · CONSUMPTION TAX REGULATION PACK. (from the title line, to confirm) | (to confirm) |
| `lib/reg-my.js` | ADOPTED engine copy, never edited here (engines release then adopt). THE MALAYSIA · SST REGULATION PACK. (from the title line, to confirm) | (to confirm) |
| `lib/reg-sg.js` | ADOPTED engine copy, never edited here (engines release then adopt). THE SINGAPORE · GST REGULATION PACK. (from the title line, to confirm) | (to confirm) |
| `lib/reg-us.js` | ADOPTED engine copy, never edited here (engines release then adopt). THE UNITED STATES · SALES TAX REGULATION PACK. (from the title line, to confirm) | (to confirm) |
| `lib/regional.js` | the governed currency of an entity (currencyRead / currencyFor: its own, else its region's, else null + a reason) and the regional layer a container is resolved through | 28-platform-and-operations/regional-layer |
| `lib/register-gate.js` | the per-shop switch of the RAIDA register: "is the register on for this shop", and the one refusal when it is off (RAIL-90). | 01-rail-core-the-chit/raida |
| `lib/regulation.js` | ADOPTED engine copy, never edited here (engines release then adopt). THE REGISTRY OF COUNTRY PACKS, AND THE CONTRACT THEY MEET (core-vs-packs step a3, v1.21.0, 2026-10-03). (from the title line, to confirm) | (to confirm) |
| `lib/relationships-contract.js` | the contract of the relationship routes (14): routes/relationships.js (/api/relationships) — each route's OpenAPI operation (S9) and the one way its refusals and faults … | 11-crm-and-marketing/relationships-routes |
| `lib/remote-catalogue.js` | reading the catalogue of a supplier who lives on ANOTHER installation (NET-39 walk finding): the signed `catalogue` question, answered in the | 04-network/directory-and-search |
| `lib/remote-party.js` | adding a business that lives on ANOTHER installation, by its address (RAIL-101 / NS-3): the local party row, linked to the remote installation. | 05-ctp-and-cross-installation/discovery-well-known-ctp-json-address-bridge-id |
| `lib/repeat-supply.js` | the agreement's step table, its schedule and dates, the repeat_supply store, and the sweep that mints each run | 12-suppliers-and-procurement/repeat-supply |
| `lib/reporting.js` | the NETWORK-LEVEL REPORTING CURRENCY, and mode 3 of a money summary. (from the title line, to confirm) | (to confirm) |
| `lib/reprice.js` | the reprice of a chit's lines from the catalogue: plan (preview, writes nothing) and apply (amendments, never a price edit) | 06-catalogue-pim/items-create-edit-bulk-status |
| `lib/reqctx.js` | request-scoped context (`async_hooks`), so EVERY transaction opened during a request carries the actor | 28-platform-and-operations/api-standard |
| `lib/resolveuserid.js` | the reading of a stored user id (classify, isSendable, storedForm, realEmail, KINDS, BRIDGE, DOMAINISH) | 18-identity-sign-in-and-access/functions |
| `lib/respond.js` | keeping internal/DB error text out of client responses: safeErr logs the real error and returns the one generic sentence. | 28-platform-and-operations/api-standard |
| `lib/retention.js` | the retire rule (computeRetireAt), the bounded extension, the sweep plan and its commit door (archive receipt + flush event) | 27-data-lifecycle-retention-storage-archive/retention-rules-and-floor |
| `lib/reward-check.js` | the numbers of a reward programme that the earning engine would misread: what a way to spend points needs (points above 0, and an amount above 0 for money off) and how … | 08-rewards-and-loyalty/README |
| `lib/reward-store.js` | reward_ledger (append-only) · the one programme read (definition kind 'reward') | 08-rewards-and-loyalty/points-and-reward-ledger |
| `lib/rewards.js` | ADOPTED engine copy, never edited here (engines release then adopt). WHAT A REWARD POINT IS WORTH, AND HOW TO SAY SO. Pure: no database, no network, no state. (from the title line, to confirm) | (to confirm) |
| `lib/rollup.js` | ADOPTED engine copy, never edited here (engines release then adopt). | (to confirm) |
| `lib/rootlink.js` | WHEN A SHOP REGISTERS, IT BECOMES OUR CUSTOMER AND WE BECOME ITS SUPPLIER. (from the title line, to confirm) | (to confirm) |
| `lib/safe-url.js` | assertPublicHttps / isBlockedAddress (SSRF guard for outbound fetches to a host a stranger names) | 01-rail-core-the-chit/ctp-outbound-guard |
| `lib/scalecode.js` | ADOPTED engine copy, never edited here (engines release then adopt). A BARCODE A WEIGHING SCALE PRINTED. Which item, and how much of it. (from the title line, to confirm) | (to confirm) |
| `lib/schedule.js` | parking a catalogue change for a date, its re-judgement when due, applying it lazily on read, listing and cancelling | 06-catalogue-pim/README |
| `lib/schema-bootstrap.js` | giving a freshly minted entity its default Product schema (ensureDefaultSchema) and the one mapping of catalogue_visibility to schema visibility (schemaVisibilityFor) | 19-onboarding-and-shop-setup/starter-catalogue-and-seeds |
| `lib/schema.js` | "does the schema have X yet" — a column, a table, a CHECK value — asked once, a yes cached forever, a no for 60 s | 28-platform-and-operations/migrations-and-schema |
| `lib/schemas-contract.js` | the contract of routes/schemas.js (7 routes, /api/schemas — the catalogue's schema engine: the shop's definition and its columns): each route's OpenAPI operation (S9) … | 07-catalogue-and-pricing/catalogue-setup |
| `lib/screen-kit.js` | ADOPTED engine copy, never edited here (engines release then adopt). A LIBRARY OF SCREEN DESIGNS, SO A SHOP (OR ITS SYSTEM) PICKS THE LOOK THAT FITS IT (2026-09-17). (from the title line, to confirm) | (to confirm) |
| `lib/search-engine.js` | ADOPTED engine copy, never edited here (engines release then adopt). What "ac co" means, for the counter and for the Catalogue. Pure — no I/O, no DB, no network; the API only serves the file. (from the title line, to confirm) | (to confirm) |
| `lib/select.js` | the one list read over a shop's chit copies (chit_status ⨝ chit_header). | 01-rail-core-the-chit/folders |
| `lib/sellable-price.js` | fault(price) → 'unset' / 'negative' / null · unsetSaid(name) · negativeSaid(name) · soldAt(price) (the price, or null when it cannot be sold) | 07-offers-pricing-and-combos/till-price-and-worth-an-offer |
| `lib/send-money.js` | the scope of the engine at send (scopeOf) · THE ONE engine call for one set of lines (invoiceOfLines: a send through invoiceAtSend, | 01-rail-core-the-chit/README |
| `lib/service-contract.js` | the contract of routes/service.js (/api/service, the service clock of a chit): each route's OpenAPI operation (S9) and the statuses the handlers write themselves. | 03-disputes-service-and-register/service-request-sla-pause |
| `lib/services.js` | the shared plumbing of the governed services (the caller's lines or this shop's shelf, the shop's party and price-includes-tax). | 15-tax-and-country-packs/tax-compute-rate-invoice-tax |
| `lib/sheet.js` | the user-facing projection of a catalogue row for a spreadsheet: answers out (availability yes/no, category names), records in; pure, no I/O | 06-catalogue-pim/import-export-workbook-preflight |
| `lib/shop-actors.js` | actorOwned(): the lookup of an actor under the caller's shop (SEC-103). Postgres checks a foreign key without row security, and entity_work_routing.assignee_actor_id | 28-platform-and-operations/api-standard |
| `lib/shop-clock.js` | the one clock a ledger posting reads (now · nowMs · today · bizDay) and the simulator's set / advance / freeze / reset. | 28-platform-and-operations/load-simulation |
| `lib/shopchanged.js` | ONE SENTENCE, SAID ONCE: something a counter or a screen is holding a copy of has moved. (from the title line, to confirm) | 28-platform-and-operations/api-standard |
| `lib/sides.js` | the sides answer (lean · use · impact) | 28-platform-and-operations/sides |
| `lib/signin-contract.js` | the contract of routes/signin.js (/api/signin, all eight routes): each one's OpenAPI operation (S9) and the statuses the handlers write themselves. | 18-identity-sign-in-and-access/sign-in |
| `lib/signin-events.js` | the sign-in log writer: signin_events rows (b282), the ACTIONS / METHODS lists that mirror the migration's CHECK, and flush() | 18-identity-sign-in-and-access/sign-in |
| `lib/signin-lookup.js` | ops.signin_candidates(kind, key) | 18-identity-sign-in-and-access/signin-lookup |
| `lib/signin.js` | ADOPTED engine copy, never edited here (engines release then adopt). SIGNING A PERSON IN. One rule set, no surface, callable from anywhere. (from the title line, to confirm) | (to confirm) |
| `lib/simulator-contract.js` | the contract of routes/simulator.js (3 PUBLIC routes, /api/simulator — the content the /tour page renders, the lead gate, the page feedback): each route's OpenAPI … | qa/offline-guards |
| `lib/sla.js` | THE SERVICE CLOCK. Pure arithmetic, zero dependencies. (from the title line, to confirm) | 03-disputes-service-and-register/service-request-sla-pause |
| `lib/slab-cites.js` | Who cites a tax slab (products by tax_slab, categories by rules.default_slab), and the hand-over to another slab. (from the title line, to confirm) | (to confirm) |
| `lib/source.js` | source-entity operations: register, upload and stamp a source in one transactional call. | 06-catalogue-pim/sources |
| `lib/speech.js` | the speech-to-text seam: which provider this installation has and the one call that turns audio into words | counter/till-routes |
| `lib/starter-fields.js` | what a catalogue in this trade is expected to carry. (from the title line, to confirm) | 06-catalogue-pim/catalogue-read |
| `lib/stock-from-chit.js` | movementsFor · postFor · trackingFor | 13-inventory-stock-and-traceability/on-hand-and-movements |
| `lib/stock-store.js` | stock_movement (append-only log) · stock_balance (the cache): post · issue (FEFO; a retry answered from takenBefore) · rebuild · the ONE readers onHand · asAt · sheet · … | 13-inventory-stock-and-traceability/on-hand-and-movements |
| `lib/stock-sweep.js` | CTR-178: the stock a recorded counter sale took out is never lost for good — a bill with no stock movement is found and posted again | 13-inventory-stock-and-traceability/on-hand-and-movements |
| `lib/stocked.js` | stockedFor (pure) · flagsFor (the ONE read of a product's stock flags: batch_tracked + stocked, per chit or per shelf) · the FIELDS.md line item_data.stocked | 13-inventory-stock-and-traceability/on-hand-and-movements |
| `lib/storage-object.js` | the object-store half of the StorageAdapter: S3 (SigV4) or Supabase Storage REST on built-in fetch, one replicated object per participant, no SDK | 28-platform-and-operations/storage |
| `lib/storage.js` | platform-independent attachment storage (StorageAdapter): per-entity copies of every file, put/get/delete by opaque id inside withEntity, the 6 MB ceiling | 28-platform-and-operations/storage |
| `lib/storefront-contract.js` | the contract of the public storefront doors of routes/catalogue.js (the 11 anyone may call with no sign-in): each door's OpenAPI | 10-online-shop-and-storefront-orders/order-start-confirm |
| `lib/stores.js` | the wholesaler-store contact keyed by phone; phoneKey / phoneMatchKey / phoneTailSql — the phone readers | 11-crm-and-marketing/phone-keys |
| `lib/summary-reclose.js` | the verdict on a summary chit whose reference (SUM/D/<till>/<day>, lib/rollup refOf) the shop already holds: the same figures | 09-counter/day-close |
| `lib/supplies-contract.js` | the contract of routes/supplies.js (5 routes, /api/supplies — what a shop buys to USE): each route's OpenAPI operation (S9), the words its refusals answer in (words), | 16-finance/supplies-routes |
| `lib/supply-store.js` | supply_item and the purchase of supplies (cost and stock only; books_posted is false — R9) | 16-finance/supply-store |
| `lib/supportcopy.js` | the copy of a shop's incident or requirement to our support queue, as a ticket (a chit from the shop to the operator): toOperator never throws, it answers { copied, why … | 25-ai-cb-assist-and-support-desks/support-desks |
| `lib/tax-contract.js` | the contract of routes/tax.js and routes/invoice.js: each route's OpenAPI operation (S9) and the one way their refusals and faults are worded (taxSaid, faultOf). | 15-tax-and-country-packs/tax-compute-rate-invoice-tax |
| `lib/tax-copy.js` | a chit's tax record: its parties (who sells, the seller's price-includes-tax — policy.flagOf with its country), its invoice, the freeze. | 15-tax-and-country-packs/tax-compute-rate-invoice-tax |
| `lib/tax-engine.browser.js` | THE COUNTRY HELPERS (R1). Athi, 2026-10-16: "each country should have its own engine … if there are shared functionalities, (from the title line, to confirm) | (to confirm) |
| `lib/tax-facts.js` | SCHEMES (the registration schemes a shop can state) and taxFactsOf(taxReg, number, flags) | 28-platform-and-operations/country-setup |
| `lib/tax-governance.js` | the tax slabs a COUNTRY declares and the jurisdiction an identity row names (no country -> no jurisdiction -> no slabs, said in NO_COUNTRY_SLABS_SAY) | 07-catalogue-and-pricing/tax-governance |
| `lib/tax-id-door.js` | mayChangeTaxId(req) · taxIdDiffers(stored, sent) · gate(changesIt) (the route middleware) · refusal() (the 403 as problem() takes it) · TAX_ID_ASK_OWNER (the sentence) | storefront-and-catalogue/products-routes |
| `lib/tax-lines.js` | the engine reaches the chit (STUDY-gst-structure-2026-09-04 §6: G1 · G3 · G4). (from the title line, to confirm) | 15-tax-and-country-packs/tax-compute-rate-invoice-tax |
| `lib/tax-packs.js` | ADOPTED engine copy, never edited here (engines release then adopt). a country's tax as data (scheme, supply rule, rate menu, invoice round-off) and the ONE readers of its dated rows: rowAsOf, menuAsOf, rateOnMenu, bandFor, rateInBand … | 15-tax-and-country-packs/tax-compute-rate-invoice-tax |
| `lib/tax-shelf.js` | the tax context for an entity read once per order or send: own live slabs, governed slabs, categories and the face, shared by the storefront and the send path | 15-tax-and-country-packs/tax-compute-rate-invoice-tax |
| `lib/tax-slab.js` | ADOPTED engine copy, never edited here (engines release then adopt). a named tax slab, cited by a product, inherited when it is not. (from the title line, to confirm) | (to confirm) |
| `lib/tax.js` | ADOPTED engine copy, never edited here (engines release then adopt). what a rate becomes between two addresses — the INV-01 invoice (determine), its read-out in the header's names (moneyOf), and the money bridge. | 15-tax-and-country-packs/tax-compute-rate-invoice-tax |
| `lib/team-member.js` | the team test (the shop itself or one of its actors) and the one sentence a refusal carries (BAD_ASSIGNEE, 400, in the error register) | 02-tasks-orders-and-workflow/assign-and-deliver-lines |
| `lib/testboard.js` | the test board as platform data: the one entity that owns the product's own test cases, findings and screenshots, read and written by every testing route | 29-qa-test-tooling-ux-locale-and-design-system/test-board |
| `lib/testing-contract.js` | the contract of the test board's routes (33): routes/testing.js (/api/testing) — each route's OpenAPI operation (S9) and the one way its refusals and faults are worded | 28-platform-and-operations/testing |
| `lib/testnews.js` | SOMEBODY FOUND SOMETHING, AND THE PEOPLE TESTING BESIDE THEM SHOULD KNOW. (from the title line, to confirm) | (to confirm) |
| `lib/teststatus.js` | WHAT STATE IS THIS FINDING IN, ANSWERED ONCE. (from the title line, to confirm) | (to confirm) |
| `lib/their-bill.js` | the one comparison of a supplier's bill total with what was counted (taxable plus tax), giving agrees, round_off, apart, no_total or no_engine and the sentence both … | 03-disputes-service-and-register/three-way-match |
| `lib/till-contract.js` | the contract of routes/till.js (the counter's 41 routes): each route's OpenAPI operation (S9) and the one way its refusals and faults are worded (said, badRequest … | counter/till-routes |
| `lib/till-row.js` | rateOf(value) · taxFactsOf(item_data) (hsn · tax_slab · gst_rate · cess_rate · categories as the engine's one input reads them) · soldPriceOf(item_data) (the sellable … | 09-counter/README |
| `lib/till-summary.js` | the summary statement both GET /api/till/summary and GET /api/facts/till run (one copy), the shop's-year statement and its | 26-reporting-mis-and-bi/trend |
| `lib/trace.js` | the traceability edge in summary_json.trace: unit conversion to a base quantity (toBase) and buildEdge for a handoff | 13-inventory-stock-and-traceability/batch-traceability-and-mass-balance |
| `lib/transcribe.js` | the voice-to-text seam only: isVoice and transcribe() against a self-hosted engine, tagged held until one is configured | 09-counter/voice-listen |
| `lib/trips.js` | HOW MANY TIMES DID THIS ONE REQUEST CROSS THE WIRE? (from the title line, to confirm) | (to confirm) |
| `lib/units.js` | ADOPTED engine copy, never edited here (engines release then adopt). , with factors, which is a larger change than a name. | (to confirm) |
| `lib/upi-waiting.js` | FIN-58 · the shop's ONE system party "UPI waiting" (a UPI part not yet seen to arrive is a receivable from it), its stranger-rule and dues | 16-finance/collections |
| `lib/variant.browser.js` | ADOPTED engine copy, never edited here (engines release then adopt). ONE PRODUCT, MANY COMBINATIONS, AND A NAME FOR EACH ([TILL-76] / CBVariant) (from the title line, to confirm) | (to confirm) |
| `lib/vault-patch.js` | the key rule · the merge · the keyed ↔ array conversion (pure, no db) | 20-settings-governance-and-plan/vault-merge-patch |
| `lib/vaultcrypto.js` | the vault key (VAULT_ENC_KEY), the vault envelope, and the keyed hashes of identity documents (SEC-101) and staff sign-in codes (SEC-106). | 18-identity-sign-in-and-access/identity-documents-and-the-vault |
| `lib/verdict.js` | ADOPTED engine copy, never edited here (engines release then adopt). | (to confirm) |
| `lib/verify.js` | registry verification of IDs: a format check (never called verified) and a registry lookup through a pluggable KYB provider | 21-compliance-attestation-and-trade/know-your-business |
| `lib/versionref.js` | the thing@version form (format, parse, is, keyOf, versionOf, SEP, VERSION) | 20-settings-governance-and-plan/functions |
| `lib/visibility-cap.js` | what an entity MAY choose for catalogue visibility (the cap from operator then plan) against what it DID choose; the effect is the narrower of the two; pure | 06-catalogue-pim/visibility-and-exposure |
| `lib/whatsapp-media.js` | fetching the bytes of a photo a customer sent on WhatsApp (Meta's host only) | 01-rail-core-the-chit/capture |
| `lib/whatsapp-out.js` | the WhatsApp return leg: status replies and group sends, after the consent gate. | 11-crm-and-marketing/whatsapp-out |
| `lib/whatsapp-templates.js` | the approved templates, the only messages that may go out outside Meta's 24-hour window. | 11-crm-and-marketing/channels |
| `lib/work-rows.js` | the team worklist rows (facts, lines, actions per chit). | 02-tasks-orders-and-workflow/everyones-work |
| `lib/workflow.js` | ADOPTED engine copy, never edited here (engines release then adopt). | (to confirm) |
| `lib/workpattern.js` | the work-pattern resolution seam: the sealed ref-block (memoised) plus the live cascade of open knobs | 28-platform-and-operations/connectors-routes |
| `lib/workroute.js` | where work of one kind goes: the routing rung (folder, assignee, notify, team) between the connector and the entity default, and the `why` that says so. | 25-ai-cb-assist-and-support-desks/support-desks |
| `lib/xact-lock.js` | the advisory-lock statement: SELECT pg_advisory_xact_lock(hashtext($1 // '/' // $2)) — the shop, then the key. Postgres releases it when the caller's | 16-finance/xact-lock |
| `lib/xlsx-read.js` | reading ONE sheet of an .xlsx into the { headers, rows } a CSV parses to (first sheet, headers on row 1, text or number cells); own zip reader, no dependency | 06-catalogue-pim/import-export-workbook-preflight |
| `lib/xlsx-write.js` | A WORKBOOK A SHOP CAN OPEN, EDIT AND BRING BACK ([TILL-115]). (from the title line, to confirm) | 06-catalogue-pim/catalogue-read |
| `lib/zip-store.js` | a dependency-free ZIP writer: STORE method, one central directory, plus crc32 | 23-connectors-and-integrations/connector-actors |
| `routes/actors.js` | /api/actors: the shop's people and co-assists — their hats, sessions, breaks and the task hand-over when one goes. | 28-platform-and-operations/people |
| `routes/adopt.js` | taking a supplier's delivery into the buyer's own catalogue. | 03-catalogue/adopt |
| `routes/assist.js` | the assistant proxy and the brand's catalogue-source authoring. | 28-platform-and-operations/assist |
| `routes/attachments.js` | the two doors above. The copies themselves (one row per participant, the bytes in object storage or the row) are lib/storage.js; the words of a refusal and the limit … | 01-rail-core-the-chit/README |
| `routes/books-events-batch.js` | POST /api/books/events/batch: the door only (gates, 400/409 answers, the receipt in the body) over lib/books-events-batch | 14-accounting/ledger-accounts-day-book-entries-reverse |
| `routes/books-money.js` | POST /api/books/money-check/resolve { chit_id, how, note? } — a sale the owner let through although the engine's money did not add up is an item on the books to-do … | 14-accounting/README |
| `routes/books.js` | /api/books: the ledger's reads and the period-end writes, every refusal a code + a sentence (fail), never a 500 of prose. | 16-finance/books-routes |
| `routes/capture.js` | the intake inbox and channel adapters (web simulate, webhooks). | 11-crm-and-marketing/capture |
| `routes/catalogue-face.js` | /api/catalogue-face: this entity's saved catalogue setup (read, and save whole, refusing a declaration the catalogue cannot enforce) | storefront-and-catalogue/products-routes |
| `routes/catalogue.js` | the public storefront routes (catalogue, order start / confirm, buyer login) and the signed-in ones (the shopper's own orders and documents, product enquiries, the … | 10-online-shop-and-storefront-orders/order-start-confirm |
| `routes/channels.js` | Settings › Channels: bindings, templates and the platform approval. | 11-crm-and-marketing/channels |
| `routes/chit-proposals.js` | the doors of the proposal mechanism on a chit: list · propose (the seller's pro-forma / change, or a buyer's request) · accept · reject · counter | 01-rail-core-the-chit/chit-proposal |
| `routes/chits-trace.js` | the trace routes of /api/chits (owner area 13, traceability) — GET /:id/children · GET /:id/trace · GET /trace/batches · GET /trace/by-batch · GET /trace/networks — | 01-rail-core-the-chit/chits-routes |
| `routes/chits.js` | the chit routes — send (the fan-out of co-held copies), the lists (inbox · sent · folder), the read (GET /:id with the | 01-rail-core-the-chit/chits-routes |
| `routes/combo-templates.js` | yet) — only to PUSH a NEW product from it (see /:id/push below). null/undefined both mean "none yet". */ | 07-offers-pricing-and-combos/combo-templates |
| `routes/connections.js` | /api/connections: one business asks another to connect, the other answers, and each lists the connections it has (request · respond). | 04-network/connections-and-invitations |
| `routes/connectors.js` | the 14 connector routes (/api/connectors): make one · its connections · its key · health · and the two doors a device and an ERP agent call with their own key. CALLED … | 28-platform-and-operations/connectors-routes |
| `routes/counters.js` | a counter; it HOLDS one while it is open. Opening mints a till key bound to the counter; closing (from the | 09-counter/counters-and-keys-pair-enrol-open-release |
| `routes/crm.js` | the 24 routes of /api/crm: the one party list (read, record, timeline), follow-ups, the call desk, leads and their import, the walk-in, consent rows, privacy requests, | 11-crm-and-marketing/crm-routes |
| `routes/csp-report.js` | the report door | 28-platform-and-operations/limits-idempotency-rate-limits |
| `routes/ctp.js` | (to confirm) | 05-ctp-and-cross-installation/deliver-query-across-domains |
| `routes/definitions.js` | an entity's own named things: pack models ("Carton of 6"), tax slabs, categories - every edit writes a version | 07-catalogue-and-pricing/definitions |
| `routes/entities.js` | every route under /api/entities (25): register · verify · constitutions · search · header · sides · me · policy · prefs · exposure · profile · routing · populations · … | 28-platform-and-operations/entities-routes |
| `routes/events.js` | the three routes of the mailbox bell: a one-time ticket, the live stream opened with it, and the operator's connection counts. The frames are lib/events.js. | 22-channels-capture-and-messaging/notifications-and-the-bell |
| `routes/facts.js` | /api/facts: what each Home card says (lines, figures, state) and the chits behind the rail's In · Out · Stuck. | 28-platform-and-operations/facts-route |
| `routes/folders-inbox.js` | GET /messages (the inbox and its ?count=1 badge) · POST /messages/:message_id/mark · GET /worklist. | 01-rail-core-the-chit/folders |
| `routes/folders-totals.js` | GET /groupsum · GET /reconcile · GET /mis: what a pile of chits adds up to, whether the folders add up to the track, and the MIS view. | 01-rail-core-the-chit/folders |
| `routes/folders.js` | /api/folders: a per-entity tree for filing any chit, a folder's chit list (paged; a cut list says so), its metrics and its rules. | 01-rail-core-the-chit/folders |
| `routes/forms.js` | the eight routes of /api/forms: the registry of forms, a free fill (resolve), issue (freeze), the issued forms, sign and attach to a chit | 21-compliance-attestation-and-trade/functions |
| `routes/governance.js` | protected entity, constitution, readiness passport and clearances. | 21-compliance-attestation-and-trade/governance |
| `routes/health.js` | the health answer: status, version, the database state (E07) and the process counters (audit lost, money mismatches, output keys dropped, legacy tokens). | 28-platform-and-operations/api-standard |
| `routes/identity-docs.js` | the four /api/identity routes: a person's own document list (mask and verdict, never the number), filing one document, and the code that confirms a phone or e-mail … | 18-identity-sign-in-and-access/identity-documents-and-the-vault |
| `routes/integrations.js` | the connector catalogue and kit downloads. | 28-platform-and-operations/integrations |
| `routes/invoice.js` | /api/invoice: the invoice as a service — build the whole pipeline in one call, read the invoice of a chit. | 15-tax-and-country-packs/tax-compute-rate-invoice-tax |
| `routes/keys.js` | API keys for other systems: mint (owner only), list, revoke. | 18-identity-sign-in-and-access/keys |
| `routes/kyb.js` | the "Know your business" value panel. Sections 1-3 are computed from owned data → FREE (SELECTs over (from the title line, to confirm) | 21-compliance-attestation-and-trade/know-your-business |
| `routes/marketing.js` | the Marketing results route. CALLED BY web Marketing › Who came back (public/app/cap-marketing.js). | 12-marketing/README |
| `routes/network-design.js` | /api/network-design: the saved drawing (get · put), the check (validate), the build and re-issue of a claim code, and the two reads of the network (availability · … | 04-network/network-design-builder |
| `routes/network-offers.js` | a brand's network offers: release to the stores, withdraw, what each store holds | network-and-trade/network-offers |
| `routes/notifications.js` | the Activity feed of the bell and its three routes: the feed with its badge (GET /), the watermark (POST /seen) and the dismissals (POST /dismiss). No notifications … | 22-channels-capture-and-messaging/notifications-and-the-bell |
| `routes/offers.js` | (to confirm) | 07-offers-pricing-and-combos/offers-engine-as-service |
| `routes/openapi.js` | the assembled /api/openapi.json (fragments + the Problem schema). | 28-platform-and-operations/api-standard |
| `routes/people.js` | GET /api/people: the shop's people for the Employees app, with what this login may do to each. | 17-people-employees-hr-and-payroll/people-list |
| `routes/preflight.js` | the preflight reply. The ALLOW-LIST ITSELF (corsOptions) stays in server.js with its long reasons; server.js hands it over once: … | 28-platform-and-operations/api-standard |
| `routes/pricing.js` | /api/pricing: the pricing structure as a service — the kinds of structure, and the unit price of each line at its quantity. | 28-platform-and-operations/pricing-service |
| `routes/privacy.js` | the ONE public privacy answer (web docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md K1 · K9 · K11), and the shopper's own. (from the title line, to confirm) | 11-crm-and-marketing/privacy-consent |
| `routes/products.js` | the products door: list · search · create · bulk · update · retire · import · export · schedule · media · versions · starter columns · ready-made lists | storefront-and-catalogue/products-routes |
| `routes/quick-keys.js` | the nine Level-1 quick-key routes (/api/quick-keys): the manager's groups, their keys and order, and the shop-wide screen default. | 28-platform-and-operations/quick-keys-routes |
| `routes/relationships.js` | supplier list, customer list, promotions and the counterparty scorecard. | 11-crm-and-marketing/relationships |
| `routes/repeat-supply.js` | /api/repeat: the agreement's 14 routes, over lib/repeat-supply (the rules). CALLED BY the Orders and Collections screens, the customer's agreement page, the nightly … | 12-suppliers-and-procurement/repeat-supply |
| `routes/schemas.js` | the six routes of the catalogue's schema engine: the shop's definition, its columns (read, remove, retype, reorder) and the definition's visibility | 07-catalogue-and-pricing/catalogue-setup |
| `routes/service.js` | the seven service clock routes of a chit (read, start, respond, resolve, pause, end, answer) and their plain answers when an id, a time or a text value is not valid. | 03-disputes-service-and-register/service-request-sla-pause |
| `routes/signin.js` | every route under /api/signin (8): renew · logout · sessions · devices · sessions/revoke · ask · verify · pin, and the handler functions the old paths … | 18-identity-sign-in-and-access/sign-in |
| `routes/simulator.js` | the three PUBLIC routes of the /tour page (no sign-in): the content it renders, the lead gate, the page feedback. | qa/offline-guards |
| `routes/supplies.js` | /api/supplies — what a shop buys to use (sundries): list · add · purchase · issue | 16-finance/supplies-routes |
| `routes/tax.js` | /api/tax: the invoice for a chit, the month's ledger, the GSTR shapes (read-only; nothing here files) and the tax engine as a service (rate, compute). | 15-tax-and-country-packs/tax-compute-rate-invoice-tax |
| `routes/testing.js` | the test board (the 33 routes of /api/testing): cases and their import, results and runs, JUnit and Gherkin, the CMDB, requirements, incidents, changes and releases … | 28-platform-and-operations/testing |
| `routes/till.js` | the counter's 41 routes under /api/till: the whole-shop snapshot, the small decisions made standing up (stock, price, flags, offers, rewards), | counter/till-routes |
| `routes/work.js` | (to confirm) | 02-tasks-orders-and-workflow/everyones-work |

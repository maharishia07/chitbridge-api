/**
 * guards-list-1.cjs — PART 1 OF 3 OF THE OFFLINE GUARD LIST (moved out of scripts/guards.cjs, 22 Nov 2026, filesize ratchet: a new file stays under 500 lines).
 *
 * OWNER     cb-qa
 * OWNS      GUARDS_PART: 455 consecutive entries of the declared offline list, in run order (first: reviews1-invoice-discount-dp.test.cjs). Add a guard to the LAST part (guards-list-3.cjs), the day it becomes true, not before.
 * CALLED BY scripts/guards-list.cjs (joins the three parts, order kept) · tests that read the list as text: every-test-is-enrolled, junit-board, filesize-ratchet, readability-guard, junk-fuzz, sec-75-entity-schemas (via tests/support/guards-list-text.cjs).
 * FLOW      guards-list.cjs requires this file ──▶ one array, no entry changed ──▶ scripts/guards.cjs ──▶ scripts/guards-run.cjs
 * CARD      qa/offline-guards
 */
'use strict';
const GUARDS_PART = [
  'con-165-firm-reads-parties.test.cjs', // CON-165: a firm seat under a books grant reads the client's parties cut to names, numbers, terms and dues (offline)
  'crm-259-261-search-and-page.test.cjs', // CRM-259/261: the list's ?q search and its 500-row page with { total, page, limit, next } (offline over crm-stub)
  'reviews1-invoice-discount-dp.test.cjs', // reviews1 GF4: an invoice discount rounds in the invoice's own currency (JPY 0 dp)
  'reviews1-trace-batch-errors.test.cjs', // reviews1 EL F8: a lot recall rethrows a failed read, answers no rows only for a missing table or column
  'reviews1-bill-steps-quiet.test.cjs', // reviews1 counter M6: a failed fact read is logged, the fallback stands
  'reviews1-boolean-words.test.cjs', // reviews1 EL F1: one boolean reader for is_draft / is_dispute / chit_wide / priority-flag
  'lv05-held-pay-out-and-todo.test.cjs', // LV-05/06: owner-approves refuses a Bookkeeper payment out; the To-do lists held entries only to the owner (real Express)
  'seats-label-hat.test.cjs',
  'pay-out-gate.test.cjs', // AK-F-02 + 22 Nov item 5: the Bookkeeper/Accountant label sets the manager hat (lib/access.labelHat) · lib/pay-out-gate.js unit — only the owner pays out, the accountant and a counter seat record money in only, stored direction read for propose/confirm, a failing read closes the door
  'seat-matrix.test.cjs', // AK-F-02 (22 Nov): docs/SEAT-MATRIX.md is what the gates say (tools/seat-matrix.cjs), the contract's staff seats agree with them; a counter never pays a supplier
  'lv12-ai-skill-prototype-names.test.cjs', // LV-12: constructor / __proto__ / prototype are not skills (getSkill + POST /ai-draft, real route)
  'lv13-assist-container-gates.test.cjs', // LV-13: PUT /assist/container and /region-override are the owner's or a platform operator's; an ownerless container's override is the platform's
  'ak-f02-seat-gates.test.cjs', // AK-F-02: manager hat runs pack, FX and pays out; the counter seat records money in only (real Express, in-memory ledger)
  'seat-home.test.cjs', // UX-221: what /me tells Home to hide = the gates' answers
  'ux226a5-till-door.test.cjs', // UX-226 A5: the till's snapshot door refuses the Bookkeeper seat
  'seat-grant-text.test.cjs', // UX-222: a grant's promised abilities = the gates' answers (the text is written from the ability names)
  'ux217-me-shop-facts.test.cjs', // UX-217: a seat's GET /me carries the shop's name, tax number and address beside its own row
  'ak-f03-reopen-hard-month.test.cjs', // AK-F-03: the owner opens the newest hard-locked month with a reason (unlock and reopen), one audit row; an older month stays shut
  'identities-column-grant.test.cjs', // SEC-186 (21 Nov): every identities column added after b875 is granted to cb_app in the same or a later migration (b900 broke sign-in on a column-revoked DB)
  'b911-signin-link-bind.test.cjs', // GF-platform-01 M2 (22 Nov): b911 binds a provider link's identity to its entity; DB proof tests/b911-signin-link-bind.proof.sql
  'c11-10b-rail-shape.test.cjs', // C11 10b: send names an unread price key, refuses a bad line_id, bounds retention, the one writer refuses a figure past its column, CTP_UNRESOLVABLE answers 503, cost needs a currency, list filters read before a cast, UTF-8 attachment names
  'books-1126-units.test.cjs', // batch 1126: the received payment advice, the moved wages role and the country setup questions, unit by unit
  'pages-parse.test.js', // every inline script in app.html, till.html and promo.html parses
  'endpoint-usage.test.cjs', // janitor (23 Oct): the wide endpoint run: a comment is no call, a dynamic segment meets only a :param, a bucket follows its best evidence
  'till-vendor.test.js', // the counter and its vendored engines agree, byte for byte
  'amend-live-set.test.cjs', // RAIL-128: b138 liveSet / liveLines / shape check (scripts/prove-amend.js), pure, no DB
  'till-who-signin.test.cjs', // R132: a picked name carries who they are (PIN or first code, never "type your ID"), the refusal names what to use, one PIN ask, no "connect to a shop" under a signed-in box
  't3-fixes.test.cjs', // T3-FIXES: one cost gate on every price write · each received batch its own lot · profile writes the shop · sign-in keeps the constitution
  'till-rcv-batches.test.cjs', // STK-FIX1b: at the till a second scanned batch of the same product is its own receiving line (rcvLineFor), never merged onto line 1
  'governed-currency.test.js', // RAIL-63: network and storefront chits take the shop's own currency, never INR by name; a non-monetary chit carries none
  'governance-entity-own.test.cjs', // SEC (23 Oct): a shop's governance view is its own; another shop's id answers the unknown id's 404
  'shop-clock-guard.test.cjs', // ⭐⭐ Y1: one shop clock — no raw new Date()/Date.now() in the ledger files; set/advance/reset proven
  'register-sums.test.cjs', // W4 (30 Oct): the endpoint count cannot drift — register total = Σ route files = Σ API groups, each exception a named row
  'register-route-helper.test.cjs', // API-11 (7 Nov): the register sees routes registered through the shared route() helper (books period-end), with their real line
  'natdef-guard.test.cjs', // ⭐ T2-NATDEF: zero `|| 'INR'` / `|| 'IN'` (lib · routes · till master); one date reader (books-engines ymd · addDays), NOW labels allow-listed
  'shop-day-tz.test.cjs', // ⭐⭐ M210: a midnight sale lands in the SHOP's day on every server clock, before and after b299; Sydney across DST
  'realstack-shop-day.test.cjs', // ⭐ tzsweep 18 Nov: a realstack never reads the UTC day as a shop's business day (R1-03 red 18:30–24:00 UTC); one source tests/lib/shop-day.cjs
  'line-rules.test.cjs', // RAIL-133 (e): the line-model rules that had none — a delivery row's check, progress arithmetic (mine is the headline, other units beside, adds never delivered, pending ≥ 0, agree/divergent/unacknowledged), an assignment's check and bounds, a person's done ≠ the events' done
  'ctp-manifest.test.cjs', // RAIL-140 (a): the manifest names THIS installation — our configured key, decorated only by our own row, never another active row's key
  'ctp-manifest-fetch.test.cjs', // RAIL-140 (c): a peer's manifest is read within the 5 s deadline, body included, and capped at 64 KB in BYTES as they arrive (a real local server; ~5 s)
  'till-t2a.test.cjs', // round T2a: bills-only count, an online order billed, the mode menu, no 403 on quick-keys/hidden
  'till-fix2.test.cjs', // ⭐ TILL-FIX2 (review H5 M6 L4): a reward queued behind its bill and carried by a renumber · one series lock, no duplicate number · the close's last SALE by series number
  'till-shippable.test.cjs', // the installable till carries only modules with no database behind them
  'catalogue-blueprint.test.js', // two trades, one axiom, and a product sequence that cannot collide
  'backup-guard.test.cjs', // ⭐⭐⭐ BKP1: no workflow uploads a plaintext dump; backup.sh refuses without a passphrase; the nightly is never in this public repo
  'pathfix-grants-list-columns.test.cjs', // wave 7b: GET /api/books-grants names its identities columns (no to_jsonb(i), no schema probe)
  'identities-no-whole-row.test.cjs', // SEC-186: no whole-row identities read (row JSON, star selects) - cb_app has column-level SELECT only
  'drift-29-me-shop-row.test.cjs', // DRIFT 29: /me gives an actor the SHOP's clock/currency (parent row), not the person's
  'drift-35b-party-phone.test.cjs', // DRIFT 35b: one party phone rule (party-fields.phoneOf), CRM list = customer list
  'drift-21-lead-may.test.cjs', // DRIFT 21: lead.may carries the seat write verdict (viewer greyed, not offered then refused)
  'spin-scripts.test.cjs', // ⭐⭐ HX2: the cloud spin scripts — one env list (HOSTING.md), tagged, India by default, no secret printed
  'hosting-neutral.test.cjs', // ⭐⭐ HX1: the DB password goes only to configured URLs; SigV4 = AWS's examples; no platform host in shipped code
  'records-keeping.test.cjs', // ⭐⭐ CO3: the books' edit trail cannot be disabled (Rule 3(1)); no copy expires inside the 9-year records floor
  'fx-dates-tz.test.cjs', // ⭐ a rate's day is the same on every server (India · Sydney · UTC · LA) — fx-rates reads dates with books-engines ymd
  'till-country-bill.test.cjs', // ⭐ the counter bill in IN · AU · AE: fmtCount by money, tax words per pack (api #163; on the board since the 14 Oct rebuild)
  'till-country-slip.test.cjs', // ⭐ TILL-B2: the slip per country — IN byte for byte, AE Arabic + English, JP per rate + ※, SG, US without an EIN, AU 5c cash rounding → books round-off
  'identity-country.test.cjs', // ⭐⭐ GOV-AU1 (b376): every INSERT INTO identities names its country; no reader answers India for NULL
  'vault-patch.test.cjs',
  'keys-kinds.test.cjs', // SET-WALK1 W15: the key kind 'testing' is offered to and minted by the platform role only (GET /keys scopes · POST 403 NOT_PLATFORM)       // ⭐ SET-WALK1 W25: the vault PUT is a merge-patch (RFC 7386 over the keyed view) with a version — 409 VAULT_CHANGED in words, never a blind replace
  'policy-one-writer.test.cjs', // ⭐⭐ T2-POLICY: policy_flags written only by policy.patchKey (22 → 0); the shop's tax number/address only by profile's one writer (3 → 0)
  'cat124-reference-store-lists.test.cjs', // ⭐ CAT-124 C1+C2: the Product Lab's six cards come from the six reference stores (fallback to the constant where unloaded)
  'vertical-resolver.test.cjs', // ⭐ VERT-1/VERT-8: ONE answer to the shop's trade (govresolve.verticalOf); the five readers ask it; the Price Lab opens on the trade's list
  'trade-srv1.test.cjs', // ⭐ TRADE-SRV1: AU/AE lanes (b538), origin/sector stated or ASKED (never IN/paint), ?abroad=1, papers by deal, the day's rate, may/why on trade writes
  'money-m13-ctry.test.cjs', // ⭐ CTRY-20 + CTRY-29 (M13): profile-map jurisdiction layer, AU shop never INR, ABN modulus-89 check; kyb risk by_currency one group per currency, null/zero/no-currency stated in excluded
  'profile-write-gate.test.cjs', // ⭐ SEC-71: PUT /profile, PUT /profile/vault, PATCH /entities/profile sit behind lib/access.writeGate — a viewer/commenter is refused with the rail's sentence, owner and editor pass
  'write-route-gate.test.cjs', // ⭐ SEC-72: every write route is gated (writeGate), behind auth (hat-gate fails closed), or allow-listed with a reason — a new public/viewer-writable write route fails here
  'migration-numbers.test.cjs', // ⭐⭐ one number, one migration — two parallel rounds both wrote b299 (12 Oct); a clash fails here
  'ctr226-quick-key-audit-action.test.cjs', // CTR-226: every audit action the quick-keys code writes is allowed by quick_key_audit_action_check (baseline + b856)
  'acc336-s1-migrations.test.cjs', // ACC-336 s1: b849/b850 codes match the engines pack, re-runnable, delete nothing (9 Nov)
  'co2-controls.test.cjs', // ⭐ CO2: a critical line reaches CB_ALERT_WEBHOOK; state_log append-only (b315) — the Standards register's evidence
  'privacy.test.cjs', // ⭐⭐ CO1 + MKT-SRV1: consent rows append-only; every verdict has a code; an out call / offer / WhatsApp without consent refused with it
  'consent-senders.test.cjs', // ⭐⭐ CO1-GATE: every provider send in lib/ routes/ asks lib/privacy.gate, or is EXEMPT with its reason
  'engines-pinned.test.js', // ⭐⭐⭐ every adopted engine is EXACTLY its chitbridge-engines release — no hand edit survives
  'engine-calls-exist.test.cjs', // ⭐ EGM-T1: the api never calls an engine function its VENDORED copy lacks (the landing trap: tax-lines read gstReturns.zeroWordOf before the engines tag was adopted); red until the adopt lands
  'money-round.test.js', // one rounder (0 wrong in 1.74 M cases, per-currency decimals) and one price reader
  'google-availability.test.cjs', // one output shape: status → Google Merchant availability; nothing Google does not define (M53)
  'one-rounding-rule.test.cjs', // ⭐⭐⭐ no platform-owned file carries a second copy of the rule; cart/pick pages load money.js first; the kit carries it (2026-09-28)
  'engine-versions.test.cjs', // ⭐⭐ a counter reports which engine release it bills with — /api/state, the snapshot call, its key (2026-09-28)
  'till-origin.test.cjs', // ⚠️ written 2026-09-28 with the one-gate rebuild and NOT added here the same day — a guard nobody runs. · ⚠️⚠️⚠️ only the counter's own page may write to the shop-PC program (critic C1)
  'counter-gates.test.cjs', // ⭐⭐⭐ ONE door to a shop (becomeShop), ONE for a person (sign-in, offline PIN), lock/break = that sign-in
  'tdz-guard.test.js', // ⚠️ "A GUARD NOBODY RUNS" (BACKLOG, 2026-09-18) — the suite ran it, the gate never did. Added 2026-09-28. · no const/let read above its declaration in the same function (node -c cannot see a TDZ)
  'gorilla-lib.test.cjs', // the gorilla generator: one seed is one run, one record replays alone, every failure carries its replay line (COLUMN-13 §4a)
  'truth-harness-partner.test.cjs', // LIFECYCLE-B4: the harness's order() and invoice() — a buy order, an invoice that names its order, item_id on every line
  'acc-377-foreign-invoice.test.cjs', // ACC-377: the foreign rail invoice, the bank's rate, INR vs an AUD bill, the accept's waiting sentence · ⭐⭐ T2-SPLIT (2026-10-14): the giant handlers became named steps — the ratchet, and the golden masters that prove nothing moved
  'fn-size.test.cjs', // no NEW function over 80 lines in lib/ routes/ (the list may only shrink); worst complexity never rises
  'fn-size-adopted.test.cjs',
  'text-of-ratchet.test.cjs', // FUZZ-8 (18 Nov): no new String(req.body|query) read; textOf is the one door (docs/contracts/text-of-ratchet.json)
  'filesize-ratchet.test.cjs', // MNT-58 (14 Nov) filesize-ratchet: no file grows past filesize.baseline.json, new file at most 500 lines (web tool from the twin);  fn-size skips ADOPTED engine files (header on line 1 only); hand-written code still counts
  'touched-routes.test.cjs', // MNT-30: the touch rule for routes (report in warn mode until the switch date): touched = new or hash moved, 13/13 counted, fail mode fails below 13/13
  'books-mis.test.cjs', // MIS A3/A4: GET /overview deep-equals the page each figure comes from (P&L · Dues · cash 30 days · soldTotals), unknown period 400, absent never 0, cost-blind seat
  'books-tb-compare.test.cjs', // TBCMP: trial balance and balance sheet carry last year, change and the ASA 520 flag (hand figures, AU shop, in-memory ledger, cost-blind seat) (enrolled 17 Nov, coverage hygiene)
  'doors-flags-commenter.test.cjs', // DOORS: the real hat gate lets a commenter seat (auditor) use every /api/flags write; a viewer stays shut (enrolled 17 Nov, coverage hygiene)
  'jet-day-book-risk-keys.test.cjs', // JET: every Day book entry carries recorded_at, made_by, no_narration (read-only, hand-computed) (enrolled 17 Nov, coverage hygiene)
  'private-flag.test.cjs', // private bookmarks and notes (b876): words, caps, shape, contract lists exactly the router's routes, one subject list (offline) (enrolled 17 Nov, coverage hygiene)
  'rank10-baseline-commenter.test.cjs', // RANK 10: the exact baseline door (Mark as checked) opens for a commenter seat and nothing next to it (enrolled 17 Nov, coverage hygiene)
  'books-dues-core.test.cjs', // MIS A2: /dues answers byte for byte as before the dues read moved to lib/books-dues.js (golden test, customer · supplier · finance · asOf · cost-blind)
  'books-report-period-week.test.cjs', // MIS A0: periodOf week + mtd, priorOf how:'week' (week 53 has none), yoyDates unchanged over 8 years x 12 FY months
  'books-sold-totals.test.cjs', // MIS A1: soldTotals is ONE statement over the one SOLD fragment, bounds as parameters (the real-SQL equality with soldByDay: tests/books-sold-totals.realstack.cjs)
  'readability-guard.test.cjs', // ⭐⭐ READ-GUARD (DISCIPLINES §6, 15 Oct): ONLY the code this change touched — hard limits · new cryptic name · empty catch · header · CARD · trace row · readability.ratchet.json (the web's tools/readability.cjs, from the twin checkout)
  'send-golden.test.cjs', // POST /chits/send: 40 scenarios, every SQL · copy · hook · answer = the trace frozen before the split
  'network-build-golden.test.cjs', // POST /network-design/build + /validate: 18 scenarios, the same
  'deliver-trace-golden.test.cjs', // deliver-lines · the trace walk · by-batch: 18 scenarios, the same
  'ctp-tolerant-reader.test.cjs', // RAIL-126 b: CTP inbound is a tolerant reader — a higher minor of our major is read, unknown fields ignored, another major refused CTP_VERSION_UNSUPPORTED
  'rail126-send-typed.test.cjs', // RAIL-126 (a), S33-T: POST /send types every key it names; an unknown key is ignored, a junk value in a known key is a 400, every real caller's key still goes; part (b) untouched
  'ctp-door.test.cjs', // every refusal at CTP's receiving door (/deliver, /query) — status and words, nothing written
  'ctp-arrival-copy.test.cjs', // R3-03: the receiving door sets direction, role, status and the first log row itself and drops the owned business_json keys; a hostile copy is born as a local send is born
  'network-door.test.cjs', // PLT-45/RAIL-97: the pass at CTP's door — a member/master accepts a chit only with a certificate signed by the PINNED key (lapsed, revoked, wrong key, copy: refused in words); the master's questions; standalone unchanged
  'network-cert.test.cjs', // PLT-45: the second key slot (CB_NETWORK_ROOT_KEY), the certificate (seal, bind, in date, 10-minute lapse), the cb<scope><nn>-root handles, the network wants
  'network-sync.test.cjs', // PLT-45/RAIL-96: the pulls — certificate and directory only if signed by the pinned key; registry by sequence, ids only, resync on a gap; locate verified at the far domain
  'network-tools.test.cjs', // PLT-45: the operator's three tools (network-cert · network-seed-root · network-sync) refuse in words, with their exit codes, before any write
  'installer-token.test.cjs', // PLT-45: the installer's one-time token through the one verify: its handle only, before any registered business is active, fail-closed
  'ctp-ssrf-guard.test.cjs', // SEC-80: CTP outbound fetches refuse non-https and any private, loopback, link-local or CGNAT address (DNS stubbed)
  'mint-ctp-refusal.test.cjs', // RAIL-129: a refused crossing or a crossing draft is a 409 in words (lib/knownerr), the far end's why never in the sentence, nothing local written
  'products-safe-errors.test.cjs', // SEC-83: products.js sends no raw error text; a 5xx 'Bad status' gets the safeErr line
  'chit-status-check.test.cjs', // ⚠️ both red since b250/b262/b264 and outside the gate — accepted with docs/drafts/fk_b250_b262_b264_draft.sql waiting (2026-09-28) · b773's CHECK list equals the rail's status list (DB-72)
  'migration-lint.test.cjs', // no NEW migration hides a FOREIGN KEY inside CREATE TABLE IF NOT EXISTS
  'schema-lint.test.cjs', // ⭐⭐ SCHEMA-LINT (assessment 2026-10-16): a NEW migration indexes its FKs, FORCEs its RLS, uses timestamptz and no national default, keys its once-only facts, and applies on an empty database — baseline shrinks only
  'rls-census-from.test.cjs', // DB-1 (19 Oct): rls-census --from reads Athi's editor paste with the same verdicts as a live read
  'fresh-db-check.test.cjs', // SCHEMA-FIX1: the empty-database verdict — a new failing migration fails, an accepted one that passes leaves the list
  'entity-cast-guard.test.cjs', // no NEW RLS policy casts an unset current_setting straight to ::uuid
  'sec-fix2.test.cjs', // ⭐⭐ SEC-FIX2 (review 2026-10-15): media/image server-owned + owner-prefixed object keys (C4) · the network store reads the edges, its order needs a flag and a customer (C6) · assist writes behind auth (M3) · key revoke owner-only (L1) · no raw error text as why (L2) · ⚠️ a guard nobody ran: the access gate for co-assists was never in this list (found 2026-09-28)
  'hat-gate.test.cjs', // ⭐⭐ a View-only/Comment-only co-assist cannot write; asking /assist is open, its five writes are not
  'access-events.test.cjs', // the IAM audit trail never invents a change, and a lost row is SAID (review 2026-09-25)
  'notifications-count.test.cjs', // ⭐⭐ the badge's number is ONE withEntity statement over the feed's own rows (M7, 2026-09-28)
  'supplier-list-scope.test.cjs', // ⭐⭐⭐ every supplier_list statement runs inside withEntity — ready for FORCE RLS (H2, 2026-09-28)
  'mint-product.test.cjs', // INT7d-GREEN: lib/mint-product — stamped in the entity currency, one INSERT, a SERVER_OWNED refusal keeps its code and writes nothing
  'check-db-role.test.cjs', // INT7d-GREEN: scripts/check-db-role — no DATABASE_URL → exit 2 in words, unreachable → exit 1, the verdict is lib/db-role's
  'server-boot.test.cjs', // INT7d-GREEN: server.js boots offline; /health 200; a stranger refused 401; unknown route JSON; the boot preflight runs first
  'one-writer.test.cjs', // ⭐⭐⭐ T2-WRITERS: one product writer, one task-count writer, one OTP door, one add-customer — zero outside each
  'knownerr.test.js', // a refusal the database makes on purpose (b247) reaches a person as a 409, from every route that writes a chit
  'xlsx-read.test.js', // an Excel file read into the shape a CSV makes, and refused in words otherwise
  'xlsx-write.test.js', // a workbook Excel will open — every part it needs, and a code keeps its leading zero
  'write-limits.test.js', // a door that writes many records per request is rate-limited, and keyed by the key
  'categories.test.js', // a product CITES its category; nothing writes the legacy single-category key
  'till-agent-says.test.js', // the desktop counter names a wrong key as a wrong key, never as an outage
  'till-shop-folder.test.js', // one folder per shop per server — a test bill never lands in the live takings
  'fable-r4-till-drain.test.js', // Fable risk 4 T4-02: the shop-PC drain removes only the lines it sent; a bill rung during the sends is never erased
  'rollup.test.js', // day/week/month: a return is not a sale, and folding equals summarising
  'verdict.test.js', // one cause, one sentence, one button — the message has a single home
  'counter-claim.test.js', // one counter, one holder — two PCs on C1 fork the bill numbers
  'ctr-208-enrol-race.test.cjs', // CTR-208: the enrol that lost a race is refused 409 COUNTER_HELD and its key closed (the real race: ctr-208-enrol-race-truth.realstack.cjs)
  'till-watch.test.js', // the watch list names real gates — a row with no gate watches nothing
  'orders.test.js', // the order rules, run with no browser — the proof they left the page
  'dayopen.test.js', // ⭐⭐ the morning: who, products, the counter number, the drawer — [TILL-182]
  'qty.test.js', // ⭐⭐⭐ the factor table LEFT the page — [TILL-186]
  'scalecode.test.js', // ⭐⭐ a scale's label: which vegetable, and how much of it — [TILL-185]
  'signin.test.js', // ⭐⭐⭐ a PERSON signs in — user id or email, and no session at a counter
  'identity-auth.test.js', // ⭐⭐⭐ [capability: sign-in] the ONE lookup and ONE verify — entity or coassist, OTP or PIN
  'orderhub.test.js', // ⭐⭐⭐ one floor, several devices, no internet — [TILL-178b]
  'till-hidden.test.js', // [hidden] must win — a class that sets display draws a closed panel anyway
  'till-exits.test.js', // every screen has a lid, and it never sits in a row of ways to CHANGE things
  'tax-lines.test.js', // ⭐⭐ the month's ledger and GSTR: a credit note REDUCES tax; cdnr · cdnur · b2cs netting · Table 13 (2026-09-28)
  'walk-in-buyer.test.cjs', // ⭐⭐ BUY1: a buyer with no country / place of supply is taxed INSIDE the shop (tax-lines.walkIn) — AU 10% · AE 5% · IN intra; a foreign buyer stays export
  'round-trips-all.test.cjs', // ⭐⭐ every route the web client calls has a round-trip budget (round-trips.budget.json) — fired offline, I19 (DB10)
  'live-trips-writer.test.cjs', // SPD-39: the live-count writer never lowers or raises a fired line, refuses an unbudgeted route, keeps the flags
  'live-trips-tool.test.cjs', // SPD-39: the live-trips harness restores sit-in when a run throws (fake client, offline)
  'round-trips-volume.test.cjs', // ⭐ SPD-17: the verdict of the volume check (a new N+1 fails, trips and p95 never pass the baseline) on made-up numbers, no DB
  'read-batch-entity.test.cjs', // EFF-TRIPS: readBatch carries a statement per entity in ONE trip (the brands' released offers)
  'network-offers-shape.test.cjs', // EFF-TRIPS: GET /api/network-offers answers the pre-change shape row for row, in ≤ 4 trips (golden)
  'network-offers-visibility.test.cjs',
  'network-offers-choice.test.cjs', // NET-98: POST /:id/choice answers 404 for an offer the shop cannot see (unknown, another network, withdrawn) and writes nothing; a stale record is still cleared // SEC-134: GET /api/network-offers tells each caller only its offers and carries no unnamed column (two networks, member, outsider, brand)
  'people.test.cjs', // ⭐ P1: GET /api/people — one statement, the caller's shop only, may/why per action, owner-only greyed with its sentence
  'network-validate.test.cjs', // P2: the dry-run validate of a designed network — names what would break, posts nothing
  'sim-load.test.cjs', // ⭐⭐⭐ Y1b: the simulator's loader refuses every non-local database; one plan for Y1 and Y1b; the chit carries the shop clock
  'round-trips-till.test.cjs', // ⭐⭐ the counter's snapshot has a trip budget: its own five tables in ONE transaction, 50 → 38 (M36, 2026-09-29)
  'bill-total-wire.test.cjs', // ACC-348a: the chit list row and the chit detail carry the same bill_total (total, agree, currency_code); a disagreement is agree:false; never shipped copies
  'acc-206-readers.test.cjs', // ACC-206 C2-C4: every reader of a bill total is built from counterBill.billTotalSql / pickOf; the beckn quote says 189 for the pre-2-Nov invoice
  'money-reader-scan.test.cjs', // ACC-206 G1: no raw read of the bill total outside the one pick; each named exception carries its reason (SCAN_SELFTEST=1 proves it bites)
  'one-reader-tables.test.cjs', // DRIFT exit bar 2+3 (28 Nov): one owning module per guarded table (docs/one-reader/<table>.json); SQL outside it fails unless dated waiver; raw state predicate never (SCAN_SELFTEST=1 bites)
  'one-figure.test.cjs', // ONE-FIGURE (28 Nov batch 1141): a guarded figure has ONE owning function (docs/one-figure/<figure>.json); a second reader of what a return leaves out fails (SCAN_SELFTEST=1 bites)
  'one-figure-return-reading.test.cjs', // ONE-FIGURE RC1: BAS/VAT201 box = its drill = Ledger page movement minus the labelled left-out line, AU + AE, set-off fixture + mutation red
  'drift7-bas-claim-tie.test.cjs', // DRIFT 7: BAS 1B sentence = its entries = the box, hand 15.00 + 60.00 - 30.00 = 45.00 (claimed 75.00, returned 30.00), mutation red
  'books-grant-list-gate-drift.test.cjs', // UX-218: the owner's list and the gate answer one grant state (stateOf); no second state rule in list()
  'reward-walkins-one-reader.test.cjs', // DRIFT cluster 5 (27 Nov): the walk-in list quotes what the till spends (reward-store.walkIns/foldOf); no SQL on reward_ledger outside reward-store (SCAN_SELFTEST=1 proves it bites)
  'cost-margin-basis.test.cjs', // ACC-206 C1: the owner's chit margin is on the taxable value, one case per matrix column (tests/lib/bill-total-fixtures.cjs)
  'cur1-money-adopt.test.cjs', // CUR-1: the adopted money is the ISO 4217 value type (HUF 2, PTS and unlisted refused, mismatch 409), both copies
  'cur1b-withdrawn.test.cjs', // CUR-1b: withdrawn codes (BGN HRK CUC SLL ZWL) stay readable, refused for new money; XDR never a shop's money
  'cur1b-withdrawn-route.test.cjs', // CUR-1b: a withdrawn code answers 422 in words over http (price write, lock door), never 500
  'offers-live-line-categories.test.cjs', 'reviews3-catalogue-gates.test.cjs', 'reviews3-stock-value-unit.test.cjs', 'reviews3-shrinkage-lot-join.test.cjs', 'reviews4-network-security.test.cjs', 'reviews4-crm.test.cjs', 'reviews4-catalogue-price-parse.test.cjs', 'reviews4-stock-gates.test.cjs', // engines #131: applyLiveOffers reads a line's categories through CBOffers.lineCategories; own line unchanged
  'till-network-source-cost.test.cjs', // CTR-171: a source shop's cost keys never reach the till (adopted lines through the one strip)
  'rev16-delta-cursor-stamped-first.test.js', // ⭐⭐ a delta's cursor never skips a change — stamped before the read; past the cap sent in parts (2026-09-28)
  'screen-snapshot.test.cjs', // ⭐⭐⭐ SNAP-SCREEN · CFD-03: a TV key's snapshot + bell carry no customer/supplier/staff/cost — an allow-list; a counter unchanged
  'snapshot-wire.test.js', // what a counter receives AFTER JSON — the Map that cost the shop its tax
  'one-name-one-function.test.cjs', // two functions, one name: the loser hoists away in silence
  'docnumber-scheme.test.cjs', // the bill number's shape: what the date says vs when the run restarts
  'ord-18-bom-detail.test.cjs', // ORD-18 (proof 2026-11-14): an order stays one line and the product components ride on it as detail
  'ctr-95-worklist-by-person.test.cjs', // CTR-95 (proof 2026-11-14): GET /api/folders/worklist groups one station's queue across every open order through assign.byPerson
  'ctr-96-line-delivery-timestamp.test.cjs', // CTR-96 (proof 2026-11-14): chit_line_delivery rows carry their timestamp (DDL default, writer, reader)
  'ctr-104-collision-verdict.test.cjs', // CTR-104 (proof 2026-11-14): both call sites of tillCollisionVerdict return the same verdict
  'ord-61-switch-off-atomic.test.cjs', // ORD-61 (proof 2026-11-14): a switch-off and the task reassignment commit together or not at all
  'ctr-117-trade-name-profile-first.test.cjs', // CTR-117 (proof 2026-11-14): invoiceParty trade_name reads identities.display_name before the vault
  'ord-25-connector-task.test.cjs', // ORD-25 (proof 2026-11-14): connector install registers a repeating Task Scheduler task (restart with nobody there)
  'ctr-177-bill-number-unique.test.cjs', // CTR-177: the till's real takeNumber never issues a number twice across a roll (needs the engines pin that carries the period label)
  'acc-191-undecided-tax-null.test.cjs', // ACC-191: an undecided tax is null (not decided) in moneyOf and the send header, the total stays the price
  'acc-191-till-not-decided.test.cjs', // ACC-191 till twin: the slip foot, the credit note and the stored bill say not decided, never 0.00 / NaN / -0
  'ctr-187-return-on-credit.test.cjs', // CTR-187: a return on an On-credit bill offers Reduce what they owe first, whole note or nothing, refund.parts []
  'ctr-197-cancelled-bill.test.cjs', // CTR-197: GET /till/bills and the day close leave a cancelled or rejected bill out
  'ctr-197-day-check-withdrawn.test.cjs', // CTR-197: the counter's day check knows a bill cancelled elsewhere (withdrawn), so Close the day is not held
  'bell-param.test.cjs', // every page opens the bell with the name the stream reads (2026-09-17: counters never heard it)
  'network-storefront.test.cjs', // a member storefront shows its network's offers and its checkout charges them — one key
  'network-catalogue.test.cjs', // a brand publishes product changes; a store's own price is only ever suggested to
  'screen-kit.test.cjs', // the screen library: every layout places every part; presets resolve; tiles fall back
  'no-tax-reformula.test.cjs', // the counter calls CBTax.splitLineTax() — no page re-derives the tax split itself
  'network-authority.test.cjs', // who may act on a network edge — from the token, never the body (ATH-86)
  'honest-failures.test.cjs', // ⭐⭐ T2-HONEST: a failed member read answers an error (never "no members"); safeErr on every 500; one health(); the silent-catch ratchet
  'network-standing.test.cjs', // ⭐ TOP-CORRECT 2: a SUSPENDED member is refused the `network` catalogue tier and the tree — one edge-state read (network-membership standingSql), the root alone is not enough
  'identity-key-compare.test.cjs', // speed 21 Nov: the identities key is compared as a uuid, never cast to text (practice list 1471 ms to 17 ms of grants read)
  'send-suspended.test.cjs', // NET-7: a SUSPENDED member's send is refused 403 MEMBERSHIP_SUSPENDED in words (one standing() read); active, no edge, draft, self-chit pass
  'public-stock-visibility.test.cjs', // ⭐ TOP-CORRECT 5: the anonymous stock doors (/integrations/stock/:handle, /ask/:handle/stock) obey the storefront's visibility — private/closed/network = the same 404 as no shop
  'network-view.test.js', // QA wave 1 (FR-N5/N6): one shopfront over many departments - a private department is absent, categories are never invented, search finds only what is shown
  'ppl-40-reset-revokes-sessions.test.cjs', // PPL-40: a code or PIN reset (DELETE /:id/pin, POST /:id/otp) unlists every session the person opened, leaves a colleague's, and ends them before the new code is written
  'cat-277-source-owner-only.test.cjs', // CAT-277: PUT /api/assist/catalogue-source is the owner's: a co-assist and a key are refused 403 OWNER_ONLY with no query; the owner still authors
  'net-53-closed-shop-not-searched.test.cjs', // NET-53: a closed shop is not searched in its network (availability fast path + fan-out, GET /stores); the open shop stays; a failed closed-shop read falls back to the filtered fan-out
  'actors-switch-off.test.cjs', // QA wave 1: the owner's switch off / remove / back on of a person (PUT /api/actors/:id/status): the write, the cleanup counts, the refusals
  'supplier-list-crud.test.cjs', // QA wave 1: PATCH only the caller's own supplier row, UNKNOWN_FIELD, a real business is not renamed; DELETE owner-only, 404, the CRM's one remove
  'availability.test.js', // QA wave 1: a stock figure carries its date, an absent figure is never zero, a stale one never outranks a fresh one (lib/availability)
  'govcontext.test.js', // ⭐ what the application can work out about a shop without asking it — country decides tax, money and every format, so the rule that it must return UNKNOWN rather than guess is a guarded one (registration)
  'signup-context.test.js', // ⚠️ the INSERT and b264 must agree about the columns — a misspelt one is invisible offline and surfaces on a real shop's first sign-up, as a failed audit row on the one event it exists to record
  'variant.test.js', // ⚠️ the same set of choices must always make the same line, and a different set never the same one — both failures are silent, and the bill stays arithmetically correct while being wrong
  'rewards.test.js', // what a point is worth, and what a ledger may do — it touches money
  'reward-cycle.test.js', // the SEQUENCE: earn, come back, encash, expire, register — against the real store
  'sql-runner.test.js', // a tool that runs SQL at production: its WITH/WITHOUT RLS line must be true
  'stock-cycle.test.js', // the log and the cache must stay in step — through a replay, a minus, and a corrupted balance
  'storefront-stock-ledger.test.js', // ⭐⭐ T1-INV: one stock truth — a no-connector shop's storefront shows its OWN ledger; a connector shop its stamp
  'made-to-order.test.cjs', // ⭐ R104: a dish made to order is not stock — one resolver (lib/stocked), one flags query, a NAMED skip not_stocked, onHand/asAt { counted_only }
  /* ⚠️⚠️ IT WAS NOT IN THIS LIST until 2026-09-10, so the one guard that asks 'is every module classified, and does everything unreachable say so' only ran when somebody remembered to. It caught an unclassified lib the same minute it was added here. A guard outside the suite is a guard nobody runs. */
  'item-kind.test.cjs', // a supply is never counted as a product — one column carries the whole split
  'root-link.test.cjs', // the values rootlink writes must be values the CHECK constraints accept
  'entity-kind.test.cjs', // every identity mint declares WHAT it is — a DELETE predicate depends on it
  'board-kinds.test.cjs', // the shared board carries CASES and CMDB records, nothing else — findings stay with the raiser
  'qa-148-cmdb-noop-save.test.cjs', // QA-148: an identical CMDB save (any key order) writes no new version; a real change does
  'skill-print.test.cjs', // ⭐ identity standard §9: the print skill record, cap-print.js, bill-print.html, the till page and printer.js name the SAME paper and document ids; a renamed id fails
  'cmdb.test.cjs', // ⭐⭐ the CMDB: every shipped record fits, a way in + out + tests, only a board writer writes
  'testing-board-writes.test.cjs', // ⭐⭐ SEC-SMALL: the six shared-board writes ask the gate first; results/incidents/evidence stay open; the platform root writes
  'testing-board-reads.test.cjs', // ⭐ SEC-122: a shop is refused the shared board's reads (403 NOT_BOARD_READER); the board account reads; the Test lab stays open
  'platform-door.test.cjs', // ⭐⭐ W1-SET GOV2: the platform role is ONE door (platformroot.refuseUnlessPlatform) — register a source · governed create · re-attest · erase ask it before any read
  'notif-feed-dryrun.test.cjs', // ⭐ SEC-SMALL: b619 is the live notifications feed verbatim; b620 CONCURRENTLY + IF NOT EXISTS, no transaction block
  'field-ledger.test.cjs', // ⭐⭐ NO FIELD LEFT UNTURNED: a new product column / form input has a ledger row; a "not used" field gains no reader (2026-10-09)
  'engine-boundary.test.js', // every lib declared engine or not; anything unreachable carries an @stage
  'adopt.test.js', // what one shop may take into its catalogue from another's delivery
  'local-supplier.test.js', // ~<user id>.sup-nnnn — one row per shop, never a recipient, never in the search
  'money-language.test.js', // the currency and language CONVENTIONS, as assertions — a capability, not advice
  'search-engine.test.js', // one search, three copies
  'lotfields.test.js', // what a vertical must capture about a consignment
  'printer.test.js', // the slip bytes
  'kit-update.test.js', // a kit that does not parse is never swapped in
  'speech.test.js', // the seam, not the vendor
  'key-scopes.test.js', // what every API key may reach — the authorisation matrix
  'column-home.test.cjs', // where a column actually lives
  'connector-kit.test.js',
  'con-98-connector-bill-total.test.cjs', // CON-98: the connector books a bill at the ONE pick (counter-bill.pickOf, a byte copy in the kit); no total = refused in words
  'tax-vendor.test.js',
  'tax.test.js', // GST determination: same-state split, inclusive pricing, INV-01 shape, paisa rounding, reverse charge — was red on main unguarded (K3)
  /* ⭐ a migration that says 'idempotent' has to be. Every file from b240 ends in PROOFS, and those are only reachable by re-running it — so one that errors on a second run is one nobody can re-verify. */
  'migration-rerunnable.test.cjs',
  /* ⭐ three desks × routed/unrouted × network/no-network is twelve paths through ONE function, and eleven are the ones nobody will ever click. Athi: *"if we can figure out all the combination and a single helpdesk works for all, nothing like it."* This is what keeps it single. */
  'support-desks.test.cjs',
  'raiseticket-why.test.cjs',
  /* ⭐ node -c parses, it does not resolve: a const declared in one function and read in the next compiles perfectly and throws on the first real request. Three times in one day's work. */
  'scope-leak.test.cjs',
  /* ⚠️ summary_json is built from a WHITELIST and drops anything else in silence. It has eaten two riders: detail_design, then routed_by - the whole support-ticket trace, passed and never stored, in the same session as the comment in lib/mint.js warning about it. */
  'mint-riders.test.cjs',
  /* ⚠⚠ 55 tables are FORCE RLS. Read one with no app.current_entity and you get an empty set - not an error. Three near-misses in one day, and one reached a commit message asserting a function was lying when the function was right and the check was blind. */
  'rls-context.test.cjs',
  /* [REV-19] the guard's own tracked-table lists drift the same way the tables they watch grow — this checks both against db/rls-baseline.json instead of trusting the last person who remembered to update them. */
  'rls-guard-baseline.test.cjs',
  'rls-open-ratchet.test.cjs', // SEC-75: every open readable table is classified (dictionary / entity / shared / platform-private); the non-dictionary count only falls
  'sec-75-actor-settings-entity.test.cjs', // SEC-75 P1 slice: every statement on entity_actor_settings runs under withEntity (b842)
  'sec-75-shared-tables-entity.test.cjs', // SEC-75 + DB-103: b855 locks six shared tables; every statement on them runs bound to a shop; break test on the policies
  'rls-predicate.test.cjs', // ⚠️ every policy reads a GUC something sets — written, never declared, so never run
  'migration-rls.test.js', // a new table closes itself; the default grant makes an open one readable
  /* ⭐ CTP step 2: the address seam. Every address local, no wire - and the test asserts the two claims that matter: ONE query for five copies (it costs nothing while nothing is remote), and a remote copy refused BEFORE any write rather than half a chit delivered. */
  'ctp-address.test.cjs',
  'money-origin.test.cjs', // ACC-192: money computed once at the origin, carried, never recomputed by a copy
  'xc-1119-no-pack.test.cjs', // XC-1119: the ONE no-pack sentence, the AE VAT scheme, a mixed firm filing verb, a client row own country (offline)
  'xc2-no-pack-sale.test.cjs', // XC2-1119: a shop with no pack MAY sell (untaxed, tax_checked:false, the one sentence); setup carries the notice; no door words a missing pack itself (offline)
  'money-check.test.cjs', // ACC-206 B: the one pick of a bill's total, the raise that reaches us (ticket, counter, mail, digest), no money arithmetic outside the engine
  'money-no-arithmetic.test.cjs', // ACC-206: no sum, difference, reduce or rounding on money between the engine and the chit (send-money, money-check, chit-proposal, the send steps); named exceptions carry a backlog id
  'money-paths.test.cjs', // ACC-206 A: the engine's total on every path (purpose x how made x country x copy x reader), the stop, the override, the refusals
  'ctr-211-send-recheck.test.cjs', // CTR-211: at send the bridge step and its ValDtls figure are compared (total, taxable, round_off); a disagreement is 409 + one ticket, never overridable
  'ctr-204-replay-body.test.cjs', // CTR-204: a replay of a held bill number that carries another total or other items is 409 CHIT_REPLAY_DIFFERS; the true replay stays 200 duplicate:true
  'fin58-upi-waiting.test.cjs', // FIN-58: an unconfirmed UPI part waits as a receivable from the system party "UPI waiting"; the flip is a payment
  'rollup-currency.test.cjs', // REP-50
  'ctr-181-books-once.test.cjs', // CTR-181: the real postChit on version #1 and #2 of a day summary leaves ONE walk-in day entry
  'ctr-181-summary-reclose.test.cjs', // CTR-181: a summary closed again under the same reference with new figures is stored as the next version (<ref>#n, revision, supersedes), the same figures stay duplicate:true on the newest chit
  'ctp-internal-wire.test.cjs', // RAIL-98..101: a chit between our own installations: envelope id, worded far-end refusals, manifest domain, add by address
  /* ⭐⭐ THE CONFORMANCE RULE. Athi: "the behaviour should be the same" whether a world is a row here or its
     own machine. open(sign(build(copy))) must deep-equal copy, or the two transports write different rows and
     lifting a world silently changes behaviour. Also holds the population boundary, which across a wire is a
     PROTOCOL rule because b247 cannot see the far entity. */
  'ctp-conformance.test.cjs',
  'remote-catalogue.test.cjs', // NET-39: a supplier on another installation shows its catalogue (signed ask, local shape, words when silent)
  'net-39-search.test.cjs', // NET-39: find a business/product on another installation - ONE search Here and There, listed shops and public fields only
  /* ⭐ Athi’s test: two shops with the SAME user id, display name AND bridge id, in two countries. The
     collision is expected — bridge ids are minted per installation — and the address carries the namespace,
     so CBAAAAAAAA@in.example is not CBAAAAAAAA@ae.example. The dangerous case it holds: a QUALIFIED address
     must never resolve locally just because we hold that id. */
  'ctp-collision.test.cjs',
  /* ⭐⭐ THE SOFTWARE ASSETS. Athi: "each capability has to be proven without the concept of chit… that will be our software asset." Ten modules, each proven ALONE (its require() list is empty or a language builtin) and proven to ANSWER something, with no database, no network and no chit. */
  'bare-slate.test.cjs',
  /* ⭐ the conversion engine: currency, and what a QUANTITY is worth at a market price. A rate is EVIDENCE
     — it carries where it came from and when — and the engine refuses rather than guessing: no unit factor
     it was not given, no inverted rate unless permitted, and a line it cannot value never vanishes from a
     total. No database, no network, no chit. */
  'convert.test.cjs',
  /* ⭐⭐ THE NAMESPACE REGISTER — docs/namespace.yaml checked against the code that enforces it. Every kind of
     id, its shape, its separator, whether it can be sent to, and where the rule lives. It exists because the
     grammar used to live only in one file’s comments, and a document nothing checks becomes fiction. */
  'namespace.test.cjs',
  'o4-typed-signin.test.cjs', // ⭐ O4: staff sign-in shown as typed (name@shop), never the stored .br / .cr
  /* ⭐⭐ MINT a user id and RESOLVE one — every combination in one place (lib/mintuserid.js), every reading in
     another (lib/resolveuserid.js). § 0 holds the customer form byte-identical to what production already
     stores: one character of drift and every returning customer becomes a second identity. */
  'userid.test.cjs',
  /* ⭐⭐ THE CONSTITUTION MATRIX — one cascade, two doors. A party arriving over CTP has no entity row here, so
     it used to resolve, silently, as base @ platform-0. Now it resolves from ITS installation (the b254 rule)
     and every answer says resolved_from + fallback. Also: in lib/, only govresolve may resolve a constitution. */
  'govresolve-ctp.test.cjs',
  'govresolve-bounded.test.cjs', // NET-25: an installation declares only inside what the constitution allows (currency, timezone, region, country)
  'setup-ready.test.cjs', // GREY-VERT: GET /entities/constitutions carries ready per setup (service-desk false); govresolve.setupReady is the one register
  'relationships-availability.test.cjs', // OPS-55 has/miss/nocat/err states, OPS-57 bounded concurrency of 6
  'relationships-not-self.test.cjs', // a shop is never its own customer or supplier: both relationships lists leave the reader out (l16)
  /* ⭐⭐ CTP QUERY — the READ verb (Athi: catalogue PULL, by store id, same as local). A signed question,
     refused when stale/tampered/unpaired, answered with the SAME public view an anonymous visitor gets. */
  'ctp-query.test.cjs',
  'canon.test.js', // the one canonical form, byte-identical to its three originals; RAIL-141 (f): a seal must cover what the caller requires, __proto__ is a field
  'ctp-keys.test.cjs', // RAIL-141 (g): verifyWith takes Ed25519 only, one spelling of a signature, a bad peer key said once at warn
  /* ⭐⭐⭐ THE LEDGER (SPEC-books-v2, 2026-09-29). books-writer: ONE writer of the journal tables (postEntry), insert-only by
     trigger + grant, the chit never waits on it, FORCE RLS on all 13. The rest need the books engines v1.8.0 for their "on"
     half (BOOKS_ENGINES_SRC, else a v1.8.0 sibling) and say SKIP with the reason without them — never a silent pass. */
  'books-writer.test.cjs', // ⭐⭐⭐ only lib/books-store writes the journal, only postEntry calls it
  'books-store-sql.test.cjs', // every books statement: binds = placeholders, the shop is $1
  'books-year-reclose.test.cjs', // ACC-380: a closed year closes again in one step (re-close), the held numbers move with it
  'books-post.test.cjs', // ⭐⭐ the one writer: balances both grains, gap-free JV, locks, reversal, cheques, carryforward
  'books-hooks.test.cjs', // ⭐⭐ what a chit posts — and a failed post NEVER fails the chit (parked, named)
  'books-country.test.cjs', // ⭐ CX2: the books speak the shop's country — IN · AU · AE (core ≥ v1.42, money, zone, year label, depreciation basis)
  'books-routes.test.cjs', // /api/books: 404 while off, owner-only writes, the shapes the Ledger screen reads
  'books-minor-exponent.test.cjs', // ACC-179: write-off · payment · opening · entries in the currency's own decimals (INR 2 · JPY 0 · KWD 3), INR unchanged
  'books-pages.test.cjs', // ⭐ PERF1: Day book + Ledger pages (keyset, server max, server totals) add up to the whole; lib/page-limit
  'daybook-paged-1132.test.cjs', // enrolled 1132 (every-test-is-enrolled): GET /daybook answers one default page
  'testing-pages.test.cjs', // ⭐ T2-PAGING: the test board's five lists page (total · page · limit, lib/page-limit max); an old High is never cut
  'list-paging-guard.test.cjs', // ⭐ T2-PAGING ratchet: unpaged list GETs ≤ the frozen number (W1-PLAT: 0); every allowance has its reason
  'paged-read.test.cjs', // ⭐ PERF1 column 21: what a GET route does about the size of its answer (default, server max, keyset or offset, whole when nothing asked), from source text
  'page-limit.test.cjs', // ⭐ LIM2: the ONE pager — limitOf · pageOf · pageArgs (not asked = every row) · pageOut (the envelope), every rule and edge
  'idempotency.test.cjs', // ⭐ LIM2: idempotency off is never silent — warn + held in memory; a retry replayed or 409, another body 422, X-Idempotency: unverified
  'idempotency-after-auth.test.cjs', // SEC (finding 2, 23 Oct): a replay answers only after the route's own auth — revoked session / removed device / deactivated actor get the fresh refusal; a 401 is never recorded; public money doors unchanged
  'fin51-payment-safe-repeat.test.cjs', // FIN-51 (7 Nov): Mark paid on a chit REQUIRES an Idempotency-Key - same key+body = one payment and the first answer; another body = IDEMPOTENCY_CONFLICT; two at once = one runs, the other 409
  'fin-chit-books-agree.test.cjs', // M7a (12 Nov): a withdrawn bill takes no Mark-paid (CHIT_VOIDED), Mark unpaid closes the waiting press row, the credit limit counts bills waiting in books_outbox (a USD one beside an INR bill is refused)
  'canon-depth.test.js', // a 2000-deep body: the canon throws cleanly and the idempotency gate self-heals (calls next) — it had failed unseen, in no list
  'books-tally.test.cjs', // ⭐⭐ the pack's Tally files come from the connector's adapter — one Tally writer, Receipt byte-identical
  'books-collections.test.cjs', // ⭐ CB Finance F1: /dues?finance=1 — limit · over_limit · interest SHOWN · owner only; plain /dues untouched
  'finance-one-due.test.cjs', // ⭐ R73/R75/R76 (24 Oct): ONE due figure — books-engines.netOpen nets a receipt on account against the bill; Remind (due_minor), Cash and the age bucket all ₹490; lowest = a day's row; rent template in the 30-day view; early-pay in rupees
  'books-fixes.test.cjs', // ⭐⭐⭐ the red-team findings of 2026-09-30 (M1–M12), each held by a check that was red before its fix
  'books-dates-tz.test.cjs', // ⭐⭐ a date read back from Postgres is the same date under Asia/Kolkata and UTC (it runs itself in both)
  'books-period.test.cjs', // ⭐⭐ v1.14–v1.16: asset register (b280 draft), depreciation, closing stock, GST close + challan, loans, accruals, contra — the engine's lines, once, locked, owner-only
  'acc-278-gstr3b-no-gstin.test.cjs', // ACC-278: GSTR-3B for a shop with no/short GSTIN is refused in the engine's own words (asked with no documents, no copied regex), India-only first; parallel run says could-not-read
  'acc-330-billed-at-future.test.cjs', // ACC-330: a till billed_at more than 24 h ahead of the send posts on the send day (books day AND GST month, the SQL run on the local Postgres), with a note, never refused
  'acc-301-note-issued-basis.test.cjs', // ACC-301: a credit/debit note on an issued invoice is priced on the basis the invoice was issued on (_cb.price_includes_tax, else derived from its lines, else refused), never the seller's live flag
  'acc-224-period-of-record.test.cjs', // ACC-224: a late bill of a locked month is in the return of the month the books hold it in, named a prior-period item; each month's return = the books
  'gstr-one-source.test.cjs', // ⭐⭐ Fable 2026-10-23 f1-3: the rail GSTR-3B counts the chits the books count, in the shop's month; equals GST close's balances per head; 3.1 split (a)(b)(c)(e)
  'gstr3b-rcm-1128.test.cjs', // ⭐ F1 (1128): the served GSTR-3B is the engine's (one builder): reverse-charge tax in 3.1(d) and 4(A)(3), hand figures in rupees
  'gstr3b-opening-itc-1128.test.cjs', // ⭐ F2 (EL-TAX 1128): 6.1 carries the credit the books bring in (opening_itc): used + carried = opening, a shortfall is named
  'ctry-148-gstr3b-composition.test.cjs', // CTRY-148: GSTR-3B for a composition shop is refused naming CMP-08 and GSTR-4; regular unchanged
  'ctry-148-gstr3b-composition-route.test.cjs', // CTRY-148: the same through GET /api/tax/gstr, shop set up the country-setup way (422 GSTR_REFUSED)
  'gstr1-ref-whole-1128.test.cjs', // ⭐ F6 (EL-TAX 1128): a return keeps the whole document number; 99 notes of 19 characters are 99 refs in Table 13, none merged
  'walkf-setoff-1128.test.cjs', // ⭐ F-F-08 (1128): the ledger / GSTR-3B net applies the s.49 set-off order (IGST credit 600 vs 160.16 / 247.50 / 247.50 → SGST 55.16)
  'einvoice-note-1128.test.cjs', // ⭐ F13 (1128): the GSTR-1 _cb.einvoice warning, the limit read from the pack's dated row (confirmed or not named as such)
  'readred-units-1129.test.cjs', // readRed2 (1129): import-rejects, party-credit, profilemap, shop-country, receipt-lines, client-ip, einvoice-note, offrail-itc and the engines list, one unit per rule
  'books-preview.test.cjs', // ⭐⭐ ＋ Entry: the preview's lines ARE the posted lines (one composeEntry), Dr = Cr, type + golden rule per line, locked month, blocked credit, writes nothing
  'books-manual-modes.test.cjs', // ⭐ ACC-300: the owner's events offer the country pack's payment modes (IN keeps UPI, AU and AE do not) and every mode offered posts; a mode outside the pack is refused with the same words
  'fin-combos-books.test.cjs', // FIN-COMBOS 20 Nov: refund side by party role (B6-12), debit note against a booked bill (B6-14), fx on the line (C4), strict amounts, client_ref reuse and look-alike (R12a, R4)
  'books-past-years.test.cjs', // past years: a closed year opens read-only, can_close_if_lodged, period.state (past-years lane)
  'books-lodged-later.test.cjs', // past years: returns_lodged on an already closed year records the declaration, repeat idempotent (past-years lane)
  'past-years-auditor-party.test.cjs', // past years: the auditor party sees the closed years
  'books-party-netzero.test.cjs', // ⭐ BB-P1-3: a bank line to a named supplier is ONE entry (kind bank_expense_supplier): party kept, expense + GST split, supplier nets to nil, reversal keeps it; needs the engines branch with the kind (BOOKS_ENGINES_SRC)
  'books-bank-pay-needs.test.cjs', // ⭐ BB-P1-3: a money-out bank line with no account and no bill is asked (needs which_account / which_bill), never posted on account
  'books-card-split.test.cjs', // ⭐ BB-04: a card settlement net of the acquirer's fee posts Dr bank · Dr bank charges · (Dr tax) · Cr card; refusals in words (needs the engines src: BOOKS_ENGINES_SRC or the sibling chitbridge-engines)
  'books-rcm.test.cjs', // ⭐ v1.20.0: a purchase under reverse charge posts the buyer's own tax (2204–2206), paid in cash only at the GST close / challan
  'books-year.test.cjs', // ⭐ v1.20.0: the year close — refused in words (running, open months, Suspense), then every month hard-locked, next year opens on the carry-forward, idempotent
  'books-year-country.test.cjs', // ⭐ ACC-204 (AU-18b): an AU year close waits for every BAS period (422 PERIOD_RETURN_OPEN, the labels), the month lock stays allowed and names its period, a close under an old label still reads closed
  'acc-new-4-year-gate.test.cjs', // ⭐ l16-accfix API-new-1 / CTY-new-1: the year-close refusal carries period_codes beside the labels (the code POST /gst/close takes); AE's gate fires without a stagger (every month covered by a closed tax period)
  'tax-lock-f4.test.cjs', // ⭐ F4 (1128): a month of a closed tax period opens only by the explicit amendment (amend_tax); a year reopen keeps the set-off periods locked
  'year-depreciation-f3.test.cjs', // ⭐ F3 (1128): the year close refuses (depreciation_not_run) until the year's depreciation is run
  'tax-lock-nil-1128.test.cjs', // F4 LEFT (1128): a nil tax close leaves a marker; its lock survives a year reopen
  'year-depreciation-nil-1128.test.cjs', // F3 LEFT (1128): a nil depreciation run writes its marker and passes the year gate
  'yearclose-stock-warning-1129.test.cjs', // GF-MONEY F3 (1129): a year with stock and no closing stock names closing_stock_missing on the close (a warning, never a gate)
  'practice-cash-receivables-1129.test.cjs', // MONEY-01 A15 (1129): the practice list's cash_days reads receivables as well as payables
  'acc381-ledger-months.test.cjs', // ACC-381: GET /ledger/:account carries months (server totals per month, hand 30,000 / 20,500, a page keeps them, cost-blind nulls them)
  'acc-new-1-box9.test.cjs', // ⭐ l16-accfix ACC-new-1: VAT201 box 9 counts only entries that carried recoverable VAT (hand 750.00 vs 1,062.50), a reversal nets away; AU G11 unchanged
  'walkd-goods-in-refused.test.cjs', // ⭐ WALK-D D-F-01..05: a goods-in with qty 0/-3/1e12, no or negative cost, a ghost product, no lot on a batch-kept item, an expired lot or a date not YYYY-MM-DD is 400 in words (BAD_QTY, BAD_PRICE, RECEIPT_*); FEFO skips expired lots
  'taxline-typed-line-1132.test.cjs', // ⭐ TAXLINE-1132: a line TYPED into a chit (Compose) answers a tax line in EVERY pack: rated at the pack standard rate (AU 10, AE 5) or refused in words (IN), never 0, never 'pack missing'
  'walkd-default-tax-rate.test.cjs', // ⭐ WALK-D D-F-08: a registered shop's new product carries the pack's standard rate (AU 10 → A$19.80 tax-in = GST 1.80); unregistered, IN, typed/slab/category left alone
  'walkd-csv-yes-no.test.cjs', // ⭐ WALK-D D-F-09: CSV stocked / batch_tracked yes/no become booleans at import (text 'yes' was ignored by the reader)
  'walkd-lot-trace-lines.test.cjs', // ⭐ WALK-D D-F-07: by-batch reads the lot on chit_detail.line_items (goods-in receipts, supplier bills) - SQL checked not run, no local Postgres
  'walkd-reward-replay.test.cjs', // ⭐ WALK-D D-F-12: a reward replay answers what the first call recorded (added 10, points 10), never the sum twice
  'walkd-rfq-not-issued.test.cjs', // ⭐ WALK-D D-F-10: an RFQ not posted or frozen is not an issued invoice (isIssuedRow), so the seller prices it as a round
  'walkd-credit-note-waits-for-supplier.test.cjs', // ⭐ WALK-D D-F-11: a received supplier credit note carries supplier_check, so it waits for the supplier list like its bill (A$4.80 / GST 0.44)
  'acc-new-2-supply-kind.test.cjs', // ⭐ l16-accfix ACC-new-2: a supply kind the pack does not define is 422 SUPPLY_KIND_UNKNOWN listing the pack's kinds (AU, AE, IN)
  'acc-336-close-reads-period.test.cjs', // ⭐ ACC-336/336b: the GST close reads the head net before payments (add-back), posts the surplus as tax paid in advance, replays by paid_entries; 86 checks
  'acc-331-currency-cells.test.cjs', // ⭐ CUR-1 (ACC-331/332): a bill's payment parts and lines and a journal's lines name the document's currency or none; 409 CURRENCY_MISMATCH naming the field
  'startfix-one-shop-name.test.cjs', // ⭐ A-F-66 (Walk A 21 Nov): the business name typed in Print setup (signature trade_name) is the shop's display_name — one name for header, Home and bill
  'wages-moved-1126.test.cjs', // ⭐ F-66 (batch 1126): wages moved 5100 -> 6015 — a shop on 5100 keeps its ledger, new wages land on 6015, the P&L reads both as one operating line
  'startfix-abn-not-gst.test.cjs', // ⭐ A-F-14 (Walk A 21 Nov): an ABN is not GST registration — typing it does not flip the shop to registered, "not registered" keeps it (a GSTIN/TRN still goes)
  'acc-198-tax-unknown.test.cjs', // ⭐ ACC-198 (S5-1, R13): tax registration nobody stated is a QUESTION — country-setup.registrationOf answers unknown + TAX_REGISTRATION_UNKNOWN; a freshShop's sale (IN, AU) waits with the question, never posts at a guessed rate
  'acc-221-unreadable-number.test.cjs', // ⭐ ACC-221 (+222): a figure the caller sent that is not a number (abc, NaN, Infinity, blank, null price) is NAMED and refused (BAD_QTY / BAD_PRICE / BAD_RATE, thrown as line_unreadable), never priced at 0 and said ok; engines num() follow-up
  'books-money-1128.test.cjs', // ⭐ batch 1128 fixBooks: F2 roundMoney rounds to the currency's minor unit (KWD 3, JPY 0) and refuses NaN by name; F1 a carried TotInvVal is a round-off only within 1 minor unit per line (AU: half the 5c step), else the invoice waits with both figures
  'books-writer-1128.test.cjs', // ⭐ batch 1128 fixBooks: F6 balance rows in one fixed order (no deadlock) · F12 a reversal's ref is reverse:<id>
  'acc-265-cancel-credit-note.test.cjs', // ⭐ ACC-265: a sale with a live credit note against it is not cancelled (409 CHIT_HAS_CREDIT_NOTE at /void and PUT /status), asked after paid, under the cap's own lock and reader; real-Postgres run: acc-265-cancel-credit-note.realstack.cjs
  'r103-reverse-live-bill.test.cjs', // ⭐ R1-03 (DEC-267): Reverse on a live sale_bill / purchase_bill is refused at the route (409 ENTRY_OF_LIVE_BILL), not in reverseEntry (the cancel path stays); the day book says may_reverse + why; real-Postgres: r103-reverse-live-bill.realstack.cjs
  'acc-265b-note-after-cancel.test.cjs', // ⭐ ACC-265b: a credit note against a cancelled or rejected bill is refused (409 BILL_WITHDRAWN, billOf's own withdrawn flag); a sale with a live note is not REJECTED either (rail WITHDRAWN list); real-Postgres: acc-265b-note-after-cancel.realstack.cjs
  'acc-328-opening-twice.test.cjs', // ⭐ ACC-328/329: the same opening posted twice is 409 BOOKS_CONFLICT (a retry of the same ref still replays), a NEW opening dated in the future is 422; a reversal of an old future opening still works
  'acc-286-credit-note-cap.test.cjs', // ⭐ ACC-286: a counter credit note cannot credit more than its bill (409 CREDIT_NOTE_OVER_BILL), four in a row and ten at once, under the bill's lock
  'af-late-day-in-locked-month.test.cjs', // AF-F-02: a till day that arrives after its month is locked posts in the next open month WITH the note "<Month> locked" (never silent); a typed date is still refused
  'af-bank-signoff-seat.test.cjs', // AF-F-03: the bank sign-off is refused to a seat the books refuse (the ONE mayReadMoney gate)
  'af-refund-tender.test.cjs', // AF-F-01: a refund goes back by the tender the bill was paid with, else a manager's reason (409 REFUND_TENDER_MISMATCH)
  'af-home-money-card.test.cjs', // AF-F-03: the Home finance card is greyed with the books' sentence, no figure, for a seat mayReadMoney refuses
  'fin-77-parallel-payments.test.cjs', // ⭐ FIN-77: two full-due payments at once settle once (the duplicate question is asked under the party lock); IN and AU
  'acc-283-refund-gap.test.cjs', // ⭐ ACC-283: a refund that is not the credit note's total waits in words with gap_minor (AU A$69.00 for A$68.98); equal and credit-only refunds post
  'acc-272-unknown-registration.test.cjs', // ⭐ ACC-272: POST /api/tax/compute and /api/invoice/build ask a shop with no tax number that never said it is registered (409 TAX_REGISTRATION_UNKNOWN, the till's own code), never price it at no tax; confirmed unregistered still 0%
  'acc-282-compute-refuses-bad-lines.test.cjs', // ⭐ ACC-282: a discount (with offers) above its line is 400 BAD_PRICE and a runaway amount 400 CHIT_AMOUNT_TOO_LARGE on /api/tax/compute and /api/invoice/build
  'cat-251-reprice-tiers.test.cjs', // ⭐ MONEY W1 M5 (CAT-251): reprice from the catalogue asks the one price reader (services.priceLine), so a tier is honoured: 20 kg -> 80.00, 5 kg -> 100.00
  'fin-books-doors-strict.test.cjs', // ⭐ MONEY W1 M6 (FIN-54/60/79/82/83/84/86): the books' payment and opening doors read minor units, direction, dates, party ids strictly; supplier rows carry balance_words
  'fin-ledger-guards.test.cjs', // ⭐ MONEY W2 M7b (FIN-88/92/100, CAT-127): repeated or open bill ref refused, an opening resent without client_ref is a replay, a loan instalment cannot exceed what the loan owes, a month pack needs a locked month
  'money-seat-guard.test.cjs', // ⭐ DRIFT 19b+35a: GET /kyb/risk amounts and GET /relationships/customers balances go through lib/money-seat.noMoney (the books' own gate); a new door to either fails
  'line-door-one-guard.test.cjs', // CTRY-134: one line-door guard (services.lineRefusal, widened: BAD_LINE and BAD_BOUND) on tax/compute, tax/rate, invoice/build, pricing/price, offers/evaluate
  'acc-311-journal-whole-minor.test.cjs', // ⭐ ACC-311: a manual journal entry with a fractional or over-ceiling minor amount is refused 422 BOOKS_REFUSED, nothing posted
  'acc-225-gstr1-b2cl.test.cjs', // ⭐ ACC-225: ONE GSTR-1 builder (the adopted gst-returns.gstr1): an inter-state B2C bill over ₹1 lakh (Notfn 12/2024) lands in Table 5 b2cl, under it in b2cs; the old limit before Aug 2024; a large B2C credit note in cdnur; no second builder in tax-lines
  'acc-200-cash-rounding.test.cjs', // ⭐ ACC-200: a counter bill's payment gap posts as round-off only inside the books pack's cash step (AU 5c on cash); none = exact, so an IN bill 50p short waits, named
  'books-recurring.test.cjs', // ⭐ b281 draft: recurring entries — 503 until migrated, proposed by default, a re-run never posts twice, the daily sweep reverses a due accrual once
  'books-todo-unposted.test.cjs', // ACC-342: a bill the books did not take reaches the To do
  'books-todo.test.cjs', // ⭐ the To-do feed: each kind from a real check, only what needs doing, and each row gone when it is done
  'cat210-rate-owner-only.test.cjs', // CAT-210: a tax rate is owner or manager only on every door (PATCH · bulk-update · create · schedule), one rule in lib/rate-door, the whole request refused in words, may_set_rate on the payload
  'walks2-import-good-rows.test.cjs', // WALK S2 S2-F-02/04: an import takes the good rows when asked, lists the bad with line+field+reason and a CSV, and meets the item form's default tax rate
  'cat282-parallel-merge.test.cjs', // CAT-282: three parallel merge PATCHes of one product keep every edit (row lock on the write's transaction), one version per real change
  'cat326-parked-column.test.cjs', // CAT-326: a column with a change parked for a date is in use: the delete and retype doors refuse with the count
  'tax-facts.test.cjs', // CMP-13: lib/tax-facts.taxFactsOf, one case per rule, an unlisted scheme refused, nothing said stays unknown (fail-closed)
  'cat211-rate-doors.test.cjs', // CAT-211: a category's rate (PUT/POST /definitions, the retire takeover) and the shop default (PUT /catalogue-face) are owner or manager only, the whole request refused in the one rate sentence, nothing written; no other writer of the two defaults
  'ctr182-gstin-owner-only.test.cjs', // CTR-182: the shop's GSTIN is the owner's on every door (till POST /shop · PATCH /entities/profile · PUT /governance/profile/vault · POST /integrations/profile): a clerk and a manager refused 403 OWNER_ONLY with nothing written, owner and a key pass, may_set_tax_id on can-see-costs
  'net-96-profile-status.test.cjs', // NET-96: PATCH /entities/profile business_status is one of open, closed, away as a whole value; [] was a 500
  'ctr-212-recheck-door.test.cjs', // ⭐ CTR-212 S1: POST /till/recheck answers every id with the catalogue's CURRENT row (deleted = found:false, soft-removed = active:false, a brand line read as the snapshot reads it)
  'ctr-212-recheck-setting.test.cjs', // ⭐ CTR-212 S0: recheck_prices is asked, never assumed (askedOf, the snapshot's null, FIELDS rows)
  'ctr-243-recheck-changed-at.test.cjs', // ⭐ CTR-243: POST /till/recheck carries changed_at (commercial_changed_at); a database before b845 answers null, never a 500
  'ctr-243-stale-send.test.cjs', // ⭐ CTR-243: a bill rung at an out-of-date price: price only goes as sold with an ack, a rate move or a withdrawn line is HELD for the owner PIN, never re-priced, never lost (25 cases)
  'ctr-246-bridge-missing.test.cjs', // ⭐ CTR-246: a bill that carries an invoice but no bridge or no readable till build stamp is passed and counted (/health send_bridge_absent · send_heads_absent), never refused
  'ctr-245-ack-audience.test.cjs', // ⭐ CTR-245: the signed price ack (aud cb-price-ack) and a session token are never interchangeable, both ways: auth, customer-auth and idempotency refuse an ack, a session is no ack, HS256 pinned
  'ctr-245-price-moved.test.cjs', // ⭐ CTR-245: a draft promoted long after it was priced: a person gets 409 PRICE_MOVED naming the moved lines (ack bound to the stamps, 5 minutes), auto and a till body never a 4xx
  'ctr-244-price-drift.test.cjs', // ⭐ CTR-244: at send ONE ticket says a bill's prices were out of date at the sale (the row's commercial_changed_at vs billed_at, carried figure vs row); the bill is stored as sold, nothing refused or re-priced
  'ctr-212-recheck-till.test.cjs', // ⭐ CTR-212 S2a: the counter reads prices again at unpark and finish; 236.00 kept · 283.20 · 224.00 · deleted never billed (hand figures, the real engine)
  'cat-264a-commercial-stamp.test.cjs', // ⭐ CAT-264a: the b845 trigger key list equals till RECHECK_FIELDS ∪ RATE_KEYS ∪ currency; cb_item_fields makes each key (SQL and JS cannot drift)
  'till-rate-door.test.cjs', // ⭐ F5 A1: the counter's item carries its tax facts (gst_rate · categories[] · hsn from sac, never code); POST /rate refuses a key and a cashier in words, an owner/manager sets it once (idempotent); Veg Meals ₹120 inclusive at 5% through the engine
  'books-manual-events.test.cjs', // ⭐⭐ expense / other income / capital / drawings / staff advance + recovery: hand-worked lines, MJ + voucher type, double tap once, owner-only, the system gives a ledger's code
  'books-bank-line-tax.test.cjs', // ⭐ FIN-116: a bank line's tax answer (input_tax_minor) on POST /events: net 20.00 + tax 2.00 = Cr Bank 22.00 (AU), replay, refusals in words, unknown registration stays unknown
  'books-voucher-type-write.test.cjs', // ⭐ b279 ran 2026-10-03: every new entry stores its voucher TYPE; a manual MJ Payment reads Payment
  'ingest-iot-offline.test.cjs', // ⭐ TEST-INGEST-IOT: key none/unknown/inactive → 401; malformed body → 400 never 200; ERP replay → ONE chit, 'duplicate'; stats counts
  'sec3-s8-ai-spend-gate.test.cjs', // S8 (batch 1128): an AI call is reserved before it is checked, so parallel calls cannot overshoot; the platform ceiling read fails CLOSED
  'sec3-s9-pair-hats.test.cjs', // S9 (batch 1128): only owner/manager hats (or a counter key) pair a screen; a good claim does not clear the miss count
  'sec3-s10-key-life.test.cjs', // S10 (batch 1128): an API key lives 365 days at most; less is honoured
  'sec3-s11-actors-phone.test.cjs', // S11 (batch 1128): colleagues' phone and connector config only for owner/manager
  'sec3-s12-public-media.test.cjs', // S12 (batch 1128): public media: MIME allowlist, private catalogue pictures not public, LIKE wildcards escaped
  'sec3-s13-ssrf-ranges.test.cjs', // S13 (batch 1128): more special-use ranges refused; boot notice for CB_CTP_ALLOW_PRIVATE
  'sec3-s16-ask-cap.test.cjs', // S16 (batch 1128): the anonymous connector ask is capped per shop
  'sec3-device-keys.test.cjs', // ⭐ SEC3: a device key addresses only its shop + its parties; the connector switch holds it; /events/stats is the operator's; a failed chit is not a 200; the shop's money; Zoho tax list holds the order; the simulator is local by default
  'erp-ingest-idempotency.test.cjs', // ⭐ CON-ERP-IDEM: erp-ingest keys on the Idempotency-Key, else doc_ref, else the hash; a failed outcome chit is a 503 and its retry makes the chit; a stale pending receipt is claimed again; the same key with another body is 422 (the proof of machine_keyed in api-hardening-scope.json)
  'con-159-ingest-replay.test.cjs', // ⭐ CON-159: POST /ingest dedupes only on the caller's own Idempotency-Key or event_id (erp-receipt claimReceipt, hashFallback off): same key twice = one chit + replay, no key = two chits, same key in two shops = two, other body = 422
  'country-setup.test.cjs', // ⭐ CS1: register → Country setup → India pack on; a pack-less country refused with ITS sentence on every books route; existing Indian shops untouched; owner-only; 503 before b299
  'neutral-core.test.cjs', // ⭐ N0-N4 (NEUTRAL-CORE, 17 Oct): no country or money → no document (NO_COUNTRY/NO_MONEY); the readers say null + a reason, never INR / Asia/Kolkata; ratchet on new India literals; an India shop unchanged
  'books-voucher-series.test.cjs', // ⭐⭐ v1.16.0: a series per voucher type (SV PV RV PY CV CN DN JV), MJ for a person's entry, counters in alphabetical order
  'books-counter-snapshot.test.cjs', // ⭐⭐ the counter is told `books: true` only when the ledger is on; dues: receivable side, latest dispute
  'books-opening-page.test.cjs', // l16: the opening balances page's server side — preview (the engine's own Difference), require_balanced, replace in one transaction, the saved view, the year strip; AU and IN shops, hand-computed
  'books-strict-input.test.cjs', // S33: every key a books route or its library reads is declared in its closed body (api #682 review, 1 Nov)
  'testing-strict-input.test.cjs', // S33: the test board's closed write bodies refuse an unknown key by name and still take every key a handler reads or a caller sends (k13)
  'till-strict-input.test.cjs', // S33: the counter's 13 live-only doors refuse an unknown key by name and still take every key the handler reads or the till sends; the 7 queueable doors stay open (S33-T moved quick-keys hide/unhide: shipped counters queued them, e5fe6136 till.html:3037,3075)
  'till-strict-replay.test.cjs', // S33 (#1103): the two counter doors the till never sends (quick-keys state, screen-config) refuse an unknown key and replay unchanged; 5 checks
  'cat124-adopt-refusal-atomic.test.cjs', // CAT-124 (#1097): a refused adopt leaves no category behind (one transaction, 8 checks)
  'platform-strict-input.test.cjs', // S33: channels platform doors and POST /api/keys refuse an unknown key by name and still take every key a caller sends (API-30 bulk pass)
  'chits-b-strict-input.test.cjs', // S33: the rest of the chits write bodies refuse an unknown key by name and still take every key a caller sends (API-30 bulk pass)
  'entities-strict-input.test.cjs', // S33: entities and relationships write bodies refuse an unknown key by name and still take every key a caller sends (API-30 bulk pass)
  'assist-strict-input.test.cjs', // S33: CB Assist and catalogue-source write bodies refuse an unknown key by name and still take every key a caller sends (API-30 bulk pass)
  'offers-products-strict-input.test.cjs', // S33: products and network-offers write bodies refuse an unknown key by name and still take every key a caller sends (API-30 bulk pass)
  'connectors-strict-input.test.cjs', // S33: connector cockpit and integrations write bodies refuse an unknown key by name and still take every key a caller sends (API-30 bulk pass)
  'till-pricing-1135.test.cjs', // CAT-352/347/340: the counter rings a tier break (12 x 50.00 = 600.00, GST 54.55), per ITEM not per line, and passes the chosen customer's groups (regular 36.00, walk-in 40.00)
];
module.exports = { GUARDS_PART };

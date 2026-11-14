/**
 * guards.cjs — RUN THE CHECKS THAT NEED NOTHING, AND SAY ONE NUMBER.
 *
 * `npm test` needs a server running; these do not. They are what must pass before anything is pushed — no database, no network,
 * a few seconds — and until now the way to run them was to remember nine filenames.
 *
 * ⚠️ WHY A SCRIPT AND NOT A SHELL LOOP. The VS Code task was first written as a cmd.exe `for %t in (…)` loop, and VS Code's
 * terminal on Windows is PowerShell, where that is a syntax error. A task nobody can run is a task nobody runs. One node script
 * behaves the same from PowerShell, cmd, Git Bash and CI.
 *
 * ⚠️⚠️ AND WHY A DECLARED LIST RATHER THAN A GLOB. The first version ran everything matching tests/*.test.js — 95 files — and
 * reported 13 failures. Most were not failures at all: traceability needs a live server ("fetch failed"), several need a
 * database. A runner that reports red for the wrong reason gets ignored within a week, and then it is reporting nothing.
 * So GUARDS is a list somebody chose. `--all` runs the rest and is honest that some of it needs a server.
 *
 *   node scripts/guards.cjs         the offline set — safe anywhere, seconds
 *   node scripts/guards.cjs --all   every test file, including the ones that need a server or a database
 *   node scripts/guards.cjs --junit test-results/guards.xml
 *                                   also write a JUnit report, one <testcase> per file, named by the board's key
 *                                   (`chitbridge-api/tests/<file>`) — CI posts it to the test board (ci.yml)
 *
 * OWNS      the declared list of offline guards (GUARDS) and the one line that says how many checks passed.
 * CALLED BY .github/workflows/ci.yml (guards job, every push), the VS Code task, by hand before every push.
 * FLOW      GUARDS ──▶ spawn each tests/<file> ──▶ read its last "<n> checks" ──▶ ok / FAIL per file ──▶ --junit ──▶ exit 1 on any FAIL
 * CARD      qa/offline-guards
 */
'use strict';
const fs = require('fs'),
  path = require('path'),
  { spawnSync } = require('child_process');
const TESTS = path.join(__dirname, '..', 'tests');

/** the offline set: no DB, no network, no server. Add one here the day it becomes true, not before. */
const GUARDS = [
  'c11-10b-rail-shape.test.cjs', // C11 10b: send names an unread price key, refuses a bad line_id, bounds retention, the one writer refuses a figure past its column, CTP_UNRESOLVABLE answers 503, cost needs a currency, list filters read before a cast, UTF-8 attachment names
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
  'line-rules.test.cjs', // RAIL-133 (e): the line-model rules that had none — a delivery row's check, progress arithmetic (mine is the headline, other units beside, adds never delivered, pending ≥ 0, agree/divergent/unacknowledged), an assignment's check and bounds, a person's done ≠ the events' done
  'ctp-manifest.test.cjs', // RAIL-140 (a): the manifest names THIS installation — our configured key, decorated only by our own row, never another active row's key
  'ctp-manifest-fetch.test.cjs', // RAIL-140 (c): a peer's manifest is read within the 5 s deadline, body included, and capped at 64 KB in BYTES as they arrive (a real local server; ~5 s)
  'till-t2a.test.cjs', // round T2a: bills-only count, an online order billed, the mode menu, no 403 on quick-keys/hidden
  'till-fix2.test.cjs', // ⭐ TILL-FIX2 (review H5 M6 L4): a reward queued behind its bill and carried by a renumber · one series lock, no duplicate number · the close's last SALE by series number
  'till-shippable.test.cjs', // the installable till carries only modules with no database behind them
  'catalogue-blueprint.test.js', // two trades, one axiom, and a product sequence that cannot collide
  'backup-guard.test.cjs', // ⭐⭐⭐ BKP1: no workflow uploads a plaintext dump; backup.sh refuses without a passphrase; the nightly is never in this public repo
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
  'money-round.test.js', // one rounder (0 wrong in 1.74 M cases, per-currency decimals) and one price reader
  'google-availability.test.cjs', // one output shape: status → Google Merchant availability; nothing Google does not define (M53)
  'one-rounding-rule.test.cjs', // ⭐⭐⭐ no platform-owned file carries a second copy of the rule; cart/pick pages load money.js first; the kit carries it (2026-09-28)
  'engine-versions.test.cjs', // ⭐⭐ a counter reports which engine release it bills with — /api/state, the snapshot call, its key (2026-09-28)
  /* ⚠️ written 2026-09-28 with the one-gate rebuild and NOT added here the same day — a guard nobody runs. */
  'till-origin.test.cjs', // ⚠️⚠️⚠️ only the counter's own page may write to the shop-PC program (critic C1)
  'counter-gates.test.cjs', // ⭐⭐⭐ ONE door to a shop (becomeShop), ONE for a person (sign-in, offline PIN), lock/break = that sign-in
  /* ⚠️ "A GUARD NOBODY RUNS" (BACKLOG, 2026-09-18) — the suite ran it, the gate never did. Added 2026-09-28. */
  'tdz-guard.test.js', // no const/let read above its declaration in the same function (node -c cannot see a TDZ)
  'gorilla-lib.test.cjs', // the gorilla generator: one seed is one run, one record replays alone, every failure carries its replay line (COLUMN-13 §4a)
  'truth-harness-partner.test.cjs', // LIFECYCLE-B4: the harness's order() and invoice() — a buy order, an invoice that names its order, item_id on every line
  /* ⭐⭐ T2-SPLIT (2026-10-14): the giant handlers became named steps — the ratchet, and the golden masters that prove nothing moved */
  'fn-size.test.cjs', // no NEW function over 80 lines in lib/ routes/ (the list may only shrink); worst complexity never rises
  'fn-size-adopted.test.cjs', // fn-size skips ADOPTED engine files (header on line 1 only); hand-written code still counts
  'touched-routes.test.cjs', // MNT-30: the touch rule for routes (report in warn mode until the switch date): touched = new or hash moved, 13/13 counted, fail mode fails below 13/13
  'readability-guard.test.cjs', // ⭐⭐ READ-GUARD (DISCIPLINES §6, 15 Oct): ONLY the code this change touched — hard limits · new cryptic name · empty catch · header · CARD · trace row · readability.ratchet.json (the web's tools/readability.cjs, from the twin checkout)
  'send-golden.test.cjs', // POST /chits/send: 40 scenarios, every SQL · copy · hook · answer = the trace frozen before the split
  'network-build-golden.test.cjs', // POST /network-design/build + /validate: 18 scenarios, the same
  'deliver-trace-golden.test.cjs', // deliver-lines · the trace walk · by-batch: 18 scenarios, the same
  'ctp-tolerant-reader.test.cjs', // RAIL-126 b: CTP inbound is a tolerant reader — a higher minor of our major is read, unknown fields ignored, another major refused CTP_VERSION_UNSUPPORTED
  'rail126-send-typed.test.cjs', // RAIL-126 (a), S33-T: POST /send types every key it names; an unknown key is ignored, a junk value in a known key is a 400, every real caller's key still goes; part (b) untouched
  'ctp-door.test.cjs', // every refusal at CTP's receiving door (/deliver, /query) — status and words, nothing written
  'network-door.test.cjs', // PLT-45/RAIL-97: the pass at CTP's door — a member/master accepts a chit only with a certificate signed by the PINNED key (lapsed, revoked, wrong key, copy: refused in words); the master's questions; standalone unchanged
  'network-cert.test.cjs', // PLT-45: the second key slot (CB_NETWORK_ROOT_KEY), the certificate (seal, bind, in date, 10-minute lapse), the cb<scope><nn>-root handles, the network wants
  'network-sync.test.cjs', // PLT-45/RAIL-96: the pulls — certificate and directory only if signed by the pinned key; registry by sequence, ids only, resync on a gap; locate verified at the far domain
  'network-tools.test.cjs', // PLT-45: the operator's three tools (network-cert · network-seed-root · network-sync) refuse in words, with their exit codes, before any write
  'installer-token.test.cjs', // PLT-45: the installer's one-time token through the one verify: its handle only, before any registered business is active, fail-closed
  'ctp-ssrf-guard.test.cjs', // SEC-80: CTP outbound fetches refuse non-https and any private, loopback, link-local or CGNAT address (DNS stubbed)
  'mint-ctp-refusal.test.cjs', // RAIL-129: a refused crossing or a crossing draft is a 409 in words (lib/knownerr), the far end's why never in the sentence, nothing local written
  'products-safe-errors.test.cjs', // SEC-83: products.js sends no raw error text; a 5xx 'Bad status' gets the safeErr line
  /* ⚠️ both red since b250/b262/b264 and outside the gate — accepted with docs/drafts/fk_b250_b262_b264_draft.sql waiting (2026-09-28) */
  'chit-status-check.test.cjs', // b773's CHECK list equals the rail's status list (DB-72)
  'migration-lint.test.cjs', // no NEW migration hides a FOREIGN KEY inside CREATE TABLE IF NOT EXISTS
  'schema-lint.test.cjs', // ⭐⭐ SCHEMA-LINT (assessment 2026-10-16): a NEW migration indexes its FKs, FORCEs its RLS, uses timestamptz and no national default, keys its once-only facts, and applies on an empty database — baseline shrinks only
  'rls-census-from.test.cjs', // DB-1 (19 Oct): rls-census --from reads Athi's editor paste with the same verdicts as a live read
  'fresh-db-check.test.cjs', // SCHEMA-FIX1: the empty-database verdict — a new failing migration fails, an accepted one that passes leaves the list
  'entity-cast-guard.test.cjs', // no NEW RLS policy casts an unset current_setting straight to ::uuid
  /* ⚠️ a guard nobody ran: the access gate for co-assists was never in this list (found 2026-09-28) */
  'sec-fix2.test.cjs', // ⭐⭐ SEC-FIX2 (review 2026-10-15): media/image server-owned + owner-prefixed object keys (C4) · the network store reads the edges, its order needs a flag and a customer (C6) · assist writes behind auth (M3) · key revoke owner-only (L1) · no raw error text as why (L2)
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
  'acc-206-readers.test.cjs', // ACC-206 C2-C4: every reader of a bill total is built from counterBill.billTotalSql / pickOf; the beckn quote says 189 for the pre-2-Nov invoice
  'money-reader-scan.test.cjs', // ACC-206 G1: no raw read of the bill total outside the one pick; each named exception carries its reason (SCAN_SELFTEST=1 proves it bites)
  'cost-margin-basis.test.cjs', // ACC-206 C1: the owner's chit margin is on the taxable value, one case per matrix column (tests/lib/bill-total-fixtures.cjs)
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
  'send-suspended.test.cjs', // NET-7: a SUSPENDED member's send is refused 403 MEMBERSHIP_SUSPENDED in words (one standing() read); active, no edge, draft, self-chit pass
  'public-stock-visibility.test.cjs', // ⭐ TOP-CORRECT 5: the anonymous stock doors (/integrations/stock/:handle, /ask/:handle/stock) obey the storefront's visibility — private/closed/network = the same 404 as no shop
  'network-view.test.js', // QA wave 1 (FR-N5/N6): one shopfront over many departments - a private department is absent, categories are never invented, search finds only what is shown
  'ppl-40-reset-revokes-sessions.test.cjs', // PPL-40: a code or PIN reset (DELETE /:id/pin, POST /:id/otp) unlists every session the person opened, leaves a colleague's, and ends them before the new code is written
  'cat-277-source-owner-only.test.cjs', // CAT-277: PUT /api/assist/catalogue-source is the owner's: a co-assist and a key are refused 403 OWNER_ONLY with no query; the owner still authors
  'net-53-closed-shop-not-searched.test.cjs', // NET-53: a closed shop is not searched in its network (availability fast path + fan-out, GET /stores); the open shop stays; a failed closed-shop read falls back to the filtered fan-out
  'actors-switch-off.test.cjs', // QA wave 1: the owner's switch off / remove / back on of a person (PUT /api/actors/:id/status): the write, the cleanup counts, the refusals
  'supplier-list-crud.test.cjs', // QA wave 1: PATCH only the caller's own supplier row, UNKNOWN_FIELD, a real business is not renamed; DELETE owner-only, 404, the CRM's one remove
  'availability.test.js', // QA wave 1: a stock figure carries its date, an absent figure is never zero, a stale one never outranks a fresh one (lib/availability)
  /* ⭐ what the application can work out about a shop without asking it — country decides tax, money and every
     format, so the rule that it must return UNKNOWN rather than guess is a guarded one (registration) */
  'govcontext.test.js',
  /* ⚠️ the INSERT and b264 must agree about the columns — a misspelt one is invisible offline and surfaces
     on a real shop's first sign-up, as a failed audit row on the one event it exists to record */
  'signup-context.test.js',
  /* ⚠️ the same set of choices must always make the same line, and a different set never the same one —
     both failures are silent, and the bill stays arithmetically correct while being wrong */
  'variant.test.js',
  'rewards.test.js', // what a point is worth, and what a ledger may do — it touches money
  'reward-cycle.test.js', // the SEQUENCE: earn, come back, encash, expire, register — against the real store
  'sql-runner.test.js', // a tool that runs SQL at production: its WITH/WITHOUT RLS line must be true
  'stock-cycle.test.js', // the log and the cache must stay in step — through a replay, a minus, and a corrupted balance
  'storefront-stock-ledger.test.js', // ⭐⭐ T1-INV: one stock truth — a no-connector shop's storefront shows its OWN ledger; a connector shop its stamp
  'made-to-order.test.cjs', // ⭐ R104: a dish made to order is not stock — one resolver (lib/stocked), one flags query, a NAMED skip not_stocked, onHand/asAt { counted_only }
  /* ⚠️⚠️ IT WAS NOT IN THIS LIST until 2026-09-10, so the one guard that asks 'is every module classified,
     and does everything unreachable say so' only ran when somebody remembered to. It caught an unclassified
     lib the same minute it was added here. A guard outside the suite is a guard nobody runs. */
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
  'tax-vendor.test.js',
  'tax.test.js', // GST determination: same-state split, inclusive pricing, INV-01 shape, paisa rounding, reverse charge — was red on main unguarded (K3)
  /* ⭐ a migration that says 'idempotent' has to be. Every file from b240 ends in PROOFS, and those are only
     reachable by re-running it — so one that errors on a second run is one nobody can re-verify. */
  'migration-rerunnable.test.cjs',
  /* ⭐ three desks × routed/unrouted × network/no-network is twelve paths through ONE function, and eleven are
     the ones nobody will ever click. Athi: *"if we can figure out all the combination and a single helpdesk
     works for all, nothing like it."* This is what keeps it single. */
  'support-desks.test.cjs',
  'raiseticket-why.test.cjs',
  /* ⭐ node -c parses, it does not resolve: a const declared in one function and read in the next compiles
     perfectly and throws on the first real request. Three times in one day's work. */
  'scope-leak.test.cjs',
  /* ⚠️ summary_json is built from a WHITELIST and drops anything else in silence. It has eaten two riders:
     detail_design, then routed_by - the whole support-ticket trace, passed and never stored, in the same
     session as the comment in lib/mint.js warning about it. */
  'mint-riders.test.cjs',
  /* ⚠⚠ 55 tables are FORCE RLS. Read one with no app.current_entity and you get an empty set - not an
     error. Three near-misses in one day, and one reached a commit message asserting a function was lying
     when the function was right and the check was blind. */
  'rls-context.test.cjs',
  /* [REV-19] the guard's own tracked-table lists drift the same way the tables they watch grow — this checks
     both against db/rls-baseline.json instead of trusting the last person who remembered to update them. */
  'rls-guard-baseline.test.cjs',
  'rls-open-ratchet.test.cjs', // SEC-75: every open readable table is classified (dictionary / entity / shared / platform-private); the non-dictionary count only falls
  'sec-75-actor-settings-entity.test.cjs', // SEC-75 P1 slice: every statement on entity_actor_settings runs under withEntity (b842)
  'sec-75-shared-tables-entity.test.cjs', // SEC-75 + DB-103: b855 locks six shared tables; every statement on them runs bound to a shop; break test on the policies
  'rls-predicate.test.cjs', // ⚠️ every policy reads a GUC something sets — written, never declared, so never run
  'migration-rls.test.js', // a new table closes itself; the default grant makes an open one readable
  /* ⭐ CTP step 2: the address seam. Every address local, no wire - and the test asserts the two claims that
     matter: ONE query for five copies (it costs nothing while nothing is remote), and a remote copy refused
     BEFORE any write rather than half a chit delivered. */
  'ctp-address.test.cjs',
  'money-origin.test.cjs', // ACC-192: money computed once at the origin, carried, never recomputed by a copy
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
  /* ⭐⭐ THE SOFTWARE ASSETS. Athi: "each capability has to be proven without the concept of chit… that will
     be our software asset." Ten modules, each proven ALONE (its require() list is empty or a language
     builtin) and proven to ANSWER something, with no database, no network and no chit. */
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
  /* ⭐⭐ MINT a user id and RESOLVE one — every combination in one place (lib/mintuserid.js), every reading in
     another (lib/resolveuserid.js). § 0 holds the customer form byte-identical to what production already
     stores: one character of drift and every returning customer becomes a second identity. */
  'userid.test.cjs',
  /* ⭐⭐ THE CONSTITUTION MATRIX — one cascade, two doors. A party arriving over CTP has no entity row here, so
     it used to resolve, silently, as base @ platform-0. Now it resolves from ITS installation (the b254 rule)
     and every answer says resolved_from + fallback. Also: in lib/, only govresolve may resolve a constitution. */
  'govresolve-ctp.test.cjs',
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
  'books-post.test.cjs', // ⭐⭐ the one writer: balances both grains, gap-free JV, locks, reversal, cheques, carryforward
  'books-hooks.test.cjs', // ⭐⭐ what a chit posts — and a failed post NEVER fails the chit (parked, named)
  'books-country.test.cjs', // ⭐ CX2: the books speak the shop's country — IN · AU · AE (core ≥ v1.42, money, zone, year label, depreciation basis)
  'books-routes.test.cjs', // /api/books: 404 while off, owner-only writes, the shapes the Ledger screen reads
  'books-minor-exponent.test.cjs', // ACC-179: write-off · payment · opening · entries in the currency's own decimals (INR 2 · JPY 0 · KWD 3), INR unchanged
  'books-pages.test.cjs', // ⭐ PERF1: Day book + Ledger pages (keyset, server max, server totals) add up to the whole; lib/page-limit
  'testing-pages.test.cjs', // ⭐ T2-PAGING: the test board's five lists page (total · page · limit, lib/page-limit max); an old High is never cut
  'list-paging-guard.test.cjs', // ⭐ T2-PAGING ratchet: unpaged list GETs ≤ the frozen number (W1-PLAT: 0); every allowance has its reason
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
  'books-preview.test.cjs', // ⭐⭐ ＋ Entry: the preview's lines ARE the posted lines (one composeEntry), Dr = Cr, type + golden rule per line, locked month, blocked credit, writes nothing
  'books-rcm.test.cjs', // ⭐ v1.20.0: a purchase under reverse charge posts the buyer's own tax (2204–2206), paid in cash only at the GST close / challan
  'books-year.test.cjs', // ⭐ v1.20.0: the year close — refused in words (running, open months, Suspense), then every month hard-locked, next year opens on the carry-forward, idempotent
  'books-year-country.test.cjs', // ⭐ ACC-204 (AU-18b): an AU year close waits for every BAS period (422 PERIOD_RETURN_OPEN, the labels), the month lock stays allowed and names its period, a close under an old label still reads closed
  'acc-336-close-reads-period.test.cjs', // ⭐ ACC-336/336b: the GST close reads the head net before payments (add-back), posts the surplus as tax paid in advance, replays by paid_entries; 86 checks
  'acc-331-currency-cells.test.cjs', // ⭐ CUR-1 (ACC-331/332): a bill's payment parts and lines and a journal's lines name the document's currency or none; 409 CURRENCY_MISMATCH naming the field
  'acc-198-tax-unknown.test.cjs', // ⭐ ACC-198 (S5-1, R13): tax registration nobody stated is a QUESTION — country-setup.registrationOf answers unknown + TAX_REGISTRATION_UNKNOWN; a freshShop's sale (IN, AU) waits with the question, never posts at a guessed rate
  'acc-221-unreadable-number.test.cjs', // ⭐ ACC-221 (+222): a figure the caller sent that is not a number (abc, NaN, Infinity, blank, null price) is NAMED and refused (BAD_QTY / BAD_PRICE / BAD_RATE, thrown as line_unreadable), never priced at 0 and said ok; engines num() follow-up
  'acc-265-cancel-credit-note.test.cjs', // ⭐ ACC-265: a sale with a live credit note against it is not cancelled (409 CHIT_HAS_CREDIT_NOTE at /void and PUT /status), asked after paid, under the cap's own lock and reader; real-Postgres run: acc-265-cancel-credit-note.realstack.cjs
  'acc-265b-note-after-cancel.test.cjs', // ⭐ ACC-265b: a credit note against a cancelled or rejected bill is refused (409 BILL_WITHDRAWN, billOf's own withdrawn flag); a sale with a live note is not REJECTED either (rail WITHDRAWN list); real-Postgres: acc-265b-note-after-cancel.realstack.cjs
  'acc-328-opening-twice.test.cjs', // ⭐ ACC-328/329: the same opening posted twice is 409 BOOKS_CONFLICT (a retry of the same ref still replays), a NEW opening dated in the future is 422; a reversal of an old future opening still works
  'acc-286-credit-note-cap.test.cjs', // ⭐ ACC-286: a counter credit note cannot credit more than its bill (409 CREDIT_NOTE_OVER_BILL), four in a row and ten at once, under the bill's lock
  'fin-77-parallel-payments.test.cjs', // ⭐ FIN-77: two full-due payments at once settle once (the duplicate question is asked under the party lock); IN and AU
  'acc-283-refund-gap.test.cjs', // ⭐ ACC-283: a refund that is not the credit note's total waits in words with gap_minor (AU A$69.00 for A$68.98); equal and credit-only refunds post
  'acc-272-unknown-registration.test.cjs', // ⭐ ACC-272: POST /api/tax/compute and /api/invoice/build ask a shop with no tax number that never said it is registered (409 TAX_REGISTRATION_UNKNOWN, the till's own code), never price it at no tax; confirmed unregistered still 0%
  'acc-282-compute-refuses-bad-lines.test.cjs', // ⭐ ACC-282: a discount (with offers) above its line is 400 BAD_PRICE and a runaway amount 400 CHIT_AMOUNT_TOO_LARGE on /api/tax/compute and /api/invoice/build
  'cat-251-reprice-tiers.test.cjs', // ⭐ MONEY W1 M5 (CAT-251): reprice from the catalogue asks the one price reader (services.priceLine), so a tier is honoured: 20 kg -> 80.00, 5 kg -> 100.00
  'fin-books-doors-strict.test.cjs', // ⭐ MONEY W1 M6 (FIN-54/60/79/82/83/84/86): the books' payment and opening doors read minor units, direction, dates, party ids strictly; supplier rows carry balance_words
  'fin-ledger-guards.test.cjs', // ⭐ MONEY W2 M7b (FIN-88/92/100, CAT-127): repeated or open bill ref refused, an opening resent without client_ref is a replay, a loan instalment cannot exceed what the loan owes, a month pack needs a locked month
  'line-door-one-guard.test.cjs', // CTRY-134: one line-door guard (services.lineRefusal, widened: BAD_LINE and BAD_BOUND) on tax/compute, tax/rate, invoice/build, pricing/price, offers/evaluate
  'acc-311-journal-whole-minor.test.cjs', // ⭐ ACC-311: a manual journal entry with a fractional or over-ceiling minor amount is refused 422 BOOKS_REFUSED, nothing posted
  'acc-225-gstr1-b2cl.test.cjs', // ⭐ ACC-225: ONE GSTR-1 builder (the adopted gst-returns.gstr1): an inter-state B2C bill over ₹1 lakh (Notfn 12/2024) lands in Table 5 b2cl, under it in b2cs; the old limit before Aug 2024; a large B2C credit note in cdnur; no second builder in tax-lines
  'acc-200-cash-rounding.test.cjs', // ⭐ ACC-200: a counter bill's payment gap posts as round-off only inside the books pack's cash step (AU 5c on cash); none = exact, so an IN bill 50p short waits, named
  'books-recurring.test.cjs', // ⭐ b281 draft: recurring entries — 503 until migrated, proposed by default, a re-run never posts twice, the daily sweep reverses a due accrual once
  'books-todo-unposted.test.cjs', // ACC-342: a bill the books did not take reaches the To do
  'books-todo.test.cjs', // ⭐ the To-do feed: each kind from a real check, only what needs doing, and each row gone when it is done
  'cat210-rate-owner-only.test.cjs', // CAT-210: a tax rate is owner or manager only on every door (PATCH · bulk-update · create · schedule), one rule in lib/rate-door, the whole request refused in words, may_set_rate on the payload
  'cat282-parallel-merge.test.cjs', // CAT-282: three parallel merge PATCHes of one product keep every edit (row lock on the write's transaction), one version per real change
  'cat326-parked-column.test.cjs', // CAT-326: a column with a change parked for a date is in use: the delete and retype doors refuse with the count
  'tax-facts.test.cjs', // CMP-13: lib/tax-facts.taxFactsOf, one case per rule, an unlisted scheme refused, nothing said stays unknown (fail-closed)
  'cat211-rate-doors.test.cjs', // CAT-211: a category's rate (PUT/POST /definitions, the retire takeover) and the shop default (PUT /catalogue-face) are owner or manager only, the whole request refused in the one rate sentence, nothing written; no other writer of the two defaults
  'ctr182-gstin-owner-only.test.cjs', // CTR-182: the shop's GSTIN is the owner's on every door (till POST /shop · PATCH /entities/profile · PUT /governance/profile/vault · POST /integrations/profile): a clerk and a manager refused 403 OWNER_ONLY with nothing written, owner and a key pass, may_set_tax_id on can-see-costs
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
  'books-voucher-type-write.test.cjs', // ⭐ b279 ran 2026-10-03: every new entry stores its voucher TYPE; a manual MJ Payment reads Payment
  'ingest-iot-offline.test.cjs', // ⭐ TEST-INGEST-IOT: key none/unknown/inactive → 401; malformed body → 400 never 200; ERP replay → ONE chit, 'duplicate'; stats counts
  'sec3-device-keys.test.cjs', // ⭐ SEC3: a device key addresses only its shop + its parties; the connector switch holds it; /events/stats is the operator's; a failed chit is not a 200; the shop's money; Zoho tax list holds the order; the simulator is local by default
  'erp-ingest-idempotency.test.cjs', // ⭐ CON-ERP-IDEM: erp-ingest keys on the Idempotency-Key, else doc_ref, else the hash; a failed outcome chit is a 503 and its retry makes the chit; a stale pending receipt is claimed again; the same key with another body is 422 (the proof of machine_keyed in api-hardening-scope.json)
  'con-159-ingest-replay.test.cjs', // ⭐ CON-159: POST /ingest dedupes only on the caller's own Idempotency-Key or event_id (erp-receipt claimReceipt, hashFallback off): same key twice = one chit + replay, no key = two chits, same key in two shops = two, other body = 422
  'country-setup.test.cjs', // ⭐ CS1: register → Country setup → India pack on; a pack-less country refused with ITS sentence on every books route; existing Indian shops untouched; owner-only; 503 before b299
  'neutral-core.test.cjs', // ⭐ N0-N4 (NEUTRAL-CORE, 17 Oct): no country or money → no document (NO_COUNTRY/NO_MONEY); the readers say null + a reason, never INR / Asia/Kolkata; ratchet on new India literals; an India shop unchanged
  'books-voucher-series.test.cjs', // ⭐⭐ v1.16.0: a series per voucher type (SV PV RV PY CV CN DN JV), MJ for a person's entry, counters in alphabetical order
  'books-counter-snapshot.test.cjs', // ⭐⭐ the counter is told `books: true` only when the ledger is on; dues: receivable side, latest dispute
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
  'connectors-ingest-not-money.test.cjs', // POST /api/connectors/ingest is a device reading, in money_reviewed_not and not in money_writes (Athi 12 Nov)
  'catalogue-strict-input.test.cjs', // S33: catalogue enquiry and photo-extract bodies refuse an unknown key by name and still take every key a caller sends (API-30 bulk pass)
  'books-replay.test.cjs', // FIN-63 step 2: the fingerprint and the replay rule of a repeated confirm (pure; window 2 min, latest live batch by item_id)
  'books-payments.test.cjs', // ⭐⭐⭐ M26: /payments/preview + one-call record — W1–W4 (PAY D5, 24 h) → 409 unless acknowledged; allocations in the SAME tx; one client_ref posts once; outcome words
  'books-bank-rail.test.cjs', // BR1: GET /bank/rail — my advice + bank-question copies, on-rail parties, may.ask by the rail ladder; one read each
  /* ⭐⭐ THE TWO-SIDED COUNTER BILL (2026-10-01) — broken once each by scripts/two-sided-breaks.cjs */
  'tax-copy.test.cjs', // who sells on each copy: a counter bill I RECEIVED is my purchase, never in my GSTR-1
  'c11-10c-tax-month.test.cjs', // C11 10c: ACC-302 one unreadable expense chit is named in dropped and the month keeps every other bill's ITC; SPD-18 a month's parties are one identities read, ledger identical to the per-copy path; ACC-276 whole-minor words
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
  'privacy.test.cjs', // CO1: consent append-only + may/why, the request register's legal clock + answered once, the public facts; 503 before b306/b307
  'crm-followups.test.cjs', // follow-ups CRUD, assignment (owner or assignee), late in the SHOP's day, the 503 before b276
  'crm-sweep.test.cjs', // the nightly sweep rings the bell once a day per assignee, nothing sensitive on the event
  /* ⭐⭐⭐ THE WEB'S CONTRACT (2026-10-03: the CRM list failed live - roles an OBJECT, the page read a list) — chitbridge-web keeps a copy and holds its stand-ins to it */
  'api-17-query-day.test.cjs', // API-17: a ?since= that is not a day (7, -1, abc, 2026-02-30, twice) answers 400 VALIDATION_FAILED on folders/mis, relationships/scorecard and capture/consolidate, the db never asked
  'api-invalid-json.test.cjs', // API-14: a body that is not JSON (cut off, null, a string, a number) answers 400 INVALID_JSON on every route, not 500
  'api-auth-first.test.cjs', // API-37: every route that needs a sign-in answers 401 signed out, with a uuid in each :param and a junk body - never 404, 400, 422 or 500 (S6 auth first)
  'api-nul-input.test.cjs', // API-15: a NUL byte in a body or query answers 400 INVALID_CHARACTER at the door, not 500 from Postgres
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
  'cat-m9b-definition-doors.test.cjs', // M9b (CAT-272/273/333): reward numbers bounded, parallel definition saves lock + stale version 409, freeze list capped at 500 uuids
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
  'api-reported.test.cjs', // CAP-17 slice 1: the three reported register columns (BFLA role gates, parameterised SQL, rate limit) are counted from the real routes and never enter meets; a role gate refuses a lower role 403
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
  'ctr-213-invoice-lease.test.cjs', // CTR-213 (ACC-192 S2): a till leases blocks of invoice numbers from the one counter: two tills, expiry, offline block, gap, outside, refill, the lock key
  'acc192-credit-note.test.cjs', // ACC-192 1b: IN/AU/AE credit note over the changed lines only, half-up per line, the books keep the original and add the note
  'chit-proposals.test.cjs', // RAIL-106 part 4: one proposal mechanism on ONE chit (rounds, seller computes, accept stores the seller's invoice byte for byte); ACC-192 1b: a decrease on an issued invoice is one credit note, a raise is refused, the buyer applies only when the seller confirms
  'acc192-invoice-issued.test.cjs', // ACC-192 slice 1a: an issued invoice (books entry · frozen_at · a carried tax invoice) is never rewritten by a round or an amend; the money edits are told from a comment fix; quotations and pro-formas still re-issue
  'send-seller-currency.test.cjs', // RAIL-106: a send is priced in the SELLER's money; a seller on another installation prices its own goods
  'api-problem-testing.test.cjs', // API-4 sweep, the test board: every refusal of routes/testing.js (33 routes) is a Problem with its old keys frozen; no 5xx says its cause; another shop's id answers as an unknown one (S35)
  'api-problem-attachments.test.cjs', // API-4 sweep, the attachments: every refusal of routes/attachments.js (2 routes) is a Problem with its old keys frozen; a copy for every participant and one for an internal message; the S2 download headers; no 5xx says its cause; another shop's id answers as an unknown one (S35)
  'api-problem-bell.test.cjs', // API-4 sweep, the bell: every refusal of routes/events.js and routes/notifications.js (6 routes) is a Problem with its old keys frozen; the stream opens with a ticket in ?t= and ?ticket=, its frames and heartbeat unchanged; no answer says its cause; notif_dismissed has no foreign key, so a foreign log_id is no oracle
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
  'crm-remove-walkin.test.cjs', // "Remove from my parties" (owner, no dues, hides, deletes nothing); walk-in → party moves the points by rewards.claim
  /* ⭐⭐⭐ DISPUTE CONFIDENTIALITY — THE USP RULE (N02, 2026-10-07): written before any extraction; per-copy RLS modelled, definers transcribed */
  'dispute-scoping.test.cjs', // roster-only visibility · no notice to a non-party · per-party resolve; KNOWN BREAKS printed loud (section 5)
  'message-once.test.cjs', // RAIL-136 (d): a message's copies and its timeline line commit together, so a retry after a 500 posts it once
  'sec-fix3.test.cjs', // SEC-FIX3: S1-S11 — one scenario each, red on main, green on the fix
  /* ⭐⭐ THE BOARD HEARS ABOUT IT (2026-10-07) — offline: the real route over a stand-in db */
  'junit-board.test.js', // a report folds to one row per (run, case, layer); the guards' own JUnit reads back by the board's key; the testing scope; CI posts after red
  'cost-never-to-employees.test.cjs', // [OFFR-04] cost off every export/history/till/supplies read for an actor without can_see_costs
  'cat239-adopt-cost-blind.test.cjs', // CAT-239: the adopt offer drops the supplier cost (any depth) for a cost-blind co-assist; a blind combo push is refused
  'rail146-chit-cost-blind.test.cjs', // RAIL-146: the chit reads (GET /:chit_id · /inbox · /folder · /sent · /rollup) carry no cost to a cost-blind co-assist; a sales chit stays priced; the owner's answer is untouched
  'rail146b-work-cost-blind.test.cjs', // RAIL-146b: the work reads (GET /api/work/list · /facts?unbilled=1 · /:chit_id) carry no purchase money to a cost-blind co-assist; a sales row stays priced; whole-body scan, fail closed
  'ctr-178-stock-repost.test.cjs', // CTR-178: a counter sale whose after-commit stock post failed or was lost is found (no movement under its ref) and posted again; a post that still fails is said; sendStock and sendReplay call the sweep
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
  'sec101-iddoc-hash.test.cjs', // SEC-101: Aadhaar (store:false) stored with a KEYED hash (HKDF of VAULT_ENC_KEY), legacy sha256 still recognised, no key = 503; PHONE/EMAIL hashes byte for byte unchanged, sign-in + device-key match still find the person
  'sec106-staff-code-hash.test.cjs', // SEC-106: a staff first code is kept as a KEYED hash (HKDF of VAULT_ENC_KEY, otp_code_hash), never plain; verifyOtp compares the hash, every issue zeroes the attempts and writes a code_issued trail row; an idempotent answer carrying a code is never stored; b781 written, not run
  'register-gate.test.cjs', // RAIL-90: the register is a per-shop capability — off (403 CAPABILITY_OFF) for a shop with no key and no rows; on with the key; on with existing rows and no key
  'raida-close-route.test.cjs', // RAIL-93: POST /api/chits/:chit_id/raida/:raida_id/close passes the worklist's disposition (and carried-forward register, evidence) to raida.close; a full register's ending writes its closing row
  'sides.test.cjs', // CB Sides: driftOf (resolver) + the impact walk (lib/impact, shared with raida.walk) + GET /api/entities/sides is ONE read; a source with no data is a 'not yet' row, never a number
  'entities-header.test.cjs', // N19: GET /api/entities/header is ONE read (<= 3 trips); planted compliance rows -> bands from lib/licence-rules.js; unverified PHONE -> check false; no rule -> days only; no fee amount hard-coded
  'prefs-merge.test.cjs', // CU2: every ui_prefs / locale_prefs write is an RFC 7386 merge-patch — a theme save keeps product_rows and the keys it did not send; '' / null removes; no `= $n` whole-column write
  'limiter-paths.test.cjs', // M07: every public door (walked from the real app) has a limiter of its own; pair/claim, check-login, storefront sign-in on the strict auth budget; existing limits unchanged
  'con-100-101-capture-input.test.cjs', // CON-100/101 (BH-8, BH-15): capture convert and stores answer a plain 4xx (a non-uuid id 404 NOT_FOUND; a chit_id or a phone that is not text 400 VALIDATION_FAILED), the db never asked, no driver text; a valid call still 200
  'limiter-answer.test.cjs', // API-16 (BH-5): every limiter (the 240/min service one through the real app, the rest at max 1) answers 429 problem+json RATE_LIMITED with Retry-After and the same seconds in params; first request passes
  'k1-path-uuid.test.cjs', // K-1 (API-10): an address id that is not a uuid -> 404 NOT_FOUND problem+json through lib/problem.js uuidParam, the database never asked; one row per closed route
  'retired-routes-404.test.cjs', // retire-7 (12 Nov): the 7 retired routes answer 404 JSON with a token; their neighbours still answer
  'rail146l-suppliers-cost-blind.test.cjs', // RAIL-146l: GET /api/relationships/suppliers puts balance_minor on a row only for a reader who may see costs (null + cost_hidden for a cost-blind login)
  'net-48-connection-input.test.cjs', // NET-48 (BH-9): POST /api/network/connections and /api/connections/request name someone who cannot exist (bad uuid, wrong type, bad handle or bridge id) -> 404 problem+json before the database; a valid call still reaches the service
  'rail-161-service-catches.test.cjs', // RAIL-161: GET, resolve, pause and answer on /api/service answer a fault as problem+json 500 INTERNAL (no driver text), a known Postgres refusal as its mapped 4xx, a success unchanged
  'employee-first-signin.test.cjs', // 2026-10-08 Athi: employee's first code (unsealed, DEV_OTP) signs in AND answers requires_pin_setup on every door; PIN then works; sealed never takes the fixed code
  'tester-code.test.cjs', // SEC1: TESTER_CODE (env, 8+, timing-safe over SHA-256) signs in on verify only; fixed codes on a LOCAL stack only; TESTER_NAMES; never logged/answered; no fixed code in what ships; SEC1b daily {yymmdd} code (IST, yesterday until 06:00) + TEMPORARY boot warning
  'people-srv1.test.cjs', // PEOPLE-SRV1: switch-off/remove signs the person out (sessions by person, keys by maker: counter closed, others revoked) in one transaction; owner marks away (OWNER_ONLY · NOT_FOUND · SWITCHED_OFF; stand-in in the shop); may.remove/away; GET /api/facts/people
  'people-writes-sec2.test.cjs', // SEC2: no answer of any /api/actors route holds a code (pin_state instead); every people write is the owner's (403 OWNER_ONLY + why); e-mail stored + edited; connector code through generateOTP('connector')
  'limit-settings.test.cjs', // SEC-125: a typo, empty, negative, huge numeric setting fails CLOSED to the safe default (164 checks; real server.js sign-in limiter, every converted site)
  'limits.test.cjs', // E01: 9 MB on a non-upload route -> 413 BODY_TOO_LARGE; 30 s request deadline -> 503 REQUEST_TIMEOUT (late answer swallowed); 57014 -> 503 STATEMENT_TIMEOUT; parsers after id+logger
  'request-log.test.cjs', // E07: request id minted (uuid) or kept (plain token), echoed and on the log line; every line JSON with entity/person/bytes; slow query -> one line, fingerprint only, no SQL text; /health db + version
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
  'ai-one-pipe.test.cjs',
  'assign-merge-patch.test.cjs',
  'connect-10d-input-shape.test.cjs', // C11 batch 10d (12 Nov): a chit line goes to someone on the team (one reader with the follow-up door, nothing written for a stranger), an offer's text is text, a shopper name fits its column, a new quick-key group is typed like a changed one; 42 checks
  'auth-first-routes.test.cjs',
  'baseline-from-snapshot.test.cjs',
  'books-close-country.test.cjs',
  'books-day-bills.test.cjs',
  'books-day-country.test.cjs',
  'books-hooks-kinds.test.cjs',
  'books-returns.test.cjs',
  'p1-7-bas-basis.test.cjs',
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
  'till-t2d.test.cjs',
  'till-t2j.test.cjs',
  /* QA-80 (22 Oct): six whose expectations had gone stale (US pack, hasColumn probe, compare-and-set, N1 move, re-wrapped routes) - updated to the current truth */
  'country-crm-shop.test.cjs',
  'crm-viewer.test.cjs',
  'pay-fix-renumber.test.cjs',
  'pay-fix-void.test.cjs',
  'rail-216-void-paid.test.cjs', // RAIL-216: a payment on the invoice blocks the seller's void (also in NEEDS_ENGINES: runs over the books harness)
  'rail-paid-reject.test.cjs', // RAIL-216 follow-up: a paid invoice is refused for rejected as for cancelled (the rail's own WITHDRAWN list)
  'std2-one-reading.test.cjs',
  'till-t2c.test.cjs',
  /* QA (24 Oct): two landed walk fixes no runner reached - R14 a party's phone and e-mail are kept or refused in words; R58 the shop's sales offer never cuts a supplier's receipt */
  'party-contact-patch.test.cjs',
  /* CRM-43 (29 Oct): merged_into names only a party of this shop; the b782 trigger function reads each table's own column only inside its own IF branch */
  'party-merge-target.test.cjs',
  'party-merge-guard-sql.test.cjs',
  'r58-no-sales-offer-on-receipt.test.js',
  'books-payables.test.cjs', // MNT-47: CB FINANCE payables ageing, MSME day 45, early-pay offer
  'move-in.test.cjs', // MNT-47: move in from Xero / QuickBooks - guessed columns, dry run, write through the doors
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
  'net-98-reducers.test.cjs', // NET-98 S1: the pure reducers split out of the view's libs, one definition each (guard); the real-Postgres differential is net-98-differential.realstack.cjs (local stack)
  'openapi-services.test.cjs', // QA wave 2: the public services API document documents every real route of offers, pricing, tax, invoice, keys - and no phantom
  'api-foreign-bite.test.cjs', // API-1 S35 bite: a foreign-id case can FAIL (a store that ignores the owner is caught, on the helper and on the real chits routes); every public_ids / cannot_answer exemption carries a reason and names a real route
  'regression-harness.test.cjs', // MNT (11 Nov): scripts/regression.js never claims a pass it did not see (HARNESS ERROR, PASS 0; non-party checks accept only 403/404); offline, no server
  'incidents.test.js', // CMP-29: an incident is refused without an account of what happened, in words, before anything is written
  'line-complete.test.cjs', // 1 line model (wave 3): a line that asked for nothing is not done; the roll-up counts only genuinely finished lines
  'work-rows.test.cjs', // 1 line model (wave 3): GET /api/work list / row / sheet through the real router: folders, stage words, per-line delivery, truncation, RLS, one batch not a query per row
  'worklist-unassigned.test.cjs', // 1 line model (wave 3): work nobody picked up still appears on the worklist (no assignment row is not invisible)
  'docnumber.test.js', // 9 returns (wave 3): the numbering rules per jurisdiction, the credit-note series, no Indian rule escapes into a country not studied
  'user-id-rule.test.cjs', // 18 user id (wave 3): the User ID rule through the real route handlers over a stubbed database
  'round-trips.test.cjs', // 28 performance (wave 3): GET /me has a round-trip budget and it is enforced
  'round-trips-chit.test.cjs', // 28 performance (wave 3): opening a chit has a round-trip budget too
  'trips-headers.test.cjs', // 28 performance (wave 3): the round-trip counter answers the right people and nobody else
  'may-trade.test.cjs', // 28 worlds (wave 3): mayTrade is the database rule asked at the door; the trigger clauses and the helper SQL agree
  'sit-load-evidence.test.cjs', // 28 load simulation + performance (wave 3): the RECORDED SIT knee/stress/load runs agree with themselves and are not stale (a record, not a live run)
  'books-cashflow.test.cjs', // 16 cash position (wave 3): lib/books-cashflow.project shortfall and no-shortfall to the minor unit, GET /cashflow and the cheques pdc_reminders over the in-memory books (repaired: payments need an Idempotency-Key)
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
  'retired-routes-404.test.cjs', // the 7 routes retired 2026-11-12 (DECISIONS d05560bf) answer 404 as JSON for every method and a signed-in caller
  'api-tolerant-till.test.cjs', // S33-T: the counter's queued doors (flags, stock, stock/bulk, reward, reward/claim, quick-keys hide/unhide) and POST /api/chits/send ignore zz_unknown, take the keys older counters sent, refuse a wrong kind 400 in the problem shape
  'api-tolerant-doors.test.cjs', // S33-T (#1105-#1108): every tolerant door ignores an unknown key and refuses a known key of the wrong kind; the strict catalogue doors name the key they refuse (44 checks)
  'till-queue-poison.test.cjs', // S33-T: the counter's own drain parks a refused queued row (400) with the server's words and sends the rows behind it; a refused bill is never deleted
  'till-park.test.cjs', // till-park (12 Nov): a queued CHANGE refused for good (400/404/409/422) is parked once with the server's words, never retried; a bill never parked; Drop is the owner's; the price grain (JPY 0, INR 2, KWD 3) refuses a finer typed price and rounds a bulk step
  'ctr-204-till-hold.test.cjs', // CTR-204 (till half, api #1240): a sale answered 409 CHIT_REPLAY_DIFFERS is HELD (no retry, the server's words), one cashier confirm renumbers it; TILL_SERIES_COLLISION still auto-renumbers
  'ctr-227-no-country-bill.test.cjs', // CTR-227 (k78, enrolled with the merge): a bill with no country is refused in words
  'ctr-155-114-till.test.cjs', // CTR-155 + CTR-114: a 403 MEMBERSHIP_SUSPENDED holds that one bill and the queue goes on (a plain 403 still stops it); usignBecome clears busy when becomeShop throws
  'ctry-72-no-country-refusal.test.cjs', // CTRY-72: a shop with no country gets words, never the rupee (products lists money_why, tax slabs, legacy catalogue service)
  'ctry-139-band-asof.test.cjs', // CTRY-139 (engines v1.86.0): the law-set price band is read as of the shop's day of the document
  'ctry-139-number-at.test.cjs', // CTRY-139: the number-at read of the adopted engine
  'ctry-139-till-band.test.cjs', // CTRY-139: the till's band, same as the api's
  'ctr-242-till-shop-day.test.cjs', // CTR-242+CTR-180: every till day cut (lists, close, closed mark, summary key) is the shop's day, 00:10 IST/AEDT
  'set86-country-setup-merge.test.cjs', // SET-86 (P1): PUT /country-setup is a merge-patch; omitted tax unchanged (4.76 on 100.00 at 5% inclusive), confirmed de-registration, stray key refused
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
  'testnews.test.cjs', // U1 (8 Nov, was run by no CI job): THE LOOP CLOSES, AND IT CLOSES ON THE RIGHT PERSON.
  'till-no-country-boot.test.cjs', // U1 (8 Nov, was run by no CI job): CTRY-94 regression: a shop with no country must not abort the counter's boot. billMoney() (reached from paintTotals at load) calle
  'change-pin-lock.test.cjs', // U1 (8 Nov, in no GUARDS array): PPL-30: change-pin counts a wrong current PIN and honours the lock (was named only in NEEDS_ENGINES, which skips and never runs)
  'change-pin-lock-mutation.test.cjs', // U1 (8 Nov, in no GUARDS array): PPL-30: with the count-and-lock removed the test above goes red (was named only in NEEDS_ENGINES)
  'db-error-survives.test.cjs', // U1 (8 Nov, in no GUARDS array): PLT-86: a database fault survives the mutation routes (was named only in NEEDS_ENGINES)
  'db-error-survives-mutation.test.cjs', // U1 (8 Nov, in no GUARDS array): PLT-86: with each handler removed the test above goes red (was named only in NEEDS_ENGINES)
  'itemmatch-corpus.test.cjs', // U1 (8 Nov, in no GUARDS array): the item-match corpus (was named only in NEEDS_ENGINES)
  'itemmatch-corpus-mutation.test.cjs', // U1 (8 Nov, in no GUARDS array): the corpus mutation set (was named only in NEEDS_ENGINES)
  'query-shape.test.js', // QA-172 (14 Nov): the per-file query budget (a query inside a loop) and the trigram check; was red and unenrolled
  'every-test-is-enrolled.test.cjs', // U1 (8 Nov, the guard): U1 (8 Nov): every tests/*.test.(js|cjs) is run by a CI job or is on a named, ratcheted known list; the api half of the map measure tests_not_in_ci
  'country-literals.test.cjs', // CTRY-DATA (11 Nov): the country-literal ratchet — every file of lib/ routes/ middleware/ outside the packs holds its baseline [code ccy name law], class a (belongs in a pack) b (generic) c (adapter); a rise or an unexplained fall fails; the twin of engines #116
  'assist-resolve-retired-gone.test.cjs', // API-49: the retired POST /api/assist/resolve is deleted and nothing still names it
  'assist-resolve-retired-gone-mutation.test.cjs', // API-49: with the route put back the test above goes red
  'books-reconcile.test.cjs', // ACC-302 (13 Nov): one unreadable copy is NAMED in `dropped`, never throws the month (was on KNOWN_NOT_ENROLLED) // API-49: with the route put back the test above goes red
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
];

/** the number a guard proved: its last "<n> checks" or "<n> passed" (QA-79), else node:test's "pass <n>" line (spec reporter ℹ, TAP reporter #); 0 = it proved nothing */
function countChecks(out) {
  const countMatches = out.match(/(\d+)\s+(?:checks|passed)/g) || out.match(/(?:ℹ|#) pass (\d+)/g); /* node:test: "ℹ pass n" on a terminal, "# pass n" (TAP) in CI */
  if (countMatches) return Number(String(countMatches[countMatches.length - 1]).match(/\d+/)[0]);
  /* U1 (8 Nov): two more honest shapes the enrolled files print, tried ONLY when the shapes above found nothing (so no old guard's count moves):
     "<n> ok, <m> failed" and a file that prints one "ok …" / "✓ …" line per check and ends "all ok" with no number (a count of those lines; none = 0 = proved nothing) */
  const okFailed = out.match(/(\d+) ok, \d+ failed/g);
  if (okFailed) return Number(okFailed[okFailed.length - 1].match(/\d+/)[0]);
  return (out.match(/^\s*(?:ok|✓)\s/gm) || []).length;
}

const all = process.argv.indexOf('--all') >= 0;
const files = all
  ? fs
      .readdirSync(TESTS)
      .filter((item) => /\.test\.(js|cjs)$/.test(item))
      .sort()
  : GUARDS.filter((item) => {
      if (fs.existsSync(path.join(TESTS, item))) return true;
      console.log('  ⚠️  ' + item + ' is listed but missing — renamed, or deleted without updating this list');
      return false;
    });

/**
 * ⚠️ CI WITHOUT THE ENGINES REPO (2026-09-28). chitbridge-engines is PRIVATE; CI clones it only when the
 * ENGINES_READ_TOKEN secret exists. Without it, exactly these two guards cannot run — measured by moving the repo
 * aside and running the whole gate: every other guard passed. They are SKIPPED ONLY when CB_ENGINES_ABSENT_OK=1
 * (the CI job sets it) AND the repo is really absent, and each skip is printed as a CI warning, never a pass.
 * Locally the variable is unset, so a missing engines repo still FAILS as it always did.
 */
/* 2026-10-07: the books guards (tests/support/books-harness.cjs) load the books engines from the sibling repo too, so
 * without it they ran with no engine and failed with 0 checks (CI run 37414852968, red since 2026-10-06). Measured
 * the same way: these are exactly the CI failures, and each passes locally with the engines present. */
const NEEDS_ENGINES = [
  'fin51-payment-safe-repeat.test.cjs',
  'books-close-country.test.cjs',
  'books-returns.test.cjs',
  'p1-7-bas-basis.test.cjs',
  'pay-fix.test.cjs',
  'rcm-post.test.cjs',
  'engines-pinned.test.js',
  'tax-vendor.test.js',
  'books-collections.test.cjs',
  'books-fixes.test.cjs',
  'books-dates-tz.test.cjs',
  'fx-dates-tz.test.cjs',
  'books-period.test.cjs',
  'books-preview.test.cjs',
  'books-rcm.test.cjs',
  'books-year.test.cjs',
  'books-year-country.test.cjs',
  'books-recurring.test.cjs',
  'books-todo-unposted.test.cjs',
  'books-todo.test.cjs',
  'books-manual-events.test.cjs',
  'books-voucher-series.test.cjs',
  'two-sided-books.test.cjs',
  'pay-fix-void.test.cjs', // QA-80: runs the real chits router over the books harness
  'rail-216-void-paid.test.cjs', // RAIL-216: a payment on the invoice blocks the seller's void (B2B, counter bill, named bill), over the books harness
  'change-pin-lock.test.cjs', // PPL-30: change-pin counts a wrong current PIN and honours the lock like sign-in (verifyCredential, 5 tries, ASVS V2.2.1)
  'change-pin-lock-mutation.test.cjs', // PPL-30: with the count-and-lock removed the test above goes red
  'itemmatch-corpus.test.cjs', // CAT-75: the itemmatch tolerance per product family on a hand-computed corpus; CAT-261: numbers, units, sizes, grades exact, a near-miss ASKS
  'itemmatch-corpus-mutation.test.cjs', // CAT-75: the corpus goes red under exact-match and under the old per-token tolerance on numbers and sizes
  'db-error-survives.test.cjs', // PLT-86: a pool error and a held-client error are logged, the process lives, the next query gets a fresh connection
  'db-error-survives-mutation.test.cjs' // PLT-86: with each handler removed the test above goes red
];
const ENGINES_ABSENT = !fs.existsSync(path.join(__dirname, '..', '..', 'chitbridge-engines'));
const SKIP_ENGINES = ENGINES_ABSENT && process.env.CB_ENGINES_ABSENT_OK === '1';

/**
 * ⭐⭐ THE BOARD HEARS ABOUT IT (2026-10-07). Athi opened the test board and saw 0 results, while this gate ran green on
 * every push. `--junit <file>` writes what ran as JUnit — lib/junitresults.write, the same module that READS it on the
 * server — and CI posts that file (ci.yml, guards job). ⚠️ The testcase NAME is the board's case key, exactly as
 * data/test-cases.json spells it (`chitbridge-api/tests/<file>`), so the post uses key_from 'name' and nothing is guessed.
 * A skip is written as a skip, never a pass; a failure carries the lines this script already prints for it.
 */
const junitAt = process.argv.indexOf('--junit');
const JUNIT = junitAt >= 0 ? path.resolve(process.argv[junitAt + 1] || 'test-results/guards.xml') : null;
const KEY = (f) => 'chitbridge-api/tests/' + f;
const report = [];

let total = 0,
  failed = [],
  started = Date.now();
console.log(all ? '— every test file (some need a server) —' : '— the guards —');

for (const text of files) {
  if (SKIP_ENGINES && NEEDS_ENGINES.indexOf(text) >= 0) {
    console.log('  skip  ' + text.replace(/\.test\.(js|cjs)$/, '').padEnd(22) + '   — needs chitbridge-engines (private; set ENGINES_READ_TOKEN)');
    console.log('::warning::' + text + ' skipped — chitbridge-engines is not checked out (add the ENGINES_READ_TOKEN secret)');
    report.push({ name: KEY(text), status: 'skipped', message: 'needs chitbridge-engines (private), not checked out' });
    continue;
  }
  const startedAt = Date.now();
  const spawned = spawnSync(process.execPath, [path.join(TESTS, text)], { encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { OUTPUT_ALLOWLIST: 'enforce' }) /* S34: the gate runs the output allow-list for real; production defaults to report */ });
  const out = (spawned.stdout || '') + (spawned.stderr || '');
  /* every guard ends with "<n> checks"; take the LAST one, because a stray warning can print after it */
  const checkCount = countChecks(out);
  /* ⚠️ A GUARD THAT COUNTED NOTHING PROVED NOTHING (2026-09-17: three guards ended without "<n> checks" and read "ok · 0") */
  const broken = spawned.status !== 0 || /\bFAIL\b/.test(out) || checkCount === 0;
  total += checkCount;
  if (broken) failed.push(text);
  console.log('  ' + (broken ? 'FAIL' : ' ok ') + '  ' + text.replace(/\.test\.(js|cjs)$/, '').padEnd(22) + String(checkCount).padStart(4) + ' checks');
  const list = broken
    ? out
        .split('\n')
        .filter((item) => /FAIL|Error|expected/i.test(item))
        .slice(0, 5)
        .map((item) => item.trim())
    : [];
  if (broken) console.log(list.map((item) => '          ' + item).join('\n'));
  report.push({
    name: KEY(text),
    status: broken ? 'fail' : 'pass',
    time: (Date.now() - startedAt) / 1000,
    /* ⚠️ never an empty reason: a red row on the board with no words is a question nobody can answer */
    message: broken ? (list.length ? list.join('\n') : checkCount === 0 ? 'counted no checks' : 'exit ' + spawned.status) : '',
    output: broken ? out.split('\n').slice(-40).join('\n') : ''
  });
}

if (JUNIT) {
  fs.mkdirSync(path.dirname(JUNIT), { recursive: true });
  fs.writeFileSync(JUNIT, require('../lib/junitresults').write('guards', report));
  console.log('  JUnit → ' + path.relative(process.cwd(), JUNIT) + ' (' + report.length + ' files)');
}

console.log('  ' + '─'.repeat(40));
console.log(
  '  ' +
    total +
    ' checks · ' +
    files.length +
    ' files · ' +
    Math.round((Date.now() - started) / 100) / 10 +
    's · ' +
    (failed.length ? failed.length + ' FAILED: ' + failed.join(', ') : 'all passed')
);
process.exit(failed.length ? 1 : 0);

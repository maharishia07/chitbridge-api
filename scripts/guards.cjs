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
  'pages-parse.test.js', // every inline script in app.html, till.html and promo.html parses
  'endpoint-usage.test.cjs', // janitor (23 Oct): the wide endpoint run: a comment is no call, a dynamic segment meets only a :param, a bucket follows its best evidence
  'till-vendor.test.js', // the counter and its vendored engines agree, byte for byte
  'amend-live-set.test.cjs', // RAIL-128: b138 liveSet / liveLines / shape check (scripts/prove-amend.js), pure, no DB
  'till-who-signin.test.cjs', // R132: a picked name carries who they are (PIN or first code, never "type your ID"), the refusal names what to use, one PIN ask, no "connect to a shop" under a signed-in box
  't3-fixes.test.cjs', // T3-FIXES: one cost gate on every price write · each received batch its own lot · profile writes the shop · sign-in keeps the constitution
  'till-rcv-batches.test.cjs', // STK-FIX1b: at the till a second scanned batch of the same product is its own receiving line (rcvLineFor), never merged onto line 1
  'governance-entity-own.test.cjs', // SEC (23 Oct): a shop's governance view is its own; another shop's id answers the unknown id's 404
  'shop-clock-guard.test.cjs', // ⭐⭐ Y1: one shop clock — no raw new Date()/Date.now() in the ledger files; set/advance/reset proven
  'register-sums.test.cjs', // W4 (30 Oct): the endpoint count cannot drift — register total = Σ route files = Σ API groups, each exception a named row
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
  'vertical-resolver.test.cjs', // ⭐ VERT-1/VERT-8: ONE answer to the shop's trade (govresolve.verticalOf); the five readers ask it; the Price Lab opens on the trade's list
  'trade-srv1.test.cjs', // ⭐ TRADE-SRV1: AU/AE lanes (b538), origin/sector stated or ASKED (never IN/paint), ?abroad=1, papers by deal, the day's rate, may/why on trade writes
  'profile-write-gate.test.cjs', // ⭐ SEC-71: PUT /profile, PUT /profile/vault, PATCH /entities/profile sit behind lib/access.writeGate — a viewer/commenter is refused with the rail's sentence, owner and editor pass
  'write-route-gate.test.cjs', // ⭐ SEC-72: every write route is gated (writeGate), behind auth (hat-gate fails closed), or allow-listed with a reason — a new public/viewer-writable write route fails here
  'migration-numbers.test.cjs', // ⭐⭐ one number, one migration — two parallel rounds both wrote b299 (12 Oct); a clash fails here
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
  'readability-guard.test.cjs', // ⭐⭐ READ-GUARD (DISCIPLINES §6, 15 Oct): ONLY the code this change touched — hard limits · new cryptic name · empty catch · header · CARD · trace row · readability.ratchet.json (the web's tools/readability.cjs, from the twin checkout)
  'send-golden.test.cjs', // POST /chits/send: 40 scenarios, every SQL · copy · hook · answer = the trace frozen before the split
  'network-build-golden.test.cjs', // POST /network-design/build + /validate: 18 scenarios, the same
  'deliver-trace-golden.test.cjs', // deliver-lines · the trace walk · by-batch: 18 scenarios, the same
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
  'read-batch-entity.test.cjs', // EFF-TRIPS: readBatch carries a statement per entity in ONE trip (the brands' released offers)
  'network-offers-shape.test.cjs', // EFF-TRIPS: GET /api/network-offers answers the pre-change shape row for row, in ≤ 4 trips (golden)
  'people.test.cjs', // ⭐ P1: GET /api/people — one statement, the caller's shop only, may/why per action, owner-only greyed with its sentence
  'network-validate.test.cjs', // P2: the dry-run validate of a designed network — names what would break, posts nothing
  'sim-load.test.cjs', // ⭐⭐⭐ Y1b: the simulator's loader refuses every non-local database; one plan for Y1 and Y1b; the chit carries the shop clock
  'round-trips-till.test.cjs', // ⭐⭐ the counter's snapshot has a trip budget: its own five tables in ONE transaction, 50 → 38 (M36, 2026-09-29)
  'till-network-source-cost.test.cjs', // CTR-171: a source shop's cost keys never reach the till (adopted lines through the one strip)
  'rev16-delta-cursor-stamped-first.test.js', // ⭐⭐ a delta's cursor never skips a change — stamped before the read; past the cap sent in parts (2026-09-28)
  'screen-snapshot.test.cjs', // ⭐⭐⭐ SNAP-SCREEN · CFD-03: a TV key's snapshot + bell carry no customer/supplier/staff/cost — an allow-list; a counter unchanged
  'snapshot-wire.test.js', // what a counter receives AFTER JSON — the Map that cost the shop its tax
  'one-name-one-function.test.cjs', // two functions, one name: the loser hoists away in silence
  'docnumber-scheme.test.cjs', // the bill number's shape: what the date says vs when the run restarts
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
  'rls-predicate.test.cjs', // ⚠️ every policy reads a GUC something sets — written, never declared, so never run
  'migration-rls.test.js', // a new table closes itself; the default grant makes an open one readable
  /* ⭐ CTP step 2: the address seam. Every address local, no wire - and the test asserts the two claims that
     matter: ONE query for five copies (it costs nothing while nothing is remote), and a remote copy refused
     BEFORE any write rather than half a chit delivered. */
  'ctp-address.test.cjs',
  'money-origin.test.cjs', // ACC-192
  'rollup-currency.test.cjs', // REP-50
  'ctp-internal-wire.test.cjs', // RAIL-98..101: a chit between our own installations: envelope id, worded far-end refusals, manifest domain, add by address
  'money-origin.test.cjs', // ACC-192: money computed once at the origin, carried, never recomputed by a copy
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
  'books-pages.test.cjs', // ⭐ PERF1: Day book + Ledger pages (keyset, server max, server totals) add up to the whole; lib/page-limit
  'testing-pages.test.cjs', // ⭐ T2-PAGING: the test board's five lists page (total · page · limit, lib/page-limit max); an old High is never cut
  'list-paging-guard.test.cjs', // ⭐ T2-PAGING ratchet: unpaged list GETs ≤ the frozen number (W1-PLAT: 0); every allowance has its reason
  'page-limit.test.cjs', // ⭐ LIM2: the ONE pager — limitOf · pageOf · pageArgs (not asked = every row) · pageOut (the envelope), every rule and edge
  'idempotency.test.cjs', // ⭐ LIM2: idempotency off is never silent — warn + held in memory; a retry replayed or 409, another body 422, X-Idempotency: unverified
  'idempotency-after-auth.test.cjs', // SEC (finding 2, 23 Oct): a replay answers only after the route's own auth — revoked session / removed device / deactivated actor get the fresh refusal; a 401 is never recorded; public money doors unchanged
  'canon-depth.test.js', // a 2000-deep body: the canon throws cleanly and the idempotency gate self-heals (calls next) — it had failed unseen, in no list
  'books-tally.test.cjs', // ⭐⭐ the pack's Tally files come from the connector's adapter — one Tally writer, Receipt byte-identical
  'books-collections.test.cjs', // ⭐ CB Finance F1: /dues?finance=1 — limit · over_limit · interest SHOWN · owner only; plain /dues untouched
  'finance-one-due.test.cjs', // ⭐ R73/R75/R76 (24 Oct): ONE due figure — books-engines.netOpen nets a receipt on account against the bill; Remind (due_minor), Cash and the age bucket all ₹490; lowest = a day's row; rent template in the 30-day view; early-pay in rupees
  'books-fixes.test.cjs', // ⭐⭐⭐ the red-team findings of 2026-09-30 (M1–M12), each held by a check that was red before its fix
  'books-dates-tz.test.cjs', // ⭐⭐ a date read back from Postgres is the same date under Asia/Kolkata and UTC (it runs itself in both)
  'books-period.test.cjs', // ⭐⭐ v1.14–v1.16: asset register (b280 draft), depreciation, closing stock, GST close + challan, loans, accruals, contra — the engine's lines, once, locked, owner-only
  'gstr-one-source.test.cjs', // ⭐⭐ Fable 2026-10-23 f1-3: the rail GSTR-3B counts the chits the books count, in the shop's month; equals GST close's balances per head; 3.1 split (a)(b)(c)(e)
  'books-preview.test.cjs', // ⭐⭐ ＋ Entry: the preview's lines ARE the posted lines (one composeEntry), Dr = Cr, type + golden rule per line, locked month, blocked credit, writes nothing
  'books-rcm.test.cjs', // ⭐ v1.20.0: a purchase under reverse charge posts the buyer's own tax (2204–2206), paid in cash only at the GST close / challan
  'books-year.test.cjs', // ⭐ v1.20.0: the year close — refused in words (running, open months, Suspense), then every month hard-locked, next year opens on the carry-forward, idempotent
  'books-year-country.test.cjs', // ⭐ ACC-204 (AU-18b): an AU year close waits for every BAS period (422 PERIOD_RETURN_OPEN, the labels), the month lock stays allowed and names its period, a close under an old label still reads closed
  'acc-200-cash-rounding.test.cjs', // ⭐ ACC-200: a counter bill's payment gap posts as round-off only inside the books pack's cash step (AU 5c on cash); none = exact, so an IN bill 50p short waits, named
  'books-recurring.test.cjs', // ⭐ b281 draft: recurring entries — 503 until migrated, proposed by default, a re-run never posts twice, the daily sweep reverses a due accrual once
  'books-todo.test.cjs', // ⭐ the To-do feed: each kind from a real check, only what needs doing, and each row gone when it is done
  'cat210-rate-owner-only.test.cjs', // CAT-210: a tax rate is owner or manager only on every door (PATCH · bulk-update · create · schedule), one rule in lib/rate-door, the whole request refused in words, may_set_rate on the payload
  'cat211-rate-doors.test.cjs', // CAT-211: a category's rate (PUT/POST /definitions, the retire takeover) and the shop default (PUT /catalogue-face) are owner or manager only, the whole request refused in the one rate sentence, nothing written; no other writer of the two defaults
  'till-rate-door.test.cjs', // ⭐ F5 A1: the counter's item carries its tax facts (gst_rate · categories[] · hsn from sac, never code); POST /rate refuses a key and a cashier in words, an owner/manager sets it once (idempotent); Veg Meals ₹120 inclusive at 5% through the engine
  'books-manual-events.test.cjs', // ⭐⭐ expense / other income / capital / drawings / staff advance + recovery: hand-worked lines, MJ + voucher type, double tap once, owner-only, the system gives a ledger's code
  'books-voucher-type-write.test.cjs', // ⭐ b279 ran 2026-10-03: every new entry stores its voucher TYPE; a manual MJ Payment reads Payment
  'ingest-iot-offline.test.cjs', // ⭐ TEST-INGEST-IOT: key none/unknown/inactive → 401; malformed body → 400 never 200; ERP replay → ONE chit, 'duplicate'; stats counts
  'sec3-device-keys.test.cjs', // ⭐ SEC3: a device key addresses only its shop + its parties; the connector switch holds it; /events/stats is the operator's; a failed chit is not a 200; the shop's money; Zoho tax list holds the order; the simulator is local by default
  'country-setup.test.cjs', // ⭐ CS1: register → Country setup → India pack on; a pack-less country refused with ITS sentence on every books route; existing Indian shops untouched; owner-only; 503 before b299
  'neutral-core.test.cjs', // ⭐ N0-N4 (NEUTRAL-CORE, 17 Oct): no country or money → no document (NO_COUNTRY/NO_MONEY); the readers say null + a reason, never INR / Asia/Kolkata; ratchet on new India literals; an India shop unchanged
  'books-voucher-series.test.cjs', // ⭐⭐ v1.16.0: a series per voucher type (SV PV RV PY CV CN DN JV), MJ for a person's entry, counters in alphabetical order
  'books-counter-snapshot.test.cjs', // ⭐⭐ the counter is told `books: true` only when the ledger is on; dues: receivable side, latest dispute
  'books-payments.test.cjs', // ⭐⭐⭐ M26: /payments/preview + one-call record — W1–W4 (PAY D5, 24 h) → 409 unless acknowledged; allocations in the SAME tx; one client_ref posts once; outcome words
  'books-bank-rail.test.cjs', // BR1: GET /bank/rail — my advice + bank-question copies, on-rail parties, may.ask by the rail ladder; one read each
  /* ⭐⭐ THE TWO-SIDED COUNTER BILL (2026-10-01) — broken once each by scripts/two-sided-breaks.cjs */
  'tax-copy.test.cjs', // who sells on each copy: a counter bill I RECEIVED is my purchase, never in my GSTR-1
  'bill-paper.test.cjs', // ⭐ CTRY-76: a tax invoice of A$1,000 or more names its buyer (reg-au s.29-70(1)(c)(ii)) — held under not_invoice, never a stop; a bad buyer ABN/GSTIN is refused by the ONE check (profile.taxIdRefusal)
  'page-name.test.cjs', // ⭐ N03: every chit names its detail page at mint (base by default); an unknown name is refused; nothing rewrites it
  'two-sided-bill.test.cjs', // a till sends its own on-rail customer their copy — and nobody else; one shop row; replay-safe
  'goods-in-accepts.test.cjs', // goods-in, every line in → accepted through the SAME transition as Intake
  'two-sided-books.test.cjs', // one bill, two ledgers: sale at save, purchase on acceptance
  'bill-use.test.cjs', // what a bill I received is for — resale · use · asset — and what each posts; stock only for resale
  /* ⭐⭐⭐ ONE INVOICE, EVERYWHERE (2026-10-02) — broken once each by scripts/tax-truth-breaks.cjs */
  'tax-truth.test.cjs', // one counter bill read six ways (bill · chit · both ledgers · reprint · buyer's read), equal to the paisa; place of supply = the shop's state
  /* ⭐⭐ THE BILLS FOLDER (2026-10-01) — broken once each by scripts/bills-folder-breaks.cjs */
  'marketing-results.test.cjs', // ⭐ MKT-4: Who came back counts only SENT offers matched to real bills inside the shop's came_back_days (14 → 20 moves 3 to 4); a 0 carries its reason; before b776 a code, never a 500
  'marketing-outbound.test.cjs', // ⭐ MKT-2/17: Offers sent are receipts with the person, purpose, send and consent basis (b776 columns only once they exist); refusals in one INSERT; the list pages; select takes counterparty_ids/until
  'bills-folder.test.cjs', // the folder inventory numbered with the ledger; view folders; the step function; bills leave Task — nothing else
  'bills-private.test.cjs', // ⭐⭐ a bill's steps stay with the shop that took them, at the folder's messaging level; only the dispute always crosses
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
  'api-nul-input.test.cjs', // API-15: a NUL byte in a body or query answers 400 INVALID_CHARACTER at the door, not 500 from Postgres
  'cmp-22-23-input.test.cjs', // CMP-22/23: a non-uuid identity_id on the identity-document routes answers 403 IDOC_SUBJECT_FORBIDDEN and a badly typed or impossible (2026-02-30) field of POST /api/kyb/credential 400 VALIDATION_FAILED, before the database
  'api-18-text-cap.test.cjs', // API-18: kind/name of POST /api/definitions, name of POST /api/keys and id of POST /api/integrations/heartbeat are capped at 200 characters; longer is a 400 before the database
  'api-problem.test.cjs', // API-1 slice 1a: the one error body (lib/problem.js), the legacy keys frozen, routes/keys.js + the 404 and error handler answer it
  'api-4b-auth-problem.test.cjs', // API-4b: the sign-in 401 and the requireScope 403 of middleware/auth.js are a Problem (problem+json, registered code) with error/message/code/pending frozen and the same status; a good token still passes
  'api-problem-till.test.cjs', // API-4 sweep, till: every refusal of routes/till.js (the counter's 41 routes) is a Problem with its old keys frozen; the till's offline answers keep every key; no 5xx says its cause
  'api-problem-books.test.cjs', // API-4 sweep, accounts and finance: every refusal of routes/books.js, routes/tax.js and routes/invoice.js is a Problem with its old keys frozen; no 5xx says its cause
  'api-problem-marketing.test.cjs', // API-4 sweep, marketing: every refusal of routes/marketing.js, offers.js and combo-templates.js is a Problem with its old keys frozen; no 5xx says its cause
  'offers-published-contract.test.cjs', // api #350 hold: the offer service's published OpenAPI is typed (body, required, 429) while the enforced schema stays loose
  'api-problem-governance.test.cjs', // API-4 sweep, governance: every refusal of routes/governance.js is a Problem with its old keys frozen; the foreign id of GET /entities/:id is the unknown id's 404; no 5xx says its cause
  'api-problem-chits.test.cjs', // API-4 sweep, chits: every refusal of routes/chits.js is a Problem with its old keys frozen; no 5xx says its cause; the schemas agree with the validator chains they replaced
  'api-problem-finance.test.cjs', // API-4 sweep, folders, Home facts and pricing: every refusal of routes/folders.js, routes/facts.js and routes/pricing.js is a Problem with its old keys frozen; no 5xx says its cause
  'shop-actors.test.cjs', // SEC-103: actorOwned is true only for an actor of this shop; foreign, unknown and no-uuid are false, a database that is down is an error
  'sec100-folder-fk.test.cjs', // SEC-100: no write puts another shop's folder into a folder foreign key (rules, parent on create and move, routing); a foreign id and an unknown id answer alike, nothing is written
  'repeat-supply-status.test.cjs', // REPEAT-500: the repeat store reads a copy's status from chit_status through lib/select.rows, never h.current_status
  'api-problem-orders.test.cjs', // API-4 sweep, orders and workflow: every refusal of routes/repeat-supply.js, routes/work.js and routes/counters.js is a Problem with its old keys frozen; no 5xx says its cause; another shop's id answers as an unknown one (S35)
  'ord-73-repeat-input.test.cjs', // ORD-73 (BH-7): /api/repeat accept · counter · decline · skip answer 400 for a chit_id that is not a uuid (abc, true, -1, 1e21) and 404 for a bad agreement id, never 500 with driver text
  'ops-74-supplies-id.test.cjs', // OPS-74: PATCH /api/supplies/:id and POST /:id/issue answer 404 NOT_FOUND for an id that is not a uuid, never 500 with driver text
  'api-problem-crm.test.cjs', // API-4 sweep, the CRM: every refusal of routes/crm.js (24 routes) is a Problem with its old keys frozen (consent, privacy requests, the send gate unchanged); no 5xx says its cause; another shop's id answers as an unknown one (S35)
  'api-problem-relationships.test.cjs', // API-4 sweep, the relationships: every refusal of routes/relationships.js (14 routes) is a Problem with its old keys frozen; no answer carries a thrown error's text; another shop's list row answers as an unknown one
  'api-problem-schemas.test.cjs', // API-4 sweep, the schema engine: every refusal of the 7 routes of routes/schemas.js is a Problem with its old keys frozen; no success answer moved; no answer of any status carries a thrown text bar the one listed relay; every body is closed (an unknown key is refused by name) and the web's keys are accepted; another shop's column key answers as an unknown one
  'api-problem-integrations.test.cjs', // API-1 slice 1c: every refusal of routes/integrations.js is a Problem with its old keys frozen; no 5xx says its cause
  'api-problem-ctp.test.cjs', // API-1 slice 1d: routes/ctp.js — every answer to another installation a Problem that keeps `accepted`/`ok` and `why`, on both mounts
  'api-problem-storefront.test.cjs', // API-1 slice 1e: the 11 public storefront doors of routes/catalogue.js — a Problem that keeps the old body, strict input, closed 200s, one 404
  'api-problem-products.test.cjs', // API-4 sweep, the catalogue items: every refusal of the 26 routes of routes/products.js is a Problem with its old keys frozen, no success answer moved, the old chains agree with the schemas; no 5xx says its cause
  'api-problem-network.test.cjs', // API-4 sweep, the network: every refusal of src/routes/network.js, routes/network-design.js and routes/connections.js (23 routes) is a Problem with its old keys frozen; no 5xx says its cause; the writes switched off answer 503; another shop's id is asked as an unknown one (S35, findings printed, evidence pinned); the schemas agree with the connections' old validator chains
  'api-problem-actors.test.cjs', // API-4 sweep, the people: every refusal of the 17 swept routes of routes/actors.js (GET /check-login, POST /set-pin and POST /login are routes/signin.js's aliases: recorded byte for byte, never judged) is a Problem with its old keys frozen; no success answer moved; no answer carries the database text; the frozen 503s are replayed; another shop's id is asked as an unknown one (S35, findings printed, evidence pinned)
  'ppl-26-actors-input.test.cjs', // PPL-26/BH-12: settings, person edits, check-key, suggest-key and delegate refuse a list or an object in words (400 INVALID_INPUT, field named), a non-uuid person id is a 404, the database never asked, nothing written; valid calls still 200
  'ppl-28-actors-create.test.cjs', // PPL-28: POST /api/actors (add a person) refuses a list, an object, or a string where a number or flag belongs (400 INVALID_INPUT, field named), 0 writes; a valid add still succeeds
  'api-problem-entities.test.cjs', // API-4 sweep, the entities: every refusal of the 25 routes of routes/entities.js (sign-in apart, which is recorded byte for byte, never judged) is a Problem with its old keys frozen; no success answer moved; no 5xx says its cause; the platform doors answer in the Problem body; another shop's id is asked as an unknown one (S35, findings printed, evidence pinned)
  'api-problem-assist.test.cjs', // API-4 sweep, the assistant: every refusal of the 22 routes of routes/assist.js is a Problem with its old keys frozen; the assistant's 503 and 502 (the answers the web client falls through on) are replayed word for word; no success answer moved; no answer of any status says a failure's cause; the two public reference reads are listed as findings by the foreign-id world
  'api-problem-catalogue.test.cjs', // API-4 sweep, the rest of the catalogue: the shopper's orders and documents, the product enquiries, the photo read and the catalogue face — every refusal a Problem with its old keys frozen, no success answer moved
  'api-problem-chit-proposals.test.cjs', // API-4 sweep, the proposal doors (RAIL-106): every refusal of the 5 routes of routes/chit-proposals.js is a Problem with its keys frozen at the first contract; every body closed (S33); no answer says a failure's cause; another shop's chit id answers as an unknown one (S35)
  'ctp-return-path.test.cjs', // RAIL-106: the return path — a status another installation decided is mirrored on the shadow row through the one status write; sequence, repeat, late message (db and transport stubbed)
  'ctp-return-disputes.test.cjs', // RAIL-106 part 2: a dispute raised or resolved elsewhere is recorded here through recordRaise / recordResolve; confidential scoping kept
  'ctp-return-gaps.test.cjs', // RAIL-106 part 3: void, cancel flags, attachments by reference, the bell, every local party's timeline row, the message limit
  'ctp-return-door.test.cjs', // RAIL-106: the event kind at the one door (routes/ctp.js): same checks as a copy, applied to our rows only
  'ctp-window-shopping.test.cjs', // RAIL-107: a chit from a business this installation holds no row for — the sender is found by bridge id and a stub is made
  'chit-proposals.test.cjs', // RAIL-106 part 4: one proposal mechanism on ONE chit (rounds, seller computes, accept stores the seller's invoice byte for byte)
  'send-seller-currency.test.cjs', // RAIL-106: a send is priced in the SELLER's money; a seller on another installation prices its own goods
  'api-problem-testing.test.cjs', // API-4 sweep, the test board: every refusal of routes/testing.js (33 routes) is a Problem with its old keys frozen; no 5xx says its cause; another shop's id answers as an unknown one (S35)
  'api-problem-attachments.test.cjs', // API-4 sweep, the attachments: every refusal of routes/attachments.js (2 routes) is a Problem with its old keys frozen; a copy for every participant and one for an internal message; the S2 download headers; no 5xx says its cause; another shop's id answers as an unknown one (S35)
  'api-problem-bell.test.cjs', // API-4 sweep, the bell: every refusal of routes/events.js and routes/notifications.js (6 routes) is a Problem with its old keys frozen; the stream opens with a ticket in ?t= and ?ticket=, its frames and heartbeat unchanged; no answer says its cause; notif_dismissed has no foreign key, so a foreign log_id is no oracle
  'api-problem-supplies.test.cjs', // API-4 sweep, the supplies: every refusal of the 5 routes of routes/supplies.js (what a shop buys to use: list, add, edit, purchase, issue) is a Problem with its old keys frozen; no success answer moved; no answer of any status carries a thrown text; another shop's supply id answers as an unknown one (S35); an id in a body reaches no statement unscoped
  'ops-72-duplicate-bill.test.cjs', // OPS-72: a bill number used before is answered in words — the same bill again is "already recorded" (0 counted), the same supplier's number with other lines is a 409, another supplier's bill counts
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
  'ops-5-delivered-stock.test.cjs', // OPS-5 (ST-19): goods counted in against a supplier bill I received (deliver-lines, resale) post purchase rows GI:<delivery_id> once; own use / asset / charge / unmatched name / receipt already raised move nothing and say why
  'rail146c-receipt-carry.test.cjs', // RAIL-146c: a cost-blind co-assist's goods receipt carries the order's stored price (RAIL-149's carry widened), a figure of his is a 403, a null price is a no_cost skip, never rate 0
  'rail146c-till-cost-blind.test.cjs', // RAIL-146c: the till reads (GET /api/till/tasks · /match) carry no purchase money to a cost-blind co-assist; a sales order stays priced; the owner and the paired till key read as before; whole-body scan, fail closed
  'rail146e-crm-unbilled-cost.test.cjs', // RAIL-146e: the Parties list's per-party unbilled money is partial for a cost-blind co-assist (RAIL-146b rule per party); owner byte-identical; whole-body scan
  'rail146i-dues-cost-blind.test.cjs', // RAIL-146i: a party's supplier-side balance (what the shop owes) and supplier credit limit never reach a cost-blind co-assist on GET /api/crm/parties, /parties/:id or GET /api/books/dues; a customer's balance stays; owner byte-identical; whole-body scan
  'm3-invoice-one-builder.test.cjs', // M3: the invoice answer of a copy is built once (lib/tax-copy invoiceFrom); a connector key reaches /api/invoice/:id (200) and not /api/tax/invoice/:id (403)
  'rail146g-doors-cost-blind.test.cjs', // RAIL-146g: the rail's chit list (GET /api/facts/rail/chits), the bell, GET /api/folders/groupsum and the tax invoice (GET /api/invoice/:id · /api/tax/invoice/:id) carry no purchase money to a cost-blind actor (a viewer without can_see_costs included); a sale stays priced; whole-body scan, fail closed
  'rail146j-folder-cost.test.cjs', // RAIL-146j: GET /api/folders/:id/chits (filed and view folder) and /:id/metrics hide the purchase money from a cost-blind co-assist
  'rail146k-blind-measure.test.cjs', // RAIL-146k: ONE blind-aware measure (money only over the shop's own sales, else null + cost_hidden) for reconcile, mis, the scorecard, folder metrics and who-came-back; the routes/ guard: no route measures itself
  'rail147-amend-cost-gate.test.cjs', // RAIL-147: POST /:chit_id/amend and /reprice refuse a cost-blind co-assist's price or money key on a cost-side chit (403 COST_BLIND, nothing written); a quantity-only amend keeps the stored price; a sales chit and the owner as before
  'rail149-draft-cost-carry.test.cjs', // RAIL-149 HOTFIX: POST /chits/send with promote_draft_id from a cost-blind co-assist carries the draft's stored line money (never null over it); a figure sent is 403 COST_BLIND; an added line carries no money; the owner and a sale-side draft as before
  'rail-r11-connector-frozen.test.cjs', // RULE-MATRIX p15 (R11): POST /integrations/books and /books/skip change only the books · books_log · books_skip riders (the rest byte-identical); tools/tally-connector/core.js never calls a chit writer (scan + a recorded run)
  'cat235-create-cost-gate.test.cjs', // CAT-235 part 2: a cost-blind co-assist creates items but never a cost key (POST / · /bulk · /import), same 403 COST_BLIND
  'offr04-cost-gate.test.cjs', // [OFFR-04] CAT-234/236: GET / and PATCH /:id strip cost at any depth for a cost-blind actor; status-only PATCH allowed, price/cost refused; parked list stripped
  'agent-signin-body.test.cjs', // M01: the shop-PC agent sends mode:'login' via CBSignin.ask()/verify() — a login never creates an identity
  'employee-code.test.cjs', // M02: first code e-mailed, never shown in a sealed env (Resend required), single-use, 24 h
  'offer-clash.test.cjs', // T2-LABS: an offer saved LIVE that overlaps another live discount → 409 OFFER_CLASH in words (CBOffers.clashes); drafts · pauses · renames · basket offers untouched
  'auth-first.test.cjs', // M04: POST /api/chits/send — auth before the body is read (401 not 400/413, validators never run); before/after matrix: no allow/deny change
  'person-session.test.cjs', // M05: a person session is listed, bound to one device (DEVICE_MISMATCH), revocable within 60 s (fake clock); sign-in on B never revokes A; legacy tokens unchanged
  'rail-actions.test.cjs', // ⭐⭐ R01: GET /chits/:id `actions` and the writing doors are ONE engine (lib/rail.js) — 14 situations; before/after: same outcome, `why` added
  'ord-fix.test.cjs', // ORD-FIX O1–O7: closed orders unlisted · amended lines billed · CAS status write · rejected bill reverses its posting · one-shot shopper code · bill-based delivery
  'rail-status.test.cjs', // ⭐⭐ T1-RAIL: every status change goes through lib/rail-status statusGate (the one write); void of a completed chit 409s; no SQL writes current_status elsewhere
  'housekeeping-guards.test.cjs', // ⭐⭐ W2-RAIL R2: delete/archive/purge fail CLOSED (co_held_record · dispute_open · disputes_unknown), reprice asks the rail, ONE status table (no second spelling), a cap says so
  'claim-series.test.cjs', // M11: ONE series allocator for a counter PC (key) and a phone (device); label by PHONE number (D9); no prefix ever on two holders; a pre-M11 key claims the prefix it has today; a phone's till.by/device_id = the session
  'signin-routes.test.cjs', // M06: every old sign-in path answers as before the move (golden) and IS the new door's handler; one signin_events row per attempt; b282 missing never blocks
  'measure.test.cjs', // INT7b: lib/measure's own unit test — median to one decimal (never NaN), OPEN/CLOSED = the rail's one status table, an empty set measures to zeros
  'home-facts.test.cjs', // N18: GET /api/facts/:card — each Home card's shape, <= 2 trips, a figure the server cannot compute is omitted (never 0), cost never travels, unknown card 404
  'till-trend.test.cjs', // RPT2: GET /api/till/summary?compare=1 — Reports › Trend is rollup.series over the summaries, the shop's own year (never April), 422 NO_COUNTRY/NO_MONEY, one trip
  'settings-owner-gate.test.cjs', // T3-SETTINGS: ONE owner gate (lib/owner.gate) on every counters write - a co-assist 403 OWNER_ONLY, db never asked; GET /counters + GET /entities/policy say may/why with the refusal's own sentence
  'chit-crossing.test.cjs', // LEAN-PLAN §8 #3: lib/chit-crossing (lifted with moveStatus) - definer vs legacy fallback, 9-arg retry only when no line was named
  'chits-files.test.cjs', // LEAN-PLAN §8 #4: tools/chits-files.cjs is the ONE list of chits files; no test or script reads routes/chits.js by a literal path
  'stuck-close.test.cjs', // round 2: a counter sale / summary chit sent to its own shop closes when the books hold it - through moveStatus, only an open own copy
  'governance-report.test.cjs', // E04: the nightly governance report is red for each failing line; never green while main is unprotected or /health says development
  'iso8601.test.cjs', // N11: every moment that leaves storage or transport (sent chit, copies, pack, Tally, JUnit) is RFC 3339 UTC
  'legacy-token-refuse.test.cjs', // K-SEC PR A landing check: LEGACY_TOKEN_REFUSE off = a no-jti token passes (counted); on = 401 SESSION_UPGRADE; a listed session and the 60 s auto-raise token pass either way; customer mints counted apart
  'ppl-27-viewer-writes.test.cjs', // PPL-27 (Q42): a View-only/Comment-only login gets the free catalogue draft with intro null and 0 model calls; editor/owner 1; anonymous 0
  'api-csp.test.cjs', // K-SEC PR A (SEC-68): strict CSP on JSON and /.well-known (ctp.json still 200 JSON); the 5 old public pages untouched; POST /api/csp-report 204, shaped log only, own limiter, 8 KB cap
  'scoped-access-count.test.cjs', // AI-15: ratchet on chit read routes that skip lib/access seesWholeEntity (43 on 21 Oct); all_task_visible still unread; why wiring waits for Athi
  'jwt-rotation.test.cjs', // E10: JWT_SECRET then JWT_SECRET_PREV through ONE verifier (lib/jwt-verify.js); PREV token = 200 logged rotated; neither = 401 TOKEN_INVALID; PREV unset = byte-for-byte today
  'iddocs-verify.test.cjs', // M18: phone/e-mail identity documents verified by a code (lib/otp.js engine); 5 wrong -> locked; PUT clears; an unverified contact is never used for recovery
  'sec101-iddoc-hash.test.cjs', // SEC-101: Aadhaar (store:false) stored with a KEYED hash (HKDF of VAULT_ENC_KEY), legacy sha256 still recognised, no key = 503; PHONE/EMAIL hashes byte for byte unchanged, sign-in + device-key match still find the person
  'sec106-staff-code-hash.test.cjs', // SEC-106: a staff first code is kept as a KEYED hash (HKDF of VAULT_ENC_KEY, otp_code_hash), never plain; verifyOtp compares the hash, every issue zeroes the attempts and writes a code_issued trail row; an idempotent answer carrying a code is never stored; b781 written, not run
  'raida-close-route.test.cjs', // RAIL-93: POST /api/chits/:chit_id/raida/:raida_id/close passes the worklist's disposition (and carried-forward register, evidence) to raida.close; a full register's ending writes its closing row
  'sides.test.cjs', // CB Sides: driftOf (resolver) + the impact walk (lib/impact, shared with raida.walk) + GET /api/entities/sides is ONE read; a source with no data is a 'not yet' row, never a number
  'entities-header.test.cjs', // N19: GET /api/entities/header is ONE read (<= 3 trips); planted compliance rows -> bands from lib/licence-rules.js; unverified PHONE -> check false; no rule -> days only; no fee amount hard-coded
  'prefs-merge.test.cjs', // CU2: every ui_prefs / locale_prefs write is an RFC 7386 merge-patch — a theme save keeps product_rows and the keys it did not send; '' / null removes; no `= $n` whole-column write
  'limiter-paths.test.cjs', // M07: every public door (walked from the real app) has a limiter of its own; pair/claim, check-login, storefront sign-in on the strict auth budget; existing limits unchanged
  'con-100-101-capture-input.test.cjs', // CON-100/101 (BH-8, BH-15): capture convert and stores answer a plain 4xx (a non-uuid id 404 NOT_FOUND; a chit_id or a phone that is not text 400 VALIDATION_FAILED), the db never asked, no driver text; a valid call still 200
  'limiter-answer.test.cjs', // API-16 (BH-5): every limiter (the 240/min service one through the real app, the rest at max 1) answers 429 problem+json RATE_LIMITED with Retry-After and the same seconds in params; first request passes
  'net-48-connection-input.test.cjs', // NET-48 (BH-9): POST /api/network/connections and /api/connections/request name someone who cannot exist (bad uuid, wrong type, bad handle or bridge id) -> 404 problem+json before the database; a valid call still reaches the service
  'rail-161-service-catches.test.cjs', // RAIL-161: GET, resolve, pause and answer on /api/service answer a fault as problem+json 500 INTERNAL (no driver text), a known Postgres refusal as its mapped 4xx, a success unchanged
  'employee-first-signin.test.cjs', // 2026-10-08 Athi: employee's first code (unsealed, DEV_OTP) signs in AND answers requires_pin_setup on every door; PIN then works; sealed never takes the fixed code
  'tester-code.test.cjs', // SEC1: TESTER_CODE (env, 8+, timing-safe over SHA-256) signs in on verify only; fixed codes on a LOCAL stack only; TESTER_NAMES; never logged/answered; no fixed code in what ships; SEC1b daily {yymmdd} code (IST, yesterday until 06:00) + TEMPORARY boot warning
  'people-srv1.test.cjs', // PEOPLE-SRV1: switch-off/remove signs the person out (sessions by person, keys by maker: counter closed, others revoked) in one transaction; owner marks away (OWNER_ONLY · NOT_FOUND · SWITCHED_OFF; stand-in in the shop); may.remove/away; GET /api/facts/people
  'people-writes-sec2.test.cjs', // SEC2: no answer of any /api/actors route holds a code (pin_state instead); every people write is the owner's (403 OWNER_ONLY + why); e-mail stored + edited; connector code through generateOTP('connector')
  'limits.test.cjs', // E01: 9 MB on a non-upload route -> 413 BODY_TOO_LARGE; 30 s request deadline -> 503 REQUEST_TIMEOUT (late answer swallowed); 57014 -> 503 STATEMENT_TIMEOUT; parsers after id+logger
  'request-log.test.cjs', // E07: request id minted (uuid) or kept (plain token), echoed and on the log line; every line JSON with entity/person/bytes; slow query -> one line, fingerprint only, no SQL text; /health db + version
  'signin-contact.test.cjs', // M14: sign in by a MOBILE or an E-MAIL — verified contact (M18 reader) / own sign-in e-mail / customer contact -> the stored id behind the scenes; several -> 409 CHOOSE_IDENTITY; unverified opens nothing; old doors byte-identical
  'move-in-country-gate.test.cjs', // move-in W1: books from another country are refused whole (an unknown country never gets India's rules); unmatched codes / units held; X-1; the proof
  'move-in-meter.test.cjs', // move-in W1.6: items written inside the move-in are metered only after it commits; a rolled-back one meters nothing
  'move-in-added-via.test.cjs', // QM-1: the move-in writes only an added_via the migrations' CHECKs allow (read from the .sql); a 23514 is a 422 sentence
  'local-kind.test.cjs', // K-DB OPS-41: a minted party is 'local' once b769's CHECK allows it, 'supplier' + a log line before; an unreadable CHECK never fails a mint
  'retention-archive-gate.test.cjs', // K-DB DB-21/PM-16: a retention commit without an archive receipt is BLOCKED, deletes 0, sends no write; every attempt is one flush event
  /* QA-79 (22 Oct): tests that passed offline (stub db, no server) and no runner reached. Their output is counted as '<n> passed' too. */
  'account-sessions.test.cjs',
  'actors-create-level.test.cjs',
  'actors-max-tasks-cap.test.cjs',
  'ai-box.test.cjs',
  'ai-one-pipe.test.cjs',
  'assign-merge-patch.test.cjs',
  'auth-first-routes.test.cjs',
  'baseline-from-snapshot.test.cjs',
  'books-close-country.test.cjs',
  'books-day-bills.test.cjs',
  'books-day-country.test.cjs',
  'books-hooks-kinds.test.cjs',
  'books-returns.test.cjs',
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
  'std2-one-reading.test.cjs',
  'till-t2c.test.cjs',
  /* QA (24 Oct): two landed walk fixes no runner reached - R14 a party's phone and e-mail are kept or refused in words; R58 the shop's sales offer never cuts a supplier's receipt */
  'party-contact-patch.test.cjs',
  /* CRM-43 (29 Oct): merged_into names only a party of this shop; the b782 trigger function reads each table's own column only inside its own IF branch */
  'party-merge-target.test.cjs',
  'party-merge-guard-sql.test.cjs',
  'r58-no-sales-offer-on-receipt.test.js'
];

/** the number a guard proved: its last "<n> checks" or "<n> passed" (QA-79), else node:test's "pass <n>" line (spec reporter ℹ, TAP reporter #); 0 = it proved nothing */
function countChecks(out) {
  const m = out.match(/(\d+)\s+(?:checks|passed)/g) || out.match(/(?:ℹ|#) pass (\d+)/g); /* node:test: "ℹ pass n" on a terminal, "# pass n" (TAP) in CI */
  return m ? Number(String(m[m.length - 1]).match(/\d+/)[0]) : 0;
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
  'books-close-country.test.cjs',
  'books-returns.test.cjs',
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
  'books-todo.test.cjs',
  'books-manual-events.test.cjs',
  'books-voucher-series.test.cjs',
  'two-sided-books.test.cjs',
  'pay-fix-void.test.cjs' // QA-80: runs the real chits router over the books harness
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
const ji = process.argv.indexOf('--junit');
const JUNIT = ji >= 0 ? path.resolve(process.argv[ji + 1] || 'test-results/guards.xml') : null;
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
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(TESTS, text)], { encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { OUTPUT_ALLOWLIST: 'enforce' }) /* S34: the gate runs the output allow-list for real; production defaults to report */ });
  const out = (r.stdout || '') + (r.stderr || '');
  /* every guard ends with "<n> checks"; take the LAST one, because a stray warning can print after it */
  const n = countChecks(out);
  /* ⚠️ A GUARD THAT COUNTED NOTHING PROVED NOTHING (2026-09-17: three guards ended without "<n> checks" and read "ok · 0") */
  const bad = r.status !== 0 || /\bFAIL\b/.test(out) || n === 0;
  total += n;
  if (bad) failed.push(text);
  console.log('  ' + (bad ? 'FAIL' : ' ok ') + '  ' + text.replace(/\.test\.(js|cjs)$/, '').padEnd(22) + String(n).padStart(4) + ' checks');
  const list = bad
    ? out
        .split('\n')
        .filter((item) => /FAIL|Error|expected/i.test(item))
        .slice(0, 5)
        .map((item) => item.trim())
    : [];
  if (bad) console.log(list.map((item) => '          ' + item).join('\n'));
  report.push({
    name: KEY(text),
    status: bad ? 'fail' : 'pass',
    time: (Date.now() - t0) / 1000,
    /* ⚠️ never an empty reason: a red row on the board with no words is a question nobody can answer */
    message: bad ? (list.length ? list.join('\n') : n === 0 ? 'counted no checks' : 'exit ' + r.status) : '',
    output: bad ? out.split('\n').slice(-40).join('\n') : ''
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

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
 */
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const TESTS = path.join(__dirname, '..', 'tests');

/** the offline set: no DB, no network, no server. Add one here the day it becomes true, not before. */
const GUARDS = [
  'pages-parse.test.js',      // every inline script in app.html, till.html and promo.html parses
  'till-vendor.test.js',      // the counter and its vendored engines agree, byte for byte
  'shop-clock-guard.test.cjs',  // ⭐⭐ Y1: one shop clock — no raw new Date()/Date.now() in the ledger files; set/advance/reset proven
  'till-t2a.test.cjs',  // round T2a: bills-only count, an online order billed, the mode menu, no 403 on quick-keys/hidden
  'till-shippable.test.cjs',  // the installable till carries only modules with no database behind them
  'catalogue-blueprint.test.js', // two trades, one axiom, and a product sequence that cannot collide
  'engines-pinned.test.js',    // ⭐⭐⭐ every adopted engine is EXACTLY its chitbridge-engines release — no hand edit survives
  'money-round.test.js',       // one rounder (0 wrong in 1.74 M cases, per-currency decimals) and one price reader
  'google-availability.test.cjs', // one output shape: status → Google Merchant availability; nothing Google does not define (M53)
  'one-rounding-rule.test.cjs', // ⭐⭐⭐ no platform-owned file carries a second copy of the rule; cart/pick pages load money.js first; the kit carries it (2026-09-28)
  'engine-versions.test.cjs',   // ⭐⭐ a counter reports which engine release it bills with — /api/state, the snapshot call, its key (2026-09-28)
  /* ⚠️ written 2026-09-28 with the one-gate rebuild and NOT added here the same day — a guard nobody runs. */
  'till-origin.test.cjs',       // ⚠️⚠️⚠️ only the counter's own page may write to the shop-PC program (critic C1)
  'counter-gates.test.cjs',     // ⭐⭐⭐ ONE door to a shop (becomeShop), ONE for a person (sign-in, offline PIN), lock/break = that sign-in
  /* ⚠️ "A GUARD NOBODY RUNS" (BACKLOG, 2026-09-18) — the suite ran it, the gate never did. Added 2026-09-28. */
  'tdz-guard.test.js',          // no const/let read above its declaration in the same function (node -c cannot see a TDZ)
  /* ⚠️ both red since b250/b262/b264 and outside the gate — accepted with docs/drafts/fk_b250_b262_b264_draft.sql waiting (2026-09-28) */
  'migration-lint.test.cjs',     // no NEW migration hides a FOREIGN KEY inside CREATE TABLE IF NOT EXISTS
  'entity-cast-guard.test.cjs',  // no NEW RLS policy casts an unset current_setting straight to ::uuid
  /* ⚠️ a guard nobody ran: the access gate for co-assists was never in this list (found 2026-09-28) */
  'hat-gate.test.cjs',          // ⭐⭐ a View-only/Comment-only co-assist cannot write; asking /assist is open, its five writes are not
  'access-events.test.cjs',     // the IAM audit trail never invents a change, and a lost row is SAID (review 2026-09-25)
  'notifications-count.test.cjs', // ⭐⭐ the badge's number is ONE withEntity statement over the feed's own rows (M7, 2026-09-28)
  'supplier-list-scope.test.cjs', // ⭐⭐⭐ every supplier_list statement runs inside withEntity — ready for FORCE RLS (H2, 2026-09-28)
  'knownerr.test.js',         // a refusal the database makes on purpose (b247) reaches a person as a 409, from every route that writes a chit
  'xlsx-read.test.js',        // an Excel file read into the shape a CSV makes, and refused in words otherwise
  'xlsx-write.test.js',       // a workbook Excel will open — every part it needs, and a code keeps its leading zero
  'write-limits.test.js',     // a door that writes many records per request is rate-limited, and keyed by the key
  'categories.test.js',       // a product CITES its category; nothing writes the legacy single-category key
  'till-agent-says.test.js',  // the desktop counter names a wrong key as a wrong key, never as an outage
  'till-shop-folder.test.js', // one folder per shop per server — a test bill never lands in the live takings
  'rollup.test.js',           // day/week/month: a return is not a sale, and folding equals summarising
  'verdict.test.js',          // one cause, one sentence, one button — the message has a single home
  'counter-claim.test.js',    // one counter, one holder — two PCs on C1 fork the bill numbers
  'till-watch.test.js',       // the watch list names real gates — a row with no gate watches nothing
  'orders.test.js',           // the order rules, run with no browser — the proof they left the page
  'dayopen.test.js',          // ⭐⭐ the morning: who, products, the counter number, the drawer — [TILL-182]
  'qty.test.js',              // ⭐⭐⭐ the factor table LEFT the page — [TILL-186]
  'scalecode.test.js',        // ⭐⭐ a scale's label: which vegetable, and how much of it — [TILL-185]
  'signin.test.js',           // ⭐⭐⭐ a PERSON signs in — user id or email, and no session at a counter
  'identity-auth.test.js',    // ⭐⭐⭐ [capability: sign-in] the ONE lookup and ONE verify — entity or coassist, OTP or PIN
  'orderhub.test.js',         // ⭐⭐⭐ one floor, several devices, no internet — [TILL-178b]
  'till-hidden.test.js',      // [hidden] must win — a class that sets display draws a closed panel anyway
  'till-exits.test.js',       // every screen has a lid, and it never sits in a row of ways to CHANGE things
  'tax-lines.test.js',          // ⭐⭐ the month's ledger and GSTR: a credit note REDUCES tax; cdnr · cdnur · b2cs netting · Table 13 (2026-09-28)
  'round-trips-all.test.cjs',  // ⭐⭐ every route the web client calls has a round-trip budget (round-trips.budget.json) — fired offline, I19 (DB10)
  'people.test.cjs',           // ⭐ P1: GET /api/people — one statement, the caller's shop only, may/why per action, owner-only greyed with its sentence
  'network-validate.test.cjs', // P2: the dry-run validate of a designed network — names what would break, posts nothing
  'round-trips-till.test.cjs', // ⭐⭐ the counter's snapshot has a trip budget: its own five tables in ONE transaction, 50 → 38 (M36, 2026-09-29)
  'rev16-delta-cursor-stamped-first.test.js', // ⭐⭐ a delta's cursor never skips a change — stamped before the read; past the cap sent in parts (2026-09-28)
  'snapshot-wire.test.js',    // what a counter receives AFTER JSON — the Map that cost the shop its tax
  'one-name-one-function.test.cjs', // two functions, one name: the loser hoists away in silence
  'docnumber-scheme.test.cjs',// the bill number's shape: what the date says vs when the run restarts
  'bell-param.test.cjs',      // every page opens the bell with the name the stream reads (2026-09-17: counters never heard it)
  'network-storefront.test.cjs', // a member storefront shows its network's offers and its checkout charges them — one key
  'network-catalogue.test.cjs',  // a brand publishes product changes; a store's own price is only ever suggested to
  'screen-kit.test.cjs',        // the screen library: every layout places every part; presets resolve; tiles fall back
  'no-tax-reformula.test.cjs',  // the counter calls CBTax.splitLineTax() — no page re-derives the tax split itself
  'network-authority.test.cjs',  // who may act on a network edge — from the token, never the body (ATH-86)
  /* ⭐ what the application can work out about a shop without asking it — country decides tax, money and every
     format, so the rule that it must return UNKNOWN rather than guess is a guarded one (registration) */
  'govcontext.test.js',
  /* ⚠️ the INSERT and b264 must agree about the columns — a misspelt one is invisible offline and surfaces
     on a real shop's first sign-up, as a failed audit row on the one event it exists to record */
  'signup-context.test.js',
  /* ⚠️ the same set of choices must always make the same line, and a different set never the same one —
     both failures are silent, and the bill stays arithmetically correct while being wrong */
  'variant.test.js',
  'rewards.test.js',          // what a point is worth, and what a ledger may do — it touches money
  'reward-cycle.test.js',     // the SEQUENCE: earn, come back, encash, expire, register — against the real store
  'sql-runner.test.js',       // a tool that runs SQL at production: its WITH/WITHOUT RLS line must be true
  'stock-cycle.test.js',      // the log and the cache must stay in step — through a replay, a minus, and a corrupted balance
  /* ⚠️⚠️ IT WAS NOT IN THIS LIST until 2026-09-10, so the one guard that asks 'is every module classified,
     and does everything unreachable say so' only ran when somebody remembered to. It caught an unclassified
     lib the same minute it was added here. A guard outside the suite is a guard nobody runs. */
  'item-kind.test.cjs',        // a supply is never counted as a product — one column carries the whole split
  'root-link.test.cjs',        // the values rootlink writes must be values the CHECK constraints accept
  'entity-kind.test.cjs',      // every identity mint declares WHAT it is — a DELETE predicate depends on it
  'board-kinds.test.cjs',      // the shared board carries CASES and CMDB records, nothing else — findings stay with the raiser
  'cmdb.test.cjs',             // ⭐⭐ the CMDB: every shipped record fits, a way in + out + tests, only a board writer writes
  'field-ledger.test.cjs',     // ⭐⭐ NO FIELD LEFT UNTURNED: a new product column / form input has a ledger row; a "not used" field gains no reader (2026-10-09)
  'engine-boundary.test.js',  // every lib declared engine or not; anything unreachable carries an @stage
  'adopt.test.js',            // what one shop may take into its catalogue from another's delivery
  'local-supplier.test.js',   // ~<user id>.sup-nnnn — one row per shop, never a recipient, never in the search
  'money-language.test.js',   // the currency and language CONVENTIONS, as assertions — a capability, not advice
  'search-engine.test.js',    // one search, three copies
  'lotfields.test.js',        // what a vertical must capture about a consignment
  'printer.test.js',          // the slip bytes
  'kit-update.test.js',       // a kit that does not parse is never swapped in
  'speech.test.js',           // the seam, not the vendor
  'key-scopes.test.js',       // what every API key may reach — the authorisation matrix
  'column-home.test.cjs',     // where a column actually lives
  'connector-kit.test.js',
  'tax-vendor.test.js',
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
  'rls-predicate.test.cjs',   // ⚠️ every policy reads a GUC something sets — written, never declared, so never run
  'migration-rls.test.js',    // a new table closes itself; the default grant makes an open one readable
  /* ⭐ CTP step 2: the address seam. Every address local, no wire - and the test asserts the two claims that
     matter: ONE query for five copies (it costs nothing while nothing is remote), and a remote copy refused
     BEFORE any write rather than half a chit delivered. */
  'ctp-address.test.cjs',
  /* ⭐⭐ THE CONFORMANCE RULE. Athi: "the behaviour should be the same" whether a world is a row here or its
     own machine. open(sign(build(copy))) must deep-equal copy, or the two transports write different rows and
     lifting a world silently changes behaviour. Also holds the population boundary, which across a wire is a
     PROTOCOL rule because b247 cannot see the far entity. */
  'ctp-conformance.test.cjs',
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
  /* ⭐⭐⭐ THE LEDGER (SPEC-books-v2, 2026-09-29). books-writer: ONE writer of the journal tables (postEntry), insert-only by
     trigger + grant, the chit never waits on it, FORCE RLS on all 13. The rest need the books engines v1.8.0 for their "on"
     half (BOOKS_ENGINES_SRC, else a v1.8.0 sibling) and say SKIP with the reason without them — never a silent pass. */
  'books-writer.test.cjs',      // ⭐⭐⭐ only lib/books-store writes the journal, only postEntry calls it
  'books-store-sql.test.cjs',   // every books statement: binds = placeholders, the shop is $1
  'books-post.test.cjs',        // ⭐⭐ the one writer: balances both grains, gap-free JV, locks, reversal, cheques, carryforward
  'books-hooks.test.cjs',       // ⭐⭐ what a chit posts — and a failed post NEVER fails the chit (parked, named)
  'books-routes.test.cjs',      // /api/books: 404 while off, owner-only writes, the shapes the Ledger screen reads
  'books-tally.test.cjs',       // ⭐⭐ the pack's Tally files come from the connector's adapter — one Tally writer, Receipt byte-identical
  'books-collections.test.cjs', // ⭐ CB Finance F1: /dues?finance=1 — limit · over_limit · interest SHOWN · owner only; plain /dues untouched
  'books-fixes.test.cjs',       // ⭐⭐⭐ the red-team findings of 2026-09-30 (M1–M12), each held by a check that was red before its fix
  'books-dates-tz.test.cjs',    // ⭐⭐ a date read back from Postgres is the same date under Asia/Kolkata and UTC (it runs itself in both)
  'books-period.test.cjs',      // ⭐⭐ v1.14–v1.16: asset register (b280 draft), depreciation, closing stock, GST close + challan, loans, accruals, contra — the engine's lines, once, locked, owner-only
  'books-preview.test.cjs',     // ⭐⭐ ＋ Entry: the preview's lines ARE the posted lines (one composeEntry), Dr = Cr, type + golden rule per line, locked month, blocked credit, writes nothing
  'books-rcm.test.cjs',         // ⭐ v1.20.0: a purchase under reverse charge posts the buyer's own tax (2204–2206), paid in cash only at the GST close / challan
  'books-year.test.cjs',        // ⭐ v1.20.0: the year close — refused in words (running, open months, Suspense), then every month hard-locked, next year opens on the carry-forward, idempotent
  'books-recurring.test.cjs',   // ⭐ b281 draft: recurring entries — 503 until migrated, proposed by default, a re-run never posts twice, the daily sweep reverses a due accrual once
  'books-todo.test.cjs',        // ⭐ the To-do feed: each kind from a real check, only what needs doing, and each row gone when it is done
  'books-manual-events.test.cjs', // ⭐⭐ expense / other income / capital / drawings / staff advance + recovery: hand-worked lines, MJ + voucher type, double tap once, owner-only, the system gives a ledger's code
  'books-voucher-type-write.test.cjs', // ⭐ b279 ran 2026-10-03: every new entry stores its voucher TYPE; a manual MJ Payment reads Payment
  'books-voucher-series.test.cjs', // ⭐⭐ v1.16.0: a series per voucher type (SV PV RV PY CV CN DN JV), MJ for a person's entry, counters in alphabetical order
  'books-counter-snapshot.test.cjs', // ⭐⭐ the counter is told `books: true` only when the ledger is on; dues: receivable side, latest dispute
  'books-payments.test.cjs',    // ⭐⭐⭐ M26: /payments/preview + one-call record — W1–W4 (PAY D5, 24 h) → 409 unless acknowledged; allocations in the SAME tx; one client_ref posts once; outcome words
  /* ⭐⭐ THE TWO-SIDED COUNTER BILL (2026-10-01) — broken once each by scripts/two-sided-breaks.cjs */
  'tax-copy.test.cjs',          // who sells on each copy: a counter bill I RECEIVED is my purchase, never in my GSTR-1
  'page-name.test.cjs',         // ⭐ N03: every chit names its detail page at mint (base by default); an unknown name is refused; nothing rewrites it
  'two-sided-bill.test.cjs',    // a till sends its own on-rail customer their copy — and nobody else; one shop row; replay-safe
  'goods-in-accepts.test.cjs',  // goods-in, every line in → accepted through the SAME transition as Intake
  'two-sided-books.test.cjs',   // one bill, two ledgers: sale at save, purchase on acceptance
  'bill-use.test.cjs',          // what a bill I received is for — resale · use · asset — and what each posts; stock only for resale
  /* ⭐⭐⭐ ONE INVOICE, EVERYWHERE (2026-10-02) — broken once each by scripts/tax-truth-breaks.cjs */
  'tax-truth.test.cjs',         // one counter bill read six ways (bill · chit · both ledgers · reprint · buyer's read), equal to the paisa; place of supply = the shop's state
  /* ⭐⭐ THE BILLS FOLDER (2026-10-01) — broken once each by scripts/bills-folder-breaks.cjs */
  'bills-folder.test.cjs',      // the folder inventory numbered with the ledger; view folders; the step function; bills leave Task — nothing else
  'bills-private.test.cjs',     // ⭐⭐ a bill's steps stay with the shop that took them, at the folder's messaging level; only the dispute always crosses
  /* ⭐⭐ THE SHOP'S NAME IS THE PROFILE'S NAME (2026-10-01) — broken once each by tests/shop-name-breaks.test.js */
  'shop-name.test.js',          // the account's name wins invoiceParty/profileValues; a vault name only fills an empty one; a difference is reported, case-blind
  'shop-name-breaks.test.js',   // each of those four rules, broken once, turns shop-name.test.js red
  /* ⭐⭐ CB CRM, PHASES 3–4 (2026-10-02, API side) — offline: the real router over an in-memory stand-in (tests/support/crm-stub.cjs) */
  'crm-maytrade.test.cjs',      // one mayTrade (onRail + population) with the verdict as a word; tillMaySend and the till snapshot ask it; mint kind 'cus'
  'crm-segment.test.cjs',       // high_value in SEGMENT_SQL (top 10 %, >= 3 bills, override wins) and the fall-back before party_item exists
  'crm-read.test.cjs',          // a both-roles party is ONE row; a merged / hidden / other-population party is never listed; dues = the stored figures; no per-row fetch
  'crm-interactions.test.cjs',  // log a call / note (party_interaction stubbed); the 503 before b276
  'crm-followups.test.cjs',     // follow-ups CRUD, assignment (owner or assignee), late in the SHOP's day, the 503 before b276
  'crm-sweep.test.cjs',         // the nightly sweep rings the bell once a day per assignee, nothing sensitive on the event
  /* ⭐⭐⭐ THE WEB'S CONTRACT (2026-10-03: the CRM list failed live - roles an OBJECT, the page read a list) — chitbridge-web keeps a copy and holds its stand-ins to it */
  'web-api-contract.test.cjs',  // every route the web reads, called for real (offline), held to docs/contracts/web-api.json: same keys, nesting and types
  'crm-leads.test.cjs',        // L1: leads as parties, the memberships table's one writer (entity + group checks), 503 in words before b297, the b297 RLS lines
  'crm-remove-walkin.test.cjs', // "Remove from my parties" (owner, no dues, hides, deletes nothing); walk-in → party moves the points by rewards.claim
  /* ⭐⭐⭐ DISPUTE CONFIDENTIALITY — THE USP RULE (N02, 2026-10-07): written before any extraction; per-copy RLS modelled, definers transcribed */
  'dispute-scoping.test.cjs',   // roster-only visibility · no notice to a non-party · per-party resolve; KNOWN BREAKS printed loud (section 5)
  /* ⭐⭐ THE BOARD HEARS ABOUT IT (2026-10-07) — offline: the real route over a stand-in db */
  'junit-board.test.js',        // a report folds to one row per (run, case, layer); the guards' own JUnit reads back by the board's key; the testing scope; CI posts after red
  'cost-never-to-employees.test.cjs', // [OFFR-04] cost off every export/history/till/supplies read for an actor without can_see_costs
  'agent-signin-body.test.cjs', // M01: the shop-PC agent sends mode:'login' via CBSignin.ask()/verify() — a login never creates an identity
  'employee-code.test.cjs',     // M02: first code e-mailed, never shown in a sealed env (Resend required), single-use, 24 h
  'auth-first.test.cjs',       // M04: POST /api/chits/send — auth before the body is read (401 not 400/413, validators never run); before/after matrix: no allow/deny change
  'person-session.test.cjs',    // M05: a person session is listed, bound to one device (DEVICE_MISMATCH), revocable within 60 s (fake clock); sign-in on B never revokes A; legacy tokens unchanged
  'rail-actions.test.cjs',     // ⭐⭐ R01: GET /chits/:id `actions` and the writing doors are ONE engine (lib/rail.js) — 14 situations; before/after: same outcome, `why` added
  'claim-series.test.cjs',     // M11: ONE series allocator for a counter PC (key) and a phone (device); label by PHONE number (D9); no prefix ever on two holders; a pre-M11 key claims the prefix it has today; a phone's till.by/device_id = the session
  'signin-routes.test.cjs',     // M06: every old sign-in path answers as before the move (golden) and IS the new door's handler; one signin_events row per attempt; b282 missing never blocks
  'home-facts.test.cjs',        // N18: GET /api/facts/:card — each Home card's shape, <= 2 trips, a figure the server cannot compute is omitted (never 0), cost never travels, unknown card 404
  'stuck-close.test.cjs',       // round 2: a counter sale / summary chit sent to its own shop closes when the books hold it - through moveStatus, only an open own copy
  'governance-report.test.cjs', // E04: the nightly governance report is red for each failing line; never green while main is unprotected or /health says development
  'iso8601.test.cjs',           // N11: every moment that leaves storage or transport (sent chit, copies, pack, Tally, JUnit) is RFC 3339 UTC
  'jwt-rotation.test.cjs',      // E10: JWT_SECRET then JWT_SECRET_PREV through ONE verifier (lib/jwt-verify.js); PREV token = 200 logged rotated; neither = 401 TOKEN_INVALID; PREV unset = byte-for-byte today
  'iddocs-verify.test.cjs',     // M18: phone/e-mail identity documents verified by a code (lib/otp.js engine); 5 wrong -> locked; PUT clears; an unverified contact is never used for recovery
  'sides.test.cjs',             // CB Sides: driftOf (resolver) + the impact walk (lib/impact, shared with raida.walk) + GET /api/entities/sides is ONE read; a source with no data is a 'not yet' row, never a number
  'entities-header.test.cjs',   // N19: GET /api/entities/header is ONE read (<= 3 trips); planted compliance rows -> bands from lib/licence-rules.js; unverified PHONE -> check false; no rule -> days only; no fee amount hard-coded
  'limiter-paths.test.cjs',     // M07: every public door (walked from the real app) has a limiter of its own; pair/claim, check-login, storefront sign-in on the strict auth budget; existing limits unchanged
  'employee-first-signin.test.cjs', // 2026-10-08 Athi: employee's first code (unsealed, DEV_OTP) signs in AND answers requires_pin_setup on every door; PIN then works; sealed never takes 123456
  'limits.test.cjs',           // E01: 9 MB on a non-upload route -> 413 BODY_TOO_LARGE; 30 s request deadline -> 503 REQUEST_TIMEOUT (late answer swallowed); 57014 -> 503 STATEMENT_TIMEOUT; parsers after id+logger
  'request-log.test.cjs',       // E07: request id minted (uuid) or kept (plain token), echoed and on the log line; every line JSON with entity/person/bytes; slow query -> one line, fingerprint only, no SQL text; /health db + version
  'signin-contact.test.cjs',    // M14: sign in by a MOBILE or an E-MAIL — verified contact (M18 reader) / own sign-in e-mail / customer contact -> the stored id behind the scenes; several -> 409 CHOOSE_IDENTITY; unverified opens nothing; old doors byte-identical
];

const all = process.argv.indexOf('--all') >= 0;
const files = all
  ? fs.readdirSync(TESTS).filter((f) => /\.test\.(js|cjs)$/.test(f)).sort()
  : GUARDS.filter((f) => { if (fs.existsSync(path.join(TESTS, f))) return true;
      console.log('  ⚠️  ' + f + ' is listed but missing — renamed, or deleted without updating this list'); return false; });

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
const NEEDS_ENGINES = ['engines-pinned.test.js', 'tax-vendor.test.js',
  'books-collections.test.cjs', 'books-fixes.test.cjs', 'books-dates-tz.test.cjs', 'books-period.test.cjs', 'books-preview.test.cjs', 'books-rcm.test.cjs',
  'books-year.test.cjs', 'books-recurring.test.cjs', 'books-todo.test.cjs', 'books-manual-events.test.cjs',
  'books-voucher-series.test.cjs', 'two-sided-books.test.cjs'];
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

let total = 0, failed = [], started = Date.now();
console.log(all ? '— every test file (some need a server) —' : '— the guards —');

for (const f of files) {
  if (SKIP_ENGINES && NEEDS_ENGINES.indexOf(f) >= 0) {
    console.log('  skip  ' + f.replace(/\.test\.(js|cjs)$/, '').padEnd(22) + '   — needs chitbridge-engines (private; set ENGINES_READ_TOKEN)');
    console.log('::warning::' + f + ' skipped — chitbridge-engines is not checked out (add the ENGINES_READ_TOKEN secret)');
    report.push({ name: KEY(f), status: 'skipped', message: 'needs chitbridge-engines (private), not checked out' });
    continue;
  }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(TESTS, f)], { encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  /* every guard ends with "<n> checks"; take the LAST one, because a stray warning can print after it */
  const m = out.match(/(\d+)\s+checks/g);
  const n = m ? Number(String(m[m.length - 1]).match(/\d+/)[0]) : 0;
  /* ⚠️ A GUARD THAT COUNTED NOTHING PROVED NOTHING (2026-09-17: three guards ended without "<n> checks" and read "ok · 0") */
  const bad = (r.status !== 0) || /\bFAIL\b/.test(out) || n === 0;
  total += n;
  if (bad) failed.push(f);
  console.log('  ' + (bad ? 'FAIL' : ' ok ') + '  ' + f.replace(/\.test\.(js|cjs)$/, '').padEnd(22) + String(n).padStart(4) + ' checks');
  const why = bad ? out.split('\n').filter((l) => /FAIL|Error|expected/i.test(l)).slice(0, 5).map((l) => l.trim()) : [];
  if (bad) console.log(why.map((l) => '          ' + l).join('\n'));
  report.push({ name: KEY(f), status: bad ? 'fail' : 'pass', time: (Date.now() - t0) / 1000,
    /* ⚠️ never an empty reason: a red row on the board with no words is a question nobody can answer */
    message: bad ? (why.length ? why.join('\n') : (n === 0 ? 'counted no checks' : 'exit ' + r.status)) : '',
    output: bad ? out.split('\n').slice(-40).join('\n') : '' });
}

if (JUNIT) {
  fs.mkdirSync(path.dirname(JUNIT), { recursive: true });
  fs.writeFileSync(JUNIT, require('../lib/junitresults').write('guards', report));
  console.log('  JUnit → ' + path.relative(process.cwd(), JUNIT) + ' (' + report.length + ' files)');
}

console.log('  ' + '─'.repeat(40));
console.log('  ' + total + ' checks · ' + files.length + ' files · ' + (Math.round((Date.now() - started) / 100) / 10) + 's · '
  + (failed.length ? failed.length + ' FAILED: ' + failed.join(', ') : 'all passed'));
process.exit(failed.length ? 1 : 0);

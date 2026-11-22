'use strict';
/**
 * tests/engine-manifest-l16.js — the lib files the l16 build added, classified for engine-boundary.test.js (2026-11-16; kept beside tests/engine-manifest.js because that file's size row may not grow).
 * OWNS      the three lists engine-manifest.js appends to INFRA_LIBS, PENDING_LIBS and ENGINE_OTHER
 * CALLED BY tests/engine-manifest.js (one line at its foot)
 *
 * INFRA: plumbing — SQL, shaping, doors, files, the Books read pages, the MARK & QUERY doors; none holds a rule of the engines. Seven were split out of grown books files
 * (books-stray-tax · books-cashflow-return · books-bill-bands · books-manual-bill-tax · books-period-taxed · books-period-state · books-period-lock) and keep their parent's class.
 * PENDING: these four add up or split money for a Books page (sums over rows, basis points, a return's per-ledger split, opening balances). Whether that arithmetic is engine (books)
 * or stays here needs cb-capability's call; the money-no-arithmetic guard lists the same lines for cb-finance and cb-accounting. Keep this list small and shrinking.
 */
const INFRA = [
  'deprecation.js', 'sql-frag.js', 'emvco-qr.js', 'incoterms.js', /* batch 1119 (std10 + paramq): pure helpers that decide no money, tax or rule */
  'attachment-send.js',
  'bank-open.js',
  'bank-statement-file.js',
  'bank-statement-page.js',
  'bill-checks.js',
  'books-evidence.js',
  'books-lock-note.js',
  'books-stray-tax.js',
  'books-cashflow-return.js',
  'books-bill-bands.js',
  'books-manual-bill-tax.js',
  'books-period-taxed.js',
  'books-period-state.js',
  'books-period-lock.js',
  'books-needs.js',
  'books-dues.js', /* MIS A2: the dues read moved out of routes/books.js GET /dues, unchanged: the route's class (infra) */
  'books-open-items.js',
  'books-other-side.js',
  'books-party-bills.js',
  'books-practice.js',
  'mark-adopters.js',
  'mark-detect.js',
  'mark-door.js',
  'mark-embed.js',
  'mark-notices.js',
  'mark-policies.js',
  'marks-contract.js',
  'review-mark.js',
  'message-post.js',
  'private-flag.js',
  'flags-contract.js',
  'practice-health.js',
  'supply-kind.js',
  'books-money-ops.js',
  'books-baseline.js', /* ACC-176 rank 10: the auditor's Mark-as-checked baseline, SQL and a created_at compare; no money rule */
  'books-mis.js', /* MIS A3: composes the engines' own figures into ONE overview read; its header states no new calculation (reports owns the page) */
  'books-period-choices.js', /* W8..W18: GET /periods picker state, counts only, calls practice-health and review-mark rules */
  'identity-secret.js', /* b874 tolerance: is the secret view there, else the pre-b874 read; hosting plumbing like bound-read.js */
  /* size split (shrink A2-A4, 17 Nov; engines refit): the part modules the grown files were split into — each is the class of the file it was split out of (a route or a books/store part: infra), behaviour unchanged */
  'actors-assign-jobs.js',
  'assist-parts.js',
  'books-daybook.js',
  'books-dues-rows.js',
  'books-movein.js',
  'books-store-gstclass.js',
  'books-store-packs.js',
  'books-store-parties.js',
  'catalogue-order-checks.js',
  'chits-till-send.js',
  'chits-trace-batch.js',
  'connectors-gates.js',
  'crm-timeline-rows.js',
  'ctp-guards.js',
  'definitions-guards.js',
  'entities-me.js',
  'entities-prefs.js',
  'folders-reads.js',
  'governance-plan.js',
  'home-facts-bank.js',
  'home-facts-finance.js',
  'integrations-fit.js',
  'network-design-stores.js',
  'products-list-adopt.js',
  'raida-own.js',
  'relationships-rename.js',
  'signin-code.js',
  'testing-results.js',
  'till-match.js',
  'assign-register.js', /* ASSIGN-1: the generic assign capability's register (values and names) and the holds() read: plumbing, the one level function is lib/access.levelOf */
  'assign-bulk.js', /* ASSIGN-1: POST /api/chits/assign-bulk's transaction through the ONE assignment writer: a door, decides no rule of its own */
  'auto-assign.js', /* ASSIGN-1: the auto door picks the holder by the entity's own mode and hands it to the ONE assignment writer: a door */
  'assign-holds.js', /* ASSIGN-NET L11+L9: what a person holds across the plugs and hand-over of all of it, through the ONE writer (assign-bulk): reads and a door, no rule of its own */
  'assign-people.js', /* ASSIGN I4/I9: each person's open load and the one suggested holder: reads and a ranking by the auto door's own least_loaded, no second count */
  'books-opening-count.js', /* P1-1 (18 Nov): counts the opening-balance journal into a month: a fold of rows, no money rule (counts only) */
  'chits-holds-contract.js', /* ASSIGN-NET: the OpenAPI operations and seats of routes/chits-holds.js: a contract, no rule */
  'network-accept-assign.js', /* L10: assign at accept: hands the client to the ONE assignment writer; a refusal is a named skip: a door */
  'jobs-open.js', /* ASSIGN-1: opens one job chit per subject through the existing send path: a door */
  'chits-jobs-contract.js', /* ASSIGN-1: the OpenAPI operation and seats of routes/chits-jobs.js: a contract, no rule */
  'crm-followup-heir.js', /* split out of lib/crm-followups.js: the parent's class (infra) */
  'resource-cap.js', /* register column 16: pure claims over route text, a test tool's helper, no business rule */
  'role-matrix.js', /* register column 14: the seat vocabulary and its well-formed check, a contract helper, no business rule */
  'junk-fuzz.js', // col17 (2026-11-18): the junk set and the verdict of register column 17 (tools/junk-fuzz.cjs); a test tool's helper, decides no business rule
  'signin-pending.js',     // SEC-112: the caller of the three pending-store doors (b879) — database plumbing, the single-use rule lives in the SQL door
  'signin-provider.js',    // SEC-112: the provider adapter (registry, stand-in rule, ID token claim checks) — plumbing to outside providers, no business rule
  'signin-provider-contract.js', // SEC-112: the OpenAPI operations of routes/signin-provider.js — a contract, no rule
  'signin-provider-store.js', // SEC-112: the pre-binding read of provider links (ops.signin_provider_links, b878) — database plumbing
  'policy-signin.js', /* SEC-112: the three sign-in rule rows split out of lib/policy.js (FLAGS, CARD, a text coercer): rule data of the policy, the parent's class (infra) */
  'pay-out-gate.js', // AK-F-02: who may pay a supplier (seat gate) split out of routes/books.js — an Express gate, no rule of the engines
  'books-readers.js', /* SEC-161/STAFF-BOOKS: the two read gates split out of routes/books.js: the parent's class (infra), the reader test itself is the books gate */
  'policy-books.js', /* SHOPBK-B: the books_owner_approves rule row split out of lib/policy.js (FLAGS row, CARD row): rule data of the policy, the parent's class (infra) */
  'books-approval.js', /* SHOPBK-B: who presses post for the shop's own Bookkeeper: reads the one flag and hands the entry to the ONE queue (books-action); no posting rule of its own */
  'books-action-queue.js', /* SHOPBK-B: the queue reads split out of books-action.js (INFRA, its parent's class): one count and one page of the store's own steps, no posting rule */
  'books-reversal-date.js', /* H-h2-003 (20 Nov): the future-day test for a person's reversal, split out of books.js (INFRA, its parent's class): asks the one future rule, holds no posting rule */
  'delegation.js', /* grant-seat (20 Nov): the one area-neutral rule grant = ceiling, seat narrows (mayActIn): pure, asks access RANK, holds no posting rule (INFRA) */
  'books-input.js', /* H-h2-001/002 (20 Nov): the strict-input rules of a typed entry (narration length, amounts as numbers): pure checks, no posting rule */
  'books-pay-side.js', /* B6-12 (20 Nov): which control a payment touches by the party's role; the customer refund is the engine's manual Dr Debtors event: no posting rule of its own (INFRA) */
  'home-waiting.js', /* SHOPBK-B: the Home card's waiting counts and words for the books, split out of home-facts.js: reads one count and words it, no rule of its own */
  'books-debit-check.js', /* B6-14 (20 Nov): a debit note names a booked bill and not more than it owes: reads the party rows, holds no posting rule (INFRA) */
  'books-event-guard.js', /* R12a/R4 (20 Nov): a reused client_ref with another body is refused, a look-alike is warned; reads the previewed journal, holds no posting rule (INFRA) */
  'books-balance-rows.js', /* moved out of books.js (20 Nov): the monthly balance rows of a journal's lines, pure grouping, no posting rule of its own (INFRA) */
  'books-store-locks.js', /* moved out of books-store.js (20 Nov): hasTrading read, fx-rate and source_ref advisory locks, no posting rule (INFRA) */
  'practice-switch-audit.js', /* H-h1 (20 Nov): the access_events row of a moved practice switch, no posting or tax rule (INFRA) */
  'signin-ask-cap.js', /* gorilla 20 Nov: the per-account send cap on the sign-in code request, a limiter, no rule of the books (INFRA) */
  'work-client.js', /* W16: the client a practice job is for (reads of books_setting / identity under the client's own binding): the parent work-rows.js's class, plumbing, no rule of its own */
  'own-limiters.js', /* column 16: the four own limiters split out of server.js: plumbing */
];
const PENDING = [
  'books-opening.js',
  'books-report-period.js',
  'books-return-split.js',
  'books-statement-notes.js'
];
/* ENGINE: adopted from chitbridge-engines, written only by tools/adopt.cjs; reg-timing (the filing dates of a country's returns) arrives with the engines release that carries engines #150, as a need of tax-packs */
const ENGINE = ['reg-timing.js', 'books-carry-help.js', 'books-month-advice.js', 'books-payment-advice.js'];   /* the three books parts: split out of books.js (ENGINE_OTHER), the parent's class, behaviour unchanged */
const L1129 = require('./engine-manifest-1129'); INFRA.push(...L1129.INFRA); PENDING.push(...L1129.PENDING); /* batch 1129's lib files */
module.exports = { INFRA, PENDING, ENGINE };

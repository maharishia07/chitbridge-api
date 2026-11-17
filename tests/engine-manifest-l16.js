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
  'identity-secret.js' /* b874 tolerance: is the secret view there, else the pre-b874 read; hosting plumbing like bound-read.js */
];
const PENDING = [
  'books-opening.js',
  'books-report-period.js',
  'books-return-split.js',
  'books-statement-notes.js'
];
/* ENGINE: adopted from chitbridge-engines, written only by tools/adopt.cjs; reg-timing (the filing dates of a country's returns) arrives with the engines release that carries engines #150, as a need of tax-packs */
const ENGINE = ['reg-timing.js'];
module.exports = { INFRA, PENDING, ENGINE };

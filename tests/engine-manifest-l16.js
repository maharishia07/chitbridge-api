'use strict';
/**
 * tests/engine-manifest-l16.js — the lib files the l16 build added, classified for engine-boundary.test.js (2026-11-16; kept beside tests/engine-manifest.js because that file's size row may not grow).
 * OWNS      the two lists engine-manifest.js appends to INFRA_LIBS and PENDING_LIBS
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
  'practice-health.js',
  'supply-kind.js',
  'books-money-ops.js'
];
const PENDING = [
  'books-opening.js',
  'books-report-period.js',
  'books-return-split.js',
  'books-statement-notes.js'
];
module.exports = { INFRA, PENDING };

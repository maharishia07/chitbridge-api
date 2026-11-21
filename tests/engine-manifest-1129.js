'use strict';
/**
 * tests/engine-manifest-1129.js — the lib files batch 1129 added, classified for engine-boundary.test.js (21 Nov 2026; kept beside tests/engine-manifest-l16.js because engine-manifest.js's size row may not grow).
 * OWNS      the two lists engine-manifest-l16.js appends to INFRA and PENDING
 * CALLED BY tests/engine-manifest-l16.js (one line at its foot)
 *
 * INFRA: plumbing that decides no money, tax or rule of its own: the backfill door and its date, the "not registered" answer, the quantity comparison of a credit note (units, not money), the import's bad-rows
 * file, the invite's remote refusal, a credit limit moved to minor units through money.toMinor.
 * PENDING: these two sum or check money for a page (the tenders of a bill against its total; the input tax the off-rail purchases posted). Whether that is engine (books/counter) or stays here is
 * cb-capability's call, as for the l16 four; the money-no-arithmetic guard sees neither. Keep this list small and shrinking.
 */
const INFRA = ['books-backfill.js', 'books-return-registration.js', 'credit-qty.js', 'import-rejects.js', 'network-invite-guard.js', 'party-credit.js'];
const PENDING = ['offrail-itc.js', 'tender-sum.js'];
module.exports = { INFRA, PENDING };

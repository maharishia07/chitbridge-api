/**
 * guards-needs-engines.cjs — THE GUARDS THAT LOAD THE ENGINES REPO (moved out of scripts/guards.cjs, 21 Nov 2026, filesize ratchet).
 *
 * OWNER     cb-qa
 * OWNS      NEEDS_ENGINES: the tests that cannot run when chitbridge-engines is absent (CI without ENGINES_READ_TOKEN); each skip is a warning, never a pass.
 * CALLED BY scripts/guards.cjs (passes the list to scripts/guards-run.cjs) · tests/every-test-is-enrolled.test.cjs does not read it (a name here is also in GUARDS).
 * FLOW      guards.cjs requires this file ──▶ NEEDS_ENGINES.indexOf(test) ──▶ skipped when the engines repo is absent and CB_ENGINES_ABSENT_OK=1
 * CARD      qa/offline-guards
 */
'use strict';
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
  'books-manual-modes.test.cjs',
  'books-rcm.test.cjs',
  'books-year.test.cjs',
  'books-year-country.test.cjs',
  'books-recurring.test.cjs',
  'books-todo-unposted.test.cjs',
  'books-todo.test.cjs',
  'books-manual-events.test.cjs',
  'books-bank-line-tax.test.cjs',
  'books-voucher-series.test.cjs',
  'two-sided-books.test.cjs',
  'pay-fix-void.test.cjs', // QA-80: runs the real chits router over the books harness
  'auae-1129.test.cjs', // AU-F-01: the void of a goods receipt over the real chits router and the books harness
  'rail-216-void-paid.test.cjs', // RAIL-216: a payment on the invoice blocks the seller's void (B2B, counter bill, named bill), over the books harness
  'change-pin-lock.test.cjs', // PPL-30: change-pin counts a wrong current PIN and honours the lock like sign-in (verifyCredential, 5 tries, ASVS V2.2.1)
  'change-pin-lock-mutation.test.cjs', // PPL-30: with the count-and-lock removed the test above goes red
  'itemmatch-corpus.test.cjs', // CAT-75: the itemmatch tolerance per product family on a hand-computed corpus; CAT-261: numbers, units, sizes, grades exact, a near-miss ASKS
  'itemmatch-corpus-mutation.test.cjs', // CAT-75: the corpus goes red under exact-match and under the old per-token tolerance on numbers and sizes
  'db-error-survives.test.cjs', // PLT-86: a pool error and a held-client error are logged, the process lives, the next query gets a fresh connection
  'db-error-survives-mutation.test.cjs', // PLT-86: with each handler removed the test above goes red
  'books-yearclose-reopen.test.cjs' // year reopen: loads the books engines
];
module.exports = { NEEDS_ENGINES };

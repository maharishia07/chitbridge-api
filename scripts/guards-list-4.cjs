/**
 * guards-list-4.cjs — PART 4 OF 4 OF THE OFFLINE GUARD LIST (split out of guards-list-3.cjs, 27 Nov 2026, batch 1134: part 3 passed 500 lines, the filesize ratchet's ceiling for a new file).
 *
 * OWNER     cb-qa
 * OWNS      GUARDS_PART: the last 8 entries of the declared offline list, in run order (first: w4bank-1130.test.cjs). Add a guard to THIS, the LAST part, the day it becomes true; when it nears 500 lines open guards-list-5.cjs.
 * CALLED BY scripts/guards-list.cjs (joins the four parts, order kept) · tests that read the list as text: every-test-is-enrolled, junit-board, filesize-ratchet, readability-guard, junk-fuzz, sec-7
 * FLOW      guards-list.cjs requires this file ──▶ one array, no entry changed ──▶ scripts/guards.cjs ──▶ scripts/guards-run.cjs
 * CARD      qa/offline-guards
 */
'use strict';
const GUARDS_PART = [
  'w4bank-1130.test.cjs', // wave7 1130: enrolled (every-test-is-enrolled)
  'rw3-counter-name.test.cjs', // wave7 1130: enrolled (every-test-is-enrolled)
  'rw3firm-1130.test.cjs', // wave7 1130: enrolled (every-test-is-enrolled)
  'rw3home-1130.test.cjs', // wave7 1130: enrolled (every-test-is-enrolled)
  'ctr-dupbill-1133.test.cjs', // CTR-DUPBILL: a refused bill number steps to the next free one
  'cat344-start-priced-1133.test.cjs', // CAT-344: Start your shop prices an unpriced list
  'cat345-starter-unpriced-1133.test.cjs', // CAT-345: every starter list is unpriced outside the home country
  'acc417-adjustments.test.cjs', // ACC-417: BAS rows split into adjustment and plain by the pack's event list
  'acc418-bad-debt.test.cjs', // ACC-418: the invoice a write-off / recovery names: its own GST, read from the posted tax lines
  'acc420-lodged-pin.test.cjs', // ACC-420: a lodged period read under another version = a loud receipt (one enforcer lodgedCheck)
  'acc420-setting-route.test.cjs', // ACC-420 / 1138 Finding 1: POST /api/books/setting CALLED live: a valid restamp 200, backward / non-period-start refused; drop the two contract keys = red
  'au-pack-pin-1138.test.cjs', // pack pinning: a day reads under the version in force; restamp forward only, from a period start, audited
  'guards-list.test.cjs', // apitrim 1129: the list in three parts is one array, in order, no name lost or twice
];
module.exports = { GUARDS_PART };

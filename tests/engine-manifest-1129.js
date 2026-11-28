'use strict';
/**
 * tests/engine-manifest-1129.js — the lib files batch 1129 added, classified for engine-boundary.test.js (21 Nov 2026; kept beside tests/engine-manifest-l16.js because engine-manifest.js's size row may not grow).
 * OWNS      the two lists engine-manifest-l16.js appends to INFRA and PENDING
 * CALLED BY tests/engine-manifest-l16.js (one line at its foot)
 *
 * INFRA: plumbing that decides no money, tax or rule of its own: the backfill door and its date, the "not registered" answer, the quantity comparison of a credit note (units, not money), the import's bad-rows
 * file, the invite's remote refusal, a credit limit moved to minor units through money.toMinor.
 * Added by readRed: products-import-rows (the import's answer sentence and row filters, RISK plain) and products-media-guard (picture type and who may read it: security, no money) are INFRA.
 * PENDING: the five moved out of routes in read1129 (books-bs-shape: P&L/BS shapes; chits-send-bill: the send steps; tax-engine-line, tax-line-status: the tax engine's line input and status; till-credit-note-money: credit-note signs) pick or regroup money and tax figures that engines own, so cb-capability decides engine or not, as for the l16 four. And: these two sum or check money for a page (the tenders of a bill against its total; the input tax the off-rail purchases posted). Whether that is engine (books/counter) or stays here is
 * cb-capability's call, as for the l16 four; the money-no-arithmetic guard sees neither. Keep this list small and shrinking.
 */
const INFRA = ['books-backfill.js', 'books-events-batch.js', 'books-return-registration.js', 'credit-qty.js', 'import-rejects.js', 'network-invite-guard.js', 'party-credit.js', 'products-import-rows.js', 'products-media-guard.js',
  'books-return-gst-gap.js', /* FW-32 (1130, accW2): the tax-missing-on-sales sentence of a return box: reads the return's own boxes and the pack's rate, every sum and the percent go through books-money-ops (ACC-206): the parent books-period's class (infra), no rule of its own */
  'books-bad-debt.js', /* ACC-418 (1138): reads the GST and gross a named invoice's own posted lines hold (one store read) and hands them to the posting engine, which splits (engines posting-bad-debt); no arithmetic of its own: INFRA */
  'chit-bill-step.js' /* 1130 (foldreds): the bill's history step written once, lifted unchanged out of chit-move.js for its size: the parent's class (infra) */
];
const PENDING = ['offrail-itc.js', 'tender-sum.js', 'books-bs-shape.js', 'chits-send-bill.js', 'tax-engine-line.js', 'tax-line-status.js', 'till-credit-note-money.js', 'bill-no.js', 'rail-invoice-number.js', 'credit-original.js', 'rcm-lines.js', 'clearance-gather.js'];
module.exports = { INFRA, PENDING };

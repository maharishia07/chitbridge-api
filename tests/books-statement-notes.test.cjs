/**
 * books-statement-notes.test.cjs — W15-93: the Balance sheet carries Total liabilities and Total equity (summed once, here, from the engine's own lines) and names a netted tax line's two ledgers.
 * OWNS      the proof on lib/books-statement-notes.js and on the real AU pack's taxNetting; the two sides add back to the engine's one total.
 * CALLED BY node tests/books-statement-notes.test.cjs (offline, no server, no database)
 */
'use strict';
const N = require('../lib/books-statement-notes');
const B = require('../lib/books');
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

const liabilities = [{ code: '2100', name: 'Suppliers', amount_minor: 2125730, role: 'creditors' }, { code: '2200', name: 'GST payable to the ATO', amount_minor: 1400972, role: 'gst_payable' }];
const equity = [{ code: '3000', name: "Owner's capital", amount_minor: 2605805 }, { code: null, name: 'Net profit', amount_minor: 7928498 }];
ok(N.totalOf(liabilities, 'INR') === 3526702, 'Total liabilities = 21,257.30 + 14,009.72 = 35,267.02 (minor 3526702): ' + N.totalOf(liabilities, 'INR'));
ok(N.totalOf(equity, 'INR') === 10534303, 'Total equity = 26,058.05 + 79,284.98 = 105,343.03: ' + N.totalOf(equity, 'INR'));
ok(N.totalOf(liabilities, 'INR') + N.totalOf(equity, 'INR') === 14061005, 'the two sides add back to the one engine total 140,610.05');
ok(N.totalOf([], 'INR') === 0 && N.totalOf(null, 'INR') === 0, 'an empty or missing side is 0');

const au = B.packOf({ country: 'AU' });
const pres = (au && au.presentation) || {};
const chart = [{ code: '2200', name: 'GST collected', role: 'gst_collected' }, { code: '2210', name: 'GST paid', role: 'gst_paid' }];
const notes = N.netOfByRole(pres.taxNetting, chart);
ok(notes.gst_payable && notes.gst_payable[0].code === '2200' && notes.gst_payable[1].code === '2210', 'AU: the net payable line names 2200 GST collected then 2210 GST paid: ' + JSON.stringify(notes.gst_payable));
ok(notes.gst_refund_due && notes.gst_refund_due.length === 2, 'AU: the refund-due line names the same two');
const rows = N.withNetOf(liabilities, notes);
ok(rows[1].net_of && rows[1].net_of.length === 2 && !rows[0].net_of, 'only the GST row carries net_of; Suppliers is untouched');
ok(liabilities[1].net_of === undefined, 'the engine rows are not changed');
ok(JSON.stringify(N.withNetOf(liabilities, N.netOfByRole(undefined, chart))) === JSON.stringify(liabilities), 'a pack with no netting rules: rows unchanged');
process.exitCode = bad ? 1 : 0;

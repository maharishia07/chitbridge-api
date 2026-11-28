/**
 * tests/acc417-adjustments.test.cjs — ACC-417: lib/books-period-taxed.js splitAdjustments splits each tax row in two rows of the same code (the adjustment entries, tagged, and the rest) so the movement is unchanged.
 * OWNS      the hand figures: seller credit note GST 30.00 on a month with 100.00 collected; buyer supplier credit 30.00 on 40.00 paid; a pack with no events row reads as before
 * CALLED BY scripts/guards.cjs · CI. No database: a stand-in handle answers the one statement per role.
 * FLOW      (handle, entity, ctx, start, end, rows) → rows split in place
 * CARD      14-accounting/README
 * MIN unit-per-rule · MIN fail-closed
 */
'use strict';
const assert = require('assert');
const { splitAdjustments } = require('../lib/books-period-taxed');
let checks = 0;
const ok = (name, got, want) => { assert.deepStrictEqual(got, want, name); checks++; console.log('   ok   ' + name); };
const handle = (byRole) => ({ query: async (sql, params) => ({ rows: [byRole[params[3]] || { dr_minor: 0, cr_minor: 0 }] }) });
const pack = (events) => ({ taxLedgers: { gst: { output: 'gst_collected', input: 'gst_paid' } }, returns: events ? { adjustments: { events } } : {} });
const EV = ['return', 'credit_note', 'purchase_return', 'write_off'];
const sum = (rows, role) => rows.filter((r) => r.role === role).reduce((a, r) => a + r.dr_minor - r.cr_minor, 0);
(async () => {
  const rows = [{ code: '2200', role: 'gst_collected', dr_minor: 3000, cr_minor: 10000 }, { code: '1500', role: 'gst_paid', dr_minor: 4000, cr_minor: 3000 }];
  const before = [sum(rows, 'gst_collected'), sum(rows, 'gst_paid')];
  await splitAdjustments(handle({ gst_collected: { dr_minor: 3000, cr_minor: 0 }, gst_paid: { dr_minor: 0, cr_minor: 3000 } }), 'E1', { pack: pack(EV) }, '2026-10-01', '2026-12-31', rows);
  ok('four rows, the plain one first, the tagged one after', rows.map((r) => r.role + ':' + (r.adj || 'plain')), ['gst_collected:plain', 'gst_collected:adjustment', 'gst_paid:plain', 'gst_paid:adjustment']);
  ok('seller: plain collected 100.00 credit; adjustment 30.00 debit', [rows[0].dr_minor, rows[0].cr_minor, rows[1].dr_minor, rows[1].cr_minor], [0, 10000, 3000, 0]);
  ok('buyer: plain paid 40.00 debit; adjustment 30.00 credit', [rows[2].dr_minor, rows[2].cr_minor, rows[3].dr_minor, rows[3].cr_minor], [4000, 0, 0, 3000]);
  ok('the movement of each role is unchanged by the split', [sum(rows, 'gst_collected'), sum(rows, 'gst_paid')], before);
  const none = [{ code: '2200', role: 'gst_collected', dr_minor: 0, cr_minor: 100 }];
  await splitAdjustments(handle({}), 'E1', { pack: pack(null) }, '2026-10-01', '2026-12-31', none);
  ok('a pack with no events row reads as before', none.length, 1);
  const nothing = [{ code: '2200', role: 'gst_collected', dr_minor: 0, cr_minor: 100 }];
  await splitAdjustments(handle({}), 'E1', { pack: pack(EV) }, '2026-10-01', '2026-12-31', nothing);
  ok('no adjustment entries: no extra row', nothing.length, 1);
  console.log('\n' + checks + ' checks');
})().catch((e) => { console.log('   FAIL ' + e.message); process.exit(1); });

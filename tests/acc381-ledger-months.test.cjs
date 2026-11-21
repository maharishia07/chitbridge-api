/**
 * tests/acc381-ledger-months.test.cjs — ACC-381: GET /api/books/ledger/:account carries `months` — server totals per posting month, minor units.
 * Through real express over the in-memory ledger (shop's day 2026-10-10, FY 2026-27 from 1 Apr).
 *
 * HAND (INR paise), Cash 1400: opening JV 2026-10-01 Dr 1400 1,000,000 / Cr 3000 1,000,000 (period 0: in the opening, never a band);
 *   rent 2026-10-05 Cr 1400 16,500 · rent 2026-10-09 Cr 1400 4,000 · cash sale 2026-09-15 Dr 1400 30,000 (Dr 1400 / Cr 4000).
 *   from 2026-04-01 to 2026-10-31 → opening 1,000,000;
 *     2026-09: debit 30,000  credit      0  closing 1,030,000
 *     2026-10: debit      0  credit 20,500  closing 1,009,500   (= closing_minor; the trial balance's Cash)
 *   from 2026-10-01 → opening 1,030,000 and only the October band (closing 1,009,500)
 *   paged (?limit=1) → the same bands (a page does not shrink them)
 *   an unknown account is still the one 404; a month with no line is not listed.
 * Run: node tests/acc381-ledger-months.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
const { rig, counter } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();

(async () => {
  console.log('\n══ ACC-381 — the ledger answers its month bands ══\n');
  const R = await rig(); if (!R) return;
  const { q } = R;
  const post = async (ref, date, lines) => { const r = await q('POST', '/entries', { narration: ref, date, client_ref: ref, lines }); ok('(set-up) ' + ref + ' posts', r.status === 200, JSON.stringify(r.body)); };
  const op = await q('POST', '/opening', { date: '2026-10-01', rows: [{ code: '1400', dr_minor: 1000000 }, { code: '3000', cr_minor: 1000000 }], client_ref: 'mid' });
  ok('(set-up) the opening posts', op.status === 200, JSON.stringify(op.body));
  await post('sale', '2026-09-15', [{ code: '1400', dr_minor: 30000 }, { code: '4000', cr_minor: 30000 }]);
  await post('rent1', '2026-10-05', [{ code: '6010', dr_minor: 16500 }, { code: '1400', cr_minor: 16500 }]);
  await post('rent2', '2026-10-09', [{ code: '6010', dr_minor: 4000 }, { code: '1400', cr_minor: 4000 }]);
  const sep = { month: '2026-09', debit_minor: 30000, credit_minor: 0, closing_minor: 1030000 };
  const oct = { month: '2026-10', debit_minor: 0, credit_minor: 20500, closing_minor: 1009500 };
  const all = await q('GET', '/ledger/1400?from=2026-04-01&to=2026-10-10');
  eq('year view: opening and the two bands', [all.body.opening_minor, all.body.months], [1000000, [sep, oct]]);
  eq('the last band closes where the ledger closes', all.body.months[1].closing_minor, all.body.closing_minor);
  const mid = await q('GET', '/ledger/1400?from=2026-10-01&to=2026-10-10');
  eq('from 1 Oct: opening 1,030,000, one band', [mid.body.opening_minor, mid.body.months], [1030000, [oct]]);
  const paged = await q('GET', '/ledger/1400?from=2026-04-01&to=2026-10-10&limit=1');
  eq('a page of one line still carries both bands', paged.body.months, [sep, oct]);
  const none = await q('GET', '/ledger/1400?from=2026-11-01&to=2026-11-30');
  eq('a range with no line has no bands', none.body.months, []);
  const bad = await q('GET', '/ledger/9999');
  eq('an unknown account is the one 404', [bad.status, bad.body.code], [404, 'NOT_FOUND']);
  const blind = require('../lib/dues-view').blindBooks('ledger', all.body, { account: { code: '1400', role: 'cash', nature: 'asset' } });
  eq('a cost-blind reader gets the bands with the money null, the months kept', blind.months.map((b) => [b.month, b.debit_minor, b.credit_minor, b.closing_minor]), [['2026-09', null, null, null], ['2026-10', null, null, null]]);
  /* unit per rule (lib/ledger-months.js bands + monthSums), the refusal path and the fail-closed path */
  const LM = require('../lib/ledger-months');
  eq('unit: bands carry the opening through each month Dr - Cr', LM.bands(100, [{ month: '2026-01', dr: '50', cr: 20 }, { month: '2026-02', dr: 0, cr: 200 }]), [{ month: '2026-01', debit_minor: 50, credit_minor: 20, closing_minor: 130 }, { month: '2026-02', debit_minor: 0, credit_minor: 200, closing_minor: -70 }]);
  eq('unit: no rows is no bands, an unreadable opening counts as zero (never NaN)', [LM.bands(undefined, []), LM.bands('x', [{ month: '2026-03', dr: 5, cr: 0 }])[0].closing_minor], [[], 5]);
  eq('unit: a row with no sums is refused as zero money, never a NaN band', LM.bands(0, [{ month: '2026-04', dr: null, cr: undefined }]), [{ month: '2026-04', debit_minor: 0, credit_minor: 0, closing_minor: 0 }]);
  let sql = '';
  await LM.monthSums({ query: async (text) => { sql = text; return { rows: [] }; } }, 'e', '2026-04-01', '2026-10-10', null, null, true);
  ok('unit: a read with the opening already held leaves period 0 out (never counts it twice)', /h.period <> 0/.test(sql));
  let failed = null;
  try { await LM.monthSums({ query: async () => { throw new Error('database unavailable'); } }, 'e', '2026-04-01', '2026-10-10'); } catch (e) { failed = e; }
  ok('fail closed: a database that is down throws, it never returns half-made bands', !!failed && /unavailable/.test(failed.message));
  R.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });

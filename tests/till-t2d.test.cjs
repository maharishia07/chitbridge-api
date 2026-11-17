/**
 * till-t2d.test.cjs - ROUND T2d (M157 month lock, M162b billed order not open), no DB, no network, no browser.
 * (M144 / M174 live in home-facts.test.cjs / books-payments.test.cjs.)
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
let n = 0, bad = 0;
const ok = async (label, fn) => { try { await fn(); n++; console.log('  ok    ' + label); } catch (e) { bad++; console.log('  FAIL  ' + label + '\n        ' + (e && e.message)); } };

const B = require(API + '/lib/books');
const month = (fy, period, status) => { const y = Number(fy.slice(0, 4)) + (period > 9 ? 1 : 0), m = ((period + 2) % 12) + 1;
  const end = new Date(Date.UTC(y, m, 0)); return { fiscal_year: fy, period, status, end_date: end.toISOString().slice(0, 10) }; };
const year = (fy, status) => [{ fiscal_year: fy, period: 0, status: 'open', end_date: null }].concat(Array.from({ length: 12 }, (_, i) => month(fy, i + 1, status)));

(async () => {
  console.log('\n-- M157 the first month of the year can be locked --');
  await ok('a year with entries from April: April (period 1) is lockable once over, though the opening period 0 is open', () => {
    const rows = year('2026-27', 'open');
    const out = B.periodAdvice(rows, [{ fiscal_year: '2026-27', period: 1, entries: 4, sales_minor: 1000 }], '2026-10-10');
    const apr = out.find((r) => r.period === 1), may = out.find((r) => r.period === 2), oct = out.find((r) => r.period === 7);
    assert.strictEqual(apr.end_date, '2026-04-30'); assert.strictEqual(apr.lock.may, true); assert.strictEqual(apr.lock.why, null);
    assert.strictEqual(may.lock.may, false); assert.strictEqual(may.lock.why, 'Lock the earlier months first.');
    assert.strictEqual(oct.lock.why, 'This month is not over yet.');
  });
  await ok('after April is locked, May is next', () => {
    const rows = year('2026-27', 'open'); rows[1].status = 'soft_locked';
    const out = B.periodAdvice(rows, [], '2026-10-10');
    assert.deepStrictEqual(out.filter((r) => r.period >= 1 && r.period <= 7).map((r) => r.lock.may), [false, true, false, false, false, false, false]);
  });
  await ok('a previous year that is in the books counts: its open months come first; locked, the new year\'s April is free', () => {
    const rows = year('2025-26', 'open').concat(year('2026-27', 'open'));
    assert.strictEqual(B.periodAdvice(rows, [], '2026-10-10').find((r) => r.fiscal_year === '2026-27' && r.period === 1).lock.why, 'Lock the earlier months first.');
    const locked = year('2025-26', 'hard_locked').concat(year('2026-27', 'open'));
    assert.strictEqual(B.periodAdvice(locked, [], '2026-10-10').find((r) => r.fiscal_year === '2026-27' && r.period === 1).lock.may, true);
  });

  console.log('\n-- M162b an online order with a bill against it is not open --');
  const OO_PATH = require.resolve(API + '/lib/open-orders');
  const stub = (p, exp) => { require.cache[require.resolve(API + p)] = { id: p, filename: p, loaded: true, exports: exp }; };
  const asked = [];
  stub('/db', { withEntity: async (_e, fn) => fn({ query: async (sql, params) => {
    asked.push(String(sql));
    if (/FROM chit_header h\s+LEFT JOIN chit_detail/.test(sql)) return { rows: ['o1', 'o2'].map((id) => ({ chit_id: id, business_json: {},
      line_items: [{ particulars: 'Tea', quantity: 2, unit: 'piece', price: 45 }] })) };
    if (/'against'/.test(sql)) return { rows: [{ against: null, billed: 'o1' }] };   /* the bill C5/26-27/0007 names order o1 */
    return { rows: [] };
  } }) });
  stub('/lib/select', { rows: async () => ['o1', 'o2'].map((id) => ({ chit_id: id, direction: 'received', created_at: '2026-10-10T05:00:00Z', counterparty_name: 'athi', summary_json: null })) });
  stub('/lib/deliverline', { progressMany: async () => new Map(), lineIdOf: (c, l, i) => c + ':' + i });
  stub('/lib/tax-copy', { billReceived: () => false });
  delete require.cache[OO_PATH];
  const OO = require(OO_PATH);
  await ok('o1 (billed) is left out, o2 stays; ONE extra read for every order', async () => {
    const t = await OO.tasks('e1', 'despatch', 50);
    assert.deepStrictEqual(t.map((x) => x.chit_id), ['o2']);
    assert.strictEqual(asked.filter((s) => /'against'/.test(s)).length, 1);
  });
  console.log('\n-- M169 / M170 the till page --');
  const PAGE = require('fs').readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
  await ok('M169 (T2f): the order kind is never written to the counter saved default - see till-t2f.test.cjs', () => {
    assert(!PAGE.includes('orderKindGiveBack') && !PAGE.includes('prev_kind'));
  });
  await ok('M170: Close the day shows only on the day report; F10 repaints even over an open bill slip', () => {
    assert(PAGE.includes("function slipDocButtons(printOn, shareOn, doc){\n  SLIP_DOC = doc === 'day' ? 'day' : 'bill';"));
    assert(PAGE.includes("slipDocButtons(true, false, 'day');") && PAGE.includes("cb.hidden = !!d.closed || SLIP_DOC !== 'day'"));
    assert(PAGE.includes('if (tok !== DAY_TOK) return;') && PAGE.includes('if (sd.open) sd.close();'));
  });
  console.log('\n  ' + n + ' passed' + (bad ? ', ' + bad + ' FAILED' : '') + '\n');
  process.exit(bad ? 1 : 0);
})();

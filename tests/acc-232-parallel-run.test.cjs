'use strict';
/**
 * tests/acc-232-parallel-run.test.cjs — ACC-232 (the part that needs no route edit): a correct month is not shown as different, and our wrong entry is not worded as theirs.
 *   · Xero / QuickBooks credit notes sit on Sales: our returns ledger is folded into Sales (derived from the chart's roles), the parts printed; Tally keeps its own
 *   · their one GST account is our two: said in words, the parts printed (the real pool waits for the pack in compare(), after open PR #770 frees routes/books.js)
 *   · explain reads the chit's status: a cancelled, unreversed sale of ours is OURS to reverse; a reversed one and a live rail bill keep the old words
 *   · their return for another period than ours compares nothing and says so; a file with no start date is said
 * Hand figures: Sales 4000 Cr 600.00, returns 4090 Dr 100.00 = 500.00 Cr = their Sales. Pure over lib/parallel-run.compare.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PR = require('../lib/parallel-run');
const E = require('../lib/books-engines');
const AU = require('../lib/reg-au');

let pass = 0,
  fail = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log('  PASS  ' + name);
    pass++;
  } catch (e) {
    console.log('  FAIL  ' + name + '\n        ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n        '));
    fail++;
  }
};
function chartFromPack(pack) {
  const rows = E.chartRows(pack),
    ids = new Map();
  return rows.map((r, i) => {
    const id = '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0');
    ids.set(r.code, id);
    return {
      account_id: id,
      code: r.code,
      name: r.name,
      parent_id: r.parent ? ids.get((rows.find((x) => x.key === r.parent && x.is_group) || {}).code) || null : null,
      is_group: r.is_group,
      nature: r.nature,
      role: r.role || null,
      active: true,
      source_code: null
    };
  });
}
const chart = chartFromPack(AU);
const tb = (list) => ({ rows: list.map(([code, name, dr, cr]) => ({ code, name, debit_minor: dr, credit_minor: cr })), total_dr_minor: 0, total_cr_minor: 0 });
const their = (name, amount) => ({ line: 2, name, code: null, amount_minor: amount, dr_minor: amount > 0 ? amount : 0 });
const run = (part, ours, lines, source) =>
  PR.compare({ parts: [part], chart, ours: { [part.part]: ours }, lines: lines || [], currency: 'AUD', from: '2026-10-01', to: '2026-10-31' });
const tbPart = (rows, source) => ({ part: 'tb', source: source || 'xero', period_to: '2026-10-31', period_from: '2026-10-01', rows });
const line = (result, name) => result.parts.tb.lines.find((x) => x.name === name || x.their_name === name);

console.log('\nACC-232 · pooling that never hides a difference');
t('Xero: their Sales (net of credit notes) 500.00 Cr = our 4000 Cr 600.00 + 4090 Dr 100.00: equal, with its parts printed', () => {
  const r = run(tbPart([their('Sales', -50000)]), tb([['4000', 'Sales', 0, 60000], ['4090', 'Sales returns and allowances', 10000, 0]]));
  const sales = line(r, 'Sales');
  assert.strictEqual(sales.status, 'equal');
  assert.deepStrictEqual(sales.our_codes, ['4000', '4090']);
  assert.ok(/4000 Sales A\$600\.00 Cr and 4090 Sales returns and allowances A\$100\.00 Dr together/.test(sales.why), sales.why);
  assert.ok(!r.parts.tb.lines.some((x) => x.status === 'only_ours'), 'no false only-ours row');
});
t('the fold never hides an error: our returns 150.00 against their 500.00 stays DIFFERENT by 50.00 (ours 450.00 Cr, theirs 500.00 Cr), with the parts in the sentence', () => {
  const r = run(tbPart([their('Sales', -50000)]), tb([['4000', 'Sales', 0, 60000], ['4090', 'Sales returns and allowances', 15000, 0]]));
  const sales = line(r, 'Sales');
  assert.deepStrictEqual([sales.status, sales.diff_minor], ['different', 5000]);
  assert.ok(/4090 Sales returns and allowances A\$150\.00 Dr/.test(sales.why), sales.why);
});
t('Tally keeps a separate returns ledger: nothing is folded, 4090 is shown as only ours', () => {
  const r = run(tbPart([their('Sales', -60000)], 'tally'), tb([['4000', 'Sales', 0, 60000], ['4090', 'Sales returns and allowances', 10000, 0]]));
  assert.deepStrictEqual(line(r, 'Sales').our_codes, ['4000']);
  assert.ok(r.parts.tb.lines.some((x) => x.status === 'only_ours' && x.our_codes[0] === '4090'));
});
t('their file has its own Sales returns line: nothing is folded (the two are compared one to one)', () => {
  const rows = [their('Sales', -60000), Object.assign(their('Sales returns and allowances', 10000), { line: 3 })];
  const r = run(tbPart(rows), tb([['4000', 'Sales', 0, 60000], ['4090', 'Sales returns and allowances', 10000, 0]]));
  assert.deepStrictEqual(line(r, 'Sales').our_codes, ['4000']);
  assert.strictEqual(r.parts.tb.counts.only_ours, 0);
});
t('their ONE GST account against our two: the row says it is our two with both parts; the 2210 row says it is the other half (the real pool waits for the pack)', () => {
  const r = run(tbPart([their('GST', -30500)]), tb([['2200', 'GST collected', 0, 40000], ['2210', 'GST paid', 9500, 0]]));
  const gst = line(r, 'GST collected') || line(r, 'GST');
  assert.ok(/Their one GST account is our 2 \(2200 GST collected A\$400\.00 Cr and 2210 GST paid A\$95\.00 Dr\)/.test(gst.why), gst.why);
  const paid = line(r, 'GST paid');
  assert.strictEqual(paid.status, 'only_ours');
  assert.ok(/this is the other half/.test(paid.why), paid.why);
});

console.log('\nACC-232 · explain reads the chit: our wrong entry is OURS');
const entry = (over) =>
  Object.assign({ entry_id: 'e1', entry_no: 41, posting_date: '2026-10-20', code: '4000', dr_minor: 0, cr_minor: 22000, source_chit_id: 'c1', src_chit_id: 'c1', src_ref: 'INV-0203', event_type: 'sale_bill', reversed_by_id: null }, over);
const wrongRun = (over) => run(tbPart([their('Sales', 0)]), tb([['4000', 'Sales', 0, 22000]]), [entry(over)]);
t('a CANCELLED sale still counted: "ours to reverse", never "came on the rail; theirs does not have it yet"', () => {
  const sales = line(wrongRun({ src_status: 'cancelled' }), 'Sales');
  assert.strictEqual(sales.cause, 'ours_wrong');
  assert.ok(/on a bill that was cancelled, but the books still count it/.test(sales.why) && /ours to reverse/.test(sales.why), sales.why);
  assert.ok(!/theirs does not have it yet/.test(sales.why));
});
t('the same sale already REVERSED is not blamed as wrong (the old reading stands), and a live rail bill keeps its words', () => {
  assert.notStrictEqual(line(wrongRun({ src_status: 'cancelled', reversed_by_id: 'e2' }), 'Sales').cause, 'ours_wrong');
  const live = line(wrongRun({ src_status: 'accepted' }), 'Sales');
  assert.strictEqual(live.cause, 'rail_later');
  assert.ok(/came on the rail; theirs does not have it yet/.test(live.why));
});
t('their larger figure is not "Ask them for it": it asks to look in our books first', () => {
  const r = run(tbPart([their('Sales', -90000)]), tb([['4000', 'Sales', 0, 60000]]));
  const sales = line(r, 'Sales');
  assert.strictEqual(sales.cause, 'only_theirs');
  assert.ok(/look for it in our books first/.test(sales.why) && !/Ask them for it/.test(sales.why), sales.why);
});
t('entryLines reads the chit status from its one lateral chit read (no new trip); SQL pinned, unrun here', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'books-store.js'), 'utf8');
  assert.ok(/cst\.current_status AS src_status/.test(src) && /LEFT JOIN chit_status cst ON cst\.chit_id = c\.chit_id AND cst\.entity_id = \$1 AND cst\.direction = c\.direction/.test(src) && !/x\.status, x\.business_json/.test(src) /* chit_header has no status column, it lives in chit_status: SIT run 15 found the 500; the real query runs in CI realstack (people-truth) */);
});

console.log('\nACC-232 · their return is for THEIR period');
const ret = { part: 'ret', source: 'xero', period_to: '2026-10-31', period_from: '2026-10-01', rows: [{ line: 2, name: 'G1', amount_minor: 100000, tax_minor: null }] };
const ourReturn = (start, end) => ({ short: 'BAS', note: null, period: { start, end, label: '2026-Q2' }, boxes: [{ code: 'G1', label: 'Total sales', amount_minor: 100000, tax_minor: null, accounts: [] }] });
const retRun = (part, ours) => PR.compare({ parts: [part], chart, ours: { ret: ours }, lines: [], currency: 'AUD', from: '2026-10-01', to: '2026-10-31' }).parts.ret;
t('a monthly file against our quarter: ONE gap line naming both periods, no box compared', () => {
  const r = retRun(ret, ourReturn('2026-10-01', '2026-12-31'));
  assert.strictEqual(r.lines.length, 1);
  assert.deepStrictEqual([r.lines[0].status, r.lines[0].cause], ['gap', 'period']);
  assert.ok(/Their return covers 2026-10-01 to 2026-10-31; ours is 2026-Q2 \(2026-10-01 to 2026-12-31\)\. Nothing was compared/.test(r.lines[0].why), r.lines[0].why);
});
t('the same period compares the boxes as before', () => {
  const r = retRun(ret, ourReturn('2026-10-01', '2026-10-31'));
  assert.strictEqual(r.lines[0].status, 'equal');
  assert.strictEqual(r.note, null);
});
t('a file that names no start date: compared as before, with the line saying it is read as ours', () => {
  const r = retRun(Object.assign({}, ret, { period_from: null }), ourReturn('2026-10-01', '2026-10-31'));
  assert.strictEqual(r.lines[0].status, 'equal');
  assert.ok(/names no start date: it is read as ours \(2026-10-01 to 2026-10-31\)/.test(r.note), r.note);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

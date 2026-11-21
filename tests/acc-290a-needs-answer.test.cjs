/**
 * tests/acc-290a-needs-answer.test.cjs — ACC-290 part A: GET /books/returns says how much of the period's sales sit at 0% with no supply kind.
 *
 * OWNS      the proof of books-period.unknownKindNeed over the in-memory books (store twin zeroRateSales): the count and the total, in the shop's currency, of
 *           0% lines on the pack's plain sales role; a reversed entry, a reversal, a line outside the period, a taxed line, a named-kind ledger and a line in
 *           another currency are NOT counted; a pack with no `returns.unknownKind` row answers null (engines not yet adopted); nothing waiting answers null.
 * CALLED BY scripts/guards.cjs · CI. No database: the SQL is proved by the S41 integration job and tests/books-store-sql.test.cjs (shape only).
 * Hand figures (AUD cents): sales 4000 credits 100000 (0%) + 50000 ('0.0') in Q3 = 2 lines, 150000 = A$1,500.00; excluded: 70000 at 10%, 30000 reversed,
 *           20000 on 4020 (gst_free), 10000 on 2026-10-01 (outside), 5000 USD.
 * Run: node tests/acc-290a-needs-answer.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); process.exitCode = 1; } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

(async () => {
  console.log('\n== ACC-290 A: needs_answer — 0% sales with no supply kind ==\n');
  const X = H.load({});
  const P = require(path.join(H.API, 'lib', 'books-period'));
  const SHOP = 'aaaaaaaa-1111-4111-8111-111111111111';
  const SALES = 'a0000000-0000-4000-8000-000000000001', FREE = 'a0000000-0000-4000-8000-000000000002';
  X.T.accounts.push({ account_id: SALES, entity_id: SHOP, code: '4000', role: 'sales' }, { account_id: FREE, entity_id: SHOP, code: '4020', role: 'sales_gst_free' });
  let n = 0;
  const post = (day, account, cr, rate, extra) => {
    const entry_id = 'e' + (++n);
    X.T.entries.push(Object.assign({ entry_id, entity_id: SHOP, posting_date: day }, (extra && extra.entry) || {}));
    X.T.lines.push({ entry_id, entity_id: SHOP, account_id: account, party_id: null, dr_minor: 0, cr_minor: cr, currency: (extra && extra.currency) || 'AUD', tax_rate: rate });
    return entry_id;
  };
  post('2026-07-10', SALES, 100000, '0');
  post('2026-08-15', SALES, 50000, '0.0');
  post('2026-08-20', SALES, 70000, '10');
  const gone = post('2026-09-01', SALES, 30000, '0');
  X.T.entries.push({ entry_id: 'rev1', entity_id: SHOP, posting_date: '2026-09-02', reverses_entry_id: gone });
  post('2026-09-05', FREE, 20000, '0');
  post('2026-10-01', SALES, 10000, '0');
  post('2026-09-09', SALES, 5000, '0', { currency: 'USD' });

  const row = { id: 'unknown', role: 'sales', kinds: ['taxable', 'gst_free', 'input_taxed'], boxes: ['G3'], ask: 'Is this sale taxable, GST-free or input-taxed?', why: 'x' };
  const period = { start: '2026-07-01', end: '2026-09-30' };
  const need = await P.unknownKindNeed(X.dbStub, SHOP, { returns: { unknownKind: row } }, period, 'AUD');
  eq('2 lines, A$1,500.00 (150000 AUD minor), in the shop currency', [need.count, need.total_minor, need.currency], [2, 150000, 'AUD']);
  eq('it carries the pack row: kind, role, kinds, boxes, ask', [need.kind, need.role, need.kinds, need.boxes, need.ask], ['unknown', 'sales', row.kinds, ['G3'], row.ask]);
  eq('a pack with no unknownKind row (not adopted yet) answers null', await P.unknownKindNeed(X.dbStub, SHOP, { returns: {} }, period, 'AUD'), null);
  eq('nothing waiting in the period answers null', await P.unknownKindNeed(X.dbStub, SHOP, { returns: { unknownKind: row } }, { start: '2027-01-01', end: '2027-03-31' }, 'AUD'), null);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
})().catch((e) => { console.log('   FAIL threw ' + e.stack); process.exitCode = 1; });

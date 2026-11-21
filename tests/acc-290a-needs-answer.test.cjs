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
  const need = await P.unknownKindNeed(X.dbStub, SHOP, { returns: { unknownKind: row } }, period, 'AUD', true);
  eq('2 lines, A$1,500.00 (150000 AUD minor), in the shop currency', [need.count, need.total_minor, need.currency], [2, 150000, 'AUD']);
  eq('it carries the pack row: kind, role, kinds, boxes, ask', [need.kind, need.role, need.kinds, need.boxes, need.ask], ['unknown', 'sales', row.kinds, ['G3'], row.ask]);
  eq('a pack with no unknownKind row (not adopted yet) answers null', await P.unknownKindNeed(X.dbStub, SHOP, { returns: {} }, period, 'AUD'), null);
  eq('nothing waiting in the period answers null', await P.unknownKindNeed(X.dbStub, SHOP, { returns: { unknownKind: row } }, { start: '2027-01-01', end: '2027-03-31' }, 'AUD', true), null);
  /* ── supply kind (AE-F-11): the three holes of #1306 fixed, the note clearing, the owner's own figure ── */
  console.log('\n== needs_answer: named buyer · a shop that charges nothing · items, not journal lines · a reclass clears it ==\n');
  const SHOP2 = 'bbbbbbbb-2222-4222-8222-222222222222', S2 = 'b0000000-0000-4000-8000-000000000001', S2FREE = 'b0000000-0000-4000-8000-000000000002';
  X.T.accounts.push({ account_id: S2, entity_id: SHOP2, code: '4000', role: 'sales' }, { account_id: S2FREE, entity_id: SHOP2, code: '4020', role: 'sales_gst_free' });
  const put = (day, account, dr, cr, rate, party) => {
    const entry_id = 'f' + (++n);
    X.T.entries.push({ entry_id, entity_id: SHOP2, posting_date: day });
    X.T.lines.push({ entry_id, entity_id: SHOP2, account_id: account, party_id: party || null, dr_minor: dr, cr_minor: cr, currency: 'AUD', tax_rate: rate });
  };
  const PACK = { id: 'AU', returns: { unknownKind: row } };
  put('2026-07-10', S2, 0, 100000, '0'); /* a till day close: no party */
  put('2026-07-11', S2, 0, 30000, '0', 'cccccccc-3333-4333-8333-333333333333'); /* a sent invoice to a NAMED buyer, 0%, no kind: counted (hole 1) */
  const named = await P.unknownKindNeed(X.dbStub, SHOP2, PACK, period, 'AUD', true);
  eq('hole 1: a 0% sale to a named buyer counts: 2 journal lines, A$1,300.00', [named.count, named.total_minor], [2, 130000]);
  eq('hole 2: a shop that charges no tax (unregistered, rate 0 on every line) is asked nothing', await P.unknownKindNeed(X.dbStub, SHOP2, PACK, period, 'AUD', false), null);
  X.T.kindless = { [SHOP2]: { slabs: [{ id: 's1', name: 'Plain slab' }, { id: 's2', name: 'Zero rate' }], items: 1 } };
  const again = await P.unknownKindNeed(X.dbStub, SHOP2, PACK, period, 'AUD', true);
  eq("hole 3: `count` stays JOURNAL lines (2); the owner's figure is `items` = 2 slabs + 1 item = 3, a separate number", [again.count, again.items], [2, 3]);
  eq('`slabs` lists each slab with a suggestion from its own name only (none here)', again.slabs.map((x) => [x.name, x.suggested]), [['Plain slab', null], ['Zero rate', null]]);
  /* the reclass: Dr 4000 A$1,300.00 at rate 0, Cr 4020 -> the 0% reading nets to nothing and the note is gone */
  put('2026-08-01', S2, 130000, 0, '0'); put('2026-08-01', S2FREE, 0, 130000, null);
  eq('change 4: after the reclass journal (Dr 4000 at rate 0) needs_answer is gone', await P.unknownKindNeed(X.dbStub, SHOP2, PACK, period, 'AUD', true), null);
  X.T.kindless = { [SHOP2]: { slabs: [], items: 0 } };
  put('2026-08-02', S2, 0, 5000, '0');
  const left = await P.unknownKindNeed(X.dbStub, SHOP2, PACK, period, 'AUD', true);
  eq('the amount can wait while items = 0 (the owner answered, an older posting still sits on 4000): two sentences, two figures', [left.total_minor, left.items], [5000, 0]);
  /* EGM-T1: ONE definition of 'the shop charges tax' - the return and the to-do read shopChargesTax (tax-shelf.chargesTax): composition (false) and unknown (null) are asked nothing */
  eq('a composition shop (charges false) is asked nothing, as the to-do row says', await P.unknownKindNeed(X.dbStub, SHOP2, PACK, period, 'AUD', false), null);
  eq('a shop that has not said (charges null) is asked nothing either', await P.unknownKindNeed(X.dbStub, SHOP2, PACK, period, 'AUD', null), null);
  const periodSrc = require('fs').readFileSync(path.join(H.API, 'lib', 'books-period.js'), 'utf8');
  ok('books-period holds no second definition: no chargesTax function, the return reads shopChargesTax', !/async function chargesTax\(/.test(periodSrc) && /unknownKindNeed\(handle, entity, pack, period, currency, await shopChargesTax\(handle, entity, shop\)\)/.test(periodSrc));
  ok('the to-do reads the same door', /require\('\.\/books-period'\)\.shopChargesTax/.test(require('fs').readFileSync(path.join(H.API, 'lib', 'books-todo.js'), 'utf8')));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
})().catch((e) => { console.log('   FAIL threw ' + e.stack); process.exitCode = 1; });

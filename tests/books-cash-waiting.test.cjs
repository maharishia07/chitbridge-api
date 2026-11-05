/**
 * books-cash-waiting.test.cjs — ACC-199 (lifecycle S10-2): A CASH WALK-IN BILL THAT WAITS FOR THE DAY CLOSE IS SAID, NEVER SILENT.
 *
 *   waitingWalkIns() reads the counter's day through dayFold (the fold postDay posts) and the engine's daySummary adds — count and sum are the day close's own.
 *   The to-do row `cash_bills_waiting` names them in the shop's own currency, with the action that closes the day. A posted day, a card-only bill and the
 *   per-bill grain add nothing. Run: node tests/books-cash-waiting.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111';

(async () => {
  console.log('\n══ cash walk-in bills waiting for the day close ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const TODO = require(path.join(H.API, 'lib', 'books-todo'));
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  const DAY = '2026-11-05';
  const mk = (id, how, amount, taxable, tax) => ({ chit_id: id, purpose: 'order', created_at: DAY + 'T05:00:00Z', currency_code: 'INR',
    business_json: { bill_no: 'C1-' + id, till: { id: 'C1' }, billed_at: DAY + 'T05:00:00Z', payment: { parts: [{ how, amount }] } },
    _inv: { currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: taxable, CgstAmt: tax, SgstAmt: tax, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: amount } } });
  const rows = [mk('b1', 'Cash', 118, 100, 9), mk('b2', 'Cash', 236, 200, 18), mk('b3', 'Card', 118, 100, 9)];
  TC.entryFor = async (r) => ({ sells: true, invoice: r._inv });
  X.store.countersBilling = async () => ['C1'];
  X.store.counterBills = async () => rows;
  const S = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };

  const w = await K.waitingWalkIns(SHOP, S, DAY);
  ok('two cash bills wait; the card-only bill does not', w && w.bills === 2 && w.days.length === 1 && w.days[0].counter === 'C1', JSON.stringify(w));
  ok('the sum is the engine\'s cash mode of those two bills (118 + 236), in the shop\'s currency', w && w.amount === 354 && w.currency === 'INR', JSON.stringify(w));

  const items = await TODO.todo(SHOP, Object.assign({}, S, { enabled_at: DAY + 'T00:00:00Z' }), DAY);
  const row = items.find((x) => x.kind === 'cash_bills_waiting');
  ok('the to-do names them: "2 cash bills · INR 354 wait for today\'s day close", with the action that closes the day',
    row && row.count === 2 && /^2 cash bills · INR 354 wait for today's day close/.test(row.words) && row.action.label === 'Close the day' && row.items[0].counter === 'C1', JSON.stringify(row));

  X.T.entries.push({ entry_id: 'd1', entity_id: SHOP, entry_no: 1, posting_date: DAY, event_type: 'walkin_day', source_ref: 'walkin:C1:' + DAY, source_chit_ids: ['b1', 'b2', 'b3'] });
  ok('once the day is in the books nothing waits', (await K.waitingWalkIns(SHOP, S, DAY)) === null);
  X.T.entries.pop();
  ok('per-bill grain posts each bill on its own: nothing waits for a day', (await K.waitingWalkIns(SHOP, Object.assign({}, S, { walkin_grain: 'bill' }), DAY)) === null);

  rows.forEach((r) => { r._inv.currency = 'AUD'; r.currency_code = 'AUD'; });
  const au = await K.waitingWalkIns(SHOP, { enabled: true, walkin_grain: 'day', country: 'AU', functional_currency: 'AUD' }, DAY);
  ok('an AU shop: the same read, its own currency (AUD), no India word', au && au.currency === 'AUD' && au.bills === 2, JSON.stringify(au));

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });

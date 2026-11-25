/**
 * tests/walkt-1129.test.cjs — WALK T (AE, sit-ae2, batch 1129) T-F-01: VAT201 Box 9 (standard-rated expenses) counts only the 5% lines of a bill, never its 0% lines.
 * A supplier bill is ONE entry: a bill with a 5% line and a 0% line (exempt or zero-rated: the buyer cannot tell which) used to carry its whole purchases amount into Box 9
 * (the entry carried Input VAT, so the whole entry was "taxed"). The walk's purchases, in FILS (hand, walk T cases):
 *   INV-1  Tea 3000 + VAT 150 (5%) · Rice 6000 (0%) · Gold 10000 (0%)        INV-2  Coffee 10000 + VAT 500 (5%) · Rice 3000 (0%) · Gold 10000 (0%)
 *   CN-1   Tea back, 1000 + VAT 50 (a purchase return)
 *   Purchases 42000 · returns 1000 · Input VAT 600.   HAND Box 9 = 3000 + 10000 - 1000 = 12000 / VAT 600 (seen before the fix: 41000 / 600).
 * Two carried totals are compared: Box 9 VAT = the Input VAT ledger's movement; Box 9 amount + the 0% purchases (19000) = the Purchases ledger net (41000).
 * A reversal has its own clause: reversing INV-2 takes its 10000 / 500 out of Box 9 and nothing else.
 * Run: CB_ENGINES_DIR=../chitbridge-engines node tests/walkt-1129.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-130130130130', SUPP = '33333333-3333-4333-8333-130130130130';
const SETTING = { enabled: true, walkin_grain: 'day', country: 'AE', functional_currency: 'AED' };

(async () => {
  console.log('\n== WALK T · VAT201 Box 9 counts only the 5% lines of a mixed supplier bill ==\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  const P = require(path.join(H.API, 'lib', 'books-period'));
  X.T.identities.push({ identity_id: SHOP, gstn: '100456789000003', display_name: 'AE shop', country: 'AE', policy_flags: {} });
  await X.store.saveSetting(X.db, SHOP, SETTING);
  await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-11-05' });
  X.T.parties.push({ owner: SHOP, party_id: SUPP, party_no: 'P-00001', name: 'B', supplier: true, credit_days: 30 });
  const bill = (ref, rows) => X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', ref, date: '2026-11-05', currency: 'AED', party: SUPP, by_rate: rows, paid: {}, round_off: 0, source_ref: 'pur:' + ref });
  await bill('INV-1', [{ rate: 5, taxable: 30, vat: 1.5 }, { rate: 0, taxable: 60 }, { rate: 0, taxable: 100 }]);
  const inv2 = await bill('INV-2', [{ rate: 5, taxable: 100, vat: 5 }, { rate: 0, taxable: 30 }, { rate: 0, taxable: 100 }]);
  await X.B.postEntry(X.db, SHOP, { type: 'purchase_return', ref: 'CN-1', date: '2026-11-05', currency: 'AED', party: SUPP, by_rate: [{ rate: 5, taxable: 10, vat: 0.5 }], paid: {}, round_off: 0, source_ref: 'pur:CN-1', against_ref: 'INV-1' });
  const net = (role) => {
    const acct = X.T.accounts.find((a) => a.entity_id === SHOP && a.role === role);
    return acct ? X.T.lines.filter((l) => l.account_id === acct.account_id).reduce((t, l) => t + Number(l.dr_minor || 0) - Number(l.cr_minor || 0), 0) : 0;
  };
  const box = (r, n) => (r.boxes.find((x) => String(x.code) === String(n)) || {});
  const ask = async () => P.taxReturn(SHOP, await X.B.settingOf(X.db, SHOP), { stagger: 3, period: '2026-10/2026-12' }, X.db);
  eq('the books hold purchases 42000 · returns -1000 · Input VAT 600', [net('purchases'), net('purchase_returns'), net('input_vat')], [42000, -1000, 600]);
  let r = await ask();
  eq('Box 9 amount 12000 / VAT 600 (hand: Tea 3000 + Coffee 10000 - 1000), not 41000', [box(r, 9).amount_minor, box(r, 9).tax_minor], [12000, 600]);
  eq('two carried totals: Box 9 VAT = Input VAT ledger · Box 9 amount + the 0% purchases 29000 = Purchases net of returns 41000', [box(r, 9).tax_minor === net('input_vat'), box(r, 9).amount_minor + 29000 === net('purchases') + net('purchase_returns')], [true, true]);
  eq('Box 13 recoverable 600 · Box 14 -600 (refund)', [box(r, 13).tax_minor, r.refund_minor], [600, 600]);
  await X.B.reverseEntry(X.db, SHOP, inv2.entry_id || (inv2.entry && inv2.entry.entry_id), { reason: 'wrong bill', by: SHOP });
  r = await ask();
  eq('reversal clause: INV-2 reversed → Box 9 amount 2000 (Tea 3000 - 1000) / VAT 100', [box(r, 9).amount_minor, box(r, 9).tax_minor], [2000, 100]);
  console.log('\n' + (fail ? '  FAIL ' + fail + ' failed' : '  ok ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });

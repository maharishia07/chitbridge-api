/**
 * books-rcm.test.cjs — REVERSE CHARGE ON A PURCHASE (engines v1.20.0; CGST Act s.9(3), s.9(4)).
 *
 * A supplier invoice whose FROZEN invoice carries RCM lines posts through the books-hooks classify() with `rcm` = tax.moneyOf(inv).rcm.rows
 * (read, never recomputed): the purchase takes the buyer's own tax, the supplier is credited WITHOUT it, and 2204–2206 hold the liability.
 * It is paid in CASH only — gstClose adds it to the challan beside the forward tax (no credit is used against it) and gstPay pays it:
 * Dr RCM payable · Cr the bank. A bill with no RCM line is unchanged (no `rcm` key at all).
 * Run: node tests/books-rcm.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-111111111111', SUPP = '33333333-3333-4333-8333-333333333333';
const S = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };

(async () => {
  console.log('\n══ REVERSE CHARGE — a purchase posts the buyer\'s own tax ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const T = require(path.join(H.API, 'lib', 'tax'));
  const BP = require(path.join(H.API, 'lib', 'books-period'));
  const BUYER = { Gstin: '33AAAAA0000A1Z5', LglNm: 'Tally Test', State: '33', Pos: '33' };
  const UNREG = { LglNm: 'Sri Ram Transport', State: '33', RegType: 'unregistered' };
  /* a GTA freight bill, 10,000 from an unregistered transporter: 5% = CGST 250 + SGST 250 in the RCM heads, none charged, no credit */
  const inv = T.determine({ rcm: true, seller: UNREG, buyer: BUYER, lines: [{ name: 'Freight Salem to Chennai', hsn: '996511', qty: 1, unit_price: 10000 }] });
  const plain = T.determine({ seller: Object.assign({ Gstn: '' }, BUYER, { Gstin: '33BBBBB1111B1Z2' }), buyer: BUYER, lines: [{ name: 'Tea', hsn: '0902', qty: 1, unit_price: 1000, rate: 5 }] });
  const chit = (id, i) => ({ chit: { chit_id: id, created_at: '2026-09-10T05:00:00Z', purpose: 'invoice', business_json: {} }, entry: { sells: false, seller: { entity_id: SUPP }, invoice: i }, setting: S, status: 'accepted' });

  const c = K.classify(chit('rcm1', inv));
  eq('an accepted supplier invoice with an RCM line → purchase_bill carrying the engine\'s rcm rows', [c.kind, c.event.type, c.event.rcm], ['post', 'purchase_bill', [{ rate: 5, itc: false, taxable: 10000, cgst: 250, sgst: 250, igst: 0 }]]);
  const p = K.classify(chit('plain1', plain));
  ok('…a bill with no RCM line carries no rcm key at all', p.kind === 'post' && !('rcm' in p.event) || p.event.rcm === undefined, JSON.stringify(p.event));

  await X.store.saveSetting(X.db, SHOP, { enabled: true }); await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-04-01' }); K.forget(SHOP);
  X.T.parties.push({ owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Sri Ram Transport', supplier: true, credit_days: 30 });
  const codeOf = (role) => (X.T.accounts.find((a) => a.entity_id === SHOP && a.role === role) || {}).code;
  const r = await X.B.postEntry(X.db, SHOP, Object.assign({}, c.event, { source_chit_id: 'c0000000-0000-4000-8000-0000000000aa' }));
  ok('it posts', r.ok === true, JSON.stringify(r));
  const e = X.T.entries.find((x) => x.source_ref === 'chit:rcm1');
  const lines = X.T.lines.filter((l) => l.entry_id === e.entry_id).map((l) => [l.code, l.dr_minor, l.cr_minor]);
  const sum = (i) => lines.reduce((t, l) => t + l[i], 0);
  ok('Dr = Cr, and the RCM payable ledgers 2204 / 2205 hold 250 each', sum(1) === sum(2) && lines.some((l) => l[0] === '2204' && l[2] === 25000) && lines.some((l) => l[0] === '2205' && l[2] === 25000), JSON.stringify(lines));
  ok('the supplier is credited the bill WITHOUT the tax (10,000)', lines.some((l) => l[0] === codeOf('creditors') && l[2] === 1000000), JSON.stringify(lines));
  ok('no credit allowed → the tax is a cost: debits total 10,500', sum(1) === 1050000, JSON.stringify(lines));

  /* paid in cash only, at the GST close / pay */
  const gc = await BP.gstClose(SHOP, S, { fy: '2026-27', period: 6 }, SHOP);
  eq('GST close: the RCM is NOT set off — it joins the challan in cash', [gc.rcm_minor, gc.cash_minor, gc.nothing_to_set_off === true], [{ cgst: 25000, sgst: 25000, igst: 0 }, { cgst: 25000, sgst: 25000, igst: 0 }, true]);
  eq('…and the challan total counts it', gc.pay_total_minor, 50000);
  let over = null; try { await BP.gstPay(SHOP, S, { fy: '2026-27', period: 6, rcm: { cgst_minor: 99999 }, challan_no: 'CPIN1', bank: 'bank' }, SHOP); } catch (x) { over = x; }
  ok('paying more than the RCM owed is refused in words', over && /more than the reverse-charge tax owed/.test(over.message), over && over.message);
  const pay = await BP.gstPay(SHOP, S, { fy: '2026-27', period: 6, rcm: { cgst_minor: 25000, sgst_minor: 25000 }, challan_no: 'CPIN1', bank: 'bank', date: '2026-09-30' }, SHOP);
  const pl = X.T.lines.filter((l) => l.entry_id === pay.entry_id).map((l) => [l.code, l.dr_minor, l.cr_minor]);
  ok('the challan: Dr 2204 / 2205 · Cr bank 500', pay.ok && pl.some((l) => l[0] === '2204' && l[1] === 25000) && pl.some((l) => l[0] === '2205' && l[1] === 25000) && pl.some((l) => l[0] === codeOf('bank') && l[2] === 50000), JSON.stringify(pl));
  const gc2 = await BP.gstClose(SHOP, S, { fy: '2026-27', period: 6 }, SHOP);
  ok('…and the liability is then nil (a second close finds nothing to add)', gc2.rcm_minor === undefined || gc2.duplicate === true, JSON.stringify(gc2));

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

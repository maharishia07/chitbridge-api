/**
 * tests/walkr-1129.test.cjs — WALK R (AE, sit-grund api f43b6567, batch 1129): R-F-01 (VAT201 boxes 1/4/5) and R-F-01b (the issuer of a rail credit note posts it too).
 *
 *   R-F-01  · a sale line lands on its kind's own ledger (sales_zero_rated 4010 · sales_exempt 4030) when the catalogue states the kind; the VAT201 reads boxes 4 and 5 from those ledgers.
 *             A 0% line that names NO kind stays on 4000 and the return SAYS so (needs_answer) — never a default (DECISIONS:1497). ONE mapping: the pack's supplyKinds table (engines reg-ae), via the
 *             line's `_cb.kinds`; no country word in core.
 *   R-F-01b · B's credit note WKR-CN-1 (VAT 0.50) reaches B's OWN books, mirroring A's (b-f-18, 5ab554c8c): Dr sales returns, Dr output VAT, Cr the buyer.
 *
 * Hand figures, FILS. Till bill, prices include 5% VAT: Tea 2 x 10.00 = 2000 -> taxable 1905, VAT 95 · Rice 3000 (exempt) · Gold 10000 (zero-rated) · total 15000.
 *   Kinds stated: sales -1905 · output VAT -95 · sales_exempt -3000 · sales_zero_rated -10000 · cash 15000; VAT201 Box 1 amount 1905 VAT 95 · Box 4 10000 · Box 5 3000.
 *   Kinds NOT stated (the walk's catalogue): sales -14905 (Box 1 14905) and needs_answer total 13000.
 * Rail: B invoices A 3 Tea 10.50 (net 3000 + VAT 150 = 3150), then credits 1 Tea 10.50 (net 1000 + VAT 50 = 1050): sales -3000 · returns +1000 · output VAT -100 · debtors 2100.
 * Run: CB_ENGINES_DIR=../chitbridge-engines node tests/walkr-1129.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-129129129129', SHOP2 = '33333333-3333-4333-8333-129129129129', CUST = '22222222-2222-4222-8222-222222222222';
const DAY = '2026-11-05', AT = DAY + 'T05:00:00Z';
const SETTING = { enabled: true, walkin_grain: 'day', country: 'AE', functional_currency: 'AED' };

(async () => {
  console.log('\n== WALK R · zero-rated and exempt sales on their own ledgers · the issuer posts its credit note ==\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  const T = require(path.join(X.src.dir, 'tax'));
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  const P = require(path.join(H.API, 'lib', 'books-period'));
  const q0 = X.db.query.bind(X.db);
  X.db.query = async (sql, p) => (/SELECT chit_id FROM chit_header WHERE entity_id = [$]1 AND sender_entity_id/.test(sql) ? { rows: [], rowCount: 0 } : q0(sql, p));
  const net = (shop) => {
    const out = {};
    for (const e of X.T.entries.filter((x) => x.entity_id === shop)) for (const l of X.T.lines.filter((x) => x.entry_id === e.entry_id)) {
      const a = X.T.accounts.find((x) => x.account_id === l.account_id); const k = a ? a.role : '?'; out[k] = (out[k] || 0) + Number(l.dr_minor || 0) - Number(l.cr_minor || 0);
    }
    return out;
  };
  const bill = (withKinds) => T.determine({ seller: { Country: 'AE', LglNm: 'A', Gstin: '100456789000003' }, buyer: { Country: 'AE' }, priceIncludesTax: true, lines: [
    { name: 'Tea', qty: 2, price: 10, rate: 5 },
    Object.assign({ name: 'Rice', qty: 1, price: 30, gst_rate: 0 }, withKinds ? { tax_kind: 'exempt' } : {}),
    Object.assign({ name: 'Gold', qty: 1, price: 100, gst_rate: 0 }, withKinds ? { tax_kind: 'zero_rated' } : {})] });
  const copy = { chit_id: 's1', purpose: 'order', currency_code: 'AED', created_at: AT, current_status: 'delivered', business_json: { bill_no: 'C1-0001', till: { id: 'C1' }, billed_at: AT, payment: { parts: [{ how: 'Cash', amount: 150 }] } } };
  X.store.countersBilling = async () => ['C1'];
  X.store.counterBills = async () => [copy];
  const openShop = async (id) => {
    X.T.identities.push({ identity_id: id, gstn: '100456789000003', display_name: 'AE shop', country: 'AE', policy_flags: {} });
    await X.store.saveSetting(X.db, id, SETTING);
    await X.B.enable(X.db, id, { by: id, today: DAY }); K.forget(id);
  };
  const box = (r, n) => (r.boxes.find((x) => String(x.code) === String(n)) || {});

  /* ── R-F-01 · kinds stated: each kind on its own ledger, boxes 4 and 5 read them ── */
  await openShop(SHOP);
  TC.copyOf = async () => copy;
  TC.entryFor = async () => ({ sells: true, invoice: bill(true) });
  const day = await K.postDay(SHOP, 'C1', DAY, { setting: SETTING });
  const a = net(SHOP);
  eq('kinds stated: sales -1905 · VAT -95 · exempt -3000 · zero-rated -10000 · cash 15000', [!!day.entry_no, a.sales, a.output_vat, a.sales_exempt, a.sales_zero_rated, a.cash], [true, -1905, -95, -3000, -10000, 15000]);
  const ret = await P.taxReturn(SHOP, await X.B.settingOf(X.db, SHOP), { stagger: 3, period: '2026-10/2026-12' }, X.db);
  eq('VAT201 (stagger 3): Box 1 1905 / 95 · Box 4 10000 · Box 5 3000 (read from the ledgers; two carried totals: boxes 1+4+5 = 14905 = the bill less its VAT)', [box(ret, 1).amount_minor, box(ret, 1).tax_minor, box(ret, 4).amount_minor, box(ret, 5).amount_minor, box(ret, 1).amount_minor + box(ret, 4).amount_minor + box(ret, 5).amount_minor], [1905, 95, 10000, 3000, 14905]);
  ok('…and nothing waits for an answer', !ret.needs_answer, JSON.stringify(ret.needs_answer));

  /* ── R-F-01 · kinds NOT stated (the walk's catalogue): waits on 4040, and the return says it needs an answer ── */
  await openShop(SHOP2);
  TC.entryFor = async () => ({ sells: true, invoice: bill(false) });
  await K.postDay(SHOP2, 'C1', DAY, { setting: SETTING });
  const b = net(SHOP2);
  /* AA-F-01 (engines 1129, decided): a 0% line that names no kind waits on its OWN ledger 4040 (sales_unanswered), in no VAT201 box — it is neither on 4000 (Box 1 would count it as standard-rated) nor guessed onto 4010 / 4030. Two carried totals: 1905 on sales + 13000 waiting = 14905, the bill less its VAT */
  eq('no kind stated: the 0% lines wait on 4040 (-13000), sales keeps only the 5% line (-1905), never guessed onto 4010 / 4030', [b.sales, b.sales_unanswered || 0, b.sales_exempt || 0, b.sales_zero_rated || 0], [-1905, -13000, 0, 0]);
  const ret2 = await P.taxReturn(SHOP2, await X.B.settingOf(X.db, SHOP2), { stagger: 3, period: '2026-10/2026-12' }, X.db);
  eq('…and the return says so: needs_answer carries the 0% sales that name no kind, 13000 (Rice 3000 + Gold 10000)', [ret2.needs_answer && ret2.needs_answer.total_minor, ret2.needs_answer && ret2.needs_answer.currency], [13000, 'AED']);

  /* ── R-F-01b · B invoices A, then credits one Tea: B's own books carry both ── */
  const B = '44444444-4444-4444-8444-129129129129';
  await openShop(B);
  const inv = (tea) => ({ _cb: { scheme: 'VAT' }, currency: 'AED', ItemList: [{ GstRt: 5, AssAmt: tea * 10, TaxAmt: tea * 0.5, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: tea * 10.5, AssVal: tea * 10, TaxVal: tea * 0.5 } });
  const rail = { i1: { chit_id: 'i1', purpose: 'invoice', created_at: AT, sender_entity_id: B, currency_code: 'AED', current_status: 'accepted', business_json: { bill_no: 'WKR-INV-1' } },
    cn1: { chit_id: 'cn1', purpose: 'credit_note', created_at: AT, sender_entity_id: B, currency_code: 'AED', current_status: 'pending', business_json: { bill_no: 'WKR-CN-1', against: { chit_id: 'i1', ref: 'WKR-INV-1' } } } };
  TC.copyOf = async (id) => rail[id] || null;
  TC.entryFor = async (c) => ({ sells: true, seller: { entity_id: B }, buyer: { entity_id: CUST }, me: { entity_id: B }, invoice: inv(c.chit_id === 'i1' ? 3 : 1) });
  const i1 = await K.postChit(B, 'i1', {});
  const c1 = await K.postChit(B, 'cn1', {});
  const r = net(B);
  eq('the invoice posts, then the credit note on the ISSUER side: sales -3000 · returns 1000 · output VAT -100 · debtors 2100', [!!i1.entry_no, !!c1.entry_no, r.sales, r.sales_returns, r.output_vat, r.debtors], [true, true, -3000, 1000, -100, 2100]);

  /* ── R-F-09b · A (the buyer) never holds the note alone: it carries the supplier check the bill carries (D-F-11, 19cc5c287), so Suppliers is never Dr with no invoice behind it ── */
  const buyerNote = K.classify({ chit: Object.assign({}, rail.cn1, { sender_entity_id: B }), entry: { sells: false, seller: { entity_id: B }, buyer: { entity_id: SHOP }, me: { entity_id: SHOP }, invoice: inv(1) }, setting: SETTING, status: 'accepted' });
  eq("R-F-09b · the buyer's credit note is a purchase_return that waits for the supplier list (supplier_check)", [buyerNote.kind, buyerNote.event && buyerNote.event.type, buyerNote.supplier_check], ['post', 'purchase_return', true]);

  console.log('\n' + (fail ? '  FAIL ' + fail + ' failed' : '  ok ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });

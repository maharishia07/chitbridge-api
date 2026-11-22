/**
 * tests/inbooks-1128.test.cjs — WALK M M-F-04 + M-F-05 (batch 1128).
 *
 *   M-F-04 · books order: a CREDIT NOTE on my own sale waits for that sale (wait "original", the rule a debit note already follows, ACC-192) — a cash walk-in sale posts at the day close,
 *            so the note posts after the day, never Cash below 0 / Output tax on the debit side in between. A cancelled sale holds nothing.
 *   M-F-05 · ONE open waiting row per bill: a bill parked again renews its row; list and count agree; a post closes every row of the chit.
 *
 * Hand figures, minor units (paise). Cash walk-in sale ₹2,832.00 at 18% intra-state: taxable 2,400.00 = 240000 · CGST 216.00 = 21600 · SGST 21600 · cash 283200.
 * Credit note for the whole sale, refunded in cash: Dr sales returns 240000 · Dr CGST 21600 · Dr SGST 21600 · Cr cash 283200.
 * After day close AND the note: cash 0, CGST 0, SGST 0, sales -240000, sales returns +240000.
 * Run: node tests/inbooks-1128.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-128128128128', CUST = '22222222-2222-4222-8222-222222222222';
const DAY = '2026-11-05', AT = DAY + 'T05:00:00Z';
const SETTING = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };
const SALE_INV = { currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: 2400, CgstAmt: 216, SgstAmt: 216, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 2832 } };

(async () => {
  console.log('\n══ WALK M · credit note waits for its sale · one waiting row per bill ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  /* the twin has no chit table: the bill-number lookup answers the sale by its bill_no */
  const sales = { 'C1-0001': 's1', 'C1-0002': 's2' };
  const q0 = X.db.query.bind(X.db);
  X.db.query = async (sql, p) => {
    if (/SELECT chit_id FROM chit_header WHERE entity_id = [$]1 AND sender_entity_id/.test(sql)) return sales[p[1]] ? { rows: [{ chit_id: sales[p[1]] }], rowCount: 1 } : { rows: [], rowCount: 0 };
    return q0(sql, p);
  };
  const sale = (id, status) => ({ chit_id: id, purpose: 'order', currency_code: 'INR', created_at: AT, current_status: status, business_json: { bill_no: id === 's1' ? 'C1-0001' : 'C1-0002', till: { id: 'C1' }, billed_at: AT, payment: { parts: [{ how: 'Cash', amount: 2832 }] } } });
  const note = (id, against) => ({ chit_id: id, purpose: 'credit_note', currency_code: 'INR', created_at: AT, current_status: 'pending',
    business_json: { till: { id: 'C1' }, bill_no: 'CN-' + id, against, billed_at: AT, customer: { name: 'Ravi', identity_id: CUST }, refund: { parts: [{ how: 'Cash', amount: 2832 }] } } });
  const copies = { s1: sale('s1', 'delivered'), s2: sale('s2', 'cancelled'), n1: note('n1', 'C1-0001'), n2: note('n2', 'C1-0002') };
  TC.copyOf = async (id) => copies[id] || null;
  TC.entryFor = async () => ({ sells: true, invoice: SALE_INV });
  X.store.countersBilling = async () => ['C1'];
  X.store.counterBills = async () => [copies.s1];

  X.T.identities.push({ identity_id: SHOP, gstn: '33ABCDE1234F1Z5', display_name: 'IN shop', country: 'IN', policy_flags: { gst_registration: 'regular' } });
  X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi', customer: true });
  await X.store.saveSetting(X.db, SHOP, SETTING);
  await X.B.enable(X.db, SHOP, { by: SHOP, today: DAY }); K.forget(SHOP);

  const net = () => { const out = {};
    for (const e of X.T.entries.filter((x) => x.entity_id === SHOP)) for (const l of X.T.lines.filter((x) => x.entry_id === e.entry_id)) {
      const a = X.T.accounts.find((x) => x.account_id === l.account_id); const k = a ? a.role : '?'; out[k] = (out[k] || 0) + Number(l.dr_minor || 0) - Number(l.cr_minor || 0); }
    return out; };
  const open = (id) => X.T.outbox.filter((o) => o.entity_id === SHOP && o.source_chit_id === id && !o.done_at);
  const noteEntries = (id) => X.T.entries.filter((e) => e.entity_id === SHOP && e.source_ref === 'chit:' + id);

  /* ── M-F-04 · the sale waits for the day close; the note waits with it ── */
  const first = await K.postChit(SHOP, 'n1', {});
  eq('the credit note on an unposted cash walk-in sale WAITS (wait "original"), nothing posted', [first.queued, first.wait, noteEntries('n1').length, X.T.entries.length], [true, 'original', 0, 0]);
  ok('…in words that name the sale and the day close', /C1-0001/.test(first.why) && /day is closed/.test(first.why), first.why);
  const again = await K.postChit(SHOP, 'n1', {});
  eq('M-F-05 · the same note parked a second time: ONE open row (the row renewed, not doubled)', [again.queued, open('n1').length], [true, 1]);
  eq('M-F-05 · list and count agree: one waiting', [(await X.store.waiting(X.db, SHOP, 50)).length, (await X.store.waitingCount(X.db, SHOP)).total], [1, 1]);

  /* an old twin row (parked twice before the fix) shows once, and one retry closes both */
  X.T.outbox.push({ id: 900, entity_id: SHOP, source_chit_id: 'n1', source_ref: 'chit:n1', event: { job: 'chit', chit_id: 'n1', todo: 'record' }, why: 'old', tries: 0, created_at: AT, done_at: null });
  eq('M-F-05 · a duplicate row already on file lists once', [(await X.store.waiting(X.db, SHOP, 50)).length, (await X.store.waitingCount(X.db, SHOP)).total], [1, 1]);

  /* day close: the day posts, then the waiting note posts after it */
  const day = await K.postDay(SHOP, 'C1', DAY, { setting: SETTING });
  eq('day close posts the sale: cash 283200 in, sales -240000, CGST -21600, SGST -21600', [day && !!day.entry_no, net().cash, net().sales, net().output_cgst, net().output_sgst], [true, 283200, -240000, -21600, -21600]);
  const retried = await K.retryOutbox(SHOP, 100);
  eq('the retry posts the note once (and closes both rows of the chit)', [retried.posted, noteEntries('n1').length, open('n1').length], [1, 1, 0]);
  const after = net();
  eq('hand: cash 0 · CGST 0 · SGST 0 · sales -240000 · sales returns +240000 (two carried totals agree: day 283200 = note 283200)', [after.cash, after.output_cgst, after.output_sgst, after.sales, after.sales_returns], [0, 0, 0, -240000, 240000]);

  /* a cancelled sale never posts: it holds nothing, the note posts at once */
  const cancelled = await K.postChit(SHOP, 'n2', {});
  eq('a credit note against a CANCELLED sale is not held', [cancelled.queued || false, noteEntries('n2').length], [false, 1]);

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });

/**
 * tests/two-sided-books.test.cjs — ONE COUNTER BILL, TWO LEDGERS, END TO END (the two-sided counter bill, 2026-10-01).
 *
 * The same chit, as each holder's copy, through the REAL tax-copy (who sells on this copy) and the REAL hooks, on the
 * in-memory ledger (tests/support/books-harness.cjs — no database):
 *   · the shop's copy posts at save: sale_bill, the customer owes it (Dr Debtors · Cr Sales + output GST)
 *   · the customer's copy waits: "Waiting for you to confirm the goods were received (bill … from …)" — nothing posted
 *   · the customer accepts (Intake, or goods-in — the same transition) → purchase_bill, the shop is owed
 *     (Dr Purchases + input GST · Cr Creditors · the shop); a second firing is a duplicate
 * Before the tax-copy fix the customer's copy read as the customer's own SALE.
 * Run: node tests/two-sided-books.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const IDS = {
  [SHOP]: { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', policy_flags: { price_includes_tax: 'no' } },
  [CUST]: { identity_id: CUST, gstn: '33BBBBB0000B1Z5', display_name: 'Chola Auto Care', country: 'IN', policy_flags: {} },
};

(async () => {
  console.log('\n══ ONE COUNTER BILL, TWO LEDGERS ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP ' + X.src.why); process.exit(0); }
  /* the identities read tax-copy makes (partiesFor) — answered here; everything else is the harness's */
  const q0 = X.dbStub.query;
  X.dbStub.query = async (t, p) => /FROM identities WHERE identity_id = ANY/.test(String(t)) ? { rows: p[0].map((id) => IDS[id]).filter(Boolean) } : q0(t, p);
  delete require.cache[require.resolve(path.join(H.API, 'lib', 'tax-copy'))];
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  const K = require(path.join(H.API, 'lib', 'books-hooks'));

  const bj = { customer: { name: 'Chola Auto Care', phone: '9840012345', identity_id: CUST, entity_id: CUST },
    till: { id: 'C1', name: 'Counter 1', host: 'browser' }, bill_no: 'C1/26-27/0041', billed_at: '2026-10-01T05:00:00.000Z',
    payment: { mode: 'On credit', paid: 0, parts: [{ how: 'On credit', amount: 118 }] }, slip: 'cash', terms: { credit_days: 15, due_date: '2026-10-16' } };
  const recips = [{ entity_id: SHOP, role: 'sender' }, { entity_id: SHOP, role: 'receiver' }, { entity_id: CUST, role: 'receiver' }];
  let custStatus = 'pending';
  TC.copyOf = async (chit_id, me) => ({ chit_id, sender_entity_id: SHOP, all_recipients: recips, purpose: 'order',
    business_json: me === SHOP ? Object.assign({ client_ref: bj.bill_no }, bj) : bj, summary_json: {},
    sent_at: '2026-10-01T05:00:01.000Z', created_at: '2026-10-01T05:00:01.000Z',
    line_items: [{ line_id: 'l1', particulars: 'Brake pad', quantity: 2, unit: 'piece', price: 50, total: 100, gst_rate: 18 }],
    currency_code: 'INR', current_status: me === SHOP ? 'pending' : custStatus, direction: 'received' });

  for (const e of [SHOP, CUST]) { await X.store.saveSetting(X.db, e, { enabled: true }); await X.B.enable(X.db, e, { by: e, today: '2026-10-01' }); K.forget(e); }
  X.T.parties.push({ owner: SHOP, party_id: CUST, name: 'Chola Auto Care', customer: true, credit_days: 15 });
  const posted = (e) => X.T.entries.filter((x) => x.entity_id === e && x.source_ref === 'chit:tb1');
  const linesOf = (en) => X.T.lines.filter((l) => l.entry_id === en.entry_id);
  const acct = (e, role) => X.T.accounts.find((a) => a.entity_id === e && a.role === role) || X.T.accounts.find((a) => a.role === role);

  /* the shop, at save */
  const s1 = await K.afterChit(SHOP, 'tb1', SHOP);
  const se = posted(SHOP)[0];
  ok('the SHOP\'s copy posts at save: sale_bill to Chola Auto Care', se && se.event_type === 'sale_bill', JSON.stringify([s1, se]));
  const sl = se ? linesOf(se) : [];
  const deb = acct(SHOP, 'debtors');
  ok('…Dr Debtors 118.00 named for the customer; Σ Dr = Σ Cr', deb && sl.some((l) => l.account_id === deb.account_id && l.party_id === CUST && l.dr_minor === 11800)
    && sl.reduce((t, l) => t + l.dr_minor, 0) === sl.reduce((t, l) => t + l.cr_minor, 0), JSON.stringify(sl.map((l) => [l.code, l.dr_minor, l.cr_minor, l.party_id])));

  /* the customer, on arrival */
  const c1 = await K.afterChit(CUST, 'tb1', null);
  const w = X.T.outbox.filter((o) => o.entity_id === CUST && o.source_chit_id === 'tb1' && !o.done_at)[0];
  ok('the CUSTOMER\'s copy on arrival posts NOTHING (not a sale of theirs, not yet a purchase)', posted(CUST).length === 0, JSON.stringify(posted(CUST)));
  ok('…it waits, named: "Waiting for you to confirm the goods were received (bill C1/26-27/0041 from Mayur Traders)"',
    c1 && c1.queued && w && w.why === 'Waiting for you to confirm the goods were received (bill C1/26-27/0041 from Mayur Traders)', JSON.stringify([c1, w && w.why]));

  /* the customer accepts — Intake or goods-in, the same transition */
  custStatus = 'accepted';
  X.T.parties.push({ owner: CUST, party_id: SHOP, name: 'Mayur Traders', supplier: true, credit_days: 15 });
  const c2 = await K.afterChit(CUST, 'tb1', CUST);
  const pe = posted(CUST)[0];
  ok('accepted → the customer\'s purchase_bill, the shop as the party', pe && pe.event_type === 'purchase_bill', JSON.stringify([c2, pe]));
  const pl = pe ? linesOf(pe) : [];
  const cred = acct(CUST, 'creditors');
  ok('…Cr Creditors 118.00 named for Mayur Traders; input GST 9 + 9 on the debit side; Σ Dr = Σ Cr',
    cred && pl.some((l) => l.account_id === cred.account_id && l.party_id === SHOP && l.cr_minor === 11800)
    && pl.filter((l) => l.dr_minor === 900).length === 2 && pl.reduce((t, l) => t + l.dr_minor, 0) === pl.reduce((t, l) => t + l.cr_minor, 0),
    JSON.stringify(pl.map((l) => [l.code, l.dr_minor, l.cr_minor, l.party_id])));
  const c3 = await K.afterChit(CUST, 'tb1', CUST);
  ok('…the second door firing the same acceptance is a duplicate — one purchase, ever', c3 && c3.duplicate === true && posted(CUST).length === 1, JSON.stringify(c3));
  ok('…and the shop\'s own sale was never touched by the customer\'s side', posted(SHOP).length === 1);

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });

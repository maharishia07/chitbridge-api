/**
 * books-post.test.cjs — THE ONE WRITER, PROVED WITHOUT A DATABASE (SPEC-books-v2 §3, §6).
 *
 * lib/books.js postEntry() against an in-memory store (tests/support/books-memory.cjs, held to the real store's exports)
 * and the books engines v1.8.0. Proves: off is a no-op · a sale per bill balances, updates both balance grains and opens
 * a bill · the JV series is gap-free and a source posts once · a locked month moves a chit's date and refuses a typed
 * one · a reversal mirrors and settles · a payment is proposed, confirmed, and cannot touch a disputed bill · a cheque
 * posts only on clearing and a bounce reverses it · opening bills are bill-wise with the difference in Suspense · the
 * balance rows equal CBLedger.accumulate · the trial balance balances · the carryforward reaches the next year.
 *
 * Needs the engines v1.8.0 (BOOKS_ENGINES_SRC); without them it says so and checks only what needs none.
 * Run: node tests/books-post.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
async function throws(name, fn, re) { try { await fn(); ok(name, false, 'did not throw'); } catch (e) { ok(name, !re || re.test(String(e && e.message)), 'threw: ' + (e && e.message)); } }

const SHOP = '11111111-1111-4111-8111-111111111111';
const CUST = '22222222-2222-4222-8222-222222222222';
const SUPP = '33333333-3333-4333-8333-333333333333';

(async () => {
  console.log('\n══ THE ONE WRITER — lib/books.js postEntry against an in-memory store ══\n');

  /* the in-memory store must have exactly the real store's exports — else these tests prove a different thing */
  const real = require(path.join(H.API, 'lib', 'books-store.js'));
  const mem = require('./support/books-memory.cjs').create();
  const missing = Object.keys(real).filter((k) => !(k in mem)), extra = Object.keys(mem).filter((k) => !(k in real) && k !== 'T');
  eq('the in-memory store has the real store\'s exports (no drift)', { missing, extra }, { missing: [], extra: [] });

  /* ── off is a no-op, whatever the engines ── */
  {
    const X = H.load({ engines: false });
    const r = await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-29', currency: 'INR' });
    eq('books OFF (no setting row): postEntry is a no-op that says off', r, { ok: false, off: true });
    ok('…and wrote nothing', X.T.entries.length === 0 && X.T.lines.length === 0 && X.T.items.length === 0);
  }

  const X = H.load();
  if (!X.src.dir) { console.log('\n   SKIP the engine-dependent checks: ' + X.src.why); return done(); }
  const { B, T, E, db } = X;
  T.parties.push({ owner: SHOP, party_id: CUST, name: 'Ravi Stores', customer: true, credit_days: 15 }, { owner: SHOP, party_id: SUPP, name: 'Kumar Traders', supplier: true, credit_days: 30 });

  /* ── the switch ── */
  await X.store.saveSetting(db, SHOP, { enabled: false });
  eq('switched OFF: still a no-op', await B.postEntry(db, SHOP, { type: 'sale_bill' }), { ok: false, off: true });
  const en = await B.enable(db, SHOP, { by: SHOP, today: '2026-09-29' });
  ok('enable seeds the chart from the India pack (groups + ledgers)', en.ok && en.accounts_added > 60, JSON.stringify(en));
  ok('…with 1300 debtors, 2100 creditors, 2900 suspense, 3900 retained', ['1300', '2100', '2900', '3900'].every((c) => T.accounts.some((a) => a.code === c && !a.is_group)));
  ok('…and the months of 2026-27 (period 0 + 12), all open', T.periods.filter((p) => p.fiscal_year === '2026-27').length === 13 && T.periods.every((p) => p.status === 'open'));
  const en2 = await B.enable(db, SHOP, { by: SHOP, today: '2026-09-29' });
  eq('enable twice adds nothing', en2.accounts_added, 0);

  /* ── a sale on credit, per bill ── */
  const sale = { type: 'sale_bill', date: '2026-09-10', currency: 'INR', party: CUST, source_chit_id: 'c0000000-0000-4000-8000-000000000001', source_ref: 'chit:c1',
    by_rate: [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], paid: { cash: 180 }, round_off: 0 };
  const r1 = await B.postEntry(db, SHOP, sale);
  ok('a credit sale posts', r1.ok && r1.entry_no === 'JV/2026-27/000001', JSON.stringify(r1));
  const ls = T.lines.filter((l) => l.entry_id === r1.entry_id);
  eq('…Σ debit = Σ credit (1180.00)', [ls.reduce((t, l) => t + l.dr_minor, 0), ls.reduce((t, l) => t + l.cr_minor, 0)], [118000, 118000]);
  const deb = T.accounts.find((a) => a.role === 'debtors');
  ok('…the debtors line names the party (1000.00 owed)', ls.some((l) => l.account_id === deb.account_id && l.party_id === CUST && l.dr_minor === 100000));
  const bal = Array.from(T.balances.values());
  ok('…balance rows at BOTH grains: debtors total and debtors+party', bal.some((b) => b.account_id === deb.account_id && b.party_key === X.store.ZERO && b.dr_minor === 100000)
    && bal.some((b) => b.account_id === deb.account_id && b.party_key === CUST && b.dr_minor === 100000));
  const bill = T.items.find((i) => i.ref_kind === 'bill');
  eq('…a bill item, +1000.00, due in the party\'s 15 credit days', [bill && bill.amount_minor, bill && bill.due_date, bill && bill.side, bill && bill.ref === bill.against_ref], [100000, '2026-09-25', 'receivable', true]);

  /* the balance rows are exactly CBLedger.accumulate's */
  const acc = E.ledger().accumulate(T.lines.map((l) => ({ fiscal_year: '2026-27', period: 6, code: T.accounts.find((a) => a.account_id === l.account_id).code, party: l.party_id, dr_minor: l.dr_minor, cr_minor: l.cr_minor })),
    { pack: E.packWith(B.packOf({ country: 'IN' }), T.accounts) });
  const mine = bal.map((b) => [T.accounts.find((a) => a.account_id === b.account_id).code, b.party_key === X.store.ZERO ? null : b.party_key, b.dr_minor, b.cr_minor].join('|')).sort();
  eq('the rows postEntry wrote = CBLedger.accumulate of the lines', mine, acc.map((r) => [r.code, r.party, r.dr_minor, r.cr_minor].join('|')).sort());

  /* ── idempotency and the gap-free series ── */
  const again = await B.postEntry(db, SHOP, sale);
  ok('the same source posts once (duplicate, same entry)', again.duplicate === true && again.entry_id === r1.entry_id);
  await throws('a refused event (unknown rule) posts nothing…', () => B.postEntry(db, SHOP, { type: 'nonsense', date: '2026-09-11', currency: 'INR', source_ref: 'x1' }), /no posting rule/);
  const r2 = await B.postEntry(db, SHOP, { type: 'expense', date: '2026-09-11', currency: 'INR', class: 'rent', amount: 500, paid_from: 'cash', source_ref: 'chit:e1' });
  eq('…and takes no number: the next is 000002', r2.entry_no, 'JV/2026-27/000002');

  /* ── locked months ── */
  await B.setPeriod(db, SHOP, '2026-27', 5, 'soft_locked', SHOP, 'GSTR-1 filed');
  const late = await B.postEntry(db, SHOP, { type: 'expense', date: '2026-08-20', currency: 'INR', class: 'fuel', amount: 100, paid_from: 'cash', source_ref: 'chit:late' });
  eq('a chit dated in a locked month posts on the first open date, doc date kept', [late.posting_date, late.doc_date, late.moved], ['2026-09-01', '2026-08-20', true]);
  await throws('a date a PERSON typed into a locked month is refused, in words', () => B.postEntry(db, SHOP, { type: 'expense', date: '2026-08-21', currency: 'INR', class: 'fuel', amount: 1, paid_from: 'cash', strict_date: true }), /locked/);
  await throws('opening a locked month needs a reason', () => B.setPeriod(db, SHOP, '2026-27', 5, 'open', SHOP, ''), /reason/);
  await B.setPeriod(db, SHOP, '2026-27', 4, 'hard_locked', SHOP, 'CA signed');
  await throws('a hard-locked month cannot be opened again', () => B.setPeriod(db, SHOP, '2026-27', 4, 'open', SHOP, 'please'), /good/);

  /* ── a payment: record → propose → confirm; a dispute freezes a bill ── */
  const P = X.store; const pay = await P.insertPayment(db, SHOP, { party_id: CUST, direction: 'in', amount_minor: 60000, currency: 'INR', mode: 'upi', received_at: '2026-09-20' });
  const pr = await B.postEntry(db, SHOP, Object.assign(B.paymentEvent(await P.payment(db, SHOP, pay.payment_id), { by: SHOP }), { strict_date: true }));
  ok('a UPI payment posts (Dr UPI · Cr debtors, party)', pr.ok && T.items.some((i) => i.ref === 'pay:' + pay.payment_id && i.ref_kind === 'advance' && i.amount_minor === -60000));
  const items = await B.partyItems(db, SHOP, CUST, deb.account_id);
  const prop = E.receivables().proposeItems(items, 'pay:' + pay.payment_id, {});
  eq('the proposal: oldest due first, 600.00 against the sale', (prop.allocations || []).map((a) => [a.debit, a.amount]), [[sale.source_chit_id, 600]]);
  const conf = await B.postEntry(db, SHOP, { type: 'allocation', party: CUST, side: 'customer', credit_ref: 'pay:' + pay.payment_id, allocations: [{ against_ref: sale.source_chit_id, amount_minor: 60000 }] });
  ok('confirmed: two allocation rows (−600 on the bill, +600 on the payment)', conf.ok && conf.items === 2, JSON.stringify(conf));
  const o1 = E.receivables().outstanding(await B.partyItems(db, SHOP, CUST, deb.account_id));
  eq('the bill now has 400.00 open; the payment 0', [o1.by_ref[sale.source_chit_id].outstanding_minor, o1.by_ref['pay:' + pay.payment_id].outstanding_minor], [40000, 0]);
  await B.postEntry(db, SHOP, { type: 'party_status', party: CUST, side: 'customer', against_ref: sale.source_chit_id, status: 'disputed', currency: 'INR' });
  const pay2 = await P.insertPayment(db, SHOP, { party_id: CUST, direction: 'in', amount_minor: 10000, currency: 'INR', mode: 'cash', received_at: '2026-09-21' });
  await B.postEntry(db, SHOP, B.paymentEvent(await P.payment(db, SHOP, pay2.payment_id), {}));
  await throws('a payment cannot be set against a DISPUTED bill (C4)', () => B.postEntry(db, SHOP, { type: 'allocation', party: CUST, side: 'customer', credit_ref: 'pay:' + pay2.payment_id, allocations: [{ against_ref: sale.source_chit_id, amount_minor: 10000 }] }), /disput/i);

  /* ── a cheque: nothing until it clears; a bounce reverses ── */
  const chq = await P.insertPayment(db, SHOP, { party_id: CUST, direction: 'in', amount_minor: 20000, currency: 'INR', mode: 'cheque', received_at: '2026-09-22', cheque_no: '000123' });
  const before = T.entries.length;
  await B.postEntry(db, SHOP, { type: 'cheque_received', party: CUST, side: 'customer', payment_id: chq.payment_id, amount_minor: 20000, currency: 'INR', date: '2026-09-22' });
  ok('a cheque received writes a status row and NO journal (C3)', T.entries.length === before && T.items.some((i) => i.ref === 'pay:' + chq.payment_id && i.ref_kind === 'status' && i.pending_minor === -20000));
  await throws('a cheque cannot clear before it is deposited', () => B.postEntry(db, SHOP, { type: 'cheque_step', payment_id: chq.payment_id, to: 'cleared', date: '2026-09-23' }), /order|cannot/i);
  await B.postEntry(db, SHOP, { type: 'cheque_step', payment_id: chq.payment_id, to: 'deposited', date: '2026-09-23' });
  const cl = await B.postEntry(db, SHOP, { type: 'cheque_step', payment_id: chq.payment_id, to: 'cleared', date: '2026-09-24' });
  ok('cleared: the journal entry posts, and the money row appears', cl.ok && cl.posted && cl.posted.ok && T.items.some((i) => i.ref === 'pay:' + chq.payment_id && i.ref_kind === 'advance' && i.amount_minor === -20000), JSON.stringify(cl));
  await throws('a CLEARED cheque cannot bounce (CBReceivables: the order ends at cleared)', () => B.postEntry(db, SHOP, { type: 'cheque_step', payment_id: chq.payment_id, to: 'bounced', date: '2026-09-25' }), /cannot become bounced/);
  const chq2 = await P.insertPayment(db, SHOP, { party_id: CUST, direction: 'in', amount_minor: 15000, currency: 'INR', mode: 'cheque', received_at: '2026-09-22', cheque_no: '000124' });
  await B.postEntry(db, SHOP, { type: 'cheque_received', party: CUST, side: 'customer', payment_id: chq2.payment_id, amount_minor: 15000, currency: 'INR', date: '2026-09-22' });
  await B.postEntry(db, SHOP, { type: 'cheque_step', payment_id: chq2.payment_id, to: 'deposited', date: '2026-09-23' });
  const n0 = T.entries.length;
  const bo = await B.postEntry(db, SHOP, { type: 'cheque_step', payment_id: chq2.payment_id, to: 'bounced', date: '2026-09-25' });
  ok('a deposited cheque that BOUNCES: a status row, no journal (it never counted)', bo.ok && T.entries.length === n0 && T.items.some((i) => i.ref === 'pay:' + chq2.payment_id && i.status === 'bounced'), JSON.stringify(bo));
  const oc = E.receivables().outstanding(await B.partyItems(db, SHOP, CUST, deb.account_id));
  eq('…the bounced cheque owes and settles nothing', (oc.by_ref['pay:' + chq2.payment_id] || {}).outstanding_minor, 0);

  /* ── reversal of an ordinary entry ── */
  const rv = await B.reverseEntry(db, SHOP, r2.entry_id, { by: SHOP, reason: 'wrong class' });
  const rl = T.lines.filter((l) => l.entry_id === rv.entry_id), ol = T.lines.filter((l) => l.entry_id === r2.entry_id);
  ok('a reversal mirrors every line (Dr↔Cr) and points at the original', rv.ok && rl.length === ol.length && rl.every((l, i) => l.dr_minor === ol[i].cr_minor && l.cr_minor === ol[i].dr_minor)
    && T.entries.find((h) => h.entry_id === rv.entry_id).reverses_entry_id === r2.entry_id);
  const rv2 = await B.reverseEntry(db, SHOP, r2.entry_id, { by: SHOP, reason: 'again' });
  ok('…once (a second reversal is the same one)', rv2.duplicate === true && rv2.entry_id === rv.entry_id);
  await throws('a reversal needs a reason', () => B.reverseEntry(db, SHOP, r1.entry_id, { by: SHOP, reason: ' ' }), /reason/);
  const rsale = await B.reverseEntry(db, SHOP, r1.entry_id, { by: SHOP, reason: 'billed twice' });
  ok('reversing a credit sale writes reversal rows against its bill', rsale.ok && rsale.items >= 1 && T.items.some((i) => i.ref_kind === 'reversal' && i.against_ref === sale.source_chit_id));

  /* ── opening balances: bill-wise, the difference in Suspense ── */
  const opn = await B.postEntry(db, SHOP, { type: 'opening', date: '2026-04-01', currency: 'INR', narration: 'Opening balances',
    lines: [{ account: '1400', dr: 5000 }, { account: '1300', dr: 3000, party: CUST }, { account: '1300', dr: 2000, party: CUST }, { account: '2100', cr: 4000, party: SUPP }],
    line_refs: [null, { party: CUST, bill_ref: 'OLD-1', due_date: '2026-04-30' }, { party: CUST, bill_ref: 'OLD-2' }, { party: SUPP, bill_ref: 'PB-9' }] });
  const ol2 = T.lines.filter((l) => l.entry_id === opn.entry_id), sus = T.accounts.find((a) => a.role === 'suspense');
  ok('opening posts in period 0 with the difference (6000.00) in Suspense 2900', opn.ok && T.entries.find((h) => h.entry_id === opn.entry_id).period === 0
    && ol2.some((l) => l.account_id === sus.account_id && l.cr_minor === 600000), JSON.stringify(ol2.map((l) => [l.account_id === sus.account_id, l.dr_minor, l.cr_minor])));
  ok('…each party line its own bill (OLD-1 due 30 Apr, OLD-2, PB-9 payable)', ['OLD-1', 'OLD-2', 'PB-9'].every((r) => T.items.some((i) => i.ref === r && i.ref_kind === 'bill'))
    && T.items.find((i) => i.ref === 'OLD-1').due_date === '2026-04-30' && T.items.find((i) => i.ref === 'PB-9').side === 'payable');

  /* ── the figures: the trial balance balances; the carryforward reaches the next year ── */
  const tb = await B.trialBalance(db, SHOP, '2026-09-30');
  ok('the trial balance at 30 Sep balances', tb.balanced && tb.total_dr_minor > 0, JSON.stringify([tb.total_dr_minor, tb.total_cr_minor]));
  const tbMid = await B.trialBalance(db, SHOP, '2026-09-15');
  ok('…and mid-month (rows before + the month\'s lines to the day)', tbMid.balanced, JSON.stringify([tbMid.total_dr_minor, tbMid.total_cr_minor]));
  const nextYr = await B.postEntry(db, SHOP, { type: 'expense', date: '2027-04-05', currency: 'INR', class: 'rent', amount: 100, paid_from: 'cash', source_ref: 'chit:ny' });
  ok('an entry in 2027-28 creates that year\'s months', nextYr.ok && T.periods.filter((p) => p.fiscal_year === '2027-28').length === 13);
  let sn = null; try { await B.balanceSheet(db, SHOP, '2027-04-30'); } catch (e) { sn = e; }
  ok('while last year\'s Suspense is not nil the next year is REFUSED by name (never an empty carry that "balances")', sn && sn.code === 'SUSPENSE_NOT_NIL' && /Suspense is not nil/.test(sn.message), sn && sn.message);
  await B.postEntry(db, SHOP, { type: 'manual', owner: true, narration: 'Opening difference was the owner\'s capital', date: '2026-09-30', currency: 'INR', lines: [{ account: '2900', dr: 6000 }, { account: '3000', cr: 6000 }] });
  const cash = T.accounts.find((a) => a.role === 'cash');
  const closing = (await B.trialBalance(db, SHOP, '2027-03-31')).rows.find((r) => r.code === cash.code);
  const bsNext = await B.balanceSheet(db, SHOP, '2027-04-30');
  ok('Suspense cleared → the next year\'s balance sheet balances, with real carried figures', bsNext.balanced && bsNext.total_assets_minor > 100000, JSON.stringify([bsNext.total_assets_minor, bsNext.total_liabilities_minor]));
  const tbNext = await B.trialBalance(db, SHOP, '2027-04-30');
  const cashNext = tbNext.rows.find((r) => r.code === cash.code);
  ok('…cash carried to the paisa: this year\'s closing less April\'s rent (100.00)', tbNext.balanced && closing && cashNext && cashNext.debit_minor === closing.debit_minor - 10000, JSON.stringify([closing, cashNext]));
  const lgY = await B.ledgerOf(db, SHOP, cash, null, '2027-04-01', '2027-04-30');
  ok('…a ledger opened on the year\'s first day starts from the carried balance', lgY.opening_minor === closing.debit_minor, JSON.stringify(lgY));
  /* ── THE BUYER'S SIDE OF A COUNTER BILL: what lib/books-hooks hands postEntry once the buyer accepted it (2026-10-01) ──
     Kumar Traders (SUPP) billed this shop ₹481.65 on credit at its counter: 418.00 @5% (10.46 + 10.44), 33.40 @28% (4.68 + 4.67). */
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const buy = K.classify({ chit: { chit_id: 'c0000000-0000-4000-8000-0000000000b1', purpose: 'order', sender_entity_id: SUPP, currency_code: 'INR',
      business_json: { bill_no: 'C2/26-27/0002', till: { id: 'C2' }, billed_at: '2026-09-26T05:00:00Z', customer: { name: 'This shop', identity_id: SHOP },
        payment: { parts: [{ how: 'On credit', amount: 481.65 }] }, terms: { due_date: '2026-10-11' } } },
    entry: { sells: false, seller: { entity_id: SUPP, LglNm: 'Kumar Traders' }, me: { entity_id: SHOP },
      invoice: { ItemList: [{ GstRt: 5, AssAmt: 418, CgstAmt: 10.46, SgstAmt: 10.44, IgstAmt: 0, CesAmt: 0 }, { GstRt: 28, AssAmt: 33.4, CgstAmt: 4.68, SgstAmt: 4.67, IgstAmt: 0, CesAmt: 0 }] } },
    setting: { country: 'IN', functional_currency: 'INR' }, status: 'accepted' });
  const pb = buy.kind === 'post' ? await B.postEntry(db, SHOP, buy.event) : { why: buy.why };
  ok('the buyer\'s accepted counter bill posts as a purchase', pb.ok, JSON.stringify(pb));
  const pl = T.lines.filter((l) => l.entry_id === pb.entry_id);
  const byCode = (c) => pl.filter((l) => l.code === c).map((l) => [l.dr_minor, l.cr_minor]);
  eq('…Dr Purchases 5000: 418.00 and 33.40', byCode('5000').sort(), [[3340, 0], [41800, 0]]);
  eq('…Dr Input CGST 2210: 10.46 + 4.68 · Dr Input SGST 2211: 10.44 + 4.67 (the tax credit)', [byCode('2210').map((x) => x[0]).sort((a, b) => a - b), byCode('2211').map((x) => x[0]).sort((a, b) => a - b)], [[468, 1046], [467, 1044]]);
  const credA = T.accounts.find((a) => a.entity_id === SHOP && a.role === 'creditors');
  eq('…Cr Creditors 481.65, named for Kumar Traders; Σ Dr = Σ Cr', [pl.filter((l) => l.account_id === credA.account_id).map((l) => [l.party_id, l.cr_minor]), pl.reduce((t, l) => t + l.dr_minor, 0) === pl.reduce((t, l) => t + l.cr_minor, 0)], [[[SUPP, 48165]], true]);
  const dues = E.receivables().outstanding(await B.partyItems(db, SHOP, SUPP, credA.account_id));
  const due1 = dues.by_ref[buy.event.source_chit_id];
  eq('Dues, payable side: Kumar Traders is owed 481.65 on that bill, due 11 Oct', due1 && [due1.outstanding_minor, T.items.find((i) => i.ref === buy.event.source_chit_id).side, T.items.find((i) => i.ref === buy.event.source_chit_id).due_date], [48165, 'payable', '2026-10-11']);

  const ctl = await B.controls(db, SHOP, '2026-09-30');
  ok('CBLedger.controls finds nothing wrong', ctl.ok, JSON.stringify(ctl.mismatches));

  done();
})().catch((e) => { fail++; console.log('   FAIL threw: ' + (e && e.stack)); done(); });

function done() {
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
}

/**
 * books-hooks.test.cjs — WHAT A SAVED CHIT POSTS, AND THAT A FAILED POST NEVER FAILS THE CHIT (SPEC-books-v2 §3).
 *
 *   classify() — pure: a walk-in counter bill waits for its day; a named / on-credit / GSTIN bill posts per bill; an
 *   invoice sent is a sale, received a purchase; credit notes, expenses, income; a day summary; orders post nothing;
 *   the tender words map to modes; what cannot post is QUEUED with a reason, never guessed.
 *   afterChit() — the posting throws → the hook resolves, the event is parked in books_outbox with the reason; the
 *   outbox write throws too → still resolves, and it is logged (never silent); books off → one cached read, nothing else.
 * Run: node tests/books-hooks.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222', SUPP = '33333333-3333-4333-8333-333333333333';
const inv = (items, total) => ({ currency: 'INR', ItemList: items.map((x) => ({ GstRt: x[0], AssAmt: x[1], CgstAmt: x[2], SgstAmt: x[2], IgstAmt: 0, CesAmt: 0 })), ValDtls: { TotInvVal: total } });
const S = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };

(async () => {
  console.log('\n══ THE POSTING HOOKS ══\n');
  const X = H.load();
  const K = require(path.join(H.API, 'lib', 'books-hooks'));

  eq('tender words → modes (card before credit; UPI by any of its names; on credit = owed)',
    ['Cash', 'Card', 'Credit card', 'GPay', 'PhonePe', 'UPI', 'NEFT', 'Cheque', 'On credit', 'Udhaar', 'Points', ''].map(K.modeOf),
    ['cash', 'card', 'card', 'upi', 'upi', 'upi', 'bank', 'cheque', 'credit', 'credit', null, null]);
  eq('the shop\'s day of a moment (India +05:30: 20:00 UTC is the next day)', [K.dayOf('2026-09-28T20:00:00Z', 'IN'), K.dayOf('2026-09-28T17:00:00Z', 'IN')], ['2026-09-29', '2026-09-28']);

  const bill = (bj, purpose) => ({ chit: { chit_id: 'c1', purpose: purpose || 'order', business_json: Object.assign({ bill_no: 'C1-0001', till: { id: 'C1' }, billed_at: '2026-09-29T05:00:00Z' }, bj), currency_code: 'INR' },
    entry: { sells: true, invoice: inv([[18, 100, 9]], 118) }, setting: S });

  if (X.src.dir) {
    const w = K.classify(bill({ payment: { parts: [{ how: 'Cash', amount: 118 }] } }));
    eq('a walk-in cash bill WAITS for its counter\'s day close', [w.kind, w.counter, w.day, w.bill.pay], ['walkin', 'C1', '2026-09-29', { cash: 118 }]);
    const g = K.classify(Object.assign(bill({ payment: { parts: [{ how: 'Cash', amount: 118 }] } }), { setting: Object.assign({}, S, { walkin_grain: 'bill' }) }));
    eq('…with the grain set to per-bill, it posts as its own walk-in entry', [g.kind, g.event && g.event.type, g.event && g.event.source_ref], ['post', 'walkin_day', 'bill:c1']);
    const n = K.classify(bill({ customer: { name: 'Ravi', party_id: CUST }, payment: { parts: [{ how: 'Cash', amount: 18 }, { how: 'On credit', amount: 100 }] } }));
    eq('a bill to a known customer, part on credit → sale_bill per bill, only the cash as paid', [n.kind, n.event.type, n.event.party, n.event.paid, n.event.round_off], ['post', 'sale_bill', CUST, { cash: 18 }, 0]);
    const nc = K.classify(bill({ customer: { name: 'Stranger' }, payment: { parts: [{ how: 'On credit', amount: 118 }] } }));
    eq('on credit with NO known customer is queued — who owes it?', [nc.kind, /who owes/.test(nc.why)], ['queue', true]);
    const gs = K.classify(bill({ customer: { name: 'Acme', gstin: '33ABCDE1234F1Z5' }, payment: { parts: [{ how: 'UPI', amount: 118 }] } }));
    eq('a buyer with a GSTIN is per bill even when paid', [gs.kind, gs.event.type, gs.event.paid], ['post', 'sale_bill', { upi: 118 }]);
    const ro = K.classify(bill({ payment: { parts: [{ how: 'Cash', amount: 118.5 }] } }));
    /* ACC-200: reg-in has no cashRounding (a rounded figure is never posted) — 50p over waits, named; AU's 5c step: tests/acc-200-cash-rounding */
    eq('an Indian bill paid 50p over its invoice WAITS with the gap named, never a silent round-off', [ro.kind, ro.gap_minor, /over by ₹0\.50/.test(ro.why || '')], ['queue', 50, true]);
    const far = K.classify(bill({ payment: { parts: [{ how: 'Cash', amount: 150 }] } }));
    eq('payments that differ from the invoice by more than a rupee are queued, not forced', far.kind, 'queue');
    const pts = K.classify(bill({ payment: { parts: [{ how: 'Points', amount: 118 }] } }));
    eq('a tender with no ledger (Points) is queued and named', [pts.kind, /Points/.test(pts.why)], ['queue', true]);
  } else console.log('   SKIP the granularity checks: ' + X.src.why);

  const cess = K.classify({ chit: { chit_id: 'c2', created_at: '2026-09-29T05:00:00Z', purpose: 'order', business_json: { bill_no: 'x', till: { id: 'C1' }, payment: { parts: [{ how: 'Cash', amount: 130 }] } } },
    entry: { sells: true, invoice: { ItemList: [{ GstRt: 28, AssAmt: 100, CgstAmt: 14, SgstAmt: 14, IgstAmt: 0, CesAmt: 2 }] } }, setting: S });
  /* v1.16.0: cess POSTS (2203 / 2213) — read per rate from the frozen invoice's CesAmt, never recomputed; only a non-GST tax (TaxAmt) still queues */
  eq('cess on a bill is posted (a walk-in line), carried per rate from CesAmt — never folded into another line', [cess.kind, cess.bill && cess.bill.taxes], ['walkin', [{ rate: 28, taxable: 100, cgst: 14, sgst: 14, igst: 0, cess: 2 }]]);
  const vat = K.classify({ chit: { chit_id: 'c2v', created_at: '2026-09-29T05:00:00Z', purpose: 'order', business_json: { bill_no: 'x', till: { id: 'C1' }, payment: { parts: [{ how: 'Cash', amount: 130 }] } } },
    entry: { sells: true, invoice: { ItemList: [{ GstRt: 28, AssAmt: 100, CgstAmt: 14, SgstAmt: 14, IgstAmt: 0, TaxAmt: 3 }] } }, setting: S });
  eq('a genuinely unknown non-GST tax (TaxAmt) is still queued, with its reason', [vat.kind, /non-GST tax \(3\)/.test(vat.why || '')], ['queue', true]);
  const sent = K.classify({ chit: { chit_id: 'c3', created_at: '2026-09-29T05:00:00Z', purpose: 'invoice', business_json: {} }, entry: { sells: true, buyer: { entity_id: CUST }, invoice: inv([[5, 200, 5]], 210) }, setting: S });
  eq('an invoice I send → sale_bill, the buyer owes all of it', [sent.event.type, sent.event.party, sent.event.paid, sent.event.source_ref], ['sale_bill', CUST, {}, 'chit:c3']);
  const got = K.classify({ chit: { chit_id: 'c4', created_at: '2026-09-29T05:00:00Z', purpose: 'invoice', business_json: {} }, entry: { sells: false, seller: { entity_id: SUPP }, invoice: inv([[12, 1000, 60]], 1120) }, setting: S, status: 'accepted' });
  eq('an invoice I receive, once I ACCEPTED it → purchase_bill, I owe the supplier (2026-10-01: no longer on arrival)', [got.event.type, got.event.party], ['purchase_bill', SUPP]);
  const cn = K.classify({ chit: { chit_id: 'c5', created_at: '2026-09-29T05:00:00Z', purpose: 'credit_note', business_json: { till: { id: 'C1' }, bill_no: 'CN-1', against: 'C1-0001', refund: { parts: [{ how: 'Cash', amount: 118 }] } } },
    entry: { sells: true, invoice: inv([[18, 100, 9]], 118) }, setting: S });
  eq('a counter credit note → return, refunded in cash', [cn.event.type, cn.event.refund, cn.event.against_bill], ['return', { cash: 118 }, 'C1-0001']);
  const ex = K.classify({ chit: { chit_id: 'c6', created_at: '2026-09-29T05:00:00Z', purpose: 'expense', business_json: { till: { id: 'C1' }, expense: { what: 'tea', mode: 'Cash', amount: 40 } } }, entry: {}, setting: S });
  eq('an expense → by class (sundry when unclassed), paid from cash', [ex.event.type, ex.event.class, ex.event.paid_from, ex.event.amount], ['expense', 'sundry_expense', 'cash', 40]);
  const inc = K.classify({ chit: { chit_id: 'c7', created_at: '2026-09-29T05:00:00Z', purpose: 'income', business_json: { income: { what: 'scrap', mode: 'UPI', amount: 250, class: 'scrap_sales' } } }, entry: {}, setting: S });
  eq('an income chit → other_income by its class, into UPI', [inc.event.type, inc.event.class, inc.event.into], ['other_income', 'scrap_sales', 'upi']);
  const day = K.classify({ chit: { chit_id: 'c8', purpose: 'general', business_json: { summary: { period: 'day', key: 'day-2026-09-28', till: { id: 'C2' } } } }, entry: {}, setting: S });
  eq('a counter\'s day summary chit → post that counter\'s walk-in day', [day.kind, day.counter, day.day], ['day', 'C2', '2026-09-28']);
  /* ⭐ M84 (2026-10-10): the browser till's Close the day queues EXACTLY CBRollup.chitOf(CBRollup.summary('day', …)) — the
     chit as it leaves the counter (no chit_id yet, the key a bare date, the counter a tillStamp) must reach the same 'day' post */
  {
    const R = require(path.join(H.API, 'lib', 'rollup'));
    const sum = R.summary('day', '2026-10-10', R.totals([{ no: 'C5/26-27/0004', total: 175, payments: [{ how: 'Cash', amount: 175 }] }]),
      { till: { id: 'C5', name: 'Counter 5', host: 'browser' }, source: null, at: '2026-10-10T06:40:00Z' });
    const body = R.chitOf(sum);
    const k = K.classify({ chit: Object.assign({ chit_id: 'c8b', created_at: '2026-10-10T06:40:01Z' }, body), entry: {}, setting: S });
    eq('the browser till\'s day-close chit (rollup.chitOf) → that counter\'s walk-in day', [body.purpose, body.client_ref, k.kind, k.counter, k.day],
      ['general', 'SUM/D/C5/2026-10-10', 'day', 'C5', '2026-10-10']);
  }
  /* the counter's own fields (books-counter 3e1c88f) */
  const rc = (p) => K.classify({ chit: { chit_id: 'r1', purpose: 'general', created_at: '2026-09-29T05:00:00Z', business_json: { kind: 'payment_received', till: { id: 'C1' },
    payment_received: Object.assign({ no: 'R/C1/0007', at: '2026-09-29T05:00:00Z', party: { identity_id: CUST, name: 'Ravi' }, amount: 250.5, currency: 'INR', mode: 'UPI', status: 'cleared' }, p) } }, entry: {}, setting: S });
  const r0 = rc({});
  eq('the counter\'s "money received" chit → a PAYMENT (not a bill): party, 25050 minor, UPI, the shop\'s day, idempotent by the chit',
    [r0.kind, r0.payment.party_id, r0.payment.amount_minor, r0.payment.mode, r0.payment.received_at, r0.payment.client_ref, r0.payment.reference], ['payment', CUST, 25050, 'upi', '2026-09-29', 'chit:r1', 'R/C1/0007']);
  const rq = rc({ mode: 'cheque', status: 'received', cheque: { no: '000123', bank: 'SBI', dated: '2026-10-01' } });
  eq('…a cheque rides as a cheque (held until it clears), with its number', [rq.payment.mode, rq.payment.cheque_no, rq.payment.cheque_date], ['cheque', '000123', '2026-10-01']);
  eq('…from nobody the shop knows → queued, named', [rc({ party: null }).kind, /nobody/.test(rc({ party: null }).why)], ['queue', true]);
  eq('…with no usable date → queued, never guessed', K.classify({ chit: { chit_id: 'r2', purpose: 'general', business_json: { kind: 'payment_received', payment_received: { party: { identity_id: CUST }, amount: 1, mode: 'cash', at: 'not a date' } } }, entry: {}, setting: S }).kind, 'queue');
  eq('an expense chit with no usable date is queued (CBPosting refuses an undated event)', K.classify({ chit: { chit_id: 'c6b', purpose: 'expense', business_json: { expense: { what: 'x', mode: 'Cash', amount: 1 } } }, entry: {}, setting: S }).kind, 'queue');
  if (X.src.dir) {
    const tb = K.classify(bill({ customer: { name: 'Ravi', identity_id: CUST }, terms: { credit_days: 7, due_date: '2026-10-06' }, credit_override: { by: 'owner' }, payment: { parts: [{ how: 'On credit', amount: 118 }] } }));
    eq('a credit bill carries the counter\'s own terms: due 6 Oct, the customer by identity_id', [tb.event.type, tb.event.party, tb.event.due_date, tb.event.paid], ['sale_bill', CUST, '2026-10-06', {}]);
    /* end to end through the hook: the payment chit records ONE payment, and a replay records none */
    const TCp = require(path.join(H.API, 'lib', 'tax-copy')); const was = TCp.copyOf;
    TCp.copyOf = async () => ({ chit_id: 'r9', purpose: 'general', created_at: '2026-09-29T05:00:00Z', business_json: { kind: 'payment_received', payment_received: { no: 'R/C1/0009', at: '2026-09-29T05:00:00Z', party: { identity_id: CUST }, amount: 100, currency: 'INR', mode: 'Cash' } } });
    await X.store.saveSetting(X.db, SHOP, { enabled: true }); await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-09-29' }); K.forget(SHOP);
    X.T.parties.push({ owner: SHOP, party_id: CUST, name: 'Ravi', customer: true });
    const h1 = await K.postChit(SHOP, 'r9', {}); const h2 = await K.postChit(SHOP, 'r9', {});
    eq('…through the hook: one payment row, one entry; the replay is a duplicate', [X.T.payments.length, h1.payment && h1.payment.status, h1.posted && h1.posted.ok, h2.payment && h2.payment.duplicate, X.T.entries.filter((e) => e.event_type === 'payment_received').length], [1, 'recorded', true, true, 1]);
    /* engines v1.8.1: an expense naming a class that is not an expense ledger is REFUSED by the rules — parked and named, never swallowed */
    TCp.copyOf = async () => ({ chit_id: 'x9', purpose: 'expense', created_at: '2026-09-29T05:00:00Z', business_json: { expense: { what: 'x', mode: 'Cash', amount: 10, class: 'sales' } } });
    const rf = await K.postChit(SHOP, 'x9', {});
    const pk9 = X.T.outbox.find((o) => o.source_chit_id === 'x9');
    ok('a post the RULES refuse (an expense on a non-expense ledger) is queued with the rules\' own words — the chit is untouched', rf.queued === true && pk9 && pk9.why && pk9.why.length > 10 && !X.T.entries.some((e) => e.source_ref === 'chit:x9'), JSON.stringify([rf, pk9 && pk9.why]));
    TCp.copyOf = was; await X.store.saveSetting(X.db, SHOP, { enabled: false }); K.forget(SHOP);
  }
  /* ══ THE BUYER'S SIDE OF A COUNTER BILL (Athi, 2026-10-01: "can chola see it as a purchase …") ══
     Tally Test Shop (SHOP) bills Chola Auto Care (CUST) ₹481.65 at counter C2: 418.00 @5% (10.46 + 10.44) and 33.40 @28% (4.68 + 4.67).
     ⭐ The buyer's copy NEVER posts on arrival — only once the buyer has ACCEPTED it on the rail (the chit's own status), never while a
     dispute is open, never after a rejection; and the seller must be on the buyer's supplier list (checked by the hook, not guessed). */
  const BILLNO = 'C2/26-27/0002';
  const inv2 = { currency: 'INR', ItemList: [{ GstRt: 5, AssAmt: 418, CgstAmt: 10.46, SgstAmt: 10.44, IgstAmt: 0, CesAmt: 0 }, { GstRt: 28, AssAmt: 33.4, CgstAmt: 4.68, SgstAmt: 4.67, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 481.65 } };
  const RATES = [{ rate: 5, taxable: 418, cgst: 10.46, sgst: 10.44, igst: 0 }, { rate: 28, taxable: 33.4, cgst: 4.68, sgst: 4.67, igst: 0 }];
  const cbj = (parts) => ({ bill_no: BILLNO, till: { id: 'C2' }, billed_at: '2026-10-01T05:00:00Z', customer: { name: 'Chola Auto Care', identity_id: CUST },
    payment: { parts }, terms: { credit_days: 15, due_date: '2026-10-16' } });
  const CREDIT = [{ how: 'On credit', amount: 481.65 }], CASH = [{ how: 'Cash', amount: 481.65 }];
  const sellerEntry = { sells: true, seller: { entity_id: SHOP, LglNm: 'Tally Test Shop' }, buyer: { entity_id: null }, me: { entity_id: SHOP }, invoice: inv2 };
  const buyerEntry = { sells: false, seller: { entity_id: SHOP, LglNm: 'Tally Test Shop' }, buyer: { entity_id: CUST }, me: { entity_id: CUST }, invoice: inv2 };
  const buyerCopy = (id, parts, extra) => Object.assign({ chit_id: id, purpose: 'order', sender_entity_id: SHOP, currency_code: 'INR', business_json: cbj(parts) }, extra || {});
  const bk = (id, parts, status, more) => K.classify(Object.assign({ chit: buyerCopy(id, parts), entry: buyerEntry, setting: S, status }, more || {}));

  const arr = bk('b0', CREDIT, 'delivered');
  eq('the BUYER\'s copy of a counter bill, on arrival → waits for the buyer to confirm the goods, named (bill + seller)',
    [arr.kind, arr.why, arr.event], ['queue', 'Waiting for you to confirm the goods were received (bill ' + BILLNO + ' from Tally Test Shop)', undefined]);
  const acc = bk('b1', CREDIT, 'accepted');
  eq('…ACCEPTED, on credit → purchase_bill: party = the SELLER, input tax per rate, nothing paid (all owed to Creditors), its due date, no counter',
    acc.event && [acc.kind, acc.event.type, acc.event.party, acc.event.by_rate, acc.event.paid, acc.event.round_off, acc.event.counter, acc.event.source_ref, acc.event.against_ref, acc.event.due_date, acc.supplier_check],
    ['post', 'purchase_bill', SHOP, RATES, {}, 0, null, 'chit:b1', 'b1', '2026-10-16', true]);
  const cashB = bk('b2', CASH, 'completed');
  eq('…ACCEPTED (completed), paid in cash at the counter → purchase_bill paid { cash: 481.65 }, nothing owed', cashB.event && [cashB.event.type, cashB.event.paid, cashB.event.party], ['purchase_bill', { cash: 481.65 }, SHOP]);
  const dis = bk('b3', CREDIT, 'accepted', { disputed: true });
  eq('…accepted but DISPUTED (an open dispute) → never posts; it waits, and says why', [dis.kind, /disput/i.test(dis.why || '')], ['queue', true]);
  eq('…REJECTED by the buyer (a dispute settled in the buyer\'s favour) → never posts, and leaves the waiting list', bk('b4', CREDIT, 'rejected').kind, 'none');
  eq('…cancelled → never posts', bk('b4c', CREDIT, 'cancelled').kind, 'none');
  const walk = K.classify({ chit: buyerCopy('b5', CASH, { business_json: Object.assign(cbj(CASH), { customer: { name: 'Walk-in' } }) }), entry: buyerEntry, setting: S, status: 'accepted' });
  eq('…a buyer copy is NEVER a walk-in (no customer named, cash, grain day): a purchase, not the buyer\'s own day sales', [walk.kind, walk.event && walk.event.type], ['post', 'purchase_bill']);
  const walkB = K.classify({ chit: buyerCopy('b5b', CASH, { business_json: Object.assign(cbj(CASH), { customer: { name: 'Walk-in' } }) }), entry: buyerEntry, setting: Object.assign({}, S, { walkin_grain: 'bill' }), status: 'delivered' });
  ok('…and never the walk-in per-bill entry either, whatever the grain', walkB.kind !== 'walkin' && !(walkB.event && walkB.event.type === 'walkin_day'), JSON.stringify(walkB));
  const misl = K.classify({ chit: buyerCopy('b6', CREDIT), entry: Object.assign({}, buyerEntry, { sells: true, seller: { entity_id: CUST } }), setting: S, status: 'accepted' });
  eq('…a copy tax-copy calls "sells" but SENT by another shop\'s counter is still the buyer\'s: purchase_bill from the sender', misl.event && [misl.event.type, misl.event.party], ['purchase_bill', SHOP]);
  const sellerSide = K.classify({ chit: buyerCopy('b7', CREDIT), entry: sellerEntry, setting: S });
  eq('the SELLER\'s copy of the same bill still posts at save → sale_bill to Chola, unchanged (no acceptance asked)', sellerSide.event && [sellerSide.kind, sellerSide.event.type, sellerSide.event.party, sellerSide.event.counter, sellerSide.event.by_rate], ['post', 'sale_bill', CUST, 'C2', RATES]);
  /* the invoice purpose's buyer branch: behind acceptance too */
  const invC = (st, more) => K.classify(Object.assign({ chit: { chit_id: 'i1', created_at: '2026-09-29T05:00:00Z', purpose: 'invoice', sender_entity_id: SUPP, business_json: { invoice_no: 'KT/77' } }, entry: { sells: false, seller: { entity_id: SUPP, LglNm: 'Kumar Traders' }, me: { entity_id: SHOP }, invoice: inv([[12, 1000, 60]], 1120) }, setting: S, status: st }, more || {}));
  eq('an INVOICE I receive, on arrival → waits for me to confirm the goods (it no longer posts on arrival)', [invC('delivered').kind, /Waiting for you to confirm the goods were received .*Kumar Traders/.test(invC('delivered').why)], ['queue', true]);
  eq('…accepted → purchase_bill from the supplier, supplier list checked', [invC('accepted').event.type, invC('accepted').event.party, invC('accepted').supplier_check], ['purchase_bill', SUPP, true]);
  eq('…disputed → waits; rejected → nothing', [invC('accepted', { disputed: true }).kind, invC('rejected').kind], ['queue', 'none']);

  if (X.src.dir) {
    /* ── through the hook, on the buyer's own ledger ── */
    const TCb = require(path.join(H.API, 'lib', 'tax-copy')); const wasC = TCb.copyOf, wasE = TCb.entryFor;
    let copyNow = null;
    TCb.copyOf = async () => copyNow; TCb.entryFor = async () => buyerEntry;
    await X.store.saveSetting(X.db, CUST, { enabled: true }); await X.B.enable(X.db, CUST, { by: CUST, today: '2026-10-01' }); K.forget(CUST);
    const posted = (id) => X.T.entries.filter((e) => e.entity_id === CUST && e.source_ref === 'chit:' + id);
    const waitRows = (id) => X.T.outbox.filter((o) => o.entity_id === CUST && o.source_chit_id === id && !o.done_at);

    copyNow = Object.assign(buyerCopy('h1', CREDIT), { current_status: 'delivered' });
    const a1 = await K.postChit(CUST, 'h1', {});
    const w1 = waitRows('h1')[0], row1 = w1 && K.waitingRow(w1);
    eq('arrival → parked on Waiting with the sentence, nothing posted', [a1.queued, w1 && w1.why, posted('h1').length], [true, 'Waiting for you to confirm the goods were received (bill ' + BILLNO + ' from Tally Test Shop)', 0]);
    eq('…the Waiting row names its source so the screen can open the chit', row1 && row1.source, { chit_id: 'h1', ref: BILLNO, kind: 'purchase', counter: null, by: null });
    const r1 = await K.retryOutbox(CUST, 10);
    eq('…a retry before acceptance changes nothing (still waiting, nothing posted)', [r1.posted, waitRows('h1').length, posted('h1').length], [0, 1, 0]);

    copyNow = Object.assign(buyerCopy('h1', CREDIT), { current_status: 'accepted' });
    const a2 = await K.postChit(CUST, 'h1', {});
    const w2 = X.T.outbox.filter((o) => o.entity_id === CUST && o.source_chit_id === 'h1').pop();
    eq('accepted, but Tally Test Shop is NOT on Chola\'s supplier list → parked with the sentence, nothing posted (never auto-added)',
      [a2.queued, w2 && w2.why, posted('h1').length, X.T.parties.some((p) => p.owner === CUST && p.party_id === SHOP)], [true, 'Tally Test Shop is not on your supplier list — add them, then this posts', 0, false]);
    X.T.parties.push({ owner: CUST, party_id: SHOP, name: 'Tally Test Shop', supplier: true, credit_days: 15 });
    const r2 = await K.retryOutbox(CUST, 10);
    const pe = posted('h1')[0];
    ok('…once they are on the list, the retry POSTS it (purchase_bill) and clears the waiting rows', pe && pe.event_type === 'purchase_bill' && r2.posted >= 1 && waitRows('h1').length === 0, JSON.stringify([r2, pe, waitRows('h1')]));
    const lines = pe ? X.T.lines.filter((l) => l.entry_id === pe.entry_id) : [];
    const cred = X.T.accounts.find((a) => a.entity_id === CUST && a.role === 'creditors') || X.T.accounts.find((a) => a.role === 'creditors');
    ok('…Cr Creditors 481.65 named for Tally Test Shop; Σ Dr = Σ Cr', lines.some((l) => l.account_id === cred.account_id && l.party_id === SHOP && l.cr_minor === 48165)
      && lines.reduce((t, l) => t + l.dr_minor, 0) === lines.reduce((t, l) => t + l.cr_minor, 0), JSON.stringify(lines.map((l) => [l.code, l.dr_minor, l.cr_minor, l.party_id])));
    const a3 = await K.postChit(CUST, 'h1', {});
    ok('…posting again (Intake and goods-in both firing) is a duplicate — one entry, ever', a3.duplicate === true && posted('h1').length === 1, JSON.stringify(a3));

    /* ⭐ FX-F10W2: the acceptance that posts closes its OWN Waiting row (no "Try again", no nightly retry); a rejection closes it, said */
    copyNow = Object.assign(buyerCopy('h5', CREDIT), { current_status: 'delivered' });
    await K.postChit(CUST, 'h5', {});
    const h5w = waitRows('h5').length;
    copyNow = Object.assign(buyerCopy('h5', CREDIT), { current_status: 'accepted' });
    const h5 = await K.postChit(CUST, 'h5', {});
    const h5row = X.T.outbox.filter((o) => o.entity_id === CUST && o.source_chit_id === 'h5').pop();
    eq('FX-F10W2 · accepted → posted AND its Waiting row closed in the same path, said ("Accepted — posted to the books")',
      [h5w, !!h5.ok || !!h5.entry_no, posted('h5').length, waitRows('h5').length, h5row && h5row.why], [1, true, 1, 0, 'Accepted — posted to the books']);
    copyNow = Object.assign(buyerCopy('h6', CREDIT), { current_status: 'delivered' });
    await K.postChit(CUST, 'h6', {});
    copyNow = Object.assign(buyerCopy('h6', CREDIT), { current_status: 'rejected' });
    const h6 = await K.postChit(CUST, 'h6', {});
    const h6row = X.T.outbox.filter((o) => o.entity_id === CUST && o.source_chit_id === 'h6').pop();
    eq('FX-F10W2 · rejected → never posts, and its Waiting row closes as "Rejected — not posted"', [h6.none, posted('h6').length, waitRows('h6').length, h6row && h6row.why], [true, 0, 0, 'Rejected — not posted']);

    /* disputed → not posted; settled for the SELLER (dispute resolved, buyer accepts) → posted; settled for the BUYER (rejected) → never */
    copyNow = Object.assign(buyerCopy('h2', CREDIT), { current_status: 'accepted' });
    X.T.disputes.push({ entity_id: CUST, chit_id: 'h2', status: 'open' });
    const d1 = await K.postChit(CUST, 'h2', {});
    eq('accepted with an OPEN dispute → not posted, parked naming the dispute', [d1.queued, /disput/i.test(d1.why || ''), posted('h2').length], [true, true, 0]);
    X.T.disputes.find((d) => d.chit_id === 'h2').status = 'resolved';
    const d2 = await K.postChit(CUST, 'h2', {});
    ok('…the dispute resolved and the copy still accepted (the seller\'s favour) → posted', d2.ok && posted('h2').length === 1, JSON.stringify(d2));
    copyNow = Object.assign(buyerCopy('h3', CREDIT), { current_status: 'rejected' });
    X.T.disputes.push({ entity_id: CUST, chit_id: 'h3', status: 'resolved' });
    const d3 = await K.postChit(CUST, 'h3', {});
    ok('…resolved and the buyer REJECTED it (the buyer\'s favour) → never posts', d3.none === true && posted('h3').length === 0, JSON.stringify(d3));

    /* the walk-in day of the BUYER's own counter C2 never sums a buyer copy, even one sharing the counter's id */
    const wasCB = X.store.counterBills;
    X.store.counterBills = async () => [buyerCopy('h4', CASH, { business_json: Object.assign(cbj(CASH), { customer: { name: 'Walk-in' } }) })];
    const n0 = X.T.entries.length;
    const pd = await K.postDay(CUST, 'C2', '2026-10-01', {});
    ok('a walk-in day never sums a BUYER copy (same counter id C2, cash, no customer) — nothing posted', pd.empty === true && X.T.entries.length === n0, JSON.stringify(pd));
    X.store.counterBills = wasCB;
    TCb.copyOf = wasC; TCb.entryFor = wasE; await X.store.saveSetting(X.db, CUST, { enabled: false }); K.forget(CUST);
  }

  /* ══ F10 · MY COUNTER RECEIPT OF THEIR BILL IS THE SUPPLIER BILL TO ACCEPT (Athi, 14 Oct) ══ */
  {
    const TCr = require(path.join(H.API, 'lib', 'tax-copy')), INV = require(path.join(H.API, 'lib', 'folder-inventory'));
    const SG = SUPP, ROWS = {
      [SHOP]: { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Stores', country: 'IN', policy_flags: {} },
      [SG]: { identity_id: SG, gstn: '33BBBBB1111B1Z5', display_name: 'Sri Ganesh Provisions', country: 'IN', policy_flags: {} } };
    const q0 = X.db.query; let invoices = [];
    /* STD1: the shop's suppliers live where the ONE resolver reads them (books-store supplierByName — the in-memory parties here) */
    const setSuppliers = (list) => { X.T.parties = X.T.parties.filter((p) => !(p.owner === SHOP && p.supplier)); X.T.parties.push.apply(X.T.parties, list.map((x) => ({ owner: SHOP, party_id: x.id, name: x.name, party_no: x.no || null, supplier: true }))); };
    X.db.query = async (t, v) => {
      const s0 = String(t);
      if (/FROM identities WHERE identity_id = ANY/.test(s0)) return { rows: (v[0] || []).map((id) => ROWS[id]).filter(Boolean) };
      if (/purpose = 'invoice' AND sender_entity_id IS DISTINCT FROM/.test(s0)) return { rows: invoices.filter((x) => x.on === v[1]) };
      return q0(t, v);
    };
    const rbj = (more) => Object.assign({ doc: 'receipt', doc_no: 'R/0007', till: { id: 'C1' }, party: { name: 'Sri Ganesh Provisions', party_id: SG },
      their_bill: { no: 'SG-101', date: '2026-10-13', total: 1180 }, input_tax: { inclusive: false, vendor_state: null } }, more || {});
    const rcpt = (id, bjx, st, lines) => ({ chit_id: id, purpose: 'receipt', sender_entity_id: SHOP, created_at: '2026-10-13T05:00:00Z', current_status: st || 'pending',
      currency_code: 'INR', business_json: bjx || rbj(), line_items: lines || [{ particulars: 'Rice 25kg', quantity: 10, unit: 'bag', price: 100, total: 1000, gst_rate: 18 }] });
    const RCV = async (copy, more) => { const entry = await TCr.entryFor(copy, SHOP); return { entry, k: K.classify(Object.assign({ chit: copy, entry, setting: S, status: copy.current_status }, more || {})) }; };

    eq('F10 · a receipt WITH their bill no. and total is a bill I received (folder: Bills · Received; tax-copy.billReceived)',
      [INV.docOf(rcpt('r0'), SHOP), TCr.billReceived(rcpt('r0'), SHOP), INV.docOf(rcpt('r0', rbj({ their_bill: { no: 'SG-101', total: null } })), SHOP), INV.docOf(rcpt('r0', rbj({ their_bill: { no: '', total: 5 } })), SHOP)],
      ['bill_received', true, 'receipt', 'receipt']);
    ok('F10 · …and the folder SQL makes the same test (their_bill no AND total)', /their_bill'->>'no'.*their_bill'->>'total'/.test(INV.docSql('ch', 'cs')));

    const a = await RCV(rcpt('r1'));
    eq('F10 · the receipt is read as MY PURCHASE: the supplier sells (their GSTIN), the engine splits 18% intra-state into CGST + SGST',
      [a.entry.sells, a.entry.seller.entity_id, a.entry.invoice.ItemList[0].CgstAmt, a.entry.invoice.ItemList[0].SgstAmt, a.entry.invoice.ItemList[0].IgstAmt], [false, SG, 90, 90, 0]);
    eq('F10 · on arrival (born pending) it does NOT post — it waits for acceptance, in the Waiting list\'s words',
      [a.k.kind, a.k.wait, a.k.why], ['queue', 'acceptance', 'Waiting for you to confirm the goods were received (bill SG-101 from Sri Ganesh Provisions)']);
    const b = await RCV(rcpt('r2', rbj(), 'accepted'));
    eq('F10 · accepted → purchase_bill to Sri Ganesh with the counted lines by rate (the builder a received invoice uses), supplier list checked',
      [b.k.kind, b.k.supplier_check, b.k.event.type, b.k.event.party, b.k.event.ref, b.k.event.by_rate, b.k.event.round_off, b.k.event.source_ref, b.k.event.paid],
      ['post', true, 'purchase_bill', SG, 'SG-101', [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], 0, 'chit:r2', {}]);
    eq('F10 · a receipt WITHOUT their bill stays a goods receipt — posts nothing, accepted or not',
      [(await RCV(rcpt('r3', rbj({ their_bill: { no: null, date: null, total: null } }), 'accepted'))).k.kind, (await RCV(rcpt('r3b', rbj({ their_bill: null }), 'completed'))).k.kind], ['none', 'none']);
    eq('F10 · rejected → never posts', (await RCV(rcpt('r4', rbj(), 'rejected'))).k.kind, 'none');
    const c = await RCV(rcpt('r5', rbj({ against: { chit_id: 'ord-1' } }), 'accepted'), { theirInvoice: { chit_id: 'inv-1', no: 'SGP/0042' } });
    eq('F10 · against an order whose supplier SENT their invoice → no second bill: "Their invoice … is the bill"',
      [c.k.kind, c.k.done, c.k.why], ['none', true, 'Their invoice SGP/0042 is the bill — this receipt is the goods record.']);
    const d = await RCV(rcpt('r6', rbj({ party: { name: 'Sri Ganesh' } }), 'accepted'));
    eq('F11 · a typed name the books do not know → waits, named, with the fix ("Who is … Add them as a supplier")',
      [d.k.kind, d.k.wait, d.k.why], ['queue', 'party', 'Who is Sri Ganesh? Add them as a supplier — then bill SG-101 waits for you to accept it.']);
    /* ══ R106 / OPS-60 (TSK006b) · THEIR BILL SAYS MORE THAN WAS COUNTED = a shortfall: the bill posts at the COUNT, the gap is NOTED — never posted and reversed ══ */
    const g = await RCV(rcpt('r7', rbj({ their_bill: { no: 'SG-101', total: 1300 } }), 'accepted'));
    eq('R106 · accepted, their ₹1,300 against ₹1,180 counted → ONE purchase_bill at the count, round-off 0, the gap in the narration and on the bill\'s note',
      [g.k.kind, g.k.event.type, g.k.event.round_off, g.k.event.by_rate, g.k.event.narration, g.k.event.note],
      ['post', 'purchase_bill', 0, [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], 'Bill SG-101 from Sri Ganesh Provisions: ₹120 short against their ₹1,300.', '₹120 short against their ₹1,300']);
    eq('R106 · …the figures ride the event as minor units (theirs · ours · short), never only words',
      g.k.event.short, { theirs_minor: 130000, ours_minor: 118000, short_minor: 12000, words: '₹120 short against their ₹1,300', offer: 'Accept it at ₹1,180 (₹120 short, noted), or reject it.' });
    const gp = await RCV(rcpt('r7p', rbj({ their_bill: { no: 'SG-101', total: 1300 } }), 'pending'));
    eq('R106 · BEFORE acceptance it waits as a gap that asks ACCEPT (todo accept — the Accept action stays open), the figures as data, the offer in the sentence',
      [gp.k.kind, gp.k.wait, gp.k.todo, gp.k.gap, gp.k.short.short_minor, gp.k.why],
      ['queue', 'gap', 'accept', 120, 12000, 'Their bill SG-101 says ₹1,300, goods ₹1,000 + tax ₹180 come to ₹1,180 — ₹120 apart. Accept it at ₹1,180 (₹120 short, noted), or reject it.']);
    eq('R106 · …and the parked row carries the three figures as integers (todoFields → books_outbox.event.short → waitingRow)',
      [K.todoFields(gp.k), K.waitingRow({ id: 1, event: Object.assign({ job: 'chit' }, K.todoFields(gp.k)) }).short],
      [{ todo: 'accept', short: { theirs_minor: 130000, ours_minor: 118000, short_minor: 12000 } }, { theirs_minor: 130000, ours_minor: 118000, short_minor: 12000 }]);
    const gl = await RCV(rcpt('r7l', rbj({ their_bill: { no: 'SG-101', total: 1000 } }), 'accepted'));
    eq('R106 · their bill BELOW the count (₹1,000 against ₹1,180) is no shortfall — posting the count would overstate the creditor: it still waits, accepted or not',
      [gl.k.kind, gl.k.wait, gl.k.short, gl.k.why], ['queue', 'gap', undefined, 'Their bill SG-101 says ₹1,000, goods ₹1,000 + tax ₹180 come to ₹1,180 — ₹180 apart. Ask Sri Ganesh Provisions to correct it, or reject it and record their bill by hand.']);
    const gd = await RCV(rcpt('r7d', rbj({ their_bill: { no: 'SG-101', total: 1300 } }), 'accepted'), { disputed: true });
    eq('R106 · a shortfall on a bill with an open dispute waits for the dispute, as every bill does', [gd.k.kind, gd.k.wait], ['queue', 'dispute']);
    const ro = await RCV(rcpt('r8', rbj({ their_bill: { no: 'SG-101', total: 1180.6 } }), 'accepted'));
    eq('F10 · …within the one-rupee tolerance it posts, the gap as the round-off (the counter-bill rule)', [ro.k.kind, ro.k.event && ro.k.event.round_off], ['post', 0.6]);
    const ns = await RCV(rcpt('r9', rbj({ party: { name: 'Lakshmi Agencies' } }), 'accepted'), { party: SG });
    ok('F10 · an Indian supplier with no state and no GSTIN: CGST/SGST vs IGST is never guessed — it waits (or, with the party known, uses its GSTIN)',
      ns.k.kind === 'post' || ns.k.wait === 'state', JSON.stringify(ns.k).slice(0, 200));
    const nostate = await RCV(Object.assign(rcpt('r9b', rbj({ party: { name: 'Lakshmi Agencies' } }), 'accepted')), { party: '44444444-4444-4444-8444-444444444444' });
    eq('F10 · …a supplier the counter typed, no state given → waits in words', [nostate.k.kind, nostate.k.wait, /state is not known/.test(nostate.k.why || '')], ['queue', 'state', true]);
    const st2 = await RCV(rcpt('r9c', rbj({ party: { name: 'Lakshmi Agencies' }, input_tax: { inclusive: false, vendor_state: '29' } }), 'accepted'), { party: '44444444-4444-4444-8444-444444444444' });
    eq('F10 · …the state the counter typed (29 vs our 33) → IGST', st2.k.event && st2.k.event.by_rate, [{ rate: 18, taxable: 1000, cgst: 0, sgst: 0, igst: 180 }]);

    /* ══ FX-F10W2 · ONE COMPARISON: their total against what they CHARGE (taxable + tax), lib/their-bill — the counter calls the same file ══ */
    const TB = require(path.join(H.API, 'lib', 'their-bill'));
    const sg = (tot, lines, it) => RCV(rcpt('sg-' + tot + (it ? 'i' : ''), rbj({ their_bill: { no: 'SG-201', total: tot }, input_tax: { inclusive: !!it, vendor_state: '33' } }), 'accepted', lines));
    const ex5 = [{ particulars: 'Toor dal', quantity: 4, unit: 'kg', price: 105, total: 420, gst_rate: 5 }];
    const s441 = await sg(441, ex5), s420 = await sg(420, ex5);
    eq('FX-F10W2 · SG-201 (IN 5%, exclusive): goods ₹420 + tax ₹21 — their ₹441 POSTS (it agrees, no round-off)', [s441.k.kind, s441.k.event && s441.k.event.round_off], ['post', 0]);
    eq('FX-F10W2 · …their ₹420 (the goods BEFORE tax) waits — ₹21 apart: the figure the counter used to call "agrees"', [s420.k.kind, s420.k.wait, s420.k.gap], ['queue', 'gap', -21]);
    const say = (n) => require(path.join(H.API, 'lib', 'bill-privacy')).money(Math.round(n * 100), 'INR');
    eq('FX-F10W2 · …and its Waiting sentence starts with lib/their-bill\'s, word for word (the slip prints the same)',
      s420.k.why.indexOf(TB.check({ total: 420, taxable: 420, tax: 21, currency: 'INR', no: 'SG-201', say }).sentence), 0);
    const in5 = await sg(441, [{ particulars: 'Toor dal', quantity: 4, unit: 'kg', price: 110.25, total: 441, gst_rate: 5 }], true);
    eq('FX-F10W2 · inclusive (their rates already carry 5%): lines ₹441 = taxable ₹420 + tax ₹21 — their ₹441 posts', [in5.k.kind, in5.k.event && in5.k.event.round_off, in5.k.event && in5.k.event.by_rate[0].taxable], ['post', 0, 420]);
    const ex18 = [{ particulars: 'Soap', quantity: 10, unit: 'piece', price: 100, total: 1000, gst_rate: 18 }];
    const s1181_01 = await sg(1181.01, ex18);
    eq('FX-F10W2 · IN 18%: ₹1,000 + ₹180 — their ₹1,181 is within one rupee → posts with round-off +1; ₹1,181.01 is a shortfall (R106): posts at the count, noted, round-off 0',
      [(await sg(1181, ex18)).k.event.round_off, s1181_01.k.kind, s1181_01.k.event.round_off, s1181_01.k.event.short.short_minor, (await sg(1179, ex18)).k.event.round_off], [1, 'post', 0, 101, -1]);
    /* the rule itself, every host: exclusive and inclusive operands (the engine's split), AU 10% and IN 5% / 18%, the one-unit edge */
    const Tx = require(path.join(H.API, 'lib', 'tax'));
    const sp = (v, r, inc) => Tx.splitLineTax({ net: v, rate: r, priceIncludesTax: inc });
    const cmp = (tot, v, r, inc, cur) => { const x = sp(v, r, inc); return TB.check({ total: tot, taxable: x.assessable, tax: x.tax, currency: cur || 'INR' }); };
    eq('FX-F10W2 · their-bill: IN 5% exclusive ₹420 → ₹441 agrees, ₹420 apart (−21)', [cmp(441, 420, 5, false).code, cmp(420, 420, 5, false).code, cmp(420, 420, 5, false).gap], ['agrees', 'apart', -21]);
    eq('FX-F10W2 · their-bill: IN 18% inclusive ₹1,180 → ₹1,180 agrees (taxable 1,000 + 180)', [cmp(1180, 1180, 18, true).code, cmp(1180, 1180, 18, true).ours], ['agrees', 1180]);
    eq('FX-F10W2 · their-bill: AU GST 10% exclusive A$100 → A$110 agrees; A$100 apart', [cmp(110, 100, 10, false, 'AUD').code, cmp(100, 100, 10, false, 'AUD').code], ['agrees', 'apart']);
    eq('FX-F10W2 · their-bill: AU GST 10% inclusive A$110 → A$110 agrees (taxable 100 + GST 10)', [cmp(110, 110, 10, true, 'AUD').code, sp(110, 10, true).tax], ['agrees', 10]);
    eq('FX-F10W2 · their-bill: the one-unit edge — +1.00 and −1.00 round_off, +1.01 apart, no total → no_total',
      [cmp(442, 420, 5, false).code, cmp(440, 420, 5, false).code, cmp(442.01, 420, 5, false).code, TB.check({ total: '', taxable: 1, tax: 0, currency: 'INR' }).code], ['round_off', 'round_off', 'apart', 'no_total']);
    eq('FX-F10W2 · their-bill: in minor units — a 3-decimal currency (KWD) tolerates 1.000, not 1.001',
      [TB.check({ total: 11.000, taxable: 10, tax: 0, currency: 'KWD' }).code, TB.check({ total: 11.001, taxable: 10, tax: 0, currency: 'KWD' }).code], ['round_off', 'apart']);

    /* an AU shop: the supplier charged GST at my door — ONE head, `gst`, never India's three */
    ROWS[SHOP] = { identity_id: SHOP, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: {} };
    const au = await RCV(rcpt('r10', rbj({ party: { name: 'Harbour Wholesale' }, their_bill: { no: 'HW-9', total: 110 } }), 'accepted', [{ particulars: 'Flour', quantity: 10, price: 10, total: 100, gst_rate: 10 }]),
      { party: '55555555-5555-4555-8555-555555555555' });
    const auIt = au.entry.invoice.ItemList[0];
    eq('F10 · AU shop: the engine taxes the receipt under GST (one head, TaxAmt 10) — no CGST/SGST/IGST', [String(au.entry.invoice._cb.scheme), auIt.TaxAmt, auIt.CgstAmt, auIt.SgstAmt, auIt.IgstAmt], ['GST', 10, 0, 0, 0]);
    ok('F10 · …and the books either post its `gst` head or wait in GST words — never an India-only entry',
      (au.k.kind === 'post' && au.k.event.by_rate[0].gst === 10 && !au.k.event.by_rate[0].cgst) || (au.k.kind === 'queue' && /GST \(10\)/.test(au.k.why)), JSON.stringify(au.k).slice(0, 240));
    const auP = await RCV(rcpt('r10b', rbj({ party: { name: 'Harbour Wholesale' }, their_bill: { no: 'HW-9', total: 110 } }), 'accepted', [{ particulars: 'Flour', quantity: 10, price: 10, total: 100, gst_rate: 10 }]),
      { party: '55555555-5555-4555-8555-555555555555', setting: Object.assign({}, S, { country: 'AU' }) });
    ok('F10 · AU · the waiting words (if any) say GST, never GSTIN/CGST', !/GSTIN|CGST|SGST|IGST/.test(String(auP.k.why || '')), String(auP.k.why));
    ROWS[SHOP] = { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Stores', country: 'IN', policy_flags: {} };

    if (X.src.dir) {
      /* ── through the hook: arrival waits; the typed name resolves once they are on the list; their invoice closes the receipt ── */
      const wasC = TCr.copyOf; let copyNow = null; TCr.copyOf = async () => copyNow;
      const moves = []; K._mover.fn = async (e, id, to, by, note) => { moves.push([id, to, note]); return { code: 200, moved: true }; };
      const qClose = X.db.query; X.db.query = async (t, v) => (/FROM chit_status cs JOIN chit_header h/.test(String(t)) ? { rows: v[1].map((id) => ({ chit_id: id })) } : qClose(t, v));
      await X.store.saveSetting(X.db, SHOP, { enabled: true }); await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-10-01' }).catch(() => {}); K.forget(SHOP);
      const posted = (id) => X.T.entries.filter((e) => e.entity_id === SHOP && e.source_ref === 'chit:' + id);
      const waits = (id) => X.T.outbox.filter((o) => o.entity_id === SHOP && o.source_chit_id === id && !o.done_at);

      copyNow = rcpt('h10', rbj({ party: { name: 'sri ganesh provisions ' } }), 'pending');
      const h1 = await K.postChit(SHOP, 'h10', {});
      eq('F10 hook · a typed name nobody knows → parked "Who is …", nothing posted', [h1.queued, /^Who is sri ganesh provisions\?/.test(h1.why), posted('h10').length], [true, true, 0]);
      eq('FX-F10W · the Waiting row: todo add_supplier, no near match → no candidates', (() => { const r0 = K.waitingRow(waits('h10')[0]); return [r0.todo, r0.candidates]; })(), ['add_supplier', []]);
      /* STD1: what the row asks is DATA on the parked event — park wrote todo + the typed name; the sentence is for people */
      eq('STD1 · park() wrote todo add_supplier and the typed supplier name on the outbox row\'s event', [waits('h10')[0].event.todo, waits('h10')[0].event.name], ['add_supplier', 'sri ganesh provisions']);
      const reworded = Object.assign({}, waits('h10')[0], { why: 'Somebody rewrote this sentence entirely.' });
      eq('STD1 · …so a copy edit of the sentence changes nothing: the row still asks add_supplier, naming them', (() => { const r0 = K.waitingRow(reworded); return [r0.todo, r0.name]; })(), ['add_supplier', 'sri ganesh provisions']);
      /* a row parked BEFORE todo existed: classified ONCE on the server (books-store backfillTodo, the retry path) — then it is data */
      X.T.outbox.push({ id: 900, entity_id: SHOP, source_chit_id: 'old-1', source_ref: 'chit:old-1', event: { job: 'chit', chit_id: 'old-1', waiting: 'acceptance' }, why: 'Waiting for you to confirm the goods were received (bill X-1 from Old Co)', tries: 5, created_at: '2026-10-01T00:00:00Z', done_at: null },
        { id: 901, entity_id: SHOP, source_chit_id: 'old-2', source_ref: 'chit:old-2', event: { job: 'chit', chit_id: 'old-2', waiting: 'party' }, why: 'Who is Old Supplier? Add them as a supplier — then bill X-2 waits for you to accept it.', tries: 5, created_at: '2026-10-01T00:00:00Z', done_at: null },
        { id: 902, entity_id: SHOP, source_chit_id: null, source_ref: 'walkin:C1:2026-10-01', event: { job: 'day', counter: 'C1', day: '2026-10-01' }, why: 'Paid by "gpay", which has no ledger yet.', tries: 5, created_at: '2026-10-01T00:00:00Z', done_at: null });
      eq('STD1 · an old row is read by the ONE server fragment before it is backfilled (never by a client)', (await X.store.waiting(X.db, SHOP, 100)).filter((w) => w.id >= 900).map((w) => [w.todo, w.name]),
        [['accept', null], ['add_supplier', 'Old Supplier'], ['record', null]]);
      await X.store.backfillTodo(X.db, SHOP);
      eq('STD1 · backfillTodo wrote todo (+ name) onto each old row ONCE — data from then on', X.T.outbox.filter((o) => o.id >= 900).map((o) => [o.event.todo, o.event.name || null]),
        [['accept', null], ['add_supplier', 'Old Supplier'], ['record', null]]);
      eq('STD1 · …and a second run writes nothing', await X.store.backfillTodo(X.db, SHOP), 0);
      X.T.outbox.forEach((o) => { if (o.id >= 900) o.event = { job: o.event.job, chit_id: o.event.chit_id, waiting: o.event.waiting, counter: o.event.counter, day: o.event.day }; });
      const wasBf = X.store.backfillTodo; let bfCalls = 0; X.store.backfillTodo = async (db, e) => { bfCalls++; return wasBf(db, e); };
      await K.retryOutbox(SHOP, 1);
      X.store.backfillTodo = wasBf;
      eq('STD1 · the retry path runs the backfill first (every old row, not only the page it tries)', [bfCalls, X.T.outbox.filter((o) => o.id >= 900).every((o) => o.event.todo)], [1, true]);
      X.T.outbox.filter((o) => o.id >= 900).forEach((o) => { o.done_at = '2026-10-02T00:00:00Z'; });
      /* FX-F10W: "Sri Ganesh" typed, "Sri Ganesh Provisions" (P-00001) on the list → the wait carries the near match, names + party_no only */
      setSuppliers([{ id: SG, name: 'Sri Ganesh Provisions', no: 'P-00001' }, { id: 'x-2', name: 'Lakshmi Agencies', no: 'P-00002' }]);
      copyNow = rcpt('h12', rbj({ party: { name: 'Sri Ganesh' } }), 'pending');
      const c1 = await K.postChit(SHOP, 'h12', {});
      const crow = K.waitingRow(waits('h12')[0]);
      eq('FX-F10W · a typed "Sri Ganesh" waits "Who is …" WITH the shop\'s near match (≤ 3, name + party_no, never an id)',
        [c1.queued, crow.todo, crow.candidates], [true, 'add_supplier', [{ name: 'Sri Ganesh Provisions', party_no: 'P-00001' }]]);
      /* the owner picks it: PUT /use { party } wrote party_id on the receipt (bill-use) — the retry now waits for acceptance, and the row's event follows */
      copyNow = rcpt('h12', rbj({ party: { name: 'Sri Ganesh Provisions', party_id: SG } }), 'pending');
      await K.retryOutbox(SHOP, 50);
      const crow2 = K.waitingRow(waits('h12')[0]);
      eq('FX-F10W · …linked, a retry moves it to "To accept": todo accept, candidates gone, the event\'s wait follows', [crow2.todo, crow2.candidates, waits('h12')[0].event.waiting], ['accept', [], 'acceptance']);
      X.T.outbox.filter((o) => o.source_chit_id === 'h12').forEach((o) => { o.done_at = new Date().toISOString(); });
      setSuppliers([{ id: SG, name: 'sri ganesh provisions' }]);
      const h2 = await K.postChit(SHOP, 'h10', { retry: true });
      eq('F10 hook · …once they are on the supplier list, the same receipt waits for ACCEPTANCE (nothing re-typed)', [h2.queued, /^Waiting for you to confirm the goods were received \(bill SG-101 from Sri Ganesh Provisions\)/.test(h2.why)], [true, true]);
      const row = waits('h10')[0] && K.waitingRow(waits('h10')[0]);
      eq('F10 hook · the Waiting row opens the receipt (kind purchase, their bill no.)', row && [row.source.chit_id, row.source.kind, row.source.ref], ['h10', 'purchase', 'SG-101']);
      setSuppliers([{ id: SG, name: 'Sri Ganesh Provisions' }]);
      copyNow = rcpt('h10', rbj({ party: { name: 'sri ganesh provisions ' } }), 'accepted');
      const h3 = await K.postChit(SHOP, 'h10', {});
      const pe = posted('h10')[0];
      ok('F10 hook · accepted → ONE purchase_bill to Sri Ganesh (₹1,180 to Creditors), Σ Dr = Σ Cr', h3.ok && pe && pe.event_type === 'purchase_bill'
        && X.T.lines.filter((l) => l.entry_id === pe.entry_id).some((l) => l.party_id === SG && l.cr_minor === 118000), JSON.stringify([h3, pe && pe.event_type]));
      invoices = [{ on: 'ord-9', chit_id: 'inv-9', no: 'SGP/0042' }];
      copyNow = rcpt('h11', rbj({ against: { chit_id: 'ord-9' } }), 'accepted');
      const h4 = await K.postChit(SHOP, 'h11', {});
      eq('F10 hook · their invoice for the order is the bill → nothing posts, the receipt is closed with the sentence',
        [h4.none, posted('h11').length, moves.filter((m) => m[0] === 'h11').map((m) => [m[1], m[2]])], [true, 0, [['completed', 'Their invoice SGP/0042 is the bill — this receipt is the goods record.']]]);
      TCr.copyOf = wasC; K._mover.fn = null; X.db.query = qClose; await X.store.saveSetting(X.db, SHOP, { enabled: false }); K.forget(SHOP);
    }
    X.db.query = q0;
  }

  eq('an order (a promise) posts nothing', K.classify({ chit: { chit_id: 'c9', created_at: '2026-09-29T05:00:00Z', purpose: 'order', business_json: {} }, entry: { sells: true, invoice: inv([[5, 10, 0.25]], 10.5) }, setting: S }).kind, 'none');
  eq('a week summary posts nothing', K.classify({ chit: { purpose: 'general', business_json: { summary: { period: 'week' } } }, entry: {}, setting: S }).kind, 'none');

  /* ── a failed post NEVER fails the chit ── */
  await X.store.saveSetting(X.db, SHOP, { enabled: true });
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  TC.copyOf = async () => ({ chit_id: 'f1', purpose: 'expense', business_json: { expense: { what: 'x', mode: 'Cash', amount: 10 } }, created_at: '2026-09-29T05:00:00Z' });
  const B = require(path.join(H.API, 'lib', 'books'));
  const realPost = B.postEntry;
  B.postEntry = async () => { throw new Error('the database fell over mid-post'); };
  let r; try { r = await K.afterChit(SHOP, 'f1', SHOP); } catch (e) { r = { threw: e.message }; }
  ok('the posting throws → afterChit RESOLVES (the chit is untouched)', r && !r.threw, JSON.stringify(r));
  const parked = X.T.outbox.find((o) => o.source_chit_id === 'f1');
  ok('…and the event is parked in books_outbox, with the reason named', parked && /fell over/.test(parked.why) && parked.event.job === 'chit', JSON.stringify(parked));
  const realQueue = X.store.queue; X.store.queue = async () => { throw new Error('outbox table missing'); };
  const warned = []; const L = require(path.join(H.API, 'lib', 'logger')); const w0 = L.warn; L.warn = (m, c) => { warned.push(m); };
  let r2; try { r2 = await K.afterChit(SHOP, 'f1', SHOP); } catch (e) { r2 = { threw: e.message }; }
  ok('the outbox ALSO fails → afterChit still resolves', r2 && !r2.threw);
  ok('…and says so in the log (never silent)', warned.indexOf('books.outbox-failed') >= 0, JSON.stringify(warned));
  L.warn = w0; X.store.queue = realQueue; B.postEntry = realPost;
  /* the retry: the cause is gone, the waiting event posts, the row is marked done */
  if (X.src.dir) {
    await B.enable(X.db, SHOP, { by: SHOP, today: '2026-09-29' });
    const rr = await K.retryOutbox(SHOP, 10);
    ok('the retry posts what waited, and marks it done', rr.posted >= 1 && X.T.outbox.find((o) => o.source_chit_id === 'f1').done_at, JSON.stringify(rr));
  }
  /* off: one cached read, nothing else */
  K.forget(SHOP); await X.store.saveSetting(X.db, SHOP, { enabled: false });
  const n0 = X.T.outbox.length; let reads = 0; const c0 = TC.copyOf; TC.copyOf = async (...a) => { reads++; return c0(...a); };
  const off = await K.afterChit(SHOP, 'f1', SHOP);
  ok('books OFF → afterChit does nothing, queues nothing', off && off.off === true && X.T.outbox.length === n0);
  ok('…and does not even READ the chit (off costs one cached look at the switch, nothing more)', reads === 0, 'chit reads: ' + reads);

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });

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
    eq('a rounded bill carries its round-off (+0.50)', ro.bill.round_off, 0.5);
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

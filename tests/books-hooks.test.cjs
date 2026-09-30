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

  const cess = K.classify({ chit: { chit_id: 'c2', purpose: 'order', business_json: { bill_no: 'x', till: { id: 'C1' }, payment: { parts: [{ how: 'Cash', amount: 130 }] } } },
    entry: { sells: true, invoice: { ItemList: [{ GstRt: 28, AssAmt: 100, CgstAmt: 14, SgstAmt: 14, IgstAmt: 0, CesAmt: 2 }] } }, setting: S });
  eq('cess on a bill is queued (the rules do not post it yet) — never folded into another line', cess.kind, 'queue');
  const sent = K.classify({ chit: { chit_id: 'c3', purpose: 'invoice', business_json: {} }, entry: { sells: true, buyer: { entity_id: CUST }, invoice: inv([[5, 200, 5]], 210) }, setting: S });
  eq('an invoice I send → sale_bill, the buyer owes all of it', [sent.event.type, sent.event.party, sent.event.paid, sent.event.source_ref], ['sale_bill', CUST, {}, 'chit:c3']);
  const got = K.classify({ chit: { chit_id: 'c4', purpose: 'invoice', business_json: {} }, entry: { sells: false, seller: { entity_id: SUPP }, invoice: inv([[12, 1000, 60]], 1120) }, setting: S });
  eq('an invoice I receive → purchase_bill, I owe the supplier', [got.event.type, got.event.party], ['purchase_bill', SUPP]);
  const cn = K.classify({ chit: { chit_id: 'c5', purpose: 'credit_note', business_json: { till: { id: 'C1' }, bill_no: 'CN-1', against: 'C1-0001', refund: { parts: [{ how: 'Cash', amount: 118 }] } } },
    entry: { sells: true, invoice: inv([[18, 100, 9]], 118) }, setting: S });
  eq('a counter credit note → return, refunded in cash', [cn.event.type, cn.event.refund, cn.event.against_bill], ['return', { cash: 118 }, 'C1-0001']);
  const ex = K.classify({ chit: { chit_id: 'c6', purpose: 'expense', business_json: { till: { id: 'C1' }, expense: { what: 'tea', mode: 'Cash', amount: 40 } } }, entry: {}, setting: S });
  eq('an expense → by class (sundry when unclassed), paid from cash', [ex.event.type, ex.event.class, ex.event.paid_from, ex.event.amount], ['expense', 'sundry_expense', 'cash', 40]);
  const inc = K.classify({ chit: { chit_id: 'c7', purpose: 'income', business_json: { income: { what: 'scrap', mode: 'UPI', amount: 250, class: 'scrap_sales' } } }, entry: {}, setting: S });
  eq('an income chit → other_income by its class, into UPI', [inc.event.type, inc.event.class, inc.event.into], ['other_income', 'scrap_sales', 'upi']);
  const day = K.classify({ chit: { chit_id: 'c8', purpose: 'general', business_json: { summary: { period: 'day', key: 'day-2026-09-28', till: { id: 'C2' } } } }, entry: {}, setting: S });
  eq('a counter\'s day summary chit → post that counter\'s walk-in day', [day.kind, day.counter, day.day], ['day', 'C2', '2026-09-28']);
  eq('an order (a promise) posts nothing', K.classify({ chit: { chit_id: 'c9', purpose: 'order', business_json: {} }, entry: { sells: true, invoice: inv([[5, 10, 0.25]], 10.5) }, setting: S }).kind, 'none');
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
  const n0 = X.T.outbox.length;
  const off = await K.afterChit(SHOP, 'f1', SHOP);
  ok('books OFF → afterChit does nothing, queues nothing', off && off.off === true && X.T.outbox.length === n0);

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });

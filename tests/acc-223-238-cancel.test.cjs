/**
 * tests/acc-223-238-cancel.test.cjs — ACC-223 + ACC-238: A CANCELLED OWN SALE LEAVES THE BOOKS, EXACTLY ONCE, THROUGH ONE PATH.
 *
 *   ACC-223 (post side): classify opens with ONE gate — my copy cancelled / rejected → { none, done, "Cancelled — not posted" } for every purpose (counter bill,
 *     credit note, expense, income, payment received), not only a bill I RECEIVED. A summary chit is never refused by it; a received bill keeps buyerGate's words.
 *   ACC-238 (reverse side): moveStatus → cancelLegs → books-hooks.takeBackCancelled for EVERY cancel of MY copy (sender, a recipient, a counter sale to self), keyed by the
 *     entity. The reversal is the ONE that postChit already used for a rejected bill (takeBackRefused → reverseIfPosted); a lost race (23505 on reverse:<entry>) is a
 *     duplicate and never rolls the cancel back.
 *
 * Every figure is hand-computed, for an IN shop (credit bill ₹118 = 100 + 18 GST: 9 CGST + 9 SGST) and an AU shop (A$110 = 100 + 10 GST), minor units, on the in-memory
 * twin (tests/support/books-harness) — offline. The real-Postgres side (the unique index, the SQL of cancelledStillPosted) is the integration job's.
 * Run: node tests/acc-223-238-cancel.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const SHOPS = { IN: '11111111-1111-4111-8111-111111111111', AU: 'aaaaaaaa-2222-4111-8111-111111111111' };
const CUST = '22222222-2222-4222-8222-222222222222', SUPP = '33333333-3333-4333-8333-333333333333', OTHER = '44444444-4444-4444-8444-444444444444';
const DAY = '2026-10-15';
const AT = DAY + 'T05:00:00Z';

/* the figures, by hand. IN: 18% intra-state = 9 + 9. AU: GST 10%, one head. */
const COUNTRY = {
  IN: {
    cur: 'INR', setting: { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' }, fyMonth: 4, octPeriod: 7, novPeriod: 8,
    bill: { total: 11800, sales: 10000, tax: [['output_cgst', 900], ['output_sgst', 900]], invoice: { currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: 100, CgstAmt: 9, SgstAmt: 9, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 118 } }, major: 118 },
    note: { total: 5900, invoice: { currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: 50, CgstAmt: 4.5, SgstAmt: 4.5, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 59 } }, major: 59 },
    expense: 23600, expenseMajor: 236
  },
  AU: {
    cur: 'AUD', setting: { enabled: true, walkin_grain: 'day', country: 'AU', functional_currency: 'AUD', fy_start_month: 7 }, fyMonth: 7, octPeriod: 4, novPeriod: 5,
    bill: { total: 11000, sales: 10000, tax: [['gst_collected', 1000]], invoice: { currency: 'AUD', _cb: { scheme: 'GST' }, ItemList: [{ GstRt: 10, AssAmt: 100, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, TaxAmt: 10, CesAmt: 0 }], ValDtls: { TotInvVal: 110 } }, major: 110 },
    note: { total: 5500, invoice: { currency: 'AUD', _cb: { scheme: 'GST' }, ItemList: [{ GstRt: 10, AssAmt: 50, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, TaxAmt: 5, CesAmt: 0 }], ValDtls: { TotInvVal: 55 } }, major: 55 },
    expense: 22000, expenseMajor: 220
  }
};

(async () => {
  console.log('\n══ ACC-223 + ACC-238 · a cancelled own sale leaves the books, once, through one path ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  /* the one chit_header read a credit note makes (the bill it is against): the twin has no chit table, so it answers no row */
  const q0 = X.db.query.bind(X.db);
  X.db.query = async (sql, p) => (/SELECT chit_id FROM chit_header WHERE entity_id = [$]1 AND sender_entity_id/.test(sql) ? { rows: [], rowCount: 0 } : q0(sql, p));
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  const wasCopyOf = TC.copyOf, wasEntryFor = TC.entryFor;
  const world = { copy: null, entry: null };
  TC.copyOf = async () => world.copy; TC.entryFor = async () => world.entry;

  const netByRole = (shop) => {
    const net = {};
    for (const e of X.T.entries.filter((x) => x.entity_id === shop))
      for (const l of X.T.lines.filter((x) => x.entry_id === e.entry_id)) {
        const a = X.T.accounts.find((x) => x.account_id === l.account_id); const k = a ? a.role : '?';
        net[k] = (net[k] || 0) + Number(l.dr_minor) - Number(l.cr_minor);
      }
    return net;
  };
  const allZero = (net) => Object.keys(net).every((k) => net[k] === 0);
  const nonZero = (net) => JSON.stringify(Object.entries(net).filter((x) => x[1] !== 0).sort());   /* an account an entry never touched may be absent, not 0 */
  const entriesOf = (shop, id) => X.T.entries.filter((e) => e.entity_id === shop && e.source_ref && e.source_ref.indexOf('chit:' + id) === 0);
  const reversalsOf = (shop, entry) => X.T.entries.filter((e) => e.entity_id === shop && e.reverses_entry_id === entry.entry_id);
  const rowsOf = (shop, id) => X.T.outbox.filter((o) => o.entity_id === shop && o.source_chit_id === id);
  const linesOf = (e) => X.T.lines.filter((l) => l.entry_id === e.entry_id).map((l) => ({ role: (X.T.accounts.find((a) => a.account_id === l.account_id) || {}).role, dr: Number(l.dr_minor), cr: Number(l.cr_minor) }));

  /* the sale and its reversal(s) together, by account role: 'every account 0' when they cancel exactly */
  const chitNet = (sale) => { const net = {}; for (const e of [sale].concat(reversalsOf(sale.entity_id, sale))) for (const l of linesOf(e)) net[l.role] = (net[l.role] || 0) + l.dr - l.cr; return allZero(net) ? 'every account 0' : JSON.stringify(net); };
  const setup = async (cc) => {
    const C = COUNTRY[cc], shop = SHOPS[cc];
    X.T.identities.push({ identity_id: shop, gstn: cc === 'AU' ? '51824753556' : '33ABCDE1234F1Z5', display_name: cc + ' shop', country: cc, policy_flags: { gst_registration: 'regular' } });
    X.T.parties.push({ owner: shop, party_id: CUST, party_no: 'P-00001', name: 'Ravi', customer: true, credit_days: 10 }, { owner: shop, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true, credit_days: 15 });
    await X.store.saveSetting(X.db, shop, C.setting);
    await X.B.enable(X.db, shop, { by: shop, today: DAY }); K.forget(shop);
    return { C, shop };
  };
  /* my copy of a credit counter bill to Ravi (named customer, all on credit) */
  const creditBill = (C, id, status) => ({ chit_id: id, purpose: 'order', currency_code: C.cur, created_at: AT, current_status: status, sender_entity_id: null,
    business_json: { bill_no: 'C1-' + id, till: { id: 'C1' }, billed_at: AT, customer: { name: 'Ravi', party_id: CUST }, payment: { parts: [{ how: 'On credit', amount: C.bill.major }] } } });
  const use = (copy, entry) => { world.copy = copy; world.entry = entry; };

  for (const cc of ['IN', 'AU']) {
    console.log('\n— ' + cc + ' —');
    const { C, shop } = await setup(cc);
    const sellEntry = { sells: true, invoice: C.bill.invoice };

    /* ── T1 · cancelled BEFORE its post ran: the first post parked, then cancel, then retry + afterChit ── */
    use(creditBill(C, 't1', 'delivered'), sellEntry);
    await K.park(shop, { job: 'chit', chit_id: 't1' }, 'The books were busy — it posts on the next try', 't1', 'chit:t1');
    use(creditBill(C, 't1', 'cancelled'), sellEntry);
    const t1a = await K.postChit(shop, 't1', {});
    const t1b = await K.retryOutbox(shop, 10);
    const t1c = await K.postChit(shop, 't1', {});
    eq(cc + ' T1 · cancelled before it posted: 0 entries (it would have been Dr Debtors ' + C.bill.total + ' / Cr Sales ' + C.bill.sales + ' / Cr tax ' + (C.bill.total - C.bill.sales) + '), said "Cancelled — not posted"',
      [entriesOf(shop, 't1').length, t1a.none, t1a.why, t1c.none], [0, true, 'Cancelled — not posted', true]);
    ok(cc + ' T1 · …and the parked row is closed with that sentence, by the retry too (nothing waiting)', rowsOf(shop, 't1').every((o) => o.done_at) && rowsOf(shop, 't1').some((o) => o.why === 'Cancelled — not posted') && !t1b.posted, JSON.stringify(rowsOf(shop, 't1')));

    /* ── T2 · POSTED, then cancelled: the sale and its reversal net to nothing in every account ── */
    use(creditBill(C, 't2', 'delivered'), sellEntry);
    const p2 = await K.postChit(shop, 't2', {});
    const e2 = entriesOf(shop, 't2')[0];
    const before = linesOf(e2);
    const want = [{ role: 'debtors', dr: C.bill.total, cr: 0 }, { role: 'sales', dr: 0, cr: C.bill.sales }].concat(C.bill.tax.map(([role, amount]) => ({ role, dr: 0, cr: amount })));
    eq(cc + ' T2 · the sale posted as hand-computed: Dr Debtors ' + C.bill.total + ', Cr Sales ' + C.bill.sales + ', Cr ' + C.bill.tax.map((x) => x[0] + ' ' + x[1]).join(' + '), [p2.ok, before], [true, want]);
    use(creditBill(C, 't2', 'cancelled'), sellEntry);
    const said = await K.takeBackCancelled(shop, 't2', 'u1');
    const r2 = reversalsOf(shop, e2);
    eq(cc + ' T2 · cancel at the status door: one reversal, source reverse:<entry>, dated in the sale\'s month, said on `books` (reverses = the sale\'s number)',
      [r2.length, r2[0] && r2[0].source_ref, said.ok, said.reverses, said.entry_no === (r2[0] && r2[0].entry_no), said.moved, String(said.posting_date)], [1, 'reverse:' + e2.entry_id, true, e2.entry_no, true, false, DAY]);
    ok(cc + ' T2 · …Debtors, Sales and every tax account net to 0 (Σ by account = 0)', allZero(netByRole(shop)) && netByRole(shop).debtors === 0, JSON.stringify(netByRole(shop)));
    const again = await K.takeBackCancelled(shop, 't2', 'u1');
    const pc = await K.postChit(shop, 't2', {});
    eq(cc + ' T2 · a second cancel answer, and the post path again: still 1 reversal, nothing new', [again.none || again.duplicate, pc.none, reversalsOf(shop, e2).length, entriesOf(shop, 't2').length], [true, true, 1, 1]);

    /* ── T3 · a counter SELF-sale keeps ONE copy (received): posted, cancelled — the same books call by the entity, not through a sent copy ── */
    use(Object.assign(creditBill(C, 't3', 'accepted'), { direction: 'received', sender_entity_id: shop }), sellEntry);
    await K.postChit(shop, 't3', {});
    const e3 = entriesOf(shop, 't3')[0];
    use(Object.assign(creditBill(C, 't3', 'cancelled'), { direction: 'received', sender_entity_id: shop }), sellEntry);
    const s3 = await K.takeBackCancelled(shop, 't3', 'u1');
    eq(cc + ' T3 · self-sale cancelled: reversed once, `books` carries the reversal', [!!e3, s3.ok, s3.reverses === e3.entry_no, reversalsOf(shop, e3).length], [true, true, true, 1]);

    /* ── T4 · a credit note: cancelled before post → 0 entries; posted then cancelled → restored ── */
    const note = (id, status) => ({ chit_id: id, purpose: 'credit_note', currency_code: C.cur, created_at: AT, current_status: status, business_json: { till: { id: 'C1' }, bill_no: 'CN-' + id, against: 'C1-t2', billed_at: AT, customer: { name: 'Ravi', party_id: CUST }, refund: { parts: [{ how: 'Cash', amount: C.note.major }] } } });
    use(note('n1', 'cancelled'), { sells: true, invoice: C.note.invoice });
    const n1 = await K.postChit(shop, 'n1', {});
    eq(cc + ' T4 · credit note ' + C.note.major + ' cancelled before post → 0 entries, said', [entriesOf(shop, 'n1').length, n1.none, n1.why], [0, true, 'Cancelled — not posted']);
    const netBeforeNote = nonZero(netByRole(shop));
    use(note('n2', 'pending'), { sells: true, invoice: C.note.invoice });
    await K.postChit(shop, 'n2', {});
    const en2 = entriesOf(shop, 'n2')[0];
    ok(cc + ' T4 · posted: the return entry is ' + C.note.total + ' (hand: ' + C.note.major + ' = 50 + tax)', !!en2 && Number(en2.total_minor) === C.note.total && nonZero(netByRole(shop)) !== netBeforeNote, JSON.stringify(en2));
    use(note('n2', 'cancelled'), { sells: true, invoice: C.note.invoice });
    const sn2 = await K.takeBackCancelled(shop, 'n2', 'u1');
    eq(cc + ' T4 · cancelled after: reversed once, every account back to where it was', [sn2.ok, reversalsOf(shop, en2).length, nonZero(netByRole(shop))], [true, 1, netBeforeNote]);

    /* ── T5 · an expense (the chit carries no GST split: the whole amount is the expense, paid in cash). KNOWN GAP ACC-230: this asserts today's gross posting and must change when the GST split lands ── */
    const expense = (id, status) => ({ chit_id: id, purpose: 'expense', created_at: AT, current_status: status, business_json: { till: { id: 'C1' }, expense: { what: 'repairs', mode: 'Cash', amount: C.expenseMajor, class: 'sundry_expense' } } });
    use(expense('x1', 'cancelled'), {});
    const x1 = await K.postChit(shop, 'x1', {});
    eq(cc + ' T5 · expense ' + C.expenseMajor + ' cancelled before post → 0 entries', [entriesOf(shop, 'x1').length, x1.none], [0, true]);
    const netBeforeX = nonZero(netByRole(shop));
    use(expense('x2', 'pending'), {});
    await K.postChit(shop, 'x2', {});
    const ex2 = entriesOf(shop, 'x2')[0];
    eq(cc + ' T5 · posted: Dr Sundry expense ' + C.expense + ' / Cr Cash ' + C.expense, ex2 && linesOf(ex2).map((l) => l.dr || -l.cr).sort((a, b) => a - b), [-C.expense, C.expense]);
    use(expense('x2', 'cancelled'), {});
    const sx2 = await K.takeBackCancelled(shop, 'x2', 'u1');
    eq(cc + ' T5 · cancelled after: every account nets back (Dr and Cr ' + C.expense + ' reversed)', [sx2.ok, nonZero(netByRole(shop))], [true, netBeforeX]);

    /* ── income and a payment received, cancelled before post: the same gate (every purpose) ── */
    use({ chit_id: 'i1', purpose: 'income', created_at: AT, current_status: 'cancelled', business_json: { income: { what: 'scrap', mode: 'UPI', amount: 250, class: 'scrap_sales' } } }, {});
    {
      const i1 = await K.postChit(shop, 'i1', {});
      use({ chit_id: 'r1', purpose: 'general', created_at: AT, current_status: 'cancelled', business_json: { kind: 'payment_received', payment_received: { no: 'R/C1/0001', at: AT, party: { identity_id: CUST }, amount: 100, currency: C.cur, mode: 'Cash' } } }, {});
      const r1 = await K.postChit(shop, 'r1', {});
      eq(cc + ' income · money received: cancelled before post → nothing posted, nothing recorded', [i1.none, r1.none, entriesOf(shop, 'i1').length, X.T.payments.filter((p) => p.client_ref === 'chit:r1').length], [true, true, 0, 0]);
    }

    /* ── (v) gate regressions: a summary chit is not refused; a received bill keeps buyerGate's words; a rejected own copy says Rejected ── */
    const sum = K.classify({ chit: { chit_id: 'sm', purpose: 'general', current_status: 'cancelled', business_json: { summary: { period: 'day', key: 'day-' + DAY, till: { id: 'C2' } } } }, entry: {}, setting: C.setting, status: 'cancelled' });
    eq(cc + ' (v) a summary chit with a cancelled status is NOT refused by the gate: still its walk-in day', [sum.kind, sum.done, sum.day], ['day', undefined, DAY]);
    const rcvd = (st) => K.classify({ chit: { chit_id: 'rb', purpose: 'invoice', sender_entity_id: SUPP, business_json: { invoice_no: 'KT/1' } }, entry: { sells: false, seller: { entity_id: SUPP, LglNm: 'Kumar Traders' }, me: { entity_id: shop }, invoice: C.bill.invoice }, setting: C.setting, status: st });
    eq(cc + ' (v) a received bill keeps buyerGate\'s words: Rejected / Cancelled — not posted; delivered still waits', [rcvd('rejected').why, rcvd('cancelled').why, rcvd('delivered').kind], ['Rejected — not posted', 'Cancelled — not posted', 'queue']);
    eq(cc + ' (v) my own copy rejected → "Rejected — not posted"', K.classify({ chit: creditBill(C, 'rj', 'rejected'), entry: sellEntry, setting: C.setting, status: 'rejected' }).why, 'Rejected — not posted');
    eq(cc + ' (v) …and the same bill NOT cancelled still posts (the gate is only the status)', K.classify({ chit: creditBill(C, 'ok', 'delivered'), entry: sellEntry, setting: C.setting, status: 'delivered' }).event.type, 'sale_bill');

    /* ── (i) a bill PART-PAID then cancelled, and one PAID IN FULL: the payment is untouched by design, asserted ── */
    for (const [id, paidMinor] of [['pp', 5000], ['fp', C.bill.total]]) {
      use(creditBill(C, id, 'delivered'), sellEntry);
      await K.postChit(shop, id, {});
      const sale = entriesOf(shop, id)[0];
      const pay = await X.B.recordPayment(X.db, shop, { party_id: CUST, direction: 'in', amount_minor: paidMinor, currency: C.cur, mode: 'cash', received_at: '2026-10-16', client_ref: 'pay-' + id, by: shop });
      const payRows = X.T.payments.length, payEntries = X.T.entries.filter((e) => e.source_ref && e.source_ref.indexOf('pay:') === 0).length;
      const debtBefore = netByRole(shop).debtors;
      use(creditBill(C, id, 'cancelled'), sellEntry);
      const said2 = await K.takeBackCancelled(shop, id, 'u1');
      const sameTotal = reversalsOf(shop, sale).length === 1;
      eq(cc + ' (i) ' + (id === 'pp' ? 'part-paid (' + paidMinor + ')' : 'fully paid (' + paidMinor + ')') + ' bill cancelled: the SALE is reversed once; the payment row and its entry are untouched (no reversal of them); Debtors ends at -' + paidMinor + ' (their money, not ours to undo here)',
        [pay.payment ? !!pay.payment : !!pay.ok, said2.ok, sameTotal, X.T.payments.length === payRows, X.T.entries.filter((e) => e.source_ref && e.source_ref.indexOf('pay:') === 0 && reversalsOf(shop, e).length === 0).length === payEntries, netByRole(shop).debtors - debtBefore],
        [true, true, true, true, true, -C.bill.total]);
    }

    /* ── (ii) a credit note against a cancelled bill: its own chit, its own entry; the bill's reversal does not touch it ── */
    use(creditBill(C, 'cb', 'delivered'), sellEntry); await K.postChit(shop, 'cb', {});
    use(Object.assign(note('cn3', 'pending'), { business_json: Object.assign(note('cn3', 'pending').business_json, { against: 'C1-cb' }) }), { sells: true, invoice: C.note.invoice });
    await K.postChit(shop, 'cn3', {});
    const cnEntry = entriesOf(shop, 'cn3')[0];
    use(creditBill(C, 'cb', 'cancelled'), sellEntry);
    await K.takeBackCancelled(shop, 'cb', 'u1');
    eq(cc + ' (ii) a credit note against a bill that is then cancelled: the note\'s entry stands (not reversed), the bill is reversed once, Debtors net is the note\'s ' + C.note.total + ' in the customer\'s favour of the cancelled bill',
      [reversalsOf(shop, cnEntry).length, reversalsOf(shop, entriesOf(shop, 'cb')[0]).length], [0, 1]);

    /* ── (iv) re-accept after cancel: chit:<id> is once-ever (RAIL-173) — a received bill accepted, cancelled, accepted again ── */
    const rec = (st) => ({ chit_id: 'ra', purpose: 'invoice', created_at: AT, current_status: st, sender_entity_id: SUPP, business_json: { invoice_no: 'KT/9' } });
    const buyEntry = { sells: false, seller: { entity_id: SUPP, LglNm: 'Kumar Traders' }, me: { entity_id: shop }, invoice: C.bill.invoice };
    use(rec('accepted'), buyEntry); const a1 = await K.postChit(shop, 'ra', {});
    const pe = entriesOf(shop, 'ra')[0];
    use(rec('cancelled'), buyEntry); await K.postChit(shop, 'ra', {});
    const afterCancel = netByRole(shop);
    use(rec('accepted'), buyEntry); const a2 = await K.postChit(shop, 'ra', {});
    const rail = require(path.join(H.API, 'lib', 'rail-actions')).move({ held: true, received: 'cancelled' }, { level: 'editor', holder: null }, 'accepted');
    eq(cc + ' (iv) accept → cancel → accept again: ONE purchase entry ever (chit:<id> once-ever), ONE reversal; the 2nd accept is a duplicate, books unchanged',
      [!!a1.ok, !!pe, reversalsOf(shop, pe).length, entriesOf(shop, 'ra').length, a2.duplicate === true, JSON.stringify(netByRole(shop)) === JSON.stringify(afterCancel)], [true, true, 1, 1, true, true]);
    ok(cc + ' (iv) the forward walk, asserted from the rail engine: cancelled → accepted is ' + (rail.ok ? 'allowed' : 'refused (' + rail.why + ')'), typeof rail.ok === 'boolean', JSON.stringify(rail));
  }

  /* ── T6 · THE RACE: the cancel door and the post path both reverse at the same time (4 ms db latency) — one reversal, the loser answers duplicate, nobody throws ── */
  console.log('\n— T6 · the race (4 ms latency on the two reads) —');
  {
    const { C, shop } = { C: COUNTRY.IN, shop: SHOPS.IN };
    const sellEntry = { sells: true, invoice: C.bill.invoice };
    const mk = (st) => ({ chit_id: 'race', purpose: 'order', currency_code: C.cur, created_at: AT, current_status: st, business_json: { bill_no: 'C1-race', till: { id: 'C1' }, billed_at: AT, customer: { name: 'Ravi', party_id: CUST }, payment: { parts: [{ how: 'On credit', amount: C.bill.major }] } } });
    use(mk('delivered'), sellEntry); await K.postChit(shop, 'race', {});
    const sale = entriesOf(shop, 'race')[0];
    use(mk('cancelled'), sellEntry);
    const wasUnrev = X.store.unreversedForChit, wasBySrc = X.store.entryBySource, wasInsert = X.store.insertEntry;
    X.store.unreversedForChit = async (...a) => { const got = await wasUnrev(...a); await sleep(4); return got; };
    X.store.entryBySource = async (...a) => { await sleep(4); return wasBySrc(...a); };
    X.store.insertEntry = async (...a) => { await sleep(4); return wasInsert(...a); };      /* both pass the read-then-insert check before either inserts: the true race */
    let threw = null, door, hook, twin;
    try { [door, hook, twin] = await Promise.all([K.takeBackCancelled(shop, 'race', 'u1'), K.postChit(shop, 'race', {}), K.takeBackCancelled(shop, 'race', 'u2')]); } catch (e) { threw = e; }
    X.store.unreversedForChit = wasUnrev; X.store.entryBySource = wasBySrc; X.store.insertEntry = wasInsert;
    ok('T6 · neither side threw (a lost race cannot roll the cancel back)', !threw, String(threw && threw.stack));
    eq('T6 · exactly ONE reversal of the sale', reversalsOf(shop, sale).length, 1);
    ok('T6 · the winner reversed, the loser answered duplicate (not an error)', [door, hook, twin].filter((x) => x && x.ok === true && x.reverses && !x.already).length === 1 && [door, hook, twin].some((x) => x && (x.duplicate === true || x.none === true)), JSON.stringify([door, hook, twin]));
    const direct = await Promise.all([K.reverseIfPosted(shop, 'race', 'again', 'u1'), K.reverseIfPosted(shop, 'race', 'again', 'u1')]);
    eq('T6 · and a second pair of calls reverse nothing more', [direct, reversalsOf(shop, sale).length], [[0, 0], 1]);
    /* the 23505 catch itself: a reversal that throws it is a duplicate, said on the object */
    const wasRev = X.B.reverseEntry;
    X.B.reverseEntry = async () => { throw Object.assign(new Error('duplicate key value violates unique constraint "journal_entry_src_uq"'), { code: '23505' }); };
    X.store.unreversedForChit = async () => ['E-any'];
    const said = {}; let n = -1, err = null;
    try { n = await K.reverseIfPosted(shop, 'race', 'x', 'u1', said); } catch (e) { err = e; }
    X.B.reverseEntry = wasRev; X.store.unreversedForChit = wasUnrev;
    eq('T6 · 23505 on reverse:<entry> → counted as a duplicate, never thrown', [err, n, said.duplicate], [null, 0, true]);
    X.B.reverseEntry = async () => { throw Object.assign(new Error('boom'), { code: 'XX000' }); }; X.store.unreversedForChit = async () => ['E-any'];
    let other = null; try { await K.reverseIfPosted(shop, 'race', 'x', 'u1', {}); } catch (e) { other = e; }
    X.B.reverseEntry = wasRev; X.store.unreversedForChit = wasUnrev;
    ok('T6 · any OTHER database error still surfaces (only the unique-index loss is a duplicate)', !!other && other.code === 'XX000');

    /* ── F1 (SIT 6 Nov): the status door's books call lost to the afterChit hook, which reversed first → its 200 `books` must still SAY that reversal, not a bare duplicate ── */
    const mf = (st) => Object.assign(mk(st), { chit_id: 'f1' });
    use(mf('delivered'), sellEntry); await K.postChit(shop, 'f1', {});
    const sale1 = entriesOf(shop, 'f1')[0];
    use(mf('cancelled'), sellEntry);
    await K.postChit(shop, 'f1', {});                                  /* the hook: reverses first */
    X.store.unreversedForChit = async () => [sale1.entry_id];          /* the door had read "not reversed yet" a moment before */
    const first = await K.takeBackCancelled(shop, 'f1', 'u1');
    const second = await K.takeBackCancelled(shop, 'f1', 'u1');
    X.store.unreversedForChit = wasUnrev;
    const rev1 = reversalsOf(shop, sale1);
    eq('F1 · the first status cancel answers the hook\'s reversal: ok, already, entry_no, posting_date, reverses, moved, words', [rev1.length, first.ok, first.already, first.duplicate, first.entry_no === rev1[0].entry_no, String(first.posting_date), first.reverses === sale1.entry_no, first.moved, typeof first.words], [1, true, true, true, true, DAY, true, false, 'string']);
    /* …and the real order, no stubbed read: the hook fully done BEFORE the door reads → the door finds nothing unreversed, yet says the reversal, never "none" */
    const mg = (st) => Object.assign(mk(st), { chit_id: 'f2' });
    use(mg('delivered'), sellEntry); await K.postChit(shop, 'f2', {});
    const sale2 = entriesOf(shop, 'f2')[0];
    use(mg('cancelled'), sellEntry);
    await K.postChit(shop, 'f2', {});
    const late = await K.takeBackCancelled(shop, 'f2', 'u1');
    const rev2 = reversalsOf(shop, sale2);
    eq('F1 · hook first, door second (real order): answers the reversal, already, not none', [rev2.length, late.none, late.ok, late.already, late.entry_no === rev2[0].entry_no, late.reverses === sale2.entry_no, String(late.posting_date)], [1, undefined, true, true, true, true, DAY]);
    const never = await K.takeBackCancelled(shop, 'never-posted', 'u1');
    eq('F1 · a chit that never posted still answers none', [never.none, never.already], [true, undefined]);
    eq('F1 · a second cancel answers duplicate with the same entry_no; still 1 reversal', [second.duplicate, second.entry_no === rev1[0].entry_no, reversalsOf(shop, sale1).length], [true, true, 1]);
  }

  /* ── T7 · a LOCKED month: the reversal takes the engine's date (original month if open, else the first open date), said; every later month locked → refused in words, cancel stands ── */
  console.log('\n— T7 · locked months —');
  for (const cc of ['IN', 'AU']) {
    const C = COUNTRY[cc], shop = SHOPS[cc], sellEntry = { sells: true, invoice: C.bill.invoice };
    const fy = (cc === 'IN' ? '2026-27' : '2026-27');
    const lock = (p, status) => X.B.setPeriod(X.db, shop, fy, p, status, shop, 'filed');
    const bill = (id, st) => creditBill(C, id, st);
    const post = async (id) => { use(bill(id, 'delivered'), sellEntry); await K.postChit(shop, id, {}); return entriesOf(shop, id)[0]; };
    const e7a = await post('l1'), e7b = await post('l2'), e7c = await post('l3');
    await lock(C.octPeriod, 'locked');
    use(bill('l1', 'cancelled'), sellEntry);
    const a = await K.takeBackCancelled(shop, 'l1', 'u1');
    eq(cc + ' T7 · bill of 15 Oct, Oct locked, Nov open → reversal on 1 Nov, moved, the original stays in Oct', [a.ok, String(a.posting_date), a.moved, String(e7a.posting_date).slice(0, 10)], [true, '2026-11-01', true, DAY]);
    await lock(C.novPeriod, 'locked');
    use(bill('l2', 'cancelled'), sellEntry);
    const b = await K.takeBackCancelled(shop, 'l2', 'u1');
    eq(cc + ' T7 · Oct AND Nov locked, Dec open → reversal on 1 Dec', [b.ok, String(b.posting_date), b.moved], [true, '2026-12-01', true]);
    for (let p = 1; p <= 12; p++) if (p !== C.octPeriod && p !== C.novPeriod) await lock(p, 'locked').catch(() => null);
    use(bill('l3', 'cancelled'), sellEntry);
    const c = await K.takeBackCancelled(shop, 'l3', 'u1');
    eq(cc + ' T7 · EVERY month of the year locked → the engine rule: the first open date after the lock, in the next year (' + (cc === 'IN' ? '1 Apr 2027' : '1 Jul 2027') + '), moved; the sale stays in its own month',
      [c.ok, String(c.posting_date), c.moved, reversalsOf(shop, e7c).length], [true, cc === 'IN' ? '2027-04-01' : '2027-07-01', true, 1]);
    /* …and when the books REFUSE (a closed year, a missing ledger), the answer is words, the cancel stands, the sale stays — nothing half-written */
    const e7d = await post('l4');
    const wasRev = X.B.reverseEntry;
    X.B.reverseEntry = async () => { throw Object.assign(new Error('That year is closed.'), { code: 'YEAR_CLOSED', refused: true }); };
    use(bill('l4', 'cancelled'), sellEntry);
    const d = await K.takeBackCancelled(shop, 'l4', 'u1');
    X.B.reverseEntry = wasRev;
    ok(cc + ' T7 · a refusal by the books → { refused } in words (what happens next is said), no reversal, no throw', !!d.refused && /could not be reversed yet/.test(d.refused) && reversalsOf(shop, e7d).length === 0, JSON.stringify(d));
    const e7e = entriesOf(shop, 'l4')[0];
    const later = await K.postChit(shop, 'l4', {});
    ok(cc + ' T7 · …and the post path / nightly (postChit) takes it back once the books allow it', later.none === true && reversalsOf(shop, e7e).length === 1, JSON.stringify(later));
  }

  /* ── T8 · the sweep: unpostedChits leaves the cancelled alone (SQL, proved by the integration job); the nightly hands a cancelled-still-posted chit to postChit, which reverses it once ── */
  console.log('\n— T8 · the sweep —');
  {
    const shop = SHOPS.IN, C = COUNTRY.IN, sellEntry = { sells: true, invoice: C.bill.invoice };
    const mk = (st) => creditBill(C, 'sw', st);
    use(mk('delivered'), sellEntry); await K.postChit(shop, 'sw', {});
    const sale = entriesOf(shop, 'sw')[0];
    use(mk('cancelled'), sellEntry);                                     /* a half-done cancel: the status moved, the books call was refused / never ran */
    const ids = [{ chit_id: 'sw' }];                                     /* what unpostedChits hands the sweep: the stuck chit */
    const swept = [];
    for (let run = 0; run < 2; run++) for (const row of ids) swept.push(await K.postChit(shop, row.chit_id, { setting: C.setting }));
    eq('T8 · the cancelled-still-posted chit, handed to postChit twice by the sweep: reversed ONCE, then none', [reversalsOf(shop, sale).length, swept.map((x) => x.why)], [1, ['Cancelled — its posting was reversed', 'Cancelled — not posted']]);
    const nightly = require('fs').readFileSync(path.join(H.API, 'lib', 'books-nightly.js'), 'utf8');
    ok('T8 · books-nightly is unchanged: it hands every unpostedChits row to postChit, no reversal of its own', nightly.includes('S.unpostedChits(h, entity, from, to, SWEEP_LIMIT)') && nightly.includes('H.postChit(entity, c.chit_id') && !/chitWithdrawn|reverseEntry|reverseIfPosted/.test(nightly));
    const sql = require('fs').readFileSync(path.join(H.API, 'lib', 'books-store.js'), 'utf8');
    const unposted = sql.slice(sql.indexOf('async function unpostedInWindow('), sql.indexOf('async function cancelledStillPosted('));
    ok('T8 · unpostedChits ALSO returns the cancelled-still-posted (cancelledStillPosted), bounded by the same limit', sql.includes('found.concat(await cancelledStillPosted(db, e, (limit || 200) - found.length))'));
    ok('T8 · unpostedInWindow SQL leaves out a cancelled / rejected copy', /NOT EXISTS \(SELECT 1 FROM chit_status cs WHERE cs\.chit_id = h\.chit_id AND cs\.entity_id = h\.entity_id AND cs\.current_status IN \('cancelled', 'rejected'\)\)/.test(unposted));
  }

  /* ── the REAL status door (lib/chit-move moveStatus → cancelLegs): sender · a recipient · a self-sale, each keyed by the entity; the 200 carries `books` for all three ── */
  console.log('\n— the status door: moveStatus on all three shapes —');
  {
    const one = (s) => String(s).replace(/\s+/g, ' ').trim();
    let STATUS = [], SENDER = null;
    const rowsFor = (sql, p) => {
      const s = one(sql); p = p || []; const dir = (s.match(/direction = '(received|sent)'/) || [])[1];
      const mine = STATUS.filter((r) => r.chit_id === p[0] && r.entity_id === p[1] && (!dir || r.direction === dir));
      if (/^SELECT current_status FROM chit_status/.test(s)) return mine.map((r) => ({ current_status: r.current_status }));
      if (/^UPDATE chit_status SET current_status = \$1/.test(s)) { const hit = STATUS.filter((r) => r.chit_id === p[1] && r.entity_id === p[2] && r.direction === dir && r.current_status === p[3]); hit.forEach((r) => { r.current_status = p[0]; }); return hit.map((r) => ({ chit_id: r.chit_id })); }
      if (/SELECT sender_entity_id, purpose, business_json, all_recipients FROM chit_header/.test(s)) return [{ sender_entity_id: SENDER, purpose: 'order', business_json: {}, all_recipients: [] }];
      return null;
    };
    const q = async (sql, p) => { const rows = rowsFor(sql, p); if (rows) return { rows, rowCount: rows.length }; try { return await X.db.query(sql, p); } catch (e) { if (/ran real SQL/.test(e.message)) return { rows: [], rowCount: 0 }; throw e; } };
    const tx = { query: q };
    Object.assign(X.dbStub, { query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) }, withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx), readBatch: async () => ({}) });
    const sc = require(path.join(H.API, 'lib', 'schema')); sc.hasColumn = async () => false; sc.hasTable = async () => false;
    const { moveStatus } = require(path.join(H.API, 'lib', 'chit-move'));
    const viewer = { level: 'editor', holder: null }, by = { id: 'u1', name: 'Owner' };
    const origErr = console.error; console.error = () => {};
    for (const cc of ['IN', 'AU']) {
      const C = COUNTRY[cc], shop = SHOPS[cc], sellEntry = { sells: true, invoice: C.bill.invoice };
      const shapes = [
        ['sender (a sent copy and a received copy)', 'door-s-' + cc, shop, [['received', 'accepted'], ['sent', 'delivered']]],
        ['recipient (the sender is another shop)', 'door-r-' + cc, OTHER, [['received', 'accepted']]],
        ['counter sale to SELF (one received copy)', 'door-m-' + cc, shop, [['received', 'accepted']]]
      ];
      for (const [label, id, sender, copies] of shapes) {
        SENDER = sender; STATUS = copies.map(([direction, current_status]) => ({ chit_id: id, entity_id: shop, direction, current_status }));
        use(creditBill(C, id, 'accepted'), sellEntry); await K.postChit(shop, id, {});
        const sale = entriesOf(shop, id)[0];
        use(creditBill(C, id, 'cancelled'), sellEntry);
        const r = await moveStatus(shop, id, 'cancelled', by, 'changed my mind', viewer);
        await sleep(30);                                                           /* the move's own afterChit (setImmediate) runs beside the door: the race, for real */
        eq(cc + ' door · ' + label + ': 200, my copy cancelled, `books` on the answer, ONE reversal (the door and afterChit together), books net to 0',
          [r.code, STATUS.find((x) => x.direction === 'received').current_status, !!(r.body.books && r.body.books.ok && r.body.books.reverses === sale.entry_no), reversalsOf(shop, sale).length, chitNet(sale)],
          [200, 'cancelled', true, 1, 'every account 0']);
        const second = await moveStatus(shop, id, 'cancelled', by, 'again', viewer);
        eq(cc + ' door · ' + label + ': pressing cancel again is a noop 200, still one reversal', [second.code, second.noop === true, reversalsOf(shop, sale).length], [200, true, 1]);
      }
      /* a cancel of a bill that never posted answers { none } (books on, nothing to take back) */
      SENDER = OTHER; STATUS = [{ chit_id: 'door-n-' + cc, entity_id: shop, direction: 'received', current_status: 'accepted' }];
      use(creditBill(C, 'door-n-' + cc, 'cancelled'), sellEntry);
      const none = await moveStatus(shop, 'door-n-' + cc, 'cancelled', by, null, viewer);
      await sleep(30);
      eq(cc + ' door · a bill that never posted: `books` says { none }, no entry made', [none.body.books, entriesOf(shop, 'door-n-' + cc).length], [{ none: true }, 0]);
    }
    console.error = origErr;
  }

  /* ── one path: no second reversal beside takeBackRefused ── */
  {
    const fs = require('fs');
    const hooks = fs.readFileSync(path.join(H.API, 'lib', 'books-hooks.js'), 'utf8'), move = fs.readFileSync(path.join(H.API, 'lib', 'chit-move.js'), 'utf8');
    ok('ONE PATH · chit-move reaches the books only through takeBackCancelled (no chitWithdrawn*, no reverseEntry, no ref lookup of its own)', /takeBackCancelled\(entity_id, chit_id, by\.id\)/.test(move) && !/chitWithdrawn|reverseEntry|entryBySource|unreversedForChit/.test(move));
    ok('ONE PATH · takeBackCancelled reverses through takeBackRefused → reverseIfPosted (one lookup: unreversedForChit)', /takeBackRefused\(entity, chit_id, \{ current_status: 'cancelled' \}/.test(hooks) && (hooks.match(/unreversedForChit\(/g) || []).length === 1);
  }

  TC.copyOf = wasCopyOf; TC.entryFor = wasEntryFor;
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n\n' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

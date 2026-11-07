/**
 * tests/acc-224-period-of-record.test.cjs — ACC-224: THE RETURN AND THE BOOKS HOLD A BILL IN THE SAME MONTH (India GSTR-1 / GSTR-3B).
 *
 * OWNS      the proof that a bill dated in a LOCKED (filed) month and entered later — which the books move to the next open month (books.postingDateFor, by design)
 *           — is in the return of the month the books hold it in, NAMED there as a late invoice of the earlier month, and that each month's return equals the books' tax
 *           balances. The filed month's return is not changed by a late bill. (AU BAS / AE VAT201 read the balance rows by posting period, so they already agree — not here.)
 * CALLED BY scripts/guards.cjs · CI. No database: the books run in memory (tests/support/books-harness); the chit reads tax-copy makes are answered from a fixture
 *           that models its SQL window (the moment OR the books day, ACC-224). Needs the books engines; without them it SKIPs, said.
 * FLOW      sale 28 Sep → lock September → sale dated 10 Sep (moved to 1 Oct) + sale 5 Oct → tax-copy.ledgerFor Sep / Oct → tax-lines.gstr1 / gstr3b vs books-period.gstBalances
 * Run: node tests/acc-224-period-of-record.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0,
  fail = 0;
const ok = (name, cond, why) => {
  if (cond) {
    pass++;
    console.log('   ok   ' + name);
  } else {
    fail++;
    console.log('   FAIL ' + name + (why ? '\n          ' + why : ''));
  }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SHOP = '11111111-1111-4111-8111-111111111111',
  CUST = '22222222-2222-4222-8222-222222222222';
const IDS = {
  [SHOP]: { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', timezone: 'Asia/Kolkata', policy_flags: { price_includes_tax: 'no' } },
  [CUST]: { identity_id: CUST, gstn: '33BBBBB0000B1Z5', display_name: 'Chola Auto Care', country: 'IN', policy_flags: {} }
};
const S = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR', timezone: 'Asia/Kolkata' };
const uuid = (n) => 'c0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const minor = (rupees) => Math.round(rupees * 100);

(async () => {
  console.log('\n== ACC-224: ONE PERIOD OF RECORD ==\n');
  const X = H.load();
  if (!X.src.dir) {
    console.log('   SKIP: ' + X.src.why);
    return;
  }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const T = require(path.join(H.API, 'lib', 'tax'));
  const TL = require(path.join(H.API, 'lib', 'tax-lines'));
  const BP = require(path.join(H.API, 'lib', 'books-period'));

  const party = (id) => ({ Gstin: IDS[id].gstn, LglNm: IDS[id].display_name, State: '33', Pos: '33', RegType: 'regular' });
  const rows = [];
  const sale = (n, price, at, billedAt) =>
    rows.push({
      chit_id: uuid(n), purpose: 'invoice', role: 'Sender', currency_code: 'INR', summary_json: {}, line_items: [], created_at: at, sent_at: at, current_status: 'delivered',
      sender_entity_id: SHOP, all_recipients: [{ role: 'sender', entity_id: SHOP }, { role: 'receiver', entity_id: CUST }],
      business_json: Object.assign({ invoice: T.determine({ seller: party(SHOP), buyer: party(CUST), lines: [{ name: 'Brake pad', hsn: '9999', qty: 1, unit_price: price, rate: 18 }] }) }, billedAt ? { billed_at: billedAt } : {})
    });
  /* the books' own entry for a copy: the posting_date the books wrote */
  const bookedDay = (r) => {
    const days = X.T.entries
      .filter((j) => j.entity_id === SHOP && !j.reverses_entry_id && String(j.source_ref || '').indexOf('chit:' + r.chit_id) === 0 && !X.T.entries.some((v) => v.reverses_entry_id === j.entry_id))
      .map((j) => String(j.posting_date).slice(0, 10));
    return days.length ? days.sort().pop() : null;
  };
  const momentOf = (r) => Date.parse((r.business_json && r.business_json.billed_at) || r.sent_at || r.created_at);
  const memory = require('./support/books-memory.cjs');
  const ask = memory.fakeDb.query;
  memory.fakeDb.query = async (text, params) => {
    const sql = String(text);
    if (/FROM identities WHERE identity_id = ANY/.test(sql)) return { rows: params[0].map((id) => IDS[id]).filter(Boolean) };
    if (/FROM identities WHERE identity_id = \$1/.test(sql)) return { rows: [IDS[params[0]]].filter(Boolean) };
    if (/FROM chit_header h/.test(sql) && /h\.entity_id = \$1/.test(sql)) {
      const from = Date.parse(params[1]),
        to = Date.parse(params[2]),
        withDays = params.length > 4; /* the window's second arm: the day the books hold it in [params[3], params[4]) */
      const found = rows.filter((r) => r.role !== 'Draft' && bookedDay(r) && ((momentOf(r) >= from && momentOf(r) < to) || (withDays && bookedDay(r) >= params[3] && bookedDay(r) < params[4])));
      return { rows: found.map((r) => Object.assign({}, r, /books_posting_date/.test(sql) ? { books_posting_date: bookedDay(r), books_locked_starts: X.T.periods.filter((p) => p.status !== 'open').map((p) => String(p.start_date).slice(0, 10)) } : {})) };
    }
    return ask(text, params);
  };
  delete require.cache[require.resolve(path.join(H.API, 'lib', 'tax-copy'))];
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));

  await X.store.saveSetting(X.db, SHOP, { enabled: true });
  await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-04-01' });
  K.forget(SHOP);
  X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: IDS[CUST].display_name, customer: true, credit_days: 30 });
  const post = async (r) => {
    const k = K.classify({ chit: r, entry: await TC.entryFor(r, SHOP), setting: S, status: 'delivered' });
    if (k.kind !== 'post') throw new Error('did not classify as a post: ' + JSON.stringify(k));
    const out = await X.B.postEntry(X.db, SHOP, Object.assign({}, k.event, { source_chit_id: r.chit_id }));
    if (!out.ok) throw new Error('did not post: ' + JSON.stringify(out));
    return out;
  };

  /* ── 1. September's bill, then September is locked (the return is filed), then a late bill DATED September is entered, and an October bill ── */
  sale(1, 1000, '2026-09-28T05:00:00.000Z'); /* GST 90 + 90 */
  await post(rows[0]);
  await X.B.setPeriod(X.db, SHOP, '2026-27', 6, 'soft_locked', SHOP, 'GSTR-1 filed');
  sale(2, 500, '2026-10-03T05:00:00.000Z', '2026-09-10T05:00:00.000Z'); /* dated 10 Sep, entered 3 Oct: GST 45 + 45 */
  await post(rows[1]);
  sale(3, 1000, '2026-10-05T05:00:00.000Z'); /* an ordinary October bill: GST 90 + 90 */
  await post(rows[2]);
  eq('the books moved the late bill to 1 Oct (their rule, unchanged) and kept the open-month bill on its own day', [bookedDay(rows[1]), bookedDay(rows[2])], ['2026-10-01', '2026-10-05']);

  const pack = X.B.packOf(S);
  const sepBooks = await X.dbStub.withEntity(SHOP, (h) => BP.gstBalances(h, SHOP, '2026-09-30', null, pack));
  const octBooks = await X.dbStub.withEntity(SHOP, (h) => BP.gstBalances(h, SHOP, '2026-10-31', null, pack));
  const octMove = { cgst: octBooks.output.cgst - sepBooks.output.cgst, sgst: octBooks.output.sgst - sepBooks.output.sgst };
  const sep = await TC.ledgerFor(SHOP, '2026-09'),
    oct = await TC.ledgerFor(SHOP, '2026-10');
  const sep3b = TL.gstr3b(sep.ledger, sep.me, sep.bounds.period).sup_details.osup_det,
    oct3b = TL.gstr3b(oct.ledger, oct.me, oct.bounds.period).sup_details.osup_det;
  const octOpen = oct.ledger.rows.filter((r) => r.chit_id === rows[2].chit_id);

  /* ── 2. an open month's bill is unchanged ── */
  eq('a bill in an open month: in its own month, no prior-period note', [octOpen.length, octOpen[0] && octOpen[0].prior_period], [1, null]);
  eq('September (filed): the 28 Sep bill only, the late bill does not reopen it, nothing prior-period', [sep.ledger.rows.map((r) => r.chit_id.slice(-2)), sep.prior_period], [['01'], []]);

  /* ── 3. the late bill: in the return of the month the books hold it in, named ── */
  eq('October holds the late bill and the October bill', oct.ledger.rows.map((r) => r.chit_id.slice(-2)).sort(), ['02', '03']);
  eq(
    'the late bill keeps its own date (10 Sep) and is named a prior-period item',
    [oct.ledger.rows.find((r) => r.chit_id === rows[1].chit_id).day, oct.prior_period.map((p) => [p.chit_id.slice(-2), p.kind, p.invoice_month, p.booked_day, p.month])],
    ['2026-09-10', [['02', 'prior_period', '2026-09', '2026-10-01', '2026-10']]]
  );
  ok('...with words a shopkeeper can read', /Dated 2026-09-10 \(2026-09\) but entered after 2026-09 was closed/.test(oct.prior_period[0].words) && /late invoice of 2026-09/.test(oct.prior_period[0].words), oct.prior_period[0].words);
  const g1 = TL.gstr1(oct.ledger, oct.me, oct.bounds.period);
  eq('GSTR-1 for October carries both bills in its tables and names the late one in _cb.prior_period', [g1.ok === false ? g1.why : (g1.b2b || []).reduce((n, c) => n + c.inv.length, 0), g1._cb.prior_period.length], [2, 1]);
  eq('GSTR-3B for October names it too', TL.gstr3b(oct.ledger, oct.me, oct.bounds.period)._cb.prior_period.length, 1);

  /* the pre-ledger move has its own words (not "closed"): same shape, no locked month under the invoice's month */
  const early = TC.monthOfRecord({ chit_id: uuid(9), books_posting_date: '2026-04-01', books_locked_starts: [] }, '2026-03-15').prior;
  ok('a chit dated before the ledger began: its own words and cause, never "closed"', early && early.cause === 'before_ledger' && /dated before this ledger began/.test(early.words) && !/closed/.test(early.words), early && early.words);
  eq('the locked-month move says so', oct.prior_period[0].cause, 'month_closed');

  /* ── 4. the totals per month equal the books ── */
  eq('September: GSTR-3B output CGST/SGST = the books\' September balance', [minor(sep3b.camt), minor(sep3b.samt)], [sepBooks.output.cgst, sepBooks.output.sgst]);
  eq('October: GSTR-3B output CGST/SGST = the books\' October movement (late bill 45 + October bill 90)', [minor(oct3b.camt), minor(oct3b.samt), octMove.cgst, octMove.sgst], [13500, 13500, 13500, 13500]);

  console.log('\n' + (fail ? '  FAILED ' + fail : '  PASSED ' + pass) + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

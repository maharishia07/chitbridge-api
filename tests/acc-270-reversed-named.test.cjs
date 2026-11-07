/**
 * tests/acc-270-reversed-named.test.cjs — ACC-270: A BILL THE BOOKS NO LONGER HOLD IS NAMED IN THE RETURN, AND THE FILED MONTH DOES NOT CHANGE.
 *
 * OWNS      the proof that (1) a bill posted in September, September filed (locked), then reversed in October stays in the September return exactly as filed (the books AS AT its
 *           month's end) and is NAMED in October's return (_cb.reversed, with words) — not counted there, not silently gone; (2) a counter bill the books hold no entry for at all is NAMED
 *           (_cb.not_in_books); (3) a bill reversed inside its own month, a free bill and a cancelled bill are not named. Builds on ACC-224 (prior_period) and ACC-268 (dropped).
 * CALLED BY scripts/guards.cjs · CI. No database: the books run in memory (tests/support/books-harness); the chit read of tax-copy.copiesFor is answered from a fixture that models its SQL.
 * Run: node tests/acc-270-reversed-named.test.cjs
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
  console.log('\n== ACC-270: a reversed or unbooked bill is named; the filed month does not change ==\n');
  const X = H.load();
  if (!X.src.dir) {
    console.log('   SKIP: ' + X.src.why);
    return;
  }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const T = require(path.join(H.API, 'lib', 'tax'));
  const TL = require(path.join(H.API, 'lib', 'tax-lines'));

  const party = (id) => ({ Gstin: IDS[id].gstn, LglNm: IDS[id].display_name, State: '33', Pos: '33', RegType: 'regular' });
  const rows = [];
  const sale = (n, price, at, billedAt) =>
    rows.push({
      chit_id: uuid(n), purpose: 'invoice', role: 'Sender', currency_code: 'INR', summary_json: {}, line_items: [], created_at: at, sent_at: at, current_status: 'delivered',
      sender_entity_id: SHOP, all_recipients: [{ role: 'sender', entity_id: SHOP }, { role: 'receiver', entity_id: CUST }],
      business_json: Object.assign({ invoice: T.determine({ seller: party(SHOP), buyer: party(CUST), lines: [{ name: 'Brake pad', hsn: '9999', qty: 1, unit_price: price, rate: 18 }] }) }, billedAt ? { billed_at: billedAt } : {})
    });
  const momentOf = (r) => Date.parse((r.business_json && r.business_json.billed_at) || r.sent_at || r.created_at);
  /* the SQL of tax-copy.copiesFor, modelled on the in-memory journal: the entries of a copy, each with the day of the reversal that cancelled it (if any) */
  const entriesOf = (r) =>
    X.T.entries
      .filter((j) => j.entity_id === SHOP && !j.reverses_entry_id && String(j.source_ref || '').indexOf('chit:' + r.chit_id) === 0)
      .map((j) => {
        const v = X.T.entries.find((x) => x.reverses_entry_id === j.entry_id);
        return { day: String(j.posting_date).slice(0, 10), rev: v ? String(v.posting_date).slice(0, 10) : null };
      });
  let seenSql = '';
  let booksOn = true; /* the fixture's books_setting.enabled of the shop */
  const memory = require('./support/books-memory.cjs');
  const ask = memory.fakeDb.query;
  memory.fakeDb.query = async (text, params) => {
    const sql = String(text);
    if (/FROM identities WHERE identity_id = ANY/.test(sql)) return { rows: params[0].map((id) => IDS[id]).filter(Boolean) };
    if (/FROM identities WHERE identity_id = \$1/.test(sql)) return { rows: [IDS[params[0]]].filter(Boolean) };
    if (/FROM chit_header h/.test(sql) && /h\.entity_id = \$1/.test(sql)) {
      seenSql = sql;
      const from = Date.parse(params[1]), to = Date.parse(params[2]), dFrom = params[3], dTo = params[4];
      const view = (r) => {
        const all = entriesOf(r);
        const live = all.filter((e) => e.day < dTo && (!e.rev || e.rev >= dTo)); /* held AS AT the month's end: posted before it, not yet reversed */
        const bookedDay = live.length ? live.map((e) => e.day).sort().pop() : null;
        const revs = all.filter((e) => e.day < dFrom && e.rev && e.rev >= dFrom && e.rev < dTo).map((e) => e.rev).sort();
        const bj = r.business_json || {};
        const noEntry = booksOn && String(r.sender_entity_id) === SHOP && !!bj.bill_no && !!(bj.till && bj.till.id) && !/^(rejected|cancelled)$/.test(r.current_status || '') && all.length === 0;
        return { bookedDay, revDay: revs.length ? revs.pop() : null, noEntry };
      };
      const found = rows.filter((r) => {
        if (r.role === 'Draft') return false;
        const v = view(r), inWin = momentOf(r) >= from && momentOf(r) < to;
        return (v.bookedDay && (inWin || (v.bookedDay >= dFrom && v.bookedDay < dTo))) || (!v.bookedDay && v.revDay) || (v.noEntry && inWin);
      });
      return {
        rows: found.map((r) => {
          const v = view(r);
          return Object.assign({}, r, { books_posting_date: v.bookedDay, books_reversed_day: v.revDay, books_no_entry: v.noEntry, books_locked_starts: X.T.periods.filter((p) => p.status !== 'open').map((p) => String(p.start_date).slice(0, 10)) });
        })
      };
    }
    return ask(text, params);
  };
  delete require.cache[require.resolve(path.join(H.API, 'lib', 'tax-copy'))];
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));

  await X.store.saveSetting(X.db, SHOP, { enabled: true });
  await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-04-01' });
  K.forget(SHOP);
  X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: IDS[CUST].display_name, customer: true, credit_days: 30 });
  const rowOf = (n) => rows.find((r) => r.chit_id === uuid(n));
  const post = async (r, over) => {
    const k = K.classify({ chit: r, entry: await TC.entryFor(r, SHOP), setting: S, status: 'delivered' });
    if (k.kind !== 'post') throw new Error('did not classify as a post: ' + JSON.stringify(k));
    const out = await X.B.postEntry(X.db, SHOP, Object.assign({}, k.event, { source_chit_id: r.chit_id }, over || {}));
    if (!out.ok) throw new Error('did not post: ' + JSON.stringify(out));
    return out;
  };

  /* ── 1. September: bill 1 (28 Sep, GST 90 + 90) posted; September is filed (locked) ── */
  sale(1, 1000, '2026-09-28T05:00:00.000Z');
  const p1 = await post(rowOf(1));
  sale(7, 500, '2026-09-25T05:00:00.000Z'); /* GST 45 + 45: reversed in October and RE-POSTED as a new October entry */
  const p7 = await post(rowOf(7));
  const p7SourceRef = 'chit:' + rowOf(7).chit_id;
  await X.B.setPeriod(X.db, SHOP, '2026-27', 6, 'soft_locked', SHOP, 'GSTR-1 filed');
  const sepBefore = await TC.ledgerFor(SHOP, '2026-09');
  eq('hand-computed: September as filed = bills 1 and 7: taxable 1500, CGST 135, SGST 135, nothing named', [sepBefore.ledger.count, sepBefore.ledger.output.taxable, sepBefore.ledger.output.cgst, sepBefore.ledger.output.sgst, sepBefore.reversed.length, sepBefore.not_in_books.length], [2, 1500, 135, 135, 0, 0]);

  /* ── 2. October: bill 2 posted and reversed inside October (nets to nothing), bill 3 ordinary, bill 4 a counter bill never posted, bill 5 free, bill 6 cancelled; then bill 1 is reversed ── */
  sale(2, 400, '2026-10-02T05:00:00.000Z');
  const p2 = await post(rowOf(2));
  sale(3, 1000, '2026-10-05T05:00:00.000Z');
  await post(rowOf(3));
  const counter = (n, total, status) =>
    rows.push({ chit_id: uuid(n), purpose: 'order', role: 'Sender', currency_code: 'INR', line_items: [], created_at: '2026-10-12T05:00:00.000Z', sent_at: '2026-10-12T05:00:00.000Z', current_status: status || 'delivered', sender_entity_id: SHOP, all_recipients: [{ role: 'sender', entity_id: SHOP }], summary_json: { money: { total } }, business_json: { bill_no: 'T' + n, till: { id: 'C1' }, billed_at: '2026-10-12T05:00:00.000Z' } });
  counter(4, 1180);
  counter(5, 0);
  counter(6, 590, 'cancelled');
  const rev1 = await X.B.reverseEntry(X.db, SHOP, p1.entry_id, { reason: 'bill 1 returned', by: SHOP });
  const rev2 = await X.B.reverseEntry(X.db, SHOP, p2.entry_id, { reason: 'bill 2 keyed twice', by: SHOP });
  eq('the books put the filed-month bill reversal in October (their rule); the same-month one on its own date', [rev1.posting_date, rev2.posting_date.slice(0, 7)], ['2026-10-01', '2026-10']);

  /* bill 7: reversed (1 Oct) and RE-POSTED as a new entry dated 8 Oct — the September read must not see the October entry */
  await X.B.reverseEntry(X.db, SHOP, p7.entry_id, { reason: 'bill 7 re-keyed', by: SHOP });
  const re7 = await post(rowOf(7), { source_ref: p7SourceRef + ':repost', date: '2026-10-08', posting_date: '2026-10-08' });
  eq('bill 7 is re-posted as a second, October entry', [!!re7.ok && !re7.duplicate, String(re7.posting_date).slice(0, 7)], [true, '2026-10']);
  const sep = await TC.ledgerFor(SHOP, '2026-09');
  const oct = await TC.ledgerFor(SHOP, '2026-10');
  eq('hand-computed: September AFTER the October reversals AND the re-post is unchanged: bills 1 and 7, 1500, CGST 135, SGST 135', [sep.ledger.count, sep.ledger.output.taxable, sep.ledger.output.cgst, sep.ledger.output.sgst, sep.ledger.rows.map((r) => r.chit_id).sort()], [2, 1500, 135, 135, [rowOf(1).chit_id, rowOf(7).chit_id].sort()]);
  eq('September names nothing new', [sep.reversed.length, sep.not_in_books.length], [0, 0]);
  eq('hand-computed: October counts bill 3 (1000, CGST 90) and the re-posted bill 7 (500, CGST 45) = 1500 / 135; bill 1 (reversed 1 Oct) and bill 2 (reversed in its own month) are not counted', [oct.ledger.count, oct.ledger.output.taxable, oct.ledger.output.cgst], [2, 1500, 135]);
  eq('the re-posted bill 7 is a prior-period item in October (a September bill booked in October), not a reversed one', [oct.prior_period.map((p) => p.chit_id), oct.reversed.map((x) => x.chit_id)], [[rowOf(7).chit_id], [rowOf(1).chit_id]]);
  eq('October NAMES bill 1 and only bill 1: reversed_after_filed, invoice 2026-09-28, reversed 2026-10-01', oct.reversed.map((x) => [x.chit_id === rowOf(1).chit_id, x.kind, x.invoice_day, x.invoice_month, x.reversed_day, x.month]), [[true, 'reversed_after_filed', '2026-09-28', '2026-09', '2026-10-01', '2026-10']]);
  ok('...with words a shopkeeper can read', /reversed on 2026-10-01 after 2026-09 was filed/.test(oct.reversed[0].words) && /report the credit in the open month, 2026-10/.test(oct.reversed[0].words), oct.reversed[0].words);
  eq('October NAMES the counter bill with no entry (bill 4); the free bill and the cancelled bill are not named', oct.not_in_books.map((x) => [x.chit_id === rowOf(4).chit_id, x.kind, x.invoice_day]), [[true, 'not_in_books', '2026-10-12']]);
  ok('...with words', /Bill T4 .*for 1180.*no entry.*in no GST return/.test(oct.not_in_books[0].words), oct.not_in_books[0].words);
  const g1 = TL.gstr1(oct.ledger, oct.me, oct.bounds.period), g3 = TL.gstr3b(oct.ledger, oct.me, oct.bounds.period);
  eq('GSTR-1 and GSTR-3B for October carry both lists in _cb', [g1._cb.reversed.length, g1._cb.not_in_books.length, g3._cb.reversed.length, g3._cb.not_in_books.length], [1, 1, 1, 1]);
  ok('the SQL itself reads the books AS AT the month end (a reversal on/after $5 does not count) and carries the reversed / no-entry arms', /reverses_entry_id = j\.entry_id AND to_char\(r\.posting_date, 'YYYY-MM-DD'\) < \$5/.test(seenSql) && /AND to_char\(j\.posting_date, 'YYYY-MM-DD'\) < \$5/.test(seenSql) && /books_reversed_day/.test(seenSql) && /books_no_entry/.test(seenSql), seenSql.slice(0, 200));
  /* a shop whose books are OFF has no entries by design: its counter bills are not named */
  booksOn = false;
  const octOff = await TC.ledgerFor(SHOP, '2026-10');
  eq('books OFF: the counter bill with no entry is NOT named (empty not_in_books); the reversed list is unaffected', [octOff.not_in_books.length, octOff.reversed.length], [0, 1]);
  booksOn = true;
  ok('the no-entry arm asks the shop keeps books: EXISTS (books_setting ... enabled) in the SQL', seenSql.includes('EXISTS (SELECT 1 FROM books_setting k WHERE k.entity_id = h.entity_id AND k.enabled)'), seenSql.slice(0, 120));
  const sep3b = TL.gstr3b(sep.ledger, sep.me, sep.bounds.period).sup_details.osup_det;
  eq('GSTR-3B September still shows the bill: output CGST 135, SGST 135', [sep3b.camt, sep3b.samt], [135, 135]);

  console.log('\n' + (fail ? '  FAILED ' + fail : '  PASSED ' + pass) + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

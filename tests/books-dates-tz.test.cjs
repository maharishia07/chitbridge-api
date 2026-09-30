/**
 * books-dates-tz.test.cjs — A DATE READ BACK FROM POSTGRES IS THE SAME DATE IN EVERY TIME ZONE (critic M8, 2026-09-30).
 *
 * node-pg hands a `date` column back as a JS Date at LOCAL midnight. The ledger's one date reader (lib/books-engines ymd)
 * used toISOString(), which is the day BEFORE east of UTC. Production runs in UTC, so it held there by accident; a run
 * on a machine in India wrote, into insert-only rows: a reversal dated the day before its original, and a sale moved
 * out of a locked September onto 30 September — inside the locked month.
 *
 * ⚠️ WHY THE OLD TESTS MISSED IT: the in-memory store keeps dates as strings. Here every date the store hands back is
 * first put through pg's OWN parser for the `date` type (OID 1082), so the ledger reads exactly what a database gives it.
 * ⚠️ THE TEST RUNS ITSELF TWICE — TZ=Asia/Kolkata and TZ=UTC — and both must give the same answers.
 *
 * Run: node tests/books-dates-tz.test.cjs
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

if (!process.env.BOOKS_TZ_CHILD) {
  /* ── the parent: the same checks under two zones ── */
  let total = 0, bad = 0;
  for (const tz of ['Asia/Kolkata', 'UTC']) {
    const r = spawnSync(process.execPath, [__filename], { encoding: 'utf8', timeout: 100000, env: Object.assign({}, process.env, { TZ: tz, BOOKS_TZ_CHILD: tz }) });
    const out = (r.stdout || '') + (r.stderr || '');
    console.log('\n══ TZ=' + tz + ' ══');
    console.log(out.split('\n').filter((l) => /^\s+(ok|FAIL|SKIP)|threw|offset/.test(l)).join('\n'));
    const m = /(\d+) passed, (\d+) failed/.exec(out);
    if (!m || r.status !== 0) bad++;
    if (m) { total += Number(m[1]) + Number(m[2]); if (Number(m[2])) bad++; }
  }
  console.log('\n' + (bad ? '  ✗ FAIL — the two zones do not agree' : '  ✓ both zones agree') + ' · ' + total + ' checks\n');
  process.exit(bad ? 1 : 0);
}

/* ── the child: one zone ── */
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';

const pgDate = require('pg').types.getTypeParser(1082);           /* the REAL parser node-pg uses for a `date` column */
const asPg = (v) => (v == null ? v : pgDate(String(v).slice(0, 10)));
/** every date column the store returns, put through pg's parser — what a database hands the ledger */
function pgDates(store) {
  const wrap = (name, cols, pick) => { const f = store[name]; store[name] = async (...a) => { const r = await f(...a);
    const fix = (row) => { if (row) cols.forEach((c) => { if (row[c] != null) row[c] = asPg(row[c]); }); return row; };
    if (Array.isArray(r)) r.forEach(fix); else if (r) { fix(r); (pick || []).forEach((k) => (r[k] || []).forEach((x) => ['due_date', 'doc_date'].forEach((c) => { if (x[c] != null) x[c] = asPg(x[c]); }))); }
    return r; }; };
  wrap('periods', ['start_date', 'end_date']);
  wrap('entryBySource', ['posting_date', 'doc_date']);
  wrap('entry', ['posting_date', 'doc_date'], ['items']);
  wrap('entryLines', ['posting_date', 'doc_date']);
  wrap('ledgerLines', ['posting_date']);
  wrap('entries', ['posting_date', 'doc_date']);
  wrap('items', ['due_date', 'doc_date']);
  wrap('payment', ['received_at', 'cheque_date']);
  wrap('packs', ['delete_after']);
  wrap('pack', ['delete_after']);
}

(async () => {
  console.log('   offset ' + new Date(2026, 8, 30).getTimezoneOffset() + ' min (TZ=' + process.env.TZ + ')');
  const src = H.enginesSrc();
  const X = H.load();
  const E = X.E;
  const d = pgDate('2026-09-30');
  ok('pg hands a `date` back as a Date at local midnight (the premise)', d instanceof Date && d.getHours() === 0 && d.getDate() === 30);
  eq('ymd of a date column is that date — 30 Sep stays 30 Sep', E.ymd(d), '2026-09-30');
  eq('…the first of a month stays in its month (1 Oct is not 30 Sep)', E.ymd(pgDate('2026-10-01')), '2026-10-01');
  eq('…a string is untouched, and nothing is nothing', [E.ymd('2026-04-01'), E.ymd('2026-04-01T00:00:00.000Z'), E.ymd(null)], ['2026-04-01', '2026-04-01', null]);
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  eq('a MOMENT is read as the shop\'s day whatever zone the server is in (20:00 UTC is the next day in India), Date or string',
    [K.dayOf(new Date('2026-09-28T20:00:00Z'), 'IN'), K.dayOf('2026-09-28T20:00:00Z', 'IN'), K.dayOf(new Date('2026-09-28T17:00:00.500Z'), 'IN')], ['2026-09-29', '2026-09-29', '2026-09-28']);

  if (!src.dir) { console.log('   SKIP the writer under this zone: ' + src.why); fail++; }
  else {
    const { B, T, db } = X;
    T.parties.push({ owner: SHOP, party_id: CUST, name: 'Ravi', customer: true, credit_days: 15 });
    await B.enable(db, SHOP, { by: SHOP, today: '2026-09-29' });
    pgDates(X.store);
    /* a reversal is dated in its original's month — the SAME day when that month is open */
    const e1 = await B.postEntry(db, SHOP, { type: 'expense', date: '2026-09-30', currency: 'INR', class: 'rent', amount: 500, paid_from: 'cash', source_ref: 'chit:tz1' });
    const rv = await B.reverseEntry(db, SHOP, e1.entry_id, { by: SHOP, reason: 'wrong class' });
    eq('a reversal of an entry dated 30 Sep is dated 30 Sep (it was the 29th east of UTC)', rv.posting_date, '2026-09-30');
    const hdr = T.entries.find((h) => h.entry_id === rv.entry_id);
    eq('…stored with the original\'s document date and September\'s period', [hdr.doc_date, hdr.period], ['2026-09-30', 6]);
    const dup = await B.postEntry(db, SHOP, { type: 'expense', date: '2026-09-30', currency: 'INR', class: 'rent', amount: 500, paid_from: 'cash', source_ref: 'chit:tz1' });
    eq('a replay answers with the entry\'s own date', [dup.duplicate, dup.posting_date], [true, '2026-09-30']);
    /* a locked September: a chit dated in it posts on 1 October — never on 30 September, inside the lock */
    await B.setPeriod(db, SHOP, '2026-27', 6, 'soft_locked', SHOP, 'GSTR-1 filed');
    const mv = await B.postEntry(db, SHOP, { type: 'sale_bill', date: '2026-09-10', currency: 'INR', party: CUST, source_chit_id: 'c0000000-0000-4000-8000-0000000000a1', source_ref: 'chit:tz2',
      by_rate: [{ rate: 18, taxable: 100, cgst: 9, sgst: 9, igst: 0 }], paid: {}, round_off: 0 });
    eq('a sale moved out of locked September lands on 1 October, period 7 (it landed on 30 Sep, inside the lock, east of UTC)', [mv.posting_date, mv.moved, T.entries.find((h) => h.entry_id === mv.entry_id).period], ['2026-10-01', true, 7]);
    const bill = T.items.find((i) => i.ref === 'c0000000-0000-4000-8000-0000000000a1');
    eq('…its bill keeps the document\'s own date, due 15 days on', [bill.doc_date, bill.due_date], ['2026-09-10', '2026-09-25']);
    /* the reports read those rows back */
    let threw = null, tb = null, st = null;
    try { tb = await B.trialBalance(db, SHOP, '2026-10-31'); st = await B.partyStatement(db, SHOP, CUST, 'debtors', '2026-04-01', '2026-10-31'); } catch (e) { threw = e; }
    ok('the trial balance and a statement read them back and balance (they threw east of UTC)', !threw && tb && tb.balanced && st && st.closing_minor === 11800, threw ? String(threw.message) : JSON.stringify([tb && tb.balanced, st && st.closing_minor]));
    const items = (await X.store.items(db, SHOP, CUST, null)).map(E.itemOf);
    eq('a party item read back keeps its dates', [items[0].date, items[0].due_date], ['2026-09-10', '2026-09-25']);
    /* a cheque: its received date is a `date` column too */
    const pay = await B.recordPayment(db, SHOP, { party_id: CUST, direction: 'in', amount_minor: 5000, currency: 'INR', mode: 'cash', received_at: '2026-10-01', client_ref: 'tz-pay-1' });
    const pe = T.entries.find((h) => h.source_ref === 'pay:' + pay.payment.payment_id);
    eq('a payment received on 1 Oct posts on 1 Oct', pe && pe.posting_date, '2026-10-01');
    const p2 = B.paymentEvent(await X.store.payment(db, SHOP, pay.payment.payment_id), {});
    eq('…and the event rebuilt from the stored payment (a cheque clearing does this) carries 1 Oct', p2.date, '2026-10-01');
  }
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); console.log('\n   ' + pass + ' passed, ' + (fail + 1) + ' failed\n'); process.exit(1); });

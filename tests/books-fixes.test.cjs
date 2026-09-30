/**
 * books-fixes.test.cjs — THE RED-TEAM FINDINGS OF 2026-09-30, EACH HELD BY A CHECK THAT WAS RED BEFORE ITS FIX
 * (C:\dev\CRITIC-REVIEW-books-server-2026-09-30.md, M1–M12 and the cheap follow-ups).
 *
 * The earlier suite was green and caught none of them, for three reasons the review names: every test seeded a
 * books_setting row before enabling, kept dates as strings, and never sent the same thing twice. So here: a shop with NO
 * row is switched on; one entry names two parties; a read of the switch fails once; the same payment is sent twice.
 * (Dates read back as a database hands them over are in tests/books-dates-tz.test.cjs — it runs itself under two zones.)
 *
 * Needs the books engines (BOOKS_ENGINES_SRC, else the sibling ../chitbridge-engines/src). Run: node tests/books-fixes.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
/** one finding = one section; a throw inside it is that section's failure, never the end of the file */
async function section(title, fn) {
  console.log('\n── ' + title + ' ──');
  try { await fn(); } catch (e) { fail++; console.log('   FAIL threw: ' + (e && e.stack || e)); }
}

const SHOP = '11111111-1111-4111-8111-111111111111';
const MALA = '22222222-2222-4222-8222-222222222222', RAVI = '55555555-5555-4555-8555-555555555555', SUPP = '33333333-3333-4333-8333-333333333333';
const STRANGER = '99999999-9999-4999-8999-999999999999';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
const authStub = Object.assign((req, res, next) => { req.identity = OWNER; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { const bufs = []; res.on('data', (c) => bufs.push(c)); res.on('end', () => { const raw = Buffer.concat(bufs); let j = {}; try { j = JSON.parse(raw.toString('utf8') || '{}'); } catch (_) {} done({ status: res.statusCode, body: j, raw, headers: res.headers }); }); });
  r.end(b);
});
/** the routes on a port the OS chose, against a fresh in-memory shop */
function serve(X) {
  const express = require('express');
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  return { srv, q: (m, p, b) => call(port, m, '/api/books' + p, b) };
}
const parties = (X) => X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10 },
  { owner: SHOP, party_id: RAVI, party_no: 'P-00002', name: 'Ravi', customer: true, credit_days: 10 }, { owner: SHOP, party_id: SUPP, party_no: 'P-00003', name: 'Kumar Traders', supplier: true, credit_days: 30 });

(async () => {
  console.log('\n══ BOOKS v2 — the red-team findings, held ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n\n  ✓ 0 passed · 0 checks\n'); process.exit(1); }

  /* ═══ M1 · the switch can be turned on for a shop that has NO books_setting row ═══ */
  await section('M1 · a shop with no row can be switched on; "not migrated" only when the table is missing', async () => {
    const X = H.load({ auth: authStub });
    const { srv, q } = serve(X);
    const st = await q('GET', '/status');
    ok('GET /status, tables there and no row for this shop → migrated: true, enabled: false', st.status === 200 && st.body.migrated === true && st.body.enabled === false, JSON.stringify(st.body));
    const en = await q('POST', '/enable', {});
    ok('POST /enable with NO row → 200, the chart seeded, the switch on (it was 422 "run migrations" for every shop)', en.status === 200 && en.body.ok === true && en.body.accounts_added > 60, en.status + ' ' + JSON.stringify(en.body));
    ok('…and the row now exists, enabled', !!(X.T.setting.get(SHOP) && X.T.setting.get(SHOP).enabled));
    /* the table really missing: Postgres says 42P01 — that, and only that, is "not migrated" */
    const real = X.store.setting; X.store.setting = async () => { throw Object.assign(new Error('relation "books_setting" does not exist'), { code: '42P01' }); };
    const st2 = await q('GET', '/status');
    ok('the table missing (42P01) → migrated: false', st2.status === 200 && st2.body.migrated === false && st2.body.enabled === false, JSON.stringify(st2.body));
    const en2 = await q('POST', '/enable', {});
    ok('…and POST /enable says to run the SQL first (503)', en2.status === 503 && /b272/.test(en2.body.error || ''), en2.status + ' ' + JSON.stringify(en2.body));
    X.store.setting = real; srv.close();
  });

  /* ═══ M2 · one entry naming two parties must not break Dues ═══ */
  await section('M2 · an entry naming two parties: each party its own document; Dues keeps answering', async () => {
    const X = H.load({ auth: authStub }); parties(X);
    const { srv, q } = serve(X);
    await q('POST', '/enable', {});
    const sale = await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-05', currency: 'INR', party: MALA, source_chit_id: 'c0000000-0000-4000-8000-00000000000a', source_ref: 'chit:a',
      by_rate: [{ rate: 5, taxable: 1000, cgst: 25, sgst: 25, igst: 0 }], paid: {}, round_off: 0 });
    ok('a credit sale to Mala still uses the chit as its document (bill numbers and proposals read it)', sale.ok && X.T.items.some((i) => i.ref === 'c0000000-0000-4000-8000-00000000000a' && i.party_id === MALA));
    /* scenario A: the owner moves a bill to the right customer — Dr Ravi / Cr Mala, one entry */
    const mv = await q('POST', '/entries', { narration: 'Billed to the wrong customer', date: '2026-09-06', lines: [{ code: '1300', dr_minor: 105000, party_id: RAVI }, { code: '1300', cr_minor: 105000, party_id: MALA }] });
    ok('scenario A: a manual entry Dr Ravi / Cr Mala posts', mv.status === 200 && mv.body.ok, mv.status + ' ' + JSON.stringify(mv.body));
    const d1 = await q('GET', '/dues?asOf=2026-09-30');
    ok('…and GET /dues still answers (it was 422 "stamped with two parties" for the whole shop, for ever)', d1.status === 200 && Array.isArray(d1.body.parties), d1.status + ' ' + JSON.stringify(d1.body).slice(0, 200));
    const docs = (p) => Array.from(new Set(X.T.items.filter((i) => i.party_id === p && i.ref === i.against_ref).map((i) => i.ref)));
    ok('…no document is shared by two parties', docs(RAVI).every((r) => docs(MALA).indexOf(r) < 0), JSON.stringify([docs(RAVI), docs(MALA)]));
    const bal = (body, p) => ((body.parties || []).find((x) => x.party_id === p) || {}).balance_minor;
    eq('…Ravi now owes 1050.00; Mala owes nothing', [bal(d1.body, RAVI), bal(d1.body, MALA) || 0], [105000, 0]);
    /* scenario B: opening balances, two customers, no bill column */
    const op = await q('POST', '/opening', { client_ref: 'open-1', rows: [{ code: '1300', party_no: 'P-00001', dr_minor: 20000 }, { code: '1300', party_no: 'P-00002', dr_minor: 30000 }, { code: '3000', cr_minor: 50000 }] });
    ok('scenario B: opening balances for two customers with no bill named post', op.status === 200 && /^JV\//.test(op.body.entry_no || ''), op.status + ' ' + JSON.stringify(op.body));
    const d2 = await q('GET', '/dues?asOf=2026-09-30');
    eq('…and Dues answers, each balance on its own party (Mala 200.00 · Ravi 1050.00 + 300.00)', [d2.status, bal(d2.body, MALA), bal(d2.body, RAVI)], [200, 20000, 135000]);
    /* the same typed bill reference for two parties can never be written — refused in words, before it is a row */
    const n0 = X.T.entries.length;
    const two = await q('POST', '/opening', { rows: [{ code: '1300', party_no: 'P-00001', dr_minor: 100, bill_ref: 'OLD-7' }, { code: '1300', party_no: 'P-00002', dr_minor: 100, bill_ref: 'OLD-7' }, { code: '3000', cr_minor: 200 }] });
    ok('one bill reference given for two parties is refused in words (422), and nothing is written', two.status === 422 && /OLD-7/.test(two.body.error || '') && X.T.entries.length === n0, two.status + ' ' + JSON.stringify(two.body));
    /* …and across entries: a second manual entry reusing a reference another party already holds */
    await q('POST', '/entries', { narration: 'Adjustment', ref: 'ADJ', date: '2026-09-07', lines: [{ code: '1300', dr_minor: 500, party_id: MALA }, { code: '4000', cr_minor: 500 }] });
    await q('POST', '/entries', { narration: 'Adjustment', ref: 'ADJ', date: '2026-09-07', lines: [{ code: '1300', dr_minor: 700, party_id: RAVI }, { code: '4000', cr_minor: 700 }] });
    const d3 = await q('GET', '/dues?asOf=2026-09-30');
    eq('two entries that reuse one reference for two parties: Dues still answers, each amount on its own party', [d3.status, bal(d3.body, MALA), bal(d3.body, RAVI)], [200, 20500, 135700]);
    srv.close();
  });

  /* a walk-in counter bill, as the day read and the hook both see it: ₹100 + 18% = ₹118 */
  const inv = (taxable, tax) => ({ currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: taxable, CgstAmt: tax / 2, SgstAmt: tax / 2, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: taxable + tax } });
  const BILL = (n) => 'b0000000-0000-4000-8000-00000000000' + n;
  const wb = (id, at) => ({ chit_id: id, purpose: 'order', created_at: at || '2026-09-29T05:00:00Z', currency_code: 'INR',
    business_json: { bill_no: 'C1-' + id.slice(-2), till: { id: 'C1' }, billed_at: '2026-09-29T05:00:00Z', payment: { parts: [{ how: 'Cash', amount: 118 }] } } });
  /** a fresh shop, switched on, with the hooks and a tax-copy that reads the bills we hand it */
  async function shop(grain) {
    const X = H.load({ auth: authStub }); parties(X);
    await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-09-29', walkin_grain: grain || 'day' });
    const K = require(path.join(H.API, 'lib', 'books-hooks')); K.forget(SHOP);
    const TC = require(path.join(H.API, 'lib', 'tax-copy'));
    const chits = new Map();
    TC.copyOf = async (id) => chits.get(String(id)) || null;
    TC.entryFor = async (c) => (c.business_json && c.business_json.bill_no ? { sells: true, invoice: inv(100, 18) } : {});
    const sales = () => { const a = X.T.accounts.find((x) => x.role === 'sales'); let n = 0; X.T.balances.forEach((b) => { if (b.account_id === a.account_id && b.party_key === X.store.ZERO) n += b.cr_minor - b.dr_minor; }); return n; };
    return { X, K, TC, chits, sales, put: (c) => { chits.set(String(c.chit_id), c); return c; } };
  }

  /* ═══ M3 · one failed read of the switch must not switch a shop's posting off for ten minutes ═══ */
  await section('M3 · a failed read of the switch is not remembered as "off", and it is said', async () => {
    const { X, K } = await shop();
    const L = require(path.join(H.API, 'lib', 'logger')); const warned = []; const w0 = L.warn; L.warn = (m, c) => { warned.push(m); };
    const real = X.store.setting; let reads = 0;
    X.store.setting = async () => { reads++; throw new Error('timeout exceeded when trying to connect'); };
    const a = await K.isOn(SHOP);
    X.store.setting = async (...args) => { reads++; return real(...args); };
    const b = await K.isOn(SHOP);
    L.warn = w0;
    ok('the read fails once (a pool timeout) → the very next chit finds the ledger ON (it was cached "off" for 600 s)', a === null && !!(b && b.enabled), JSON.stringify([a, b && b.enabled]));
    ok('…and the failure is in the log, by name', warned.indexOf('books.switch-unread') >= 0, JSON.stringify(warned));
    /* a shop known to be on, whose next read fails: the last known answer stands — its chits still try to post */
    K.forget(SHOP); await K.isOn(SHOP);
    const c0 = K._expire(SHOP); X.store.setting = async () => { throw new Error('timeout'); };
    const c = await K.isOn(SHOP);
    ok('a shop last known ON whose read fails is still treated as on (the post is tried, and parked if it cannot)', c0 === true && !!(c && c.enabled), JSON.stringify(c));
    /* the table missing is different: that IS remembered (ten minutes), so a server before b272 pays one read */
    K.forget(SHOP); let n42 = 0; X.store.setting = async () => { n42++; throw Object.assign(new Error('relation "books_setting" does not exist'), { code: '42P01' }); };
    await K.isOn(SHOP); await K.isOn(SHOP); await K.isOn(SHOP);
    eq('the table missing (42P01) is still read once and remembered', n42, 1);
    X.store.setting = real; K.forget(SHOP);
  });

  /* ═══ M4 · grain "bill": the day must not post the same walk-in bills a second time ═══ */
  await section('M4 · per-bill grain: postDay posts nothing; a bill already posted on its own never rides a day', async () => {
    const { X, K, sales, put } = await shop('bill');
    const b1 = put(wb(BILL(1)));
    X.store.counterBills = async () => [b1];
    const own = await K.postChit(SHOP, b1.chit_id, {});
    ok('grain "bill": the ₹118 cash bill posts as its own entry (bill:<chit>)', own.ok && X.T.entries.some((e) => e.source_ref === 'bill:' + b1.chit_id), JSON.stringify(own));
    const day = await K.postDay(SHOP, 'C1', '2026-09-29', {});
    ok('…and the day close / nightly postDay posts NOTHING for that counter', day.ok === true && day.empty === true && !X.T.entries.some((e) => /^walkin:/.test(e.source_ref || '')), JSON.stringify(day));
    eq('…Sales shows ₹100.00, not ₹200.00', sales(), 10000);
    /* the grain is changed back to "day" the same day: the bill that already posted on its own must not ride the day */
    await X.store.saveSetting(X.db, SHOP, Object.assign({}, X.T.setting.get(SHOP), { walkin_grain: 'day' })); K.forget(SHOP);
    const b2 = put(wb(BILL(2)));
    X.store.counterBills = async () => [b1, b2];
    const day2 = await K.postDay(SHOP, 'C1', '2026-09-29', {});
    const de = X.T.entries.find((e) => e.source_ref === 'walkin:C1:2026-09-29');
    ok('grain back to "day": the day carries only the bill that has not posted', day2.ok && de && de.total_minor === 11800 && JSON.stringify(de.source_chit_ids) === JSON.stringify([b2.chit_id]), JSON.stringify([day2, de && de.total_minor, de && de.source_chit_ids]));
    eq('…Sales ₹200.00 for two bills', sales(), 20000);
  });

  /* ═══ M7 · a walk-in bill in flight at day close must post, not wait for ever ═══ */
  await section('M7 · a bill the day\'s read did not include posts as a late bill; one it did include does not', async () => {
    const { X, K, sales, put } = await shop('day');
    const b1 = put(wb(BILL(1))), b2 = put(wb(BILL(2)));
    /* b3 was written BEFORE the day was read (an earlier created_at) but committed after it: the day's read never saw it */
    const b3 = put(wb(BILL(3), '2026-09-29T04:59:00Z'));
    X.store.counterBills = async () => [b1, b2];
    ok('before the day is posted a walk-in bill waits for the day close', (await K.postChit(SHOP, b1.chit_id, {})).waiting === 'day close');
    const day = await K.postDay(SHOP, 'C1', '2026-09-29', {});
    const de = X.T.entries.find((e) => e.source_ref === 'walkin:C1:2026-09-29');
    ok('the day posts and NAMES the bills it covers', day.ok && de && JSON.stringify(de.source_chit_ids) === JSON.stringify([b1.chit_id, b2.chit_id]), JSON.stringify([day, de && de.source_chit_ids]));
    const late = await K.postChit(SHOP, b3.chit_id, {});
    ok('the bill in flight posts as a catch-up entry for that day (it answered "waiting: day close" for ever)', late.ok === true && !late.waiting && X.T.entries.some((e) => e.source_ref === 'walkin-late:' + b3.chit_id && e.doc_date === '2026-09-29'), JSON.stringify(late));
    const in1 = await K.postChit(SHOP, b1.chit_id, {});
    ok('a bill the day DID cover posts nothing more', in1.covered === true && !X.T.entries.some((e) => e.source_ref === 'walkin-late:' + b1.chit_id), JSON.stringify(in1));
    const again = await K.postChit(SHOP, b3.chit_id, {});
    ok('…and the late bill posts once', again.duplicate === true && X.T.entries.filter((e) => e.source_ref === 'walkin-late:' + b3.chit_id).length === 1, JSON.stringify(again));
    eq('Sales = three bills, ₹300.00, to the paisa', sales(), 30000);
  });

  /* ═══ M6 · a chit whose hook never ran is found, posted or named — and nothing from before the ledger began ═══ */
  await section('M6 · the nightly sweep: unposted chits of the closed days are posted, or parked and named', async () => {
    const { X, K, TC, put } = await shop('day');
    const N = require(path.join(H.API, 'lib', 'books-nightly'));
    const U1 = 'd0000000-0000-4000-8000-000000000001', U2 = 'd0000000-0000-4000-8000-000000000002', U3 = 'd0000000-0000-4000-8000-000000000003';
    put({ chit_id: U1, purpose: 'expense', created_at: '2026-09-29T11:00:00Z', business_json: { expense: { what: 'tea', mode: 'Cash', amount: 40 } } });
    put({ chit_id: U2, purpose: 'expense', created_at: '2026-09-29T11:05:00Z', business_json: { expense: { what: 'x', mode: 'Cash', amount: 10, class: 'sales' } } });   /* the rules refuse it */
    put({ chit_id: U3, purpose: 'order', created_at: '2026-09-29T11:06:00Z', business_json: {} });                                                              /* a promise: posts nothing */
    const asked = []; X.store.unpostedChits = async (db, e, from, to, limit) => { asked.push({ from, to, limit }); return [{ chit_id: U1 }, { chit_id: U2 }, { chit_id: U3 }]; };
    const days = []; X.store.countersBilling = async (db, e, from) => { days.push(K.dayOf(from, 'IN') /* the shop day that starts at `from` */); return []; };
    const out = await N.check(SHOP, { today: '2026-09-30' });
    const sw = out.posted && out.posted.swept;
    ok('the check sweeps: 3 found, the expense posted, the refused one parked, the order left alone', !!sw && sw.found === 3 && sw.posted === 1 && sw.queued === 1 && sw.nothing === 1, JSON.stringify(sw));
    ok('…the chit whose hook never ran is now in the journal', X.T.entries.some((e) => e.source_ref === 'chit:' + U1));
    const w = (out.waiting || []).find((x) => x.chit_id === U2);
    ok('…the one that cannot post is NAMED on the waiting list, with its reason', !!w && typeof w.reason === 'string' && w.reason.length > 10, JSON.stringify(out.waiting));
    const en = X.T.setting.get(SHOP).enabled_at;
    ok('the sweep never reaches behind the moment the ledger was switched on (nothing from before it is posted)', asked.length === 1 && !!en && asked[0].from === new Date(en).toISOString() && asked[0].limit > 0 && asked[0].limit <= 500, JSON.stringify([asked, en]));
    eq('…and a walk-in day from before the ledger began is not posted either (the ledger began on the 29th)', days, ['2026-09-29']);
    /* bounded, and it says so when there is more than one check reads */
    X.store.unpostedChits = async (db, e, from, to, limit) => Array.from({ length: limit }, (_, i) => ({ chit_id: U3 }));
    const out2 = await N.check(SHOP, { today: '2026-09-30' });
    ok('when there are more than one check reads, that is a named problem — never a silent cut', (out2.problems || []).some((p) => /more unposted/i.test(p.what)), JSON.stringify(out2.problems));
    /* a second instance, or a run six hours later: what the sweep posted is not found again by source — idempotent */
    X.store.unpostedChits = async () => [{ chit_id: U1 }];
    const n0 = X.T.entries.length; await N.check(SHOP, { today: '2026-09-30' });
    eq('run again: the same chit posts nothing more', X.T.entries.length, n0);
    /* and the route shows it */
    const { srv, q } = serve(X);
    const hl = await q('GET', '/health');
    const hw = (hl.body.waiting || []).find((x) => x.chit_id === U2);
    ok('GET /health → waiting: [{ id, chit_id, ref, reason, tries, since }] for the parked post', hl.status === 200 && !!hw && ['id', 'chit_id', 'ref', 'reason', 'tries', 'since'].every((k) => k in hw) && hw.ref === 'chit:' + U2, JSON.stringify(hl.body.waiting));
    ok('…and last_check carries what the sweep found', !!(hl.body.last_check && hl.body.last_check.posted && hl.body.last_check.posted.swept), JSON.stringify(hl.body.last_check && hl.body.last_check.posted));
    srv.close();
    void TC;
  });

  /* ═══ F6 · rows that can never post must not starve newer ones ═══ */
  await section('F6 · the retry takes the least-tried first, so a hundred stuck rows cannot starve a new one', async () => {
    const { X, K, put } = await shop('day');
    const bad = ['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003'];
    for (const id of bad) { put({ chit_id: id, purpose: 'expense', created_at: '2026-09-29T11:00:00Z', business_json: { expense: { what: 'x', mode: 'Cash', amount: 10, class: 'sales' } } }); await K.postChit(SHOP, id, {}); }
    await K.retryOutbox(SHOP, 50);                                 /* each stuck row has now been tried once */
    const good = 'e0000000-0000-4000-8000-000000000009';
    put({ chit_id: good, purpose: 'expense', created_at: '2026-09-29T12:00:00Z', business_json: { expense: { what: 'tea', mode: 'Cash', amount: 40 } } });
    await X.store.queue(X.db, SHOP, { source_chit_id: good, source_ref: 'chit:' + good, event: { job: 'chit', chit_id: good }, why: 'the database fell over' });
    const r = await K.retryOutbox(SHOP, 2);
    ok('with room for two and three stuck rows ahead of it, the new row is still tried — and posts', r.tried === 2 && r.posted === 1 && X.T.entries.some((e) => e.source_ref === 'chit:' + good), JSON.stringify(r));
    const sql = require('fs').readFileSync(path.join(H.API, 'lib', 'books-store.js'), 'utf8');
    ok('…and the real statement orders the waiting list by tries, then id', /FROM books_outbox\s+WHERE entity_id = \$1 AND done_at IS NULL ORDER BY tries, id LIMIT \$2/.test(sql.replace(/\s+/g, ' ')));
  });

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });

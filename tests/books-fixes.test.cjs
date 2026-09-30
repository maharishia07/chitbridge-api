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

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });

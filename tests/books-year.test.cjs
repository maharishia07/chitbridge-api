/**
 * books-year.test.cjs — THE YEAR CLOSE (engines v1.20.0 period.yearClose) THROUGH REAL EXPRESS, with a stand-in auth, db and store.
 *
 * GET /year/:fy/status and POST /year/:fy/close: refused in plain words while the year is still running, while a month is open, while
 * Suspense is not nil — each naming what is missing, nothing written; then a close that locks every month for good (insert-only: a status
 * change, logged), makes the next year's months, and leaves the next year opening on CBLedger.carryForward's rows (the trial balance of
 * the new year balances, profit in Retained earnings). A second close answers duplicate. After it: a typed date in the closed year is
 * refused YEAR_CLOSED (409); a bill that arrives for it moves to the first open day of the new year, its own date kept. Owner-only.
 * Run: node tests/books-year.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222', SUPP = '33333333-3333-4333-8333-333333333333';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
const STAFF = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor' };
let WHO = OWNER;
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  console.log('\n══ /api/books — the year close ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  let DAY = '2026-10-10'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));

  await X.store.saveSetting(X.db, SHOP, { enabled: false });
  ok('the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', customer: true, credit_days: 10 },
    { owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true, credit_days: 30 });
  const codeOfRole = (role) => (X.T.accounts.find((a) => a.entity_id === SHOP && a.role === role) || {}).code;
  await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-05', currency: 'INR', party: CUST, source_ref: 'chit:a', by_rate: [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], paid: { cash: 1180 }, round_off: 0 });
  await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-09-06', currency: 'INR', party: SUPP, source_ref: 'chit:b', by_rate: [{ rate: 18, taxable: 500, cgst: 45, sgst: 45, igst: 0 }], paid: {}, round_off: 0 });

  /* 1 · refused: the year is still running */
  const s0 = await q('GET', '/year/2026-27/status');
  ok('status: not closable while the year is running — and says so', s0.status === 200 && s0.body.closed === false && s0.body.can_close === false && s0.body.refusals.some((r) => r.name === 'year_not_ended' && /ends on 2027-03-31/.test(r.why)), JSON.stringify(s0.body));
  /* 2 · refused: months open */
  DAY = '2027-04-10';
  const s1 = await q('GET', '/year/2026-27/status');
  const mo = (s1.body.refusals || []).find((r) => r.name === 'months_open');
  ok('status: the open months are NAMED, in words', mo && /Every month must be locked/.test(mo.why) && /2026-09/.test(mo.why), JSON.stringify(s1.body.refusals));
  const c1 = await q('POST', '/year/2026-27/close', {});
  ok('close with months open → 422, the refusal in plain words, nothing written', c1.status === 422 && c1.body.ok === false && /Every month must be locked/.test(c1.body.error) && c1.body.refusals.length >= 1
    && X.T.periods.filter((p) => p.fiscal_year === '2026-27').every((p) => p.status === 'open'), JSON.stringify(c1.body));
  /* 3 · refused: Suspense not nil (an opening that does not balance) */
  const op = await q('POST', '/opening', { date: '2026-04-01', rows: [{ code: codeOfRole('cash'), dr_minor: 50000 }] });
  ok('an opening 500 short of balancing puts it in Suspense', op.status === 200 && op.body.suspense_minor === 50000, JSON.stringify(op.body));
  for (let p = 1; p <= 12; p++) await q('POST', '/periods/2026-27/' + p + '/lock', { reason: 'month done' });
  const c2 = await q('POST', '/year/2026-27/close', {});
  ok('close with every month locked but Suspense not nil → 422 naming Suspense', c2.status === 422 && c2.body.refusals.some((r) => r.name === 'suspense_not_nil' && /Suspense is not nil/.test(r.why)) && !c2.body.refusals.some((r) => r.name === 'months_open'), JSON.stringify(c2.body));
  ok('…and nothing is closed: no month is hard-locked', X.T.periods.filter((p) => p.fiscal_year === '2026-27').every((p) => p.status !== 'hard_locked'));
  WHO = STAFF; const c3 = await q('POST', '/year/2026-27/close', {}); WHO = OWNER;
  ok('a co-assist cannot close a year (403)', c3.status === 403);
  /* 4 · clear Suspense (the missing side of the opening: capital), then close */
  await q('POST', '/periods/2026-27/0/unlock', { reason: 'balance the opening' });
  const fix = await q('POST', '/opening', { date: '2026-04-01', rows: [{ code: codeOfRole('capital') || '3000', cr_minor: 50000 }] });
  ok('the other side of the opening goes in; Suspense is nil again', fix.status === 200, JSON.stringify(fix.body));
  const tbBefore = await q('GET', '/trial-balance?asOf=2027-03-31');
  const cashBefore = tbBefore.body.rows.find((r) => r.code === codeOfRole('cash'));
  const ok1 = await q('POST', '/year/2026-27/close', {});
  ok('CLOSE → 200: the year is closed, the next is 2027-28, thirteen rows locked, the opening is the engine carry-forward', ok1.status === 200 && ok1.body.ok && ok1.body.next === '2027-28' && ok1.body.locked === 13 && ok1.body.opening.balanced === true && ok1.body.opening.rows > 0, JSON.stringify(ok1.body));

  const per = await q('GET', '/periods?fy=2026-27');
  ok('every month and the brought-forward row are hard_locked (a status, never an edit)', per.body.periods.length === 13 && per.body.periods.every((p) => p.status === 'hard_locked'), JSON.stringify(per.body.periods.map((p) => p.status)));
  const per2 = await q('GET', '/periods?fy=2027-28');
  ok('…and the next year\'s months exist, open', per2.body.periods.length === 13 && per2.body.periods.every((p) => p.status === 'open'));
  ok('…the close is in the change log', X.T.changes.some((c) => c.field === 'year_closed' && c.row_id === '2026-27'));
  const dup = await q('POST', '/year/2026-27/close', {});
  ok('a second close is IDEMPOTENT: duplicate, nothing more written', dup.status === 200 && dup.body.duplicate === true && X.T.changes.filter((c) => c.field === 'year_closed').length === 1, JSON.stringify(dup.body));
  const st = await q('GET', '/year/2026-27/status');
  ok('status of a closed year: closed, no refusals', st.body.closed === true && st.body.can_close === false && st.body.refusals.length === 0);
  /* 5 · the new year opens on the carry-forward */
  const tb = await q('GET', '/trial-balance?asOf=2027-04-05');
  const cash = tb.body.rows.find((r) => r.code === codeOfRole('cash'));
  ok('the new year\'s trial balance balances and opens with last year\'s cash', tb.status === 200 && tb.body.balanced === true && cash && cashBefore && cash.dr_minor === cashBefore.dr_minor, JSON.stringify([cash, cashBefore]));
  ok('…the year\'s profit sits in Retained earnings (no P&L account carried)', tb.body.rows.some((r) => r.code === '3900') && !tb.body.rows.some((r) => /^(4|5)/.test(String(r.code))), JSON.stringify(tb.body.rows.map((r) => r.code)));
  /* 6 · a closed year refuses a typed date, moves an automatic one */
  const ty = await q('POST', '/contra', { from: 'cash', to: 'bank', amount: 10, date: '2026-09-10' });
  ok('a typed date in the closed year → 409 YEAR_CLOSED, in words', ty.status === 409 && ty.body.code === 'YEAR_CLOSED' && /year is closed/i.test(ty.body.error), JSON.stringify(ty.body));
  const late = await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-12', currency: 'INR', party: CUST, source_ref: 'chit:late', by_rate: [{ rate: 5, taxable: 100, cgst: 2.5, sgst: 2.5, igst: 0 }], paid: {}, round_off: 0 });
  ok('a bill that arrives for the closed year posts on the first open day of the new one (2027-04-01), its own date kept', late.ok && late.moved === true && late.posting_date === '2027-04-01'
    && X.T.entries.find((e) => e.source_ref === 'chit:late').doc_date === '2026-09-12', JSON.stringify(late));
  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

/**
 * books-loans-lodged-reads.test.cjs — GET /api/books/loans (the bank line's loan picker) and GET /api/books/gst/lodged (the net each tax close of a year declared lodged carried).
 * Proves: both are money reads (the ONE moneyReader gate: owner · live grant · the shop's auditor read; staff, key-bearer refused 403 OWNER_ONLY) · /loans answers ref, lender, opening, outstanding, currency, taken_on from the ledger read
 * (S.loanBalances, the same one FIN-92's cap asks), paged with the page-limit envelope and capped at the server maximum · the lender comes back out of the narration · /gst/lodged answers its carried list with closed_at, never a lodged_at.
 * The SQL itself is run live (sit-root); here the route, the gate, the shape and the page.
 * Run: node tests/books-loans-lodged-reads.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const AU = 'aaaaaaaa-1111-4111-8111-111111111111';
const owner = { identity_id: AU, identity_type: 'entity', display_name: 'Bondi Grocer' };
const actor = (n, extra) => Object.assign({ identity_id: '5555555' + n + '-0000-4000-8000-000000000000', parent_entity_id: AU, identity_type: 'actor' }, extra || {});
let WHO = owner, GRANT = null, KEY = null;
const authStub = Object.assign((req, res, next) => { req.identity = WHO; if (KEY) req.api_key = KEY; if (GRANT) req.acting_for_grant = GRANT; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, p) => new Promise((done) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
});
(async () => {
  console.log('\n== GET /loans and GET /gst/lodged ==\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const CAN = {}; const realQuery = X.db.query;
  X.db.query = async (t, p) => /SELECT can_see_costs FROM identities WHERE identity_id = [$]1/.test(String(t)) ? { rows: p[0] in CAN ? [{ can_see_costs: CAN[p[0]] }] : [] } : realQuery(t, p);
  const S = require(path.join(H.API, 'lib', 'books-store'));
  const ROWS = [
    { ref: 'HDFC-77', narration: 'Loan from HDFC Bank at 9.5% a year', opening_minor: 50000000, outstanding_minor: 41000000, currency: 'AUD', taken_on: '2026-08-01' },
    { ref: 'UNCLE', narration: 'Loan from Uncle Raj', opening_minor: 1000000, outstanding_minor: 1000000, currency: 'AUD', taken_on: '2026-07-01' },
    { ref: 'OLD', narration: 'Loan from CBA', opening_minor: 900000, outstanding_minor: 0, currency: 'AUD', taken_on: '2026-06-01' },
  ];
  let LAST = null;
  S.loanBalances = async (db, e, roles, opt) => { LAST = { roles, opt }; const page = opt && opt.page; return { total: ROWS.length, rows: page ? ROWS.slice(page.offset, page.offset + page.limit) : ROWS }; };
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  await new Promise((done) => { const r = http.request({ host: '127.0.0.1', port, path: '/api/books/enable', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 2 } }, (res) => { res.resume(); res.on('end', done); }); r.end('{}'); });
  const ask = async (who, route, extra) => { WHO = who; GRANT = (extra && extra.grant) || null; KEY = (extra && extra.key) || null; try { return await call(port, '/api/books' + route); } finally { WHO = owner; GRANT = null; KEY = null; } };
  const EDITOR = actor(1, { access_level: 'editor' }), AUDITOR = actor(3, { whole_entity: true });
  CAN[AUDITOR.identity_id] = true; CAN[EDITOR.identity_id] = true;

  for (const route of ['/loans', '/gst/lodged']) {
    const base = await ask(owner, route);
    ok(route + ': the owner reads', base.status === 200, base.status + ' ' + JSON.stringify(base.body).slice(0, 200));
    const staff = await ask(EDITOR, route);
    ok(route + ': a staff seat is refused 403 OWNER_ONLY in words', staff.status === 403 && staff.body.code === 'OWNER_ONLY' && /owner or the shop's auditor/.test(staff.body.detail || ''), staff.status + ' ' + JSON.stringify(staff.body).slice(0, 160));
    const key = await ask(owner, route, { key: 'k' });
    ok(route + ': a key-bearer is refused', key.status === 403 && key.body.code === 'OWNER_ONLY', String(key.status));
    const aud = await ask(AUDITOR, route);
    ok(route + ': the shop auditor reads the same answer', aud.status === 200 && JSON.stringify(aud.body) === JSON.stringify(base.body), String(aud.status));
    const grant = await ask(actor(6, { whole_entity: true }), route, { grant: 'g1' });
    ok(route + ': a live auditor grant reads', grant.status === 200, String(grant.status));
  }

  const all = await ask(owner, '/loans');
  ok('/loans: every loan, each with ref, lender, opening, outstanding, currency, taken_on', all.status === 200 && all.body.loans.length === 3 && all.body.total === 3
    && JSON.stringify(Object.keys(all.body.loans[0]).sort()) === JSON.stringify(['currency', 'lender', 'opening_minor', 'outstanding_minor', 'ref', 'taken_on']), JSON.stringify(all.body).slice(0, 240));
  ok('/loans: no page asked = the FIRST PAGE at the default size (100), never every row: page 1, limit 100, total 3', all.body.page === 1 && all.body.limit === 100 && all.body.total === 3 && LAST && LAST.opt.page && LAST.opt.page.limit === 100 && LAST.opt.page.offset === 0, JSON.stringify(all.body).slice(0, 200));
  ok('/loans: the lender comes back out of the narration, with or without a rate', all.body.loans[0].lender === 'HDFC Bank' && all.body.loans[1].lender === 'Uncle Raj');
  ok('/loans: the figures are the ledger read, whole minor units, with their currency', all.body.loans[0].outstanding_minor === 41000000 && all.body.loans[0].opening_minor === 50000000 && all.body.loans.every((l) => l.currency === 'AUD'));
  ok('/loans: asks the ledger read for the three loan roles only', LAST && ['secured_loan', 'unsecured_loan', 'bank_od'].every((r) => LAST.roles.indexOf(r) >= 0) && LAST.roles.length === 3);
  const p2 = await ask(owner, '/loans?limit=2&page=2');
  ok('/loans: a page is a page (limit 2, page 2 = the third loan) with total, page, limit', p2.body.loans.length === 1 && p2.body.loans[0].ref === 'OLD' && p2.body.total === 3 && p2.body.page === 2 && p2.body.limit === 2, JSON.stringify(p2.body).slice(0, 200));
  const big = await ask(owner, '/loans?limit=99999');
  ok('/loans: a page size past the server maximum is refused 422 (col 16 limit bound, 18 Nov: it was capped before)', big.status === 422, JSON.stringify(big.body).slice(0, 200));

  const lodged = await ask(owner, '/gst/lodged');
  ok('/gst/lodged: a shop with no declared year answers an empty list with the close-date note, never a lodged_at', lodged.status === 200 && Array.isArray(lodged.body.periods) && lodged.body.periods.length === 0 && !/lodged_at/.test(JSON.stringify(lodged.body)) && /not the lodgement date/.test(lodged.body.note || ''), JSON.stringify(lodged.body).slice(0, 240));
  srv.close();
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

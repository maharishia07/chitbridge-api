/**
 * books-ledger-reads-gate.test.cjs — SEC-161; BOOKS-GATE adds /pl, /bs and /year/:fy/status (OWASP API5:2023 function-level authorisation; ISO 27001 A.5.15): GET /api/books/trial-balance and GET /api/books/periods carried only `auth, on`, so ANY signed-in
 * seat of the shop read the ledger's money. They now take the SAME reader test as /cashflow and /returns (owner · a live grant · the shop's own auditor = whole-entity + can_see_costs).
 * Proves: the owner is unchanged (positive control, same bytes) · a plain staff seat (editor and viewer) is refused 403 OWNER_ONLY with the sentence, BEFORE the ledger switch · a key-bearer is refused ·
 * a whole-entity login whose row says can_see_costs reads · an auditor GRANT (acting_for_grant, as middleware/books-grant sets it) reads · a request that is neither refuses.
 * Run: node tests/books-ledger-reads-gate.test.cjs
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
  console.log('\n══ SEC-161 · ledger money reads: trial balance and periods ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const CAN = {}; const realQuery = X.db.query;
  X.db.query = async (t, p) => /SELECT can_see_costs FROM identities WHERE identity_id = [$]1/.test(String(t)) ? { rows: p[0] in CAN ? [{ can_see_costs: CAN[p[0]] }] : [] } : realQuery(t, p);
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  await new Promise((done) => { const b = '{}'; const r = http.request({ host: '127.0.0.1', port, path: '/api/books/enable', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 2 } }, (res) => { res.resume(); res.on('end', done); }); r.end(b); });
  const ask = async (who, route, extra) => { WHO = who; GRANT = (extra && extra.grant) || null; KEY = (extra && extra.key) || null; try { return await call(port, '/api/books' + route); } finally { WHO = owner; GRANT = null; KEY = null; } };
  const EDITOR = actor(1, { access_level: 'editor' }), VIEWER = actor(2, { access_level: 'viewer' }), AUDITOR = actor(3, { whole_entity: true }), REPORTS = actor(4, { whole_entity: true }), PLAIN_COSTS = actor(5, { access_level: 'editor' });
  CAN[AUDITOR.identity_id] = true; CAN[REPORTS.identity_id] = false; CAN[EDITOR.identity_id] = true; CAN[PLAIN_COSTS.identity_id] = true; CAN['55555556-0000-4000-8000-000000000000'] = true;
  for (const route of ['/daybook?from=2026-07-01&to=2026-07-31', '/trial-balance', '/pl?from=2026-07-01&to=2026-07-31', '/bs?asOf=2026-07-31', '/year/2026/status']) {
    const base = await ask(owner, route);
    ok(route + ': the owner reads (positive control)', base.status === 200, String(base.status) + ' ' + JSON.stringify(base.body).slice(0, 160));
    for (const [name, who, extra] of [['staff editor', EDITOR], ['staff viewer', VIEWER], ['staff editor with can_see_costs but not whole-entity', PLAIN_COSTS], ['whole-entity without can_see_costs', REPORTS], ['a key-bearer', owner, { key: 'k' }]]) {
      const r = await ask(who, route, extra);
      ok(route + ': ' + name + ' is refused 403 OWNER_ONLY with a sentence', r.status === 403 && r.body.code === 'OWNER_ONLY' && typeof r.body.detail === 'string' && /owner or the shop's auditor/.test(r.body.detail), String(r.status) + ' ' + JSON.stringify(r.body).slice(0, 200));
    }
    const a = await ask(AUDITOR, route);
    ok(route + ': the shop auditor (whole-entity + can_see_costs) reads, same answer as the owner', a.status === 200 && JSON.stringify(a.body) === JSON.stringify(base.body), String(a.status));
    const g = await ask(actor(6, { whole_entity: true }), route, { grant: 'grant-1' });
    ok(route + ': an auditor grant (acting_for_grant) reads', g.status === 200 && JSON.stringify(g.body) === JSON.stringify(base.body), String(g.status));
  }
  /* STAFF-BOOKS: the months list is not money. Every signed-in seat reads the boundaries and lock state (the Day book's period picker); the figures stay for the money readers; a key-bearer is still refused. */
  const baseMonths = await ask(owner, '/periods');
  ok('/periods: the owner reads the full reply, figures included (positive control)', baseMonths.status === 200 && baseMonths.body.periods.length > 0 && baseMonths.body.periods.every((m) => 'sales_minor' in m), String(baseMonths.status) + ' ' + JSON.stringify(baseMonths.body).slice(0, 200));
  for (const [name, who] of [['staff editor', EDITOR], ['staff viewer', VIEWER], ['staff editor with can_see_costs but not whole-entity', PLAIN_COSTS], ['whole-entity without can_see_costs', REPORTS]]) {
    const r = await ask(who, '/periods?marks=1');
    const same = baseMonths.body.periods.map((m) => m.fiscal_year + '/' + m.period + '/' + m.status + '/' + m.start_date + '/' + m.end_date).join();
    ok('/periods: ' + name + ' reads the months with no figures', r.status === 200 && r.body.periods.length === baseMonths.body.periods.length && r.body.periods.every((m) => !('sales_minor' in m)) && !/sales_minor/.test(JSON.stringify(r.body)), String(r.status) + ' ' + JSON.stringify(r.body).slice(0, 200));
    ok('/periods: ' + name + ' sees the same boundaries and lock state as the owner', r.status === 200 && r.body.periods.map((m) => m.fiscal_year + '/' + m.period + '/' + m.status + '/' + m.start_date + '/' + m.end_date).join() === same && JSON.stringify(r.body.years) === JSON.stringify(baseMonths.body.years));
  }
  const keyed = await ask(owner, '/periods', { key: 'k' });
  ok('/periods: a key-bearer is refused 403 OWNER_ONLY', keyed.status === 403 && keyed.body.code === 'OWNER_ONLY', String(keyed.status));
  const auditorMonths = await ask(AUDITOR, '/periods');
  ok('/periods: the shop auditor reads the full reply, same as the owner', auditorMonths.status === 200 && JSON.stringify(auditorMonths.body) === JSON.stringify(baseMonths.body));
  for (const route of ['/dues', '/accounts'] /* the day book left this list: it follows the trial balance's reader gate (A02, 20 Nov) */) {
    const st = await ask(EDITOR, route);
    ok(route + ': a staff editor still reads (the shop work, cost-blinded inside; BOOKS-GATE decision)', st.status === 200, String(st.status) + ' ' + JSON.stringify(st.body).slice(0, 160));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  srv.close(); process.exit(fail ? 1 : 0);
})();

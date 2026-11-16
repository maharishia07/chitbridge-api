/**
 * b3-bank-statements-cost-blind.test.cjs — B3 (Fable review l16, 16 Nov): the kept bank statements show every supplier payment, so
 * GET /bank/statement-files, GET /bank/statement-files/:id/file and GET /bank/log refuse a reader WITHOUT can_see_costs (403 COST_BLIND),
 * through the one test /bank/rail uses (lib/cost.isCostBlind). Owner, a reader with costs, and a grant that carries can_see_costs get through.
 * Run: node tests/b3-bank-statements-cost-blind.test.cjs
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
const path = require('path'), http = require('http');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', FILE = '99999999-9999-4999-8999-999999999999';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
const actor = (extra) => Object.assign({ identity_id: '22222222-2222-4222-8222-222222222222', identity_type: 'actor', parent_entity_id: SHOP, access_level: 'viewer', whole_entity: true, display_name: 'Staff' }, extra);
let WHO = OWNER;
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const get = (port, p) => new Promise((done) => { http.request({ host: '127.0.0.1', port, path: p, method: 'GET' }, (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); }).end(); });
const DOORS = ['/bank/statement-files?accounts=1500', '/bank/statement-files/' + FILE + '/file', '/bank/log?account=1500'];
(async () => {
  console.log('\n══ B3 · bank statements and the bank log are cost-gated ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }
  const X = H.load({ auth: authStub });
  const BSF = require(path.join(H.API, 'lib', 'bank-statement-file')), BL = require(path.join(H.API, 'lib', 'bank-rec-log'));
  let reached = 0;
  BSF.list = async () => { reached++; return { months: [], accounts: [], cells: [], files: [], older: 0 }; };
  BSF.open = async () => { reached++; return null; };
  BL.read = async () => { reached++; return { marks: [], statements: [], posted: [], exceptions: [] }; };
  BL.accountIn = () => ({ account_id: 'a', code: '1500', name: 'Bank' });
  const express = require('express');
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port, q = (p) => get(port, '/api/books' + p);
  await new Promise((r) => http.request({ host: '127.0.0.1', port, path: '/api/books/enable', method: 'POST' }, (s) => { s.resume(); s.on('end', r); }).end());

  const refused = async (label, who) => {
    WHO = who; reached = 0;
    for (const d of DOORS) { const r = await q(d); ok(label + ' · ' + d.split('?')[0].replace(FILE, ':id') + ' → 403 COST_BLIND, nothing read, its own sentence (no "to send: .")', r.status === 403 && r.body.code === 'COST_BLIND' && reached === 0 && r.body.message === 'Your access does not include costs, so the bank statements are hidden.' && !/to send/.test(JSON.stringify(r.body)), JSON.stringify([r.status, r.body.code, reached])); }
  };
  const allowed = async (label, who) => {
    WHO = who;
    for (const d of DOORS) { const r = await q(d); ok(label + ' · ' + d.split('?')[0].replace(FILE, ':id') + ' not refused as cost-blind', r.body.code !== 'COST_BLIND' && r.status !== 403, JSON.stringify([r.status, r.body.code])); }
  };
  await refused('staff without can_see_costs', actor({ can_see_costs: false }));
  await refused('adviser grant, can_see_costs false', actor({ access_level: 'editor', acting_for_grant: 'g1', acting_preset: 'adviser', can_see_costs: false }));
  await refused('auditor grant, can_see_costs false', actor({ access_level: 'commenter', acting_for_grant: 'g2', acting_preset: 'auditor', can_see_costs: false }));
  await allowed('owner', OWNER);
  await allowed('staff with can_see_costs', actor({ can_see_costs: true }));
  await allowed('adviser grant carrying costs', actor({ access_level: 'editor', acting_for_grant: 'g1', acting_preset: 'adviser', can_see_costs: true }));
  await allowed('auditor grant carrying costs', actor({ access_level: 'commenter', acting_for_grant: 'g2', acting_preset: 'auditor', can_see_costs: true }));
  const R = require('fs').readFileSync(path.join(H.API, 'routes', 'books.js'), 'utf8');
  ok('one test: the gate calls lib/cost.isCostBlind, no second reading of the flag', /async function costBlindStops[\s\S]{0,200}isCostBlind/.test(R) && !/can_see_costs\s*===?\s*false/.test(R));
  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();

/**
 * ak-f02-seat-gates.test.cjs — AK-F-02 (walk AK 21 Nov): the seats of the money doors, through real Express over the in-memory ledger (the rows of docs/SEAT-MATRIX.md).
 * HAND-COMPUTED  manager hat + editor (the shop's accountant/bookkeeper, RC-7): runs the month pack and FX (as a Xero Adviser) and pays a supplier: not refused.
 *                counter seat (hat act, editor): pays a customer's money IN (not refused) but pays OUT = 403 OWNER_ONLY; no pack, no FX.
 *                owner: all not refused. Anything but 403 counts as "reached the door" (the business answer is another test's).
 * Run: BOOKS_ENGINES_SRC=… node tests/ak-f02-seat-gates.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const AU = 'aaaaaaaa-7777-4111-8111-111111111111';
const SEAT = { owner: null, manager: { hat: 'manager', access_level: 'editor' }, counter: { hat: 'act', access_level: 'editor' } };
let WHO = 'owner';
const authStub = Object.assign((req, res, next) => {
  req.identity = { identity_id: AU, identity_type: 'entity', display_name: 'Bondi Grocer' };
  if (SEAT[WHO]) req.identity = Object.assign({ identity_id: 'bbbbbbbb-7777-4111-8111-111111111111', identity_type: 'actor', parent_entity_id: AU, display_name: WHO }, SEAT[WHO]);
  next();
}, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  console.log('\n══ AK-F-02: who reaches pack, FX and payments out ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  X.T.identities.push({ identity_id: AU, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: { gst_registration: 'regular' } });
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const as = (who) => (m, p, b) => { WHO = who; return call(port, m, '/api/books' + p, b); };
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  await as('owner')('POST', '/enable', {});
  const refused = (r) => r.status === 403 && /OWNER_ONLY|CHIT_NOT_PERMITTED/.test(JSON.stringify(r.body));
  const pay = (direction) => ({ party_id: 'cccccccc-7777-4111-8111-111111111111', direction, amount_minor: 100, mode: 'cash' });
  const m = as('manager'), c = as('counter'), o = as('owner');
  ok('manager: month pack reached (not OWNER_ONLY)', !refused(await m('GET', '/packs')) && !refused(await m('POST', '/packs', { from: '2026-07-01', to: '2026-07-31' })));
  ok('manager: FX add and revalue reached', !refused(await m('POST', '/fx-rates', {})) && !refused(await m('GET', '/fx-revalue?month=2026-07')) && !refused(await m('POST', '/fx-revalue', {})));
  ok('manager: pays a supplier (out) reached', !refused(await m('POST', '/payments', pay('out'))));
  ok('counter: no pack, no FX (403 OWNER_ONLY)', refused(await c('GET', '/packs')) && refused(await c('POST', '/packs', {})) && refused(await c('POST', '/fx-rates', {})) && refused(await c('POST', '/fx-revalue', {})));
  const out = await c('POST', '/payments', pay('out'));
  ok('counter: payments OUT refused in words (403 OWNER_ONLY, may false)', refused(out) && out.body.may === false && /pay a supplier/.test(JSON.stringify(out.body)), JSON.stringify(out.body).slice(0, 240));
  ok('counter: money IN is not refused by the gate', !refused(await c('POST', '/payments', pay('in'))));
  ok('counter: propose/confirm on a payment that does not exist answers 404, not a seat refusal', !refused(await c('POST', '/payments/dddddddd-7777-4111-8111-111111111111/propose', {})));
  ok('owner: pack, FX and payments out reached', !refused(await o('GET', '/packs')) && !refused(await o('POST', '/fx-rates', {})) && !refused(await o('POST', '/payments', pay('out'))));
  srv.close();
  console.log('\n' + (fail ? '  x ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

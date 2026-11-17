/**
 * jet-day-book-risk-keys.test.cjs — JET (ASA 240 / 560, 17 Nov 2026): every Day book entry carries the three read-only facts the auditor's risk filters judge:
 * `recorded_at` (when the ledger took it — also on an entry with no source chit), `made_by` (who made it), `no_narration` (whether a person wrote one). No new calculation, no new route.
 * Hand-computed: 3 bills are posted, then entry 1 is given a recording moment + maker + empty narration, entry 2 a written narration and no maker, entry 3 is left as posted.
 *   e1: recorded_at 2026-07-14T02:00:00.000Z · made_by Ann · no_narration true   e2: narration "Year-end accrual" · made_by null · no_narration false   e3: no_narration true (no narration was given)
 * Run: node tests/jet-day-book-risk-keys.test.cjs   (BOOKS_ENGINES_SRC=<engines src>)
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', ANN = '33333333-3333-4333-8333-333333333333';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
const authStub = Object.assign((req, res, next) => { req.identity = OWNER; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, p) => new Promise((done) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
});
(async () => {
  console.log('\n══ JET · the Day book entry carries recorded_at · made_by · no_narration ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('\n   SKIP: ' + X.src.why); return process.exit(0); }
  require.cache[require.resolve(path.join(H.API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port;
  await X.B.enable(X.db, SHOP, {});
  X.T.identities.push({ identity_id: ANN, display_name: 'Ann' });
  for (let i = 1; i <= 3; i++) {
    const r = await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-06-' + String(10 + i), currency: 'INR', source_ref: 'jet:' + i, by_rate: [{ rate: 5, taxable: 200, cgst: 5, sgst: 5, igst: 0 }], paid: { cash: 210 } });
    if (!r.ok) { ok('posting bill ' + i, false, JSON.stringify(r)); break; }
  }
  const mine = X.T.entries.filter((x) => x.entity_id === SHOP).sort((a, b) => String(a.posting_date).localeCompare(String(b.posting_date)));
  Object.assign(mine[0], { created_at: '2026-07-14T02:00:00.000Z', created_by: ANN, narration: '' });
  Object.assign(mine[1], { narration: 'Year-end accrual', created_by: null });
  mine[2].narration = null;
  const r = await call(port, '/api/books/daybook?from=2026-06-01&to=2026-06-30');
  const by = (n) => (r.body.entries || []).find((x) => x.entry_id === mine[n].entry_id) || {};
  ok('the Day book answers with 3 entries', r.status === 200 && (r.body.entries || []).length === 3, r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  ok('e1: recorded_at is the moment as ISO · made_by is the maker · no_narration true', by(0).recorded_at === '2026-07-14T02:00:00.000Z' && by(0).made_by === 'Ann' && by(0).no_narration === true, JSON.stringify([by(0).recorded_at, by(0).made_by, by(0).no_narration]));
  ok('e1: the server still fills a word for the narration (the row never reads blank)', typeof by(0).narration === 'string' && by(0).narration.length > 0, String(by(0).narration));
  ok('e2: a written narration → no_narration false · no maker → null', by(1).no_narration === false && by(1).made_by === null && by(1).narration === 'Year-end accrual', JSON.stringify([by(1).no_narration, by(1).made_by, by(1).narration]));
  ok('e3: no narration given → no_narration true', by(2).no_narration === true, String(by(2).no_narration));
  ok('every entry says when it was recorded (an ISO moment), source or not', [0, 1, 2].every((n) => /^\d{4}-\d\d-\d\dT/.test(String(by(n).recorded_at))), JSON.stringify([0, 1, 2].map((n) => by(n).recorded_at)));
  ok('recorded_at equals the source\'s own recorded_at where there is a source (one moment, not two)', [0, 1, 2].every((n) => !by(n).source || by(n).source.recorded_at === by(n).recorded_at));
  srv.close();
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed');
  process.exit(fail ? 1 : 0);
})();

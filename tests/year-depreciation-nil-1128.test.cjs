/**
 * tests/year-depreciation-nil-1128.test.cjs — F3 LEFT (2), batch 1128: an asset whose depreciation for the year is 0 still passes the year-close gate (the run writes its marker).
 * An Indian shop holds one asset of 0.01 (cost_minor 1, in use 2026-04-18): the year amount rounds to 0, so the run posts NO entry.
 *   - before the run the close names depreciation_not_run (422); after it (nothing_to_post) one marker (depreciation, depreciation:2026-27, run_nil) is logged, no entry posted, the year closes (200)
 * Needs the books engines (BOOKS_ENGINES_SRC or the sibling ../chitbridge-engines/src). Run: node tests/year-depreciation-nil-1128.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-9999-4111-8111-111111111111';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' }; next(); }, {
  entityOf: (req) => req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
/** an in-memory asset register with the real module functions (b280 stood in) */
function memoryRegister() {
  const rows = []; let seq = 0;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  return { rows, store: {
    async exists() { return true; },
    async list(h, e) { return clone(rows.filter((r) => r.entity === e)); },
    async get(h, e, id) { const r = rows.find((x) => x.entity === e && x.asset_id === id); return r ? clone(r) : null; },
    async bySourceEntry(h, e, entry, name) { const r = rows.find((x) => x.entity === e && x.source_entry_id === entry && x.name === name); return r ? clone(r) : null; },
    async insert(h, e, a) {
      const r = { entity: e, asset_id: '55555555-5555-4555-8555-' + String(++seq).padStart(12, '0'), name: a.name, asset_class: a.asset_class, cost_minor: a.cost_minor, currency: a.currency || 'INR',
        put_to_use: a.put_to_use, source_entry_id: a.source_entry_id || null, source_chit_id: null, accumulated_minor: 0, last_dep_fy: null, disposed_on: null, disposal_entry_id: null, proceeds_minor: null, created_by: a.by || null };
      rows.push(r); return clone(r);
    },
    async addDepreciation(h, e, id, minor, fy) { const r = rows.find((x) => x.entity === e && x.asset_id === id); if (r && r.last_dep_fy !== fy) { r.accumulated_minor += minor; r.last_dep_fy = fy; } },
    async markDisposed() { return true; },
  } };
}

(async () => {
  console.log('\n== F3 LEFT: a nil depreciation run satisfies the year-close gate ==\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  X.T.identities.push({ identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Bhavan', country: 'IN', policy_flags: { price_includes_tax: 'no' } });
  const Assets = require(path.join(H.API, 'lib', 'books-assets')), reg = memoryRegister(); Assets.use(reg.store);
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  let DAY = '2027-04-10'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));
  const FY = '2026-27';
  await X.store.saveSetting(X.db, SHOP, { enabled: false });
  ok('the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  const bought = await q('POST', '/assets', { name: 'Sticker', class: 'computers', cost: 0.01, date: '2026-04-18', how: 'bank' });
  ok('a 0.01 asset is bought and registered (cost_minor 1)', bought.status === 200 && reg.rows.length === 1 && reg.rows[0].cost_minor === 1, JSON.stringify(bought.body));
  for (let p = 1; p <= 12; p++) await q('POST', '/periods/' + FY + '/' + p + '/lock', { reason: 'month done' });
  const c0 = await q('POST', '/year/' + FY + '/close', {});
  ok('before the run: close is 422 depreciation_not_run', c0.status === 422 && /Run depreciation for 2026-27 first/.test(c0.body.message), JSON.stringify(c0.body));
  await q('POST', '/periods/' + FY + '/12/unlock', { reason: 'run the depreciation' });
  const entries0 = X.T.entries.length;
  const run = await q('POST', '/depreciation/run', { fy: FY });
  ok('the run answers nothing_to_post (200): the year amount is 0', run.status === 200 && run.body.nothing_to_post === true, JSON.stringify(run.body));
  ok('no journal entry posted, one run_nil marker', X.T.entries.length === entries0 && X.T.changes.filter((c) => c.table_name === 'depreciation' && c.field === 'run_nil' && c.row_id === 'depreciation:' + FY).length === 1, JSON.stringify(X.T.changes.slice(-2)));
  await q('POST', '/periods/' + FY + '/12/lock', { reason: 'month done' });
  const s1 = await q('GET', '/year/' + FY + '/status');
  ok('status: no depreciation refusal, can_close true', !(s1.body.refusals || []).some((r) => r.name === 'depreciation_not_run') && s1.body.can_close === true, JSON.stringify(s1.body.refusals));
  const c1 = await q('POST', '/year/' + FY + '/close', {});
  ok('the year closes (200)', c1.status === 200 && c1.body.ok === true, JSON.stringify(c1.body));
  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

/**
 * tests/year-depreciation-f3.test.cjs — F3 (VERIFY-GF-MONEY-SECURITY, batch 1128): THE YEAR CLOSE REFUSES, IN WORDS, WHILE THE YEAR DEPRECIATION IS NOT RUN. Real Express over the in-memory ledger and register.
 * An Indian shop buys a computer (42,000.00 = 4200000 minor, 2026-04-18) and locks all twelve months of 2026-27:
 *   · status and close name `depreciation_not_run` (422 YEAR_CLOSE_REFUSED, the asset named), nothing hard-locked, can_close false
 *   · after the run (POST /depreciation/run) the close goes ahead (200); the register accumulated figure and the posted entry debit are the same carried total (compared, not computed twice)
 *   · a shop with NO fixed assets closes as before (books-year.test.cjs, books-year-country.test.cjs, unchanged)
 * Needs the books engines (BOOKS_ENGINES_SRC or the sibling ../chitbridge-engines/src). Run: node tests/year-depreciation-f3.test.cjs
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
  console.log('\n== F3: the year close needs the year depreciation ==\n');
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
  const FY = '2026-27', rows = () => X.T.periods.filter((p) => p.entity_id === SHOP && p.fiscal_year === FY);

  await X.store.saveSetting(X.db, SHOP, { enabled: false });
  ok('the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  const bought = await q('POST', '/assets', { name: 'Laptop', class: 'computers', cost: 42000, date: '2026-04-18', how: 'bank' });
  ok('a computer of 42,000.00 is bought and registered', bought.status === 200 && reg.rows.length === 1 && reg.rows[0].cost_minor === 4200000, JSON.stringify(bought.body));
  for (let p = 1; p <= 12; p++) await q('POST', '/periods/' + FY + '/' + p + '/lock', { reason: 'month done' });

  const s0 = await q('GET', '/year/' + FY + '/status');
  const dep = (s0.body.refusals || []).find((r) => r.name === 'depreciation_not_run');
  ok('status: depreciation_not_run, in words, naming the asset; can_close false', dep && /Run depreciation for 2026-27 first/.test(dep.why) && /Laptop/.test(dep.why) && s0.body.can_close === false, JSON.stringify(s0.body.refusals));
  const c0 = await q('POST', '/year/' + FY + '/close', {});
  ok('close → 422 YEAR_CLOSE_REFUSED with the same words, nothing hard-locked', c0.status === 422 && c0.body.code === 'YEAR_CLOSE_REFUSED' && /Run depreciation for 2026-27 first/.test(c0.body.message) && rows().every((p) => p.status !== 'hard_locked'), JSON.stringify(c0.body));

  /* the run needs an open year-end month: the owner opens March, runs, locks again (newest first) */
  await q('POST', '/periods/' + FY + '/12/unlock', { reason: 'run the depreciation' });
  const run = await q('POST', '/depreciation/run', { fy: FY });
  ok('depreciation runs (200) and posts one entry', run.status === 200 && run.body.ok === true && run.body.entry_no, JSON.stringify(run.body));
  await q('POST', '/periods/' + FY + '/12/lock', { reason: 'month done' });
  const posted = X.T.lines.filter((l) => l.entity_id === SHOP && l.entry_id === run.body.entry_id).reduce((s, l) => s + Number(l.dr_minor), 0);
  ok('the register carries what the entry posted (one carried total: debit side = accumulated)', posted > 0 && reg.rows[0].accumulated_minor === posted, JSON.stringify([posted, reg.rows[0].accumulated_minor]));
  const s1 = await q('GET', '/year/' + FY + '/status');
  ok('status: no depreciation refusal now, can_close true', !(s1.body.refusals || []).some((r) => r.name === 'depreciation_not_run') && s1.body.can_close === true, JSON.stringify(s1.body.refusals));
  const c1 = await q('POST', '/year/' + FY + '/close', {});
  ok('the year closes (200)', c1.status === 200 && c1.body.ok === true, JSON.stringify(c1.body));
  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

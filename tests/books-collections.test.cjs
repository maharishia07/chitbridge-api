/**
 * books-collections.test.cjs — CB FINANCE · COLLECTIONS (F1): GET /dues?finance=1 adds credit_limit_minor · over_limit · interest_minor ·
 * last_remind; owner only (the server decides); the plain /dues is untouched; interest is SHOWN, never posted.
 * Needs the books engines. Run: node tests/books-collections.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', MALA = '22222222-2222-4222-8222-222222222222', RAVI = '55555555-5555-4555-8555-555555555555';
const mk = (id, extra) => Object.assign({ identity_id: id, identity_type: 'entity', display_name: 'Shop' }, extra || {});
let WHO = null;
const authFor = (who) => Object.assign((req, res, next) => { req.identity = WHO || who; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, p) => new Promise((done) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => { const b = []; res.on('data', (c) => b.push(c)); res.on('end', () => { let j = {}; try { j = JSON.parse(Buffer.concat(b).toString('utf8') || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
});
function serve(X) {
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); return { srv, q: (p) => call(srv.address().port, '/api/books' + p) };
}

(async () => {
  console.log('\n══ CB FINANCE · COLLECTIONS — /dues?finance=1 ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n\n  ✓ 0 passed · 0 checks\n'); process.exit(1); }
  const X = H.load({ auth: authFor(mk(SHOP)) });
  X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10, credit_limit_minor: 50000 },
    { owner: SHOP, party_id: RAVI, party_no: 'P-00002', name: 'Ravi', customer: true, credit_days: 10, credit_limit_minor: 900000 });
  const { srv, q } = serve(X);
  const en = await new Promise((d) => { const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/books/enable', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => d(res.statusCode)); }); r.end('{}'); });
  ok('the ledger switches on', en === 200, String(en));
  await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-08-01', currency: 'INR', party: MALA, source_chit_id: 'c0000000-0000-4000-8000-00000000000a', source_ref: 'chit:a',
    by_rate: [{ rate: 5, taxable: 1000, cgst: 25, sgst: 25, igst: 0 }], paid: {}, round_off: 0 });
  await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-10-09', currency: 'INR', party: RAVI, source_chit_id: 'c0000000-0000-4000-8000-00000000000b', source_ref: 'chit:b',
    by_rate: [{ rate: 5, taxable: 1000, cgst: 25, sgst: 25, igst: 0 }], paid: {}, round_off: 0 });

  const plain = await q('/dues?asOf=2026-10-10'), mala0 = (plain.body.parties || []).find((p) => p.party_id === MALA) || {};
  ok('plain /dues is untouched — no limit, no interest', plain.status === 200 && !('over_limit' in mala0) && !('interest_minor' in mala0), JSON.stringify(mala0));
  const f = await q('/dues?asOf=2026-10-10&finance=1'), by = {}; (f.body.parties || []).forEach((p) => { by[p.party_id] = p; });
  ok('finance=1 answers 200 with both customers', f.status === 200 && by[MALA] && by[RAVI], f.status + ' ' + JSON.stringify(f.body).slice(0, 200));
  ok('Mala: limit shown, balance over it → over_limit', by[MALA].credit_limit_minor === 50000 && by[MALA].balance_minor > 50000 && by[MALA].over_limit === true, JSON.stringify(by[MALA]));
  ok('Mala: bill long overdue → interest shown (> 0, an integer of minor units)', Number.isInteger(by[MALA].interest_minor) && by[MALA].interest_minor > 0, String(by[MALA].interest_minor));
  ok('Ravi: under his limit, not yet due → no flag, no interest', by[RAVI].over_limit === false && by[RAVI].interest_minor === 0, JSON.stringify(by[RAVI]));
  ok('last_remind is there (null until a Remind is recorded)', 'last_remind' in by[MALA] && by[MALA].last_remind === null);
  ok('interest is SHOWN only — no ledger entry was added by the read', X.T.items.length === 2, String(X.T.items.length));
  WHO = mk('99999999-9999-4999-8999-999999999999', { parent_entity_id: SHOP });
  const r = await q('/dues?finance=1');
  ok('not the owner → 403 with the sentence', r.status === 403 && /owner/i.test(r.body.message || ''), r.status + ' ' + JSON.stringify(r.body));
  srv.close();

  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed\n'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(e && e.stack || e); process.exit(1); });

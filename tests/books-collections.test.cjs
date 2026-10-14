/**
 * books-collections.test.cjs — CB FINANCE · COLLECTIONS (F1; FIN-R1 terms): GET /dues?finance=1 adds credit_limit_minor · over_limit · interest_minor ·
 * last_remind; owner only (the server decides); the plain /dues is untouched; interest is SHOWN, never posted.
 * Needs the books engines. Run: node tests/books-collections.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', MALA = '22222222-2222-4222-8222-222222222222', RAVI = '55555555-5555-4555-8555-555555555555', KAVI = '66666666-6666-4666-8666-666666666666';
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
    { owner: SHOP, party_id: RAVI, party_no: 'P-00002', name: 'Ravi', customer: true, credit_days: 10, credit_limit_minor: 900000 },
    { owner: SHOP, party_id: KAVI, party_no: 'P-00003', name: 'Kavi', customer: true, credit_days: 10, credit_limit_minor: null });
  const { srv, q } = serve(X);
  const en = await new Promise((d) => { const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/books/enable', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => d(res.statusCode)); }); r.end('{}'); });
  ok('the ledger switches on', en === 200, String(en));
  await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-08-01', currency: 'INR', party: MALA, source_chit_id: 'c0000000-0000-4000-8000-00000000000a', source_ref: 'chit:a',
    by_rate: [{ rate: 5, taxable: 1000, cgst: 25, sgst: 25, igst: 0 }], paid: {}, round_off: 0 });
  await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-10-09', currency: 'INR', party: RAVI, source_chit_id: 'c0000000-0000-4000-8000-00000000000b', source_ref: 'chit:b',
    by_rate: [{ rate: 5, taxable: 1000, cgst: 25, sgst: 25, igst: 0 }], paid: {}, round_off: 0 });

  await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-08-15', currency: 'INR', party: KAVI, source_chit_id: 'c0000000-0000-4000-8000-00000000000c', source_ref: 'chit:c',
    by_rate: [{ rate: 5, taxable: 1000, cgst: 25, sgst: 25, igst: 0 }], paid: {}, round_off: 0 });
  const plain = await q('/dues?asOf=2026-10-10'), mala0 = (plain.body.parties || []).find((p) => p.party_id === MALA) || {};
  ok('plain /dues is untouched — no limit, no interest', plain.status === 200 && !('over_limit' in mala0) && !('interest_minor' in mala0), JSON.stringify(mala0));
  const f = await q('/dues?asOf=2026-10-10&finance=1'), by = {}; (f.body.parties || []).forEach((p) => { by[p.party_id] = p; });
  ok('finance=1 answers 200 with every customer', f.status === 200 && by[MALA] && by[RAVI] && by[KAVI], f.status + ' ' + JSON.stringify(f.body).slice(0, 200));
  ok('Mala: limit shown, balance over it → over_limit', by[MALA].credit_limit_minor === 50000 && by[MALA].balance_minor > 50000 && by[MALA].over_limit === true, JSON.stringify(by[MALA]));
  ok('Mala: the limit is her own (credit_limit_from party)', by[MALA].credit_limit_from === 'party', JSON.stringify(by[MALA]));
  ok('FIN-R1: no interest terms anywhere → NOT SET (state not_set, no figure) — never a hidden 1.5%', by[MALA].interest_state === 'not_set' && by[MALA].interest_minor === null, JSON.stringify(by[MALA]));
  ok('Ravi: under his limit → no flag', by[RAVI].over_limit === false && by[RAVI].interest_state === 'not_set', JSON.stringify(by[RAVI]));
  ok('Kavi: no limit of his own and no shop default → not set (null, from null), never over', by[KAVI].credit_limit_minor === null && by[KAVI].credit_limit_from === null && by[KAVI].over_limit === false, JSON.stringify(by[KAVI]));

  /* ── FIN-R1: the stored Terms (b298 run) — the shop default, then a party's own ── */
  require(path.join(H.API, 'lib', 'schema')).hasColumn = async () => true;
  const daysLate = (p) => Math.round((Date.parse('2026-10-10') - Date.parse(p.oldest_due)) / 864e5);
  const want = (p, pctYear) => Math.round(p.balance_minor * (pctYear / 12) / 100 * daysLate(p) / 30);   /* the engine's simple interest, by hand */
  X.T.shopTerms = { credit_limit_minor: 70000, interest: { on: true, rate_pct: 18, grace_days: 0 } };
  let g = await q('/dues?asOf=2026-10-10&finance=1'), b2 = {}; (g.body.parties || []).forEach((p) => { b2[p.party_id] = p; });
  ok('shop default 18% a year → Mala\'s interest at 1.5% a month, exactly', b2[MALA].interest_state === 'on' && b2[MALA].interest_minor === want(b2[MALA], 18) && b2[MALA].interest_minor > 0, JSON.stringify(b2[MALA]) + ' want ' + want(b2[MALA], 18));
  ok('shop default limit: Kavi (none of his own) gets the shop\'s 70000 and is over it', b2[KAVI].credit_limit_minor === 70000 && b2[KAVI].credit_limit_from === 'shop' && b2[KAVI].over_limit === (b2[KAVI].balance_minor > 70000), JSON.stringify(b2[KAVI]));
  ok('a party\'s own limit still wins over the shop default', b2[MALA].credit_limit_minor === 50000 && b2[MALA].credit_limit_from === 'party');
  ok('Ravi: not yet due → interest 0 (on, nothing earned)', b2[RAVI].interest_state === 'on' && b2[RAVI].interest_minor === 0, JSON.stringify(b2[RAVI]));
  X.T.parties.find((p) => p.party_id === MALA).terms = { interest: { on: true, rate_pct: 24, grace_days: 0 } };
  X.T.parties.find((p) => p.party_id === KAVI).terms = { interest: { on: false, rate_pct: 0, grace_days: 0 } };
  g = await q('/dues?asOf=2026-10-10&finance=1'); b2 = {}; (g.body.parties || []).forEach((p) => { b2[p.party_id] = p; });
  ok('Mala\'s own 24% a year overrides the shop\'s 18%', b2[MALA].interest_minor === want(b2[MALA], 24) && b2[MALA].interest_minor !== want(b2[MALA], 18), JSON.stringify(b2[MALA]));
  ok('Kavi\'s own terms say interest OFF → state off, no figure (the shop default does not leak in)', b2[KAVI].interest_state === 'off' && b2[KAVI].interest_minor === null, JSON.stringify(b2[KAVI]));
  X.T.shopTerms = null; require(path.join(H.API, 'lib', 'schema')).hasColumn = async () => false;

  /* ── FIN-R1 unit: the seam itself (books-engines) ── */
  const doc = [{ outstanding_minor: 120000, due_date: '2026-09-10' }];   /* 30 days late on 2026-10-10 */
  ok('unit: 12% a year on 1200.00, 30 days late → 12.00 (1% a month)', X.E.interestMinor(doc, '2026-10-10', 'INR', { on: true, rate_pct: 12, grace_days: 0 }) === 1200);
  ok('unit: grace days are the terms\' own (20 of 30 forgiven → 4.00)', X.E.interestMinor(doc, '2026-10-10', 'INR', { on: true, rate_pct: 12, grace_days: 20 }) === 400);
  ok('unit: no terms / off / rate 0 → null, never a guess', [null, { on: false, rate_pct: 12 }, { on: true, rate_pct: 0 }].every((i) => X.E.interestMinor(doc, '2026-10-10', 'INR', i) === null));
  const T = require(path.join(H.API, 'lib', 'finance-terms'));
  const eff = T.resolve({ credit_limit_minor: 70000 }, { credit_limit_minor: null, terms: null });
  ok('unit: limitView reads the resolved limit — the shop default, and says so', JSON.stringify(X.E.limitView(eff, { balance_minor: 80000 })) === JSON.stringify({ credit_limit_minor: 70000, credit_limit_from: 'shop', over_limit: true, last_remind: null }));
  ok('unit: interestState — not_set · off · on', X.E.interestState(T.resolve({}, {})) === 'not_set' && X.E.interestState(T.resolve({ interest: { on: false } }, {})) === 'off' && X.E.interestState(T.resolve({}, { terms: { interest: { on: true, rate_pct: 9 } } })) === 'on');
  ok('last_remind is there (null until a Remind is recorded)', 'last_remind' in by[MALA] && by[MALA].last_remind === null);
  ok('interest is SHOWN only — no ledger entry was added by the read', X.T.items.length === 3, String(X.T.items.length));
  WHO = mk('99999999-9999-4999-8999-999999999999', { parent_entity_id: SHOP });
  const r = await q('/dues?finance=1');
  ok('not the owner → 403 with the sentence', r.status === 403 && /owner/i.test(r.body.message || ''), r.status + ' ' + JSON.stringify(r.body));
  srv.close();

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(e && e.stack || e); process.exit(1); });

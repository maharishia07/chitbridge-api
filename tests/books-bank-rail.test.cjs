/**
 * books-bank-rail.test.cjs — BR1 · GET /api/books/bank/rail: the rail leg of the bank reconciliation the DEVICE runs.
 *   1  my advice + bank-question copies, trimmed to what the engine reads (bills from line_items), the on-rail parties (who may be ASKED), may.ask
 *   2  who may: a viewer reads, its Ask is refused read_only in the rail engine's own sentence; a commenter comment_only; an editor may
 *   3  a statement of more than 400 days is refused in words; the route makes ONE read of chits and ONE of parties (no per-row read)
 *   4  the engine (bank-recon v1.44.0) settles a statement line from the answer — the same objects the web passes it
 * Run: node tests/books-bank-rail.test.cjs
 */
'use strict';
const path = require('path'), http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SHOP = '11111111-1111-4111-8111-111111111111', RAVI = '22222222-2222-4222-8222-222222222222', KV = '33333333-3333-4333-8333-333333333333', OFF = '44444444-4444-4444-8444-444444444444';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
let WHO = OWNER;
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p) => new Promise((done) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method }, (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end();
});

(async () => {
  console.log('\n══ BR1 · GET /api/books/bank/rail ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }
  const X = H.load({ auth: authStub });
  X.T.parties.push({ owner: SHOP, party_id: RAVI, party_no: 'P-1', name: 'Ravi Stores', customer: true, on_rail: true },
    { owner: SHOP, party_id: KV, party_no: 'P-2', name: 'KV Traders', supplier: true, on_rail: true },
    { owner: SHOP, party_id: OFF, party_no: 'P-3', name: 'Walk-in Mani', customer: true, on_rail: false });
  X.T.chits.push(
    { chit_id: 'c1', entity_id: SHOP, direction: 'received', status: 'delivered', created_at: '2026-10-12T05:00:00.000Z', party_id: RAVI, party_name: 'Ravi Stores',
      business_json: { kind: 'payment_advice', currency: 'INR', payment_advice: { action: 'paid', amount_minor: 420000, currency: 'INR', reference: 'N99912', paid_on: '2026-10-12', words: 'Ravi Stores paid you …' }, secret_note: 'not for the bank screen' },
      line_items: [{ particulars: 'Bill S-1', ref_chit_id: 'bill-1', bill_no: 'S-1', applied_minor: 420000 }, { particulars: 'a note line' }] },
    { chit_id: 'q1', entity_id: SHOP, direction: 'sent', status: 'delivered', created_at: '2026-10-13T05:00:00.000Z', party_id: RAVI, party_name: 'Ravi Stores',
      business_json: { kind: 'bank_query', currency: 'INR', bank_query: { key: '2026-10-12|in|420000|N99912', side: 'in', amount_minor: 420000, currency: 'INR', date: '2026-10-12', ref: 'N99912', words: '…' } } },
    { chit_id: 'x1', entity_id: SHOP, direction: 'received', business_json: { kind: 'invoice' } });
  /* count the store's reads on this route */
  const n = { chits: 0, parties: 0 };
  const S = require(path.join(H.API, 'lib', 'books-store'));
  const wasC = S.bankRailChits, wasP = S.parties;
  S.bankRailChits = async (...a) => { n.chits++; return wasC(...a); }; S.parties = async (...a) => { n.parties++; return wasP(...a); };
  const express = require('express');
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port, q = (p) => call(port, 'GET', '/api/books' + p);
  await call(port, 'POST', '/api/books/enable');

  const r = await q('/bank/rail?from=2026-10-01&to=2026-10-31');
  eq('1 · 200 · my advice and my question, nothing else; the window echoed', [r.status, r.body.from, r.body.to, (r.body.rail_chits || []).map((c) => c.chit_id)], [200, '2026-10-01', '2026-10-31', ['c1', 'q1']]);
  const c1 = (r.body.rail_chits || [])[0] || {};
  eq('1 · the advice: party, my side of the copy, the bills it settles (lines without a bill are left out), no other business_json key',
    [c1.direction, c1.party, c1.line_items, Object.keys(c1.business_json || {}).sort()],
    ['received', { id: RAVI, name: 'Ravi Stores' }, [{ ref_chit_id: 'bill-1', bill_no: 'S-1', applied_minor: 420000 }], ['currency', 'kind', 'payment_advice']]);
  eq('1 · who may be asked: the parties ON the rail only; the owner may ask; the shop names itself', [r.body.parties.map((p) => p.name).sort(), r.body.may.ask, r.body.me], [['KV Traders', 'Ravi Stores'], { ok: true }, 'Mayur Bhavan']);
  eq('3 · one read of chits, one of parties', n, { chits: 1, parties: 1 });

  const RAIL = require(path.join(H.API, 'lib', 'rail'));
  WHO = { identity_id: '55555555-5555-4555-8555-555555555555', identity_type: 'actor', parent_entity_id: SHOP, access_level: 'viewer', display_name: 'Auditor' };
  const v = await q('/bank/rail?from=2026-10-01&to=2026-10-31');
  eq('2 · a viewer reads the same chits; its Ask is refused read_only with the rail\'s sentence', [v.status, v.body.rail_chits.length, v.body.may.ask], [200, 2, { ok: false, why: 'read_only', say: RAIL.say('read_only') }]);
  WHO = Object.assign({}, WHO, { access_level: 'commenter' });
  eq('2 · a commenter: comment_only', (await q('/bank/rail?from=2026-10-01&to=2026-10-31')).body.may.ask.why, 'comment_only');
  WHO = Object.assign({}, WHO, { access_level: 'editor' });
  eq('2 · an editor may ask', (await q('/bank/rail?from=2026-10-01&to=2026-10-31')).body.may.ask, { ok: true });
  WHO = OWNER;

  const long = await q('/bank/rail?from=2025-01-01&to=2026-10-31');
  eq('3 · more than 400 days → 400 in words', [long.status, long.body.message], [400, 'Choose a statement of 400 days or fewer.']);

  /* 4 · the engine on the device, fed exactly this answer */
  const BR = require(path.join(H.enginesSrc().dir, 'bank-recon'));
  if (typeof BR.explain === 'function') {
    const stmt = [{ date: '2026-10-12', narration: 'NEFT-RAVI STORES', ref: 'N99912', debit_minor: 0, credit_minor: 420000 }];
    const asks = r.body.rail_chits.filter((c) => c.business_json.kind === 'bank_query').map((c) => ({ key: c.business_json.bank_query.key, chit_id: c.chit_id }));
    const xp = BR.explain(stmt, [], BR.railPayments(r.body.rail_chits), { asks });
    eq('4 · the line is told by Ravi\'s advice (by reference), with the bill it settles and the question it answered', [xp.rows[0].state, xp.rows[0].how, xp.rows[0].bills.map((b) => b.bill_no), xp.rows[0].asked.chit_id], ['told', 'ref', ['S-1'], 'q1']);
  } else console.log('   (engines below v1.44.0 here — section 4 needs bank-recon.explain)');

  S.bankRailChits = wasC; S.parties = wasP;
  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();

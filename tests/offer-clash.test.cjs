/**
 * tests/offer-clash.test.cjs — AN OFFER SAVE REFUSES A CLASH, IN WORDS (T2-LABS · OFF-E1, 2026-10-14).
 *
 * The clash rule lived only in the Offer Lab's page. It is the engine's now (CBOffers.clashes, engines v1.46.0) and the
 * SERVER asks it when an offer is saved live (routes/definitions.js → lib/offer-clash.js), so production gets it:
 *   · POST live, overlapping a live discount on the same category → 409 OFFER_CLASH, a sentence that names the other offer
 *     and the items, nothing written
 *   · PUT { status: 'live' } (the lab's status button, no rules sent) → the stored rules are read and asked the same question
 *   · an item list against a category is placed through the catalogue rows (one read), and only then
 *   · a draft, a pause, a rename of a live offer, a basket-level offer, different shelves → saved as before
 *
 * Run: node tests/offer-clash.test.cjs   · no DB (the wire is a stub answering by question), no network.
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-offer-clash';
const API = path.join(__dirname, '..');

const SHOP = '11111111-1111-4111-8111-111111111111';
const LIVE10 = '22222222-2222-4222-8222-222222222222', DRAFT = '33333333-3333-4333-8333-333333333333';
const DOSA = '44444444-4444-4444-8444-444444444444', TEA = '55555555-5555-4555-8555-555555555555';

/* ── the wire: what is LIVE on the shelf, the catalogue rows, the definition rows; every statement is kept ── */
let SHELF = [], DEFS = {}, SQL = [];
const answer = (sql, p) => {
  const s = String(sql);
  if (/FROM definition d/.test(s) && /d\.status = 'live'/.test(s)) return SHELF.filter((r) => r.definition_id !== p[1]);
  if (/FROM catalogue_items/.test(s)) return [{ item_id: DOSA, item_data: { name: 'Masala Dosa', categories: ['tiffin'] } }, { item_id: TEA, item_data: { name: 'Filter Coffee', categories: ['drinks'] } }]
    .filter((r) => p[1].includes(r.item_id));
  if (/SELECT \* FROM definition WHERE definition_id/.test(s)) return DEFS[p[0]] ? [DEFS[p[0]]] : [];
  if (/SELECT rules FROM definition_version/.test(s)) return DEFS[p[0]] ? [{ rules: DEFS[p[0]].rules }] : [];
  if (/^\s*INSERT INTO definition \(/.test(s)) return [{ definition_id: 'new-1', kind: p[1], sub_kind: p[2], name: p[3], status: p[6] }];
  if (/^\s*UPDATE definition/.test(s)) return [Object.assign({}, DEFS[p[0]], { status: p[3] || DEFS[p[0]].status })];
  return [];
};
const q = async (sql, params) => { SQL.push(String(sql)); const rows = answer(sql, params || []); return { rows, rowCount: rows.length }; };
const tx = { query: q };
const stub = (rel, exports) => { const f = require.resolve(path.join(API, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('db', { query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) }, withEntity: async (id, fn) => fn(tx),
  withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx), readBatch: async () => [{ rows: [] }],
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } });
const auth = (req, res, next) => { req.identity = { identity_id: SHOP }; next(); };
auth.entityOf = (req) => req.identity.identity_id; auth.requireScope = () => (req, res, next) => next();
stub('middleware/auth', auth);
stub('lib/shopchanged', { shopChanged: () => {} });

const app = express();
app.use(express.json());
app.use('/api/definitions', require(path.join(API, 'routes', 'definitions')));

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const call = (port, method, url, body) => new Promise((res, rej) => {
  const data = body ? JSON.stringify(body) : '';
  const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (s) => {
    let raw = ''; s.on('data', (c) => (raw += c)); s.on('end', () => { let j = null; try { j = JSON.parse(raw); } catch (_) {} res({ status: s.statusCode, body: j }); });
  });
  r.on('error', rej); r.end(data);
});
const writes = () => SQL.filter((s) => /^\s*(INSERT|UPDATE)/.test(s)).length;

(async () => {
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r));
  const port = srv.address().port;
  const reset = () => {
    SQL = [];
    SHELF = [{ definition_id: LIVE10, name: 'Tiffin 10%', sub_kind: 'percent_off', rules: { percent: 10, scope: 'line', applies_to: { category: 'tiffin' } } }];
    DEFS = { [DRAFT]: { definition_id: DRAFT, entity_id: SHOP, kind: 'offer', sub_kind: 'amount_off', name: 'Dosa ₹5 off', status: 'draft', current_version: 1,
      rules: { amount: 5, scope: 'line', applies_to: { item_ids: [DOSA] } } } };
  };
  console.log('\n══ AN OFFER SAVE REFUSES A CLASH, IN WORDS ══\n');

  reset();
  let r = await call(port, 'POST', '/api/definitions', { kind: 'offer', sub_kind: 'amount_off', name: 'Tiffin ₹5', status: 'live', rules: { amount: 5, scope: 'line', applies_to: { category: 'tiffin' } } });
  t('POST live on the same category as a live 10% → 409 OFFER_CLASH, nothing written', r.status === 409 && r.body.code === 'OFFER_CLASH' && writes() === 0, JSON.stringify(r));
  t('…the sentence names the other offer and what to do (what happened · what it means · what to do)',
    /overlaps "Tiffin 10%"/.test(r.body.message) && /one discount at a time/.test(r.body.message) && /pause "Tiffin 10%"/.test(r.body.message), r.body.message);
  t('…and the client gets the offers by id, not only prose', r.body.clashes.length === 1 && r.body.clashes[0].definition_id === LIVE10);
  t('…same category on both sides needs no catalogue read', !SQL.some((s) => /catalogue_items/.test(s)));

  reset();
  r = await call(port, 'POST', '/api/definitions', { kind: 'offer', sub_kind: 'amount_off', name: 'Tiffin ₹5', status: 'draft', rules: { amount: 5, scope: 'line', applies_to: { category: 'tiffin' } } });
  t('the same offer saved as a DRAFT → 201, not asked (the lab warns while drafting)', r.status === 201 && !SQL.some((s) => /d\.status = 'live'/.test(s)), JSON.stringify(r));

  reset();
  r = await call(port, 'PUT', '/api/definitions/' + DRAFT, { status: 'live' });
  t('PUT { status: live } with no rules: the stored rules are read; an item in the live category → 409, naming the item',
    r.status === 409 && r.body.code === 'OFFER_CLASH' && /Masala Dosa/.test(r.body.message) && writes() === 0, JSON.stringify(r));
  t('…the item list is placed in its category by ONE catalogue read of the named ids', SQL.filter((s) => /catalogue_items/.test(s)).length === 1);

  reset();
  DEFS[DRAFT].rules = { amount: 5, scope: 'line', applies_to: { item_ids: [TEA] } };
  r = await call(port, 'PUT', '/api/definitions/' + DRAFT, { status: 'live' });
  t('an item in ANOTHER category goes live → 200 (different shelves never clash)', r.status === 200, JSON.stringify(r));

  reset();
  SHELF.push({ definition_id: DRAFT, name: 'Dosa ₹5 off', sub_kind: 'amount_off', rules: DEFS[DRAFT].rules });
  DEFS[DRAFT].status = 'live';
  r = await call(port, 'PUT', '/api/definitions/' + DRAFT, { name: 'Dosa five off' });
  t('renaming a live offer is never refused (no rules, already live) — and asks nothing', r.status === 200 && !SQL.some((s) => /d\.status = 'live'/.test(s)), JSON.stringify(r));
  r = await call(port, 'PUT', '/api/definitions/' + DRAFT, { status: 'paused' });
  t('pausing it is never refused', r.status === 200, JSON.stringify(r));

  reset();
  r = await call(port, 'POST', '/api/definitions', { kind: 'offer', sub_kind: 'threshold', name: 'Spend 500', status: 'live', rules: { min_amount: 500, amount: 50, scope: 'cart' } });
  t('a basket-level offer live beside it → 201 (bill-level offers stack; asked of the engine, not a list here)', r.status === 201 && !SQL.some((s) => /d\.status = 'live'/.test(s)), JSON.stringify(r));
  r = await call(port, 'POST', '/api/definitions', { kind: 'category', name: 'Tiffin' });
  t('anything that is not an offer is untouched', r.status === 201, JSON.stringify(r));

  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

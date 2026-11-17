'use strict';
/*
 * e2e/flags-proof/serve.cjs — THE PROOF SERVER for the private bookmarks/notes screens (W0-W3). Run it from the API checkout's tests/ folder (it needs the api's modules and a scratch Postgres as cb_app):
 *   DATABASE_URL=postgres://cb_app@db:5432/flags_t WEB_PUBLIC=<web>/public node tests/zz-flags-ui-serve.cjs     (copy this file there; never a shared or production database)
 * It builds the fixture of the api's tests/private-flag-isolation.realstack.cjs (business Bravo with a ledger and 4 postings; firm One with an adviser grant; firm Two with an auditor grant; people Una and Umar of Firm Two, Asha of Firm One)
 * and serves the web `public` folder and the REAL routes (books, books-grants, marks, flags) on ONE origin, port 4010.
 * ⚠️ MOCKED: only the sign-in. "Authorization: Bearer h.<base64 of { identity_id }>.s" is an UNSIGNED, JWT-shaped label of a seeded person (the page reads the shape; it is not a credential and the server checks only that the id is a seeded person); the real auth, its tokens and sessions are not in this proof. Every other route a page asks for answers 404 NOT_IN_PROOF_SERVER.
 * GET /__seen lists every /api/flags request with its X-Books-For and X-Books-Role headers (the proof that the page never sends them); GET /__fixture the ids.
 */
const url = process.env.DATABASE_URL || '';
if (!/^postgres:\/\/cb_app/.test(url)) { console.error('REFUSED: DATABASE_URL must be a scratch database as cb_app'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ui_proof_secret_at_least_32_chars_padding_xx';
const path = require('path');
const express = require('express');
const API = path.join(__dirname, '..');
const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const { query, withEntity } = require(path.join(API, 'db'));
const reqctx = require(path.join(API, 'lib', 'reqctx.js'));
const PEOPLE = {};
const fakeAuth = async (req, res, next) => {
  if (req.identity) return next();
  const m = /^Bearer h\.([\w-]+)\.s$/.exec(String(req.headers.authorization || ''));
  let id = null;
  try { id = JSON.parse(Buffer.from(m[1], 'base64url').toString()).identity_id; } catch (_) { id = null; }
  const who = Object.values(PEOPLE).find((p) => p.identity_id === id);
  if (!who) return res.status(401).json({ code: 'NO_TEST_IDENTITY', message: 'no test identity' });
  const row = (await query('SELECT break_status, access_level, whole_entity, can_see_costs FROM identities WHERE identity_id = $1', [who.identity_id])).rows[0];
  req.identity = Object.assign({}, who, row ? { access_level: row.access_level, whole_entity: row.whole_entity === true, can_see_costs: row.can_see_costs === true } : {});
  return reqctx.runWithActor(who.identity_id, () => next());
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
const net = require(path.join(API, 'src', 'services', 'network'));
const RUN = 'ui' + (Date.now() % 1e10).toString(36);
const day = new Date().toISOString().slice(0, 10);
async function business(tag, name) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [i] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1,$2,'entity','IN','INR',$3) RETURNING identity_id, display_name`, [bridgeId, name, bridgeId.toLowerCase()]);
  return { tag, bridgeId, id: i.identity_id, name: i.display_name, node: await net.nodeOf(i.identity_id, { ensure: true }) };
}
const join = async (p, m) => { const a = await net.requestConnect({ parentId: p.node.id, childId: m.node.id }, p.node); await net.approve({ edgeId: a.id }, m.node); };
async function person(biz, tag, label, level) {
  const { rows: [r] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1,$2,'actor',$3,'IN','INR',$4,$5,true,true,'act') RETURNING identity_id, display_name`, [biz.bridgeId + tag, label, biz.id, (biz.bridgeId + tag).toLowerCase(), level || 'commenter']);
  return { identity_id: r.identity_id, identity_type: 'actor', parent_entity_id: biz.id, bridge_id: biz.bridgeId, display_name: r.display_name };
}
const owner = (b) => ({ identity_id: b.id, bridge_id: b.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: b.name });
const WEB = process.env.WEB_PUBLIC || '/web/public';
(async () => {
  const B = await business('b', 'Bravo Traders'), F1 = await business('1', 'Firm One Accountants'), F2 = await business('2', 'Firm Two Auditors');
  await join(F1, B); await join(F2, F1);
  PEOPLE.U1 = await person(F2, 'u1', 'Una of Firm Two'); PEOPLE.U2 = await person(F2, 'u2', 'Umar of Firm Two'); PEOPLE.A1 = await person(F1, 'a1', 'Asha of Firm One', 'editor');
  PEOPLE.OB = owner(B); PEOPLE.OF2 = owner(F2);
  const seen = [];
  const fixture = { B: B.id, F1: F1.id, F2: F2.id, day, people: Object.fromEntries(Object.entries(PEOPLE).map(([k, v]) => [k, { identity_id: v.identity_id, parent_entity_id: v.parent_entity_id, display_name: v.display_name }])) };
  const app = express();
  app.use(express.json());
  app.use('/api', (req, res, next) => { if (/^\/flags/.test(req.path)) seen.push({ path: req.path, method: req.method, xbf: req.headers['x-books-for'] || null, xbr: req.headers['x-books-role'] || null }); next(); });
  app.get('/__seen', (req, res) => res.json(seen));
  app.get('/__fixture', (req, res) => res.json(fixture));
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  app.use('/api/marks', require(path.join(API, 'routes', 'marks.js')));
  app.use('/api/flags', require(path.join(API, 'routes', 'flags.js')));
  /* the frame's own reads, answered EMPTY (a stand-in: the proof is of the flags, not of the network page) */
  app.get('/api/network-offers', (req, res) => res.json({ store: { networks: [], price_notices: [] }, may_design: false }));
  app.get('/api/network-design/stores', (req, res) => res.json({ stores: [] }));
  app.get('/api/entities/me', fakeAuth, (req, res) => res.json({ entity_id: req.identity.parent_entity_id || req.identity.identity_id, identity_id: req.identity.identity_id, display_name: req.identity.display_name, name: req.identity.display_name, bridge_id: req.identity.bridge_id, country: 'IN', currency_code: 'INR' }));
  app.get('/api/entities/header', fakeAuth, (req, res) => res.json({ name: req.identity.display_name }));
  app.get('/api/notifications', (req, res) => res.json({ notifications: [], unread: 0 }));
  app.use('/api', (req, res) => res.status(404).json({ code: 'NOT_IN_PROOF_SERVER', message: 'not mounted in the proof server' }));
  app.get('/', (req, res) => res.sendFile(path.join(WEB, '..', 'index.html'))); /* Home is the web repo's root index.html */
  app.use(express.static(WEB, { extensions: ['html'] }));
  app.use((err, req, res, next) => res.status(500).json({ code: 'TEST_500', message: String(err && err.message) }));
  await new Promise((r) => { app.listen(4010, '0.0.0.0', () => r()); });
  const call = async (who, method, route, o) => {
    o = o || {};
    const r = await fetch('http://127.0.0.1:4010' + route, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer h.' + Buffer.from(JSON.stringify({ identity_id: PEOPLE[who].identity_id })).toString('base64url') + '.s' }, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
    let b = null; try { b = await r.json(); } catch (_) { b = null; }
    return { status: r.status, body: b };
  };
  await withEntity(B.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, B.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, B.id));
  console.log('enable', (await call('OB', 'POST', '/api/books/enable', { body: {} })).status);
  console.log('grants', (await call('OB', 'POST', '/api/books-grants', { body: { grantee: F2.id, purpose: 'audit of the books', consent: true } })).status, (await call('OB', 'POST', '/api/books-grants', { body: { grantee: F1.id, purpose: 'adviser of the books', consent: true, preset: 'adviser', posting: 'owner_approves' } })).status);
  const acc = (await call('OB', 'GET', '/api/books/accounts')).body, list = acc.accounts || acc.rows || acc || [];
  const cash = (list.find((a) => /cash/i.test(a.name || '')) || {}).code || '1000', sales = (list.find((a) => /^sales/i.test(a.name || '')) || {}).code || '4000';
  fixture.entries = [];
  for (let n = 1; n <= 4; n++) {
    const e = (await call('OB', 'POST', '/api/books/entries', { body: { narration: 'proof ' + n, date: day, client_ref: RUN + 'e' + n, lines: [{ code: cash, dr_minor: 10000 * n }, { code: sales, cr_minor: 10000 * n }] } })).body;
    fixture.entries.push(e && e.entry_id);
  }
  console.log('READY ' + JSON.stringify(fixture));
})().catch((e) => { console.error('FAILED', e); process.exit(1); });

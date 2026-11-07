#!/usr/bin/env node
/**
 * ctr182-gstin-owner-only.test.cjs — CTR-182 (P1, 7 Nov 2026): the shop's GSTIN (a tax identity) is changed by the OWNER or a MANAGER.
 * @type regression
 * OWNS      the proof that on every door that writes the shop's tax number — POST /api/till/shop · PATCH /api/entities/profile ·
 *           PUT /api/governance/profile/vault · POST /api/integrations/profile — a signed-in clerk (hat act, editor) and an auditor are refused
 *           403 OWNER_ONLY in plain words with NOTHING written; the owner, a manager and a till/connector KEY (not a person) pass; a clerk that echoes
 *           the stored number back changes nothing and is not refused; GET /entities/me/can-see-costs says may_set_tax_id (the action stays shown).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes over a stand-in db and auth (the shape of tests/till-rate-door.test.cjs).
 * FLOW      world (who · key · stored number) → real route → status, body, and whether any INSERT/UPDATE reached the db
 *   node tests/ctr182-gstin-owner-only.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const SHOP = '11111111-1111-4111-8111-111111111111';
const STORED = '27AAACR5055K1Z7';
const NEW_ONE = '27AAPFU0939F1ZV';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Kaveri Mess' };
const CLERK = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor', hat: 'act' };
const MANAGER = { identity_id: '55555555-5555-4555-8555-555555555555', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor', hat: 'manager' };
const AUDITOR = { identity_id: '66666666-6666-4666-8666-666666666666', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor', hat: 'audit' };
const PLAIN_WORDS = 'Ask the owner or a manager to change the shop’s tax number.';

const world = { who: OWNER, key: null, writes: [] };
const isWrite = (sql) => /^\s*(UPDATE|INSERT|DELETE)/i.test(String(sql));
function rowsFor(sql, params) {
  const text = String(sql);
  if (isWrite(text)) { world.writes.push(text.replace(/\s+/g, ' ').slice(0, 60)); return { rows: [], rowCount: 1 }; }
  if (/FROM identities/.test(text)) return { rows: [{ display_name: 'Kaveri Mess', identity_id: SHOP, gstn: STORED, country: 'IN', address: '1 High St', policy_flags: { gst_registration: 'regular' } }] };
  return { rows: [], rowCount: 0 };
}
const mock = (relative, exported) => { const file = require.resolve(path.join(HERE, relative)); require.cache[file] = { id: file, filename: file, loaded: true, exports: exported }; };
function installStubs() {
  const realAuth = require(path.join(HERE, 'middleware', 'auth'));
  const { holderOf } = require(path.join(HERE, 'lib', 'holder'));
  const stubAuth = (req, res, next) => {
    req.identity = world.who;
    if (world.key) { req.api_key = { jti: 'j1', scopes: world.key }; req.till = holderOf({ kind: 'api_key', jti: 'j1', scopes: world.key }, null, null); }
    return next();
  };
  mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n() }));
  const client = { query: async (sql, params) => rowsFor(sql, params) };
  const known = { query: async (sql, params) => rowsFor(sql, params), withEntity: async (id, run) => run(client), withTransaction: async (run) => run(client),
    trySavepoint: async (handle, run, fallback) => run().catch(() => fallback), readBatch: async (entity, actor, statements) => statements.map((s) => rowsFor(s && s.text ? s.text : s)) };
  const db = new Proxy(known, { get: (target, name) => (name in target ? target[name] : typeof name === 'symbol' || name === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) });
  mock('db', db); mock('db/index', db);
  console.error = () => undefined; console.warn = () => undefined;
}
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + String(info).slice(0, 300) : '')); } };
const refused = (r) => r.status === 403 && r.body.code === 'OWNER_ONLY' && r.body.message === PLAIN_WORDS && r.body.may === false;

/* each door: how a request that SETS a different tax number looks, and the same request that leaves it as it is */
const DOORS = [
  { name: 'POST /api/till/shop', method: 'POST', url: '/api/till/shop', change: { gstin: NEW_ONE }, echo: { gstin: STORED, phone: '9000000000' } },
  { name: 'PATCH /api/entities/profile', method: 'PATCH', url: '/api/entities/profile', change: { gstn: NEW_ONE }, echo: { gstn: STORED } },
  { name: 'PUT /api/governance/profile/vault', method: 'PUT', url: '/api/governance/profile/vault', change: whole(NEW_ONE), echo: { patch: { sections: {} }, version: 1 } },
  { name: 'POST /api/integrations/profile', method: 'POST', url: '/api/integrations/profile', change: { fields: { gstin: NEW_ONE } }, echo: { fields: { gstin: STORED } } }
];
function whole(number) { return { vault: { sections: [{ type: 'identity', label: 'Business', rows: [{ name: 'GSTIN', value: number, tag: 'gstin' }] }] } }; }

(async () => {
  console.log('\n══ CTR-182 · the shop’s GSTIN is the owner’s, on every door ══\n');
  installStubs();
  const app = express(); app.use(express.json());
  app.use('/api/till', require(path.join(HERE, 'routes', 'till.js')));
  app.use('/api/entities', require(path.join(HERE, 'routes', 'entities.js')));
  app.use('/api/governance', require(path.join(HERE, 'routes', 'governance.js')));
  app.use('/api/integrations', require(path.join(HERE, 'routes', 'integrations.js')));
  const server = app.listen(0); const port = server.address().port;
  const run = async (door, body, who, key) => { Object.assign(world, { who, key: key || null, writes: [] }); return call(port, door.method, door.url, body); };
  try {
    for (const door of DOORS) {
      for (const [who, label] of [[CLERK, 'a clerk (act, editor)'], [AUDITOR, 'an auditor (editor, hat audit)']]) {
        const r = await run(door, door.change, who);
        ok(door.name + ' — ' + label + ' changing the GSTIN is refused 403 in plain words, nothing written', refused(r) && world.writes.length === 0, JSON.stringify(r) + ' writes=' + world.writes.length);
      }
      const mgr = await run(door, door.change, MANAGER);
      ok(door.name + ' — a manager changing the GSTIN passes the door and reaches the write', mgr.status !== 403 && world.writes.length > 0, JSON.stringify(mgr) + ' writes=' + world.writes.length);
      const owner = await run(door, door.change, OWNER);
      ok(door.name + ' — the owner changing the GSTIN passes the door and reaches the write', owner.status !== 403 && world.writes.length > 0, JSON.stringify(owner) + ' writes=' + world.writes.length);
      {
        const keyed = await run(door, door.change, OWNER, ['till', 'connector']);
        ok(door.name + ' — a till/connector KEY keeps its right (a key is not a person)', keyed.status !== 403, JSON.stringify(keyed));
      }
      const echo = await run(door, door.echo, CLERK);
      ok(door.name + ' — a clerk that sends the stored number back is not refused for it', !refused(echo), JSON.stringify(echo));
    }
    const till = await run(DOORS[0], { gstin: '27AAACR5055K1Z8' }, CLERK);
    ok('POST /api/till/shop — a clerk is refused BEFORE the number is checked (a bad number answers 403, not 400)', refused(till), JSON.stringify(till));
    const may = async (who) => { Object.assign(world, { who, key: null }); return (await call(port, 'GET', '/api/entities/me/can-see-costs')).body.may_set_tax_id; };
    ok('GET /entities/me/can-see-costs says may_set_tax_id: owner true, manager true, clerk false (the action stays shown, the server answers)',
      (await may(OWNER)) === true && (await may(MANAGER)) === true && (await may(CLERK)) === false);
    /* the door itself (lib/tax-id-door): one predicate per role, one comparison, one sentence, and it fails closed */
    const door = require(path.join(HERE, 'lib', 'tax-id-door'));
    ok('mayChangeTaxId: the owner and a key yes; a manager yes; a clerk and a viewer no', door.mayChangeTaxId({ identity: OWNER }) && door.mayChangeTaxId({ identity: CLERK, api_key: { jti: 'k' } })
      && door.mayChangeTaxId({ identity: MANAGER }) && !door.mayChangeTaxId({ identity: CLERK }) && !door.mayChangeTaxId({ identity: Object.assign({}, CLERK, { access_level: 'viewer' }) }));
    ok('taxIdDiffers: case and spaces ignored; a blank sent is nobody saying anything', !door.taxIdDiffers(STORED, ' ' + STORED.toLowerCase() + ' ') && !door.taxIdDiffers(STORED, '') && !door.taxIdDiffers(STORED, null) && door.taxIdDiffers(STORED, NEW_ONE) && door.taxIdDiffers(null, NEW_ONE));
    ok('refusal: 403 OWNER_ONLY in plain words, may false, why = the sentence', door.refusal().status === 403 && door.refusal().code === 'OWNER_ONLY' && door.refusal().legacy.may === false && door.refusal().detail === door.TAX_ID_ASK_OWNER);
    let nexted = 0, answered = null;
    const fakeRes = { status(code) { answered = code; return this; }, set() { return this; }, type() { return this; }, json() { return this; }, send() { return this; }, end() { return this; }, setHeader() {}, getHeader() {} };
    await door.gate(async () => { throw new Error('the read failed'); })({ identity: CLERK, headers: {}, get: () => '', originalUrl: '/x' }, fakeRes, () => { nexted++; });
    ok('gate FAILS CLOSED: a question that cannot be answered refuses the person and never calls next', nexted === 0 && answered === 403, 'next=' + nexted + ' status=' + answered);
    await door.gate(async () => { throw new Error('never asked'); })({ identity: OWNER }, fakeRes, () => { nexted++; });
    ok('gate lets the owner through without asking', nexted === 1);
  } finally { server.close(); }
  console.log('\n' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

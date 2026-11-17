#!/usr/bin/env node
/**
 * fable-r2-access.test.cjs — the three fixes of the Fable access review 2 (docs/critique/FABLE-RISK-2-ACCESS.md).
 *
 * OWNS      R2-01 reissue only while the store is unclaimed · R2-03 an erased or closed business opens no door · R2-05 only the owner approves a connector PC.
 *           Each finding has a refusal case (fails on the code before the fix) and a good case (still works).
 * CALLED BY CI (node tests/*.test.cjs) · toolset/sit-api-tests.sh. No database, no network: the real routes and the real middleware over stand-in db.
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';

let passed = 0;
let failed = 0;
const check = (label, condition, info) => {
  if (condition) passed++;
  else failed++;
  console.log('  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label + (condition || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 400)));
};
const mock = (relative, exported) => {
  const file = require.resolve(path.join(API, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};

/* ── the stand-in world: one database answer per statement, and who the stand-in sign-in says is calling ─────────── */
const world = { who: null, store: null, businessStatus: 'active', actor: null, writes: [] };
const rowsFor = (sql, params) => {
  world.writes.push(String(sql).trim().split(/\s+/).slice(0, 2).join(' '));
  if (/FROM identities\s+WHERE LOWER\(user_id\)/.test(sql)) return { rows: world.store ? [world.store] : [], rowCount: world.store ? 1 : 0 };
  /* R2-01c: the claim test rides in the write, so the reissue UPDATE answers the row it changed (an unclaimed store) */
  if (/UPDATE identities SET otp_code/.test(sql)) return { rows: world.store && !world.store.last_active_at ? [{ user_id: world.store.user_id, display_name: world.store.display_name }] : [], rowCount: 1 };
  if (/SELECT status FROM identities/.test(sql)) return { rows: [{ status: world.businessStatus }], rowCount: 1 };
  if (/SELECT identity_id, site, connector_config FROM identities/.test(sql)) return { rows: world.actor ? [world.actor] : [], rowCount: world.actor ? 1 : 0 };
  return { rows: [], rowCount: 1 };
};
const client = { query: async (sql, params) => rowsFor(sql, params) };
const db = {
  query: async (sql, params) => rowsFor(sql, params),
  withTransaction: async (run) => run(client),
  withEntity: async (id, run) => run(client),
  readBatch: async () => [{ rows: [], rowCount: 0 }]
};
mock('db', db);
mock('db/index', db);
const realAuth = require(path.join(API, 'middleware', 'auth'));
const standInAuth = (req, res, next) => {
  req.identity = world.who;
  return next();
};
mock('middleware/auth', Object.assign(standInAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }));
mock('lib/api-keys', { listOf: async () => [], setEnrol: async (entity, jti, patch) => patch, mint: async () => ({}) });

function serve(mount) {
  const app = express();
  app.use(express.json());
  mount(app);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port }));
  });
}
async function post(base, url, body, headers) {
  const res = await fetch(base + url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body || {}) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}
  return { status: res.status, json };
}

const HEAD = { identity_id: 'head-1', identity_type: 'entity', parent_entity_id: null };
const STORE = { identity_id: 'store-1', display_name: 'Store One', user_id: 'store-one', last_active_at: null };

async function r2_01() {
  console.log('\nR2-01 · reissue only while the store is unclaimed');
  const { server, base } = await serve((app) => app.use('/api/network-design', require(path.join(API, 'routes', 'network-design'))));
  world.who = HEAD;

  world.store = Object.assign({}, STORE, { last_active_at: null });
  world.writes = [];
  let r = await post(base, '/api/network-design/reissue', { user_id: 'store-one' });
  check('good case: an unclaimed store gets a new code', r.status === 200 && !!(r.json && r.json.claim_code), r);

  world.store = Object.assign({}, STORE, { last_active_at: new Date().toISOString() });
  world.writes = [];
  r = await post(base, '/api/network-design/reissue', { user_id: 'store-one' });
  check('a claimed store is refused with 403 NETWORK_STORE_CLAIMED', r.status === 403 && r.json && r.json.code === 'NETWORK_STORE_CLAIMED', r);
  check('the refusal carries no code', !(r.json && r.json.claim_code) && !JSON.stringify(r.json || {}).match(/claim_code|otp/i), r);
  check('the refusal writes nothing (the owner\'s waiting code is not overwritten)', !world.writes.includes('UPDATE identities'), world.writes);
  check('the refusal says what to do', /owner gives you access/.test(JSON.stringify(r.json || {})), r);

  world.store = null;
  r = await post(base, '/api/network-design/reissue', { user_id: 'someone-elses' });
  check('a store this head did not build is still a 404', r.status === 404, r);
  server.close();
}

async function r2_05() {
  console.log('\nR2-05 · only the owner approves a connector PC');
  const { server, base } = await serve((app) => app.use('/api/integrations', require(path.join(API, 'routes', 'integrations'))));
  const A1 = '44444444-4444-4444-8444-444444444444';
  world.actor = { identity_id: A1, site: 'PC-1', connector_config: { key_jti: 'jti-1' } };

  world.who = { identity_id: 'shop-1', identity_type: 'entity', parent_entity_id: null };
  let r = await post(base, '/api/integrations/' + A1 + '/approve', {});
  check('good case: the owner approves', r.status === 200 && r.json && r.json.ok === true, r);

  world.who = { identity_id: 'actor-9', identity_type: 'actor', parent_entity_id: 'shop-1', hat: 'edit' };
  world.writes = [];
  r = await post(base, '/api/integrations/' + A1 + '/approve', {});
  check('an editor co-assist is refused with 403 OWNER_ONLY', r.status === 403 && r.json && r.json.code === 'OWNER_ONLY', r);
  check('the refusal writes nothing', !world.writes.includes('UPDATE identities'), world.writes);
  server.close();
}

async function r2_03() {
  console.log('\nR2-03 · an erased or closed business opens no door');
  const status = require(path.join(API, 'lib', 'business-status'));
  check('erased and closed end a business; active, pending and unset do not', status.endedStatus('erased') && status.endedStatus('closed') && !status.endedStatus('active') && !status.endedStatus('pending') && !status.endedStatus(null));

  /* every request: the real auth, over the stand-in db */
  mock('middleware/auth', realAuth);
  const guarded = await serve((app) => app.get('/x', realAuth, (req, res) => res.json({ ok: true })));
  const token = (claims) => ({ authorization: 'Bearer ' + jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' }) });
  const get = async (headers) => {
    const res = await fetch(guarded.base + '/x', { headers });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const entity = token({ identity_id: 'live-shop', identity_type: 'entity' });
  world.businessStatus = 'active';
  let r = await get(entity);
  check('good case: an active business\'s session passes', r.status === 200, r);

  const gone = token({ identity_id: 'erased-shop', identity_type: 'entity' });
  world.businessStatus = 'erased';
  r = await get(gone);
  check('an erased business\'s open session is refused 401', r.status === 401, r);
  const goneActor = token({ identity_id: 'a1', identity_type: 'actor', parent_entity_id: 'erased-shop-2' });
  r = await get(goneActor);
  check('a co-assist of an erased business is refused 401', r.status === 401, r);
  world.businessStatus = 'closed';
  r = await get(token({ identity_id: 'closed-shop', identity_type: 'entity' }));
  check('a closed business\'s session is refused 401', r.status === 401, r);
  guarded.server.close();

  /* every sign-in: a good code never wakes an erased account */
  const { verifyCredential } = require(path.join(API, 'lib', 'identity-auth'));
  const calls = [];
  const run = async (sql) => {
    calls.push(String(sql).slice(0, 40));
    return { rows: [{ status: 'active' }], rowCount: 1 };
  };
  let v = await verifyCredential(run, { identity_id: 'e', identity_type: 'entity', status: 'erased', otp_code: '123456' }, { otp: '123456' });
  check('an erased business\'s sign-in is refused, with no write (it stays erased)', v.ok === false && v.reason === 'BUSINESS_ENDED' && calls.length === 0, { v, calls });
  v = await verifyCredential(run, { identity_id: 'e', identity_type: 'entity', status: 'active' }, {});
  check('good case: an active business is not stopped by the new gate', v.reason !== 'BUSINESS_ENDED', v);

  /* and the shopper code's own statement cannot flip an erased account back */
  const seen = [];
  await require(path.join(API, 'lib', 'otp')).spendShopperOtp(async (sql) => (seen.push(sql), { rowCount: 0 }), 'c1', '123456');
  /* SEC-186: the UPDATE lives in the owner's function (migration b874) — the shopper's spend calls it, and its UPDATE carries the exclusion */
  const fn = require('fs').readFileSync(path.join(API, 'migrations', 'b874_identity_secret_view.sql'), 'utf8').split('CREATE FUNCTION ops.spend_shopper_code')[1] || '';
  check('a spent code\'s UPDATE excludes an erased account', /ops\.spend_shopper_code/.test(seen[0] || '') && /UPDATE public\.identities[\s\S]*?NOT IN \('erased', 'closed'\)[\s\S]*?\$fn\$/.test(fn), seen);
}

(async () => {
  await r2_01();
  await r2_05();
  await r2_03();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

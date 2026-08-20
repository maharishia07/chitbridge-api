/**
 * iam-access.test.cjs — the access rules from IAM-SPEC.md, driven through the REAL middleware.
 *
 * ⚠️ NOT a unit test of the predicates. The hat gate has already shipped one bug that every unit test passed:
 * it read `req.path`, which is mount-relative inside a router, so every rule silently failed in production and
 * nowhere else. So this mounts express and measures what actually reaches the handler.
 *
 * Covers IAM-SPEC §12 (closed hides the catalogue), §18/§27 (read-only messaging), and the over-grant I nearly
 * shipped while building §18.
 */
const path = require('path');
const express = require('express');
const http = require('http');

const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(62) + got + (ok ? '' : '   want ' + want));
};

/* ── §12 · closed hides the catalogue ───────────────────────────────────────────────────────────────── */
async function visibilityCases() {
  console.log('\n-- §12 · trading status overrides visibility --\n');
  const cv = require(API + '/lib/catalogue-view');
  const visibilityCap = require(API + '/lib/visibility-cap');

  const run = (catalogue_visibility, business_status) => {
    const query = async () => ({ rows: [{ catalogue_visibility, business_status, plan: 'free', params_override: {}, bridge_id: 'CBTEST0001' }] });
    return cv.catalogueVisibility({ entity_id: 'e1', query, visibilityCap, viewer: null });
  };

  t('public + open    stays public', await run('public', 'open'), 'public');
  t('public + away    stays public  (away is visible, just unattended)', await run('public', 'away'), 'public');
  t('public + closed  becomes PRIVATE — the leak this fixes', await run('public', 'closed'), 'private');
  t('network + closed becomes PRIVATE — closed to the network too', await run('network', 'closed'), 'private');
  t('private + open   stays private', await run('private', 'open'), 'private');
}

/* ── §18 · the gate opens ONE route, not an area ─────────────────────────────────────────────────────── */
function gateCases() {
  console.log('\n-- §18 · the gate opens exactly one route --\n');
  const gate = require(API + '/middleware/hat-gate');

  const call = (method, url, hat) => {
    let status = 0;
    let nexted = false;
    const req = { method, originalUrl: url, path: url, identity: { identity_type: 'actor', hat } };
    const res = { status(c) { status = c; return this; }, json() { return this; } };
    gate(req, res, () => { nexted = true; });
    return nexted ? 200 : status;
  };

  t('read-only  POST /api/chits/x/messages   allowed by the gate', call('POST', '/api/chits/x/messages', 'view_only'), 200);
  t('read-only  POST /api/chits              REFUSED  (creating a chit)', call('POST', '/api/chits', 'view_only'), 403);
  t('read-only  PATCH /api/chits/x/status    REFUSED  (changing status)', call('PATCH', '/api/chits/x/status', 'view_only'), 403);
  t('read-only  GET  /api/chits/x/messages   never gated — reading is the job', call('GET', '/api/chits/x/messages', 'view_only'), 200);
  t('editable   POST /api/chits              allowed', call('POST', '/api/chits', 'act'), 200);
  t('read-only  PATCH /api/entities/me/prefs/ui  still allowed (their own theme)', call('PATCH', '/api/entities/me/prefs/ui', 'view_only'), 200);
}

/* ── §27 · read-only may message internally, never externally ───────────────────────────────────────── */
async function routeCases() {
  console.log('\n-- §27 · internal yes, external no --\n');

  /* the route reads req.identity; stub auth and the db so only the rule under test runs */
  require.cache[require.resolve(API + '/middleware/auth')] = {
    /* ⚠️ auth exports a FUNCTION WITH PROPERTIES — entityOf hangs off it and routes/chits.js calls it at
       module load. Replacing the module with a bare function removed entityOf and the route died before the
       rule under test ever ran. A stub has to keep the shape, not just the callable. */
    exports: Object.assign((req, res, next) => { req.identity = HAT; next(); }, {
      entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
    }),
  };
  require.cache[require.resolve(API + '/db')] = {
    exports: {
      query: async () => ({ rows: [] }),
      withEntity: async (_id, fn) => fn({ query: async () => ({ rows: [{ created_at: new Date().toISOString() }] }) }),
    },
  };

  let HAT = null;
  const app = express();
  app.use(express.json());
  app.use('/api/chits', require(API + '/routes/chits'));
  const srv = app.listen(0);
  const port = srv.address().port;

  const post = (thread_type, hat) => new Promise((ok) => {
    HAT = { identity_id: '11111111-1111-1111-1111-111111111111', identity_type: 'actor', hat, display_name: 'T' };
    const body = JSON.stringify({ message_text: 'hello', thread_type });
    const r = http.request({ host: '127.0.0.1', port, path: '/api/chits/c1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => { res.resume(); res.on('end', () => ok(res.statusCode)); });
    r.end(body);
  });

  const internalReadOnly = await post('internal', 'view_only');
  const externalReadOnly = await post('external', 'view_only');

  t('read-only  internal  NOT 403', internalReadOnly === 403 ? 403 : 'not-403', 'not-403');
  t('read-only  external  403', externalReadOnly, 403);
  t('audit      external  403  (an auditor who answers is participating)', await post('external', 'audit'), 403);
  t('editable   external  NOT 403', (await post('external', 'act')) === 403 ? 403 : 'not-403', 'not-403');

  srv.close();
}

/* ── §29 · only the ENTITY may provision an identity ──────────────────────────────────────────────────── */
async function provisioningCases() {
  console.log('\n-- 29 . creating and changing co-assists is the entity, not a co-assist --\n');

  let WHO = null;
  require.cache[require.resolve(API + '/middleware/auth')] = {
    exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
      entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
    }),
  };
  require.cache[require.resolve(API + '/db')] = {
    exports: { query: async () => ({ rows: [] }), withEntity: async (_i, fn) => fn({ query: async () => ({ rows: [] }) }) },
  };

  delete require.cache[require.resolve(API + '/routes/actors')];
  const app = express();
  app.use(express.json());
  app.use('/api/actors', require(API + '/routes/actors'));
  const srv = app.listen(0);
  const port = srv.address().port;

  const call = (method, path, who, body) => new Promise((ok) => {
    WHO = who;
    const b = JSON.stringify(body || {});
    const r = http.request({ host: '127.0.0.1', port, path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
      (res) => { res.resume(); res.on('end', () => ok(res.statusCode)); });
    r.end(b);
  });

  const ACTOR  = { identity_id: 'a1', identity_type: 'actor', hat: 'act', parent_entity_id: 'e1', display_name: 'A' };
  const ENTITY = { identity_id: 'e1', identity_type: 'entity', display_name: 'E' };

  /**
   * ⚠️⚠️ THE DEFECT THIS CLOSES WAS INVISIBLE BECAUSE IT LOOKED LIKE A PERMISSION. On PATCH, entity_id was the
   * CALLER's identity_id, so an actor's update matched no rows and returned 404 — indistinguishable from
   * "correctly refused". On POST the same line was not harmless: it would have created an actor parented to an
   * actor. So this asserts 403, not merely "not 200": a 404 here would be the old bug passing.
   */
  t('act co-assist  POST /actors      403 — not 404, which is what the bug looked like',
    await call('POST', '/api/actors', ACTOR, { display_name: 'New Person', actor_key: 'newp' }), 403);
  t('act co-assist  PATCH /actors/x   403', await call('PATCH', '/api/actors/x', ACTOR, { hat: 'manager' }), 403);
  t('  …including promoting THEMSELVES', await call('PATCH', '/api/actors/a1', ACTOR, { hat: 'manager' }), 403);
  t('entity login   POST /actors      NOT 403',
    (await call('POST', '/api/actors', ENTITY, { display_name: 'New Person', actor_key: 'newp' })) === 403 ? 403 : 'not-403', 'not-403');

  srv.close();
}

(async () => {
  await visibilityCases();
  gateCases();
  await routeCases();
  await provisioningCases();
  console.log('\n  ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();

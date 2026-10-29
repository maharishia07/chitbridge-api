/**
 * FX-L2C (2026-10-13) — A VIEW-ONLY LOGIN CANNOT WRITE, ON EVERY CRM ROUTE. Offline.
 *
 * The defect WX-L2C found: POST /api/actors { hat: 'view_only', access_level: 'viewer' } validated the level and never stored it, so the
 * row took b173's column default — editor — and lib/access.levelOf (column first, hat second) let the "viewer" through the hat gate on
 * every mutating route. Two halves here:
 *   1. the gate, per CRM write, driven through the REAL router + the REAL middleware/hat-gate.js (crm-stub as(…, { gate: true })):
 *      the row the old INSERT produced ({ hat: view_only, access_level: editor }) is ACCEPTED (the bug, kept as a record), the row
 *      the new INSERT produces ({ access_level: viewer }) is REFUSED with the sentence, a commenter too, an editor passes;
 *   2. POST /api/actors writes the level: the body's, else the hat's meaning (lib/access.FROM_HAT), else editor — the INSERT's own
 *      parameters, captured.
 * Run: node tests/crm-viewer.test.cjs
 */
'use strict';
const assert = require('assert'), path = require('path'), http = require('http'), express = require('express');
const API = path.join(__dirname, '..');
{ const p = require.resolve(path.join(API, 'lib/schema')); require.cache[p] = { id: p, filename: p, loaded: true, exports: { hasTable: async () => true, hasColumn: async () => true, hasColumns: async () => ({}), _reset() {} } }; }
const { make, row } = require('./support/crm-stub.cjs');
const t = make(), D = t.data;
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
const cs = (r, via, n) => Object.assign(r, { customer_type: 'entity', added_via: via || 'manual', txn_count: n == null ? 1 : n, segment: 'new' });
D.cust = [cs(row({ party_id: P(2), display_name: 'Lead Lata', user_id: '~acme.cus-0001' }), 'lead', 0)];
D.sup = []; D.memberships = [];
D.pre = async (sql) => (/^INSERT INTO memberships|^SELECT EXISTS \(SELECT 1 FROM customer_list|^SELECT txn_count FROM customer_list|^SELECT user_id, bridge_id FROM identities|^SELECT q\.followup_id|OUTCOME|^SELECT DISTINCT ON \(item_id\)/.test(sql) ? { rows: [] } : null);

/* every CRM write the screen offers, as the web calls it (routes/crm.js) */
const WRITES = [
  ['POST', '/leads', { name: 'Viewer Try' }, '+ Add lead'],
  ['POST', '/parties/' + P(2) + '/stage', { stage: 'demo' }, 'Move to…'],
  ['POST', '/parties/' + P(2) + '/interactions', { kind: 'note', body: 'hi' }, 'Log'],
  ['POST', '/followups', { party_id: P(2), what: 'Ring', due_at: '2026-10-20T03:30:00.000Z' }, 'Follow-up'],
  ['PATCH', '/followups/f1', { done: true }, 'Follow-up Done'],
  ['DELETE', '/followups/f1', null, 'Follow-up delete'],
  ['POST', '/parties/' + P(2) + '/outcome', { outcome: 'no_answer' }, 'a call outcome'],
  ['POST', '/leads/import', { rows: [{ name: 'A' }], dry: true }, 'Import leads'],
];
const call = (m, p, b) => (m === 'POST' ? t.post(p, b) : m === 'PATCH' ? t.patch(p, b) : t.del(p));
const who = (identity) => t.as('E1', { identity: Object.assign({ identity_id: 'A1', identity_type: 'actor', parent_entity_id: 'E1', display_name: 'Vel' }, identity), gate: true });

(async () => {
  console.log('\n-- the row the OLD insert produced: hat view_only, access_level editor (b173 default) --');
  for (const [m, p, b, label] of WRITES) await ita(label + ' · ' + m + ' ' + p.replace(P(2), ':id') + ' — ACCEPTED by the gate (the bug WX-L2C found; the fix is in POST /actors below)', async () => {
    who({ hat: 'view_only', access_level: 'editor' });
    const r = await call(m, p, b); assert.notStrictEqual(r.status, 403, 'the old row reaches the handler: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 80));
  });
  console.log('\n-- the row the NEW insert produces: access_level viewer --');
  for (const [m, p, b, label] of WRITES) await ita(label + ' · ' + m + ' ' + p.replace(P(2), ':id') + ' → 403 in words, nothing written', async () => {
    who({ hat: 'view_only', access_level: 'viewer' });
    const n = D.memberships.length, ni = D.interactions.length, nf = D.followups.length;
    const r = await call(m, p, b); assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    assert.ok(/View-only/.test(r.body.message) && /owner/.test(r.body.message), 'the sentence names the level and who can change it: ' + r.body.message);
    assert.strictEqual(r.body.access_level, 'viewer');
    assert.ok(D.memberships.length === n && D.interactions.length === ni && D.followups.length === nf, 'nothing written');
  });
  await ita('a commenter is refused too (reads, replies internally — never changes a record)', async () => {
    who({ hat: 'audit', access_level: 'commenter' }); const r = await t.post('/leads', { name: 'X' }); assert.strictEqual(r.status, 403); assert.ok(/Comment-only/.test(r.body.message), r.body.message);
  });
  await ita('an editor passes the gate (POST /leads reaches the route)', async () => {
    who({ hat: 'act', access_level: 'editor' }); const r = await t.post('/leads', { name: '' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'BAD_NAME');
  });
  await ita('a viewer still READS: GET /parties?view=leads · /calls · /followups answer 200', async () => {
    who({ access_level: 'viewer' });
    for (const p of ['/parties?view=leads', '/followups']) { const r = await t.get(p); assert.strictEqual(r.status, 200, p + ' ' + JSON.stringify(r.body).slice(0, 80)); }
  });
  await ita('pre-b173 row (no access_level column yet): hat view_only → commenter → refused; hat act → editor → passes', async () => {
    who({ hat: 'view_only' }); assert.strictEqual((await t.post('/leads', { name: 'X' })).status, 403);
    who({ hat: 'act' }); assert.strictEqual((await t.post('/leads', { name: '' })).status, 400);
  });
  await ita('W2-CRM (CRM-MAY): the SERVER says may/why — a viewer reads may.write { may:false, code:read_only, why } and may.remove OWNER_ONLY on GET /parties · /parties/:id · /followups; a commenter comment_only; an editor writes, never removes; the owner both; DELETE refuses with the same sentence', async () => {
    const WHY = require(path.join(API, 'lib/rail')).WHY, REMOVE = 'Only the owner can remove a party.';
    who({ access_level: 'viewer' });
    for (const p of ['/parties', '/parties/' + P(2), '/followups']) {
      const r = await t.get(p); assert.strictEqual(r.status, 200, p + ' ' + JSON.stringify(r.body).slice(0, 80));
      assert.deepStrictEqual(r.body.may.write, { may: false, code: 'read_only', why: WHY.read_only }, p + ' write');
      assert.deepStrictEqual(r.body.may.remove, { ok: false, code: 'OWNER_ONLY', why: REMOVE }, p + ' remove');
    }
    assert.strictEqual((await t.get('/calls')).body.may.write.code, 'read_only', 'GET /calls carries may.write beside its stage verdict');
    who({ access_level: 'commenter' }); assert.strictEqual((await t.get('/parties')).body.may.write.code, 'comment_only');
    who({ access_level: 'editor' }); const ed = (await t.get('/parties')).body.may; assert.strictEqual(ed.write.may, true); assert.strictEqual(ed.remove.ok, false);
    const r2 = await t.del('/parties/' + P(2)); assert.strictEqual(r2.status, 403); assert.strictEqual(r2.body.message, REMOVE, 'the DELETE refuses with the very sentence may.remove.why carried');
    t.as('E1'); assert.deepStrictEqual((await t.get('/parties')).body.may, { write: { may: true, code: null, why: null }, remove: { ok: true, code: null, why: null } });
  });
  t.close();

  /* ── 2 · POST /api/actors WRITES the level ────────────────────────────────────────────────────────────────────────────────── */
  console.log('\n-- POST /api/actors stores access_level (the INSERT, captured) --');
  const inserts = [];
  const dbPath = require.resolve(path.join(API, 'db'));
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    query: async (sql, p) => { if (/^\s*INSERT INTO identities/.test(sql)) inserts.push({ sql: String(sql).replace(/\s+/g, ' '), p }); /* lib/schema.hasColumn probes information_schema: the column is there (b173), so the INSERT names it */ return { rows: /information_schema/.test(sql) ? [{ one: 1 }] : [] }; },
    withEntity: async (_i, fn) => fn({ query: async () => ({ rows: [] }) }), trySavepoint: async (_h, fn, fb) => { try { return await fn(); } catch (_) { return fb; } } } };
  const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign((req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity', display_name: 'Acme' }; next(); }, { entityOf: () => 'e1' }) };
  delete require.cache[require.resolve(path.join(API, 'routes', 'actors'))];
  const app = express(); app.use(express.json()); app.use('/api/actors', require(path.join(API, 'routes', 'actors')));
  const srv = app.listen(0), port = srv.address().port;
  const post = (body) => new Promise((ok, no) => { const d = JSON.stringify(body); const r = http.request({ port, path: '/api/actors', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d) } }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => ok({ status: res.statusCode, body: b ? JSON.parse(b) : {} })); }); r.on('error', no); r.end(d); });
  const level = () => { const i = inserts[inserts.length - 1]; const m = i.sql.match(/email, access_level, whole_entity\s*\)/); assert.ok(m, 'the INSERT names access_level: ' + i.sql.slice(0, 200)); return i.p[11]; /* $12, after PEOPLE-EMAIL's $11 (SEC-106 took the code out of the INSERT) */ };
  await ita('{ hat: view_only, access_level: viewer } → the row holds viewer (the walk\'s own case)', async () => { inserts.length = 0; const r = await post({ display_name: 'Vel Viewer', actor_key: 'velview', hat: 'view_only', access_level: 'viewer' }); assert.ok(r.status < 300, JSON.stringify(r.body)); assert.strictEqual(level(), 'viewer'); });
  await ita('{ hat: view_only } alone → commenter (lib/access.FROM_HAT, what the hat always meant)', async () => { inserts.length = 0; await post({ display_name: 'Old Client', actor_key: 'oldc', hat: 'view_only' }); assert.strictEqual(level(), 'commenter'); });
  await ita('{ access_level: commenter } → commenter', async () => { inserts.length = 0; await post({ display_name: 'Audit Anu', actor_key: 'anuk', access_level: 'commenter' }); assert.strictEqual(level(), 'commenter'); });
  await ita('nothing given → editor (what the column default gave: nobody is demoted)', async () => { inserts.length = 0; await post({ display_name: 'Counter Kavi', actor_key: 'kavi' }); assert.strictEqual(level(), 'editor'); });
  await ita('the token and the person shape carry the level (lib/identity-auth: a screen greys from it; the server decides on the row)', async () => {
    const IA = require(path.join(API, 'lib', 'identity-auth'));
    const shape = IA.personShape({ identity_id: 'a1', identity_type: 'actor', parent_entity_id: 'e1', hat: 'view_only', access_level: 'viewer' });
    assert.strictEqual(shape.access_level, 'viewer'); assert.strictEqual(IA.personShape({ identity_id: 'e1', identity_type: 'entity' }).access_level, 'editor');
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(40);
    const tok = IA.signToken({ identity_id: 'a1', identity_type: 'actor', access_level: 'viewer' }, null);
    assert.strictEqual(JSON.parse(Buffer.from(tok.split('.')[1], 'base64').toString()).access_level, 'viewer');
  });
  srv.close();
  console.log('  ' + pass + ' checks');
})();

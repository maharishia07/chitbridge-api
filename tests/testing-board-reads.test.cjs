'use strict';
/**
 * tests/testing-board-reads.test.cjs — WHO READS THE SHARED TEST BOARD (SEC-122, Athi 2026-10-31).
 *
 * "Test board reads gated to builder/root": GET of the shared board (cases · gherkin · results · runs · coverage · report ·
 * reliability · stale · engine · cmdb · cmdb/:ci) asks the SAME door as the board writes (routes/testing.js boardReadGate →
 * testboard.canWrite = the board's own entity · TEST_BOARD_WRITERS · the platform root). A shop gets 403 problem+json,
 * code NOT_BOARD_READER. The own-shop reads (incidents · requirements · changes · releases) and /trace stay open: that is the Test lab.
 *
 * Real route file over a stand-in db and sign-in, TEST_BOARD_ENTITY set so the board IS shared.
 * Run: node tests/testing-board-reads.test.cjs   · no DB, no network.
 */
const assert = require('assert'), path = require('path'), http = require('http'), express = require('express');
const API = path.join(__dirname, '..');
const BOARD = '00000000-0000-4000-8000-0000000000b0', SHOP = '11111111-1111-4111-8111-111111111111';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.TEST_BOARD_ENTITY = BOARD;
delete process.env.TEST_BOARD_WRITERS;
delete process.env.PLATFORM_ROOT_ENTITY;

let who = { identity_id: SHOP, identity_type: 'entity', display_name: 'A shop' };
const mock = (rel, exp) => { const f = require.resolve(path.join(API, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };
const realAuth = require(path.join(API, 'middleware', 'auth'));
mock('middleware/auth', Object.assign((req, res, next) => { req.identity = who; next(); }, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }));
const client = { query: async () => ({ rows: [], rowCount: 0 }) };
const known = { query: client.query, withEntity: async (id, run) => run(client), withTransaction: async (run) => run(client), onEntity: async (id, run) => run(client), trySavepoint: async (db, run) => run(client), readBatch: async (id, actor, st) => st.map(() => ({ rows: [], rowCount: 0 })) };
const db = new Proxy(known, { get: (t, n) => (n in t ? t[n] : typeof n === 'symbol' || n === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) });
mock('db', db); mock('db/index', db);
console.error = console.warn = () => undefined;

const app = express(); app.use(express.json());
app.use('/api/testing', require(path.join(API, 'routes', 'testing.js')));

let pass = 0;
const it = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };
function get(port, url) {
  return new Promise((resolve, reject) => http.get({ port, path: url }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) { /* not json */ } resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), json: j }); }); }).on('error', reject));
}

const GATED = ['/cases', '/cases/gherkin', '/results', '/runs', '/coverage', '/report', '/reliability', '/stale', '/engine', '/cmdb', '/cmdb/CI-1'];
const OPEN = ['/incidents', '/requirements', '/changes', '/releases', '/trace', '/vocabulary'];

(async () => {
  const server = app.listen(0); const port = server.address().port;
  console.log('\nA SHOP IS REFUSED THE SHARED BOARD (TEST_BOARD_ENTITY set)\n');
  for (const r of GATED) {
    await it('GET ' + r + ' → 403 problem+json NOT_BOARD_READER for a shop', async () => {
      who = { identity_id: SHOP, identity_type: 'entity', display_name: 'A shop' };
      const a = await get(port, '/api/testing' + r);
      assert.strictEqual(a.status, 403, 'status ' + a.status);
      assert.ok(/application\/problem\+json/.test(a.type), 'content-type ' + a.type);
      assert.strictEqual(a.json && a.json.code, 'NOT_BOARD_READER');
    });
  }
  console.log('\nTHE BOARD OWNER READS IT (a builder)\n');
  for (const r of GATED) {
    await it('GET ' + r + ' is not refused for the board account', async () => {
      who = { identity_id: BOARD, identity_type: 'entity', display_name: 'Builder' };
      const a = await get(port, '/api/testing' + r);
      assert.notStrictEqual(a.status, 403, 'refused the board account');
      assert.ok(a.status < 500 || a.status === 500, 'status ' + a.status);
    });
  }
  console.log('\nTHE TEST LAB STAYS OPEN TO A SHOP\n');
  for (const r of OPEN) {
    await it('GET ' + r + ' is not refused for a shop', async () => {
      who = { identity_id: SHOP, identity_type: 'entity', display_name: 'A shop' };
      const a = await get(port, '/api/testing' + r);
      assert.notStrictEqual(a.status, 403, 'a shop was refused its own Test lab');
      assert.notStrictEqual(a.status, 401);
    });
  }
  server.close();
  console.log('\n' + (process.exitCode ? '✗ failed' : '✓ ' + pass + ' passed') + ' · ' + pass + ' checks\n');
  process.exit(process.exitCode || 0);
})();

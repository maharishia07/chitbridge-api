/**
 * tests/governance-entity-own.test.cjs — SEC (23 Oct): GET /api/governance/entities/:id shows a shop's plan, overrides and exceptions
 * to that shop and to the platform only. Another shop's id gets exactly the answer an unknown id gets (404), so the door neither
 * shows another shop's data nor says that it exists. Found by the generated foreign_id_404 case (api #344).
 * Offline: the database is a stand-in in the require cache that holds one governed shop; the router is served on 127.0.0.1.
 * Run: node tests/governance-entity-own.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-the-api-walk';
process.env.NODE_ENV = 'test';

const SHOP_A = '00000000-0000-4000-8000-00000000000a';
const SHOP_B = '00000000-0000-4000-8000-00000000000b';
const UNKNOWN = '00000000-0000-4000-8000-0000000000ff';

/* the stand-in database: shop B is governed (its plan and override are what must not reach shop A) and a constitution is active, so the view answers in full; every other read is empty */
const governedRow = { constitution_version: 1, params_override: { secret_limit: 7 }, plan: 'shop-b-plan' };
const answer = async (sql, params) => {
  const text = String(sql);
  if (/FROM identities WHERE governed_by IS NOT NULL/.test(text)) return params && params[0] === SHOP_B ? { rows: [governedRow], rowCount: 1 } : { rows: [], rowCount: 0 };
  if (/FROM platform_constitution/.test(text)) return { rows: [{ version: 1, params: {}, plan_menu: {}, root_id: 'root' }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
};
const client = { query: answer };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { query: answer, pool: { query: answer }, withEntity: async (id, body) => body(client), withTransaction: async (body) => body(client), onEntity: async (id, db, body) => body(client) }
};

const express = require('express');
const jwt = require('jsonwebtoken');
const app = express();
app.use(express.json());
app.use('/api/governance', require(path.join(API, 'routes', 'governance.js')));
const tokenOf = (shop, extra) => jwt.sign(Object.assign({ identity_id: shop, identity_type: 'entity', bridge_id: 'CB-T' }, extra), process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

/** one GET to the router: { status, text } */
function read(port, id, token) {
  return new Promise((resolve) => {
    http
      .get({ host: '127.0.0.1', port, path: '/api/governance/entities/' + id, headers: { authorization: 'Bearer ' + token } }, (res) => {
        let text = '';
        res.on('data', (part) => (text += part));
        res.on('end', () => resolve({ status: res.statusCode, text }));
      })
      .on('error', (failure) => resolve({ status: 0, text: failure.message }));
  });
}

let passed = 0;
let failed = 0;
const check = (label, condition) => {
  if (condition) passed++;
  else failed++;
  console.log('  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label);
};

(async () => {
  console.log('\ngovernance · a shop reads its own governance view, never another shop\'s');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const quiet = console.error;
  console.error = () => {};
  const foreign = await read(port, SHOP_B, tokenOf(SHOP_A));
  const unknown = await read(port, UNKNOWN, tokenOf(SHOP_A));
  const own = await read(port, SHOP_B, tokenOf(SHOP_B));
  const platform = await read(port, SHOP_B, tokenOf(SHOP_A, { owner_scope: 'platform' }));
  console.error = quiet;
  server.close();

  check("another shop's id answers 404", foreign.status === 404);
  check("another shop's id gets byte for byte the unknown id's answer", foreign.status === unknown.status && foreign.text === unknown.text);
  check("another shop's plan and override never appear in the answer", !/shop-b-plan|secret_limit/.test(foreign.text));
  check('the shop itself reads its own view, plan included', own.status === 200 && /shop-b-plan/.test(own.text));
  check("the platform reads any shop's view", platform.status === 200 && /shop-b-plan/.test(platform.text));
  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();

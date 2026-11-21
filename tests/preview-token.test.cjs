#!/usr/bin/env node
/**
 * tests/preview-token.test.cjs — CUSTOMER-DELINK 2: the owner's PREVIEW TOKEN (lib/preview-token.js, auth.previewIdentity, POST /api/entities/me/preview-token).
 * Real routes/catalogue.js, real middleware/auth.js, real routes/entities.js mint; only the database and the catalogue view are stand-ins.
 *   a. the mint hands a token for the caller's OWN shop (aud cb-shop-preview, 15 min), no identity in it
 *   b. the token reads its shop's PRIVATE preview (200, cost-blind); a stranger gets 404
 *   c. refused (401/403) on back-office routes, and a stranger on the shop read WITHOUT ?preview=1
 *   d. refused after expiry, for another shop, when longer-lived than 15 min, and without its audience
 *   e. the mint with no token is refused 401
 * Run: node tests/preview-token.test.cjs · 127.0.0.1 only, no DB. CARD 10-online-shop-and-storefront-orders/functions/the-online-shop-public-page
 */
'use strict';
const path = require('path'), http = require('http'), jwt = require('jsonwebtoken'), express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-preview';
process.env.NODE_ENV = 'test';
const API = path.join(__dirname, '..');
const NOW = Math.floor(Date.now() / 1000);
const SHOP = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const ROWS = {
  [SHOP]: { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop One', bridge_id: 'BR-ONE', user_id: 'shopone', status: 'active', policy_flags: { devices: { dev12345: { sessions: [{ jti: 'live-jti', exp: NOW + 3600 }] } } } },
  [OTHER]: { identity_id: OTHER, identity_type: 'entity', display_name: 'Shop Two', bridge_id: 'BR-TWO', status: 'active', policy_flags: {} }
};
const q = async (sql, params) => {
  const s = String(sql);
  if (/information_schema\.columns/.test(s)) return { rows: [{ '?column?': 1 }] };
  if (/SELECT policy_flags FROM identities/.test(s)) return { rows: [{ policy_flags: (ROWS[params[0]] || {}).policy_flags || {} }] };
  if (/SELECT identity_id, bridge_id FROM identities WHERE identity_id = \$1/.test(s)) return { rows: ROWS[params[0]] ? [ROWS[params[0]]] : [] };
  if (/FROM identities/.test(s) && /bridge_id = \$1/.test(s)) return { rows: [ROWS[params[0] === 'BR-TWO' ? OTHER : SHOP]] };
  if (/status/.test(s) && /identities/.test(s) && /identity_id = \$1/.test(s)) return { rows: ROWS[params[0]] ? [{ status: 'active' }] : [] };
  return { rows: [] };
};
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: q, withEntity: async (_e, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }), trySavepoint: async (_d, fn) => fn(), pool: { query: q } } };
const viewPath = require.resolve(path.join(API, 'lib', 'catalogue-view'));
const real = require(viewPath);
const view = (o) => (o.asOwner ? { available: true, shop: { name: 'Shop' }, items: [{ name: 'Tussar', price: 500, item_data: { cost: 380 } }], visibility: 'private' } : { available: false });
require.cache[viewPath].exports = Object.assign({}, real, { buildPublicView: async (o) => view(o) });

const app = express();
app.use(express.json());
app.use('/api/catalogue', require(path.join(API, 'routes', 'catalogue')));
app.use('/api/entities', require(path.join(API, 'routes', 'entities')));
const sign = (c, o) => jwt.sign(c, process.env.JWT_SECRET, Object.assign({ algorithm: 'HS256', expiresIn: 3600 }, o || {}));
const OWNER = sign({ identity_id: SHOP, identity_type: 'entity', jti: 'live-jti', device_id: 'dev12345' });
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log((cond ? '  ok  ' : '  FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(extra))); };
function call(port, method, urlPath, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-device-id': 'dev12345', 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    const r = http.request({ port, host: '127.0.0.1', path: urlPath, method, headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, text: b }));
    });
    r.on('error', reject); r.end(method === 'GET' ? undefined : '{}');
  });
}
(async () => {
  const server = app.listen(0); const port = server.address().port;
  const P = '/api/catalogue/BR-ONE?preview=1';
  console.log('CUSTOMER-DELINK 2 · preview token');
  ok('(e) the mint with no token is refused 401', (await call(port, 'POST', '/api/entities/me/preview-token')).status === 401);
  const minted = await call(port, 'POST', '/api/entities/me/preview-token', OWNER);
  const m = minted.status === 200 ? JSON.parse(minted.text) : {};
  ok('(a) the owner session mints a token', minted.status === 200 && !!m.token && m.expires_in === 900, minted);
  const c = m.token ? jwt.decode(m.token) : {};
  ok('(a) it names its audience, its shop and 15 minutes, and carries no identity', c.aud === 'cb-shop-preview' && c.shop === SHOP && c.exp - c.iat === 900 && !c.identity_id && !c.identity_type, c);
  ok('(b) a stranger gets 404 for the private shop', (await call(port, 'GET', P)).status === 404);
  const read = await call(port, 'GET', P, m.token);
  ok('(b) the preview token reads the private preview', read.status === 200 && /Tussar/.test(read.text), read);
  ok('(b) the answer is cost-blind', !/"cost"/.test(read.text), read.text);
  ok('(c) the same token WITHOUT ?preview=1 is a stranger', (await call(port, 'GET', '/api/catalogue/BR-ONE', m.token)).status === 404);
  for (const [method, url] of [['GET', '/api/entities/me/can-see-costs'], ['POST', '/api/entities/me/preview-token'], ['GET', '/api/entities/me'], ['PATCH', '/api/entities/me/exposure']]) {
    const r = await call(port, method, url, m.token);
    ok('(c) refused on the back-office route ' + method + ' ' + url + ' (401/403)', r.status === 401 || r.status === 403, r);
  }
  const expired = sign({ kind: 'shop_preview', shop: SHOP, jti: 'x' }, { audience: 'cb-shop-preview', expiresIn: -10 });
  ok('(d) an expired preview token is a stranger', (await call(port, 'GET', P, expired)).status === 404);
  const forOther = sign({ kind: 'shop_preview', shop: OTHER, jti: 'x' }, { audience: 'cb-shop-preview', expiresIn: 900 });
  ok('(d) a token made for another shop opens nothing here', (await call(port, 'GET', P, forOther)).status === 404);
  const otherRead = await call(port, 'GET', '/api/catalogue/BR-TWO?preview=1', m.token);
  ok('(d) this shop token on another shop is a stranger', otherRead.status === 404, otherRead);
  const longLived = sign({ kind: 'shop_preview', shop: SHOP, jti: 'x' }, { audience: 'cb-shop-preview', expiresIn: 7 * 86400 });
  ok('(d) a week-long preview token is not one of ours', (await call(port, 'GET', P, longLived)).status === 404);
  const noAud = sign({ kind: 'shop_preview', shop: SHOP, jti: 'x' }, { expiresIn: 900 });
  ok('(d) the same claims without the audience are refused', (await call(port, 'GET', P, noAud)).status === 404);
  server.close();
  console.log('\n  ' + (pass + fail) + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

/**
 * tests/sec-fix2.test.cjs — SEC-FIX2 · the Claude review's C4 · C6 · M3 · L1 · L2 (docs/critique/SEC-FIX2.md), each reproduced
 * against the REAL routes (products · catalogue · assist · keys) and the real middleware; only the database is a stand-in.
 *
 *   C4  a product's `media` / `image` are SERVER-OWNED: a client write that sets or changes them is refused (400 SERVER_OWNED)
 *       on every door (PATCH · POST · the declaration gate); an unchanged echo passes. The object store's get/del refuse a key
 *       that is not under the owner's prefix, so a shop cannot read or delete another shop's object through its own item.
 *   C6  the network store: membership from the network edge tables (cb_entity + cb_edge via network-membership), never
 *       item_data; the order route is CLOSED unless NETWORK_STORE_ORDERS=true, needs a signed-in storefront customer (the
 *       customer token — never an e-mail), and that customer belongs to the brand or a member.
 *   M3  POST /assist/catalogue-adopt and GET /assist/catalogue-mine run the real `auth` (revoked actor → 401, viewer → 403).
 *   L1  DELETE /api/keys/:jti is owner-only (lib/owner.gate): a co-assist gets 403 OWNER_ONLY.
 *   LIVE 2/3  lib/db-role verdict (RLS-bypassing role refuses to serve) · the tester door is SHUT on an empty TESTER_NAMES (fail closed, SEC finding 3) with a WARN; * is every account outside production
 *   L2  routes/entities.js routing/preview and routes/till.js listen answer safeErr words, never the raw error text.
 *
 * Run: node tests/sec-fix2.test.cjs · no DB, no network beyond 127.0.0.1.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-sec-fix2';
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
delete process.env.NETWORK_STORE_ORDERS;
const API = path.join(__dirname, '..');

/* ── the cast ── */
const S = 'aaaaaaaa-0000-4000-8000-00000000000a';   // the brand / shop whose products and keys we test
const R = 'bbbbbbbb-0000-4000-8000-00000000000b';   // a member store of S's network (an active commercial edge)
const X = 'eeeeeeee-0000-4000-8000-00000000000e';   // a stranger shop
const CUST = 'cccccccc-0000-4000-8000-00000000000c'; // a storefront customer of S
const ITEM = '17e17e17-0000-4000-8000-000000000017';   // S's item, its picture under S's prefix
const EVIL = '17e17e17-0000-4000-8000-000000000018';   // S's item that NAMES a key under R's prefix (the C4 scenario)
const R_ITEM = '17e17e17-0000-4000-8000-000000000019'; // R's public item (in the network store)
const KEY_S = S + '/2026/10/m1', KEY_R = R + '/2026/10/m9';
const ACTORS = {
  'a-vw': { parent: S, access_level: 'viewer', whole_entity: false, hat: 'view_only' },
  'a-ed': { parent: S, access_level: 'editor', whole_entity: false, hat: 'act' },
};
const STORED = {
  [ITEM]: { name: 'Rice 25kg', price: 1200, media: [{ id: 'm1', key: KEY_S, kind: 'image', mime: 'image/png' }], image: 'http://api/api/products/media/' + ITEM + '/m1' },
  [EVIL]: { name: 'Mirror', price: 10, media: [{ id: 'm9', key: KEY_R, kind: 'image', mime: 'image/png' }] },
};
const SQL = [];
function rowsFor(sql, p) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  p = p || [];
  SQL.push({ s, p });
  if (/break_status/.test(s) && /FROM identities/.test(s)) { const a = ACTORS[p[0]]; return a ? [{ break_status: 'active', hat: a.hat, access_level: a.access_level, whole_entity: a.whole_entity }] : []; }
  if (/SELECT item_data FROM catalogue_items WHERE item_id ?= ?\$1 AND entity_id ?= ?\$2/.test(s)) return STORED[p[0]] ? [{ item_data: STORED[p[0]] }] : [];
  if (/SELECT entity_id FROM media_blobs WHERE key LIKE/.test(s)) return [{ entity_id: S }];
  if (/SELECT entity_id, item_data FROM catalogue_items WHERE item_id = \$1 AND is_active/.test(s)) return STORED[p[0]] ? [{ entity_id: S, item_data: STORED[p[0]] }] : [];
  if (/SELECT bytes FROM media_blobs/.test(s)) return [{ bytes: Buffer.from('png-bytes') }];
  if (/UPDATE catalogue_items/.test(s)) return [{ item_id: ITEM, entity_id: S, item_data: STORED[ITEM] }];
  if (/INSERT INTO catalogue_items/.test(s)) return [{ item_id: 'new-1', entity_id: S, item_data: {} }];
  if (/SELECT currency_code, country FROM identities/.test(s)) return [{ currency_code: 'INR', country: 'IN' }];
  if (/SELECT policy_flags FROM identities/.test(s)) return [{ policy_flags: { api_keys: [] } }];
  if (/MAX\(display_order\)/.test(s)) return [{ m: 0 }];
  /* the network: the brand by its handle, its roster from the edges, the members' public items */
  if (/FROM identities/.test(s) && /bridge_id = \$1/.test(s) && /identity_type = 'entity'/.test(s)) return p[0] === 'brand-s' ? [{ identity_id: S, bridge_id: 'brand-s', display_name: 'Brand S' }] : [];
  if (/'built' AS via/.test(s)) return p[0] === S ? [{ id: R, via: 'joined', state: 'active', edge_id: 'e1' }] : [];
  if (/FROM catalogue_items ci WHERE ci\.entity_id = ANY\(\$1/.test(s)) return [{ item_id: R_ITEM, entity_id: R, item_data: { name: 'Dal 1kg', price: 90, category: 'Pulses' } }];
  if (/SELECT item_id, entity_id, item_data FROM catalogue_items WHERE item_id = ANY\(\$1::uuid\[\]\) AND entity_id = ANY/.test(s)) return p[0].includes(R_ITEM) ? [{ item_id: R_ITEM, entity_id: R, item_data: { name: 'Dal 1kg', price: 90, category: 'Pulses' } }] : [];
  if (/SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = ANY/.test(s)) return [{ identity_id: S, bridge_id: 'brand-s', display_name: 'Brand S' }, { identity_id: R, bridge_id: 'store-r', display_name: 'Store R' }];
  return [];
}
const q = async (sql, p) => { const rows = rowsFor(sql, p); return { rows, rowCount: rows.length }; };
const tx = { query: q };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) },
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx),
  readBatch: async (ent, db, stmts) => (stmts || []).map(() => ({ rows: [] })), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
} };
const sc = require(path.join(API, 'lib', 'schema'));
sc.hasColumn = async () => true; sc.hasTable = async (t) => t === 'media_blobs';
require(path.join(API, 'lib', 'schema-bootstrap')).ensureDefaultSchema = async () => ({ schema_id: 'sch-1' });
/* the rail's delivery — recorded, never written */
const DELIVERED = [];
const mint = require(path.join(API, 'lib', 'mint'));
mint.deliver = async (sender, chit_id, copies) => { DELIVERED.push({ sender, chit_id, copies }); };
const origErr = console.error; if (!process.env.SEC_FIX2_DEBUG) console.error = () => {};   // SEC_FIX2_DEBUG=1 shows the routes' own error lines

const products = require(path.join(API, 'routes', 'products'));
const cat = require(path.join(API, 'routes', 'catalogue'));
const assist = require(path.join(API, 'routes', 'assist'));
const keys = require(path.join(API, 'routes', 'keys'));
const objStore = require(path.join(API, 'lib', 'storage-object'));
const catcols = require(path.join(API, 'lib', 'catalogue-columns'));
const app = express(); app.use(express.json({ limit: '2mb' }));
app.use('/api/products', products); app.use('/api/catalogue', cat); app.use('/api/assist', assist); app.use('/api/keys', keys);

const tok = (id, type, parent, extra) => jwt.sign(Object.assign({ identity_id: id, identity_type: type, display_name: 'who-' + id.slice(0, 5) },
  parent ? { parent_entity_id: parent } : {}, extra || {}), process.env.JWT_SECRET, { algorithm: 'HS256' });
const owner = tok(S, 'entity');
const actor = (id) => tok(id, 'actor', ACTORS[id].parent);
const customer = (shop) => tok(CUST, 'customer', shop, { bridge_id: 'cust-1' });

function call(method, url, token, body) {
  return new Promise((done) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const data = body ? JSON.stringify(body) : '';
      const headers = token ? { Authorization: 'Bearer ' + token } : {};
      if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers }, (res) => {
        const chunks = []; res.on('data', (c) => chunks.push(c));
        res.on('end', () => { srv.close(); const b = Buffer.concat(chunks); let j = null; try { j = JSON.parse(b.toString()); } catch (_) {} done({ status: res.statusCode, body: j || {}, raw: b }); });
      });
      r.on('error', (e) => { srv.close(); done({ status: 'ERR ' + e.code, body: {}, raw: Buffer.alloc(0) }); });
      r.end(data);
    });
  });
}

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? '\n       ' + extra : '')); } };
const show = (r) => r.status + ' ' + JSON.stringify(r.body).slice(0, 200);
const sawSql = (re) => SQL.some((x) => re.test(x.s));

(async () => {
  console.log('\n— C4 · media and image are server-owned —');
  t('RESERVED names media and image (never a declared column)', !!catcols.RESERVED.media && !!catcols.RESERVED.image);
  t('serverOwnedChange: setting media on a new item is a change', typeof catcols.serverOwnedChange === 'function' && catcols.serverOwnedChange({ media: [{ id: 'x' }] }, null) === 'media');
  t('serverOwnedChange: an unchanged echo of media + image is NOT a change', typeof catcols.serverOwnedChange === 'function' && catcols.serverOwnedChange(STORED[ITEM], STORED[ITEM]) === null);
  t('serverOwnedChange: a changed image is a change', typeof catcols.serverOwnedChange === 'function' && catcols.serverOwnedChange(Object.assign({}, STORED[ITEM], { image: 'http://evil' }), STORED[ITEM]) === 'image');

  let r = await call('PATCH', '/api/products/' + ITEM, owner, { item_data: { media: [{ id: 'x', key: KEY_R }] } });
  t('PATCH /products/:id that sets media → 400 SERVER_OWNED', r.status === 400 && r.body.code === 'SERVER_OWNED', show(r));
  r = await call('PATCH', '/api/products/' + ITEM, owner, { merge: true, item_data: { image: 'http://evil/x.png' } });
  t('PATCH merge:true that sets image → 400 SERVER_OWNED', r.status === 400 && r.body.code === 'SERVER_OWNED', show(r));
  r = await call('PATCH', '/api/products/' + ITEM, owner, { merge: true, item_data: { price: 1300 } });
  t('PATCH merge:true that leaves media alone → 200', r.status === 200, show(r));
  r = await call('PATCH', '/api/products/' + ITEM, owner, { item_data: STORED[ITEM] });
  t('PATCH echoing the whole record (media unchanged) → 200', r.status === 200, show(r));
  r = await call('POST', '/api/products', owner, { item_data: { name: 'New', price: 5, image: 'http://evil/x.png' } });
  t('POST /products with image → 400 SERVER_OWNED', r.status === 400 && r.body.code === 'SERVER_OWNED', show(r));

  SQL.length = 0;
  let threw = null;
  try { await objStore.get(KEY_R, S); } catch (e) { threw = e; }
  t('storage-object.get refuses a key not under the owner (code NOT_OWNER), without a read', threw && threw.code === 'NOT_OWNER' && !sawSql(/SELECT bytes/), threw ? threw.message : 'no error');
  threw = null; SQL.length = 0;
  try { await objStore.del(KEY_R, S); } catch (e) { threw = e; }
  t('storage-object.del refuses a key not under the owner, without a delete', threw && threw.code === 'NOT_OWNER' && !sawSql(/DELETE FROM media_blobs/), threw ? threw.message : 'no error');
  SQL.length = 0;
  const bytes = await objStore.get(KEY_S, S);
  t('storage-object.get serves the owner\'s own key', Buffer.isBuffer(bytes) && bytes.toString() === 'png-bytes');
  threw = null;
  try { await objStore.get(KEY_S); } catch (e) { threw = e; }
  t('storage-object.get without an owner is refused (the owner is not optional)', threw && threw.code === 'NOT_OWNER', threw ? threw.message : 'no error');

  SQL.length = 0;
  r = await call('GET', '/api/products/media/' + EVIL + '/m9', null);
  t('public GET /products/media on an item naming another shop\'s key → 404, bytes never read', r.status === 404 && !sawSql(/SELECT bytes/), show(r));
  r = await call('GET', '/api/products/media/' + ITEM + '/m1', null);
  t('public GET /products/media on the shop\'s own key → 200 with the bytes', r.status === 200 && r.raw.toString() === 'png-bytes', show(r));
  SQL.length = 0;
  r = await call('DELETE', '/api/products/' + EVIL + '/media/m9', owner);
  t('DELETE /products/:id/media/:mid on another shop\'s key → the item entry goes, the OBJECT is never deleted', r.status === 200 && !sawSql(/DELETE FROM media_blobs/), show(r));
  SQL.length = 0;
  r = await call('DELETE', '/api/products/' + ITEM + '/media/m1', owner);
  t('DELETE on the shop\'s own key deletes the object', r.status === 200 && sawSql(/DELETE FROM media_blobs/), show(r));

  console.log('\n— C6 · the network store reads the edges, the order needs a flag and a customer —');
  SQL.length = 0;
  r = await call('GET', '/api/catalogue/network-store/brand-s', null);
  t('GET /network-store/:brand lists the members\' public items', r.status === 200 && (r.body.products || []).some((p) => p.product_id === R_ITEM), show(r));
  t('…membership is read from the edges (ROSTER_SQL), never item_data.network_id', sawSql(/'built' AS via/) && !sawSql(/network_id/), SQL.map((x) => x.s.slice(0, 80)).join(' | '));
  r = await call('GET', '/api/catalogue/network-store/no-such-brand', null);
  t('GET /network-store of an unknown handle → 404', r.status === 404, show(r));

  const ORDER = '/api/catalogue/network-store/brand-s/order';
  const cartBody = { items: [{ product_id: R_ITEM, qty: 2 }], customer: { name: 'Mallory', email: 'owner@shop.test' } };
  delete process.env.NETWORK_STORE_ORDERS; DELIVERED.length = 0; SQL.length = 0;
  r = await call('POST', ORDER, customer(S), cartBody);
  t('POST order with NETWORK_STORE_ORDERS unset → 403 NETWORK_ORDERS_OFF, nothing written', r.status === 403 && r.body.code === 'NETWORK_ORDERS_OFF' && DELIVERED.length === 0, show(r));
  process.env.NETWORK_STORE_ORDERS = 'true';
  r = await call('POST', ORDER, null, cartBody);
  t('POST order with the flag on but no customer token → 401 SIGN_IN_FIRST', r.status === 401 && r.body.code === 'SIGN_IN_FIRST' && DELIVERED.length === 0, show(r));
  r = await call('POST', ORDER, owner, cartBody);
  t('…a shop (entity) token is not a customer → 401', r.status === 401 && DELIVERED.length === 0, show(r));
  r = await call('POST', ORDER, customer(X), cartBody);
  t('…a customer of a stranger shop → 403 NOT_THIS_NETWORK', r.status === 403 && r.body.code === 'NOT_THIS_NETWORK' && DELIVERED.length === 0, show(r));
  SQL.length = 0; DELIVERED.length = 0;
  r = await call('POST', ORDER, customer(S), cartBody);
  t('…the brand\'s signed-in customer orders → 200 with order_id', r.status === 200 && !!r.body.order_id, show(r));
  t('…the customer is the TOKEN\'s identity: no identity resolved or created by e-mail', !sawSql(/WHERE email = \$1/) && !sawSql(/INSERT INTO identities/) && DELIVERED[0] && DELIVERED[0].sender === CUST, SQL.filter((x) => /identities/.test(x.s)).map((x) => x.s.slice(0, 90)).join(' | '));
  t('…the operator is the network root (the brand), not item_data.operator', DELIVERED[0] && DELIVERED[0].copies.some((c) => c.entity_id === S) && !sawSql(/item_data->>'network_id'/), DELIVERED.length ? JSON.stringify(DELIVERED[0].copies.map((c) => c.entity_id)) : 'nothing delivered');
  t('…the fragment goes operator → member store', DELIVERED.length === 2 && DELIVERED[1].sender === S && DELIVERED[1].copies.some((c) => c.entity_id === R), String(DELIVERED.length));
  delete process.env.NETWORK_STORE_ORDERS;

  console.log('\n— M3 · the assist writes run the real sign-in —');
  r = await call('POST', '/api/assist/catalogue-adopt', null, { source: 'x' });
  t('POST /assist/catalogue-adopt with no token → 401', r.status === 401, show(r));
  r = await call('POST', '/api/assist/catalogue-adopt', actor('a-vw'), { source: 'x' });
  t('…a View-only co-assist → 403 (the hat gate inside auth)', r.status === 403, show(r));
  r = await call('POST', '/api/assist/catalogue-adopt', tok('a-gone', 'actor', S), { source: 'x' });
  t('…a removed co-assist (valid signature, no row) → 401', r.status === 401, show(r));
  r = await call('GET', '/api/assist/catalogue-mine', tok('a-gone', 'actor', S));
  t('GET /assist/catalogue-mine as a removed co-assist → 401', r.status === 401, show(r));
  r = await call('GET', '/api/assist/catalogue-mine', actor('a-ed'));
  t('…an editor co-assist reads it → 200', r.status === 200, show(r));

  console.log('\n— L1 · revoking a key is the owner\'s —');
  r = await call('DELETE', '/api/keys/some-jti', actor('a-ed'), null);
  t('DELETE /api/keys/:jti as an editor co-assist → 403 OWNER_ONLY with why', r.status === 403 && r.body.code === 'OWNER_ONLY' && !!r.body.why, show(r));
  r = await call('DELETE', '/api/keys/some-jti', owner, null);
  t('…the owner reaches the revoke (404: no such key here)', r.status === 404, show(r));

  console.log('\n— L2 · no raw error text to the client —');
  const RAW_WHY = /\b(why|message):\s*String\(\s*(e|err)(?:\s*&&\s*\2)?\.message\b|\bwhy:\s*String\(\s*(e|err)\.message\s*\|\|\s*\3\s*\)/;
  const rawIn = (f) => fs.readFileSync(path.join(API, 'routes', f), 'utf8').split('\n').map((l, i) => (/res\.(status\(\d+\)\.)?json\(/.test(l) && RAW_WHY.test(l)) ? f + ':' + (i + 1) : null).filter(Boolean);
  const raw = rawIn('entities.js').concat(rawIn('till.js'));
  t('routes/entities.js routing/preview and routes/till.js listen answer safeErr, not e.message', raw.length === 0, raw.join(', '));

  console.log('\n— LIVE 2 · the database role must not bypass RLS —');
  const dbRole = require(path.join(API, 'lib', 'db-role'));
  const asRole = (o) => Object.assign({ current_user: 'cb_app', rolsuper: false, rolbypassrls: false }, o);
  t('cb_app / false / false → ok', dbRole.verdict(asRole({}), false).level === 'ok');
  t('a superuser role → fatal (refuse to serve)', dbRole.verdict(asRole({ current_user: 'postgres', rolsuper: true }), false).level === 'fatal');
  t('a BYPASSRLS role → fatal', dbRole.verdict(asRole({ rolbypassrls: true }), false).level === 'fatal');
  t('…on a local stack the same role only warns', dbRole.verdict(asRole({ rolsuper: true }), true).level === 'warn');
  t('no pg_roles row → warn, never ok', dbRole.verdict(null, false).level === 'warn');
  t('roleFacts runs the one SELECT through the given runner', (await dbRole.roleFacts(async (sql) => ({ rows: [sql === dbRole.ROLE_SQL ? asRole({}) : null] }))).current_user === 'cb_app');
  t('server.js checks the role before app.listen', /checkDbRole\(\)\.then\(startServing\)/.test(fs.readFileSync(path.join(API, 'server.js'), 'utf8')));

  console.log('\n— LIVE 3 · the tester door on an empty / * TESTER_NAMES outside a local stack —');
  const freshDevOtp = () => { delete require.cache[require.resolve(path.join(API, 'lib', 'dev-otp'))]; return require(path.join(API, 'lib', 'dev-otp')); };
  const was = { n: process.env.NODE_ENV, d: process.env.DATABASE_URL, names: process.env.TESTER_NAMES, code: process.env.TESTER_CODE };
  process.env.NODE_ENV = ' development'; process.env.DATABASE_URL = 'postgres://cb@db.example.com:5432/cb'; delete process.env.TESTER_NAMES; process.env.TESTER_CODE = 'tester-code-12345';
  let devOtp = freshDevOtp();
  t('production-like (remote DB), TESTER_NAMES empty → the door is SHUT to everyone (SEC finding 3: fail closed)', devOtp.testerCodeOk('tester-code-12345', ['owner@shop.test']) === false);
  t('…and boot says so at WARN: set TESTER_NAMES (the door is shut)', devOtp.testerNotices().some((n) => n.level === 'warn' && /set TESTER_NAMES/.test(n.msg)));
  process.env.TESTER_NAMES = '*'; devOtp = freshDevOtp();
  t('TESTER_NAMES * = every account, explicit, with its own WARN', devOtp.testerCodeOk('tester-code-12345', ['owner@shop.test']) === true && devOtp.testerNotices().some((n) => n.level === 'warn' && /TESTER_NAMES is \*/.test(n.msg)));
  process.env.TESTER_NAMES = 'qa-*'; devOtp = freshDevOtp();
  t('…with TESTER_NAMES set, a listed name passes and another does not', devOtp.testerCodeOk('tester-code-12345', ['qa-one']) === true && devOtp.testerCodeOk('tester-code-12345', ['owner@shop.test']) === false);
  delete process.env.TESTER_NAMES; process.env.DATABASE_URL = 'postgres://cb@localhost:5432/cb'; process.env.NODE_ENV = 'development'; devOtp = freshDevOtp();
  t('a local stack with an empty list is shut too', devOtp.testerCodeOk('tester-code-12345', ['anyone']) === false);
  for (const [k, v] of [['NODE_ENV', was.n], ['DATABASE_URL', was.d], ['TESTER_NAMES', was.names], ['TESTER_CODE', was.code]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }

  console.error = origErr;
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error = origErr; console.error(e); process.exit(1); });

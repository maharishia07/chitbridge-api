#!/usr/bin/env node
/**
 * till-price-worth.test.cjs — CAT-222 (W45 100% target): the counter's price change and "worth an offer", tested THROUGH THE ROUTE (routes/till.js).
 *
 * OWNS      the answers of POST /api/till/price and GET /api/till/worth-an-offer that the api-problem sweep cannot see (it checks a refusal's shape):
 *           · price: { ok, was 70, now 90, currency } and the ONE merge catalogue-write.patchItems receives { price:{amount,currency}, price_was, price_changed_by }
 *           · worth-an-offer: an expiry 3 days out -> "expires in 3 days" · last slip 20 days ago -> "not sold for 20 days" · never billed -> "never sold here"
 *             · days=999 is clamped to 180 (and quiet to 365)
 * CALLED BY by hand and CI (not the offline gate). No database, no network: the real router over a stand-in identity and db.
 * NOT HERE  "a received product absent from catalogue_items is not listed" is the WHERE EXISTS of WORTH_AN_OFFER_SQL: a stand-in db cannot run SQL, it
 *           needs the live-database run (the shelf is the authority, the SQL says so in its own comment).
 * Run: node tests/till-price-worth.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(84) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const mock = (rel, exported) => {
  const file = require.resolve(path.join(HERE, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};

const SHOP = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const DAY = 86400000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();
const ymd = (offsetDays) => iso(offsetDays).slice(0, 10);
/* the route counts WHOLE days from now to the expiry date at midnight (floor): a date that is 3.x days away reads 'in 3 days', so the 3-day case is ymd(4) and the 20-day case 19.5 days back */

/* the stand-in db: answers by what the statement reads */
let worthRows = [];
let itemData = { name: 'Tea', price: { amount: 70, currency: 'INR' } };
const run = async (sql) => {
  const text = String(sql);
  if (/FROM identities/.test(text)) return { rows: [{ currency_code: 'INR', country: 'IN' }] };
  if (/jsonb_array_elements/.test(text)) return { rows: worthRows }; /* first: its EXISTS also names catalogue_items */
  if (/FROM catalogue_items/.test(text)) return { rows: [{ item_data: itemData }] };
  return { rows: [] };
};
const handle = { query: run };
const db = { query: run, withEntity: async (id, fn) => fn(handle), withTransaction: async (fn) => fn(handle) };
mock('db', db);
mock('db/index', db);
const realAuth = require(path.join(HERE, 'middleware', 'auth'));
const stubAuth = (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' }; next(); };
mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.identity_id }));
require(path.join(HERE, 'lib', 'cost')).writeRefusal = async () => null; /* the cost gate has its own tests (OFFR-04) */
mock('lib/shopchanged', { shopChanged: () => undefined });
const merges = [];
const catwrite = require(path.join(HERE, 'lib', 'catalogue-write'));
catwrite.patchItems = async (h, entity, patches) => {
  merges.push(patches);
  return { rows: [{ item_data: Object.assign({}, itemData, patches[0].merge) }] };
};
console.error = () => undefined;
console.warn = () => undefined;

function call(port, method, route, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const q = http.request({ host: '127.0.0.1', port, method, path: route, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) { /* not JSON */ } resolve({ status: res.statusCode, body: j }); });
    });
    q.on('error', reject);
    q.end(data);
  });
}

(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/till', require(path.join(HERE, 'routes', 'till')));
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const port = server.address().port;

  let r = await call(port, 'POST', '/api/till/price', { item_id: ITEM, price: 90, by: 'Mani' });
  t('price-moved: 200 and { ok, was 70, now 90, currency INR }', [r.status, r.body && r.body.ok, r.body && r.body.was, r.body && r.body.now, r.body && r.body.currency], [200, true, 70, 90, 'INR']);
  const merge = merges[0] && merges[0][0] && merges[0][0].merge;
  t('...and the ONE writer got the merge { price:{amount:90,currency}, price_was:70, price_changed_by:Mani }', [merges[0] && merges[0][0].item_id, merge && merge.price, merge && merge.price_was, merge && merge.price_changed_by], [ITEM, { amount: 90, currency: 'INR' }, 70, 'Mani']);

  worthRows = [{ item_id: 'a', name: 'Milk', expiry: ymd(4), last_sold: iso(-1) }];
  r = await call(port, 'GET', '/api/till/worth-an-offer?days=14');
  t('worth-expiring: a goods-in line with an expiry in 3 days -> why[0] "expires in 3 days"', [r.status, r.body.items.length, r.body.items[0].why[0]], [200, 1, 'expires in 3 days']);

  worthRows = [{ item_id: 'b', name: 'Potato', expiry: null, last_sold: iso(-19.5) }];
  r = await call(port, 'GET', '/api/till/worth-an-offer');
  t('worth-quiet: last slip 20 days ago -> "not sold for 20 days"', r.body.items[0].why[0], 'not sold for 20 days');

  worthRows = [{ item_id: 'c', name: 'Saffron', expiry: null, last_sold: null }];
  r = await call(port, 'GET', '/api/till/worth-an-offer');
  t('worth-never-sold: no slip at all -> "never sold here"', r.body.items[0].why[0], 'never sold here');

  r = await call(port, 'GET', '/api/till/worth-an-offer?days=999&quiet=9999');
  t('worth-clamps: days=999 -> 180 and quiet=9999 -> 365', [r.body.days, r.body.quiet], [180, 365]);

  server.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error = console.log; console.log(e); process.exit(1); });

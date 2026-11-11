/**
 * tests/ctry-72-no-country-refusal.test.cjs - CTRY-72 (Athi, 11 Nov): A SHOP WITH NO COUNTRY OR PACK DATA GETS PLAIN WORDS, NEVER INDIA, 18% GST OR INR.
 *
 * OWNS      the api doors the CTRY-DATA census listed, each driven with a shop of NO country, an IN shop and an AU shop:
 *             lib/tax-governance.js      no country -> no slabs (NO_COUNTRY_SLABS_SAY says why); IN -> India's GST slabs; AU -> its own layer, never India's
 *             routes/products.js         GET /lists: no country -> currency null + money_why { NO_MONEY, the ONE sentence }; IN -> INR; AU -> AUD
 *             src/services/catalogue.js  createItem / createCategory with no currency -> 422 NO_MONEY (was 'INR' by default)
 * CALLED BY scripts/guards.cjs, by hand: node tests/ctry-72-no-country-refusal.test.cjs
 * FLOW      stand-in db -> the real router / pure functions -> the answer
 * CARD      country/one-engine-per-country
 */
'use strict';
const path = require('path');
const http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const NONE = '11111111-1111-4111-8111-111111111111';
const IN_SHOP = '99999999-9999-4999-8999-999999999999';
const AU_SHOP = '77777777-7777-4777-8777-777777777777';
const FACTS = {
  [NONE]: { country: null, currency_code: null },
  [IN_SHOP]: { country: 'IN', currency_code: 'INR' },
  [AU_SHOP]: { country: 'AU', currency_code: 'AUD' }
};
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
const answer = async (sql, params) => {
  if (/FROM identities WHERE identity_id/.test(sql) && /currency_code/.test(sql)) return { rows: [FACTS[params[0]]], rowCount: 1 };
  return { rows: [], rowCount: 0 };
};
require.cache[dbFile].exports = Object.assign({}, real, {
  query: answer,
  withEntity: async (id, fn) => fn({ query: answer }),
  readBatch: async (a, b, stmts) => Promise.all(stmts.map((s) => answer(s.text, s.params)))
});
const authFile = require.resolve(path.join(HERE, 'middleware', 'auth'));
require(authFile);
const authStub = (req, res, next) => {
  req.identity = { identity_id: req.headers['x-shop'] };
  next();
};
authStub.entityOf = (req) => req.identity.identity_id;
require.cache[authFile].exports = authStub;
const express = require('express');
const TG = require(path.join(HERE, 'lib', 'tax-governance'));
const CS = require(path.join(HERE, 'lib', 'country-setup'));
let pass = 0;
let fail = 0;
const ok = (name, cond, why) => {
  if (cond) {
    pass++;
    console.log('   ok   ' + name);
  } else {
    fail++;
    console.log('   FAIL ' + name + (why ? '\n          ' + why : ''));
  }
};
const get = (port, p, shop) =>
  new Promise((resolve, reject) => {
    http
      .get({ port, path: p, headers: { 'x-shop': shop } }, (r) => {
        let b = '';
        r.on('data', (c) => (b += c));
        r.on('end', () => resolve({ status: r.statusCode, body: b ? JSON.parse(b) : null }));
      })
      .on('error', reject);
  });

(async () => {
  console.log('\n== CTRY-72 - the api doors with no country ==\n');
  /* 1 - tax-governance: the slabs of a shop's own country, never India's by default */
  const slab = (id, rate) => ({ id, name: 'GST ' + rate + '%', rate, cess: 0, effective_from: '2000-07-01' });
  const inLayer = { region_code: 'IN', currency: 'INR', jurisdiction: { tax: { scheme: 'GST', slabs: [slab('IN-GST-18', 18)] } } };
  const auLayer = { region_code: 'AU', currency: 'AUD', jurisdiction: { tax: { scheme: 'GST', slabs: [slab('AU-GST-10', 10)] } } };
  ok('no country: jurisdictionOf says null', TG.jurisdictionOf({ country: null, currency_code: 'INR' }) === null);
  ok('no country: no slabs, even with the IN layer in hand and a rupee currency', TG.governedFromRows(null, null, inLayer).length === 0);
  ok('no country: the one sentence names Country setup', /Country setup/.test(TG.NO_COUNTRY_SLABS_SAY));
  const inRows = TG.governedFromRows('IN', inLayer, inLayer);
  ok('IN shop: India GST slab, unchanged', inRows.length === 1 && inRows[0].rules.rate === 18);
  const auRows = TG.governedFromRows('AU', auLayer, inLayer);
  ok('AU shop: its own slab, never India', auRows.length === 1 && auRows[0].rules.rate === 10);
  ok(
    'AU shop with no tax block: nothing (the IN layer is borrowed only by a rupee sub-region)',
    TG.governedFromRows('AU', { region_code: 'AU', currency: 'AUD', jurisdiction: {} }, inLayer).length === 0
  );

  /* 2 - GET /api/products/lists over the real router */
  const app = express();
  app.use(express.json());
  app.use('/api/products', require(path.join(HERE, 'routes', 'products.js')));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const none = await get(port, '/api/products/lists', NONE);
  ok('lists, no country: 200 and currency null', none.status === 200 && none.body && none.body.currency === null, JSON.stringify(none).slice(0, 300));
  ok(
    'lists, no country: money_why is NO_MONEY in the ONE sentence',
    !!(none.body && none.body.money_why) && none.body.money_why.code === 'NO_MONEY' && none.body.money_why.why === CS.MONEY_UNSTATED
  );
  const inn = await get(port, '/api/products/lists', IN_SHOP);
  ok('lists, IN shop: currency INR, money_why null (unchanged)', !!inn.body && inn.body.currency === 'INR' && inn.body.money_why === null);
  const aus = await get(port, '/api/products/lists', AU_SHOP);
  ok('lists, AU shop: currency AUD, money_why null (unchanged)', !!aus.body && aus.body.currency === 'AUD' && aus.body.money_why === null);
  server.close();

  /* 3 - the legacy catalogue service: no money, no write */
  const svcFile = require.resolve(path.join(HERE, 'src', 'services', 'catalogue.js'));
  const srcDb = require.resolve(path.join(HERE, 'src', 'db.js'));
  const wrote = [];
  require.cache[srcDb] = {
    id: srcDb,
    filename: srcDb,
    loaded: true,
    exports: {
      pool: {
        query: async (sql, p) => {
          wrote.push(p);
          return { rows: [{ ok: 1 }] };
        }
      }
    }
  };
  delete require.cache[svcFile];
  const svc = require(svcFile);
  const refused = await svc.createItem({ entityId: NONE, name: 'Tea' }).then(
    () => null,
    (e) => e
  );
  ok(
    'createItem with no currency: 422 NO_MONEY in the one sentence, nothing written',
    !!refused && refused.status === 422 && refused.code === 'NO_MONEY' && refused.message === CS.MONEY_UNSTATED && wrote.length === 0
  );
  const refusedCat = await svc.createCategory({ entityId: NONE, name: 'Tea' }).then(
    () => null,
    (e) => e
  );
  ok('createCategory with no currency: 422 NO_MONEY, nothing written', !!refusedCat && refusedCat.code === 'NO_MONEY' && wrote.length === 0);
  await svc.createItem({ entityId: IN_SHOP, name: 'Tea', currencyCode: 'INR' });
  await svc.createItem({ entityId: AU_SHOP, name: 'Tea', currencyCode: 'AUD' });
  ok('createItem with the shop money (IN, AU): written with that money, unchanged', wrote.length === 2 && wrote[0][3] === 'INR' && wrote[1][3] === 'AUD');

  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('   FAIL threw: ' + ((e && e.stack) || e));
  process.exit(1);
});

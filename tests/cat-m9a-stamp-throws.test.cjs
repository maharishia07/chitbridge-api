/**
 * tests/cat-m9a-stamp-throws.test.cjs — M9a follow-up (critic, 12 Nov): a price finer than the currency that is found while STAMPING is a 400, and an adopt writes nothing half.
 *
 * (a) POST /api/adopt/:chit_id with two accepted lines, the second priced 10.999 on an AUD shop → 400 PRICE_DECIMALS and NO product is written (the first line, priced 80, is not left behind)
 * (b) the same two lines priced 80 and 10.99 → 200, both written (control)
 * (c) lib/problem.internalSpec turns the error money.stampCommercials / stampItem throws into that 400 (PRICE_DECIMALS), so every door that stamps (catalogue-adopt, mint-product) answers it, never a 500; any other error stays a 500
 * (d) the sentence with no currency named never says UNDEFINED or NULL
 * Run: node tests/cat-m9a-stamp-throws.test.cjs   (no live database: stubbed auth and db)
 */
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');
const API = path.join(__dirname, '..');
let pass = 0,
  fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(84) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const OWNER = { identity_id: 'e1', identity_type: 'entity', display_name: 'Owner' };
const CHIT = '11111111-1111-4111-8111-111111111111';
const call = (port, method, p, body) =>
  new Promise((done) => {
    const b = JSON.stringify(body || {});
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let j = {};
        try {
          j = JSON.parse(raw || '{}');
        } catch (_) {
          j = { raw };
        }
        done({ status: res.statusCode, body: j });
      });
    });
    r.end(b);
  });

(async () => {
  console.log('\n-- M9a · a price finer than the currency, found at the stamp --\n');
  let inserts = [];
  const LINES = [
    { particulars: 'Basmati rice 1kg', quantity: 10, unit: 'kg', price: 80 },
    { particulars: 'Toor dal 1kg', quantity: 5, unit: 'kg', price: 120 }
  ];
  const handle = (sql, params) => {
    if (/^\s*INSERT INTO catalogue_items/i.test(sql)) {
      inserts.push(params);
      return { rows: [{ item_id: 'i' + inserts.length, item_data: {} }] };
    }
    if (/FROM identities WHERE identity_id/.test(sql)) return { rows: [{ currency_code: 'AUD', country: 'AU' }] };
    if (/can_see_costs FROM identities/.test(sql)) return { rows: [{ can_see_costs: true }] };
    if (/FROM chit_header h/.test(sql)) return { rows: [{ chit_id: CHIT, business_json: { source: { name: 'ABC', sectors: ['fmcg'] } }, sender_entity_id: 's1', line_items: LINES }] };
    return { rows: [] };
  };
  require.cache[require.resolve(API + '/middleware/auth')] = {
    exports: Object.assign((req, res, next) => { req.identity = OWNER; next(); }, { entityOf: (req) => req.identity.identity_id })
  };
  require.cache[require.resolve(API + '/db')] = {
    exports: { query: async (sql, params) => handle(sql, params), withEntity: async (_id, fn) => fn({ query: async (sql, params) => handle(sql, params) }), readBatch: async () => [] }
  };
  const app = express();
  app.use(express.json());
  app.use('/api/adopt', require(API + '/routes/adopt'));
  const server = app.listen(0);
  const port = server.address().port;
  const accept = (secondPrice) => ({ accept: [{ line: 0, name: 'Rice', sku: 'R1', price: 80 }, { line: 1, name: 'Dal', sku: 'D1', price: secondPrice }] });

  let r = await call(port, 'POST', '/api/adopt/' + CHIT, accept(10.999));
  t('(a) second line 10.999 AUD → 400 PRICE_DECIMALS, nothing written (the 80 line is not left behind)', [r.status, r.body.code, inserts.length], [400, 'PRICE_DECIMALS', 0]);
  inserts = [];
  r = await call(port, 'POST', '/api/adopt/' + CHIT, accept(10.99));
  t('(b) 80 and 10.99 → 200, both written', [r.status, r.body.added && r.body.added.length, inserts.length], [200, 2, 2]);
  server.close();

  const money = require(API + '/lib/money');
  const { internalSpec } = require(API + '/lib/problem');
  let thrown = null;
  try {
    money.stampCommercials({ Tussar: { price: 10.999 } }, 'AUD');
  } catch (e) {
    thrown = e;
  }
  const spec = internalSpec({ id: 'x', path: '/' }, thrown, { error: 'Failed' });
  t('(c) stampCommercials 10.999 AUD throws, and internalSpec answers it 400 PRICE_DECIMALS with the sentence', [spec.status, spec.code, /at most 2 decimal places in AUD/.test(spec.detail)], [400, 'PRICE_DECIMALS', true]);
  t('(c) any other error is still a 500', internalSpec({ id: 'x', path: '/' }, new Error('boom'), { error: 'Failed' }).status, 500);
  const none = money.priceDecimalsRefusal({ price: 10.999 }, null);
  t('(d) no currency named → "Price can have at most 2 decimal places (not 10.999)…", never UNDEFINED / NULL', [/UNDEFINED|NULL/i.test(none), /^Price can have at most 2 decimal places \(not 10\.999\)/.test(none)], [false, true]);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * tests/walks2-import-good-rows.test.cjs — WALK S2 S2-F-02 / S2-F-04: an import with one bad row takes the good rows when asked (skip_bad_rows), lists the bad row with its field and reason and a CSV to fix, and
 * every imported item meets the item form's tax path (registered shop: the country's rate when none is given; 0% with no reason is flagged).
 * Hand case (cents per test: the file prices below are in whole units, tax at the pack's 10%): Cola 3.30 rate 10 -> created; 'Bad' price abc -> rejected line 3 field price; Apples rate 0 -> created, flagged (0% no reason); Bread no rate -> created at the shop's standard 10.
 * Run: node tests/walks2-import-good-rows.test.cjs   (no live database: stubbed auth and db)
 * (shape copied from tests/cat210-rate-owner-only.test.cjs)
 *
 */
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(78) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const OWNER = { identity_id: 'e1', identity_type: 'entity', display_name: 'Owner' };
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
const { boundDb, schemaRows, refuseUnbound } = require('./support/bound-db.cjs');
const FIELDS = [{ field_key: 'name', field_name: 'Name', field_type: 'text' }, { field_key: 'gst_rate', field_name: 'GST rate', field_type: 'number' }, { field_key: 'price', field_name: 'Price', field_type: 'number' }];

(async () => {
  console.log('\n-- WALK S2 · import takes the good rows, lists the bad, one tax path --\n');
  const inserted = [];
  require.cache[require.resolve(API + '/middleware/auth')] = {
    exports: Object.assign((req, res, next) => { req.identity = OWNER; next(); }, { entityOf: (req) => req.identity.identity_id })
  };
  require.cache[require.resolve(API + '/lib/schedule')] = { exports: { enabled: async () => false, TABLE: 'x', pending: async () => [], applyDue: async () => {}, diff: () => ({}) } };
  const regional = require(API + '/lib/regional'); regional.currencyFor = async () => 'AUD';
  const defaultTax = require(API + '/lib/default-tax-rate'); defaultTax.standardRateOf = async () => 10; /* a registered AU shop: the pack's standard rate */
  const bound = boundDb(schemaRows({ e1: { schema_id: 's1', fields: FIELDS } }));
  require.cache[require.resolve(API + '/db')] = {
    exports: {
      query: async (sql) => { refuseUnbound(sql); return { rows: [] }; },
      queryAs: bound.queryAs, queryFor: bound.queryFor,
      withEntity: async (_id, fn) => fn({
        query: async (sql, params) => {
          if (/FROM schema_fields WHERE schema_id/.test(sql)) return { rows: FIELDS };
          if (/can_see_costs FROM identities/.test(sql)) return { rows: [{ can_see_costs: true }] };
          if (/INSERT INTO catalogue_items/.test(sql)) { (params[2] || []).forEach((x) => inserted.push(typeof x === 'string' ? JSON.parse(x) : x)); return { rows: [] }; }
          return { rows: [] };
        }
      }),
      readBatch: async () => [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [{ n: 0 }] }]
    }
  };
  delete require.cache[require.resolve(API + '/routes/products')];
  const app = express(); app.use(express.json());
  app.use('/api/products', require(API + '/routes/products'));
  const server = app.listen(0); const port = server.address().port;

  const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10);
  const csv = 'name,price,gst_rate' + NL + 'Cola,3.30,10' + NL + 'Bad,abc,10' + NL + 'Apples,3,0' + NL + 'Bread,4,' + NL;
  const decisions = [{ incoming: 'name', action: 'map', field: 'name' }, { incoming: 'price', action: 'map', field: 'price' }, { incoming: 'gst_rate', action: 'map', field: 'gst_rate' }];

  const whole = await call(port, 'POST', '/api/products/import', { confirm: true, csv, decisions });
  t('without skip_bad_rows the whole file is refused 409 and nothing is written', [whole.status, inserted.length], [409, 0]);

  const got = await call(port, 'POST', '/api/products/import', { confirm: true, csv, decisions, skip_bad_rows: true });
  t('with skip_bad_rows the good rows go in: 3 created, 1 rejected', [got.status, got.body.summary], [200, { created: 3, updated: 0, failed: 0, rejected: 1 }]);
  t('the bad row is listed with its line, field and reason', got.body.rejects, [{ line: 3, field: 'price', message: '"abc" is not a number' }]);
  t('the rejects come back as a file to fix: headings, the row as sent, a problem column', got.body.rejects_csv, 'name,price,gst_rate,problem' + CRLF + 'Bad,abc,10,"price: ""abc"" is not a number"' + CRLF);
  const by = (n) => inserted.find((x) => x.name === n) || {};
  t('Cola keeps its stated rate 10', by('Cola').gst_rate, 10);
  t('Bread, with no rate in the file, gets the shop standard 10 (the item form path)', by('Bread').gst_rate, 10);
  t('Apples at 0 keeps its stated 0 (never replaced) ...', by('Apples').gst_rate, 0);
  const flagged = (got.body.outcome || []).filter((o) => /no reason/.test(o.warning || '')).map((o) => o.name);
  t('... and is the only line flagged "0% with no reason"', flagged, ['Apples']);
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

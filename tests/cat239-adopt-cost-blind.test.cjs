/**
 * tests/cat239-adopt-cost-blind.test.cjs — CAT-239: the supplier's cost never reaches a cost-blind co-assist.
 *
 * (a) GET /api/adopt/:chit_id offers each delivery line with a seed whose `cost` is the supplier's price to this shop; an actor without
 *     can_see_costs reads the offer WITHOUT it (cost and cost_* at any depth); the owner and a cost-allowed actor read it unchanged.
 * (c) POST /api/combo-templates/:id/push by a cost-blind co-assist is refused 403 COST_BLIND and nothing is written (lock-in: the route's
 *     own cost.writeRefusal already covers the two product writers beneath it).
 * Run: node tests/cat239-adopt-cost-blind.test.cjs   (no live database: stubbed auth and db)
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
const BLIND = { identity_id: 'a1', identity_type: 'actor', access_level: 'editor', parent_entity_id: 'e1', hat: 'manager', display_name: 'Blind' };
const GRANTED = { identity_id: 'a2', identity_type: 'actor', access_level: 'editor', parent_entity_id: 'e1', hat: 'manager', display_name: 'Granted' };
const GRANTS = { a2: true };
const CHIT = '11111111-1111-4111-8111-111111111111';

const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j, raw }); }); });
  r.end(b);
});
/** every key named cost / cost_* anywhere in a value */
const costKeys = (value) => (value && typeof value === 'object' ? Object.keys(value).flatMap((k) => (/^cost(_|$)/.test(k) ? [k] : costKeys(value[k]))) : []);

(async () => {
  console.log('\n-- CAT-239 · the supplier cost stays off a cost-blind reader --\n');
  let WHO = OWNER, writes = [];
  require.cache[require.resolve(API + '/middleware/auth')] = {
    exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => (req.identity.parent_entity_id || req.identity.identity_id) })
  };
  const LINES = [
    { particulars: 'Basmati rice 1kg', quantity: 10, unit: 'kg', price: 80, item_data: { unit_cost: 62, cost_price: 61 } },
    { particulars: 'Toor dal 1kg', quantity: 5, unit: 'kg', price: 120 }
  ];
  const record = (sql, params) => { if (/^\s*(INSERT|UPDATE)/i.test(sql)) writes.push(params); };
  const handle = (sql, params) => {
    record(sql, params);
    if (/can_see_costs FROM identities/.test(sql)) return { rows: [{ can_see_costs: !!GRANTS[params[0]] }] };
    if (/FROM chit_header h/.test(sql)) return { rows: [{ chit_id: CHIT, business_json: { source: { name: 'ABC', sectors: ['fmcg'] } }, sender_entity_id: 's1', line_items: LINES }] };
    if (/FROM combo_templates/.test(sql)) return { rows: [{ name: 'Combo', definition: { groups: [] }, price: 99, product_item_id: null }] };
    return { rows: [] };
  };
  require.cache[require.resolve(API + '/db')] = {
    exports: { query: async (sql, params) => handle(sql, params), withEntity: async (_id, fn) => fn({ query: async (sql, params) => handle(sql, params) }), readBatch: async () => [] }
  };
  delete require.cache[require.resolve(API + '/routes/adopt')];
  delete require.cache[require.resolve(API + '/routes/combo-templates')];
  const app = express(); app.use(express.json());
  app.use('/api/adopt', require(API + '/routes/adopt'));
  app.use('/api/combo-templates', require(API + '/routes/combo-templates'));
  const server = app.listen(0); const port = server.address().port;
  const offer = () => call(port, 'GET', '/api/adopt/' + CHIT);

  WHO = OWNER;
  const owner = await offer();
  t('owner: the offer carries the supplier cost in each seed', [owner.status, owner.body.rows.map((r) => r.seed && r.seed.cost)], [200, [62, 120]]);
  WHO = GRANTED;
  const granted = await offer();
  t('cost-allowed co-assist: the same answer, byte for byte', granted.raw === owner.raw, true);
  WHO = BLIND;
  const blind = await offer();
  t('cost-blind co-assist: 200, the offer is still there (names, units, may)', [blind.status, blind.body.rows.map((r) => [r.may, r.seed && r.seed.name, r.seed && r.seed.unit])], [200, [['offer', 'Basmati rice 1kg', 'kg'], ['offer', 'Toor dal 1kg', 'kg']]]);
  t('  ...and no cost / cost_* key anywhere in the answer, at any depth', costKeys(blind.body), []);
  t('  ...nor the supplier price as a value (62, 61)', /\b(62|61)\b/.test(blind.raw) || /"cost"/.test(blind.raw), false);
  t('  ...the rest of the answer is the owner’s: says, counts, from', [blind.body.says, blind.body.counts, blind.body.from], [owner.body.says, owner.body.counts, owner.body.from]);
  const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (/^cost(_|$)/.test(k) ? undefined : x)));
  t('  ...exactly the owner’s answer minus the cost keys', blind.body, strip(owner.body));

  console.log('   POST /api/combo-templates/:id/push');
  writes = [];
  const push = await call(port, 'POST', '/api/combo-templates/' + CHIT + '/push', {});
  t('cost-blind push: 403 COST_BLIND, nothing written', [push.status, push.body.code, writes.length], [403, 'COST_BLIND', 0]);

  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

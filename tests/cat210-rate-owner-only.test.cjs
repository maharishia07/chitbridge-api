/**
 * tests/cat210-rate-owner-only.test.cjs — CAT-210: setting a tax rate is owner or manager only, on EVERY door.
 *
 * Ruling 24 Oct 2026: a rate is a money promise. POST /api/till/rate already refused an editor; PATCH /products/:id let any editor
 * hat set a slab. One predicate (lib/rate-door setsRate), one sentence, one code (TILL_RATE_OWNER_ONLY). The WHOLE request is refused
 * when it carries a rate change (merge-patch rule: no silent partial write); an unchanged slab echoed back is not a change.
 * Run: node tests/cat210-rate-owner-only.test.cjs   (no live database: stubbed auth and db)
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
const SENTENCE = 'Ask the owner or a manager to set the tax rate.';
const OWNER = { identity_id: 'e1', identity_type: 'entity', display_name: 'Owner' };
const actor = (hat) => ({ identity_id: 'a-' + hat, identity_type: 'actor', access_level: 'editor', parent_entity_id: 'e1', hat, display_name: hat });
const ITEM = '11111111-1111-4111-8111-111111111111';
const STORED = { name: 'Veg Meals', price: 70, tax_slab: 'gst-5', tax_slab_name: 'GST 5%', gst_rate: 5, status: 'available' };

const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  console.log('\n-- CAT-210 · a tax rate is owner or manager only on every door --\n');
  let WHO = OWNER, writes = 0;
  require.cache[require.resolve(API + '/middleware/auth')] = {
    exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => (req.identity.parent_entity_id || req.identity.identity_id) })
  };
  require.cache[require.resolve(API + '/lib/schedule')] = { exports: { enabled: async () => false, TABLE: 'x', pending: async () => [], applyDue: async () => {}, diff: () => ({}) } };
  const regional = require(API + '/lib/regional'); regional.currencyFor = async () => 'INR'; /* the shop's currency is not what this test is about */
  const FAKE = { item_id: ITEM, item_data: STORED };
  require.cache[require.resolve(API + '/db')] = {
    exports: {
      query: async () => ({ rows: [] }),
      withEntity: async (_id, fn) => fn({
        query: async (sql) => {
          if (/can_see_costs FROM identities/.test(sql)) return { rows: [{ can_see_costs: true }] };
          if (/SELECT item_id, item_data FROM catalogue_items/.test(sql)) return { rows: [{ item_id: ITEM, item_data: Object.assign({}, STORED) }] };
          if (/SELECT item_data FROM catalogue_items/.test(sql)) return { rows: [{ item_data: Object.assign({}, STORED) }] };
          if (/UPDATE catalogue_items/.test(sql)) { writes++; return { rows: [FAKE] }; }
          return { rows: [] };
        }
      }),
      readBatch: async () => [{ rows: [FAKE] }, { rows: [] }, { rows: [] }, { rows: [{ n: 0 }] }]
    }
  };
  delete require.cache[require.resolve(API + '/routes/products')];
  delete require.cache[require.resolve(API + '/routes/entities')];
  const app = express(); app.use(express.json());
  app.use('/api/products', require(API + '/routes/products'));
  app.use('/api/entities', require(API + '/routes/entities'));
  const server = app.listen(0); const port = server.address().port;
  const patch = (item_data, merge) => call(port, 'PATCH', '/api/products/' + ITEM, merge ? { item_data, merge: true } : { item_data });

  const door = require(API + '/lib/rate-door');
  t('the rule is one function: owner and manager may, editor, cashier and a key may not',
    [door.setsRate({ identity: OWNER }), door.setsRate({ identity: actor('manager') }), door.setsRate({ identity: actor('editor') }), door.setsRate({ identity: actor('cashier') }), door.setsRate({ identity: OWNER, api_key: 'k' })],
    [true, true, false, false, false]);

  WHO = actor('editor'); writes = 0;
  const e1 = await patch({ tax_slab: 'gst-18', tax_slab_name: 'GST 18%', gst_rate: 18 }, true);
  t('editor merge-PATCH that changes the slab: 403', e1.status, 403);
  t('  ...with the till door code and sentence, may:false, in words', [e1.body.code, e1.body.message, e1.body.may], ['TILL_RATE_OWNER_ONLY', SENTENCE, false]);
  t('  ...and nothing written', writes, 0);
  t('  ...the sentence never echoes the caller value (Q19)', /gst-18|18/.test(JSON.stringify(e1.body)), false);
  const e2 = await patch({ name: 'Veg Thali', gst_rate: 12 }, true);
  t('editor PATCH carrying a name edit AND a rate change: the WHOLE request refused', [e2.status, writes], [403, 0]);
  const e3 = await patch({ name: 'Veg Thali', price: 80, status: 'available' });
  t('editor whole-record PATCH that DROPS the rate keys (would wipe it): 403', [e3.status, writes], [403, 0]);
  const e4 = await patch({ gst_rate: null }, true);
  t('editor merge-PATCH that clears the rate with null: 403', [e4.status, writes], [403, 0]);
  const ok1 = await patch({ name: 'Veg Thali' }, true);
  t('editor merge-PATCH without a slab change still saves', [ok1.status, writes], [200, 1]);
  writes = 0;
  const ok2 = await patch(Object.assign({}, STORED, { price: 90 }));
  t('editor whole-record PATCH echoing the same slab unchanged still saves', [ok2.status, writes], [200, 1]);
  writes = 0;
  WHO = actor('cashier');
  const cashier = await patch({ gst_rate: 18 }, true);
  t('cashier hat: 403 too', [cashier.status, cashier.body.code, writes], [403, 'TILL_RATE_OWNER_ONLY', 0]);

  WHO = actor('manager'); writes = 0;
  t('manager sets a slab: 200 and written', [(await patch({ tax_slab: 'gst-18', tax_slab_name: 'GST 18%', gst_rate: 18 }, true)).status, writes], [200, 1]);
  WHO = OWNER; writes = 0;
  t('owner sets a slab: 200 and written', [(await patch({ tax_slab: 'gst-18', tax_slab_name: 'GST 18%', gst_rate: 18 }, true)).status, writes], [200, 1]);

  console.log('\n   the other doors');
  WHO = actor('editor'); writes = 0;
  const bu = await call(port, 'POST', '/api/products/bulk-update', { items: [{ id: ITEM, item_data: Object.assign({}, STORED, { gst_rate: 18 }) }] });
  t('POST /bulk-update that changes a rate: 403, nothing written', [bu.status, bu.body.code, writes], [403, 'TILL_RATE_OWNER_ONLY', 0]);
  const bu2 = await call(port, 'POST', '/api/products/bulk-update', { items: [{ id: ITEM, item_data: Object.assign({}, STORED, { price: 99 }) }] });
  t('POST /bulk-update with the slab unchanged still saves', [bu2.status, writes], [200, 1]);
  const mk = await call(port, 'POST', '/api/products', { item_data: { name: 'New', price: 5, gst_rate: 18 } });
  t('POST / (a new product) naming a rate: 403', [mk.status, mk.body.code], [403, 'TILL_RATE_OWNER_ONLY']);
  const mkb = await call(port, 'POST', '/api/products/bulk', { items: [{ name: 'New', price: 5, tax_slab: 'gst-18' }] });
  t('POST /bulk naming a slab: 403', [mkb.status, mkb.body.code], [403, 'TILL_RATE_OWNER_ONLY']);
  const sc = await call(port, 'POST', '/api/products/' + ITEM + '/schedule', { effective_at: '2030-01-01T00:00:00Z', item_data: { gst_rate: 18 } });
  t('POST /:id/schedule parking a rate: 403', [sc.status, sc.body.code], [403, 'TILL_RATE_OWNER_ONLY']);

  console.log('\n   the payload the catalogue page reads');
  const may = async (who) => { WHO = who; return (await call(port, 'GET', '/api/entities/me/can-see-costs')).body.may_set_rate; };
  t('GET /entities/me/can-see-costs carries may_set_rate: owner and manager true, editor false', [await may(OWNER), await may(actor('manager')), await may(actor('editor'))], [true, true, false]);

  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

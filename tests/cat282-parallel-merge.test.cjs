/**
 * tests/cat282-parallel-merge.test.cjs — CAT-282: parallel merge PATCHes of ONE product keep every edit.
 *
 * Before: PATCH /api/products/:id {merge:true} read item_data in one transaction, merged in JS and wrote the whole record in another, so three
 * edits fired together (name, unit, price) left 0 of 10 trials with all three (SIT hunt lane A, 8 Nov). Now the stored row is read FOR UPDATE on the
 * SAME transaction as the write (the row lock the sibling doors take): the second edit waits and merges onto what the first one wrote.
 * The stand-in db below is a row mutex (held from the FOR UPDATE read to the end of that withEntity, as the database does), a yield between the read
 * and the write (where the lost update lives), and a version counter that moves only when item_data really changes (the b146 trigger's brake).
 * Run: node tests/cat282-parallel-merge.test.cjs   (no live database)
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
const ITEM = '11111111-1111-4111-8111-111111111111';
const START = { name: 'Veg Meals', unit: 'plate', price: { amount: 70, currency: 'INR' }, status: 'available' };
const TRIALS = 10;
const yieldTurn = () => new Promise((done) => setTimeout(done, 3));

const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

/** the one stored row, its row lock and its version history */
function makeRow() {
  const row = { data: Object.assign({}, START), versions: 1, owner: null, waiters: [] };
  row.lock = async (handle) => {
    while (row.owner && row.owner !== handle) await new Promise((go) => row.waiters.push(go));
    row.owner = handle;
  };
  row.release = (handle) => {
    if (row.owner !== handle) return;
    row.owner = null;
    row.waiters.splice(0).forEach((go) => go());
  };
  /** UPDATE catalogue_items (patchItems' shape: ids, datas, modes, actives): replace or top-level merge, one version per real change */
  row.write = (params) => {
    const next = params[2][0] === 'merge' ? Object.assign({}, row.data, JSON.parse(params[1][0])) : JSON.parse(params[1][0]);
    if (JSON.stringify(next) !== JSON.stringify(row.data)) row.versions++;
    row.data = next;
    return { rows: [{ item_id: ITEM, item_data: row.data }], rowCount: 1 };
  };
  return row;
}

const { boundDb, schemaRows, refuseUnbound } = require('./support/bound-db.cjs');

(async () => {
  console.log('\n-- CAT-282 · three merge PATCHes of one product, fired together, x' + TRIALS + ' --\n');
  let ROW = makeRow();
  require.cache[require.resolve(API + '/middleware/auth')] = {
    exports: Object.assign((req, res, next) => { req.identity = OWNER; next(); }, { entityOf: (req) => req.identity.identity_id })
  };
  require.cache[require.resolve(API + '/lib/schedule')] = { exports: { enabled: async () => false, TABLE: 'x', pending: async () => [], applyDue: async () => {}, diff: () => ({}) } };
  require(API + '/lib/regional').currencyFor = async () => 'INR';
  const FIELDS = ['name', 'unit', 'price', 'status'].map((k) => ({ field_key: k, field_name: k, field_type: k === 'price' ? 'number' : 'text' }));
  const bound = boundDb(schemaRows({ e1: { schema_id: ITEM, fields: FIELDS } })); /* SEC-75: only e1 has a schema; another id reads nothing */
  require.cache[require.resolve(API + '/db')] = {
    exports: {
      query: async (sql) => {
        refuseUnbound(sql); /* SEC-75: the schema tables are read bound to the shop, never plain */
        return { rows: [] };
      },
      queryAs: bound.queryAs, queryFor: bound.queryFor,
      withEntity: async (_id, fn) => {
        const handle = {};
        handle.query = async (sql, params) => {
          if (/FROM schema_fields WHERE schema_id/.test(sql)) return { rows: FIELDS };
          if (/can_see_costs FROM identities/.test(sql)) return { rows: [{ can_see_costs: true }] };
          if (/SELECT item_data FROM catalogue_items/.test(sql)) {
            if (/FOR UPDATE/.test(sql)) await ROW.lock(handle);
            const seen = Object.assign({}, ROW.data);
            await yieldTurn(); /* the window between the read and the write, where an unlocked read loses */
            return { rows: [{ item_data: seen }] };
          }
          if (/UPDATE catalogue_items/.test(sql)) { await yieldTurn(); return ROW.write(params); }
          return { rows: [] };
        };
        try { return await fn(handle); } finally { ROW.release(handle); }
      },
      readBatch: async () => [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [{ n: 0 }] }]
    }
  };
  delete require.cache[require.resolve(API + '/routes/products')];
  const app = express(); app.use(express.json());
  app.use('/api/products', require(API + '/routes/products'));
  const server = app.listen(0); const port = server.address().port;
  const patch = (item_data) => call(port, 'PATCH', '/api/products/' + ITEM, { item_data, merge: true });
  const amountOf = (v) => (v && typeof v === 'object' ? v.amount : v);

  let intact = 0, answered200 = 0, lastVersions = 0;
  for (let i = 0; i < TRIALS; i++) {
    ROW = makeRow();
    const answers = await Promise.all([patch({ name: 'Thali ' + i }), patch({ unit: 'tray' }), patch({ price: 80 + i })]);
    answered200 += answers.filter((a) => a.status === 200).length;
    const d = ROW.data;
    if (d.name === 'Thali ' + i && d.unit === 'tray' && Number(amountOf(d.price)) === 80 + i && d.status === 'available') intact++;
    lastVersions = ROW.versions;
  }
  t('all three answered 200 in every trial', answered200, TRIALS * 3);
  t('every trial ends with name, unit AND price applied (and the untouched status kept)', intact, TRIALS);
  t('one version per real change: the start + three edits = 4', lastVersions, 4);

  const stale = makeRow(); ROW = stale;
  const same = await patch({ name: START.name });
  t('an edit that changes nothing writes no new version', [same.status, stale.versions], [200, 1]);
  const gone = await call(port, 'PATCH', '/api/products/' + ITEM, { item_data: { name: 'x' }, merge: true }); /* still 200: row exists */
  t('a plain merge still answers the stored row', [gone.status, typeof gone.body.item], [200, 'object']);
  /* CAT-238: the media doors read the row FOR UPDATE on their own transaction too: parallel video links and parallel removals each keep every other's work */
  const link = (n) => call(port, 'POST', '/api/products/' + ITEM + '/media', { url: 'https://www.youtube.com/watch?v=abcdefghij' + n, name: 'clip ' + n });
  let linked = 0, linkedOk = 0;
  for (let i = 0; i < TRIALS; i++) {
    ROW = makeRow();
    const answers = await Promise.all([link(1), link(2), link(3)]);
    linkedOk += answers.filter((a) => a.status === 200).length;
    if (Array.isArray(ROW.data.media) && ROW.data.media.length === 3) linked++;
  }
  t('CAT-238: three video links posted together all answer 200', linkedOk, TRIALS * 3);
  t('CAT-238: and every trial keeps all three (none lost to a parallel replace)', linked, TRIALS);
  let kept = 0;
  for (let i = 0; i < TRIALS; i++) {
    ROW = makeRow();
    ROW.data.media = [{ id: 'm1', kind: 'video' }, { id: 'm2', kind: 'video' }, { id: 'm3', kind: 'video' }];
    await Promise.all([call(port, 'DELETE', '/api/products/' + ITEM + '/media/m1'), call(port, 'DELETE', '/api/products/' + ITEM + '/media/m2')]);
    if (ROW.data.media.length === 1 && ROW.data.media[0].id === 'm3') kept++;
  }
  t('CAT-238: two removals together leave only the third entry, every trial', kept, TRIALS);
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

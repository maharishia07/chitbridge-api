'use strict';
/**
 * tests/move-in-meter.test.cjs — MOVE-IN W1.6 (2026-10-18): items written INSIDE the move-in's transaction are metered only after it COMMITS.
 *   1 catalogue-write writeItems with opts.db (the caller's connection) inserts on it and meters NOTHING; without opts.db it meters one per row, as before
 *   2 move-in apply (items) writes through writeItems { db } and meters nothing; afterCommit then meters each item once
 *   3 a refused move-in (the catalogue refuses the file) throws before afterCommit — nothing is metered
 *   4 the import door calls afterCommit AFTER withEntity resolves (the commit), never inside it
 * No database, no network: db, regional, catalogue-columns and meter are stubbed in the require cache. Run: node tests/move-in-meter.test.cjs
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const LIB = path.join(__dirname, '..', 'lib');
const metered = [];
const inserts = { own: 0, caller: 0 };
const rowsFor = (params) => JSON.parse('[' + params[2].join(',') + ']').map((item, index) => ({ item_id: 'item-' + index, item_data: item }));
const callerConn = { query: async (sql, params) => { if (/INSERT INTO catalogue_items/.test(sql)) { inserts.caller++; return { rows: rowsFor(params) }; } return { rows: [] }; } };
const ownConn = { query: async (sql, params) => { if (/INSERT INTO catalogue_items/.test(sql)) { inserts.own++; return { rows: rowsFor(params) }; } return { rows: [] }; } };
let refuseDeclare = false;

/* the stubs: the database, the shop's currency, the column declaration, the meter */
const stub = (file, exports) => { const full = require.resolve(file); require.cache[full] = { id: full, filename: full, loaded: true, exports }; };
stub(path.join(__dirname, '..', 'db'), { query: async () => ({ rows: [] }), withEntity: async (entity, fn) => fn(ownConn), trySavepoint: async (conn, fn, fallback) => { try { return await fn(); } catch (e) { return fallback; } } });
stub(path.join(LIB, 'regional.js'), { currencyFor: async () => 'AUD' });
stub(path.join(LIB, 'catalogue-columns.js'), { ensureDeclaredMany: async (opts) => ({ invalid: refuseDeclare ? [{ index: 0, message: 'refused' }] : [], items: opts.items, schema_id: null }) });
stub(path.join(LIB, 'meter.js'), { meter: async (entity, what, extra) => { metered.push({ entity, what, item: extra.detail }); } });

const CW = require('../lib/catalogue-write');
const MI = require('../lib/move-in');

let pass = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); pass++; console.log('  ok    ' + name); } catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + String(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); } };
const reset = () => { metered.length = 0; inserts.own = 0; inserts.caller = 0; refuseDeclare = false; };
const settle = () => new Promise((resolve) => setImmediate(resolve));
const ITEM = (name, code) => ({ line: 2, what: name, action: 'add', why: 'add', data: { rec: { name, code, unit: 'unit', price: 4.5, gst_rate: 10, cost: null, source_system: 'qbo', source_ref: code } } });
const PLAN = (rows) => ({ kind: 'items', source: 'qbo', rows, counts: { add: rows.length }, notes: [], country: { shop: 'AU', source: 'AU', how: 'stated' } });

(async () => {
  console.log('\nmove-in W1.6 · items are metered after the commit, never inside it');
  await check('⭐ writeItems with opts.db: the insert runs on the CALLER\'s connection and nothing is metered', async () => {
    reset();
    const out = await CW.writeItems({ entity_id: 'shop-1', items: [{ name: 'Flat white' }, { name: 'Latte' }], db: callerConn });
    await settle();
    assert.strictEqual(out.ok, true); assert.strictEqual(inserts.caller, 1); assert.strictEqual(inserts.own, 0);
    assert.strictEqual(metered.length, 0, 'metered inside the caller\'s transaction');
  });
  await check('writeItems without opts.db: its own transaction, one catalogue.item meter per row (unchanged)', async () => {
    reset();
    await CW.writeItems({ entity_id: 'shop-1', items: [{ name: 'Flat white' }, { name: 'Latte' }] });
    await settle();
    assert.strictEqual(inserts.own, 1);
    assert.deepStrictEqual(metered.map((x) => x.item), ['item-0', 'item-1']);
    assert.ok(metered.every((x) => x.what === 'catalogue.item' && x.entity === 'shop-1'));
  });
  await check('⭐ move-in apply (items) meters nothing; afterCommit meters each written item once', async () => {
    reset();
    const applied = await MI.apply(callerConn, 'shop-1', PLAN([ITEM('Flat white', 'FW'), ITEM('Latte', 'LT')]), { by: null, world: {} });
    await settle();
    assert.strictEqual(applied.added, 2); assert.strictEqual(inserts.caller, 1);
    assert.strictEqual(metered.length, 0, 'metered before the commit');
    MI.afterCommit('shop-1', applied);
    await settle();
    assert.deepStrictEqual(metered.map((x) => x.item), ['item-0', 'item-1']);
  });
  await check('⭐ a refused move-in throws before afterCommit: nothing written, nothing metered', async () => {
    reset(); refuseDeclare = true;
    await assert.rejects(() => MI.apply(callerConn, 'shop-1', PLAN([ITEM('Flat white', 'FW')]), { by: null, world: {} }), /Nothing was imported/);
    await settle();
    assert.strictEqual(inserts.caller, 0); assert.strictEqual(metered.length, 0);
  });
  await check('afterCommit with no items (a chart, contacts, a held-only file) meters nothing', async () => {
    reset();
    MI.afterCommit('shop-1', { kind: 'accounts', added: 3 }); MI.afterCommit('shop-1', null);
    await settle();
    assert.strictEqual(metered.length, 0);
  });
  await check('the import door calls afterCommit after withEntity resolves (the commit), not inside the transaction', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'books.js'), 'utf8');
    const door = src.slice(src.indexOf("router.post('/move-in/import'"), src.indexOf("router.get('/move-in/imports'"));
    const closes = door.indexOf('    });\n'), after = door.indexOf('MI.afterCommit(e, out)');
    assert.ok(after > 0, 'afterCommit not called by the door'); assert.ok(closes > 0 && after > closes, 'afterCommit runs inside withEntity');
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  console.log('  ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();

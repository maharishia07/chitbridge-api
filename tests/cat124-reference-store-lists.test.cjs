'use strict';
/**
 * cat124-reference-store-lists.test.cjs — CAT-124 C1+C2: the Product Lab's six cards come from the six reference stores.
 * R1 every list's store is named in STORES (six, distinct, 'cbrefhotels' for hotel) and the script uses the same table
 * R2 with six loaded stores, readStoreLists answers six entries and cardOf makes six cards each carrying its store id and name
 * R3 PARITY: a store's rows equal the constant's rows (name, unit, price, category, names) in the constant's order, all six
 * R4 a store that is not registered / not loaded / unreadable falls back to the constant: card store_id null, same rows, no throw
 * R5 the result is kept for a minute (one lookup), invalidate() forces a new read; a failed lookup is not kept
 * Run: node tests/cat124-reference-store-lists.test.cjs · no DB, no network.   CARD 06-catalogue-pim/README
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');
const BP = require(path.join(API, 'lib', 'catalogue-blueprint'));
const R = require(path.join(API, 'lib', 'reference-store-lists'));
let pass = 0, fail = 0;
const okA = async (name, fn) => { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String((e && e.message) || e).slice(0, 400)); } };

/* a fake database holding the stores exactly as `reference-stores.cjs load` writes them (storeRows, stamped price, category by id) */
function fakeDb(loaded) {
  const calls = { lookups: 0, reads: 0 };
  const idOf = (key) => '00000000-0000-4000-8000-0000000000' + String(R.STORES.findIndex((s) => s.key === key) + 10);
  const handle = (id) => ({ query: async (sql) => {
    const key = R.STORES.find((s) => idOf(s.key) === id).key;
    if (/FROM definition/.test(sql)) return { rows: [...new Set(BP.storeRows(key).map((r) => r.categoryName).filter(Boolean))].map((n) => ({ definition_id: 'cat-' + key + '-' + n, name: n })) };
    return { rows: BP.storeRows(key).reverse().map((r) => { const d = Object.assign({}, r); delete d.categoryName; d.price = { amount: r.price, currency: 'INR' }; if (r.categoryName) d.categories = ['cat-' + key + '-' + r.categoryName]; return { item_data: d }; }) };
  } });
  return { calls, io: {
    query: async () => { calls.lookups++; return { rows: R.STORES.filter((s) => loaded.includes(s.key)).map((s) => ({ identity_id: idOf(s.key), user_id: s.user_id })) }; },
    withEntity: async (id, fn) => { calls.reads++; return fn(handle(id)); }
  } };
}
const cards = (stored) => Object.keys(BP.BLUEPRINTS).map((k) => R.cardOf(BP, k, stored.get(k)));
const ALL = Object.keys(BP.BLUEPRINTS);

(async () => {
  await okA('R1 six stores, distinct user ids, hotel is cbrefhotels, the script shares the table', () => {
    assert.strictEqual(R.STORES.length, 6);
    assert.strictEqual(new Set(R.STORES.map((s) => s.user_id)).size, 6);
    assert.strictEqual(R.STORES.find((s) => s.key === 'hotel').user_id, 'cbrefhotels');
    const script = fs.readFileSync(path.join(API, 'scripts', 'reference-stores.cjs'), 'utf8');
    assert.ok(/require\('\.\.\/lib\/reference-store-lists'\)/.test(script) && !/const STORES = Object\.keys/.test(script));
  });
  await okA('R2 six loaded stores give six store-backed cards, each with its store id and name', async () => {
    R.invalidate();
    const cs = cards(await R.readStoreLists(fakeDb(ALL).io));
    assert.strictEqual(cs.length, 6);
    cs.forEach((c) => { assert.ok(c.store_id && /^Reference · /.test(c.store_name), c.key); assert.ok(c.count > 0 && c.count === c.rows.length, c.key); });
    assert.strictEqual(new Set(cs.map((c) => c.store_id)).size, 6);
  });
  await okA('R3 parity: each card holds the constant\'s rows, same order, same fields', async () => {
    R.invalidate();
    const stored = await R.readStoreLists(fakeDb(ALL).io);
    for (const c of cards(stored)) {
      const want = R.cardOf(BP, c.key, undefined);
      assert.deepStrictEqual(c.rows, want.rows, c.key + ' rows differ from the constant');
      assert.strictEqual(c.pin, want.pin);
    }
  });
  await okA('R4 an unloaded or unreadable store falls back to the constant with store_id null', async () => {
    R.invalidate();
    const part = cards(await R.readStoreLists(fakeDb(['veg', 'egg']).io));
    assert.deepStrictEqual(part.filter((c) => c.store_id).map((c) => c.key).sort(), ['egg', 'veg']);
    part.filter((c) => !c.store_id).forEach((c) => { assert.strictEqual(c.store_name, null); assert.strictEqual(c.count, BP.blueprint(c.key).starter.length); });
    R.invalidate();
    const broken = fakeDb(ALL).io; broken.withEntity = async () => { throw new Error('rls'); };
    const cs = cards(await R.readStoreLists(broken));
    assert.ok(cs.length === 6 && cs.every((c) => c.store_id === null && c.count > 0));
    R.invalidate();
    const lookup = { query: async () => { throw new Error('down'); }, withEntity: async () => { throw new Error('x'); } };
    assert.ok(cards(await R.readStoreLists(lookup)).every((c) => c.store_id === null));
  });
  await okA('R5 kept for a minute; invalidate reads again; a failed lookup is not kept', async () => {
    R.invalidate();
    const db = fakeDb(ALL);
    await R.readStoreLists(db.io); await R.readStoreLists(db.io);
    assert.strictEqual(db.calls.lookups, 1);
    R.invalidate(); await R.readStoreLists(db.io);
    assert.strictEqual(db.calls.lookups, 2);
    R.invalidate();
    await R.readStoreLists({ query: async () => { throw new Error('down'); }, withEntity: async () => ({}) });
    const again = fakeDb(ALL); await R.readStoreLists(again.io);
    assert.strictEqual(again.calls.lookups, 1);
  });
  await okA('R7 parity ignores image (server-owned): a store loaded without pictures is identical, all six; load strips image', () => {
    for (const key of ALL) {
      const rows = BP.storeRows(key).map((row) => { const copy = Object.assign({}, row); delete copy.image; copy.category = copy.categoryName; return copy; });
      const result = BP.parity(key, BP.fromStore(key, rows, () => null));
      assert.ok(result.ok, key + ' ' + JSON.stringify(result.changed.slice(0, 2)));
    }
    assert.ok(/delete out.image/.test(fs.readFileSync(path.join(API, 'scripts', 'reference-stores.cjs'), 'utf8')));
  });
  await okA('R6 GET /lists reads the stores through the one reader', () => {
    const route = fs.readFileSync(path.join(API, 'routes', 'products.js'), 'utf8');
    const body = route.slice(route.indexOf("router.get('/lists'"), route.indexOf("router.get('/lists/adopt'") > 0 ? undefined : route.indexOf("router.get('/lists'") + 7000);
    assert.ok(/refLists\.readStoreLists\(\{ query, withEntity \}\)/.test(body) && /refLists\.cardOf\(BP, item, stored\.get\(item\)\)/.test(body));
  });
  console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

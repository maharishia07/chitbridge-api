'use strict';
/**
 * vertical-resolver.test.cjs — VERT-1 · VERT-8: ONE answer to "what trade is this shop" (govresolve.verticalOf).
 *
 * Athi, 18 Oct: "each box should do its functionality without having to worry about the vertical". The five readers that each
 * asked the trade their own way (adopt · readiness · profile · stock-from-chit · entity-header) now ask the resolver; the Price
 * Lab's starter list is picked from the same answer, so a restaurant opens on the hotel list, never the grocer's.
 * Run: node tests/vertical-resolver.test.cjs · no DB (db/index.js is stubbed), no network.
 * CARD 20-settings-governance-and-plan/governance-7-layers-govcontext
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const okA = async (name, fn) => { try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String(e && e.message).slice(0, 300)); } };

/* ── the shop's rows, as the stubbed database answers them ── */
const SHOP = '22222222-2222-4222-8222-222222222222';
let ROWS = { identity: null, sectors: [], constitution: null };
let BATCHES = 0;
function answer(sql) {
  const text = String(sql);
  if (/FROM identities WHERE/.test(text)) return { rows: ROWS.identity ? [{ vertical: ROWS.identity }] : [] };
  if (/FROM entity_profile/.test(text)) return { rows: [{ sectors: ROWS.sectors, trade_mode: 'domestic', markets: [], adopted: [] }] };
  if (/JOIN constitution/.test(text)) return { rows: ROWS.constitution ? [{ vertical: ROWS.constitution }] : [] };
  return { rows: [] };
}
const handle = { query: async (sql) => answer(sql) };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql) => answer(sql), withEntity: async (e, fn) => fn(handle), onEntity: async (e, fn) => fn(handle),
  readBatch: async (e, actor, statements) => { BATCHES++; return statements.map((st) => answer(st.text)); },
} };

const G = require(path.join(API, 'lib', 'govresolve'));
const R = require(path.join(API, 'lib', 'readiness'));
const A = require(path.join(API, 'lib', 'adopt'));
const L = require(path.join(API, 'lib', 'lotfields'));
const H = require(path.join(API, 'lib', 'entity-header'));
const BP = require(path.join(API, 'lib', 'catalogue-blueprint'));
const shop = (rows) => { ROWS = Object.assign({ identity: null, sectors: [], constitution: null }, rows); BATCHES = 0; };

(async () => {
  console.log('\n══ verticalFrom — the order of the answer (pure) ══');
  await okA('the constitution wins, then the shop\'s own word, then the first declared sector; each says its source', () => {
    const a = G.verticalFrom({ constitution: 'pharma', vertical: 'hotel', sectors: ['paint'] });
    const b = G.verticalFrom({ constitution: null, vertical: 'Hotel', sectors: ['paint'] });
    const c = G.verticalFrom({ sectors: [' Paint ', 'food'] });
    assert.deepStrictEqual([a.key, a.source, b.key, b.source, c.key, c.source], ['pharma', 'constitution', 'hotel', 'identity', 'paint', 'sectors']);
  });
  await okA('placeholders state no trade: general · base · universal · empty → key null, source none, pack null', () => {
    const none = G.verticalFrom({ constitution: 'base', vertical: 'general', sectors: ['', 'universal'] });
    assert.deepStrictEqual([none.key, none.source, none.pack], [null, 'none', null]);
  });
  await okA('the pack is lotfields.packFor over key + sectors (paint → chemical; kirana → food)', () => {
    assert.strictEqual(G.verticalFrom({ sectors: ['paint'] }).pack.key, 'chemical');
    assert.strictEqual(G.verticalFrom({ vertical: 'general', sectors: ['Kirana'] }).pack.key, 'food');
  });

  console.log('\n══ verticalOf — one trip, the shop\'s rows ══');
  await okA('reads identities · entity_profile · the stamp\'s constitution in ONE readBatch', async () => {
    shop({ constitution: 'pharma', sectors: ['grocery'] });
    const answerOf = await G.verticalOf(SHOP);
    assert.deepStrictEqual([answerOf.key, answerOf.source, answerOf.pack && answerOf.pack.key, BATCHES], ['pharma', 'constitution', 'pharma', 1]);
  });

  console.log('\n══ the readers ask the resolver ══');
  await okA('BREAK-TEST · readiness.laneOf takes the CONSTITUTION\'s trade when the profile declares none (was sectors[0] → null)', async () => {
    shop({ constitution: 'paint', sectors: [] });
    const lane = await R.laneOf(SHOP, { origin: 'AU' });
    assert.strictEqual(lane.vertical, 'paint');
    assert.strictEqual(lane.code, null);
  });
  await okA('readiness.laneOf: a declared sector still answers when no constitution names a trade (paint stays paint, not chemical)', async () => {
    shop({ sectors: ['paint'] });
    assert.strictEqual((await R.laneOf(SHOP, { origin: 'AU' })).vertical, 'paint');
  });
  await okA('a screen\'s query value still wins over the resolver', async () => {
    shop({ constitution: 'paint' });
    assert.strictEqual((await R.laneOf(SHOP, { vertical: 'food', origin: 'AU' })).vertical, 'food');
  });
  await okA('adopt.verticalOf(sectors) answers through the resolver: the same pack key as before (kirana → food, none → null)', () => {
    assert.deepStrictEqual([A.verticalOf(['Kirana']), A.verticalOf([]), A.verticalOf(['Pharmaceuticals'])], ['food', null, 'pharma']);
  });
  await okA('the resolved trade reaches lotfields.tracksBatch through its sectors door (the engine is not edited): constitution pharma tracks batches, none tracks nothing', () => {
    const wordsOf = (t) => [t.key].concat(t.sectors).filter(Boolean);
    assert.strictEqual(L.tracksBatch({ sectors: wordsOf(G.verticalFrom({ constitution: 'pharma' })) }).tracked, true);
    assert.strictEqual(L.tracksBatch({ sectors: wordsOf(G.verticalFrom({})) }).tracked, false);
    assert.strictEqual(L.tracksBatch({ sectors: ['pharma'] }).tracked, true);   /* the old door is unchanged */
  });
  await okA('entity-header: an Indian pharmacy stamped by its CONSTITUTION gets the drug licence as a core scheme', () => {
    const out = H.build({ me: { country: 'IN', vertical: 'general' }, profile: { sectors: [] }, compliance: [], docs: {}, constitution: 'pharma' });
    assert.ok(out.licences.some((row) => row.scheme === 'DRUG' && row.core), JSON.stringify(out.licences));
  });
  await okA('no reader keeps its own trade read: no sectors[0] in readiness/profile, no SELECT sectors in stock-from-chit, no packFor join in entity-header', () => {
    const src = (f) => fs.readFileSync(path.join(API, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.ok(!/sectors\[0\]/.test(src('lib/readiness.js')), 'readiness');
    assert.ok(!/laneOf\([^)]*sectors\[0\]/.test(src('lib/profile.js')) && !/const sector = p\.sectors\[0\]/.test(src('lib/profile.js')), 'profile');
    assert.ok(!/SELECT sectors FROM entity_profile/.test(src('lib/stock-from-chit.js')), 'stock-from-chit');
    assert.ok(!/packFor\(/.test(src('lib/entity-header.js')) && !/packFor\(/.test(src('lib/adopt.js')), 'entity-header / adopt');
  });

  console.log('\n══ VERT-8 · the Price Lab opens on the trade\'s list ══');
  await okA('forVertical: restaurant → hotel, kirana → veg, an unknown trade → null (the page asks, nothing is guessed)', () => {
    assert.deepStrictEqual([BP.forVertical('restaurant'), BP.forVertical('Kirana'), BP.forVertical('paint'), BP.forVertical(null)], ['hotel', 'veg', null, null]);
  });
  await okA('every trade list names a real blueprint', () => {
    Object.keys(BP.TRADES).forEach((key) => assert.ok(BP.BLUEPRINTS[key], key));
  });
  await okA('GET /api/products/lists returns vertical + pick from govresolve.verticalOf', () => {
    const route = fs.readFileSync(path.join(API, 'routes', 'products.js'), 'utf8');
    const body = route.slice(route.indexOf("router.get('/lists'"), route.indexOf("router.get('/lists'") + 6000);
    assert.ok(/govresolve'\)\.verticalOf\(entity_id\)/.test(body) && /pick: BP\.forVertical\(trade\.key\)/.test(body));
  });

  console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

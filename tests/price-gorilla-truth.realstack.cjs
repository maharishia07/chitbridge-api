'use strict';
/**
 * tests/price-gorilla-truth.realstack.cjs — GORILLA PACK 5: POST /api/till/price, POST /api/till/rate and PATCH /api/products/:id, hammered
 * (docs/api/COLUMN-13-ADDS-UP.md §4a, fifth in its order; row ADDS-MONEY-5).
 *
 * owns: the three doors that change what a product costs or which tax it carries, and the checks every press must pass. The generator is
 *       tests/lib/gorilla.cjs; the doors, the case runner and the fresh shop are tests/lib/truth-harness.cjs. Pack 1 (send-gorilla) is the pattern.
 * FLOW  three fresh shops (the products limiter is 240 a minute per caller), each with a GSTIN, a 5% slab on its shelf and a till key, and another shop with a product of its own → per record:
 *       before() makes the product to change (a fresh one at ₹60, MRP ₹80 · or the other shop's · an id that is no row · an id that is no id)
 *       and snapshots it → send() presses one door (sometimes twice) and snapshots it again → TP-1..TP-12 graded over every record → one case each
 * CARD 06-catalogue-pim/README
 *
 * What a record varies: the door; the caller (the owner, or the shop's till key); for a price, a value that is valid, invalid, finer than a
 * paisa, absurdly large, or above the MRP; on PATCH also an MRP below the price or a price in another currency; for a rate, a slab on the
 * shelf, one that is not, or none; and the same press again.
 *
 * What every press must do (ADDS-MONEY-5: a price is money — kept exactly as sent, or refused in words; never a 500, never a zero nobody typed):
 *   TP-1  never a 500: kept, or refused with a sentence
 *   TP-2  a valid price is kept: 200, item_data.price = { amount as sent, the shop's currency }
 *   TP-3  the counter keeps the old price: price_was is the price before the press
 *   TP-4  an invalid price (negative · a word · blank · true) is refused in words, and nothing changes
 *   TP-5  a price finer than the currency holds (₹12.345) is refused, never kept
 *   TP-6  the MRP is a ceiling: a price above it, or an MRP lowered below the price, is refused, and nothing changes
 *   TP-7  an absurd price (1e20) is refused in words, never a 500
 *   TP-8  a product that is not mine (the other shop's · no such row) is refused, and the other shop's product is untouched
 *   TP-9  a product id that is no id is a 400 or 404, never a 500
 *   TP-10 a rate from the owner on a slab on the shelf is kept (tax_slab · gst_rate); the same press again changes nothing
 *   TP-11 a press the door refuses before it reads (a till key at the rate door or PATCH · a slab not on the shelf · no slab) writes nothing
 *   TP-12 PATCH with a price in another currency is refused 409, and nothing changes
 *   TODAY (gaps, filed 2026-10-29): TP-4 CTR-168 · TP-5 CAT-229 · TP-6 CAT-206 · TP-7 CAT-231 · TP-9 CAT-230
 *
 * Fixed seed 20261102 · budget 180 s · GORILLA_N (default 200) · GORILLA_SEED=<n>|random · GORILLA_ONLY=<i> replays one.
 * Run: node tests/price-gorilla-truth.realstack.cjs
 * ⚠️ LOCAL ONLY (the harness refuses anything else). Writes go through the routes; the database is only SELECTed.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const G = require('./lib/gorilla.cjs');
const { DB, j, ok, kase, freshShop, finish } = H;

/* the run tag names the fresh SHOPS and products only (the world); nothing in a record reads it */
const RUN = 'tp' + (Date.now() % 1e10).toString(36);
const FIXED_SEED = 20261102;
const PRICE = 60,
  MRP = 80;
const textOf = (reply) => [reply && reply.error, reply && reply.message, reply && reply.why, reply && reply.detail].find((said) => typeof said === 'string' && said.trim());

/* a price is { v, cls, want? }: valid (kept as `want`) · invalid · blank (no number at all) · fine (finer than a paisa) · huge · aboveMrp */
const PRICES = [
  { v: 55, cls: 'valid', want: 55 }, { v: 72.5, cls: 'valid', want: 72.5 }, { v: 0, cls: 'valid', want: 0 }, { v: '45', cls: 'valid', want: 45 }, { v: ' 7 ', cls: 'valid', want: 7 },
  { v: -1, cls: 'invalid' }, { v: 'abc', cls: 'invalid' }, { v: true, cls: 'invalid' }, { v: null, cls: 'invalid' }, { v: '', cls: 'invalid' }, { v: [], cls: 'invalid' },
  { v: 12.345, cls: 'fine' }, { v: 1e20, cls: 'huge' }, { v: 99, cls: 'aboveMrp' }
];
/* on PATCH only: the MRP lowered below the price, and a price in another currency */
const PATCH_ONLY = [{ mrp: 50, cls: 'mrpBelow' }, { v: { amount: 55, currency: 'USD' }, cls: 'foreign' }];
const TARGETS = ['theirs', 'unknownId', 'badId'];
/* /api/products answers 240 a minute per caller (server.js serviceLimiter): records take turns over SHOPS shops, each well under it */
const SHOPS = 3;
const ownOf = (world, index) => world.shops[index % SHOPS];

/** one seeded record: the door, the caller, the target, the value or slab, maybe a second press */
function makeRecord(h, index) {
  const door = h.pick(['price', 'price', 'patch', 'patch', 'rate']);
  const target = h.chance(0.15) ? h.pick(TARGETS) : 'own';
  /* a till key may type a price at the counter (requireScope 'till'); the rate door and PATCH are not its to press */
  const caller = h.chance(0.12) ? 'key' : 'owner';
  let value = null,
    slab = null;
  if (door === 'rate') slab = h.pick(['shelf', 'shelf', 'shelf', 'unknown', 'none']);
  else value = door === 'patch' && h.chance(0.15) ? h.pick(PATCH_ONLY) : h.pick(PRICES);
  /* the ONE answer a record is graded for, in the order a door must decide it */
  const verdict =
    caller === 'key' && door !== 'price' ? 'forbidden'
      : target !== 'own' ? 'notMine'
        : door === 'rate' ? (slab === 'shelf' ? 'rate' : 'noSlab')
          : value.cls;
  return { index, door, target, caller, value, slab, verdict, again: (verdict === 'valid' || verdict === 'rate') && h.chance(0.3) };
}

/* what a product holds: its item_data, read past RLS (the test only SELECTs) */
async function snapshot(pg, itemId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(itemId))) return null;
  const row = (await pg.query('SELECT item_data FROM catalogue_items WHERE item_id = $1', [itemId])).rows[0];
  return row ? row.item_data : null;
}

/** before each record: the product to change, and what it holds now */
function productMaker(world, pg) {
  return async (record, index) => {
    if (record.target === 'theirs') return { index, itemId: world.theirs, before: await snapshot(pg, world.theirs) };
    if (record.target === 'unknownId') return { index, itemId: '00000000-0000-4000-8000-' + String(600000000000 + index), before: null };
    if (record.target === 'badId') return { index, itemId: 'not-a-product-' + index, before: null };
    const body = { item_data: { name: 'Gorilla rice ' + RUN + ' ' + index, unit: 'kg', price: PRICE, mrp: MRP } };
    const itemId = ok(await j('/api/products', { method: 'POST', token: ownOf(world, index).shop.token, body }), 'product ' + index).b.item.item_id;
    return { index, itemId, before: await snapshot(pg, itemId) };
  };
}

/** the one press a record makes, as { url, method, body } */
function pressOf(record, own, made) {
  if (record.door === 'rate') {
    const body = { item_id: made.itemId };
    if (record.slab === 'shelf') body.slab_id = own.slab;
    if (record.slab === 'unknown') body.slab_id = '00000000-0000-4000-8000-' + String(700000000000 + record.index);
    return { url: '/api/till/rate', method: 'POST', body };
  }
  if (record.door === 'price') return { url: '/api/till/price', method: 'POST', body: { item_id: made.itemId, price: record.value.v } };
  const item_data = record.value.cls === 'mrpBelow' ? { mrp: record.value.mrp } : { price: record.value.v };
  return { url: '/api/products/' + encodeURIComponent(made.itemId), method: 'PATCH', body: { merge: true, item_data } };
}

/** press (and maybe again), then read the product back (and the other shop's) */
function presser(world, pg) {
  return async (record, index, made) => {
    const own = ownOf(world, index);
    const press = pressOf(record, own, made);
    const token = record.caller === 'key' ? own.key : own.shop.token;
    const first = await j(press.url, { method: press.method, token, body: press.body });
    const seen = { status: first.status, said: textOf(first.b), body: first.b, made };
    if (record.again && first.status === 200) {
      const again = await j(press.url, { method: press.method, token, body: press.body });
      Object.assign(seen, { againStatus: again.status, againBody: again.b, afterFirst: await snapshot(pg, made.itemId) });
    }
    seen.after = await snapshot(pg, made.itemId);
    return seen;
  };
}

const amountOf = (data) => (data && data.price && typeof data.price === 'object' ? data.price.amount : data && data.price);
const unchanged = (seen) => JSON.stringify(seen.after) === JSON.stringify(seen.made.before);
const said = (seen) => (seen.said ? ' "' + seen.said.slice(0, 80) + '"' : '');
const show = (record) => record.door + ' ' + (record.door === 'rate' ? 'slab=' + record.slab : JSON.stringify(record.value.cls === 'mrpBelow' ? { mrp: record.value.mrp } : record.value.v)) + (record.caller === 'key' ? ' (till key)' : '');
const kept = (seen) => (seen.status === 200 ? ' · price now ' + JSON.stringify(seen.after && seen.after.price) + ' mrp ' + (seen.after && seen.after.mrp) : said(seen));

/** a refusal that writes nothing */
function refusedClean(record, seen, statuses) {
  if (statuses.indexOf(seen.status) < 0) return show(record) + ' answered HTTP ' + seen.status + kept(seen);
  if (seen.status >= 400 && !seen.said) return show(record) + ' refused HTTP ' + seen.status + ' with no sentence';
  return unchanged(seen) ? null : 'refused, but the product changed: ' + JSON.stringify(seen.made.before) + ' → ' + JSON.stringify(seen.after);
}
const REFUSED = [400, 409, 422];
const classCheck = (cls, statuses) => (record, seen) => (seen.thrown || record.verdict !== cls ? null : refusedClean(record, seen, statuses || REFUSED));

const CHECKS = [
  { id: 'TP-1', title: 'never a 500: every press is kept, or refused with a sentence', check: (record, seen) => {
    if (seen.thrown) return 'the call threw: ' + seen.thrown;
    if (record.target === 'badId' || record.verdict === 'huge') return null; /* TP-9 and TP-7 hold these */
    for (const status of [seen.status, seen.againStatus]) {
      if (status === undefined) continue;
      if (status >= 500) return show(record) + ' on ' + record.target + ': HTTP ' + status + said(seen);
      if (status >= 400 && !seen.said) return show(record) + ': HTTP ' + status + ' with no sentence';
    }
    return null;
  } },
  { id: 'TP-2', title: 'a valid price is kept: 200, item_data.price is the amount as sent in the shop\'s currency', check: (record, seen) => {
    if (seen.thrown || record.verdict !== 'valid') return null;
    if (seen.status !== 200) return show(record) + ' answered HTTP ' + seen.status + said(seen);
    const price = seen.after && seen.after.price;
    if (!price || typeof price !== 'object' || price.amount !== record.value.want || price.currency !== 'INR') return show(record) + ' is kept as ' + JSON.stringify(price) + ', not { amount: ' + record.value.want + ', currency: INR }';
    if (record.door === 'price' && seen.body.now !== record.value.want) return show(record) + ': the answer says now ' + JSON.stringify(seen.body.now);
    if (record.again && seen.againStatus !== 200) return 'the same price again answered HTTP ' + seen.againStatus;
    return null;
  } },
  { id: 'TP-3', title: 'the counter keeps the old price: price_was is the price before the press', check: (record, seen) => {
    if (seen.thrown || record.door !== 'price' || record.verdict !== 'valid' || seen.status !== 200 || record.again) return null;
    const was = amountOf(seen.made.before);
    return seen.after.price_was === was && seen.body.was === was ? null : 'price_was ' + JSON.stringify(seen.after.price_was) + ' · the answer\'s was ' + JSON.stringify(seen.body.was) + ', the price before was ' + was;
  } },
  { id: 'TP-4', title: 'an invalid price (negative · a word · blank · true) is refused in words, and nothing changes', gap: 'CTR-168 · the counter reads null, "", [] as ₹0 and true as ₹1', check: classCheck('invalid', [400, 422]) },
  { id: 'TP-5', title: 'a price finer than the currency holds (₹12.345) is refused, never kept', gap: 'CAT-229 · both doors keep ₹12.345 as sent', check: classCheck('fine') },
  { id: 'TP-6', title: 'the MRP is a ceiling: a price above it, or an MRP below the price, is refused, and nothing changes', gap: 'CAT-206 · the MRP ceiling is not built (both doors; an MRP lowered below the price is kept too)', check: (record, seen) =>
    seen.thrown || (record.verdict !== 'aboveMrp' && record.verdict !== 'mrpBelow') ? null : refusedClean(record, seen, REFUSED) },
  { id: 'TP-7', title: 'an absurd price (1e20) is refused in words, never a 500', gap: 'CAT-231 · 1e20 passes the number check at both doors and fails at the write: 500', check: classCheck('huge') },
  { id: 'TP-8', title: 'a product that is not mine (the other shop\'s · no such row) is refused, and the other shop\'s product is untouched', check: (record, seen) => {
    if (seen.thrown || record.verdict !== 'notMine' || record.target === 'badId') return null;
    /* 404 for a press the door has nothing against; a value or a slab it refuses on its own may be refused first */
    return refusedClean(record, seen, [400, 403, 404, 409, 422]);
  } },
  { id: 'TP-9', title: 'a product id that is no id is a 400 or 404, never a 500', gap: 'CAT-230 · the id reaches the uuid cast on all three doors', check: (record, seen) =>
    seen.thrown || record.target !== 'badId' || record.verdict === 'forbidden' ? null : refusedClean(record, seen, [400, 403, 404, 409, 422]) },
  { id: 'TP-10', title: 'a rate from the owner on a slab on the shelf is kept (tax_slab · gst_rate); the same press again changes nothing', check: (record, seen) => {
    if (seen.thrown || record.verdict !== 'rate') return null;
    if (seen.status !== 200) return show(record) + ' answered HTTP ' + seen.status + said(seen);
    if (seen.after.tax_slab !== seen.body.slab_id || seen.after.gst_rate !== 5 || seen.body.rate !== 5) return 'the product carries tax_slab ' + seen.after.tax_slab + ' gst_rate ' + seen.after.gst_rate + ' · the answer says rate ' + seen.body.rate;
    if (!record.again) return null;
    if (seen.againStatus !== 200 || seen.againBody.changed !== false) return 'the same rate again answered HTTP ' + seen.againStatus + ' changed ' + JSON.stringify(seen.againBody && seen.againBody.changed);
    return JSON.stringify(seen.after) === JSON.stringify(seen.afterFirst) ? null : 'the same rate again moved the product';
  } },
  { id: 'TP-11', title: 'a press the door refuses before it reads (a till key at the rate door or PATCH · a slab not on the shelf · no slab) writes nothing', check: (record, seen) => {
    if (seen.thrown) return null;
    if (record.verdict === 'forbidden') return refusedClean(record, seen, [403]);
    return record.verdict === 'noSlab' ? refusedClean(record, seen, [400, 404]) : null;
  } },
  { id: 'TP-12', title: 'PATCH with a price in another currency is refused 409, and nothing changes', check: classCheck('foreign', [409]) }
];

(async () => {
  console.log('\n══ GORILLA · POST /api/till/price · POST /api/till/rate · PATCH /api/products/:id · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  let report = null;
  await pg.connect();
  try {
    const shops = [];
    for (let n = 0; n < SHOPS; n++) {
      const shop = await freshShop(RUN + 's' + n, 'Gorilla Price ' + n);
      /* a registered shop charges GST, so the rate door has a shelf to read */
      ok(await j('/api/entities/profile', { method: 'PATCH', token: shop.token, body: { gstn: '27AAPFU0939F1ZV' } }), 'GSTIN');
      const slab = ok(await j('/api/definitions', { method: 'POST', token: shop.token, body: { kind: 'tax', name: 'GST 5 ' + RUN, status: 'live', rules: { rate: 5 } } }), '5% slab').b.definition.definition_id;
      /* the shop's TILL KEY: the counter's own caller, which may price but not set a rate */
      const key = ok(await j('/api/keys', { method: 'POST', token: shop.token, body: { name: 'Gorilla till ' + RUN, scopes: ['till'], days: 1 } }), 'till key').b.key;
      shops.push({ shop, slab, key });
    }
    /* the OTHER shop's own product: a row no press of mine may reach */
    const other = await freshShop(RUN + 'o', 'Gorilla Other');
    const theirs = ok(await j('/api/products', { method: 'POST', token: other.token, body: { item_data: { name: 'Their rice ' + RUN, unit: 'kg', price: PRICE, mrp: MRP } } }), 'their product').b.item.item_id;
    const world = { shops, theirs };
    report = await G.hammer({ label: 'POST /api/till/price · /rate · PATCH /api/products/:id', file: 'tests/price-gorilla-truth.realstack.cjs', fixedSeed: FIXED_SEED, budgetMs: 180000,
      make: makeRecord, before: productMaker(world, pg), send: presser(world, pg), checks: CHECKS, kase });
  } finally {
    await pg.end();
  }
  /* finish writes GORILLA_JSON last, so the gorilla's failing indexes ride along with the cases */
  finish('price-gorilla', process.env.GORILLA_JSON, { gorilla: report });
})().catch((e) => { console.error('price-gorilla could not run: ' + e.message); process.exit(1); });

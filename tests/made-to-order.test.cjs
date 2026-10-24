/**
 * made-to-order.test.cjs — R104: a dish cooked to order is not stock (2026-10-24), offline over a stand-in database.
 *
 *   · lib/stocked.stockedFor — the trade answers first (forVertical === 'hotel' → not counted), the item overrides both ways, no trade → counted
 *   · lib/stocked.flagsFor — ONE query carries both flags (batch_tracked · stocked); an unreadable read answers "counted" (as before R104), logged
 *   · lib/stock-from-chit.postFor — a bill of 2 Masala Dosa + 1 Ghee: Ghee is issued, the dosa is a NAMED skip `not_stocked`; a receipt of a dish the same
 *   · lib/stock-store.onHand { counted_only } drops the dish · { counted: 'stamp' } keeps it marked `counted: false` with its old figure
 *   · lib/stock-store.asAt { counted_only } — the dish leaves rows, value and below_zero; the value is unchanged (a never-received dish is worth 0)
 *   · a supply (item_kind 'supply') is always counted, whatever the trade
 *
 * Run: node tests/made-to-order.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0,
  fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(84) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const mock = (rel, exports) => {
  require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports };
};
mock('/db', { withEntity: async (_e, fn) => fn({ query: async () => ({ rows: [] }) }), query: async () => ({ rows: [] }), readBatch: async () => [{ rows: [] }] });

const DOSA = 'a1000000-0000-4000-8000-00000000d05a',
  GHEE = 'a1000000-0000-4000-8000-000000000ee1',
  WATER = 'a1000000-0000-4000-8000-00000000a0a0',
  SOAP = 'a1000000-0000-4000-8000-00000050a900';
/* the catalogue's own flags: the dosa says nothing (the trade decides), ghee says counted, water says not counted */
const FLAG_ROWS = [
  { item_id: DOSA, batch_tracked: null, stocked: null },
  { item_id: GHEE, batch_tracked: false, stocked: true },
  { item_id: WATER, batch_tracked: null, stocked: false }
];
let TRADE = ['tiffin'],
  FLAGS_FAIL = false,
  flagReads = 0,
  BALANCES = [],
  MOVES = [];
const G = require(API + '/lib/govresolve');
G.verticalOf = async () => G.verticalFrom({ sectors: TRADE });
const withEntity = async (_e, fn) =>
  fn({
    query: async (sql, params) => {
      if (/item_data->'stocked'/.test(sql)) {
        flagReads++;
        if (FLAGS_FAIL) throw new Error('catalogue unreadable');
        return { rows: FLAG_ROWS.filter((row) => params[1].indexOf(row.item_id) >= 0) };
      }
      if (/FROM stock_balance/.test(sql)) return { rows: BALANCES };
      if (/FROM stock_movement/.test(sql)) return { rows: MOVES.filter((m) => m.at < params[1]) };
      return { rows: [] };
    }
  });

const stocked = require(API + '/lib/stocked');
const store = require(API + '/lib/stock-store');
const fromChit = require(API + '/lib/stock-from-chit');

(async () => {
  console.log('\nR104 · a made-to-order dish is not stock\n');
  const tiffin = G.verticalFrom({ sectors: ['tiffin'] }),
    veg = G.verticalFrom({ sectors: ['vegetables'] });
  t('stockedFor: a tiffin shop\'s item is not counted by default (forVertical → hotel)', [stocked.stockedFor(tiffin, undefined).counted, stocked.stockedFor(tiffin, undefined).source], [false, 'vertical']);
  t('…a vegetable shop\'s item is counted by default', stocked.stockedFor(veg, undefined).counted, true);
  t('…no trade declared → counted (a default is not an answer to a question nobody asked)', [stocked.stockedFor(null, undefined).counted, stocked.stockedFor(null, undefined).source], [true, 'none']);
  t('…the item overrides both ways: ghee counted in a tiffin shop, water not counted in a veg shop', [stocked.stockedFor(tiffin, true).counted, stocked.stockedFor(veg, false).counted], [true, false]);
  t('…"tiffin" does not hit the food batch pack (the hazard is the word food-service)', [tiffin.pack, G.verticalFrom({ sectors: ['food-service'] }).pack.key], [null, 'food']);
  const BP = require(API + '/lib/catalogue-blueprint');
  t('…the default is the starter data\'s own answer (catalogue-blueprint.cooksToOrder over its one word list), no list and no trade test of our own', [BP.cooksToOrder('tiffin'), BP.cooksToOrder('restaurant'), BP.cooksToOrder('vegetables'), BP.cooksToOrder(null)], [true, true, false, false]);
  t('…lib/stocked.js never tests a trade key itself (VB-02)', /===\s*['"]hotel['"]/.test(require('fs').readFileSync(API + '/lib/stocked.js', 'utf8')), false);

  flagReads = 0;
  const f = await stocked.flagsFor('e1', [DOSA, GHEE, WATER], withEntity, {});
  t('flagsFor: ONE query carries both flags for the whole chit', flagReads, 1);
  t('…dosa not counted (trade) · ghee counted (its flag) · water not counted (its flag); nothing tracked by batch', [DOSA, GHEE, WATER].map((id) => [f.by.get(id).counted, f.by.get(id).tracked]), [[false, false], [true, false], [false, false]]);
  t('…the trade\'s usual travels with the answer', f.counted_default, false);
  FLAGS_FAIL = true;
  const f2 = await stocked.flagsFor('e1', [DOSA, GHEE], withEntity, {});
  t('…an unreadable catalogue answers "counted" for every item (as before R104), never a vanished receipt', [f2.by.get(DOSA).counted, f2.by.get(GHEE).counted, f2.counted_default], [true, true, true]);
  FLAGS_FAIL = false;

  /* ── postFor: the counter's bill and goods-in ── */
  const issued = [],
    posted = [];
  store.issue = async (_e, mv) => {
    issued.push(mv.item_id);
    return { ok: true, moved: 1, duplicate: 0, short: 0 };
  };
  store.post = async (_e, mv) => {
    posted.push(mv.item_id);
    return { ok: true, duplicate: false };
  };
  const bill = {
    chit_id: 'c1',
    purpose: 'order',
    business_json: { bill_no: 'C1-0001', client_ref: 'C1-0001' },
    line_items: [
      { item_id: DOSA, quantity: 2, unit: 'plate', price: 90 },
      { item_id: GHEE, quantity: 1, unit: 'piece', price: 320 }
    ],
    created_at: '2026-10-24T05:00:00.000Z'
  };
  const r1 = await fromChit.postFor('e1', bill, withEntity, {});
  t('postFor a bill 2 Masala Dosa + 1 Ghee: ghee issued, the dosa a NAMED skip not_stocked', [issued, r1.moved, r1.skipped.map((s) => [s.item_id, s.code])], [[GHEE], 1, [[DOSA, 'not_stocked']]]);
  t('…the skip says why, in shop words', /not counted as stock/.test(r1.skipped[0].why), true);
  const receipt = {
    chit_id: 'c2',
    purpose: 'receipt',
    business_json: { doc: 'receipt', doc_no: 'GR-1', client_ref: 'GR-1' },
    line_items: [
      { item_data: { item_id: DOSA, unit_cost: 10 }, quantity: 5, unit: 'plate', price: 10 },
      { item_data: { item_id: GHEE, unit_cost: 200 }, quantity: 10, unit: 'piece', price: 200 }
    ],
    created_at: '2026-10-24T05:00:00.000Z'
  };
  const r2 = await fromChit.postFor('e1', receipt, withEntity, {});
  t('postFor a receipt: ghee received (10), a received dish is the same named skip', [posted, r2.moved, r2.skipped.map((s) => s.code)], [[GHEE], 1, ['not_stocked']]);
  TRADE = ['vegetables'];
  issued.length = 0;
  const r3 = await fromChit.postFor('e1', bill, withEntity, {});
  t('…a vegetable shop selling the same lines: both move (the dosa has no flag; the trade counts everything)', [issued.slice().sort(), r3.skipped.length], [[DOSA, GHEE].sort(), 0]);
  TRADE = ['tiffin'];

  /* ── the readers ── */
  const bal = (item_id, qty, value, item_kind) => ({ item_id, item_kind: item_kind || 'catalogue', lot: '', expires_at: null, qty: String(qty), value: String(value), avg_cost: '0', last_at: new Date(), moves: 1 });
  BALANCES = [bal(DOSA, -40, 0), bal(GHEE, 9, 1800), bal(WATER, -3, 0), bal(SOAP, 4, 120, 'supply')];
  const plain = await store.onHand('e1', withEntity, {});
  t('onHand plain: the old shape, every balance (the counter\'s Receive is unchanged)', Object.keys(plain).length, 4);
  flagReads = 0;
  const only = await store.onHand('e1', withEntity, { counted_only: true });
  t('onHand { counted_only }: the dosa (trade) and the water (its flag) are left out; ghee and the supply stay', Object.keys(only).sort(), [GHEE, SOAP].sort());
  t('…one flags read, over the catalogue items only (the supply is not asked)', flagReads, 1);
  const stamped = await store.onHand('e1', withEntity, { counted: 'stamp', lots: true });
  t('onHand { counted: "stamp" }: every balance stays, each marked; the dosa keeps its old figure −40', [stamped[DOSA].counted, stamped[DOSA].qty, stamped[GHEE].counted, stamped[SOAP].counted], [false, -40, true, true]);
  BALANCES = [bal(SOAP, 4, 120, 'supply')];
  flagReads = 0;
  await store.onHand('e1', withEntity, { counted_only: true });
  t('…a shelf of supplies alone asks nothing (no read, no trip)', flagReads, 0);

  const mv = (item_id, qty, rate, reason, at, item_kind) => ({ movement_id: 'm' + MOVES.length, item_id, item_kind: item_kind || 'catalogue', location: 'default', lot: '', qty, rate, value_delta: null, unit: 'piece', reason, at });
  MOVES = [mv(GHEE, 10, 200, 'purchase', '2026-10-05T04:00:00.000Z'), mv(GHEE, -1, null, 'sale', '2026-10-20T06:00:00.000Z'), mv(DOSA, -2, null, 'sale', '2026-10-20T06:00:00.000Z'), mv(DOSA, -3, null, 'sale', '2026-10-21T06:00:00.000Z')];
  const before = await store.asAt('e1', withEntity, '2026-10-31T18:30:00.000Z');
  t('asAt without the option (as today): the dosa sits in below_zero and would refuse closing stock', [before.below_zero, before.value, before.rows.length], [[DOSA], 1800, 2]);
  const after = await store.asAt('e1', withEntity, '2026-10-31T18:30:00.000Z', { counted_only: true });
  t('asAt { counted_only }: below_zero is empty, the value is UNCHANGED (9 ghee at 200), the dosa row gone, movements still counted', [after.below_zero, after.value, after.rows.length, after.movements], [[], 1800, 1, 4]);

  console.log('\n  ' + pass + ' checks · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

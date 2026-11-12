'use strict';
/**
 * b5a-counter-reads.test.cjs - B5a (REST plan C6, api half): the till's READS.
 *  CTR-205  GET /bills?by=<person> filters in SQL, BEFORE the LIMIT (130 bills by A, 5 older by B: by=B returns B's 5, not [])
 *  CTR-195  GET /summary (day) carries TODAY's live bills through rollup.acrossCounters, live:true; a FILED day wins (no double takings)
 *  CTR-209  the shop's day (shop-clock.bizDay), not UTC: a bill at 00:10 IST is today's; an expiry of today says "expires today"
 * Worked by hand: clock 2026-11-12T19:00Z = 2026-11-13 00:30 IST. Bill X at 18:40Z = 13 Nov 00:10 IST (UTC calls it the 12th).
 *   C1 live: X 500 + Y 250 = 750 (count 2); C2 live: 100. Day 13 Nov, shop total 850, count 3.
 *   C1 filed (count 9, gross 4000) then asked: C1 = 4000 (its live 750 is NOT added), C2 live 100 -> 4100, count 10.
 * Run: node tests/b5a-counter-reads.test.cjs
 * CARD      09-counter/day-close
 */
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

const SHOP = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let BILL_ROWS = [], FILED = [], OFFER_ROWS = [], ZONE = 'Asia/Kolkata';
const LOG = [];
function rowsFor(sql, params) {
  const text = String(sql);
  if (/COALESCE.timezone, country. AS zone/.test(text)) return [{ zone: ZONE }];
  if (/WITH lines AS/.test(text)) return OFFER_ROWS;
  if (/'summary' ->> 'period'/.test(text)) return FILED.map((summary) => ({ business_json: { summary } }));
  if (!/h\.sender_entity_id = \$1 AND h\.purpose IN/.test(text)) return [];
  LOG.push(params);
  const by = params[4], till = params[3];
  const bothArms = /UNION ALL/.test(text); /* BILLS_SQL has the withdrawn arm; the summary's live statement does not */
  const hit = BILL_ROWS.filter((r) => (bothArms || !r.withdrawn) && (!by || (r.business_json.till.by || {}).id === by) && (!till || r.business_json.till.id.toUpperCase() === String(till).toUpperCase()));
  return hit.sort((x, y) => (x.created_at < y.created_at ? 1 : -1)).slice(0, params[2]).map((r) => Object.assign({ withdrawn: false }, r));
}
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p) }) };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (s, p) => ({ rows: rowsFor(s, p) }),
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
  onEntity: async (id, db, fn) => fn(tx)
} };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => {
    req.identity = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CB-SHOP', display_name: 'Shop' };
    req.api_key = { scopes: ['till'] };
    req.till = require(path.join(API, 'lib', 'holder')).holderOf({ kind: 'api_key', scopes: ['till'] }, null);
    next();
  },
  { entityOf: (req) => req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };
const express = require('express');
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async () => null;
const clock = require(path.join(API, 'lib', 'shop-clock'));
clock.set('2026-11-12T19:00:00Z');

const bill = (no, at, total, tillId, byId, withdrawn) => ({
  withdrawn: !!withdrawn,
  chit_id: 'c-' + no, created_at: at, line_items: [],
  business_json: { bill_no: no, billed_at: at, slip: 'cash', till: { id: tillId, name: 'Counter ' + tillId, by: byId ? { id: byId, name: 'P' } : null }, payment: { parts: [{ how: 'Cash', amount: total }], total }, customer: { name: 'Walk-in' } },
  summary_json: { money: { total, taxable: total, tax: 0, savings: 0 } }
});
const iso = (minutes) => new Date(Date.parse('2026-11-12T10:00:00Z') + minutes * 60000).toISOString();
const totalsOf = (count, gross) => ({ count, returns: 0, gross, refunds: 0, reduced: 0, expenseCount: 0, expenses: 0, total: gross, by: { Cash: gross } });

(async () => {
  const app = express();
  app.use('/api/till', require(path.join(API, 'routes', 'till')));
  const srv = app.listen(0);
  const get = async (p) => (await fetch(`http://127.0.0.1:${srv.address().port}/api/till${p}`)).json();
  let n = 0;
  const ok = (name, fn) => Promise.resolve(fn()).then(() => { n++; console.log('  ok  ' + name); });

  await ok('CTR-205: by=<person> is asked of the database, so 130 newer bills by A do not crowd out the 5 older ones by B', async () => {
    BILL_ROWS = [];
    for (let i = 0; i < 5; i++) BILL_ROWS.push(bill('B' + i, iso(i), 10, 'C1', B));
    for (let i = 0; i < 130; i++) BILL_ROWS.push(bill('A' + i, iso(100 + i), 10, 'C1', A));
    const got = await get('/bills?by=' + B + '&limit=100');
    assert.deepStrictEqual(got.bills.map((r) => r.no).sort(), ['B0', 'B1', 'B2', 'B3', 'B4']);
    assert.strictEqual(LOG[LOG.length - 1][4], B, 'the person rides the statement as its fifth parameter');
    const all = await get('/bills?limit=100');
    assert.strictEqual(all.count, 100);
  });
  await ok('CTR-205: a malformed by is ignored, never a 4xx', async () => {
    const got = await get('/bills?by=not-a-uuid&limit=100');
    assert.strictEqual(got.count, 100);
  });

  const X = bill('X', '2026-11-12T18:40:00Z', 500, 'C1', A), Y = bill('Y', '2026-11-12T18:50:00Z', 250, 'C1', A), Z = bill('Z', '2026-11-12T18:55:00Z', 100, 'C2', A);
  const OLD = bill('O', '2026-11-12T10:00:00Z', 999, 'C1', A); /* 15:30 IST on the 12th: yesterday's, not today's */
  await ok('CTR-195/209: today (shop day) is folded from the live bills, per counter, flagged live; a bill at 00:10 IST counts today', async () => {
    BILL_ROWS = [X, Y, Z, OLD]; FILED = [];
    const got = await get('/summary?period=day');
    assert.strictEqual(got.rows.length, 1);
    const row = got.rows[0];
    assert.strictEqual(row.key, '2026-11-13');
    assert.strictEqual(row.live, true);
    assert.strictEqual(row.totals.count, 3);
    assert.strictEqual(row.totals.gross, 850);
    assert.deepStrictEqual(row.counters.map((c) => [c.till.id, c.totals.gross, c.live]).sort(), [['C1', 750, true], ['C2', 100, true]]);
    assert.strictEqual(got.live_capped, false);
  });
  await ok('CTR-195: file the day, then ask - the filed counter wins, no double takings', async () => {
    FILED = [{ period: 'day', key: '2026-11-13', till: { id: 'C1', name: 'Counter C1' }, totals: totalsOf(9, 4000) }];
    const row = (await get('/summary?period=day')).rows[0];
    assert.strictEqual(row.totals.gross, 4100);
    assert.strictEqual(row.totals.count, 10);
    assert.deepStrictEqual(row.counters.map((c) => [c.till.id, c.totals.gross, c.live]).sort(), [['C1', 4000, false], ['C2', 100, true]]);
  });
  await ok('CTR-195: every counter filed -> the row is not live', async () => {
    FILED.push({ period: 'day', key: '2026-11-13', till: { id: 'C2', name: 'Counter C2' }, totals: totalsOf(1, 100) });
    const row = (await get('/summary?period=day')).rows[0];
    assert.strictEqual(row.live, false);
    assert.strictEqual(row.totals.gross, 4100);
  });
  await ok('CTR-195: a week is never half-filled with today alone (live is the day view only)', async () => {
    FILED = [];
    const got = await get('/summary?period=week');
    assert.deepStrictEqual(got.rows, []);
  });

  await ok('CTR-205: by= also filters the WITHDRAWN arm in SQL (130 newer withdrawn by A do not crowd out the other person)', async () => {
    BILL_ROWS = [bill('WB', iso(1), 10, 'C1', B, true)];
    for (let i = 0; i < 130; i++) BILL_ROWS.push(bill('WA' + i, iso(100 + i), 10, 'C1', A, true));
    const got = await get('/bills?by=' + B + '&limit=100');
    assert.deepStrictEqual(got.withdrawn.map((r) => r.no), ['WB']);
  });
  await ok('CTR-195: a counter filed MID-DAY keeps its filed figure and folds the bills rung AFTER the filing (no under-read, no double)', async () => {
    const late = bill('L', '2026-11-12T18:58:00Z', 40, 'C1', A); /* after the 18:45Z filing */
    BILL_ROWS = [X, Y, late]; /* X (18:40Z) is inside the filing; Y (18:50Z) and late are after it */
    FILED = [Object.assign({ summarised_at: '2026-11-12T18:45:00Z' }, { period: 'day', key: '2026-11-13', till: { id: 'C1', name: 'Counter C1' }, totals: totalsOf(1, 500) })];
    const row = (await get('/summary?period=day')).rows[0];
    assert.strictEqual(row.totals.gross, 790); /* 500 filed + 250 + 40 */
    assert.strictEqual(row.totals.count, 3);
    assert.strictEqual(row.live, true);
  });
  await ok('CTR-195: a re-sent bill (same counter, same number) is folded once', async () => {
    FILED = [];
    const again = bill('X', '2026-11-12T18:41:00Z', 500, 'C1', A); /* the re-send of X, a second chit */
    again.chit_id = 'c-X-again';
    BILL_ROWS = [X, again, Y];
    const row = (await get('/summary?period=day')).rows[0];
    assert.strictEqual(row.totals.gross, 750);
    assert.strictEqual(row.totals.count, 2);
  });
  await ok('CTR-195: live_capped from the live arm alone - a full live arm plus an older withdrawn row is still capped', async () => {
    BILL_ROWS = [bill('OLDW', '2026-11-11T20:00:00Z', 5, 'C1', A, true)];
    for (let i = 0; i < 500; i++) BILL_ROWS.push(bill('T' + i, new Date(Date.parse('2026-11-12T18:35:00Z') + i * 1000).toISOString(), 1, 'C1', A));
    FILED = [];
    const got = await get('/summary?period=day');
    assert.strictEqual(got.live_capped, true);
    assert.strictEqual(got.rows[0].totals.count, 500);
  });
  await ok('CTR-209: west of UTC (Los Angeles): at 19:00 PST on the 12th an expiry of the 12th is "expires today", a sale at 17:00 PST is not quiet', async () => {
    ZONE = 'America/Los_Angeles'; clock.set('2026-11-13T03:00:00Z');
    OFFER_ROWS = [{ item_id: 'i1', name: 'Milk', expiry: '2026-11-12', last_sold: '2026-11-13T01:00:00Z' }];
    const got = await get('/worth-an-offer?quiet=1&days=3');
    assert.deepStrictEqual(got.items.map((i) => i.why), [['expires today']]);
    ZONE = 'Asia/Kolkata'; clock.set('2026-11-12T19:00:00Z');
  });
  await ok('CTR-209: /worth-an-offer reads days in the SHOP zone (expiry today -> "expires today"; sold 00:10 IST today -> not quiet)', async () => {
    OFFER_ROWS = [{ item_id: 'i1', name: 'Milk', expiry: '2026-11-13', last_sold: '2026-11-12T18:40:00Z' }];
    const got = await get('/worth-an-offer?quiet=1&days=3');
    assert.deepStrictEqual(got.items.map((i) => i.why), [['expires today']]);
  });
  console.log(n + ' passed');
  clock.reset();
  srv.close();
})().catch((e) => { console.error(e); process.exitCode = 1; setImmediate(() => process.exit(1)); });

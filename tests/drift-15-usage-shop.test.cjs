/**
 * drift-15-usage-shop.test.cjs — DRIFT 15 (PROOF-2026-11-27): GET /api/entities/usage read the asking PERSON's id, so an actor saw 0 where the owner saw 605.
 * lib/usage-read reads the SHOP for every seat; a seat the books refuse gets counts and no cost. Stand-in db: rows for shop S (3) and person P (1).
 * Run: node tests/drift-15-usage-shop.test.cjs
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const U = require('../lib/usage-read');
const SHOP = 'shop-1', PERSON = 'person-9';
const ROWS = [
  { entity_id: SHOP, meter: 'chit.send', quantity: 1, cost_usd: 0.002, events: 1, meta: { rate: 0.002 } },
  { entity_id: SHOP, meter: 'chit.send', quantity: 1, cost_usd: 0.002, meta: { rate: 0.002 } },
  { entity_id: SHOP, meter: 'ai.draft', quantity: 900, cost_usd: 0.05, meta: { rate: 0.05 } },
  { entity_id: PERSON, meter: 'chit.send', quantity: 1, cost_usd: 9, meta: {} }
];
const db = { query: async (sql, args) => {
  const mine = ROWS.filter((r) => r.entity_id === args[0]);
  if (/GROUP BY 1 ORDER BY 1/.test(sql)) return { rows: mine.length ? [{ day: '2026-11-28', events: mine.length, cost: mine.reduce((t, r) => t + r.cost_usd, 0) }] : [] };
  if (/GROUP BY 1/.test(sql)) { const by = {}; mine.forEach((r) => { const m = (by[r.meter] = by[r.meter] || { meter: r.meter, events: 0, quantity: 0, cost: 0 }); m.events++; m.quantity += r.quantity; m.cost += r.cost_usd; }); return { rows: Object.values(by) }; }
  return { rows: mine.map((r) => ({ meter: r.meter, detail: null, quantity: r.quantity, cost_usd: r.cost_usd, meta: r.meta, created_at: 'x' })) };
} };
(async () => {
  const owner = U.answerOf(await U.readUsage(db, SHOP, 30, false), 30, false);
  assert.strictEqual(owner.counts.billed, 3, 'the shop has 3 billed events, the person row never counts');
  assert.strictEqual(owner.total_cost_usd, 0.054, 'owner golden: the cost total is unchanged');
  const seat = U.answerOf(await U.readUsage(db, SHOP, 30, true), 30, true);
  assert.strictEqual(seat.counts.billed, 3, 'a refused seat reads the SAME count (it was 0)');
  assert.strictEqual(seat.cost_hidden, true);
  const flat = JSON.stringify(seat);
  assert(!/0\.05|0\.002|"rate"/.test(flat) && seat.total_cost_usd === null, 'no cost number survives anywhere: ' + flat);
  assert.deepStrictEqual(seat.by_meter.map((m) => m.meter), ['chit.send', 'ai.draft'], 'rows ordered by events, not by hidden cost');
  const person = await U.readUsage(db, PERSON, 30, false);
  assert.strictEqual(person.by_meter.length, 1, 'reading as the person would give the person row only (the old bug)');
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'entities.js'), 'utf8');
  const h = route.slice(route.indexOf("router.get('/usage'"), route.indexOf("router.get('/usage'") + 2000);
  assert(/auth\.entityOf\(req\)/.test(h) && !/req\.identity\.identity_id/.test(h), 'the route reads the shop, never the identity id');
  console.log('  ok  drift-15-usage-shop: 7 checks');
})().catch((e) => { console.log('  FAIL', e.message); process.exit(1); });

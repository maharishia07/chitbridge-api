/**
 * tax-shop-day.test.js — M3 (CTRY-53/54/84/85, Athi 12 Nov 2026): a slab's effective_from is judged on the SHOP'S day, not the UTC day.
 * The shop is in Mumbai; the frozen moment is 2026-11-12T19:00Z = 13 Nov 00:30 IST (hand-checked: 19:00 + 5:30 = 24:30). A slab starting 2026-11-13
 * is therefore IN FORCE for that shop (pending false); the UTC reading (12 Nov) said "not yet". A shop in a zone behind UTC (Chicago, 13:00 on
 * 12 Nov) still sees it pending. The three callers (tax-lines.resolveItem, catalogue-view, routes/catalogue) take the zone from the shelf the
 * one reader (tax-shelf) builds; here the shelf is built by shelfFromRows so no database is needed.
 * Run: node --test tests/tax-shop-day.test.js
 */
'use strict';
process.env.SHOP_CLOCK_ALLOW = '1';
const test = require('node:test');
const assert = require('node:assert');
const clock = require('../lib/shop-clock');
const shelfOf = require('../lib/tax-shelf').shelfFromRows;
const lines = require('../lib/tax-lines');

const defs = { rows: [{ definition_id: 's18', kind: 'tax', name: 'GST 18% (new)', rules: { rate: 18, effective_from: '2026-11-13' } }] };
const shelf = (zone) => shelfOf({ defs, items: { rows: [] }, gstn: '27AAPFU0939F1ZV', zone, face: {}, gov: [] });
const item = { tax_slab: 's18' };

test('the shelf carries the shop\'s own zone', () => {
  assert.deepStrictEqual(shelf({ country: 'IN', timezone: 'Asia/Kolkata' }).zone, { country: 'IN', timezone: 'Asia/Kolkata' });
});

test('12 Nov 19:00Z: a Mumbai shop is on 13 Nov, so a slab effective 13 Nov is in force (pending false)', () => {
  clock.set('2026-11-12T19:00:00Z');
  try {
    const r = lines.resolveItem(item, shelf({ country: 'IN', timezone: 'Asia/Kolkata' }));
    assert.strictEqual(r.rate, 18);
    assert.strictEqual(r.pending, false, 'the shop day is 2026-11-13');
  } finally { clock.reset(); }
});

test('the same moment for a Chicago shop (13:00 on 12 Nov): the slab is still pending', () => {
  clock.set('2026-11-12T19:00:00Z');
  try {
    assert.strictEqual(lines.resolveItem(item, shelf({ country: 'US', timezone: 'America/Chicago' })).pending, true);
  } finally { clock.reset(); }
});

test('the adopted country table (engines v1.88.0) shows the menu in force for India, not the first-written list', () => {
  const row = require('../lib/country').rulesTable().rules.find((r) => r.key === 'rates');
  assert.strictEqual(row.values.IN, '0% · 0.25% · 1.5% · 3% · 5% · 18% · 40%');
});

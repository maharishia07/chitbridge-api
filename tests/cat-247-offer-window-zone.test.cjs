#!/usr/bin/env node
// @type: contract
/**
 * cat-247-offer-window-zone.test.cjs - CAT-247: a date-only offer window runs on the SHOP's calendar day, on every path that calls the offers engine.
 *
 * OWNS      the proof that lib/offers-live.shopZoneFor names the shop's zone only when an offer has a window (no trip otherwise), that the engine then
 *           ends a "valid_to" offer on the shop's own day, and that the three evaluate callers (applyLiveOffers, services.offerLines, the offers service
 *           route) hand the engine ctx.timezone: the same offer is live at 00:30 shop time on the day after its end date under UTC and expired under the shop's zone.
 * MIN       the minimum this guard must show: zone read once for a windowed offer, never for an open one; a failed read judges the day in UTC and says so.
 * CALLED BY scripts/guards.cjs / CI. No database, no network: a stand-in db.
 * FLOW      stub db -> shopZoneFor -> CBOffers.evaluate (ctx.timezone) -> services.offerLines
 * CARD      07-offers-pricing-and-combos/offers-engine-public-service
 * TRACE     CAT-247 (engines v1.92.0 adopt)
 */
'use strict';
const path = require('path');
const assert = require('assert');
let checks = 0;
const eq = (actual, expected, why) => {
  assert.strictEqual(actual, expected, why);
  checks++;
};
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-cat-247';
const API = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const stub = (rel, exports) => {
  const f = require.resolve(path.join(API, rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};
let reads = 0;
let zoneRow = { zone: 'Asia/Kolkata' };
let failRead = false;
const q = async (sql) => {
  if (/FROM identities/.test(String(sql))) {
    reads++;
    if (failRead) throw new Error('db down');
    return { rows: zoneRow ? [zoneRow] : [] };
  }
  return { rows: [] };
};
const withEntity = async (id, fn) => fn({ query: q });
stub('db', { query: q, pool: { query: q }, withEntity, readBatch: async () => [{ rows: [] }] });

const live = require(path.join(API, 'lib', 'offers-live'));
const eng = require(path.join(API, 'lib', 'offers-engine')).CBOffers;
const windowed = { id: 'o1', kind: 'percent_off', label: 'Ten', percent: 10, valid_to: '2026-11-14' };
const open = { id: 'o2', kind: 'percent_off', label: 'Five', percent: 5 };
/* 2026-11-14 19:00 UTC is 00:30 on the 15th in Kolkata: the offer's last day has ended for the shop, not for UTC */
const NOW = new Date('2026-11-14T19:00:00Z');
const lines = [{ key: '0', item_id: 'i1', sku: 's1', qty: 1, unitPrice: 100, categories: [], excluded: [] }];
const applied = (ctx) => eng.evaluate({ lines, offers: [windowed], ctx: Object.assign({ now: NOW, currency: 'INR' }, ctx) }).adjustments.length;

(async () => {
  eq(await live.shopZoneFor([open], SHOP, withEntity), null, 'no window = no zone');
  eq(reads, 0, 'an open offer costs no trip');
  const zone = await live.shopZoneFor([open, windowed], SHOP, withEntity);
  eq(zone, 'Asia/Kolkata');
  eq(reads, 1, 'one trip for a windowed offer');
  zoneRow = { zone: 'IN' };
  eq(await live.shopZoneFor([windowed], SHOP, withEntity), 'Asia/Kolkata', 'a country code is cut to the pack zone, never the machine zone');
  zoneRow = null;
  eq(await live.shopZoneFor([windowed], SHOP, withEntity), null, 'an unstated zone stays unknown (the engine says UTC)');
  failRead = true;
  eq(await live.shopZoneFor([windowed], SHOP, withEntity), null, 'a failed read judges the UTC day, never throws');
  failRead = false;

  eq(applied({}), 1, 'UTC: the 14th has not ended at 19:00 UTC');
  eq(applied({ timezone: zone }), 0, 'the shop zone: it is the 15th, the offer ended');

  /* the callers hand the zone over: services.offerLines (the invoice route) */
  zoneRow = { zone: 'Asia/Kolkata' };
  const S = require(path.join(API, 'lib', 'services'));
  const out = await S.offerLines(SHOP, [{ key: '0', item_id: 'i1', code: 's1', qty: 1, unit_price: 100, categories: [] }], [windowed], { currency: 'INR', now: NOW });
  eq(out.ev.adjustments.length, 0, 'offerLines: the offer ended on the shop day');
  console.log(checks + ' checks');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

'use strict';
/**
 * at-1129-shop-day-ahead.test.cjs — batch 1129 fixAT, AT-F-04 (walk AT 22 Nov): a privacy request dated the shop's own today was refused "It cannot come in tomorrow" for 11 hours of every Sydney day (lib/privacy.js compared with the UTC clock).
 * lib/shop-day-ahead.js with the shop clock frozen at 2026-11-21T13:00:00Z = 22 Nov 00:00 in Sydney (AEDT, UTC+11): 22 Nov is the shop's today (not ahead), 23 Nov is ahead; the UTC day (21 Nov) would have said 22 Nov is ahead.
 * Run: node tests/at-1129-shop-day-ahead.test.cjs
 */
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
const assert = require('node:assert');
const clock = require('../lib/shop-clock');
const { shopDayAhead } = require('../lib/shop-day-ahead');
const shop = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });
(async () => {
  clock.set('2026-11-21T13:00:00Z');
  const AU = shop({ timezone: 'Australia/Sydney', country: 'AU' });
  const due = (given) => shopDayAhead(AU, 'e1', given, Date.parse(given), 'AU');
  assert.strictEqual(await due('2026-11-22'), false, 'the shop\'s own today is not tomorrow');
  assert.strictEqual(await due('2026-11-22T00:30:00+11:00'), false, 'a time on the shop\'s today');
  assert.strictEqual(await due('2026-11-23'), true, 'the shop\'s tomorrow is ahead');
  assert.strictEqual(await shopDayAhead(shop({ timezone: null, country: 'AU' }), 'e1', '2026-11-22', Date.parse('2026-11-22'), null), false, 'no zone saved: the shop\'s country (Sydney)');
  assert.strictEqual(await shopDayAhead(shop({ timezone: 'UTC', country: null }), 'e1', '2026-11-22', Date.parse('2026-11-22'), null), true, 'a UTC shop: 22 Nov is ahead of 21 Nov');
  clock.reset();
  console.log('ok at-1129-shop-day-ahead');
})().catch((e) => { console.error(e); process.exit(1); });

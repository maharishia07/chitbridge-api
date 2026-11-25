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
(async () => {
  clock.set('2026-11-21T13:00:00Z');
  const due = (given) => shopDayAhead({ country: 'AU' }, given, Date.parse(given), 'AU');
  assert.strictEqual(await due('2026-11-22'), false, 'the shop\'s own today is not tomorrow');
  assert.strictEqual(await due('2026-11-22T00:30:00+11:00'), false, 'a time on the shop\'s today');
  assert.strictEqual(await due('2026-11-23'), true, 'the shop\'s tomorrow is ahead');
  assert.strictEqual(await shopDayAhead({ country: null }, '2026-11-22', Date.parse('2026-11-22'), 'AU'), false, 'the shop states no country: the request country (Sydney)');
  assert.strictEqual(await shopDayAhead({ country: null }, '2026-11-22', Date.parse('2026-11-22'), null), true, 'no country anywhere: UTC, 22 Nov is ahead of 21 Nov');
  /* the words of an ended grant (lib/books-grant endedWords): revoked 2026-11-21T14:00:00Z = 22 Nov 01:00 in Sydney, said as 22 November (was: the UTC day, 21 November) */
  const grants = require('../lib/books-grant');
  const transaction = { query: async () => ({ rows: [{ id: 'g1', display_name: 'Shop A', timezone: 'Australia/Sydney', country: 'AU' }] }) };
  const said = await grants.endedWords(transaction, { grantor_entity: 'g1', revoked_by: 'g1', revoked_at: '2026-11-21T14:00:00.000Z' });
  assert.match(said, /ended by the owner of the books on 22 November 2026/, said);
  const plain = await grants.endedWords({ query: async () => ({ rows: [{ id: 'g1', display_name: 'Shop B', timezone: null, country: null }] }) }, { grantor_entity: 'g1', revoked_by: 'g1', revoked_at: '2026-11-21T14:00:00.000Z' });
  assert.match(plain, /on 21 November 2026/, 'no zone: UTC, as before');
  clock.reset();
  console.log('ok at-1129-shop-day-ahead');
})().catch((e) => { console.error(e); process.exit(1); });

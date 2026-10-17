/**
 * till-trend.test.cjs — GET /api/till/summary?compare=1 (RPT2): Reports › Trend, ONE comparison calculation (rollup.series), one trip.
 *
 * Offline: the real routes/till.js and lib/till-summary over a stand-in db. Held here:
 *   · the answer is { period, n, currency, fy_start_month, slots } and slots are rollup.series' own (newest last, minor units)
 *   · the shop's year is its own: books_setting, else Country setup, else the pack — AU starts in July, never April by default
 *   · a quarter and a year are folded from MONTHS (3 · 12), a slot with no record is null (never 0), a short year says so
 *   · no country → 422 NO_COUNTRY; a country but no money/year → 422 NO_MONEY; a period that is not a tab → 400
 *   · one trip (readBatch) for every tab; without compare=1 the old answer is unchanged
 *
 * Run: node tests/till-trend.test.cjs
 */
'use strict';
const { S, sumRow, daysOf, monthsBack, start, API } = require('./support/till-trend-stub.cjs');   /* the stubbed db + auth, and the real router */
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(84) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
(async () => {
  const srv = start(), g = srv.get;
  const R = require(API + '/lib/rollup');
  console.log('\n-- RPT2 Reports › Trend --\n');

  S.shop = { country: null, currency_code: null, books: null, gov: null };
  let r = await g('compare=1&period=month');
  t('no country stated -> 422 NO_COUNTRY with the one sentence (no year guessed)', [r.status, r.json.code, typeof r.json.error], [422, 'NO_COUNTRY', 'string']);
  S.shop = { country: 'ZZ', currency_code: null, books: null, gov: null };
  r = await g('compare=1&period=month');
  t('a country with no pack and no money or year -> 422 NO_MONEY', [r.status, r.json.code], [422, 'NO_MONEY']);
  S.shop = { country: 'AU', currency_code: 'AUD', books: null, gov: null };
  r = await g('compare=1&period=fortnight');
  t('a period that is not a Trend tab -> 400 BAD_PERIOD', [r.status, r.json.code], [400, 'BAD_PERIOD']);

  /* months: the last 12 closed months, each with last year's */
  for (let k = 1; k <= 24; k++) S.rows.month.push(sumRow('month', monthsBack(k), k <= 12 ? 1100 : 1000, daysOf(monthsBack(k))));
  r = await g('compare=1&period=month');
  t('months: 200, 12 slots, the shop\'s money and its own year (AU → July, from the pack)', [r.status, r.json.slots.length, r.json.currency, r.json.fy_start_month], [200, 12, 'AUD', 7]);
  const want = R.series('month', 12, S.rows.month.map((x) => x.business_json.summary), { fyStart: 7, currency: 'AUD', now: Date.now() });
  t('months: the slots ARE rollup.series\' (one calculation, nothing added by the route)', r.json.slots, want);
  t('months: the running month has no record -> null (never 0) and no change', [r.json.slots[11].gross_minor, r.json.slots[11].change_pct], [null, null]);
  t('months: a closed whole month vs last year -> +10% from minor units', [r.json.slots[10].gross_minor, r.json.slots[10].last_year.gross_minor, r.json.slots[10].change_pct], [110000, 100000, 10]);
  t('months: one trip (readBatch: the shop\'s year + the summaries)', r.trips, 1);

  S.shop = { country: 'AU', currency_code: 'AUD', books: { fy_start_month: 4, functional_currency: 'AUD' }, gov: null };
  r = await g('compare=1&period=year&n=3');
  t('the books\' own start month wins over the pack (books_setting.fy_start_month)', r.json.fy_start_month, 4);
  t('years: folded from months, n=3 slots, one trip', [r.json.slots.length, r.trips], [3, 1]);
  S.shop = { country: 'IN', currency_code: 'INR', books: null, gov: { fy_start_month: 1 } };
  r = await g('compare=1&period=quarter&n=8');
  t('quarters: Country setup\'s start month (1 → calendar quarters), 8 slots', [r.json.fy_start_month, r.json.slots.length, /^\d{4}-Q[1-4]$/.test(r.json.slots[0].key)], [1, 8, true]);
  r = await g('compare=1&period=week');
  t('weeks: 52 by default, ISO keys, one trip', [r.json.slots.length, /^\d{4}-W\d{2}$/.test(r.json.slots[51].key), r.trips], [52, true, 1]);
  r = await g('compare=1&period=year&n=99');
  t('n is clamped (years ≤ 10)', r.json.slots.length, 10);

  r = await g('period=month&limit=3');
  t('without compare=1 the answer is the old one ({ period, rows, counters })', [r.status, Object.keys(r.json), r.json.rows.length], [200, ['period', 'rows', 'counters'], 3]);

  srv.stop();
  console.log('\n  ' + pass + ' checks · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

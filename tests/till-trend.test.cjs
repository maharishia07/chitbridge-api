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
const path = require('path');
const http = require('http');
const express = require('express');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(84) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const mock = (rel, exports) => { require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports }; };

mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity' }; next(); }, {
  entityOf: (req) => (req.identity && req.identity.identity_id) || null,
  requireScope: () => (req, res, next) => next(),
}));

/* ── the stand-in database: summaries by period, the shop's year row ── */
const S = { shop: null, rows: { week: [], month: [], year: [] } };
let trips = 0;
const sumRow = (period, key, gross, source) => ({ chit_id: period + key, created_at: new Date(), business_json: { summary: {
  period, key, till: { id: 'C1' }, source: source || undefined,
  totals: { count: 4, returns: 0, gross, refunds: 0, expenseCount: 0, expenses: 0, total: gross - 10, by: {} } } } });
function answer(text, params) {
  const sql = String(text);
  if (/AS gov\b/.test(sql)) return { rows: S.shop ? [S.shop] : [] };
  if (/FROM chit_header h/.test(sql)) return { rows: (S.rows[params[1]] || []).slice().sort((a, b) => (a.business_json.summary.key < b.business_json.summary.key ? 1 : -1)) };
  return { rows: [] };
}
mock('/db', {
  query: async (s, p) => { trips++; return answer(s, p); },
  withEntity: async (_id, fn) => { trips++; return fn({ query: async (s, p) => answer(s, p) }); },
  withTransaction: async (fn) => { trips++; return fn({ query: async (s, p) => answer(s, p) }); },
  readBatch: async (_e, _a, stmts) => { trips++; return stmts.map((s) => answer(s.text, s.params)); },
  trySavepoint: async (h, fn, fb) => { try { return await fn(h); } catch (_) { return fb; } },
});

const get = (port, p) => new Promise((ok) => {
  trips = 0;
  http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => { const body = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(body); } catch (_) {} ok({ status: res.statusCode, json, trips }); });
  });
});

/** a full month's day keys (the coverage rule: a month is whole when every day of it sent a summary) */
const daysOf = (m) => { const [y, mo] = m.split('-').map(Number); const n = new Date(Date.UTC(y, mo, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => m + '-' + String(i + 1).padStart(2, '0')); };
const monthsBack = (k) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); };

(async () => {
  const app = express();
  app.use('/api/till', require(API + '/routes/till'));
  const srv = app.listen(0); const port = srv.address().port;
  const g = (q) => get(port, '/api/till/summary?' + q);
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

  srv.close();
  console.log('\n  ' + pass + ' checks · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';
const { shopToday, shopDayAt } = require('./lib/shop-day.cjs'); /* the shop's own day, never the UTC day (tzsweep) */
/**
 * tests/books-mis.realstack.cjs — MIS A3/A4 on a REAL Postgres, through the REAL routes/books.js (only the sign-in is a stand-in): GET /overview against the pages each figure comes from, and its speed for ONE shop.
 * Run on a THROWAWAY migrated database, as the app role: DATABASE_URL=postgres://cb_app:x@mis2-pg/postgres YEARS=1|7 RUNS=60 node tests/books-mis.realstack.cjs
 * One AU shop (July year), YEARS of days: a cash day-summary every day, a credit sale to one of 30 customers every 3rd day, a supplier bill every 7th day, a payment every 11th. Without DATABASE_URL it says so and exits 0 (not part of the offline guard).
 * Equality (real SQL): sales = the sum of the Day book's SOLD the page reads (soldTotals); income · expenses · profit = GET /pl; to collect · to pay = GET /dues; cash = GET /cashflow?days=30. Speed: p50 / p95 of the one call, trips from X-DB-Trips.
 */
if (!process.env.DATABASE_URL) { console.log('skipped: needs DATABASE_URL (cb_app on a throwaway migrated database)'); process.exit(0); }
if (!/mis2-pg|127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL) || /sit-au/.test(process.env.DATABASE_URL)) { console.error('REFUSED: only the throwaway mis2-pg or a local database'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.CB_TRIPS = '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'books_mis_test_secret_at_least_32_chars_padding';
const path = require('path'), crypto = require('crypto'), express = require('express');
const API = path.join(__dirname, '..');
const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const { query, withEntity } = require(path.join(API, 'db'));
const fakeAuth = (req, res, next) => { if (req.identity) return next(); try { req.identity = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); } return next(); };
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
const net = require(path.join(API, 'src', 'services', 'network'));
const YEARS = Number(process.env.YEARS || 1), RUNS = Number(process.env.RUNS || 60);
let pass = 0, fail = 0, base = '';
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 600) : '')); } };
const pct = (list, p) => list.slice().sort((a, b) => a - b)[Math.min(list.length - 1, Math.ceil((p / 100) * list.length) - 1)];
async function call(who, route) {
  const res = await fetch(base + route, { headers: { 'x-test-as': JSON.stringify(who) } });
  let body = null; try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body, trips: res.headers.get('x-db-trips') };
}
const dayAt = (daysAgo) => shopDayAt(-daysAgo); /* the shop's day, not the UTC one */
(async () => {
  const RUN = 'mis' + (Date.now() % 1e9).toString(36).padStart(6, '0');
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'AU', 'AUD', $3) RETURNING identity_id`, ['CB' + RUN, 'MIS rig ' + RUN, 'u' + RUN]);
  const SHOP = identity.identity_id, owner = { identity_id: SHOP, bridge_id: 'CB' + RUN, identity_type: 'entity', parent_entity_id: null, display_name: 'rig' };
  await net.nodeOf(SHOP, { ensure: true });
  await withEntity(SHOP, (c) => require(path.join(API, 'lib', 'country-setup.js')).save(c, SHOP, { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: '51824753556', scheme: 'regular' }, source: { tax: 'typed' } }));
  const app = express(); app.use(require(path.join(API, 'lib', 'trips')).middleware()); app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  const B = require(path.join(API, 'lib', 'books'));
  try {
    const on = await fetch(base + '/api/books/enable', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-as': JSON.stringify(owner) }, body: '{}' });
    ok('the rig shop switches its ledger on', on.status === 200, await on.text());
    const customers = Array.from({ length: 30 }, () => crypto.randomUUID()), supplier = crypto.randomUUID();
    const days = Math.round(365 * YEARS), t0 = Date.now(); let n = 0;
    for (let ago = days; ago >= 0; ago--) {
      const date = dayAt(ago), tag = String(ago);
      await B.postEntry(null, SHOP, { type: 'walkin_day', ref: 'D' + tag, date, currency: 'AUD', modes: { cash: 1100 }, by_rate: [{ rate: 10, taxable: 1000, gst: 100 }] }); n++;
      if (ago % 3 === 0) { await B.postEntry(null, SHOP, { type: 'sale_bill', ref: 'S' + tag, date, currency: 'AUD', party: customers[ago % 30], source_ref: 'rig:s' + tag, by_rate: [{ rate: 10, taxable: 5000, gst: 500 }], paid: {}, round_off: 0 }); n++; }
      if (ago % 7 === 0) { await B.postEntry(null, SHOP, { type: 'purchase_bill', ref: 'P' + tag, date, currency: 'AUD', party: supplier, source_ref: 'rig:p' + tag, by_rate: [{ rate: 10, taxable: 3000, gst: 300 }], paid: {}, round_off: 0 }); n++; }
    }
    console.log('  seeded ' + n + ' entries over ' + days + ' days in ' + Math.round((Date.now() - t0) / 1000) + ' s');
    const pl = (await call(owner, '/api/books/pl?preset=ytd')).body, dues = (await call(owner, '/api/books/dues')).body, cash = (await call(owner, '/api/books/cashflow?days=30')).body;
    const first = await call(owner, '/api/books/overview?period=ytd'), o = first.body;
    ok('the overview answers 200', first.status === 200 && o && o.sales, JSON.stringify(first.body).slice(0, 300));
    ok('income · expenses · profit equal GET /pl (real SQL)', o.income.minor === pl.total_income_minor && o.expenses.minor === pl.total_expense_minor && o.profit.minor === pl.profit_minor, JSON.stringify([o.income, pl.total_income_minor]));
    ok('gross equals /pl gross_profit', JSON.stringify(o.gross) === JSON.stringify(pl.gross_profit));
    const sum = (rows, side) => rows.filter((r) => (side === 'supplier') === (r.side === 'supplier')).reduce((t, r) => t + r.balance_minor, 0);
    ok('to collect equals the /dues customer total; to pay the supplier total, unsigned', o.to_collect.minor === sum(dues.parties, 'customer') && o.to_pay.minor === -sum(dues.parties, 'supplier'), JSON.stringify([o.to_collect, o.to_pay, dues.total_minor]));
    ok('cash ahead equals /cashflow?days=30', o.cash && o.cash.words === cash.words && JSON.stringify(o.cash.lowest) === JSON.stringify(cash.lowest) && o.cash.closing_minor === cash.closing_minor);
    ok('twelve bars and twelve months', o.bars.length === 12 && o.profit_by_month.length === 12);
    const salesYear = await withEntity(SHOP, (h) => require(path.join(API, 'lib', 'books-store')).soldTotals(h, SHOP, [{ from: o.period.from, to: o.period.to }]));
    ok('sales equals soldTotals over the range', o.sales.minor === salesYear[0].sold.minor && o.sales.minor > 0, JSON.stringify([o.sales, salesYear[0].sold]));
    for (const word of ['week', 'mtd', 'quarter']) { const r = await call(owner, '/api/books/overview?period=' + word); ok(word + ' answers 200', r.status === 200 && r.body.period.word === word, JSON.stringify(r.body).slice(0, 200)); }
    ok('an unknown period is 400', (await call(owner, '/api/books/overview?period=month')).status === 400);
    const ms = [], trips = [];
    for (let i = 0; i < 5; i++) await call(owner, '/api/books/overview?period=ytd');
    for (let i = 0; i < RUNS; i++) { const t = process.hrtime.bigint(); const r = await call(owner, '/api/books/overview?period=ytd'); ms.push(Number(process.hrtime.bigint() - t) / 1e6); trips.push(Number(r.trips)); }
    console.log('  SPEED ' + YEARS + ' year(s), ' + n + ' entries: overview ytd p50 ' + pct(ms, 50).toFixed(1) + ' ms · p95 ' + pct(ms, 95).toFixed(1) + ' ms · max ' + Math.max(...ms).toFixed(1) + ' ms · trips ' + pct(trips, 50));
    for (const [name, route] of [['GET /pl', '/api/books/pl?preset=ytd'], ['GET /dues', '/api/books/dues'], ['GET /cashflow 30', '/api/books/cashflow?days=30']]) {
      const m = []; for (let i = 0; i < 20; i++) { const t = process.hrtime.bigint(); await call(owner, route); m.push(Number(process.hrtime.bigint() - t) / 1e6); }
      console.log('  SPEED (for scale) ' + name + ' p50 ' + pct(m, 50).toFixed(1) + ' ms · p95 ' + pct(m, 95).toFixed(1) + ' ms');
    }
    ok('p95 for one shop is under 1 s', pct(ms, 95) < 1000, pct(ms, 95));
  } finally { server.close(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((err) => { console.log('ERROR ' + (err && err.stack)); process.exit(1); });

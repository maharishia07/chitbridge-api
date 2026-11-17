'use strict';
/**
 * tests/books-tb-compare.realstack.cjs — LEADER-COMPARE #2 on a REAL Postgres: the trial balance read at TWO days (this as-at day and the same day one year earlier) through the real
 * routes (GET /trial-balance, GET /bs) over real SQL, and what the extra read costs.
 *   1 · the offline test's hand fixture (3 sales, AUD) on real rows: cash +2,805,000 vs +1,100,000 · sales -1,550,000 vs -1,000,000 · GST -255,000 vs -100,000, the same flags
 *   2 · SEVEN YEARS of daily takings (1 Jul 2019 → 16 Nov 2026) for a second shop: the trial balance with last year beside it, timed (p50 / p95 of N reads) beside the same read with no comparison
 *       (the route's old shape: ?compare is not asked, so the 7-year timing of the prior read alone is the second figure) and the statements per request (the round-trip line)
 * Run on a throwaway migrated Postgres (tools/migrate.cjs): DATABASE_URL=postgres://postgres:x@host/db node tests/books-tb-compare.realstack.cjs
 * Without DATABASE_URL it says so and exits 0 (not part of the offline guard). The superuser reads: RLS is not what is tested; the SQL is the text the app runs.
 * No code, token or password is printed. LOCAL / SIT-THROWAWAY ONLY.
 */
if (!process.env.DATABASE_URL) { console.log('skipped: needs DATABASE_URL (a throwaway migrated database)'); process.exit(0); }
process.env.NODE_ENV = 'test';
const path = require('path'), http = require('http'), crypto = require('crypto');
const express = require('express');
const { Client } = require('pg');
const AUTH = path.join(__dirname, '..', 'middleware', 'auth');
let WHO = null;
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: WHO, identity_type: 'entity', display_name: 'Rig shop' }; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
require.cache[require.resolve(AUTH)] = { id: AUTH, filename: AUTH, loaded: true, exports: authStub };
const pg = require('pg'), realQuery = pg.Client.prototype.query;
let statements = 0;
pg.Client.prototype.query = function () { statements++; return realQuery.apply(this, arguments); };
const B = require('../lib/books'), S = require('../lib/books-store'), CLOCK = require('../lib/shop-clock'), DB = require('../db');
const BASE = process.env.TB_BASE === '1';
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const get = (port, p) => new Promise((done) => { http.get({ host: '127.0.0.1', port, path: p }, (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j, trips: Number(res.headers['x-db-trips']) || 0 }); }); }); });
const setDay = (day) => CLOCK.set(day + 'T02:00:00Z');
const pct = (list, p) => list.slice().sort((a, b) => a - b)[Math.min(list.length - 1, Math.ceil((p / 100) * list.length) - 1)];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const shops = [];
  const newShop = async (label, enabledOn) => {
    const id = crypto.randomUUID();
    await c.query("INSERT INTO identities (identity_id, bridge_id, identity_type, display_name, country, currency_code, timezone, gstn, policy_flags) VALUES ($1, $4, 'entity', $2, 'AU', 'AUD', 'Australia/Sydney', '51824753556', $3)", [id, label, JSON.stringify({ gst_registration: 'regular' }), 'TB' + id.slice(0, 8)]).catch(async (err) => { throw new Error('identity seed: ' + err.message); });
    await c.query("INSERT INTO entity_governance (entity_id, constitution_key, installation_key, fy_start_month, setup_source, tax_registration, country_setup_at) VALUES ($1, 'base', 'platform-0', 7, '{}'::jsonb, $2::jsonb, now()) ON CONFLICT (entity_id) DO UPDATE SET fy_start_month = 7, tax_registration = EXCLUDED.tax_registration, country_setup_at = now()", [id, JSON.stringify({ registered: true, number: '51824753556', scheme: 'regular' })]); /* the Country setup step, done */
    shops.push(id); setDay(enabledOn);
    await S.saveSetting(c, id, { enabled: false, country: 'AU', fy_start_month: 7, functional_currency: 'AUD' });
    await DB.withEntity(id, (h) => B.enable(h, id, { country: 'AU', currency: 'AUD', fy_start_month: 7, today: enabledOn }));
    await c.query('UPDATE books_setting SET enabled_at = $2 WHERE entity_id = $1', [id, enabledOn + 'T02:00:00Z']);
    return id;
  };
  const sale = async (id, date, taxable, gst, ref) => { setDay(date); const r = await DB.withEntity(id, (h) => B.postEntry(h, id, { type: 'walkin_day', ref, date, currency: 'AUD', modes: { cash: taxable + gst }, by_rate: [{ rate: 10, taxable, gst }] })); if (!r || r.ok === false) throw new Error('post ' + ref + ' ' + JSON.stringify(r)); };
  const app = express(); app.use(require('../lib/trips').middleware()); app.use(express.json()); app.use('/api/books', require('../routes/books'));
  const srv = app.listen(0), port = srv.address().port;
  try {
    /* 1 · the hand fixture on real rows (TB_BASE=1: the code BEFORE this change is being timed, so only section 2 runs) */
    if (!BASE) {
    const A = await newShop('TB compare hand', '2025-07-02');
    await sale(A, '2025-08-10', 10000, 1000, 'T1'); await sale(A, '2026-08-10', 15000, 1500, 'T2'); await sale(A, '2026-09-05', 500, 50, 'T3');
    setDay('2026-11-16'); WHO = A;
    const tb = await get(port, '/api/books/trial-balance?asOf=2026-11-16');
    const by = (name) => (tb.body.rows || []).find((r) => new RegExp(name, 'i').test(r.name));
    const cash = by('cash'), sales = by('sales'), gst = by('gst|tax');
    console.log('   body', JSON.stringify(tb.body).slice(0, 300)); ok('GET /trial-balance 200 on real rows, compare names 2025-11-16', tb.status === 200 && tb.body.compare && tb.body.compare.as_at === '2025-11-16', JSON.stringify([tb.status, tb.body.compare]));
    eq('hand: cash +2,805,000 vs +1,100,000 → +1,705,000, +15500 bp, over', cash && [cash.net_minor, cash.prior_net_minor, cash.change_minor, cash.change_bp, cash.change_over], [2805000, 1100000, 1705000, 15500, true]);
    eq('hand: sales -1,550,000 vs -1,000,000 → -550,000, -5500 bp, over', sales && [sales.net_minor, sales.prior_net_minor, sales.change_minor, sales.change_bp, sales.change_over], [-1550000, -1000000, -550000, -5500, true]);
    eq('hand: GST -255,000 vs -100,000 → -155,000, -15500 bp, over', gst && [gst.net_minor, gst.prior_net_minor, gst.change_minor, gst.change_bp, gst.change_over], [-255000, -100000, -155000, -15500, true]);
    const bs = await get(port, '/api/books/bs?asOf=2026-11-16');
    const bsCash = (bs.body.assets || []).find((x) => x.prior_year_minor === 1100000);
    eq('BS: cash 2,805,000 vs 1,100,000 → +1,705,000, over', bsCash && [bsCash.amount_minor, bsCash.change_minor, bsCash.change_bp, bsCash.change_over], [2805000, 1705000, 15500, true]);
    const first = await get(port, '/api/books/trial-balance?asOf=2025-11-16');
    ok('the first year of the books: last year held nothing → compare null, no change on any row', first.status === 200 && first.body.compare === null && first.body.rows.every((r) => !('change_minor' in r)));
    const early = await get(port, '/api/books/trial-balance?asOf=2024-01-01');
    ok('a day long before the books began is answered (no 500) with no comparison', early.status === 200 && early.body.compare === null, JSON.stringify([early.status, early.body.compare]));

    }
    /* 2 · seven years */
    const Z = await newShop('TB compare 7y', '2019-07-02'); WHO = Z;
    const t0 = Date.now(); let n = 0;
    for (let d = Date.UTC(2019, 6, 3); d <= Date.UTC(2026, 10, 16); d += 86400000) {
      const date = new Date(d).toISOString().slice(0, 10), base = 800 + (n * 37) % 900;
      await sale(Z, date, base, Math.round(base / 10), 'D' + n); n++;
    }
    console.log('   seeded ' + n + ' days (7 years + 4.5 months) in ' + Math.round((Date.now() - t0) / 1000) + ' s');
    setDay('2026-11-16');
    const timed = async (p, reps) => { let trips = 0; const ms = [], st = []; for (let i = 0; i < reps; i++) { const s0 = statements, t = Date.now(); const r = await get(port, p); ms.push(Date.now() - t); st.push(statements - s0); trips = r.trips; if (r.status !== 200) throw new Error(p + ' ' + r.status); } return { p50: pct(ms, 50), p95: pct(ms, 95), max: Math.max(...ms), stmts: st[st.length - 1], trips }; };
    await get(port, '/api/books/trial-balance?asOf=2026-11-16'); /* warm */
    const withPrior = await timed('/api/books/trial-balance?asOf=2026-11-16', 20);
    console.log('   TB with last year at 7 years: p50 ' + withPrior.p50 + ' ms · p95 ' + withPrior.p95 + ' ms · max ' + withPrior.max + ' ms · ' + withPrior.stmts + ' statements on the wire · ' + withPrior.trips + ' trips (X-DB-Trips) per request');
    const bsT = await timed('/api/books/bs?asOf=2026-11-16', 20);
    console.log('   BS (already read month + year before this change) at 7 years: p50 ' + bsT.p50 + ' ms · p95 ' + bsT.p95 + ' ms · ' + bsT.stmts + ' statements · ' + bsT.trips + ' trips');
    const z = await get(port, '/api/books/trial-balance?asOf=2026-11-16');
    if (!BASE) ok('7 years: compare read, the totals balance, every row carries net · prior · change · flag', z.body.compare && z.body.balanced && z.body.rows.every((r) => 'prior_net_minor' in r && 'change_over' in r));
    ok('7 years: the trial balance with last year answers inside 1,500 ms at p95 (the page budget)', withPrior.p95 <= 1500, 'p95 ' + withPrior.p95);
  } finally {
    srv.close();
    for (const id of shops) {
      for (const t of ['journal_line', 'journal_entry', 'account_balance', 'ledger_account', 'books_setting', 'entity_governance']) await c.query('DELETE FROM ' + t + ' WHERE entity_id = $1', [id]).catch(() => {});
      await c.query('DELETE FROM identities WHERE identity_id = $1', [id]).catch(() => {});
    }
    await c.end(); await DB.pool?.end?.().catch?.(() => {});
  }
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL run: ' + e.message); process.exit(1); });

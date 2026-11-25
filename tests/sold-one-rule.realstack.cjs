'use strict';
/**
 * tests/sold-one-rule.realstack.cjs — MIS 0a cross-view equality on a REAL Postgres (a SIT box, cb_app, RLS on): for every client the firm holds, the sales of
 * the last closed month is ONE figure in three places — the practice row (health.last_month_sales_minor), Trend's month slot (lib/till-summary.trend) and
 * soldByDay summed over that month — and the windowed soldByDay answers exactly what the whole-book read answers for the days in its window.
 * Also: the practice's year to date equals soldByDay over the same dates, and a page of the practice carries the band of ALL clients.
 * Run: DATABASE_URL=postgres://cb_app:...@127.0.0.1:<port>/<db> FIRM_ID=<firm entity> [CLIENTS=30] node tests/sold-one-rule.realstack.cjs   (sit-grund only; never sit-au, sit-in or production)
 * OWNS the real-database proof of the one SOLD rule.   CALLED BY by hand on a SIT box (tests/sold-one-rule.test.cjs is the offline twin).   CARD 26-reporting-mis-and-bi
 */
const url = process.env.DATABASE_URL || '';
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !/^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
/* QA-178: FIRM_ID is optional; without it a scratch audit firm over the CI-seeded demo shop is made (tests/support/seeded-shop-fixture.cjs) */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(40);
process.env.RLS_GUARD = 'off'; process.env.LOG_LEVEL = 'error';
const path = require('path');
const API = path.join(__dirname, '..');
const db = require(path.join(API, 'db'));
const S = require(path.join(API, 'lib', 'books-store.js'));
const P = require(path.join(API, 'lib', 'books-practice.js'));
const TS = require(path.join(API, 'lib', 'till-summary.js'));
let pass = 0, fail = 0;
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want))); };
const E = require(path.join(API, 'lib', 'books-engines.js'));

(async () => {
  if (!process.env.FIRM_ID) {
    const F = require('./support/seeded-shop-fixture.cjs');
    const shop = await F.resolveShop(db.query, process.env.BO_ENTITY);
    const made = await F.makeFirm(db.query, shop, 'so' + (Date.now() % 1e10).toString(36));
    await F.grantAudit(shop, made.firm);
    process.env.FIRM_ID = made.firm.identity_id;
  }
  const N = Number(process.env.CLIENTS || 30);
  const all = await P.practice(process.env.FIRM_ID, { roles: ['auditor', 'adviser'], actor: process.env.FIRM_ID, actor_name: 'sold-one-rule' });
  const page = await P.practice(process.env.FIRM_ID, { roles: ['auditor', 'adviser'], actor: process.env.FIRM_ID, actor_name: 'sold-one-rule', query: { page: '1', limit: '50' } });
  t('a page of 50 carries the band of ALL clients and the same order', [page.band, page.clients.map((c) => c.entity_id), page.total], [all.band, all.clients.slice(0, 50).map((c) => c.entity_id), all.clients.length]);
  const today = all.today, firstOfThis = today.slice(0, 7) + '-01';
  const lastMonthStart = E.addDays(firstOfThis, -1).slice(0, 7) + '-01', lastMonthEnd = E.addDays(firstOfThis, -1);
  for (const row of all.clients.slice(0, N)) {
    const id = row.entity_id;
    const days = await db.withEntity(id, (h) => S.soldByDay(h, id, { from: lastMonthStart, to: lastMonthEnd }));
    const whole = await db.withEntity(id, (h) => S.soldByDay(h, id));
    const sum = (list) => (list.length ? list.reduce((s, x) => s + (x.sold.minor || 0), 0) : null); /* a month with no sold day is no figure (null) in the practice row and in Trend, never a 0: the seeded demo shop trades only this month */
    const inWin = whole.filter((x) => x.day >= lastMonthStart && x.day <= lastMonthEnd);
    t(id.slice(0, 8) + ' the window answers what the whole book answers for those days', days, inWin);
    t(id.slice(0, 8) + ' practice last month = soldByDay summed over that month', row.health.last_month_sales_minor, sum(days));
    const trend = await TS.trend(id, process.env.FIRM_ID, { period: 'month', n: 3, now: Date.parse(today + 'T12:00:00Z') });
    const slot = trend.body && trend.body.slots && trend.body.slots.find((s) => s.key === lastMonthStart.slice(0, 7));
    t(id.slice(0, 8) + " Trend's month = the same figure", slot && slot.gross_minor, sum(days));
    const fyStart = (await db.withEntity(id, (h) => h.query(`SELECT min(f.start_date)::text AS d FROM fiscal_period f WHERE f.entity_id = $1 AND f.period >= 1 AND f.fiscal_year = (SELECT fiscal_year FROM fiscal_period WHERE entity_id = $1 AND period >= 1 AND $2::date BETWEEN start_date AND end_date ORDER BY fiscal_year DESC LIMIT 1)`, [id, today]))).rows[0].d;
    const ytd = await db.withEntity(id, (h) => S.soldByDay(h, id, { from: fyStart, to: today }));
    /* (tax in, SOLD: the practice no longer shows it — see below) */
    /* FW-04: the practice's sales are TAX OUT, the client's P&L Sales + GST-free sales over the same dates (screen = api = hand) */
    const pl = await db.withEntity(id, (h) => require('../lib/books').profitAndLoss(h, id, fyStart, today));
    const plSales = pl.income.reduce((n, line) => n + line.accounts.filter((x) => /^sales/.test(String(x.role))).reduce((m, x) => m + Number(x.amount_minor), 0), 0);
    if (ytd.length) t(id.slice(0, 8) + ' practice sales this year = the P&L sales lines, tax out', row.health.sales_ytd_minor, plSales);
  }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

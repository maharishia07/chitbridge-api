#!/usr/bin/env node
// @type: unit
/**
 * tests/sold-one-rule.test.cjs — MIS 0a: ONE sales calculation, read for the days a screen shows (REQ-MIS-SHOWCASE sections 10 and 12).
 * Contract: (1) books-store.soldByDay applies from/to INSIDE the SQL (index journal_entry_date_idx) · (2) sold and taken are { minor, currency } and a
 * day holding two currencies says '*mixed*' with no sum · (3) no file but books-store (and its in-memory twin) names DAY_KINDS or SOLD_ROLES ·
 * (4) the practice statement reads sales from the SAME fragment as soldByDay (soldEntriesSql), bounded · (5) cross-view: the practice month, Trend's month
 * and Home's day are one figure of the one rule (over the in-memory twin) · (6) paging: the band counts every client, the page is the worst first.
 * OWNS the offline checks of the MIS 0a sales capability.   CALLED BY scripts/guards.cjs.   CARD 26-reporting-mis-and-bi
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const S = require(path.join(root, 'lib', 'books-store.js'));
const P = require(path.join(root, 'lib', 'books-practice.js'));
const H = require(path.join(root, 'lib', 'practice-health.js'));
const TS = require(path.join(root, 'lib', 'till-summary.js'));
let pass = 0, fail = 0;
const t = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n         got  ' + a.slice(0, 300) + '\n         want ' + b.slice(0, 300)); }
};
const E = '11111111-1111-4111-8111-111111111111';

(async () => {
  console.log('\nMIS 0a · one SOLD rule (offline)');
  /* (1) the bounds are in the WHERE, as parameters */
  const seen = [];
  const rows = [{ day: '2026-03-02', sold: '1180', taken: '1000', bills: '2', cur_lo: 'AUD', cur_hi: 'AUD' }, { day: '2026-03-03', sold: '50', taken: '50', bills: '1', cur_lo: 'AUD', cur_hi: 'USD' }];
  const db = { query: async (text, params) => { seen.push({ text, params }); return { rows }; } };
  const days = await S.soldByDay(db, E, { from: '2026-03-01', to: '2026-03-31' });
  t('from and to are SQL parameters on posting_date, inside the statement', [/h\.posting_date >= \$2::date/.test(seen[0].text), /h\.posting_date <= \$3::date/.test(seen[0].text), seen[0].params], [true, true, [E, '2026-03-01', '2026-03-31']]);
  await S.soldByDay(db, E);
  t('no bounds: the whole book, no date test', [/posting_date >=/.test(seen[1].text), seen[1].params], [false, [E]]);
  await S.soldByDay(db, E, { from: '2026-03-01' });
  t('from alone is $2', [/posting_date >= \$2::date/.test(seen[2].text), /posting_date <= /.test(seen[2].text)], [true, false]);
  /* (2) money with its currency; a mixed day has no sum */
  t('sold and taken are { minor, currency }', days[0], { day: '2026-03-02', sold: { minor: 1180, currency: 'AUD' }, taken: { minor: 1000, currency: 'AUD' }, bills: 2 });
  t("a day of two currencies is '*mixed*' with no sum", days[1].sold, { minor: null, currency: '*mixed*' });
  /* (3) nobody else names the constants */
  const hits = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    if (['node_modules', '.git', 'docs', 'archive'].includes(e.name)) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    if (!/\.(c?js|mjs)$/.test(e.name)) return;
    const rel = path.relative(root, p).replace(/\\/g, '/');
    if (['lib/books-store.js', 'tests/sold-one-rule.test.cjs'].includes(rel)) return;
    if (/\b(DAY_KINDS|SOLD_ROLES)\b/.test(fs.readFileSync(p, 'utf8'))) hits.push(rel);
  });
  walk(root);
  t('no other file reads DAY_KINDS or SOLD_ROLES', hits, []);
  t('the store does not export them either', [S.DAY_KINDS, S.SOLD_ROLES, S.TENDER_ROLES], [undefined, undefined, undefined]);
  /* (4) the practice statement shares the fragment, bounded */
  const text = P.statement(['cash'], false);
  const frag = S.soldEntriesSql('$1::uuid', { from: "(date_trunc('month', $2::date) - interval '4 months')", to: "(date_trunc('month', $2::date) - interval '1 day')" });
  t('the practice statement holds the shared SOLD fragment, bounded by today', [text.includes(frag), /sm AS \(/.test(text)], [true, true]);
  t('the base statement reads only the 4 closed months of sales; year on year is its own statement for the page, two bounded ranges, never the whole book', [/interval '4 months'/.test(text), /fs AS/.test(text), P.yoyDates('2026-11-17', 7), P.YOY_STATEMENT.includes('h.posting_date >= $2::date') && P.YOY_STATEMENT.includes('h.posting_date <= $5::date')], [true, false, ['2026-07-01', '2026-11-17', '2025-07-01', '2025-11-17'], true]);
  /* (5) cross-view: one figure — Trend's month and Home's day fold the same days */
  const dayRows = [{ day: '2026-03-02', sold: { minor: 118000, currency: 'AUD' }, taken: { minor: 100000, currency: 'AUD' }, bills: 3 }, { day: '2026-03-09', sold: { minor: 50000, currency: 'AUD' }, taken: { minor: 50000, currency: 'AUD' }, bills: 1 }];
  const overlay = TS.overlayBooks([], 'month', { state: 'read', days: dayRows, first: '2026-03-02' }, { fyStart: 4, currency: 'AUD' }, Date.parse('2026-03-20T00:00:00Z'));
  t("Trend's month holds exactly the sum of the days soldByDay answered", overlay.map((x) => x.totals.gross), [1680]);
  const skipped = TS.overlayBooks([], 'month', { state: 'read', days: [{ day: '2026-03-02', sold: { minor: null, currency: '*mixed*' }, taken: { minor: null, currency: '*mixed*' }, bills: 1 }], first: '2026-03-02' }, { fyStart: 4, currency: 'AUD' }, Date.parse('2026-03-20T00:00:00Z'));
  t('a mixed day is never added into the shop money', skipped, []);
  const w = TS.booksWindow({ period: 'month', count: 12, now: Date.parse('2026-11-16T00:00:00Z') });
  t('Trend months ask for 14 months of days back, not the book', w, { from: '2025-09-08', to: '2026-11-17' });
  const tw = TS.booksWindow(TS.teaserShows(Date.parse('2026-11-16T00:00:00Z')));
  t("the Till card's 61 weeks stay inside 24 months", (Date.parse(tw.to) - Date.parse(tw.from)) / 86400000 <= 24 * 31, true);
  /* (6) paging */
  const clients = ['good', 'help', 'watch', 'help', 'none'].map((status, i) => ({ name: 'c' + i, entity_id: 'e' + i, health: { status }, action_count: i, queries: { open: 0, on_us: 0, on_client: 0 }, bas: {}, months_unlocked: 0, checked: { n: 0, of: 0 }, grant: {}, bank: { state: 'none' } })).sort(H.byUrgency);
  const first = P.pageOf(clients, P.pageAsked({ page: '1', limit: '2' })), second = P.pageOf(clients, P.pageAsked({ page: '2', limit: '2' }));
  t('page 1 is the worst first; the band counts all five', [first.clients.map((c) => c.name), first.band.clients, first.paging], [['c3', 'c1'], 5, { total: 5, page: 1, limit: 2, has_more: true }]);
  t('page 2 continues, the last page says no more', [second.clients.map((c) => c.name), P.pageOf(clients, { page: 3, limit: 2 }).paging.has_more], [['c2', 'c0'], false]);
  t('no page words = the whole list, as before', [P.pageAsked({}), P.pageOf(clients, null).clients.length], [null, 5]);
  t('limit is capped on the server', P.pageAsked({ limit: '9999' }).limit, P.PAGE_MAX);
  t('year on year is a percentage of last year; none when last year sold nothing', [H.changeOf(120, 100), H.changeOf(5, 0)], [20, null]);
  /* (7) FW-04: the practice year to date is sales TAX OUT, the P&L basis (hand: Westgate Gardens P&L sales A$94,800.00; the old figure was SOLD, tax in, A$104,280.00 = 94,800.00 x 1.1) */
  const fragSales = S.soldEntriesSql('$1::uuid', { from: '$2', to: '$3' });
  t('FW-04 the one fragment also reads the sales ledgers, Cr minus Dr, over the SAME entries', [/role LIKE 'sales%'/.test(fragSales), /l\.cr_minor - l\.dr_minor ELSE 0 END\) AS sales_ex/.test(fragSales), /walkin_day/.test(fragSales)], [true, true, true]);
  t('FW-04 the year-on-year statement sums sales_ex (tax out), not sold, for this year and last', [(S.YOY_STATEMENT.match(/sum\(x\.sales_ex\)/g) || []).length, /sum\(x\.sold\)/.test(S.YOY_STATEMENT)], [2, false]);
  /* one sale by hand: Dr cash 110.00, Cr sales 100.00, Cr GST 10.00 -> sold 11000 (tax in), sales_ex 10000 (tax out) */
  const entryLines = [{ role: 'cash', dr: 11000, cr: 0 }, { role: 'sales', dr: 0, cr: 10000 }, { role: 'gst_output', dr: 0, cr: 1000 }];
  const soldOf = entryLines.filter((l) => ['cash', 'upi', 'card', 'bank', 'debtors'].includes(l.role)).reduce((n, l) => n + l.dr - l.cr, 0);
  const salesEx = entryLines.filter((l) => /^sales/.test(l.role)).reduce((n, l) => n + l.cr - l.dr, 0);
  t('FW-04 hand: a 110.00 sale is sold 11000 and sales tax out 10000', [soldOf, salesEx], [11000, 10000]);
  t('FW-04 hand: Westgate Gardens P&L sales 94,800.00 reaches the practice row as 9480000, not 10428000', P.yoyOf({ sales_ytd_minor: 9480000, sales_prev_ytd_minor: 8000000, sales_through: '2026-11-15', sales_first: '2025-07-02' }, { currencies: 1 }, P.yoyDates('2026-11-16', 7), '2026-11-16').sales_ytd_minor, 9480000);
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

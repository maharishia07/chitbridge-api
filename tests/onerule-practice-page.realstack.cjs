'use strict';
/**
 * tests/onerule-practice-page.realstack.cjs — l16 onerule: on a REAL Postgres (a SIT box, cb_app, RLS on) the practice row of EVERY client equals the client's own page for the same fact.
 * Practice side: lib/books-practice.practice(FIRM) (the one batch read). Page side: bound as the client — the Month lock page's functions (store periods + periodFigures → books.periodAdvice) and the Bank home's (bank-rec-log.unexplained).
 * STRICT facts (a difference fails the run): months_unlocked, bank.unexplained_minor / currency / reconciled_to / state.
 * STRICT money facts (ONEP-3, 28 Nov): last_month_sales_minor, sales_trend_pct, profit_quarter_minor, gross_margin_pct, cash_minor equal the client's OWN Overview (lib/books-mis.read, the code GET /overview runs: quarter for profit and gross, ytd for cash, the 12 bars for last month and the trend), field by field, for a client with one currency and a grant that shows costs.
 *   A month the Overview calls absent (null bar) counts as 0 here (the practice statement reads 0). The trend is compared only when the practice averaged three prior months.
 * INFO facts (printed, never fail; the rest of the fact table in the l16 onerule report): queries.open vs review-mark.openList total_open, checked.n/of vs review-mark coverage.
 * Run: DATABASE_URL=postgres://cb_app:...@<sit host>/... FIRM_ID=<the firm entity with the 150 clients> node tests/onerule-practice-page.realstack.cjs   (sit-grund only; never sit-au, never production)
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
if (!process.env.FIRM_ID) { console.error('REFUSED: FIRM_ID (the firm entity holding the client grants) is required'); process.exit(3); }
process.env.NODE_ENV = 'test';
const path = require('path');
const API = path.join(__dirname, '..');
const B = require(path.join(API, 'lib', 'books.js'));
const S = require(path.join(API, 'lib', 'books-store.js'));
const BR = require(path.join(API, 'lib', 'bank-rec-log.js'));
const P = require(path.join(API, 'lib', 'books-practice.js'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));

/** the client's own Overview figures, by the code GET /overview runs (books-mis.read); null when the books are off, the grant hides costs or the client holds two currencies (the practice withholds those) */
async function moneyPage(h, row, today) {
  const withheld = (row.health && row.health.withheld) || {};
  if (!row.health || !row.grant || row.grant.can_see_costs !== true || withheld.costs || withheld.currencies) return null;
  const MIS = require(path.join(API, 'lib', 'books-mis.js'));
  const setting = await B.settingOf(h, row.entity_id);
  if (!setting || !setting.enabled) return null;
  const req = { books: setting, acting_for_grant: true }, seat = { blind: false, cash: true }, fyMonth = Number(setting.fy_start_month);
  return { quarter: await MIS.read(h, row.entity_id, req, { period: 'quarter', today, fyMonth, seat }), ytd: await MIS.read(h, row.entity_id, req, { period: 'ytd', today, fyMonth, seat }) };
}
/** the practice figure beside the Overview's: bars[10] is the last whole month, bars[7..9] the three before it (bars[11] is the running month) */
function moneyPairsOf(row, page) {
  const bars = page.ytd.bars, sold = (i) => (bars[i] && bars[i].sold_minor != null ? Number(bars[i].sold_minor) : 0);
  const gross = page.quarter.gross, h = row.health, avg = (sold(7) + sold(8) + sold(9)) / 3;
  const pairs = [
    ['last_month_sales_minor', h.last_month_sales_minor == null ? 0 : h.last_month_sales_minor, sold(10)],
    ['profit_quarter_minor', h.profit_quarter_minor, page.quarter.profit ? page.quarter.profit.minor : null],
    ['gross_margin_pct', h.gross_margin_pct, gross && gross.sales_minor > 0 ? Math.round(1000 * gross.gross_profit_minor / gross.sales_minor) / 10 : null],
    ['cash_minor', h.cash_minor, page.ytd.cash ? page.ytd.cash.opening_minor : null]
  ];
  if (h.sales_trend_months === 3 && avg > 0) pairs.push(['sales_trend_pct', h.sales_trend_pct, Math.round(1000 * (sold(10) - avg) / avg) / 10]);
  return pairs;
}

(async () => {
  const t0 = Date.now();
  const answer = await P.practice(process.env.FIRM_ID, { roles: [grants.AUDITOR, grants.ADVISER] });
  const ms = Date.now() - t0;
  console.log('practice read: ' + answer.clients.length + ' clients in ' + ms + ' ms');
  let strict = 0, info = 0, checks = 0;
  for (const row of answer.clients) {
    const page = await grants.asEntity(row.entity_id, async (h) => {
      const rows = await S.periods(h, row.entity_id, null);
      const figures = await S.periodFigures(h, row.entity_id, null);
      const dated = rows.map((r) => Object.assign({}, r, { start_date: String(r.start_date).slice(0, 10), end_date: require(path.join(API, 'lib', 'books-engines.js')).ymd(r.end_date) }));
      const advice = B.periodAdvice(dated, figures, answer.today, [], null);
      const months = advice.filter((x) => Number(x.period) >= 1 && !B.isLockedStatus(x.status) && x.lock.why !== 'This month is not over yet.').length;
      const bank = await BR.unexplained(h, row.entity_id);
      let open = null;
      try { open = await require(path.join(API, 'lib', 'review-mark.js')).openList(h, 'acc.audit', row.entity_id, {}, { from: '1900-01-01', to: '2999-12-31' }); } catch (_) { open = null; }
      const money = await moneyPage(h, row, answer.today);
      return { months, bank, open, money };
    });
    const strictPairs = [
      ['months_unlocked', row.months_unlocked, page.months],
      ['bank.unexplained_minor', row.bank.unexplained_minor, page.bank.unexplained_minor],
      ['bank.currency', row.bank.currency, page.bank.currency],
      ['bank.reconciled_to', row.bank.reconciled_to, page.bank.to]
    ];
    const moneyPairs = page.money ? moneyPairsOf(row, page.money) : [];
    for (const [fact, practice, pageValue] of strictPairs.concat(moneyPairs)) {
      checks++;
      if (JSON.stringify(practice) !== JSON.stringify(pageValue)) { strict++; console.log('  FAIL ' + row.name + ' · ' + fact + ': practice ' + JSON.stringify(practice) + ' ≠ page ' + JSON.stringify(pageValue)); }
    }
    if (page.open && Number(page.open.total_open) !== row.queries.open) { info++; console.log('  info ' + row.name + ' · queries.open: practice ' + row.queries.open + ' vs marks page ' + page.open.total_open); }
  }
  console.log(checks + ' strict checks over ' + answer.clients.length + ' clients, ' + strict + ' differ; ' + info + ' info lines (queries)');
  process.exit(strict ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

/**
 * books-periods-scale.test.cjs — l16-scale (5-year growth), GET /periods and the Day book's keyset:
 *  1. a WHOLE month's sales (the P&L's income for that month) read from the stored month row = the same month read from its lines (two carried answers compared, never a second formula);
 *     and a whole month reads NO journal line at all (the cost that grew with every year held);
 *  2. a span that ends mid-month still reads its lines, as before;
 *  3. the Day book's page can run newest first: the cursor reads the other way, the order is the other way, the Ledger's never is.
 * No database: stand-ins for the reads. Run: node tests/books-periods-scale.test.cjs
 */
'use strict';
process.env.DATABASE_URL = '';
const path = require('path');
const B = require(path.join(__dirname, '..', 'lib', 'books.js'));
const S = require(path.join(__dirname, '..', 'lib', 'books-store.js'));
const E = require(path.join(__dirname, '..', 'lib', 'books-engines.js'));
const SCHEMA = require(path.join(__dirname, '..', 'lib', 'schema.js'));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const ENT = '11111111-1111-4111-8111-111111111111';
const setting = { country: 'IN', fy_start_month: 4, functional_currency: 'INR' };
const pack = E.packWith(B.packOf(setting), []);
const ZERO = '00000000-0000-0000-0000-000000000000';

/* the journal: sales on 3 days of April and May 2026-27 (cash Dr / sales Cr); the stored month row is the sum of its lines */
const LINES = [
  ['2026-04-03', 1, 1400, 0], ['2026-04-03', 1, 0, 1400], ['2026-04-20', 1, 2500, 0], ['2026-04-20', 1, 0, 2500],
  ['2026-05-02', 2, 3100, 0], ['2026-05-02', 2, 0, 3100], ['2026-05-29', 2, 900, 0], ['2026-05-29', 2, 0, 900]
].map((x, n) => ({ entry_id: 'e' + (n >> 1), entry_no: 'SV/2026-27/' + (n >> 1), line_no: (n % 2) + 1, posting_date: x[0], fiscal_year: '2026-27', period: x[1], is_opening: false, code: n % 2 ? '4000' : '1400', party_id: null, dr_minor: x[2], cr_minor: x[3], currency: 'INR', source_ref: 's' + (n >> 1) }));
const monthRows = [];
LINES.forEach((l) => { const hit = monthRows.find((r) => r.period === l.period && r.code === l.code); if (hit) { hit.dr_minor += l.dr_minor; hit.cr_minor += l.cr_minor; } else monthRows.push({ fiscal_year: '2026-27', period: l.period, code: l.code, party_key: ZERO, dr_minor: l.dr_minor, cr_minor: l.cr_minor }); });
let lineReads = 0;
S.yearRows = async () => monthRows.map((r) => Object.assign({}, r));
S.ledgerLines = async (db, e, from, to) => { lineReads++; return LINES.filter((l) => l.posting_date >= from && l.posting_date <= to).map((l) => Object.assign({}, l)); };
S.years = async () => ['2026-27'];
SCHEMA.hasTable = async () => false;
const ctxOf = () => ({ s: setting, chart: [], pack, years: ['2026-27'], cache: {} });

/** the P&L of a span, as profitAndLoss reads it WITH its lines (the way every month was read before) */
async function fromLines(from, to) {
  const ctx = ctxOf();
  return B.profitAndLoss({}, ENT, from, to, { ctx, lines: (await S.ledgerLines({}, ENT, '2026-04-01', to)).map(E.lineOf) });
}

(async () => {
  console.log('══ /periods: a whole month is its stored row ══');
  const spans = [{ from: '2026-04-01', to: '2026-04-30' }, { from: '2026-05-01', to: '2026-05-31' }];
  const want = [await fromLines(spans[0].from, spans[0].to), await fromLines(spans[1].from, spans[1].to)];
  ok('the lines give April 39.00 and May 40.00 of sales (the reference is not empty)', want[0].total_income_minor === 3900 && want[1].total_income_minor === 4000, JSON.stringify(want.map((x) => x.total_income_minor)));

  /* profitAndLossMonths builds its own ledger context from the store: stand in for it */
    const answer = await monthsViaStore(spans);
  ok('whole months: the stored rows answer the same income as the lines (April and May)', answer.map((x) => x.total_income_minor).join() === want.map((x) => x.total_income_minor).join(), JSON.stringify(answer.map((x) => x.total_income_minor)));
  ok('whole months read no journal line at all', lineReads === 2 /* only the two reference reads above */, 'line reads: ' + lineReads);

  const before = lineReads;
  const mid = await monthsViaStore([{ from: '2026-04-01', to: '2026-04-21' }]);
  ok('a span that ends mid-month still reads its lines (and counts only to that day: April 1-21 = 39.00)', lineReads > before && mid[0].total_income_minor === 3900, 'reads ' + (lineReads - before) + ' income ' + mid[0].total_income_minor);

  console.log('══ the Day book keyset runs newest first ══');
  const seen = [];
  const dbStub = { query: async (text, params) => { seen.push({ text, params }); return { rows: [] }; } };
  await S.entryPage(dbStub, ENT, '2026-04-01', '2026-04-30', null, null, { limit: 100, after: { date: '2026-04-10', no: 'SV/2026-27/000050' }, desc: true });
  await S.entryPage(dbStub, ENT, '2026-04-01', '2026-04-30', null, null, { limit: 100, after: { date: '2026-04-10', no: 'SV/2026-27/000050' } });
  const [newest, oldest] = seen.map((x) => x.text);
  ok('newest first: the cursor reads "before it" and both the page and the lines run DESC', /\(p\.posting_date, p\.entry_no\) < /.test(newest) && /ORDER BY p\.posting_date DESC, p\.entry_no DESC/.test(newest) && /ORDER BY h\.posting_date DESC, h\.entry_no DESC, l\.line_no/.test(newest));
  ok('oldest first (the default, and every Ledger): the cursor reads "after it" and nothing is DESC', /\(p\.posting_date, p\.entry_no\) > /.test(oldest) && !/DESC/.test(oldest.replace(/ORDER BY[^`]*REVERSALS/g, '')) );

  console.log('══ a Ledger asked for its newest lines (order=desc) ══');
  const route = require('fs').readFileSync(path.join(__dirname, '..', 'routes', 'books.js'), 'utf8');
  ok('the ledger route hands order=desc on to the page (it is not forced oldest first)', /Object\.assign\(\{ noOpening: !!lo\.period0 \}, pg\), \{ others: true \}/.test(route) && !/desc: false/.test(route));
  ok('a newest-first ledger page carries no running balance and no page opening; the oldest-first page still does', /running_minor: pg && pg\.desc \? null : run/.test(route) && /page_opening_minor: pg\.desc \? undefined : first/.test(route));
  const seenLedger = [];
  await S.entryPage({ query: async (text) => { seenLedger.push(text); return { rows: [] }; } }, ENT, '2026-04-01', '2026-04-30', '22222222-2222-4222-8222-222222222222', null, { limit: 10, desc: true, noOpening: true }, { others: true });
  ok('the newest 10 lines of one ledger: the account is fenced and the page runs DESC', /ORDER BY p\.posting_date DESC, p\.entry_no DESC/.test(seenLedger[0]) && /q\.account_id = \$4/.test(seenLedger[0]));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });

/** profitAndLossMonths with the store's own context stood in (settingOf/accounts are the only reads it adds) */
async function monthsViaStore(list) {
  S.setting = async () => Object.assign({ entity_id: ENT }, setting);
  S.accounts = async () => [];
  return B.profitAndLossMonths({ query: async () => ({ rows: [] }) }, ENT, list);
}

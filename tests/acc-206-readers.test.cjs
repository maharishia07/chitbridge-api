'use strict';
/**
 * tests/acc-206-readers.test.cjs — ACC-206 C2/C3/C4: EVERY READER SHOWS THE CARRIED TOTAL, ONE ROW PER STORED SHAPE (RULE-MATRIX R6).
 * No database: (1) the beckn quote reads the one pick (pre-2-Nov B2B invoice: 189, not its 180 net); (2) every statement that selects, filters, sorts or sums
 * a bill total (select.js, the /sent /folder /inbox filters and sorts, the rollup, the blind member key, the bell, kyb, forms) is built from
 * counterBill.billTotalSql and holds no raw read; (3) the SQL text itself names the three copies in pickOf's order and guards the withheld copy.
 * The SQL = pickOf parity on real rows is tests/bill-total-sql.realstack.cjs (CI integration job).
 * Run: node tests/acc-206-readers.test.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
/* a db whose withEntity hands the statement it is given to a recorder and answers the rows the case set */
const dbPath = require.resolve(path.join(root, 'db'));
let SEEN = [], ROWS = [];
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { withEntity: async (_entity, work) => work({ query: async (sql) => { SEEN.push(sql); return { rows: ROWS }; } }), query: async () => ({ rows: [] }) } };
const counterBill = require(path.join(root, 'lib', 'counter-bill'));
const costView = require(path.join(root, "lib", "cost-view"));
const beckn = require(path.join(root, 'lib', 'beckn-map'));
const { FIXTURES, INVOICE_FIXTURES, JUNK_FIXTURES } = require('./lib/bill-total-fixtures.cjs');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks += 1; };

/* (1) the Beckn quote of each stored shape says the one pick; a chit with no figure quotes nothing */
for (const fx of [...FIXTURES, ...INVOICE_FIXTURES]) {
  const chit = { chit_id: 'c1', summary_json: fx.summary, business_json: fx.business || null, total_value: fx.detail_total === undefined ? null : fx.detail_total, currency_code: 'INR', line_items: [] };
  const quote = beckn.toBeckn(chit, {}).message.order.quote;
  const picked = counterBill.pickOf(chit);
  const want = picked.source === 'withheld' ? null : picked.total !== null ? picked.total : chit.total_value;
  if (want === null) ok(quote === undefined, fx.id + ': no figure, no quote');
  else ok(quote && quote.price.value === String(want), fx.id + ': quote ' + (quote && quote.price.value) + ' want ' + want);
  if (fx.total !== null) ok(quote && quote.price.value === String(fx.total), fx.id + ': quote is the hand figure ' + fx.total);
}
ok(beckn.toBeckn({ chit_id: 'c', summary_json: { total_value: 180, money: { total: 189 } }, total_value: 180, currency_code: 'INR' }, {}).message.order.quote.price.value === '189', 'the old 189 chit quotes 189, the 180 detail column is not used');

/* the one rule for "is it a figure": pickOf takes only a finite number or a plain signed decimal string (the SQL regex's rule) */
for (const fx of JUNK_FIXTURES) ok(counterBill.pickOf({ summary_json: fx.summary, business_json: fx.business }).total === fx.total, fx.id + ': pickOf ' + fx.column);
ok(JUNK_FIXTURES.length === 36, 'twelve not-a-figure shapes in each of the three copies');

/* WITHHELD STAYS WITHHELD ON EVERY READER (ACC-206 review): the TR-6 operator copy carries no figure, whatever a fallback column holds */
const WITHHELD = { summary_json: { oversight: true, total_value: 189, money: { total: 189 } }, business_json: { invoice: { ValDtls: { TotInvVal: 189 } } } };
const LIVE = { summary_json: { total_value: 180, money: { total: 189 } }, business_json: null };
ok(costView.detailTotalOf('189.00', WITHHELD) === null, 'detail answer: a withheld copy shows no total_value, the column 189.00 does not come back');
ok(costView.detailTotalOf('180.00', LIVE) === '189.00', 'detail answer: the old 189 chit says 189.00 in the column two-place text');
ok(costView.detailTotalOf('90.00', { summary_json: {} }) === '90.00', 'detail answer: no copy says, the column stands');
ok(beckn.toBeckn({ ...WITHHELD, chit_id: 'w', total_value: 189, currency_code: 'INR' }, {}).message.order.quote === undefined, 'beckn: a withheld copy quotes nothing, the detail column notwithstanding');
const forms = require(path.join(root, 'lib', 'forms'));
const kyb = require(path.join(root, 'lib', 'kyb'));
const CHIT = '33333333-3333-4333-8333-333333333333', SHOP = '11111111-1111-4111-8111-111111111111';
const fallbackStatement = counterBill.billTotalSql('h', 'd.total_value');
ok(fallbackStatement.includes("h.summary_json -> 'oversight' = 'true'::jsonb THEN NULL") && fallbackStatement.endsWith(', d.total_value) END)'), 'the detail column is only ever the LAST arm INSIDE the withheld guard');
const ASYNC_CASES = (async () => {
  /* forms: the statement is the one pick with the guarded fallback; a withheld row (the statement answers NULL, the summary still names 189) fills nothing */
  SEEN = []; ROWS = [{ subject: 'S', all_recipients: [], total_value: null, summary_json: { oversight: true, total_value: 189 } }];
  const order = await forms.readOrder(SHOP, CHIT);
  ok(SEEN.length === 1 && SEEN[0].includes(fallbackStatement), 'forms: the order read is the one guarded pick');
  ok(order.total_value === null, 'forms: a withheld order fills no value (the s.total_value last arm is closed)');
  ROWS = [{ subject: 'S', all_recipients: [], total_value: '189', summary_json: { total_value: 180 } }];
  ok((await forms.readOrder(SHOP, CHIT)).total_value === '189', 'forms: the old 189 chit fills 189');
  ROWS = [{ subject: 'S', all_recipients: [], total_value: null, summary_json: { total_value: 55 } }];
  ok((await forms.readOrder(SHOP, CHIT)).total_value === 55, 'forms: no header total, the summary figure is the last arm');
  ok(forms.orderTotalOf({ total_value: null }, { oversight: true, total_value: 9 }) === null, 'forms.orderTotalOf: withheld is null');
  /* kyb: the trade read is the same guarded pick (the SQL answer on a withheld row is NULL: tests/bill-total-sql.realstack.cjs) */
  SEEN = []; ROWS = [];
  await kyb.risk(SHOP).catch(() => null);
  ok(SEEN.some((sql) => sql.includes(fallbackStatement)), 'kyb: the trade read is the one guarded pick');
})();
/* (3) the SQL text */
for (const alias of ['ch', 'h', '']) {
  const sql = counterBill.billTotalSql(alias);
  const at = alias ? alias + '.' : '';
  const order = ["business_json #> '{invoice,ValDtls,TotInvVal}'", "summary_json #> '{money,total}'", "summary_json -> 'total_value'"].map((p) => sql.indexOf(at + p));
  ok(order.every((i) => i > -1) && order[0] < order[1] && order[1] < order[2], 'alias "' + alias + '": invoice, then money.total, then total_value');
  ok(sql.includes(at + "summary_json -> 'oversight' = 'true'::jsonb THEN NULL"), 'alias "' + alias + '": the withheld copy has no figure');
}

/* (2) the statements are built from the one pick; none keeps a raw read */
const WIRED = [
  ['lib/select.js', 'billTotalSql(\'ch\')} AS value'],
  ['routes/chits.js', "COALESCE(${ownBill.billTotalSql('ch')},0) >="],
  ['routes/chits.js', "COALESCE(${ownBill.billTotalSql('ch')},0) <="],
  ['routes/chits.js', "amount: ownBill.billTotalSql('ch')"],
  ['routes/chits.js', "AS bill_total"],
  ['routes/chits.js', "SUM(${ownBill.billTotalSql('ch')})"],
  ['routes/chits.js', 'detailWithPickedTotal(data.detail.rows[0], data.header.rows[0])'],
  ['lib/cost-view.js', "'total_value', ${counterBill.billTotalSql(alias)},"],
  ['routes/notifications.js', "${counterBill.billTotalSql('ch')}::text AS total_value"],
  ['lib/kyb.js', "${counterBill.billTotalSql('h', 'd.total_value')} AS total_value"],
  ['lib/forms.js', "${counterBill.billTotalSql('h', 'd.total_value')} AS total_value"],
  ['lib/beckn-map.js', 'const total = billTotalOf(chit);']
];
for (const [file, piece] of WIRED) ok(read(file).includes(piece), file + ' reads the one pick: ' + piece);
const chitsSrc = read('routes/chits.js');
ok(!/summary_json->>'total_value'/.test(chitsSrc) && !/\(ch\.summary_json->>'total_value'\)/.test(chitsSrc), 'routes/chits.js holds no raw total_value SQL read');
ok((chitsSrc.match(/amount: 'bill_total'/g) || []).length === 1, 'the folder sort orders by the picked bill_total (its outer select has no business_json)');
ASYNC_CASES.then(() => console.log('acc-206-readers: ' + checks + ' checks pass')).catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });

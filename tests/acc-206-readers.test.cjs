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
const counterBill = require(path.join(root, 'lib', 'counter-bill'));
const beckn = require(path.join(root, 'lib', 'beckn-map'));
const { FIXTURES, INVOICE_FIXTURES } = require('./lib/bill-total-fixtures.cjs');
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
  ['lib/kyb.js', "COALESCE(${counterBill.billTotalSql('h')}, d.total_value) AS total_value"],
  ['lib/forms.js', "COALESCE(${counterBill.billTotalSql('h')}, d.total_value) AS total_value"],
  ['lib/beckn-map.js', 'const total = billTotalOf(chit);']
];
for (const [file, piece] of WIRED) ok(read(file).includes(piece), file + ' reads the one pick: ' + piece);
const chitsSrc = read('routes/chits.js');
ok(!/summary_json->>'total_value'/.test(chitsSrc) && !/\(ch\.summary_json->>'total_value'\)/.test(chitsSrc), 'routes/chits.js holds no raw total_value SQL read');
ok((chitsSrc.match(/amount: 'bill_total'/g) || []).length === 1, 'the folder sort orders by the picked bill_total (its outer select has no business_json)');
console.log('acc-206-readers: ' + checks + ' checks pass');

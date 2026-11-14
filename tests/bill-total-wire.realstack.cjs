'use strict';
/**
 * tests/bill-total-wire.realstack.cjs — ACC-348a: THE LIST SELECT'S COLUMNS GIVE THE LIST ROW THE DETAIL'S `bill_total`, ON REAL POSTGRES, IN / AU / AE.
 * The list statements select summary_json beside lib/money-check.listInvoiceColumnsSql (the invoice's total and currency); the detail reads the full header.
 * For every stored shape in tests/lib/bill-total-fixtures.cjs, in India (INR), Australia (AUD) and the UAE (AED), this runs the REAL fragment over a chit_header-shaped
 * row and asserts the list row's bill_total equals the detail's (billTotalWire over the full header), the currency is present, and a stamped disagreement is agree:false.
 * No tables are touched. Run: DATABASE_URL=postgres://… node tests/bill-total-wire.realstack.cjs
 */
const assert = require('assert');
const { Client } = require('pg');
const moneyCheck = require('../lib/money-check');
const { FIXTURES, INVOICE_FIXTURES } = require('./lib/bill-total-fixtures.cjs');

const URL = process.env.DATABASE_URL;
if (!URL) { console.log('bill-total-wire: no DATABASE_URL, nothing to run (CI integration job sets it)'); process.exit(0); }
const COUNTRIES = [['IN', 'INR'], ['AU', 'AUD'], ['AE', 'AED']];

(async () => {
  const db = new Client({ connectionString: URL });
  await db.connect();
  let checks = 0;
  try {
    for (const [country, code] of COUNTRIES) {
      for (const fx of [...FIXTURES, ...INVOICE_FIXTURES]) {
        const summary = Object.assign({}, fx.summary, { currency_code: code });
        const business = fx.business ? { invoice: Object.assign({ currency: code }, fx.business.invoice) } : null;
        const sql = `SELECT ch.summary_json, ${moneyCheck.listInvoiceColumnsSql('ch')} FROM (SELECT $1::jsonb AS summary_json, $2::jsonb AS business_json) ch`;
        const row = (await db.query(sql, [JSON.stringify(summary), business === null ? null : JSON.stringify(business)])).rows[0];
        const list = moneyCheck.billTotalWire(moneyCheck.headerOfListRow(row));
        const detail = moneyCheck.billTotalWire({ summary_json: summary, business_json: business });
        assert.deepStrictEqual(list, detail, `${country} ${fx.id}: list row = detail`);
        if (!fx.withheld && fx.id !== 'withheld-with-invoice') assert.strictEqual(detail.currency_code, code, `${country} ${fx.id}: currency present`);
        checks += 2;
      }
      const red = INVOICE_FIXTURES.find((fx) => fx.id === 'invoice-differs-money');
      const row = (await db.query(`SELECT ch.summary_json, ${moneyCheck.listInvoiceColumnsSql('ch')} FROM (SELECT $1::jsonb AS summary_json, $2::jsonb AS business_json) ch`,
        [JSON.stringify(Object.assign({ currency_code: code }, red.summary)), JSON.stringify({ invoice: Object.assign({ currency: code }, red.business.invoice) })])).rows[0];
      const wire = moneyCheck.billTotalWire(moneyCheck.headerOfListRow(row));
      assert.strictEqual(wire.agree, false, `${country}: a stamped disagreement shows agree:false on the list row`);
      assert.strictEqual(wire.currency_code, code, `${country}: and carries its currency`);
      checks += 2;
    }
    console.log(`bill-total-wire: ${checks} checks pass on real Postgres (IN, AU, AE)`);
  } finally { await db.end(); }
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });

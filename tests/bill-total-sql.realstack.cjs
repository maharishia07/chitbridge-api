'use strict';
/**
 * tests/bill-total-sql.realstack.cjs — ACC-206 C2: THE SQL PICK OF A BILL'S TOTAL EQUALS THE JS PICK, ON REAL POSTGRES.
 * billTotalSql(alias) (lib/counter-bill.js) is the statement-side twin of pickOf. For every stored shape in tests/lib/bill-total-fixtures.cjs
 * (the hand figures, never read from an engine here) the SQL answer must equal the hand figure AND pickOf's total — two carried totals compared,
 * no third formula. Runs against any Postgres: DATABASE_URL (CI: the throwaway cb_s41 database). No tables are touched; each row is a VALUES-less
 * SELECT over two jsonb parameters.
 * ONE RULE (review): pickOf's numberOf and the SQL accept the same values — a finite number or a plain signed decimal string. Every not-a-figure shape (true, "1e3", [5], " 5", ".5", "+5", "0x10" ...) is a fixture row in each copy and the two answers are COMPARED, not only asserted null.
 * A withheld (TR-6) copy stays NULL even with a detail-column fallback (kyb, forms): asserted below.
 * Run: DATABASE_URL=postgres://… node tests/bill-total-sql.realstack.cjs
 */
const assert = require('assert');
const { Client } = require('pg');
const counterBill = require('../lib/counter-bill');
const { FIXTURES, INVOICE_FIXTURES, JUNK_FIXTURES } = require('./lib/bill-total-fixtures.cjs');

const URL = process.env.DATABASE_URL;
if (!URL) { console.log('bill-total-sql: no DATABASE_URL, nothing to run (CI integration job sets it)'); process.exit(0); }

(async () => {
  const db = new Client({ connectionString: URL });
  await db.connect();
  let checks = 0;
  const ask = async (alias, summary, business) => {
    const sql = `SELECT ${counterBill.billTotalSql(alias)} AS t FROM (SELECT $1::jsonb AS summary_json, $2::jsonb AS business_json) ${alias || 'h'}`;
    const row = (await db.query(sql, [JSON.stringify(summary), business === null || business === undefined ? null : JSON.stringify(business)])).rows[0];
    return row.t === null ? null : Number(row.t);
  };
  try {
    for (const fx of [...FIXTURES, ...INVOICE_FIXTURES, ...JUNK_FIXTURES]) {
      for (const alias of ['ch', '']) {
        const got = await ask(alias, fx.summary, fx.business || null);
        assert.strictEqual(got, fx.total, `${fx.id} (${fx.column}) SQL = hand figure`);
        const js = counterBill.pickOf({ summary_json: fx.summary, business_json: fx.business || null }).total;
        assert.strictEqual(got, js, `${fx.id} SQL = pickOf`);
        checks += 2;
      }
    }
    /* the bare-column form (a statement that names no alias) */
    const bare = (await db.query(`SELECT ${counterBill.billTotalSql('')} AS t FROM (SELECT '{"money":{"total":189},"total_value":180}'::jsonb AS summary_json, NULL::jsonb AS business_json) x`)).rows[0].t;
    assert.strictEqual(Number(bare), 189, 'bare columns: the old 189 chit reads 189, not its 180 net');
    checks += 1;
    assert.strictEqual(await ask('h', { oversight: false, total_value: 7 }, null), 7, 'oversight false withholds nothing');
    /* the detail-column last arm (kyb, forms): read only where no copy says, never for a withheld copy */
    const withDetail = async (summary, business, detail) => {
      const sql = `SELECT ${counterBill.billTotalSql('h', 'd.total_value')} AS t FROM (SELECT $1::jsonb AS summary_json, $2::jsonb AS business_json) h, (SELECT $3::numeric AS total_value) d`;
      const row = (await db.query(sql, [JSON.stringify(summary), business === null ? null : JSON.stringify(business), detail])).rows[0];
      return row.t === null ? null : Number(row.t);
    };
    assert.strictEqual(await withDetail({ oversight: true, total_value: 189 }, null, 189), null, 'withheld: the detail column does not bring the figure back');
    assert.strictEqual(await withDetail({ oversight: true }, { invoice: { ValDtls: { TotInvVal: 189 } } }, 189), null, 'withheld with an invoice: still none');
    assert.strictEqual(await withDetail({}, null, 90), 90, 'no copy says: the detail column is the last arm');
    assert.strictEqual(await withDetail({ money: { total: 189 }, total_value: 180 }, null, 180), 189, 'a copy says: the detail column is not read');
    checks += 5;
    console.log(`bill-total-sql: ${checks} checks pass on real Postgres (${FIXTURES.length + INVOICE_FIXTURES.length} stored shapes, SQL = hand figure = pickOf)`);
  } finally { await db.end(); }
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });

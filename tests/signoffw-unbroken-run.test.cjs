#!/usr/bin/env node
/**
 * signoffw-unbroken-run.test.cjs — FW-36 (walk 25 Nov): "Signed off to 31 Oct" while September was not signed.
 * OWNS    the proof that LATEST_SQL (the one rule of the newest sign-off, read by the Bank home, the Bank page, the TB bank line and the practice list)
 *         ends an account's sign-off at the first hole: September unsigned + October signed reads "to 31 Aug", never "to 31 Oct".
 * CALLED BY CI (tests/*.test.cjs). Text checks need no database; the rows check runs only when TEST_DATABASE_URL names a postgres (a TEMP table shadows bank_rec_log, nothing is written).
 */
'use strict';
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = '';
const assert = require('assert');
const { LATEST_SQL } = require('../lib/bank-rec-log');
const sql = LATEST_SQL('$1', '$2');
assert.ok(/period_from > MAX\(period_to\) OVER \(PARTITION BY account_id ORDER BY period_to, seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING\) \+ 1/.test(sql), 'a period that starts after a hole marks the gap');
assert.ok(/c\.first_gap IS NULL OR c\.period_to < c\.first_gap/.test(sql), 'nothing at or after the first hole is signed-off-to');
assert.ok(/period_to <= \$2::date/.test(sql) && /entity_id = \$1/.test(sql), 'entity and as-of kept');
let ran = 'text only';
(async () => {
  if (process.env.TEST_DATABASE_URL) {
    const { Client } = require('pg'); const c = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await c.connect();
    await c.query("CREATE TEMP TABLE bank_rec_log (entity_id text, account_id text, kind text, period_from date, period_to date, seq int, difference_minor bigint, closing_bank_minor bigint, closing_books_minor bigint, currency text, made_at timestamptz)");
    const ins = [['a1', '08-01', '08-31', 1], ['a1', '09-01', '09-30', 2], ['a1', '10-01', '10-31', 3], ['a2', '08-01', '08-31', 4], ['a2', '10-01', '10-31', 5], ['a3', '08-01', '08-31', 6], ['a3', '08-01', '08-31', 7]];
    for (const r of ins) await c.query("INSERT INTO bank_rec_log VALUES ('e1',$1,'statement',$2::date,$3::date,$4,0,0,0,'AUD',now())", [r[0], '2026-' + r[1], '2026-' + r[2], r[3]]);
    const got = (await c.query(LATEST_SQL('$1'), ['e1'])).rows.map((r) => r.account_id + ':' + r.period_to).join(' ');
    assert.strictEqual(got, 'a1:2026-10-31 a2:2026-08-31 a3:2026-08-31', 'whole run signed = Oct; Sep missing = Aug; a re-sign is one row');
    const asOf = (await c.query(LATEST_SQL('$1', '$2'), ['e1', '2026-09-30'])).rows.map((r) => r.account_id + ':' + r.period_to).join(' ');
    assert.strictEqual(asOf, 'a1:2026-09-30 a2:2026-08-31 a3:2026-08-31');
    await c.end(); ran = 'rows on postgres';
  }
  console.log('signoffw-unbroken-run: ok (' + ran + ')');
})().catch((e) => { console.error(e); process.exit(1); });

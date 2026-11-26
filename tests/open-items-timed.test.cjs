'use strict';
/**
 * tests/open-items-timed.test.cjs — P1 speed money-01 F1 (1130): the OPEN-ITEMS statement (lib/books-open-items.rowsSql, read by /cashflow and /overview) UNDER A BUDGET, and the SAME ROWS.
 * WHY: open-items.test.cjs counts rows in memory and never times the SQL. On sit-ae2 the statement took 2.4-15 s at 5,000-10,000 rows although it ran in 30-400 ms: its recursive CTE is COSTED at ~26M rows, which crosses
 * jit_above_cost, and Postgres spent the time COMPILING it (EXPLAIN ANALYZE "JIT ... Total 13603 ms" of "Execution Time 15226 ms"). The fix is JIT OFF in the api's own connections (db/index.js); this test pins both the setting and the time.
 * OFFLINE: db/index.js turns jit off in all three places a connection gets its settings (on connect, BEGIN's SET LOCAL, readBatch's head).
 * WITH DATABASE_URL (a SIT box or a local Postgres; superuser; one rolled-back transaction, nothing left behind): (1) a HAND-COMPUTED fixture (part payment, full settlement, credit note, unpaid bill, unapplied money)
 * returns exactly the rows worked out below; (2) the same statement over ROWS generated rows (the fixture inside them) runs under BUDGET_MS with the api's connection setting, and returns the same fixture rows.
 * Run: DATABASE_URL=postgres://postgres:x@127.0.0.1/postgres node tests/open-items-timed.test.cjs   (BUDGET_MS default 1500; ROWS default 5000)
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const OPEN = require('../lib/books-open-items.js');
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); } };

const src = fs.readFileSync(path.join(__dirname, '..', 'db', 'index.js'), 'utf8');
check("db/index.js: JIT off on connect, in BEGIN (SET LOCAL) and in readBatch's head (set_config)", /SESSION_TZ \+ '; ' \+ JIT_OFF/.test(src) && /SET LOCAL ' \+ JIT_OFF\.slice\(4\)/.test(src) && /set_config\('jit', 'off', true\)/.test(src) && /JIT_OFF = 'SET jit = off'/.test(src));

/* HAND-COMPUTED (minor units). rows: [ref, against_ref, ref_kind, amount]
 *  B1 10000, part payment P1 4000 applied to it   -> B1 nets 6000: OPEN. P1 is linked to B1: both documents' rows are read (4 rows)
 *  B2 5000, paid in full by P2                    -> B2 0, P2 0, nothing live: NOT read
 *  B3 8000, cleared by credit note C3 8000        -> 0 and 0: NOT read
 *  B4 2000 unpaid                                 -> OPEN (1 row)
 *  P4 1500 received, never applied                -> nets -1500: OPEN, unapplied credit (1 row)                                   */
const FIX = [
  ['B1', 'B1', 'bill', 10000], ['P1', 'P1', 'on_account', -4000], ['P1', 'B1', 'allocation', -4000], ['P1', 'P1', 'allocation', 4000],
  ['B2', 'B2', 'bill', 5000], ['P2', 'P2', 'on_account', -5000], ['P2', 'B2', 'allocation', -5000], ['P2', 'P2', 'allocation', 5000],
  ['B3', 'B3', 'bill', 8000], ['C3', 'C3', 'on_account', -8000], ['C3', 'B3', 'allocation', -8000], ['C3', 'C3', 'allocation', 8000],
  ['B4', 'B4', 'bill', 2000], ['P4', 'P4', 'on_account', -1500]];
const EXPECT = ['B1|B1|bill|10000', 'P1|P1|on_account|-4000', 'P1|B1|allocation|-4000', 'P1|P1|allocation|4000', 'B4|B4|bill|2000', 'P4|P4|on_account|-1500'].sort();

if (!process.env.DATABASE_URL) { console.log('  skipped (DB part): needs DATABASE_URL'); console.log(passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0); }
const { Client } = require('pg');
const BUDGET_MS = Number(process.env.BUDGET_MS || 1500), ROWS = Number(process.env.ROWS || 5000);
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const E = crypto.randomUUID(), PARTY = crypto.randomUUID(), ACC = crypto.randomUUID();
  const sql = OPEN.rowsSql('$1::uuid') + ' ORDER BY item_id';
  const key = (r) => r.ref + '|' + r.against_ref + '|' + r.ref_kind + '|' + r.amount_minor;
  const insert = (rows) => c.query(`INSERT INTO party_item (entity_id, party_id, account_id, side, ref, against_ref, ref_kind, kind, amount_minor, currency, doc_date)
      SELECT $1, $2, $3, 'receivable', v.r, v.a, v.k, 'x', v.m, 'AED', date '2026-11-01' FROM jsonb_to_recordset($4::jsonb) v(r text, a text, k text, m bigint)`,
  [E, PARTY, ACC, JSON.stringify(rows.map((row) => ({ r: row[0], a: row[1], k: row[2], m: row[3] })))]);
  try {
    await c.query('BEGIN'); await c.query('SET LOCAL session_replication_role = replica');   /* no FK parents needed; superuser; all rolled back */
    await c.query("SELECT set_config('app.current_entity', $1, true)", [E]);
    await insert(FIX);
    const got = (await c.query(sql, [E])).rows;
    check('hand-computed fixture: open rows are exactly B1 + its part payment, B4, and the unapplied P4 (6 of 14; settled B2/P2 and credit-noted B3/C3 are not read)', JSON.stringify(got.map(key).sort()) === JSON.stringify(EXPECT), JSON.stringify(got.map(key)));
    /* scale: ROWS generated, settled in full (4 rows a bill: bill, payment, both allocation halves), with the fixture inside */
    await c.query(`INSERT INTO party_item (entity_id, party_id, account_id, side, ref, against_ref, ref_kind, kind, amount_minor, currency, doc_date)
        SELECT $1, $2, $3, 'receivable', v.r, v.a, v.k, 'x', v.m, 'AED', date '2026-01-01' + (g % 300)
        FROM generate_series(1, $4::int / 4) g, LATERAL (VALUES ('GB' || g, 'GB' || g, 'bill', 10000 + g), ('GP' || g, 'GP' || g, 'on_account', -(10000 + g)), ('GP' || g, 'GB' || g, 'allocation', -(10000 + g)), ('GP' || g, 'GP' || g, 'allocation', 10000 + g)) v(r, a, k, m)`, [E, PARTY, ACC, ROWS]);
    await c.query('ANALYZE party_item');
    await c.query('SET LOCAL jit = off');   /* the api's connection setting (db/index.js beginSql) */
    const run = async () => { const t0 = process.hrtime.bigint(); const out = (await c.query(sql, [E])).rows; return { out, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; };
    await run();
    const times = []; let last;
    for (let i = 0; i < 3; i++) { last = await run(); times.push(last.ms); }
    check('the same open rows come out of ' + (ROWS + FIX.length) + ' rows', JSON.stringify(last.out.map(key).sort()) === JSON.stringify(EXPECT), last.out.length + ' rows');
    check('the open-items statement at ' + (ROWS + FIX.length) + ' rows runs under ' + BUDGET_MS + ' ms (3 runs: ' + times.map((t) => t.toFixed(0)).join(', ') + ' ms)', Math.max(...times) < BUDGET_MS);
  } finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
  console.log(passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch((err) => { console.log('ERROR ' + (err && err.stack)); process.exit(1); });

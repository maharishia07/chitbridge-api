'use strict';
/**
 * tests/books-sold-totals.speed.cjs — MIS A1 speed (not part of the offline guard): p50/p95 of books-store.soldTotals for ONE shop at 12 months (this year to date + the same dates last year) and at 7 years
 * (seven annual ranges, one statement), on a throwaway migrated Postgres seeded here (one shop, SHOP_DAYS days x 4 sale entries a day, a debtors and a cash line each).
 * Run: DATABASE_URL=postgres://postgres:x@127.0.0.1/postgres RUNS=100 node tests/books-sold-totals.speed.cjs   (the entity is deleted at the end)
 */
if (!process.env.DATABASE_URL) { console.log('skipped: needs DATABASE_URL'); process.exit(0); }
process.env.NODE_ENV = 'test';
const crypto = require('crypto'), { Client } = require('pg');
const S = require('../lib/books-store');
const RUNS = Number(process.env.RUNS || 100), DAYS = Number(process.env.SHOP_DAYS || 2600);
const pct = (list, p) => list.slice().sort((a, b) => a - b)[Math.min(list.length - 1, Math.ceil((p / 100) * list.length) - 1)];
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const E = crypto.randomUUID(), cash = crypto.randomUUID(), debtors = crypto.randomUUID();
  try {
    await c.query("INSERT INTO ledger_account (account_id, entity_id, code, name, nature, role) VALUES ($1,$2,'C1','C1','asset','cash'),($3,$2,'D1','D1','asset','debtors')", [cash, E, debtors]);
    await c.query(`WITH d AS (SELECT ('2026-11-17'::date - g) AS day, k FROM generate_series(0, $2::int - 1) g, generate_series(1, 4) k),
        e AS (INSERT INTO journal_entry (entity_id, entry_no, posting_date, fiscal_year, period, event_type, currency, total_minor)
              SELECT $1, 'S' || row_number() OVER (), day, 'FY' || extract(year FROM day)::int, extract(month FROM day)::int, CASE WHEN k = 1 THEN 'walkin_day' ELSE 'sale_bill' END, 'AUD', 1000 FROM d RETURNING entry_id, event_type)
        INSERT INTO journal_line (entry_id, entity_id, line_no, account_id, dr_minor, cr_minor, currency)
        SELECT entry_id, $1, 1, CASE WHEN event_type = 'walkin_day' THEN $3::uuid ELSE $4::uuid END, 1000, 0, 'AUD' FROM e UNION ALL SELECT entry_id, $1, 2, $4::uuid, 0, 1000, 'AUD' FROM e`, [E, DAYS, cash, debtors]);
    await c.query('ANALYZE journal_entry; ANALYZE journal_line');
    const rows = (await c.query('SELECT count(*) FROM journal_entry WHERE entity_id = $1', [E])).rows[0].count;
    const db = { query: (t, p) => c.query(t, p) };
    const y12 = [{ from: '2026-07-01', to: '2026-11-17' }, { from: '2025-07-01', to: '2025-11-17' }, { from: '2025-11-18', to: '2026-11-17' }];
    const y7 = []; for (let y = 2020; y <= 2026; y++) y7.push({ from: y + '-07-01', to: (y === 2026 ? '2026-11-17' : (y + 1) + '-06-30') });
    const time = async (name, fn) => { const ms = []; for (let i = 0; i < 5; i++) await fn(); for (let i = 0; i < RUNS; i++) { const t0 = process.hrtime.bigint(); await fn(); ms.push(Number(process.hrtime.bigint() - t0) / 1e6); } console.log(name + ': p50 ' + pct(ms, 50).toFixed(1) + ' ms · p95 ' + pct(ms, 95).toFixed(1) + ' ms · max ' + Math.max(...ms).toFixed(1) + ' ms · ' + RUNS + ' runs'); };
    console.log('seeded ' + rows + ' entries over ' + DAYS + ' days for one shop');
    await time('soldTotals 12 months (3 ranges, one statement)', () => S.soldTotals(db, E, y12));
    await time('soldTotals 7 years (7 annual ranges, one statement)', () => S.soldTotals(db, E, y7));
    await time('soldByDay 12 months (the day series Trend reads, for scale)', () => S.soldByDay(db, E, { from: '2025-11-18', to: '2026-11-17' }));
  } finally {
    await c.query('DELETE FROM journal_line WHERE entity_id = $1', [E]).catch(() => {}); await c.query('DELETE FROM journal_entry WHERE entity_id = $1', [E]).catch(() => {}); await c.query('DELETE FROM ledger_account WHERE entity_id = $1', [E]).catch(() => {});
    await c.end();
  }
})().catch((err) => { console.log('ERROR ' + (err && err.stack)); process.exit(1); });

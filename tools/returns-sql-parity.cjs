#!/usr/bin/env node
/**
 * tools/returns-sql-parity.cjs — RETURNS SPEED: the old and the new SQL of the return's reads, fuzzed against a REAL Postgres (as cb_app, row security on).
 * OWNS      the old-against-new answer check for lib/books-store taxEntryLines · taxedIncomeLines · taxedOnlyLines · entryLines (the whole-window shape)
 * CALLED BY by hand, on a throwaway database: node tools/returns-sql-parity.cjs --db postgres://cb_app:…@127.0.0.1:5432/<db> --entity <uuid> --old <path of the old lib/books-store.js, a copy kept beside it> [--n 60] [--seed 1]
 *           (the old file: `git show <old sha>:lib/books-store.js > lib/books-store.old.cjs`; delete it after)
 * FLOW      random windows (a day · a month · a year · the whole book) and random role sets ──▶ both versions, one transaction each ──▶ answers compared (sorted, or in order for entryLines) ──▶ exit 1 on any difference
 * CARD      speed/returns-parity
 */
'use strict';
const path = require('path');
const arg = (name, fallback) => { const index = process.argv.indexOf('--' + name); return index > 0 ? process.argv[index + 1] : fallback; };
const DB = arg('db', ''), ENTITY = arg('entity', ''), OLD = arg('old', ''), N = Number(arg('n', 60));
if (!/^postgres/.test(DB) || !ENTITY || !OLD) { console.error('usage: --db <cb_app url> --entity <uuid> --old <old books-store.js> [--n 60] [--seed 1]'); process.exit(2); }
if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(DB)) { console.error('local database only'); process.exit(2); }
process.env.DATABASE_URL = DB;
let seed = Number(arg('seed', 1));
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const some = (list) => list.filter(() => rnd() < 0.5);
const NEW = require(path.join(__dirname, '..', 'lib', 'books-store.js')), OLDS = require(path.resolve(OLD));
const { Pool } = require('pg');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
(async () => {
  const pool = new Pool({ connectionString: DB, max: 1 });
  const read = async (fn) => { const client = await pool.connect(); try { await client.query('BEGIN'); await client.query("SELECT set_config('app.current_entity', $1, true)", [ENTITY]); const out = await fn(client); await client.query('ROLLBACK'); return out; } finally { client.release(); } };
  const roles = (await read((c) => c.query('SELECT DISTINCT role FROM ledger_account WHERE entity_id = $1 AND role IS NOT NULL', [ENTITY]))).rows.map((r) => r.role);
  const span = (await read((c) => c.query('SELECT min(posting_date)::text lo, max(posting_date)::text hi FROM journal_entry WHERE entity_id = $1', [ENTITY]))).rows[0];
  const lo = Date.parse(span.lo), hi = Date.parse(span.hi);
  const norm = (rows, ordered) => { const text = rows.map((r) => JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k] instanceof Date ? r[k].toISOString() : String(r[k] === null ? 'null' : typeof r[k] === 'object' ? JSON.stringify(r[k]) : r[k])]))); return ordered ? text : text.sort(); };
  let same = 0, differ = 0, rowsSeen = 0;
  const check = async (label, call, ordered) => {
    const [a, b] = [await read((c) => call(OLDS, c)), await read((c) => call(NEW, c))];
    const [x, y] = [norm(a, ordered), norm(b, ordered)]; rowsSeen += x.length;
    if (JSON.stringify(x) === JSON.stringify(y)) same++; else { differ++; console.log('   DIFFER ' + label + ' old ' + x.length + ' rows, new ' + y.length + ' rows'); }
  };
  for (let i = 0; i < N; i++) {
    const kind = pick(['day', 'month', 'month', 'quarter', 'year', 'whole', 'edge']);
    let from = lo + Math.floor(rnd() * (hi - lo));
    let to = from + (kind === 'day' ? 0 : kind === 'month' ? 30 : kind === 'quarter' ? 91 : kind === 'year' ? 365 : 0) * 86400000;
    if (kind === 'whole') { from = lo; to = hi; }
    if (kind === 'edge') { from = lo; to = lo + 86400000 * Math.floor(rnd() * 5); } /* the opening entries sit at the first day */
    const [f, t] = [day(from), day(Math.min(to, hi + 86400000))];
    const tax = some(roles), money = some(roles), types = some(['tax_setoff', 'tax_payment', 'gst_setoff', 'gst_payment', 'walkin_day', 'sale', 'expense']);
    const label = kind + ' ' + f + '..' + t;
    await check('taxEntryLines ' + label, (S, c) => S.taxEntryLines(c, ENTITY, f, t, types, { tax, money }));
    const [roleA, skipA, roleB, onlyB] = [pick(['gst_collected', 'gst_paid']), some(roles), pick(['gst_paid', 'gst_collected']), some(roles)]; /* drawn once: both versions get the same question */
    await check('taxedIncomeLines ' + label, (S, c) => S.taxedIncomeLines(c, ENTITY, f, t, roleA, skipA));
    await check('taxedOnlyLines ' + label, (S, c) => S.taxedOnlyLines(c, ENTITY, f, t, roleB, onlyB));
    if (kind !== 'whole' || i % 7 === 0) await check('entryLines ' + label, (S, c) => S.entryLines(c, ENTITY, f, t, null, null), true);
  }
  console.log('   ' + (same + differ) + ' comparisons (' + rowsSeen + ' rows compared), ' + differ + ' differ');
  await pool.end(); process.exit(differ ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

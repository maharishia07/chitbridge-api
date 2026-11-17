#!/usr/bin/env node
/**
 * tools/returns-sql-parity.cjs — RETURNS SPEED: the old and the new SQL of the return's reads, fuzzed against a REAL Postgres (as cb_app, row security on).
 * OWNS      the old-against-new answer check for lib/books-store taxEntryLines · taxedIncomeLines · taxedOnlyLines · entryLines (the whole-window shape)
 * CALLED BY by hand, on a throwaway database: node tools/returns-sql-parity.cjs --db postgres://cb_app:…@127.0.0.1:5432/<db> --entity <uuid> --old <path of the old lib/books-store.js, a copy kept beside it> [--n 60] [--seed 1]
 *           (the old file: `git show <old sha>:lib/books-store.js > lib/books-store.old.cjs`; delete it after) · tests/returns-sql-parity.test.cjs (the pure parts: the seeded draw, the window, the row normaliser)
 * FLOW      random windows (a day · a month · a year · the whole book) and random role sets ──▶ both versions, one transaction each ──▶ answers compared (sorted, or in order for entryLines) ──▶ exit 1 on any difference
 * CARD      speed/returns-parity
 */
'use strict';
const path = require('path');

const DAY_MS = 86400000;
/** how many days past its start each kind of window runs (a whole book and an edge window are cut by windowFor itself) */
const SPAN_DAYS = { day: 0, month: 30, quarter: 91, year: 365 };
const WINDOW_KINDS = ['day', 'month', 'month', 'quarter', 'year', 'whole', 'edge'];
const TYPE_POOL = ['tax_setoff', 'tax_payment', 'gst_setoff', 'gst_payment', 'walkin_day', 'sale', 'expense'];

/** the seeded generator the fuzz draws from: a linear congruential step, so one --seed replays the same questions */
function seededRandom(startSeed) {
  let state = startSeed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** a list element drawn by the generator */
const pickOne = (draw, list) => list[Math.floor(draw() * list.length)];
/** each element kept with a half chance */
const someOf = (draw, list) => list.filter(() => draw() < 0.5);
/** a millisecond instant as YYYY-MM-DD */
const dayText = (instantMs) => new Date(instantMs).toISOString().slice(0, 10);

/** the window of one fuzz round: { from, to } in ms, inside [first, last] (the edge window starts on the first day, where the opening entries sit) */
function windowFor(kind, draw, first, last) {
  let from = first + Math.floor(draw() * (last - first));
  let to = from + (SPAN_DAYS[kind] || 0) * DAY_MS;
  if (kind === 'whole') {
    from = first;
    to = last;
  }
  if (kind === 'edge') {
    from = first;
    to = first + DAY_MS * Math.floor(draw() * 5);
  }
  return { from, to };
}

/** one cell as a comparable text: a date as ISO, null as 'null', an object as JSON */
function cellText(value) {
  if (value instanceof Date) return value.toISOString();
  if (value === null) return 'null';
  return String(typeof value === 'object' ? JSON.stringify(value) : value);
}

/** rows as comparable lines (keys sorted); sorted too unless the order is itself the answer */
function normalise(rows, ordered) {
  const lines = rows.map((row) =>
    JSON.stringify(
      Object.keys(row)
        .sort()
        .map((key) => [key, cellText(row[key])])
    )
  );
  return ordered ? lines : lines.sort();
}

/** the command line: --db, --entity, --old, --n, --seed */
function readArgs(argv) {
  const arg = (name, fallback) => {
    const index = argv.indexOf('--' + name);
    return index > 0 ? argv[index + 1] : fallback;
  };
  return { db: arg('db', ''), entity: arg('entity', ''), old: arg('old', ''), rounds: Number(arg('n', 60)), seed: Number(arg('seed', 1)) };
}

/** why these arguments cannot run (usage, or a database that is not local), or null */
function refusalOf(args) {
  if (!/^postgres/.test(args.db) || !args.entity || !args.old) return 'usage: --db <cb_app url> --entity <uuid> --old <old books-store.js> [--n 60] [--seed 1]';
  if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(args.db)) return 'local database only';
  return null;
}

/** read inside one transaction under the entity's row security, always rolled back */
function reader(pool, entity) {
  return async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_entity', $1, true)", [entity]);
      const answer = await fn(client);
      await client.query('ROLLBACK');
      return answer;
    } finally {
      client.release();
    }
  };
}

/** the roles the entity's chart uses and the first and last posting day (ms), read under its row security */
async function bookShape(read, entity) {
  const roles = (await read((client) => client.query('SELECT DISTINCT role FROM ledger_account WHERE entity_id = $1 AND role IS NOT NULL', [entity]))).rows.map((row) => row.role);
  const span = (await read((client) => client.query('SELECT min(posting_date)::text lo, max(posting_date)::text hi FROM journal_entry WHERE entity_id = $1', [entity]))).rows[0];
  return { roles, first: Date.parse(span.lo), last: Date.parse(span.hi) };
}

/** the comparisons of one round; each (label, call, ordered) goes to check() */
async function roundChecks({ check, draw, roles, kind, from, to, entity, wholeBookRound }) {
  const taxRoles = someOf(draw, roles),
    moneyRoles = someOf(draw, roles),
    types = someOf(draw, TYPE_POOL);
  const label = kind + ' ' + from + '..' + to;
  await check('taxEntryLines ' + label, (store, client) => store.taxEntryLines(client, entity, from, to, types, { tax: taxRoles, money: moneyRoles }));
  /* drawn once: both versions get the same question */
  const roleA = pickOne(draw, ['gst_collected', 'gst_paid']),
    skipA = someOf(draw, roles),
    roleB = pickOne(draw, ['gst_paid', 'gst_collected']),
    onlyB = someOf(draw, roles);
  await check('taxedIncomeLines ' + label, (store, client) => store.taxedIncomeLines(client, entity, from, to, roleA, skipA));
  await check('taxedOnlyLines ' + label, (store, client) => store.taxedOnlyLines(client, entity, from, to, roleB, onlyB));
  if (kind !== 'whole' || wholeBookRound) await check('entryLines ' + label, (store, client) => store.entryLines(client, entity, from, to, null, null), true);
}

/** the whole fuzz: both stores answer each question, the answers are compared; the count of differences */
async function fuzz({ args, pool, oldStore, newStore }) {
  const read = reader(pool, args.entity);
  const { roles, first, last } = await bookShape(read, args.entity);
  const draw = seededRandom(args.seed);
  let same = 0,
    differ = 0,
    rowsSeen = 0;
  const check = async (label, call, ordered) => {
    const [oldRows, newRows] = [await read((client) => call(oldStore, client)), await read((client) => call(newStore, client))];
    const [oldLines, newLines] = [normalise(oldRows, ordered), normalise(newRows, ordered)];
    rowsSeen += oldLines.length;
    if (JSON.stringify(oldLines) === JSON.stringify(newLines)) same++;
    else {
      differ++;
      console.log('   DIFFER ' + label + ' old ' + oldLines.length + ' rows, new ' + newLines.length + ' rows');
    }
  };
  for (let round = 0; round < args.rounds; round++) {
    const kind = pickOne(draw, WINDOW_KINDS);
    const bounds = windowFor(kind, draw, first, last);
    const [from, to] = [dayText(bounds.from), dayText(Math.min(bounds.to, last + DAY_MS))];
    await roundChecks({ check, draw, roles, kind, from, to, entity: args.entity, wholeBookRound: round % 7 === 0 });
  }
  console.log('   ' + (same + differ) + ' comparisons (' + rowsSeen + ' rows compared), ' + differ + ' differ');
  return differ;
}

/** the whole run: arguments, the refusals, both stores loaded, the fuzz, the exit code (1 on any difference) */
async function main() {
  const args = readArgs(process.argv);
  const refusal = refusalOf(args);
  if (refusal) {
    console.error(refusal);
    process.exit(2);
  }
  process.env.DATABASE_URL = args.db;
  const newStore = require(path.join(__dirname, '..', 'lib', 'books-store.js')),
    oldStore = require(path.resolve(args.old));
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: args.db, max: 1 });
  const differ = await fuzz({ args, pool, oldStore, newStore });
  await pool.end();
  process.exit(differ ? 1 : 0);
}

if (require.main === module)
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
module.exports = { seededRandom, pickOne, someOf, dayText, windowFor, normalise, readArgs, refusalOf, WINDOW_KINDS };

#!/usr/bin/env node
/**
 * tools/migrate.cjs — THE SCHEMA PATH, WITH A LEDGER (HX1). Moved here from tools/sim-load.cjs (applySchema, HX0) and widened: every
 * file it runs is written into `schema_migrations` (b304), and a file already there is skipped — so a second deploy runs only what is new.
 *
 *   node tools/migrate.cjs --db <url>                       apply: an EMPTY database gets the ONE baseline (000_baseline_2026-10-21.sql:
 *                                                           production's schema + reference rows + the ledger table) then every bNNN above
 *                                                           b767 in number order (migrations/MANIFEST.md); a database with a ledger gets
 *                                                           the chain files the ledger does not name. A database WITH tables and an EMPTY
 *                                                           ledger is left alone (exit 0) — record what it has first (below).
 *   node tools/migrate.cjs --db <url> --status              what the ledger says: pending files, files changed since they ran. Reads only.
 *   node tools/migrate.cjs --db <url> --record <file> …     the owner ran these by hand → write their rows (source 'recorded'). Runs no SQL file.
 *   node tools/migrate.cjs --db <url> --record-through bNNN every chain file up to bNNN, recorded the same way — the one-time backfill.
 * <url> defaults to DATABASE_URL. Needs psql on PATH for apply (the migrate image has it). TLS: db/connect-config.js (the URL's sslmode).
 * ⚠️ NOTHING RUNS THIS ON PRODUCTION BY ITSELF — the api never calls it; the compose stack's one-shot `migrate` job does, on its own
 * database. On production the owner still runs the SQL; --record makes that visible.
 * CARD       28-platform-and-operations/migrations-and-schema
 * CALLED BY  Dockerfile target `migrate` (deploy/compose.yml one-shot job) · tools/fresh-db-check.cjs (CI `fresh-db`) · tools/schema-replay.cjs
 *            and tools/sim-load.cjs (chainFiles / CHAIN_SKIP) · tests/hosting-neutral.test.cjs
 */
'use strict';
const path = require('path'),
  fs = require('fs'),
  crypto = require('crypto');
const { spawnSync } = require('child_process');
const API = path.join(__dirname, '..');
const M = path.join(API, 'migrations');
/* DB-3 (Athi, 21 Oct 2026): ONE baseline = production's public schema on that day (pg_dump of the live database, tools/baseline-from-snapshot.cjs).
   The files it replaces — 000_baseline pair, migration_b42..57, b58..b767, net0x, sim01, RUN-2026-10-20-0..4 — live unchanged in
   migrations/archive/ and are never run on a new database. b304 (the ledger table) is inside the baseline; LEDGER_FILE names it for
   the owner's hand step on a database that has none. */
const LEDGER_FILE = 'b304_schema_migrations.sql';
const LEDGER_PATH = path.join(M, 'archive', LEDGER_FILE);
const BASELINE = ['000_baseline_2026-10-21.sql'];
/** the last migration number the baseline contains: a chain file must be numbered above it */
const BASELINE_THROUGH = 767;

/** a migration file the chain skips: a dry run, a verify, a one-off data script, a purge.
 *  BCP-MIG (17 Oct): `_LIST` is gone — under /i it matched `supplier_list`, so b270 (supplier_list RLS) never ran on a rebuilt database;
 *  the purge_*_LIST file it was for is skipped by `purge`.
 *  RUN-* (20 Oct, Athi): a one-off file Athi runs by hand in the SQL editor (a role, a grant fix) — never part of the chain;
 *  what it changed is folded into the baseline by DB-3. */
const CHAIN_SKIP = /dryrun|verify|COMMIT|purge|^READ-|^RUN-|^sim01|^net0/i;
const numOf = (f) => Number(/b(\d+)/.exec(f)[1]);
const CHAIN_NAME = /^b\d+[a-z]?_.*\.sql$/;
/** the chain after the baseline, in number order (b768 before b768a). A letter suffix is IN the chain (BCP-MIG, 17 Oct).
 *  Only migrations/ itself is read (never archive/), and only numbers above BASELINE_THROUGH. */
function chainFiles() {
  return fs
    .readdirSync(M)
    .filter((item) => CHAIN_NAME.test(item) && !CHAIN_SKIP.test(item) && numOf(item) > BASELINE_THROUGH)
    .sort((first, second) => numOf(first) - numOf(second) || first.localeCompare(second));
}
/** every SQL file AS WRITTEN, by folder then name: migrations/archive/ (before the baseline) then migrations/ (after it) — never the
 *  baseline itself, which is a pg_dump. For the static guards that read definitions out of the files.
 *  → [{ name, path (absolute), rel ('migrations/…' or 'migrations/archive/…') }] */
function writtenSqlFiles() {
  const list = (dir, shown) =>
    (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
      .filter((file) => file.endsWith('.sql') && !BASELINE.includes(file))
      .sort()
      .map((file) => ({ name: file, path: path.join(dir, file), rel: shown + file }));
  return list(path.join(M, 'archive'), 'migrations/archive/').concat(list(M, 'migrations/'));
}
/** chain-shaped files numbered at or below the baseline: written after it by mistake, they would never run — apply() names them */
function strayFiles() {
  return fs.readdirSync(M).filter((file) => CHAIN_NAME.test(file) && !CHAIN_SKIP.test(file) && numOf(file) <= BASELINE_THROUGH);
}
const shaOf = (f) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(M, f)))
    .digest('hex');
const safe = (url) => String(url).replace(/:[^:@/]+@/, ':***@');

function psql(url, file, stopOnError) {
  const list = ['-X', '-q', '-d', url, '-f', file].concat(stopOnError ? ['-v', 'ON_ERROR_STOP=1'] : []);
  const r = spawnSync('psql', list, { encoding: 'utf8', cwd: API });
  if (r.error) throw new Error('psql is needed to apply migrations and was not found on PATH (' + r.error.message + ')');
  const errs = (r.stderr || '').split('\n').filter((item) => /ERROR/.test(item));
  return { ok: r.status === 0, errs };
}

function open(url) {
  const { Pool } = require(path.join(API, 'node_modules', 'pg'));
  const ssl = require('../db/connect-config').sslFor(url, process.env);
  const pool = new Pool(Object.assign({ connectionString: url, max: 2, connectionTimeoutMillis: 5000 }, ssl === undefined ? {} : { ssl }));
  return pool;
}
async function hasTable(pool, name) {
  return (await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [name])).rows.length > 0;
}
async function ledger(pool) {
  const r = await pool.query('SELECT filename, sha256, source FROM schema_migrations');
  return new Map(r.rows.map((x) => [x.filename, x]));
}
async function record(pool, files, source) {
  for (const f of files) {
    await pool.query(
      `INSERT INTO schema_migrations (filename, sha256, source) VALUES ($1, $2, $3)
                      ON CONFLICT (filename) DO UPDATE SET sha256 = EXCLUDED.sha256, source = EXCLUDED.source, applied_at = now()`,
      [f, fs.existsSync(path.join(M, f)) ? shaOf(f) : null, source]
    );
  }
}

/**
 * apply(url, { say }) → { ran: [...], failed: [...], skipped: n, fresh, left_alone? }. The one writer of schema_migrations rows with
 * source 'migrate'. A file that fails is reported and NOT recorded, so the next run tries it again.
 */
async function apply(url, opts) {
  const say = (opts && opts.say) || ((m) => console.log('  · ' + m));
  const pool = open(url);
  try {
    await pool.query('SELECT 1');
    const fresh = !(await hasTable(pool, 'identities'));
    const hadLedger = await hasTable(pool, 'schema_migrations');
    /* a database with tables and no (or an empty) ledger is somebody's live data whose history we cannot see: touch NOTHING */
    if (!fresh && (!hadLedger || [...(await ledger(pool)).keys()].filter((item) => item !== LEDGER_FILE).length === 0)) {
      say(
        'the database has tables and ' +
          (hadLedger ? 'its ledger is empty' : 'no ledger (' + LEDGER_FILE + ')') +
          ' — nothing run. Record what it already has first:'
      );
      say('  run migrations/archive/' + LEDGER_FILE + ' as the owner, then: node tools/migrate.cjs --db <url> --record-through bNNN   (the last migration it has had)');
      return { ran: [], failed: [], skipped: 0, fresh, left_alone: true };
    }
    /* the baseline makes schema_migrations itself, so an empty database that already has one was half-built by hand: stop */
    if (fresh && hadLedger) throw new Error('the database has no identities table but has schema_migrations — drop it and build again, or record what it has');
    const list = [],
      failed = [];
    if (fresh) {
      say('schema: ' + BASELINE[0]);
      const r = psql(url, path.join(M, BASELINE[0]), true);
      if (!r.ok) throw new Error(BASELINE[0] + ' failed: ' + r.errs[0]);
      await record(pool, BASELINE, 'migrate');
      list.push(...BASELINE);
    }
    const stray = strayFiles();
    if (stray.length) say('schema: NOT RUN — numbered at or below the baseline (b' + BASELINE_THROUGH + '), renumber them above it: ' + stray.join(', '));
    const done = await ledger(pool);
    const files = chainFiles(),
      todo = files.filter((item) => !done.has(item));
    for (const f of todo) {
      const x = psql(url, path.join(M, f), true);
      if (x.ok) {
        await record(pool, [f], 'migrate');
        list.push(f);
      } else
        failed.push(
          f +
            ' — ' +
            String(x.errs[0] || '')
              .replace(/^psql:[^ ]+ /, '')
              .slice(0, 110)
        );
    }
    say(
      'schema: ' +
        (todo.length - failed.length) +
        ' of ' +
        todo.length +
        ' pending migration(s) applied · ' +
        (files.length - todo.length) +
        ' already in the ledger'
    );
    if (failed.length) {
      say('schema: not applied (ops roles, one-off data scripts, the register) — not recorded, tried again next run:');
      failed.forEach((item) => console.log('      ' + item));
    }
    return { ran: list, failed, skipped: files.length - todo.length, fresh };
  } finally {
    await pool.end();
  }
}

async function status(url) {
  const pool = open(url);
  try {
    if (!(await hasTable(pool, 'schema_migrations'))) return { ledger: false };
    const done = await ledger(pool);
    const all = BASELINE.concat(chainFiles());
    const pending = all.filter((item) => !done.has(item));
    const changed = all.filter((item) => done.has(item) && done.get(item).sha256 && done.get(item).sha256 !== shaOf(item));
    return { ledger: true, recorded: done.size, pending, changed };
  } finally {
    await pool.end();
  }
}

async function recordFiles(url, files) {
  const unknown = files.filter((item) => !fs.existsSync(path.join(M, item)));
  if (unknown.length) throw new Error('not in migrations/: ' + unknown.join(', '));
  const pool = open(url);
  try {
    if (!(await hasTable(pool, 'schema_migrations'))) throw new Error('no schema_migrations table — run ' + LEDGER_FILE + ' first (as the owner)');
    await record(pool, files, 'recorded');
    return files.length;
  } finally {
    await pool.end();
  }
}
/** every baseline + chain file up to and including bNNN (b304a counts as b304) */
function through(bnnn) {
  const n = Number(String(bnnn || '').replace(/^b/i, ''));
  if (!Number.isInteger(n) || n <= 0) throw new Error('--record-through takes a migration number, e.g. b304');
  return BASELINE.concat(chainFiles().filter((item) => numOf(item) <= n));
}

module.exports = { apply, status, recordFiles, through, chainFiles, strayFiles, writtenSqlFiles, CHAIN_SKIP, LEDGER_FILE, LEDGER_PATH, BASELINE, BASELINE_THROUGH };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (k) => {
    const i = argv.indexOf('--' + k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const url = arg('db') || process.env.DATABASE_URL || '';
  const fail = (m) => {
    console.error('\n  migrate: ' + m + '\n');
    process.exit(1);
  };
  if (!url) fail('say which database: --db postgres://… (or set DATABASE_URL)');
  (async () => {
    console.log('\n── migrate · ' + safe(url).replace(/\?.*$/, '') + ' ──');
    if (argv.includes('--status')) {
      const s = await status(url);
      if (!s.ledger) {
        console.log('  no schema_migrations table — ' + LEDGER_FILE + ' has not run here');
        return;
      }
      console.log('  ' + s.recorded + ' file(s) recorded · ' + s.pending.length + ' pending · ' + s.changed.length + ' changed since they ran');
      s.pending.forEach((item) => console.log('    pending  ' + item));
      s.changed.forEach((item) => console.log('    changed  ' + item));
      return;
    }
    if (argv.includes('--record-through')) {
      const n = await recordFiles(url, through(arg('record-through')));
      console.log('  recorded ' + n + ' file(s) through ' + arg('record-through') + ' (source recorded)');
      return;
    }
    const ri = argv.indexOf('--record');
    if (ri >= 0) {
      const rest = argv.slice(ri + 1),
        stop = rest.findIndex((item) => item.startsWith('--'));
      const files = (stop < 0 ? rest : rest.slice(0, stop)).map((item) => path.basename(item));
      if (!files.length) fail('--record names the file(s) you ran, e.g. --record ' + LEDGER_FILE);
      const n = await recordFiles(url, files);
      console.log('  recorded ' + n + ' file(s): ' + files.join(', '));
      return;
    }
    const r = await apply(url);
    if (r.fresh && !r.left_alone)
      for (const t of ['identities', 'chit_header', 'journal_entry', 'books_setting', 'customer_list', 'catalogue_items']) {
        const pool = open(url);
        const ok = await hasTable(pool, t);
        await pool.end();
        if (!ok) fail('table ' + t + ' is missing after the schema');
      }
  })().catch((e) => fail(e.message));
}

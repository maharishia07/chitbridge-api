#!/usr/bin/env node
/**
 * tools/migrate.cjs — THE SCHEMA PATH, WITH A LEDGER (HX1). Moved here from tools/sim-load.cjs (applySchema, HX0) and widened: every
 * file it runs is written into `schema_migrations` (b304), and a file already there is skipped — so a second deploy runs only what is new.
 *
 *   node tools/migrate.cjs --db <url>                       apply: an EMPTY database gets the chain (000_baseline → part2 passes → every
 *                                                           bNNN in number order, migrations/MANIFEST.md); a database with a ledger gets
 *                                                           the chain files the ledger does not name. A database WITH tables and an EMPTY
 *                                                           ledger is left alone (exit 0) — record what it has first (below).
 *   node tools/migrate.cjs --db <url> --status              what the ledger says: pending files, files changed since they ran. Reads only.
 *   node tools/migrate.cjs --db <url> --record <file> …     the owner ran these by hand → write their rows (source 'recorded'). Runs no SQL file.
 *   node tools/migrate.cjs --db <url> --record-through bNNN every chain file up to bNNN, recorded the same way — the one-time backfill.
 * <url> defaults to DATABASE_URL. Needs psql on PATH for apply (the migrate image has it). TLS: db/connect-config.js (the URL's sslmode).
 * ⚠️ NOTHING RUNS THIS ON PRODUCTION BY ITSELF — the api never calls it; the compose stack's one-shot `migrate` job does, on its own
 * database. On production the owner still runs the SQL; --record makes that visible.
 */
'use strict';
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const API = path.join(__dirname, '..');
const M = path.join(API, 'migrations');
const LEDGER_FILE = 'b304_schema_migrations.sql';
const BASELINE = ['000_baseline.sql', '000_baseline_part2.sql'];

/** a migration file the chain skips: a dry run, a verify, a one-off data script, a purge */
const CHAIN_SKIP = /dryrun|verify|_LIST|COMMIT|purge|^READ-|^sim01|^net0/i;
const numOf = (f) => Number(/b(\d+)/.exec(f)[1]);
/** the chain after the baseline, in number order (b105 before b105a, migration_b48 among the b4x) */
function chainFiles() {
  return fs.readdirSync(M).filter((f) => /^(migration_b(4[2-9]|5[0-7])|b\d+)_.*\.sql$/.test(f) && !CHAIN_SKIP.test(f))
    .sort((a, b) => numOf(a) - numOf(b) || a.localeCompare(b));
}
const shaOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(M, f))).digest('hex');
const safe = (url) => String(url).replace(/:[^:@/]+@/, ':***@');

function psql(url, file, stopOnError) {
  const a = ['-X', '-q', '-d', url, '-f', file].concat(stopOnError ? ['-v', 'ON_ERROR_STOP=1'] : []);
  const r = spawnSync('psql', a, { encoding: 'utf8', cwd: API });
  if (r.error) throw new Error('psql is needed to apply migrations and was not found on PATH (' + r.error.message + ')');
  const errs = (r.stderr || '').split('\n').filter((l) => /ERROR/.test(l));
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
    await pool.query(`INSERT INTO schema_migrations (filename, sha256, source) VALUES ($1, $2, $3)
                      ON CONFLICT (filename) DO UPDATE SET sha256 = EXCLUDED.sha256, source = EXCLUDED.source, applied_at = now()`,
      [f, fs.existsSync(path.join(M, f)) ? shaOf(f) : null, source]);
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
    if (!fresh && (!hadLedger || [...(await ledger(pool)).keys()].filter((f) => f !== LEDGER_FILE).length === 0)) {
      say('the database has tables and ' + (hadLedger ? 'its ledger is empty' : 'no ledger (' + LEDGER_FILE + ')') + ' — nothing run. Record what it already has first:');
      say('  run ' + LEDGER_FILE + ' as the owner, then: node tools/migrate.cjs --db <url> --record-through bNNN   (the last migration it has had)');
      return { ran: [], failed: [], skipped: 0, fresh, left_alone: true };
    }
    if (!hadLedger) {
      const x = psql(url, path.join(M, LEDGER_FILE), true);
      if (!x.ok) throw new Error(LEDGER_FILE + ' failed: ' + x.errs[0]);
    }
    let done = await ledger(pool);
    const ran = [], failed = [];
    if (fresh) {
      say('schema: 000_baseline.sql');
      let r = psql(url, path.join(M, BASELINE[0]), true);
      if (!r.ok) throw new Error('000_baseline.sql failed: ' + r.errs[0]);
      /* part2 lists constraints alphabetically — a FOREIGN KEY to identities comes before identities' PRIMARY KEY — so it is run in
         passes until the only errors left are "already exists" (each pass adds what the last one could not) */
      let left = Infinity;
      for (let pass = 1; pass <= 6; pass++) {
        r = psql(url, path.join(M, BASELINE[1]), false);
        const real = r.errs.filter((l) => !/already exists|multiple primary keys|already a primary/.test(l));
        say('schema: 000_baseline_part2.sql pass ' + pass + ' — ' + real.length + ' statement(s) still waiting');
        if (real.length === 0 || real.length >= left) break;
        left = real.length;
      }
      await record(pool, BASELINE, 'migrate'); ran.push(...BASELINE);
    }
    if (!hadLedger) { await record(pool, [LEDGER_FILE], 'migrate'); ran.push(LEDGER_FILE); }
    done = await ledger(pool);
    const files = chainFiles(), todo = files.filter((f) => !done.has(f));
    for (const f of todo) {
      const x = psql(url, path.join(M, f), true);
      if (x.ok) { await record(pool, [f], 'migrate'); ran.push(f); }
      else failed.push(f + ' — ' + String(x.errs[0] || '').replace(/^psql:[^ ]+ /, '').slice(0, 110));
    }
    say('schema: ' + (todo.length - failed.length) + ' of ' + todo.length + ' pending migration(s) applied · ' + (files.length - todo.length) + ' already in the ledger');
    if (failed.length) { say('schema: not applied (ops roles, one-off data scripts, the register) — not recorded, tried again next run:'); failed.forEach((f) => console.log('      ' + f)); }
    return { ran, failed, skipped: files.length - todo.length, fresh };
  } finally { await pool.end(); }
}

async function status(url) {
  const pool = open(url);
  try {
    if (!(await hasTable(pool, 'schema_migrations'))) return { ledger: false };
    const done = await ledger(pool);
    const all = BASELINE.concat(chainFiles());
    const pending = all.filter((f) => !done.has(f));
    const changed = all.filter((f) => done.has(f) && done.get(f).sha256 && done.get(f).sha256 !== shaOf(f));
    return { ledger: true, recorded: done.size, pending, changed };
  } finally { await pool.end(); }
}

async function recordFiles(url, files) {
  const unknown = files.filter((f) => !fs.existsSync(path.join(M, f)));
  if (unknown.length) throw new Error('not in migrations/: ' + unknown.join(', '));
  const pool = open(url);
  try {
    if (!(await hasTable(pool, 'schema_migrations'))) throw new Error('no schema_migrations table — run ' + LEDGER_FILE + ' first (as the owner)');
    await record(pool, files, 'recorded');
    return files.length;
  } finally { await pool.end(); }
}
/** every baseline + chain file up to and including bNNN (b304a counts as b304) */
function through(bnnn) {
  const n = Number(String(bnnn || '').replace(/^b/i, ''));
  if (!Number.isInteger(n) || n <= 0) throw new Error('--record-through takes a migration number, e.g. b304');
  return BASELINE.concat(chainFiles().filter((f) => numOf(f) <= n));
}

module.exports = { apply, status, recordFiles, through, chainFiles, CHAIN_SKIP, LEDGER_FILE };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const url = arg('db') || process.env.DATABASE_URL || '';
  const fail = (m) => { console.error('\n  migrate: ' + m + '\n'); process.exit(1); };
  if (!url) fail('say which database: --db postgres://… (or set DATABASE_URL)');
  (async () => {
    console.log('\n── migrate · ' + safe(url).replace(/\?.*$/, '') + ' ──');
    if (argv.includes('--status')) {
      const s = await status(url);
      if (!s.ledger) { console.log('  no schema_migrations table — ' + LEDGER_FILE + ' has not run here'); return; }
      console.log('  ' + s.recorded + ' file(s) recorded · ' + s.pending.length + ' pending · ' + s.changed.length + ' changed since they ran');
      s.pending.forEach((f) => console.log('    pending  ' + f));
      s.changed.forEach((f) => console.log('    changed  ' + f));
      return;
    }
    if (argv.includes('--record-through')) { const n = await recordFiles(url, through(arg('record-through'))); console.log('  recorded ' + n + ' file(s) through ' + arg('record-through') + ' (source recorded)'); return; }
    const ri = argv.indexOf('--record');
    if (ri >= 0) {
      const rest = argv.slice(ri + 1), stop = rest.findIndex((a) => a.startsWith('--'));
      const files = (stop < 0 ? rest : rest.slice(0, stop)).map((f) => path.basename(f));
      if (!files.length) fail('--record names the file(s) you ran, e.g. --record ' + LEDGER_FILE);
      const n = await recordFiles(url, files); console.log('  recorded ' + n + ' file(s): ' + files.join(', ')); return;
    }
    const r = await apply(url);
    if (r.fresh && !r.left_alone) for (const t of ['identities', 'chit_header', 'journal_entry', 'books_setting', 'customer_list', 'catalogue_items']) {
      const pool = open(url); const ok = await hasTable(pool, t); await pool.end(); if (!ok) fail('table ' + t + ' is missing after the schema');
    }
  })().catch((e) => fail(e.message));
}

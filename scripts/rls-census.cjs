'use strict';
/**
 * rls-census.cjs — THE LIVE RLS STATE, AGAINST A BASELINE THAT IS COMMITTED ([TILL-169]).
 *
 * ── ⚠️⚠️⚠️ WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────
 *
 * Athi, after b264 shipped a table with no row level security: *"do we know how many tables RLS enabled and
 * cannot loose the track? do we have any health check as part of regression run? possibly need to create the
 * regression pack which has to check all those, and raise alert."*
 *
 * We had TWO checks and neither could have caught it:
 *   · rls-context.test.cjs   — that a tenant read without a context answers zero, which is a CODE rule
 *   · rls-predicate.test.cjs — that a policy reads a GUC something sets … and it was never declared in
 *                              guards.cjs, so it had never run. A guard nobody runs is not a guard.
 * Both read SOURCE. Neither asks the database what is actually true, and the database is where a table ends up
 * open — by `ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cb_app`
 * (migration_b48), which arms every new public table with full CRUD the moment it is created.
 *
 * ⭐⭐ SO THIS ASKS THE DATABASE, and compares the answer to db/rls-baseline.json, which is in git.
 *   · a table that HAD row level security and no longer does          → FAIL
 *   · a table that HAD policies and now has fewer                     → FAIL
 *   · a NEW table with no RLS that cb_app can read                    → FAIL
 *   · a table that has GAINED protection                              → pass, and the baseline is stale
 *
 * ⚠️ THE BASELINE RECORDS WHAT IS TRUE TODAY, INCLUDING WHAT IS WRONG. 59 public tables are open and readable
 * by cb_app right now; most are the legacy `cb_*` schema. Freezing that number is not blessing it — it is the
 * only way to know tomorrow whether it grew. The list is in the backlog to be worked down.
 *
 *   node scripts/rls-census.cjs          compare against the baseline  (exit 1 on a regression)
 *   node scripts/rls-census.cjs --save   write the baseline from live
 *
 * Needs DATABASE_URL, so it belongs in the regression pack, not in the offline guard suite.
 */
const fs = require('fs'), path = require('path');
const { Pool } = require('pg');

const BASE = path.join(__dirname, '..', 'db', 'rls-baseline.json');
const SAVE = process.argv.indexOf('--save') >= 0;

/** ⚠️ one query, so the picture cannot be half-read: state, force, policy count and what cb_app may do */
const SQL = `
  select c.relname                        as t,
         c.relrowsecurity                 as rls,
         c.relforcerowsecurity            as forced,
         (select count(*)::int from pg_policies p
           where p.schemaname = 'public' and p.tablename = c.relname) as policies,
         has_table_privilege('cb_app', c.oid, 'SELECT') as app_reads
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by 1`;

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  let rows;
  try { rows = (await pool.query(SQL)).rows; }
  catch (e) { console.error('cannot read the census: ' + e.message); process.exit(2); }
  await pool.end();

  const now = {};
  rows.forEach((r) => { now[r.t] = { rls: !!r.rls, forced: !!r.forced, policies: r.policies, app_reads: !!r.app_reads }; });
  const on = rows.filter((r) => r.rls).length;
  const openRead = rows.filter((r) => !r.rls && r.app_reads).length;

  console.log('\n── RLS census ' + '─'.repeat(52));
  console.log('  tables in public        ' + rows.length);
  console.log('  row level security ON   ' + on);
  console.log('  OFF and cb_app can read ' + openRead + (openRead ? '   ⚠️ every one of these is cross-tenant readable' : ''));

  if (SAVE) {
    fs.mkdirSync(path.dirname(BASE), { recursive: true });
    fs.writeFileSync(BASE, JSON.stringify({ at: new Date().toISOString(), tables: now }, null, 1) + '\n');
    console.log('\n  baseline written: db/rls-baseline.json  (' + Object.keys(now).length + ' tables)');
    console.log('  ⚠️ committing this freezes today\'s state, including what is wrong — so a regression is visible.\n');
    return;
  }

  if (!fs.existsSync(BASE)) {
    console.error('\n  no baseline. Run with --save once, read it, and commit it.\n');
    process.exit(2);
  }
  const was = JSON.parse(fs.readFileSync(BASE, 'utf8')).tables;
  const lost = [], weaker = [], fresh = [], gained = [], gone = [];

  Object.keys(was).forEach((t) => {
    if (!now[t]) { gone.push(t); return; }
    /* ⚠️⚠️ THE ONE THAT MATTERS: protection that was there and is not */
    if (was[t].rls && !now[t].rls) lost.push(t);
    else if (was[t].policies > now[t].policies) weaker.push(t + ' (' + was[t].policies + ' → ' + now[t].policies + ')');
    else if (!was[t].rls && now[t].rls) gained.push(t);
  });
  Object.keys(now).forEach((t) => {
    if (!was[t] && !now[t].rls && now[t].app_reads) fresh.push(t);
  });

  const say = (label, list, bad) => {
    if (!list.length) return;
    console.log('\n  ' + (bad ? '⚠️ ' : '') + label + ':');
    list.forEach((x) => console.log('     ' + x));
  };
  say('LOST row level security', lost, true);
  say('FEWER policies than before', weaker, true);
  say('NEW, open, and readable by cb_app', fresh, true);
  say('gained protection since the baseline — please re-save it', gained, false);
  say('no longer exist', gone, false);

  const broken = lost.length + weaker.length + fresh.length;
  console.log('\n' + (broken
    ? '  ✗ ' + broken + ' regression(s). A table that loses RLS is readable across every tenant.\n'
    : '  ✓ nothing lost protection since ' + JSON.parse(fs.readFileSync(BASE, 'utf8')).at.slice(0, 10) + '\n'));
  process.exit(broken ? 1 : 0);
})();

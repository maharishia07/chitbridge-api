#!/usr/bin/env node
/**
 * ── scripts/sql.cjs · RUN A MIGRATION FROM VS CODE, AND SAY WHICH SIDE OF RLS IT RAN ON ────────────────────────
 *
 * Athi, 2026-09-10: *"how do we connect supabase in VS Code itself so we can execute from there, by some command
 * or maybe you can invoke?"* — then, immediately: *"with RLS?"*
 *
 * ⭐⭐⭐ THE SECOND QUESTION IS THE WHOLE DESIGN OF THIS FILE, and the answer is one most people get wrong.
 *
 * The Supabase SQL editor signs you in as **postgres** — the project owner, SUPERUSER, therefore BYPASSRLS. So
 * every migration in this repo has been run **WITHOUT RLS**: the policies did not apply, and neither did the
 * `WITH CHECK` clause that would otherwise refuse a row landing in the wrong entity. That is why those files say
 * `SELECT set_config('app.current_entity', …)` by hand — and why b209 argues at length that setting it is the
 * *safer* way round. It was the only net there was.
 *
 * ⚠️ AND THIS FILE DOES NOT ASSUME WHICH ROLE YOUR `DATABASE_URL` CARRIES. It asks, every run, and prints the
 * answer — because the app's own connection is supposed to be `cb_app` (that is what B1 bought), while a string
 * copied from the dashboard is `postgres`, and the two behave in opposite ways with no visible difference until
 * something silently writes into the wrong shop. `scripts/check-db-role.js` has answered exactly this since B1;
 * this is the same question asked at the top of every run instead of once.
 *
 * ⚠️⚠️ AND THE NET DOES NOT HANG ITSELF. Setting `app.current_entity` under a BYPASSRLS role changes NOTHING —
 * the policy is not consulted, so a wrong uuid writes into the wrong shop in silence. The setting only bites when
 * the role is actually subject to the policy. So this script does the thing the editor cannot:
 *
 *      --entity <uuid>     SET ROLE cb_app, then set the entity  →  runs WITH RLS, exactly as production does
 *      --as-owner          stay postgres                          →  runs WITHOUT RLS, and says so, loudly
 *
 * ⭐ USE --entity FOR DATA AND --as-owner FOR STRUCTURE. Seeding rows, backfills, anything touching a shop's own
 * data: run it WITH RLS and let the database refuse your mistake. CREATE TABLE, GRANT, ALTER — those need
 * ownership and cannot be done any other way, so they are the only honest use of --as-owner.
 * A file needing both (b213 is one: a table, then a seed) is run twice, in two passes. That is not a limitation
 * to work around; it is the seam between "changing the shape" and "changing the contents", and they deserve
 * different privileges.
 *
 * ── HOW IT RUNS THE FILE ──────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ IT DOES NOT SPLIT ON SEMICOLONS. A splitter has to understand dollar-quoting ($$ … $$, which b213 uses for
 * its RAISE NOTICE block), nested $tag$, string literals containing semicolons and -- comments — and a splitter
 * that gets one of those wrong runs half a migration. node-postgres sends a parameterless query over the SIMPLE
 * QUERY protocol, and Postgres executes a multi-statement string in one go: which is precisely what the SQL
 * editor does. So the file goes across whole, verbatim, and Postgres does the parsing. Adopt the protocol rather
 * than reinvent its parser.
 *
 *     node scripts/sql.cjs migrations/b213_reward_ledger.sql                 look only: role, RLS, what is in it
 *     node scripts/sql.cjs migrations/b213_reward_ledger.sql --as-owner --write
 *     node scripts/sql.cjs migrations/b213_reward_ledger.sql --entity <uuid> --write
 *     node scripts/sql.cjs -e "select count(*) from reward_ledger" --entity <uuid> --write
 *
 * Without --write it connects, reports and runs NOTHING. That default is deliberate: the commonest use of this
 * script is answering "what would this do", and a tool whose safe mode needs a flag is a tool that will one day
 * be run without it.
 */
'use strict';
require('dotenv').config();
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const file = argv.find((a) => !a.startsWith('-') && a !== val('--entity') && a !== val('-e'));

const WRITE = has('--write');
const ENTITY = val('--entity');
const OWNER = has('--as-owner');
const INLINE = val('-e');
const FORCE = has('--i-mean-it');

/* ⚠️ REFUSED, NOT WARNED ABOUT. A tool that prints a warning and proceeds has taught its user to skip warnings. */
const DESTRUCTIVE = /\b(DROP\s+(TABLE|SCHEMA|DATABASE|COLUMN)|TRUNCATE|DELETE\s+FROM)\b/i;

function die(msg, code) { console.error('\n  ' + msg + '\n'); process.exit(code == null ? 1 : code); }

(async () => {
  if (!INLINE && !file) die('usage: node scripts/sql.cjs <file.sql | -e "SQL"> [--entity <uuid> | --as-owner] [--write]', 2);
  if (ENTITY && OWNER) die('--entity and --as-owner are opposite answers to "with RLS?" — pick one.', 2);
  /* ⚠️ ASKED BEFORE ANYTHING IS OPENED. Which side of RLS this runs on is a decision, not an environment problem,
     and answering it after a failed connection buries a usage error under whatever the network happened to say. */
  if (!ENTITY && !OWNER)
    die('say which side of RLS this runs on:\n'
      + '    --entity <uuid>   WITH RLS    · for data — the database refuses a row that lands in the wrong shop\n'
      + '    --as-owner        WITHOUT RLS · for structure (CREATE, ALTER, GRANT), which needs ownership', 2);

  const sql = INLINE || fs.readFileSync(path.resolve(file), 'utf8');
  const what = INLINE ? '-e "' + INLINE.slice(0, 60) + (INLINE.length > 60 ? '…' : '') + '"' : file;

  /* ⚠️ REFUSED BEFORE A CONNECTION IS OPENED. Whether a file drops a table is a property of the FILE — checking
     it after connecting to production means the dangerous case is the one that has already reached the door. */
  if (DESTRUCTIVE.test(sql) && !FORCE)
    die('this file DROPs, TRUNCATEs or DELETEs. Read it, decide, then re-run with --i-mean-it.', 5);

  const url = process.env.DATABASE_URL;
  if (!url || /\[YOUR-REF\]|<.*>/.test(url))
    die('DATABASE_URL in chitbridge-api/.env is still the placeholder — there is no database to reach from here.\n'
      + '  Paste the real connection string (Supabase → Project Settings → Database → Connection string → URI)\n'
      + '  into .env yourself. It is a credential: put it there by hand, and it is already gitignored.', 3);

  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try { await c.connect(); } catch (e) { die('could not connect: ' + e.message, 3); }

  /* ⭐ ALWAYS ANSWERED, NEVER ASSUMED — the standing rule is to say WITH or WITHOUT RLS unprompted */
  const who = (await c.query(
    `SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)).rows[0] || {};
  const bypasses = !!(who.rolsuper || who.rolbypassrls);

  let mode, rls;
  if (ENTITY) {
    /* ⚠️ SET ROLE FIRST, THEN THE ENTITY. The other order sets a variable nothing is reading yet, and a variable
       set for a role that bypasses RLS is decoration. */
    try { await c.query('SET ROLE cb_app'); }
    catch (e) { await c.end(); die('could not SET ROLE cb_app (' + e.message + ').\n'
      + '  That role is what production connects as; without it this cannot run WITH RLS.', 4); }
    const check = (await c.query(
      `SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)).rows[0] || {};
    if (check.rolsuper || check.rolbypassrls) { await c.end();
      die('cb_app itself bypasses RLS — then nothing on this platform is isolated. Stop and check the role.', 4); }
    await c.query(`SELECT set_config('app.current_entity', $1, false)`, [ENTITY]);
    mode = 'cb_app · app.current_entity = ' + ENTITY;
    rls = 'WITH RLS';
  } else if (OWNER) {
    mode = who.current_user + (bypasses ? ' (superuser / bypassrls)' : '');
    rls = 'WITHOUT RLS';
  }   /* no third case: the flags were settled before the connection was opened */

  console.log('');
  console.log('  file      ' + what);
  console.log('  role      ' + mode);
  console.log('  ▸ ' + rls + (rls === 'WITHOUT RLS'
    ? '  — policies do not apply and WITH CHECK will not refuse a wrong entity_id.'
    : '  — every row is checked against the entity above, exactly as the app is.'));

  /* ⚠️ AN OUTLINE, AND SAID TO BE ONE. Postgres does the parsing; this only counts what a person would recognise,
     so nothing here decides what runs. A regex that pretended to be a parser is the bug this file avoids. */
  const verbs = (sql.match(/^\s*(CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|SELECT|BEGIN|COMMIT|DO)\b/gim) || [])
    .map((s) => s.trim().toUpperCase());
  const tally = verbs.reduce((a, v) => (a[v] = (a[v] || 0) + 1, a), {});
  console.log('  contains  ' + (Object.keys(tally).map((k) => k + '×' + tally[k]).join(' · ') || '(nothing recognised)'));

  if (!WRITE) {
    /* ⚠️ AND IT SAYS WHAT IT CANNOT PROMISE. A file with its own COMMIT cannot be wrapped in a rollback, so there
       is no such thing as a dry run of it — pretending otherwise would be the most dangerous line in the file. */
    console.log('  ▸ LOOKED ONLY. Nothing ran. Add --write to execute.');
    if (/^\s*COMMIT\s*;/im.test(sql))
      console.log('    ⚠ this file COMMITs on its own, so --write is final: it cannot be rolled back afterwards.');
    await c.end(); return;
  }

  console.log('  ▸ running…\n');
  try {
    /* ⭐ THE WHOLE FILE, ONE SIMPLE QUERY — the same thing the SQL editor sends, so a run here means the same
       thing as a run there. Postgres returns one result per statement. */
    const out = await c.query(sql);
    const results = Array.isArray(out) ? out : [out];
    results.forEach((r, i) => {
      if (!r) return;
      const n = String(i + 1).padStart(2, ' ');
      if (r.command === 'SELECT' && r.rows && r.rows.length) {
        console.log('  ' + n + '  SELECT → ' + r.rows.length + ' row(s)');
        console.table(r.rows.slice(0, 20));
        if (r.rows.length > 20) console.log('      … ' + (r.rows.length - 20) + ' more');
      } else {
        console.log('  ' + n + '  ' + (r.command || '?') + (r.rowCount != null ? ' ' + r.rowCount : ''));
      }
    });
    console.log('\n  ▸ done · ' + rls + '\n');
  } catch (e) {
    /* ⚠️ THE POSITION AND THE HINT, not just the message. Postgres says exactly where it stopped, and a runner
       that throws that away makes a person re-find it by eye in a 150-line migration. */
    console.error('\n  ▸ FAILED · ' + rls);
    console.error('    ' + e.message);
    if (e.position) {
      const upto = sql.slice(0, Number(e.position));
      console.error('    at line ' + (upto.split('\n').length) + ': ' + (upto.split('\n').pop() || '').trim());
    }
    if (e.hint) console.error('    hint: ' + e.hint);
    if (e.detail) console.error('    detail: ' + e.detail);
    console.error('');
    process.exitCode = 1;
  } finally { await c.end(); }
})();

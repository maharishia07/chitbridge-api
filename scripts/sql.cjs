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

  /**
   * ⚠️⚠️ THE CONNECTION GOES THROUGH A POOLER, AND THAT CHANGES HOW THE ENTITY MUST BE SET.
   * Railway's DATABASE_URL points at `…pooler.supabase.com:6543` — PgBouncer in TRANSACTION pooling mode, where a
   * server connection is handed back at the end of every transaction. Session state (`SET ROLE`, a `set_config`
   * with is_local=false) is therefore NOT guaranteed to survive from one statement to the next: the next one may
   * land on a different backend that never saw it.
   * ⭐ It happened to work when this was first run — which is the worst possible outcome, because "worked once
   * under a pooler" is how an intermittent RLS failure gets shipped. So the role and the entity are no longer set
   * by separate round trips; they are prepended to the SAME simple-query string as the file, which PgBouncer
   * cannot split. Deterministic by construction rather than lucky.
   * ⚠️ db.js already reached this conclusion (its inlineLiteral batching sends BEGIN, the set_config and the work
   * as one text, for the round-trip cost rather than the pooler) — same idiom, same reason it is safe.
   */
  const pooled = /pooler|pgbouncer|:6543/.test(url);
  let mode, rls, prelude = '';
  if (ENTITY) {
    /* ⚠️ VALIDATED, BECAUSE IT IS INLINED. It cannot be a bound parameter once it rides in the same text as the
       file, so anything that is not a uuid is refused rather than escaped — the narrow rule, not the clever one. */
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ENTITY)) {
      await c.end(); die('--entity must be a uuid; got "' + ENTITY + '"', 2);
    }
    /* the role has to be one this connection may assume — checked here, where the failure is still cheap */
    const may = (await c.query(
      `SELECT rolsuper, rolbypassrls, pg_has_role(current_user, 'cb_app', 'MEMBER') AS may
         FROM pg_roles WHERE rolname = 'cb_app'`)).rows[0];
    if (!may) { await c.end(); die('there is no cb_app role on this database.', 4); }
    if (may.rolsuper || may.rolbypassrls) { await c.end();
      die('cb_app bypasses RLS — then nothing on this platform is isolated. Stop and check the role.', 4); }
    if (!may.may && who.current_user !== 'cb_app') { await c.end();
      die('this connection (' + who.current_user + ') may not SET ROLE cb_app.', 4); }
    /* ⚠️ SET ROLE FIRST, THEN THE ENTITY. The other order sets a variable nothing is reading yet, and a variable
       set for a role that bypasses RLS is decoration. Both ride at the head of the batch below. */
    prelude = "SET ROLE cb_app; SELECT set_config('app.current_entity', '" + ENTITY + "', false);\n";
    mode = 'cb_app · app.current_entity = ' + ENTITY;
    rls = 'WITH RLS';
  } else if (OWNER) {
    /**
     * ⚠️⚠️ --as-owner IS A REQUEST, NOT A FACT, and the first run against the real database proved it. The flag
     * says "do not switch role"; whether that leaves you outside RLS depends entirely on who the connection string
     * carries. Railway's DATABASE_URL is `cb_app` — NOSUPERUSER, NOBYPASSRLS — so `--as-owner` there still runs
     * WITH RLS, and printing "WITHOUT RLS" because a flag was passed would be the exact lie this script exists to
     * prevent. The line is derived from what the DATABASE said, never from what was typed.
     */
    mode = who.current_user + (bypasses ? ' (superuser / bypassrls)' : ' (NOSUPERUSER · NOBYPASSRLS)');
    rls = bypasses ? 'WITHOUT RLS' : 'WITH RLS';
    if (!bypasses) console.log('\n  ⚠ --as-owner was asked for, but ' + who.current_user + ' does not bypass RLS.\n'
      + '    Policies still apply, and DDL on tables it does not own will be refused. This connection cannot do\n'
      + '    structure — that stays a Supabase-editor job, which is the gate working rather than a fault.');
  }   /* no third case: the flags were settled before the connection was opened */

  console.log('');
  console.log('  file      ' + what);
  console.log('  role      ' + mode);
  console.log('  ▸ ' + rls + (rls === 'WITHOUT RLS'
    ? '  — policies do not apply and WITH CHECK will not refuse a wrong entity_id.'
    : ENTITY ? '  — every row is checked against the entity above, exactly as the app is.'
    /**
     * ⚠️⚠️ THE QUIETEST FAILURE ON THE PLATFORM, and it needs saying in the header rather than discovered in a
     * result. RLS applies but `app.current_entity` is unset, so `NULLIF(current_setting(…), '')::uuid` is NULL
     * and every policy is false: reads return ZERO ROWS and writes are refused. Not an error — an empty answer,
     * which looks exactly like a shop with no data. Somebody will one day conclude a table is empty from this.
     */
             : '  — but NO entity is set, so every policy is false: reads return nothing and writes are refused.\n'
             + '                 An empty result here means "you did not say which shop", NOT "there is no data".'));

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
    if (/^\s*COMMIT\s*;/im.test(sql)) {
      console.log('    ⚠ this file COMMITs on its own, so --write is final: it cannot be rolled back afterwards.');
      /* ⚠️ AND OVER A POOLER THAT IS TWO PROBLEMS, NOT ONE. Its own COMMIT ends the transaction the prelude set
         the entity in, and PgBouncer may hand the rest of the file to a different backend that never saw it —
         so the statements after the COMMIT could run with no entity at all and read nothing, silently. */
      if (pooled && ENTITY)
        console.log('    ⚠ over the transaction pooler, the entity may not survive that COMMIT. Split the file, or\n'
                  + '      run this one in the Supabase editor where the session is yours for the whole run.');
    }
    await c.end(); return;
  }

  console.log('  ▸ running…\n');
  try {
    /* ⭐ THE WHOLE FILE, ONE SIMPLE QUERY — the same thing the SQL editor sends, so a run here means the same
       thing as a run there. Postgres returns one result per statement, and the prelude (role + entity) rides at
       the head of the SAME string so a pooler cannot separate it from the work it governs. */
    const out = await c.query(prelude + sql);
    const results = (Array.isArray(out) ? out : [out]).slice(prelude ? 2 : 0);   /* hide the prelude's own results */
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

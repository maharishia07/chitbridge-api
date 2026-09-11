/**
 * tests/entity-cast-guard.test.cjs — a null entity must return NOTHING, not raise 22P02.
 *
 * Backlog: *"30 migrations use `current_setting(...)::uuid` without `NULLIF`. Latent since b132: `''::uuid`
 * raises 22P02, and `withEntity` passes `''` for a null entity."*
 *
 * ⚠️⚠️ IT IS NOT LATENT — `withEntity(null, …)` IS A DELIBERATE, LIVE CODE PATH. It is how the PUBLIC
 * storefront reads: an anonymous visitor has no tenant, so `routes/catalogue.js` binds no entity and lets the
 * visibility-aware policy return only public rows. Its own comment says so: *"withEntity(null) = no tenant
 * context, so the visibility-aware policy returns only public items (a private shop can't be ordered from
 * here)."*
 *
 * ⭐ SO THE FAILURE MODE IS REAL AND SHARP. `set_config` stores `''`; a policy written as
 * `entity_id = current_setting('app.current_entity', true)::uuid` then evaluates `''::uuid` and Postgres
 * raises **22P02 invalid input syntax for type uuid**. The anonymous read does not come back empty — it
 * ERRORS. Today's public paths happen not to reach these thirteen tables; the next one that does breaks on its
 * first request, and the message will point at a cast rather than at the missing binding.
 *
 * ⭐⭐ `NULLIF(current_setting(...), '')::uuid` FAILS CLOSED INSTEAD. `entity_id = NULL` is NULL, not true, so
 * the row is simply invisible — which is exactly what "no tenant context" should mean, and what the working
 * policies already do.
 *
 * ⚠️ THIS IS A RATCHET, NOT A PASS/FAIL. Thirty of them already exist. This pins the debt at today's number:
 * an existing file may only ever go DOWN, and a new migration may not add any. Debt you have measured and
 * capped is a different thing from debt that is still growing.
 *
 * ⚠️⚠️ AND IT COUNTS FILES, WHICH ARE NOT THE DATABASE — a distinction b181's dry run proved expensive to
 * ignore. The sources said 30 casts in 13 files; `pg_policies` on the live database said **12 policies**, and
 * two of those files (b172, b174) were already GUARDED live because a later migration had superseded them.
 *
 * ⭐ SO AFTER b181's APPLY LANDS, THESE NUMBERS ARE HISTORY, NOT A LIVE FAULT. The migration files stay as
 * written — a migration is a record of what was run, and editing one to make a checker happy would falsify
 * the history it exists to keep. What this file still earns its place doing is the FORWARD half: no NEW
 * migration may introduce the pattern. Anyone reading the count below should read this paragraph with it.
 */
const fs = require('fs');
const path = require('path');

const M = path.join(__dirname, '..', 'migrations');

/**
 * ⚠️ THE BASELINE IS EVIDENCE, NOT CONFIGURATION. Each number was the count of unguarded casts in that file.
 * Lowering one is the fix landing. Raising one, or adding a key, is the thing this test exists to refuse.
 *
 * ── ⭐⭐ AND IT IS EMPTY NOW, BECAUSE THE DEBT IS PAID — 2026-09-11 ───────────────────────────────────────────
 *
 * Athi ran b222. All fourteen policies are NULLIF-guarded in the database, and the counter reads it from the
 * tree rather than from this table: a cast in migration X is settled if a LATER migration gives that table a
 * guarded policy. 32 casts across 14 migrations, all superseded, b203 included.
 *
 * ⚠️⚠️ AND THE BASELINE WAS OVERSTATING THE DEBT BY FOUR SINCE AUGUST. b172_access_events and
 * b174_identity_documents were listed at 2 each — and b175_fix_rls_predicate.sql had already guarded both
 * tables, three weeks before b222 existed. Nobody had looked, because the number only ever had to stop going
 * UP. ⭐ A ratchet measures the direction and can be wrong about the level the whole time.
 *
 * ⭐ EMPTY IS THE STRICTEST STATE THIS CAN BE IN, not the most relaxed: every file is now checked against
 * ZERO, so one new unguarded policy is unsuperseded, unlisted, and red on the next run.
 */
const BASELINE = {};

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

/**
 * ⚠️⚠️ STRIP COMMENTS FIRST, AND THIS GUARD CAUGHT ITSELF FAILING TO. The b181 dry-run explains the bug by
 * QUOTING the broken expression in its header; the first version of this counter read that comment as a
 * fourteenth offending migration. Same species as `round-trips.cjs` charging endpoints for function names
 * written in comments — and this codebase comments heavily, in the very files it comments ABOUT.
 *
 * ⭐ A SCAN THAT READS PROSE AS CODE OVERSTATES, and an overstating guard is dismissed rather than fixed —
 * which is how a guard stops guarding.
 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')   /* block comments */
  .replace(/--[^\n]*/g, ' ');          /* line comments */

/** An unguarded cast: `current_setting(…)::uuid` NOT already wrapped in NULLIF. */
const UNGUARDED = /(NULLIF\s*\(\s*)?current_setting\s*\([^)]*\)\s*::uuid/g;
const countUnguarded = (src) => {
  let n = 0;
  for (const m of stripComments(src).matchAll(UNGUARDED)) if (!m[1]) n++;
  return n;
};

const files = fs.readdirSync(M).filter((f) => f.endsWith('.sql')).sort();

/**
 * ── ⭐⭐ A LATER MIGRATION CAN SETTLE AN EARLIER ONE'S DEBT ───────────────────────────────────────────────────
 *
 * b222 ran on 2026-09-11 and rewrote all fourteen policies with NULLIF. ⚠️ This counter reads MIGRATION TEXT,
 * and b222 did not edit those files — it could not; they are history. So the count stayed at 32 and b203 stayed
 * red, describing a database that no longer exists.
 *
 * ⚠️⚠️ AND THE MIGRATION'S OWN INSTRUCTION WAS WRONG. b222's header says "after running this, lower the
 * baseline to zero" — I wrote that, and it is the wrong fix: hand-zeroing a baseline makes the guard agree with
 * me rather than with the tree, and the next unguarded cast in an old file would then read as new debt.
 *
 * ⭐ WHAT IS ACTUALLY TRUE is that a policy REPLACES the one before it. An unguarded cast in migration X no
 * longer describes the database if a LATER migration creates a guarded policy on the same table. So the
 * counter asks that question instead of being told the answer — and the day someone writes a new unguarded
 * policy, it is unsuperseded and goes red on its own.
 *
 * ⚠️ TABLE-LEVEL, WHICH IS DELIBERATELY CONSERVATIVE. A later guarded policy on a table clears that table's
 * earlier casts; it does not clear a cast anywhere else. Migrations apply in filename order, which is the order
 * they ran, so "later" is sortable.
 */
const guardedLater = {};   /* table -> the first migration that gave it a NULLIF-guarded policy */
files.forEach((f) => {
  const sql = stripComments(fs.readFileSync(path.join(M, f), 'utf8'));
  /* a policy body carrying NULLIF, however it is written — b222 builds its own with format() */
  const direct = /CREATE\s+POLICY\s+\w+\s+ON\s+"?(\w+)"?([\s\S]{0,400}?);/gi;
  let m;
  while ((m = direct.exec(sql))) {
    if (m[2].indexOf('NULLIF') > -1 && !guardedLater[m[1].toLowerCase()]) guardedLater[m[1].toLowerCase()] = f;
  }
  /* a policy built dynamically from a table list, as b222 does */
  if (sql.indexOf('NULLIF') > -1 && /EXECUTE\s+format\s*\(/i.test(sql)) {
    const arr = sql.match(/\[\s*'[^']+'\s*,\s*'(\w+)'\s*,\s*'\w+'\s*\]/g) || [];
    arr.forEach((row) => {
      const t2 = row.match(/,\s*'(\w+)'\s*,/);
      if (t2 && !guardedLater[t2[1].toLowerCase()]) guardedLater[t2[1].toLowerCase()] = f;
    });
  }
});

/** the tables an unguarded cast in THIS file sits on */
const tablesIn = (sql) => {
  const out = new Set();
  let m;
  const re = /(?:CREATE|ALTER)\s+POLICY\s+\w+\s+ON\s+"?(\w+)"?/gi;
  while ((m = re.exec(sql))) out.add(m[1].toLowerCase());
  return [...out];
};

const found = {};
const settled = {};
let total = 0;
for (const f of files) {
  const raw = fs.readFileSync(path.join(M, f), 'utf8');
  const n = countUnguarded(raw);
  if (!n) continue;
  /* ⭐ superseded only if EVERY table this file touches was later given a guarded policy */
  const ts = tablesIn(stripComments(raw));
  const later = ts.length && ts.every((t2) => guardedLater[t2] && guardedLater[t2] > f);
  if (later) { settled[f] = n; continue; }
  found[f] = n; total += n;
}

if (Object.keys(settled).length) {
  console.log('\n  \u2b50 settled by a later guarded policy: '
    + Object.keys(settled).length + ' migration(s), '
    + Object.keys(settled).reduce((t2, k) => t2 + settled[k], 0) + ' cast(s)');
}

console.log('\n── the debt is capped at what was measured ──');
console.log('  ' + total + ' unguarded cast(s) in ' + Object.keys(found).length + ' migration(s)\n');

const added = Object.keys(found).filter((f) => !(f in BASELINE));
t('no NEW migration adds an unguarded cast', added.length === 0, added.join(' '));

const grew = Object.keys(found).filter((f) => f in BASELINE && found[f] > BASELINE[f])
  .map((f) => f + ' ' + BASELINE[f] + '→' + found[f]);
t('no existing migration grew', grew.length === 0, grew.join(' '));

/**
 * ⭐ AND A FIX MUST BE NOTICED. If a file drops below its baseline the work has been done and the number here
 * is now a lie — a stale baseline is the same failure as a stale backlog row, which cost real time this week.
 */
const shrank = Object.keys(BASELINE).filter((f) => (found[f] || 0) < BASELINE[f])
  .map((f) => f + ' ' + BASELINE[f] + '→' + (found[f] || 0));
t('the baseline still matches reality', shrank.length === 0,
  shrank.length ? 'FIXED — lower the baseline: ' + shrank.join(' ') : total + ' remaining');

/**
 * ⚠️ AND THE COUNTER MUST BE SHOWN TO COUNT. A regex that misses the guarded form would report every fixed
 * policy as still broken; one that misses the unguarded form would report a clean sweep. Both directions are
 * planted here, because every scan written this week was wrong before it was right.
 */
console.log('\n── the counter can tell the two forms apart ──');
t('an unguarded cast is counted',
  countUnguarded("entity_id = current_setting('app.current_entity', true)::uuid") === 1);
t('a NULLIF-guarded cast is NOT counted',
  countUnguarded("entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid") === 0);
t('  …and a file with both counts only the bare one',
  countUnguarded("a = NULLIF(current_setting('x', true), '')::uuid AND b = current_setting('y', true)::uuid") === 1);
/* ⚠️ THE ONE IT ACTUALLY GOT WRONG — b181's header quotes the broken expression to explain it, and the first
   version of this counter reported the dry-run as a fourteenth offending migration. */
t('  …and prose is not code: a cast inside a comment is ignored',
  countUnguarded("-- entity_id = current_setting('app.current_entity', true)::uuid\nSELECT 1;") === 0);
t('  …including block comments',
  countUnguarded("/* x = current_setting('a', true)::uuid */ SELECT 1;") === 0);

console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
process.exit(fail ? 1 : 0);

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
 * ⚠️ THE BASELINE IS EVIDENCE, NOT CONFIGURATION. Every number here was counted on 2026-08-22; each is the
 * count of unguarded casts in that file. Lowering one is the fix landing. Raising one, or adding a key, is the
 * thing this test exists to refuse.
 */
const BASELINE = {
  'b132_folder_rules.sql': 2,
  'b135_wholesaler_stores.sql': 2,
  'b137_chit_amendment.sql': 2,
  'b138_line_amendment.sql': 2,
  'b142_chit_line.sql': 2,
  'b143_line_assignment.sql': 2,
  'b144_line_delivery.sql': 2,
  'b145_line_cost.sql': 2,
  'b146_catalogue_item_version.sql': 2,
  'b147_service_sla.sql': 4,
  'b160_definitions.sql': 4,
  'b172_access_events.sql': 2,
  'b174_identity_documents.sql': 2,
};

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

const files = fs.readdirSync(M).filter((f) => f.endsWith('.sql'));
const found = {};
let total = 0;
for (const f of files) {
  const n = countUnguarded(fs.readFileSync(path.join(M, f), 'utf8'));
  if (n) { found[f] = n; total += n; }
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

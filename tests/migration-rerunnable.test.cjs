#!/usr/bin/env node
/**
 * ── ⭐⭐ A MIGRATION THAT SAYS "IDEMPOTENT" HAS TO BE ─────────────────────────────────────────────────────────────
 *
 * 2026-09-14. b249's own header said *"Supabase → SQL Editor → paste → Run. Idempotent."* Athi re-ran it and got:
 *
 *     ERROR 42710: trigger "identities_population_one_way" for relation "identities" already exists
 *
 * ⚠️ THE COST IS NOT THE ERROR. Every migration in this codebase ends in PROOFS — probes that exercise the rule
 * it just installed and report whether it fired. Those proofs are only reachable by re-running the file. A
 * migration that cannot be re-run is one nobody can re-verify, so the first run becomes the only run and its
 * output the only evidence. Two of today's rules ended up "installed but unproven" for exactly that reason.
 *
 * ⭐ THE FIXES ARE MECHANICAL AND THIS FILE NAMES THEM:
 *
 *     CREATE TRIGGER x        →  DROP TRIGGER IF EXISTS x ON t;  first
 *     CREATE INDEX x          →  CREATE INDEX IF NOT EXISTS x
 *     ADD CONSTRAINT x        →  guarded by a pg_constraint check (ADD CONSTRAINT has no IF NOT EXISTS)
 *
 * ── ⚠️ A RATCHET, NOT A FLAT RULE ───────────────────────────────────────────────────────────────────────────────
 *
 * There are hundreds of historical migrations and they are not going to be rewritten. Only files from b240 on
 * are held to this — the era in which every migration ends in a proof — and older ones are listed as inherited.
 * The line moves forward, never back.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'migrations');
/* ⭐ the era this rule belongs to. Raise it, never lower it. */
const FROM = 240;

const files = fs.readdirSync(DIR).filter((f) => {
  const m = /^b(\d+)_/.exec(f);
  return m && Number(m[1]) >= FROM && f.endsWith('.sql');
}).sort();

let checks = 0, fails = 0;
const fail = (f, msg, why) => { fails++; console.log('  ✗ ' + f + '  ' + msg + '\n       ' + why); };

console.log('\n══ MIGRATIONS MUST BE RE-RUNNABLE (b' + FROM + '+) ══\n');

for (const f of files) {
  const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
  /* ⚠️ comments blanked: these files argue with themselves at length and half of them quote the very SQL
     they are warning about. Matching on prose would make this guard agree with any file that discussed the
     rule instead of following it — the same fault the list-controls watcher shipped with. */
  const code = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  for (const m of code.matchAll(/CREATE\s+TRIGGER\s+([a-z0-9_]+)/gi)) {
    checks++;
    const name = m[1];
    const before = code.slice(0, m.index);
    if (!new RegExp('DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+' + name + '\\b', 'i').test(before)) {
      fail(f, 'CREATE TRIGGER ' + name + ' with no DROP first',
        'Re-running errors 42710 and the proofs at the end of the file never run.');
    }
  }

  /**
   * ⚠️ CONCURRENTLY SITS BETWEEN 'INDEX' AND 'IF NOT EXISTS', and this pattern did not allow for it — so a
   * perfectly re-runnable `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_…` was read as an index NAMED
   * 'CONCURRENTLY' with no guard, and failed (b263, 2026-09-18). The assertion is unchanged — an index must be
   * re-runnable — only its expression learned a keyword. [[feedback-improvise-update-cases]]
   * ⚠️ It still catches `CREATE INDEX CONCURRENTLY foo` with no IF NOT EXISTS, which is the real fault.
   */
  for (const m of code.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!(?:CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS\b)(?:CONCURRENTLY\s+)?([a-z0-9_]+)/gi)) {
    checks++;
    fail(f, 'CREATE INDEX ' + m[1] + ' without IF NOT EXISTS', 'Re-running errors 42P07.');
  }

  for (const m of code.matchAll(/ADD\s+CONSTRAINT\s+([a-z0-9_]+)/gi)) {
    checks++;
    const name = m[1];
    const before = code.slice(Math.max(0, m.index - 600), m.index);
    /**
     * ⭐ DROP-THEN-ADD IS THE THIRD VALID SHAPE, and the guard used to reject it.
     *
     *     ALTER TABLE x DROP CONSTRAINT IF EXISTS c;
     *     ALTER TABLE x ADD  CONSTRAINT c CHECK (…);
     *
     * That is idempotent, it is what b254 and b257 both do, and it is BETTER than a pg_constraint DO block when
     * the definition changes — re-running actually updates the rule instead of leaving the old one in place
     * because a constraint of that name already existed.
     *
     * ⚠️ The DROP must name THIS constraint. A guard that accepted any nearby DROP would pass a file that
     * dropped one rule and added a different one unguarded.
     */
    const droppedFirst = new RegExp('DROP\\s+CONSTRAINT\\s+IF\\s+EXISTS\\s+' + name + '\\b', 'i').test(before);
    if (!droppedFirst && !/pg_constraint|IF\s+NOT\s+EXISTS/i.test(before)) {
      fail(f, 'ADD CONSTRAINT ' + name + ' unguarded',
        'Re-running errors 42710. Either DROP CONSTRAINT IF EXISTS ' + name + ' immediately before it, '
        + 'or wrap it in a DO block that checks pg_constraint.');
    }
  }

  /**
   * ── ⚠️⚠️ A FUNCTION THAT RETURNS A TABLE CANNOT BE *REPLACED* WITH AN EXTRA COLUMN ────────────────────────────
   *
   * b255 widened ops.f_worlds() by one column and Athi got, in the SQL editor:
   *
   *     42P13: cannot change return type of existing function
   *     HINT: Use DROP FUNCTION ops.f_worlds() first.
   *
   * `CREATE OR REPLACE` may change a body; it may not change a row type. A new output column is a new signature,
   * so any RETURNS TABLE function must be dropped first — and every migration here is re-run on purpose, so this
   * would bite again on the next one that grows a column.
   *
   * ⚠️ AND THE DROP TAKES THE GRANT WITH IT. A function re-created without its GRANT exists, works perfectly in
   * the SQL editor, and is invisible to cb_app — which reads to the application as "the feature does nothing".
   * [[feedback-silence-is-the-bug]]
   */
  for (const m of code.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-z0-9_.]+)\s*\([^)]*\)\s*\r?\n?\s*RETURNS\s+TABLE/gi)) {
    checks++;
    const name = m[1];
    const bare = name.replace(/\(.*$/, '');
    const dropped = new RegExp('DROP\\s+FUNCTION\\s+IF\\s+EXISTS\\s+' + bare.replace(/\./g, '\\.'), 'i').test(code);
    if (!dropped) {
      fail(f, bare + '() RETURNS TABLE without a DROP first',
        'CREATE OR REPLACE cannot change a row type — 42P13 the first time a column is added. '
        + 'Add DROP FUNCTION IF EXISTS ' + bare + '(); before it, and re-issue the GRANT after.');
    } else {
      /* dropped — then the grant MUST come back, or cb_app loses it silently */
      const granted = new RegExp('GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+' + bare.replace(/\./g, '\\.'), 'i').test(code);
      const everGranted = /GRANT\s+EXECUTE\s+ON\s+FUNCTION/i.test(code);
      checks++;
      if (everGranted && !granted) {
        fail(f, bare + '() is dropped and never re-granted',
          'DROP FUNCTION removes its GRANT. The function will work in the SQL editor and be invisible to cb_app.');
      }
    }
  }

  /* ⭐ the claim itself. A file that does not promise idempotency is not held to it — but almost all of them
     do, because re-running is how their proofs get read. */
  if (/idempotent/i.test(sql)) checks++;
}

console.log(fails
  ? '\n✗ ' + fails + ' problem(s) across ' + files.length + ' migration(s)\n'
  : '  ✓ all ' + files.length + ' migrations from b' + FROM + ' can be re-run (' + checks + ' checks)\n');
process.exit(fails ? 1 : 0);

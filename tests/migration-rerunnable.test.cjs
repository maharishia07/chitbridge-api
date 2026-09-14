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

  for (const m of code.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)([a-z0-9_]+)/gi)) {
    checks++;
    fail(f, 'CREATE INDEX ' + m[1] + ' without IF NOT EXISTS', 'Re-running errors 42P07.');
  }

  for (const m of code.matchAll(/ADD\s+CONSTRAINT\s+([a-z0-9_]+)/gi)) {
    checks++;
    const before = code.slice(Math.max(0, m.index - 600), m.index);
    if (!/pg_constraint|IF\s+NOT\s+EXISTS/i.test(before)) {
      fail(f, 'ADD CONSTRAINT ' + m[1] + ' unguarded',
        'ADD CONSTRAINT has no IF NOT EXISTS — wrap it in a DO block that checks pg_constraint.');
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

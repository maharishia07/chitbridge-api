/**
 * tools/sql-inventory.cjs — which .sql files are REQUIRED going forward, and which are history.
 *
 * Athi, 2026-08-21: *"we have created so many migration sql, so how do we know what are the required ones and
 * what are not required going forward? If so, then the relevant one should be documented and kept as a
 * repository."*
 *
 * ⭐⭐ THERE IS AN OBJECTIVE DISCRIMINATOR AND IT IS NOT OPINION: **whatever CI runs to build a database from
 * nothing is required, by definition.** `.github/workflows/ci.yml` bootstraps a fresh Postgres on every push —
 * that list IS the answer to "what does it take to stand this schema up today". Everything else is either an
 * increment already applied to the live database (history: needed to explain the schema, never re-run) or a
 * file nothing references at all.
 *
 * ⚠️⚠️ AND THIS OVERTURNS THE PLANNED CLEANUP. DB-CLEANUP-BACKLOG.md Phase 1 is labelled "zero-risk hygiene —
 * repo only" and says to move `db/schema.sql`, `db/schema_b2_migration.sql` and the root `migration_*.sql` into
 * `archive/`. They are not archive material: CI runs all twenty of them, in order, to create the test database.
 * Moving them breaks every CI run on the next push. MANIFEST.md calls that chain "historical", which is exactly
 * how a file gets tidied away while something depends on it.
 *
 * Read-only. Prints a table; changes nothing.
 */
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..');
const CI = path.join(API, '.github', 'workflows', 'ci.yml');

/* ── 1 · what CI actually runs, in the order it runs it ─────────────────────────────────────────────────── */
const bootstrap = [];
if (fs.existsSync(CI)) {
  const y = fs.readFileSync(CI, 'utf8');
  /* explicit `$PSQL <file>` lines */
  for (const m of y.matchAll(/\$PSQL\s+([A-Za-z0-9_./-]+\.sql)/g)) bootstrap.push(m[1]);
  /* the `for m in a b c; do $PSQL "$m.sql"` loop — names without the extension */
  for (const m of y.matchAll(/for m in ([\s\S]*?);\s*do/g)) {
    m[1].split(/[\s\\]+/).filter(Boolean).forEach((n) => bootstrap.push(n + '.sql'));
  }
  for (const m of y.matchAll(/-f\s+(migrations\/[A-Za-z0-9_./-]+\.sql)/g)) bootstrap.push(m[1]);
}
const inBootstrap = new Set(bootstrap.map((f) => path.basename(f)));

/* ── 2 · every .sql in the repo ─────────────────────────────────────────────────────────────────────────── */
const all = [];
const walk = (dir, rel) => {
  for (const f of fs.readdirSync(path.join(API, dir))) {
    const p = path.join(dir, f);
    if (fs.statSync(path.join(API, p)).isDirectory()) { if (f !== 'node_modules') walk(p, rel); continue; }
    if (f.endsWith('.sql')) all.push(p.replace(/\\/g, '/'));
  }
};
for (const d of ['.', 'db', 'migrations']) { try { walk(d); } catch (_) {} }
const uniq = [...new Set(all)].filter((f) => !f.startsWith('node_modules'));

/* ── 3 · what MANIFEST claims ───────────────────────────────────────────────────────────────────────────── */
const manifest = fs.existsSync(path.join(API, 'migrations', 'MANIFEST.md'))
  ? fs.readFileSync(path.join(API, 'migrations', 'MANIFEST.md'), 'utf8') : '';

/**
 * ⚠️ A DRY-RUN AND ITS APPLY ARE ONE UNIT. b179 ships as two files by design — Athi runs the read-only one,
 * reads the answer, then runs the change. Counting them separately would make half the migrations look like
 * duplicates of the other half.
 */
const rows = uniq.map((f) => {
  const base = path.basename(f);
  const isBoot = inBootstrap.has(base);
  const named = manifest.indexOf(base) >= 0;
  const dry = /_dryrun\.sql$/.test(base);
  /**
   * ⚠️⚠️ THE NAMING CHANGED MID-PROJECT, AND A NARROW PATTERN TURNS HISTORY INTO A DELETE LIST. Increments are
   * `b179_x.sql` today, were `migration_b42_x.sql` through b57, and the baseline pair is `000_baseline*.sql`.
   * Matching only /^b\d+/ filed 25 real applied migrations — INCLUDING THE BASELINE — under "UNCLAIMED", which
   * is precisely the column a person reads as "safe to delete". A classifier is only as safe as its widest
   * pattern, and this one is a delete list by another name.
   */
  const bnn = /^(migration_)?b\d+/.test(base) || /^\d+_baseline/.test(base);
  let klass, why;
  if (isBoot)      { klass = 'BOOTSTRAP'; why = 'CI runs it to build a database from nothing — required, do not move'; }
  else if (dry)    { klass = 'DRY-RUN';   why = 'read-only companion to its apply — keep as the record of what was checked'; }
  else if (bnn)    { klass = 'INCREMENT'; why = named ? 'applied increment, named in MANIFEST' : 'applied increment, NOT in MANIFEST'; }
  else             { klass = 'UNCLAIMED'; why = 'neither in the CI chain nor a bNN increment — check before assuming it is dead'; }
  return { f, base, klass, why, named };
});

const order = { BOOTSTRAP: 0, INCREMENT: 1, 'DRY-RUN': 2, UNCLAIMED: 3 };
rows.sort((a, b) => (order[a.klass] - order[b.klass]) || a.f.localeCompare(b.f));

const count = (k) => rows.filter((r) => r.klass === k).length;
console.log('\n  ' + uniq.length + ' .sql files\n');
console.log('    BOOTSTRAP  ' + String(count('BOOTSTRAP')).padStart(3) + '   CI runs these to stand the schema up — REQUIRED');
console.log('    INCREMENT  ' + String(count('INCREMENT')).padStart(3) + '   applied to the live database — history, never re-run');
console.log('    DRY-RUN    ' + String(count('DRY-RUN')).padStart(3) + '   read-only companions');
console.log('    UNCLAIMED  ' + String(count('UNCLAIMED')).padStart(3) + '   referenced by neither — the only real cleanup candidates\n');

if (process.argv.indexOf('--full') >= 0) {
  rows.forEach((r) => console.log('    ' + r.klass.padEnd(10) + r.f));
} else {
  console.log('    UNCLAIMED:');
  rows.filter((r) => r.klass === 'UNCLAIMED').forEach((r) => console.log('      ' + r.f));
  const unnamed = rows.filter((r) => r.klass === 'INCREMENT' && !r.named);
  console.log('\n    INCREMENTS NOT NAMED IN MANIFEST.md (' + unnamed.length + '):');
  unnamed.slice(0, 12).forEach((r) => console.log('      ' + r.base));
  if (unnamed.length > 12) console.log('      … and ' + (unnamed.length - 12) + ' more');
  console.log('\n    (--full lists every file with its class)');
}
console.log();

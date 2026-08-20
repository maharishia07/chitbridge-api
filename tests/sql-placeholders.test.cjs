/**
 * tests/sql-placeholders.test.cjs — every generated SQL placeholder must actually BE a placeholder.
 *
 * ⚠️⚠️ WHY THIS TEST EXISTS. Commit 5196018 turned `sets.push(\`hat = $${n++}\`)` into
 * `sets.push(\`hat = ${n++}\`)` — one deleted dollar sign, applied by a script that collapsed the doubled
 * marker. The generated SQL became `SET hat = 5`: a bare integer where a bound parameter belongs. Postgres
 * rejects it, so EVERY co-assist access edit failed, and the diff looked like a harmless whitespace change.
 *
 * ⭐ A one-off assertion on those three lines would have been worth almost nothing — the defect is a CLASS,
 * and it can be reintroduced by any future edit to any of the ~50 dynamic-SET sites in this codebase. This
 * scans them all. A bare `= ${n}` inside a SQL template is never correct: parameters need $, and a value
 * that is genuinely interpolated (a column name, a join clause) is never a bare counter variable.
 */
const fs = require('fs');
const path = require('path');

const ROOTS = ['routes', 'lib', 'middleware'];
const files = [];
for (const r of ROOTS) {
  const d = path.join(__dirname, '..', r);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) if (f.endsWith('.js')) files.push(path.join(d, f));
}

/* `= ${n++}` / `= ${n}` / `= ${i++}` inside a template — a counter interpolated with NO leading $. The
   preceding character must not be a $, which is what makes a correct `$${n++}` pass. */
const BAD = /([^$])\$\{\s*(n|i|idx|p)\s*\+{0,2}\s*\}/g;

/**
 * ⚠️ A COUNTER THAT ALREADY CARRIES ITS $ IS CORRECT, and the first version of this test called one such site
 * a bug. lib/select.js writes `const n = '$' + args.length` and then interpolates a bare ${n} — right, and
 * flagging it would have taught the next reader to "fix" working code. Only a counter declared as a NUMBER
 * (`let n = 1`) needs a literal $ in front of the interpolation.
 */
let failures = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const numeric = new Set();
  const strung  = new Set();
  for (const m of src.matchAll(/\b(?:let|var|const)\s+(n|i|idx|p)\s*=\s*([^;\n]+)/g)) {
    const rhs = m[2].trim();
    (/^['"`]\$/.test(rhs) ? strung : numeric).add(m[1]);
  }
  src.split(/\r?\n/).forEach((line, i) => {
    if (!/(sets\.push|SET |WHERE |VALUES|RETURNING|push\(`)/.test(line)) return;
    BAD.lastIndex = 0;
    let m;
    while ((m = BAD.exec(line))) {
      const v = m[2];
      if (strung.has(v) && !numeric.has(v)) continue;   // already '$'-prefixed at declaration
      if (!numeric.has(v)) continue;                     // not a counter this test can reason about
      failures.push(`${path.relative(path.join(__dirname, '..'), f)}:${i + 1}  ${line.trim()}`);
    }
  });
}

if (failures.length) {
  console.error('\n✗ SQL placeholder missing its $ — this generates `col = 5`, not `col = $5`:\n');
  failures.forEach(f => console.error('   ' + f));
  console.error(`\n${failures.length} site(s). Write $\${n++}, not $\{n++}.\n`);
  process.exit(1);
}
console.log(`✓ SQL placeholders — ${files.length} files scanned, every interpolated counter carries its $`);

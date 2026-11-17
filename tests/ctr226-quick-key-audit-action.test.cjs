/**
 * ctr226-quick-key-audit-action.test.cjs — CTR-226: every action lib/quick-keys.js can write to quick_key_audit is allowed by the
 * database's check constraint once the migrations have run (baseline list + b856), and b856 is safe to run twice.
 * Failed on main: 'update' was written by lib/quick-keys.js:104 and missing from the baseline constraint (500 on recolour/reorder/schedule).
 * Offline: reads lib/quick-keys.js, the baseline and b856 only.
 * CARD      28-platform-and-operations/quick-keys-routes
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   ' + extra : '')); }
}
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** the quoted words of the first ARRAY[...] after the constraint name */
function allowedOf(sql) {
  const m = /quick_key_audit_action_check[\s\S]*?ARRAY\[([^\]]*)\]/.exec(sql);
  return m ? [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]) : [];
}

const code = read('lib/quick-keys.js');
const listed = [...(/const AUDIT_ACTIONS = \[([^\]]*)\]/.exec(code) || [, ''])[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
const called = [...code.matchAll(/await audit\(db, entity_id, user_id, ([^,]+),/g)].map((x) => x[1]);
const literals = called.flatMap((a) => [...a.matchAll(/'([a-z]+)'/g)].map((x) => x[1]));
const writers = fs.readdirSync(path.join(ROOT, 'lib')).concat(fs.readdirSync(path.join(ROOT, 'routes')).map((f) => '../routes/' + f))
  .filter((f) => /\.js$/.test(f) && /INSERT INTO quick_key_audit/.test(read(f.startsWith('../') ? f.slice(3) : 'lib/' + f)));

check('quick_key_audit has one writer, lib/quick-keys.js', writers.length === 1 && writers[0] === 'quick-keys.js', writers.join(','));
check('the code names 8 audit actions', listed.length === 8, listed.join(','));
check('every action the code calls is in AUDIT_ACTIONS', literals.length > 0 && literals.every((a) => listed.includes(a)), literals.join(','));
check("the writer really writes 'update' (the case that failed)", literals.includes('update'));

const baseline = allowedOf(read('migrations/000_baseline_2026-10-21.sql'));
const b856 = fs.readFileSync(path.join(ROOT, 'migrations', 'b856_quick_key_audit_action_update.sql'), 'utf8');
const b856sql = b856.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const after = allowedOf(b856sql);
check('baseline constraint lacks update (why the file exists)', baseline.length === 7 && !baseline.includes('update'), baseline.join(','));
check('b856 allows every action the code can write', listed.every((a) => after.includes(a)), after.join(','));
check('b856 allows nothing the baseline did not, except update', after.filter((a) => !baseline.includes(a)).join() === 'update');
check('b856 drops the old constraint only if present (re-run safe)', /DROP CONSTRAINT IF EXISTS quick_key_audit_action_check/.test(b856sql));
check('b856 sets lock_timeout', /SET LOCAL lock_timeout/.test(b856sql));
check('b856 deletes and truncates no row', !/(DELETE FROM|TRUNCATE)/i.test(b856sql));
check('b856 carries a read-only CHECK in its header', /^-- CHECK \(read-only/m.test(b856));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

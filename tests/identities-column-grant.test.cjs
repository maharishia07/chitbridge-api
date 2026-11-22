#!/usr/bin/env node
/** tests/identities-column-grant.test.cjs — every identities column added by a migration AFTER SEC-186 (b875 onward) is granted to cb_app, in the same or a LATER numbered file.
 *  Why: SEC-186 revoked table-level SELECT on identities; a new column with no GRANT SELECT (col) makes every sign-in fail "permission denied for table identities" (b900 did, found on SIT 21 Nov).
 *  The three credential columns are the only deliberate exceptions. Offline: reads the migration files. */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'migrations');
const NEVER = new Set(['pin_hash', 'otp_code', 'otp_code_hash']);
const num = (f) => Number((/^b(\d+)_/.exec(f) || [])[1]);
const strip = (s) => s.replace(/--[^\n]*/g, '');
/** columns added to identities by sql (comments removed) */
function added(sql) {
  const out = [], re = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?identities\b([^;]*?)(?:;|\$)/gi; let m;
  while ((m = re.exec(sql))) { const c = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_0-9]+)"?/gi; let k; while ((k = c.exec(m[1]))) out.push(k[1].toLowerCase()); }
  return out;
}
/** columns granted SELECT to cb_app by sql */
function granted(sql) {
  const out = [], re = /GRANT\s+(?:SELECT\s*\(([^)]*)\)|[^;]*?\bSELECT\s*\(([^)]*)\))[^;]*?ON\s+(?:TABLE\s+)?(?:public\.)?identities\s+TO\s+[^;]*\bcb_app\b/gi; let m;
  while ((m = re.exec(sql))) (m[1] || m[2]).split(',').forEach((c) => out.push(c.trim().replace(/"/g, '').toLowerCase()));
  return out;
}
/** returns the list of "file: column" with no grant at or after the file that added it */
function missing(files) {
  const bad = [];
  const sorted = files.filter((f) => num(f.name) >= 875).sort((a, b) => num(a.name) - num(b.name));
  for (const f of sorted) for (const col of added(strip(f.sql))) {
    if (NEVER.has(col)) continue;
    if (!sorted.some((g) => num(g.name) >= num(f.name) && granted(strip(g.sql)).includes(col))) bad.push(f.name + ': ' + col);
  }
  return bad;
}
let checks = 0;
const it = (what, fn) => { fn(); checks++; console.log('  ok  ' + what); };
it('a column added with no grant is reported (the b900 mistake)', () => assert.deepStrictEqual(missing([{ name: 'b900_x.sql', sql: 'ALTER TABLE identities ADD COLUMN IF NOT EXISTS foo int;' }]), ['b900_x.sql: foo']));
it('a grant in a later file clears it', () => assert.deepStrictEqual(missing([{ name: 'b900_x.sql', sql: 'ALTER TABLE identities ADD COLUMN foo int, ADD COLUMN bar int;' }, { name: 'b908_y.sql', sql: 'GRANT SELECT (foo, bar), UPDATE (foo, bar) ON public.identities TO cb_app;' }]), []));
it('a grant in an EARLIER file does not count', () => assert.deepStrictEqual(missing([{ name: 'b890_g.sql', sql: 'GRANT SELECT (foo) ON identities TO cb_app;' }, { name: 'b900_x.sql', sql: 'ALTER TABLE identities ADD COLUMN foo int;' }]), ['b900_x.sql: foo']));
it('a comment is not a statement', () => assert.deepStrictEqual(missing([{ name: 'b900_x.sql', sql: '-- ALTER TABLE identities ADD COLUMN foo int;\nSELECT 1;' }]), []));
const real = fs.readdirSync(DIR).filter((f) => /^b\d+_.*\.sql$/.test(f)).map((f) => ({ name: f, sql: fs.readFileSync(path.join(DIR, f), 'utf8') }));
it('the real chain: every identities column added from b875 on is granted to cb_app', () => assert.deepStrictEqual(missing(real), []));
it('b900 columns are covered by a file after it', () => { assert.ok(added(strip(real.find((f) => f.name.startsWith('b900_')).sql)).includes('auth_fail_count')); });
console.log('\n  ' + checks + ' checks');

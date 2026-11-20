/**
 * identities-no-whole-row.test.cjs - SEC-186 (2026-11-20). Offline static guard.
 * After RUN-2026-11-16-sec-186-revoke-credential-columns cb_app has column-level SELECT on identities (no pin_hash, otp_code,
 * otp_code_hash). A whole-row read (to_jsonb(identities), SELECT * FROM identities, identities.*, ti.*) is then 42501.
 * Found by the upgrade rehearsal: assign-bulk 500. Fails when lib/ routes/ server.js name such a read.
 * Allowed: lib/identity-secret.js legacySql (only runs while the identity_secret view is absent, before sec-186 can matter).
 * Run: node tests/identities-no-whole-row.test.cjs
 * CARD      security/identity-secret
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const ALLOW = new Set(['lib/identity-secret.js']);
const PATTERNS = [/to_jsonb\(\s*identities\s*\)/i, /row_to_json\(\s*identities\s*\)/i, /select\s+\*\s+from\s+identities\b/i, /\bidentities\.\*/i, /\bti\.\*/];
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  if (e.name === 'node_modules' || e.name === 'tests' || e.name.startsWith('.')) continue;
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (/\.(c|m)?js$/.test(e.name)) files.push(p);
} };
for (const d of ['lib', 'routes', 'scripts']) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
for (const f of ['server.js']) if (fs.existsSync(path.join(ROOT, f))) files.push(path.join(ROOT, f));
const bad = [];
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  if (ALLOW.has(rel)) continue;
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (PATTERNS.some((re) => re.test(line))) bad.push(rel + ':' + (i + 1)); });
}
if (bad.length) { console.log('   FAIL whole-row identities read:\n     ' + bad.join('\n     ')); process.exit(1); }
console.log('   ok   no whole-row identities read in ' + files.length + ' files');

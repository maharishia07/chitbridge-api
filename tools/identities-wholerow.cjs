#!/usr/bin/env node
/**
 * tools/identities-wholerow.cjs — SEC-199: every read of a WHOLE identities row in api runtime code (to_jsonb(i), row_to_json(i), i.*, SELECT * FROM identities, RETURNING *).
 * OWNS  the whole-row finder · CALLED BY  tests/sec-199-identities-wholerow.test.cjs
 * FLOW  files() → hits(): per line, the whole-row expressions; the alias set from the 10 lines around (FROM|JOIN|UPDATE|INTO identities [AS] x); a hit when the expression names that alias or the table
 * CARD 18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data
 * WHY   SEC-186 revoked pin_hash / otp_code / otp_code_hash from cb_app: a whole-row read answers 42501 as the app role = a 500 at run time, never at test time (tests run with full rights).
 *       A bound or named-column read is fine; the owner-role jobs (scripts/, tools/) are out of scope. Mark a proven-safe line with `wholerow:ok` in a comment on it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HOME = path.join(__dirname, '..');
const RUNTIME = ['lib', 'routes', 'middleware', 'server.js'];
const ALIAS_AFTER = /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:public\.)?identities\b(?:\s+(?:AS\s+)?([a-z_]\w*))?/gi;
const NOT_ALIAS = /^(where|on|set|left|right|inner|join|cross|full|natural|using|group|order|limit|for|values|select|returning|as|and|or|union|offset|fetch|lateral|with|when|then|else|end)$/i;
function files(root, dir) {
  const p = path.join(root, dir);
  if (!fs.existsSync(p)) return [];
  if (fs.statSync(p).isFile()) return [dir];
  return fs.readdirSync(p).flatMap((n) => {
    if (n === 'node_modules' || n === '.git') return [];
    const rel = dir + '/' + n;
    return fs.statSync(path.join(root, rel)).isDirectory() ? files(root, rel) : /\.(js|cjs)$/.test(n) ? [rel] : [];
  });
}
/** the names that mean "an identities row" in the window around line `at` */
function namesAround(lines, at) {
  const names = new Set();
  const win = lines.slice(Math.max(0, at - 10), at + 11).join('\n');
  for (const m of win.matchAll(ALIAS_AFTER)) { names.add('identities'); if (m[1] && !NOT_ALIAS.test(m[1])) names.add(m[1].toLowerCase()); }
  return names;
}
function hits(root) {
  const out = [];
  for (const rel of RUNTIME.flatMap((d) => files(root || HOME, d))) {
    const lines = fs.readFileSync(path.join(root || HOME, rel), 'utf8').split('\n');
    lines.forEach((text, at) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(text) || /wholerow:ok/.test(text) || !/to_jsonb|row_to_json|\*|identities/i.test(text)) return;
      const names = namesAround(lines, at);
      if (!names.size) return;
      const sql = text.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '');
      const found = [];
      for (const m of sql.matchAll(/\b(?:to_jsonb|row_to_json|to_json)\s*\(\s*([a-z_]\w*)\s*\)/gi)) if (names.has(m[1].toLowerCase())) found.push(m[0]);
      for (const m of sql.matchAll(/\b([a-z_]\w*)\.\*/gi)) if (names.has(m[1].toLowerCase()) && !/\*\.\*/.test(m[0])) found.push(m[0]);
      if (/\bSELECT\s+\*\s+FROM\s+(?:public\.)?identities\b/i.test(lines.slice(at, at + 2).join(' ').replace(/\s+/g, ' '))) found.push('SELECT * FROM identities');
      if (/\bRETURNING\s+\*/i.test(sql) && names.has('identities') && /\b(UPDATE|INSERT\s+INTO)\s+(public\.)?identities\b/i.test(lines.slice(Math.max(0, at - 10), at + 1).join(' '))) found.push('RETURNING *');
      found.forEach((what) => out.push({ file: rel, line: at + 1, what, text: text.trim().slice(0, 140) }));
    });
  }
  return out;
}
if (require.main === module) { const h = hits(); h.forEach((x) => console.log(x.file + ':' + x.line + '  ' + x.what + '  | ' + x.text)); console.log(h.length + ' whole-row identities read(s)'); process.exit(h.length ? 1 : 0); }
module.exports = { hits };

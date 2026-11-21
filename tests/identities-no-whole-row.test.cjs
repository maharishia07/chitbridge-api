/**
 * identities-no-whole-row.test.cjs - SEC-186 COLUMN GUARD (2026-11-20). Offline static guard (best effort, alias-aware).
 * After RUN-2026-11-16-sec-186-revoke-credential-columns cb_app has column-level SELECT on identities, EXCEPT the revoked list parsed from that
 * file (pin_hash, otp_code, otp_code_hash). Any read of a revoked column, or a whole-row read, is 42501 "permission denied for table identities"
 * (found twice: assign-bulk 500; then to_jsonb(i) in onRailSql/sameWorldSql, which made the Day book answer BOOKS_NOT_MIGRATED).
 * Per SQL statement (a string or template literal that names identities) it fails on:
 *   1. a whole-row read of an identities alias: to_jsonb(x), row_to_json(x), x.*, SELECT * FROM identities;
 *   2. a revoked column read: x.<col> (x an identities alias), or a bare <col> in a SELECT / WHERE / RETURNING of a statement on identities.
 * Not a read (allowed): the left side of SET, an INSERT column list, s.<col> (the ops.identity_secret alias), any statement that names identity_secret.
 * A helper that takes an alias (onRailSql('i')) is checked where it is DEFINED: it must not call to_jsonb on its alias argument.
 * ALLOW: lib/identity-secret.js (its legacy SQL runs only while the view is absent).
 * Run: node tests/identities-no-whole-row.test.cjs
 * CARD      security/identity-secret
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const ALLOW = new Set(['lib/identity-secret.js']);
const NL = String.fromCharCode(10), BS = String.fromCharCode(92);
const run = fs.readFileSync(path.join(ROOT, 'migrations', 'RUN-2026-11-16-sec-186-revoke-credential-columns.sql'), 'utf8');
const REVOKED = ((run.match(/attname NOT IN \(([^)]*)\)/) || [])[1] || '').split(',').map((x) => x.replace(/['\s]/g, '')).filter(Boolean);
if (REVOKED.length < 3) { console.log('   FAIL cannot parse the revoked list from the sec-186 RUN file'); process.exit(1); }
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  if (e.name === 'node_modules' || e.name === 'tests' || e.name.startsWith('.')) continue;
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (/\.(c|m)?js$/.test(e.name)) files.push(p);
} };
for (const d of ['lib', 'routes', 'scripts']) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
if (fs.existsSync(path.join(ROOT, 'server.js'))) files.push(path.join(ROOT, 'server.js'));
const COLS = REVOKED.join('|');
const NOT_ALIAS = /^(where|set|on|left|right|inner|join|using|cross|full|natural|order|group|limit|returning|for)$/i;
const aliasesOf = (sql) => {
  const a = new Set(['identities']);
  for (const m of sql.matchAll(/\b(?:from|join|update)\s+(?:public\.)?identities\s+(?:as\s+)?([a-z_][a-z0-9_]*)\b/gi)) if (!NOT_ALIAS.test(m[1])) a.add(m[1]);
  return a;
};
function check(sql) {
  const out = [];
  const al = aliasesOf(sql), alt = [...al].join('|');
  if (new RegExp('\\b(?:to_jsonb|row_to_json)\\(\\s*(?:' + alt + ')\\s*\\)', 'i').test(sql)) out.push('whole-row to_jsonb/row_to_json of identities');
  if (new RegExp('\\b(?:' + alt + ')\\.\\*', 'i').test(sql) || /select\s+\*\s+from\s+(?:public\.)?identities\b/i.test(sql)) out.push('whole-row x.* / SELECT * of identities');
  if (new RegExp('\\b(?:' + alt + ')\\.(?:' + COLS + ')\\b', 'i').test(sql)) out.push('qualified read of a revoked column');
  if (!/identity_secret/i.test(sql) && (/^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql) || /\bwhere\b/i.test(sql))) {
    const noSet = sql.replace(/\bset\b[\s\S]*?(?=\bwhere\b|\breturning\b|$)/gi, (set) => set.replace(new RegExp('\\b(?:' + COLS + ')\\s*=', 'gi'), 'X ='));
    const noInsert = noSet.replace(/\binsert\s+into\s+[\w.]+\s*\([^)]*\)/gi, '');
    if (new RegExp('(?<![.\\w])(?:' + COLS + ')\\b', 'i').test(noInsert)) out.push('bare read of a revoked column');
  }
  return out;
}
/* a small lexer: skips comments (an apostrophe in a comment must not swallow the next template), yields every string / template literal */
function* literals(src) {
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== NL) i++; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return; i += 2; continue; }
    if (c === "'" || c === '"') { const st = i++; while (i < n && src[i] !== c && src[i] !== NL) i += src[i] === BS ? 2 : 1; yield [st, src.slice(st + 1, i)]; i++; continue; }
    if (c === '`') {
      const st = i++;
      let depth = 0;
      while (i < n && !(src[i] === '`' && depth === 0)) {
        if (src[i] === BS) { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; continue; }
        if (src[i] === '}' && depth > 0) depth--;
        i++;
      }
      yield [st, src.slice(st + 1, i)]; i++; continue;
    }
    i++;
  }
}
const lineOf = (src, at) => src.slice(0, at).split(NL).length;
const bad = [];
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  if (ALLOW.has(rel)) continue;
  const src = fs.readFileSync(f, 'utf8');
  for (const [at, sql] of literals(src)) {
    if (!/\bidentities\b/i.test(sql) || !/\b(select|update|insert|with|delete|returning)\b/i.test(sql)) continue;
    for (const why of check(sql)) bad.push(rel + ':' + lineOf(src, at) + '  ' + why);
  }
  /* a helper that builds SQL for an alias it is handed: to_jsonb(${alias}) beside an identities column name */
  for (const m of src.matchAll(/to_jsonb\(\$\{(\w+)\}\)/g)) {
    const ctx = src.slice(Math.max(0, m.index - 400), m.index);
    if (/identit/i.test(ctx) && /(onRail|sameWorld|population|entity_kind)/i.test(ctx)) bad.push(rel + ':' + lineOf(src, m.index) + '  helper to_jsonb(${alias}) on an identities alias');
  }
}
if (bad.length) { console.log('   FAIL identities read of a revoked column or whole row (revoked: ' + REVOKED.join(', ') + '):' + NL + '     ' + bad.join(NL + '     ')); process.exit(1); }
console.log('   ok   no whole-row or revoked-column identities read in ' + files.length + ' files (revoked: ' + REVOKED.join(', ') + ')');

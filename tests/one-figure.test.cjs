'use strict';
/**
 * tests/one-figure.test.cjs - DRIFT EXIT (Athi 28 Nov 2026, batch 1141): a guarded FIGURE has ONE owning function (docs/one-figure/<figure>.json, pattern tests/one-reader-tables.test.cjs).
 * A second reader of what a return leaves out (a call of the forbidden word outside the owner module and the store that defines it) fails the build. No waiver.
 * Run: node tests/one-figure.test.cjs   (SCAN_SELFTEST=1 plants a second reader and must fail)
 */
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..'), DIR = path.join(API, 'docs', 'one-figure');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const files = [];
const walk = (rel) => { const abs = path.join(API, rel); if (!fs.existsSync(abs)) return; for (const f of fs.readdirSync(abs)) { const r = rel + '/' + f; if (fs.statSync(path.join(API, r)).isDirectory()) { if (f !== 'node_modules') walk(r); } else if (f.endsWith('.js')) files.push(r); } };
['lib', 'routes', 'middleware', 'scripts', 'src'].forEach(walk);
const hasWord = (line, w) => line.split(/[^A-Za-z0-9_]/).includes(w);
let pass = 0, fail = 0;
const eq = (name, ok, say) => { ok ? pass++ : fail++; console.log((ok ? '   ok   ' : '   FAIL ') + name + (ok ? '' : '  ' + say)); };
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const spec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')), allowed = [spec.owner].concat(spec.allowed_elsewhere || []);
  const list = files.concat(process.env.SCAN_SELFTEST ? ['selftest.js'] : []), hits = [];
  for (const rel of list) {
    if (allowed.includes(rel)) continue;
    const text = rel === 'selftest.js' ? 'await S.' + spec.forbidden[0] + '(h, e, a, b);' : strip(fs.readFileSync(path.join(API, rel), 'utf8'));
    text.split('\n').forEach((line, i) => spec.forbidden.forEach((w) => { if (hasWord(line, w)) hits.push(rel + ':' + (i + 1)); }));
  }
  eq(spec.figure + ': ' + spec.forbidden.join(' ') + ' only in ' + spec.owner + ' (and ' + (spec.allowed_elsewhere || []).join(', ') + ')', hits.length === 0, 'second reader at ' + hits.join(' '));
  const own = fs.readFileSync(path.join(API, spec.owner), 'utf8');
  eq(spec.figure + ': the owner function ' + spec.owner_fn + ' exists and is exported', own.split(String.fromCharCode(10)).some((l) => l.includes('function ' + spec.owner_fn + '(')) && own.split(String.fromCharCode(10)).some((l) => l.startsWith('module.exports') && hasWord(l, spec.owner_fn)), '');
  eq(spec.figure + ': the record says what it covers and when it was decided', Array.isArray(spec.covers) && spec.covers.length > 0 && /^\d{4}-\d\d-\d\d/.test(spec.decided || ''), '');
}
console.log(pass + fail + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

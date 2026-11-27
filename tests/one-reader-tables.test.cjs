'use strict';
/**
 * tests/one-reader-tables.test.cjs - DRIFT EXIT BAR 2 + 3 (Athi 28 Nov 2026): a guarded table has ONE owning module (docs/one-reader/<table>.json, one file per table); any SQL on it outside the owner fails the build,
 * except a dated waiver (file + count: it may only go down); a raw STATE predicate on it outside the owner fails with no waiver possible. Scans lib/ routes/ middleware/ scripts/ src/ recursively, comments stripped.
 * CALLED BY scripts/guards-list-1.cjs   Run: node tests/one-reader-tables.test.cjs   (SCAN_SELFTEST=1 plants a read of each table and must fail)
 */
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const DIR = path.join(API, 'docs', 'one-reader');
const REG = Object.fromEntries(fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => { const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); return [j.table, j]; }));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const files = [];
const walk = (rel) => { const abs = path.join(API, rel); if (!fs.existsSync(abs)) return; for (const f of fs.readdirSync(abs)) { const r = rel + '/' + f; if (fs.statSync(path.join(API, r)).isDirectory()) { if (f !== 'node_modules') walk(r); } else if (/\.(js|cjs)$/.test(f)) files.push(r); } };
['lib', 'routes', 'middleware', 'scripts', 'src'].forEach(walk);
let pass = 0, fail = 0;
const eq = (name, ok, say) => { ok ? pass++ : fail++; console.log((ok ? '   ok   ' : '   FAIL ') + name + (ok ? '' : '  ' + say)); };
const NOT_SQL = /hasColumn|hasTable|tables:\s*\[/;
for (const [table, spec] of Object.entries(REG)) {
  const own = {}, pats = (spec.state_patterns || []).map((p) => new RegExp(p, 'i'));
  const hits = [], stateHits = [];
  const list = files.concat(process.env.SCAN_SELFTEST ? ['selftest.js'] : []);
  for (const rel of list) {
    if (rel === spec.owner) continue;
    const text = rel === 'selftest.js' ? 'x = `SELECT 1 FROM ' + table + ' g WHERE g.revoked_at IS NULL`;' : strip(fs.readFileSync(path.join(API, rel), 'utf8'));
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (new RegExp('\\b' + table + '\\b').test(line) && !NOT_SQL.test(line)) { hits.push(rel + ':' + (i + 1)); own[rel] = (own[rel] || 0) + 1; }
    });
    if (pats.length && (new RegExp('\\b' + table + '\\b').test(text) || /\bg\.(revoked_at|expires_at)\b/.test(text))) lines.forEach((line, i) => { if (/\b(g|fg)\.(revoked_at|expires_at)\b/.test(line) && pats.some((p) => p.test(line))) stateHits.push(rel + ':' + (i + 1)); });
  }
  const waived = Object.fromEntries((spec.waivers || []).map((w) => [w.file, w]));
  const over = Object.entries(own).filter(([f, n]) => !waived[f] || n > waived[f].count).map(([f, n]) => f + ' has ' + n + ' line(s), waiver ' + (waived[f] ? waived[f].count : 'none'));
  eq(table + ': SQL only in ' + spec.owner + ' or a dated waiver', over.length === 0, over.join('; ') + ' hits ' + hits.join(' '));
  eq(table + ': no raw state predicate outside the owner', stateHits.length === 0, stateHits.join(' '));
  eq(table + ': every waiver is dated and says why', (spec.waivers || []).every((w) => /^\d{4}-\d\d-\d\d$/.test(w.date) && w.why && w.why.length > 20), '');
}
console.log(pass + fail + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

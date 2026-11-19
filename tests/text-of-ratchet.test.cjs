/**
 * tests/text-of-ratchet.test.cjs — NO NEW String(req.body.x) (FUZZ-8, 2026-11-18).
 *
 * OWNS      the count of the old text-read idiom (the String( call on a req.body or req.query value) in routes/, lib/, middleware/ and server.js, per file, against
 *           docs/contracts/text-of-ratchet.json. A file may only go down; a new file starts at 0. The idiom turns an object into "[object Object]" and an array into
 *           "a,b" and let both reach the database; the one read is textOf (lib/input-hygiene.js).
 * CALLED BY CI (tests/run-tests.js picks up *.test.cjs). No database, no network.
 * FLOW      scan own code ──▶ count per file ──▶ FAIL when a file is above its baseline row · `--write` lowers rows (never raises)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');
const BASELINE = path.join(API, 'docs', 'contracts', 'text-of-ratchet.json');
const IDIOM = /String\(\s*req\.(?:body|query)\b/g;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.(c?js)$/.test(e.name) ? [path.join(dir, e.name)] : []));
}
const counts = {};
['routes', 'lib', 'middleware'].map((d) => path.join(API, d)).filter(fs.existsSync).flatMap(files).concat([path.join(API, 'server.js')]).forEach((f) => {
  const n = (fs.readFileSync(f, 'utf8').match(IDIOM) || []).length;
  if (n) counts[path.relative(API, f).split(path.sep).join('/')] = n;
});
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (process.argv.includes('--write')) {
  const old = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')).files : null;
  const next = {};
  Object.keys(counts).sort().forEach((f) => { next[f] = old && old[f] !== undefined ? Math.min(old[f], counts[f]) : counts[f]; });
  fs.writeFileSync(BASELINE, JSON.stringify({ note: 'FUZZ-8: count of the String( read of req.body / req.query values per file; only goes down. Use textOf (lib/input-hygiene.js).', total: Object.values(next).reduce((a, b) => a + b, 0), files: next }, null, 2) + '\n');
  console.log('written · total ' + total);
  process.exit(0);
}
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).files;
const over = Object.keys(counts).filter((f) => counts[f] > (base[f] || 0));
console.log('text-of ratchet · ' + total + ' String(req.body|query) left, baseline ' + Object.values(base).reduce((a, b) => a + b, 0));
over.forEach((f) => console.log('  XX  ' + f + ': ' + counts[f] + ' > baseline ' + (base[f] || 0) + ' — read the value with textOf (lib/input-hygiene.js)'));
if (over.length) process.exit(1);
console.log('  ok  no file above its baseline');

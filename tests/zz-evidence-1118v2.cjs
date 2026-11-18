'use strict';
// TEMPORARY wrapper (api landing 1118v2, removed again in the same batch): runs the evidence steps on a SIT box and prints every changed docs file (gzip+base64) into its log.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const watched = () => { const out = {}; const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); const s = fs.statSync(p); if (s.isDirectory()) walk(p); else out[path.relative(ROOT, p)] = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex'); } }; walk(path.join(ROOT, 'docs')); for (const f of ['round-trips.budget.json']) out[f] = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, f))).digest('hex'); return out; };
const before = watched();
const run = (label, args, tail) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 800000, maxBuffer: 64 * 1024 * 1024 }); const text = (r.stdout || '') + (r.stderr || ''); console.log('\n#### ' + label + ' -> exit ' + r.status + '\n' + text.split('\n').slice(-(tail || 40)).join('\n')); return r.status; };
const steps = (process.env.STEPS || 'crm,holds,chits,contract').split(',');
if (steps.includes('crm')) {
  run('crm check (before)', ['tests/api-problem-crm.test.cjs'], 30);
  run('crm capture', ['tests/api-problem-crm.test.cjs', '--capture', '/tmp/crm-cap.json'], 5);
  run('allowlist derive (only open)', ['tools/api-allowlist.cjs', '--capture', '/tmp/crm-cap.json', '--file', 'routes/crm.js', '--only-open', '--write'], 30);
  run('crm --write', ['tests/api-problem-crm.test.cjs', '--write'], 30);
  run('crm check (after)', ['tests/api-problem-crm.test.cjs'], 30);
}
if (steps.includes('holds')) {
  run('holds check (before)', ['tests/api-problem-chits-holds.test.cjs'], 60);
  run('holds --write', ['tests/api-problem-chits-holds.test.cjs', '--write'], 10);
  run('holds check (after)', ['tests/api-problem-chits-holds.test.cjs'], 60);
}
if (steps.includes('chits')) run('chits check', ['tests/api-problem-chits.test.cjs'], 15);
if (steps.includes('contract')) run('contract tests --write', ['tools/api-contract-tests.cjs', '--write'], 25);
if (steps.includes('trips')) run('round trips --write', ['tests/round-trips-all.test.cjs', '--write'], 40);
const after = watched();
for (const f of Object.keys(after)) if (before[f] !== after[f]) console.log('\n==FILE ' + f + '==\n' + zlib.gzipSync(fs.readFileSync(path.join(ROOT, f))).toString('base64') + '\n==END==');
console.log('\nSTEPS DONE');

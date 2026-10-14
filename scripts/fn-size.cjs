#!/usr/bin/env node
/**
 * fn-size.cjs — MAINT-1's function metrics for lib/ and routes/: how many functions run past 80 lines, and the
 * worst cyclomatic complexity. Round T2-SPLIT (2026-10-14) — the counter the ratchet (tests/fn-size.test.cjs) reads.
 *
 *   node scripts/fn-size.cjs            the two numbers + the twenty worst functions
 *   node scripts/fn-size.cjs --json     every function over the limit, by file and name (what tests/fixtures/fn-size.json holds)
 *   node scripts/fn-size.cjs --write    rewrite tests/fixtures/fn-size.json — ONLY after the count went DOWN
 *
 * Reads with tests/support/js-scan.cjs (no parser dependency — the offline gate allows none).
 */
'use strict';
const fs = require('fs'), path = require('path');
const { functions } = require('../tests/support/js-scan.cjs');

const API = path.join(__dirname, '..');
const LIMIT = 80;
const DIRS = ['lib', 'routes'];
const FIXTURE = path.join(API, 'tests', 'fixtures', 'fn-size.json');

function walk(dir) {
  const out = [];
  const abs = path.join(API, dir);
  if (!fs.existsSync(abs)) return out;
  for (const f of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = dir + '/' + f.name;
    if (f.isDirectory()) out.push(...walk(rel));
    else if (/\.(c?js)$/.test(f.name)) out.push(rel);
  }
  return out;
}

function measure() {
  const all = [];
  DIRS.flatMap(walk).sort().forEach((rel) => {
    functions(fs.readFileSync(path.join(API, rel), 'utf8')).forEach((f) => all.push(Object.assign({ file: rel }, f)));
  });
  const long = all.filter((f) => f.lines > LIMIT);
  const worst = all.reduce((a, f) => (!a || f.complexity > a.complexity ? f : a), null);
  const perFile = {};
  long.forEach((f) => { (perFile[f.file] = perFile[f.file] || []).push(f.name); });
  Object.keys(perFile).forEach((k) => perFile[k].sort());
  return { all, long, worst, perFile };
}

if (require.main === module) {
  const m = measure();
  const arg = process.argv[2];
  if (arg === '--json' || arg === '--write') {
    const out = { limit: LIMIT, long_functions: m.long.length, worst_complexity: m.worst.complexity,
                  worst_at: m.worst.file + ' ' + m.worst.name, long: m.perFile };
    const text = JSON.stringify(out, null, 2) + '\n';
    if (arg === '--write') { fs.writeFileSync(FIXTURE, text); console.log('wrote ' + path.relative(API, FIXTURE)); }
    else process.stdout.write(text);
  } else {
    console.log(`functions > ${LIMIT} lines in ${DIRS.join('/ ')}/: ${m.long.length}`);
    console.log(`worst complexity: ${m.worst.complexity} — ${m.worst.file}:${m.worst.line} ${m.worst.name}`);
    m.all.slice().sort((a, b) => b.complexity - a.complexity).slice(0, 20).forEach((f) =>
      console.log(`  c${String(f.complexity).padStart(4)}  ${String(f.lines).padStart(5)} lines  ${f.file}:${f.line}  ${f.name}`));
  }
}

module.exports = { measure, LIMIT, FIXTURE };

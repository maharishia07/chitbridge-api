#!/usr/bin/env node
/**
 * fn-size.cjs — MAINT-1's function metrics for lib/ and routes/: how many functions run past 80 lines, and the
 * worst cyclomatic complexity. Round T2-SPLIT (2026-10-14) — the counter the ratchet (tests/fn-size.test.cjs) reads.
 *
 *   node scripts/fn-size.cjs            the two numbers + the twenty worst functions
 *   node scripts/fn-size.cjs --json     every function over the limit, by file and name (what tests/fixtures/fn-size.json holds)
 *   node scripts/fn-size.cjs --write    rewrite tests/fixtures/fn-size.json — ONLY after the count went DOWN
 *
 * OWNS       the count of functions over 80 lines and the worst complexity in lib/ + routes/.
 * CALLED BY  tests/fn-size.test.cjs (the ratchet), tests/fn-size-adopted.test.cjs; by hand with --json / --write.
 * FLOW       walk lib/ + routes/ -> skip the long-count of ADOPTED files -> count -> compare with tests/fixtures/fn-size.json.
 * CARD       28-platform-and-operations/api-standard
 *
 * Adopted engine files (line 1 = the ADOPTED header) skip the long-function count only: chitbridge-engines counts them with its own fn-size ratchet (MNT-45, lands first, same batch).
 *
 * Reads with tests/support/js-scan.cjs (no parser dependency — the offline gate allows none).
 */
'use strict';
const fs = require('fs'),
  path = require('path');
const { functions } = require('../tests/support/js-scan.cjs');

const API = path.join(__dirname, '..');
const LIMIT = 80;
const DIRS = ['lib', 'routes'];
const FIXTURE = path.join(API, 'tests', 'fixtures', 'fn-size.json');

/* line 1 ONLY, the adopt header of lib/ledger.js: a file that mentions ADOPTED elsewhere still counts */
const ADOPTED = /^\/\* ADOPTED from chitbridge-engines v\S+ · \S+ · sha256 /;
const isAdopted = (text) => ADOPTED.test(String(text).split(String.fromCharCode(10), 1)[0]);

/** every .js / .cjs file under one api folder, as repo-relative paths */
function walk(dir) {
  const out = [];
  const absDir = path.join(API, dir);
  if (!fs.existsSync(absDir)) return out;
  for (const f of fs.readdirSync(absDir, { withFileTypes: true })) {
    const relPath = dir + '/' + f.name;
    if (f.isDirectory()) out.push(...walk(relPath));
    else if (/\.(c?js)$/.test(f.name)) out.push(relPath);
  }
  return out;
}

/** scan every folder in DIRS: all functions, the ones over LIMIT (adopted engine files excluded), the most complex, and the long names per file */
function measure() {
  const all = [];
  DIRS.flatMap(walk)
    .sort()
    .forEach((item) => {
      const text = fs.readFileSync(path.join(API, item), 'utf8');
      const adopted = isAdopted(text);
      functions(text).forEach((f) => all.push(Object.assign({ file: item, adopted }, f)));
    });
  const long = all.filter((item) => item.lines > LIMIT && !item.adopted);
  const worst = all.reduce((total, item) => (!total || item.complexity > total.complexity ? item : total), null);
  const perFile = {};
  long.forEach((item) => {
    (perFile[item.file] = perFile[item.file] || []).push(item.name);
  });
  Object.keys(perFile).forEach((item) => perFile[item].sort());
  return { all, long, worst, perFile };
}

if (require.main === module) {
  const sizes = measure();
  const arg = process.argv[2];
  if (arg === '--json' || arg === '--write') {
    const out = {
      limit: LIMIT,
      long_functions: sizes.long.length,
      worst_complexity: sizes.worst.complexity,
      worst_at: sizes.worst.file + ' ' + sizes.worst.name,
      long: sizes.perFile
    };
    const text = JSON.stringify(out, null, 2) + '\n';
    if (arg === '--write') {
      fs.writeFileSync(FIXTURE, text);
      console.log('wrote ' + path.relative(API, FIXTURE));
    } else process.stdout.write(text);
  } else {
    console.log(`functions > ${LIMIT} lines in ${DIRS.join('/ ')}/: ${sizes.long.length}`);
    console.log(`worst complexity: ${sizes.worst.complexity} — ${sizes.worst.file}:${sizes.worst.line} ${sizes.worst.name}`);
    sizes.all
      .slice()
      .sort((first, second) => second.complexity - first.complexity)
      .slice(0, 20)
      .forEach((item) =>
        console.log(`  c${String(item.complexity).padStart(4)}  ${String(item.lines).padStart(5)} lines  ${item.file}:${item.line}  ${item.name}`)
      );
  }
}

module.exports = { measure, isAdopted, LIMIT, FIXTURE };

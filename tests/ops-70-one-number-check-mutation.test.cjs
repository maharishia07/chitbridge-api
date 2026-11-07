#!/usr/bin/env node
// @type: unit
/**
 * ops-70-one-number-check-mutation.test.cjs — OPS-70 mutation checks: break the fix two ways and tests/ops-70-one-number-check.test.cjs MUST go red each time.
 *   1. the store: numbersOf back to Number(qty) || 0 and the bare cost (a qty of true counts as 1, a cost of -5 or "abc" is recorded)
 *   2. the route: purchaseSays without the "at no cost" part
 * A broken copy is written beside the real file, the test is run against it, the copy is deleted. Proves the test can fail.
 * RUN       node tests/ops-70-one-number-check-mutation.test.cjs
 * CARD      16-finance/supply-store
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OLD_READ = "function numbersOf(line) {\n  return { qty: Number(line.qty) || 0, cost: line.cost == null ? null : Number(line.cost) };\n}\n";

/** wentRed(file, edit, envName) — write the edited copy, run the test with env pointing at it, delete the copy; true when the test went red, null when the edit did not apply */
function wentRed(file, edit, envName) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const broken = edit(source);
  if (broken === source) return null;
  const copy = path.join(path.dirname(file), '_mutant-' + path.basename(file));
  fs.writeFileSync(path.join(ROOT, copy), broken);
  try {
    const ran = spawnSync(process.execPath, [path.join(__dirname, 'ops-70-one-number-check.test.cjs')], { env: { ...process.env, [envName]: copy.split(path.sep).join('/') }, encoding: 'utf8' });
    return ran.status === 1 && /FAIL /.test(ran.stdout);
  } finally {
    fs.unlinkSync(path.join(ROOT, copy));
  }
}

const storeEdit = (src) => {
  const from = src.indexOf('function numbersOf(line) {');
  const to = src.indexOf('/** a line with good numbers');
  const next = src.indexOf('/** the lines of this bill');
  const end = Math.min(...[to, next].filter((n) => n > from));
  return from < 0 || !(end > from) ? src : src.slice(0, from) + OLD_READ + '\n' + src.slice(end);
};
const routeEdit = (src) => src.replace(/ {2}const free = [^\n]*\n {2}if \(free\) parts\.push\(free \+ ' at no cost'\);\n/, '');
const cases = [
  ['the store reading numbers with Number() again', wentRed('lib/supply-store.js', storeEdit, 'OPS70_STORE')],
  ['the route without the "at no cost" words', wentRed('routes/supplies.js', routeEdit, 'OPS70_ROUTE')]
];
let bad = 0;
cases.forEach(([label, red]) => {
  if (red !== true) bad++;
  console.log((red === true ? 'ok   ' : 'FAIL ') + label + (red === null ? ' (the mutation did not apply)' : ' makes ops-70-one-number-check.test.cjs go red'));
});
console.log(cases.length + ' checks' + (bad ? ', ' + bad + ' FAILED' : ''));
process.exit(bad ? 1 : 0);

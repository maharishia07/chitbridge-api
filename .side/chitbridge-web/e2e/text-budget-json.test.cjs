/**
 * text-budget-json.test.cjs — the --json rows must add up to the console totals.
 *
 * Runs e2e/text-budget.cjs with --json to a temp file, in one run, so the console report and the JSON come from the
 * same pass. Every per-file column must sum to the matching console total, and the explanation total must equal
 * MAILBOX + MANUAL.
 * If this fails, the per-file numbers the web-done metric reads have drifted from the report people read.
 *
 * Run: node e2e/text-budget-json.test.cjs
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'text-budget.cjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'text-budget-json-'));
const outFile = path.join(tmp, 'out.json');

const run = spawnSync(process.execPath, [SCRIPT, '--json', outFile], { encoding: 'utf8' });
assert.strictEqual(run.status, 0, 'text-budget.cjs --json exited ' + run.status + ': ' + run.stderr);

/* The console totals, read from the report itself (not from a second count). "LABEL" is anchored so it cannot
 * match the "LONG LABEL" row. */
const out = run.stdout;
const num = (re, label) => {
  const m = out.match(re);
  assert.ok(m, 'console report has no ' + label + ' row');
  return Number(m[1]);
};
const console_ = {
  strings: num(/^\s+TOTAL\s+(\d+)/m, 'TOTAL'),
  labels: num(/^\s+LABEL\s+(\d+)/m, 'LABEL'),
  long_labels: num(/^\s+LONG LABEL\s+(\d+)/m, 'LONG LABEL'),
  explanations: num(/^\s+EXPLANATION\s+(\d+)/m, 'EXPLANATION'),
  words: num(/^\s+TOTAL\s+\d+\s+100%\s+(\d+) words/m, 'TOTAL words'),
};
const mailboxPlusManual = num(/^\s+MAILBOX\s+(\d+)/m, 'MAILBOX') + num(/^\s+MANUAL\s+(\d+)/m, 'MANUAL');

const doc = JSON.parse(fs.readFileSync(outFile, 'utf8'));
assert.ok(typeof doc.generated === 'string' && !Number.isNaN(Date.parse(doc.generated)), 'generated is not a timestamp');
assert.ok(Array.isArray(doc.files) && doc.files.length > 0, 'files is empty');

const KEYS = ['strings', 'labels', 'long_labels', 'explanations', 'words', 'over_budget'];
for (const f of doc.files) {
  assert.ok(typeof f.file === 'string' && f.file.length > 0, 'row without a file name');
  for (const k of KEYS) assert.ok(Number.isInteger(f[k]) && f[k] >= 0, f.file + ' has a bad ' + k);
}

const sum = (k) => doc.files.reduce((a, f) => a + f[k], 0);
for (const k of ['strings', 'labels', 'long_labels', 'explanations', 'words']) {
  assert.strictEqual(sum(k), console_[k], 'per-file ' + k + ' sums to ' + sum(k) + ' but the console says ' + console_[k]);
}
/* explanations split into MAILBOX + MANUAL on the console; the per-file rows carry the whole explanation count. */
assert.strictEqual(sum('explanations'), mailboxPlusManual, 'explanations do not equal MAILBOX + MANUAL on the console');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('text-budget-json: PASS  ' + doc.files.length + ' files; strings ' + console_.strings
  + ', labels ' + console_.labels + ', long ' + console_.long_labels + ', explanations ' + console_.explanations
  + ', words ' + console_.words + ' all add up');

/**
 * guard-walk-today.cjs — a walk never reads the runner's clock for a business date (round QW1-TODAY, 2026-10-14).
 *
 * Every walk runs on ONE injected "today" (CB_TODAY, e2e/lib/today.cjs). A zero-argument `new Date()` or a `Date.now()` in
 * e2e/walk-*.cjs or the stand-ins under them (e2e/lib/*.cjs) reads the runner's UTC day — the 12 Oct failure. Use TD.TODAY · TD.now() ·
 * TD.nowIso() · TD.nowMs() · TD.dayPlus(n). A line that truly needs the real clock (a unique suffix, a wait timer) says
 * `clock-ok: <why>` in a comment on the same line. today.cjs itself is the one place that reads it.
 */
'use strict';
const fs = require('fs'), path = require('path');
const files = fs.readdirSync(__dirname).filter((f) => /^walk-.*\.cjs$/.test(f)).map((f) => path.join(__dirname, f))
  .concat(fs.readdirSync(path.join(__dirname, 'lib')).filter((f) => f.endsWith('.cjs') && f !== 'today.cjs').map((f) => path.join(__dirname, 'lib', f)));
const bad = [];
for (const f of files) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    if (/new Date\(\s*\)|Date\.now\(\s*\)/.test(l) && !/clock-ok/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)) bad.push(path.relative(path.join(__dirname, '..'), f) + ':' + (i + 1) + '  ' + l.trim().slice(0, 110));
  });
}
if (bad.length) { console.log('guard-walk-today: ' + bad.length + ' raw clock read(s) in a walk — use e2e/lib/today.cjs (or add `clock-ok: why`):\n' + bad.join('\n')); process.exit(1); }
console.log('guard-walk-today: ' + files.length + ' walk files, no raw clock read for a business date');

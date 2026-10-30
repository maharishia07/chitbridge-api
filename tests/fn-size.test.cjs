/**
 * tests/fn-size.test.cjs — THE RATCHET: no new function over 80 lines in lib/ or routes/, and the worst complexity never rises.
 *
 * Round T2-SPLIT (2026-10-14, Tier 2 — "code maintainability is the motto"). MAINT-1 measured the giant handlers; this round
 * split the worst (POST /chits/send 1,408 lines c350 · POST /network-design/build 507 · deliver-lines · the trace walks) into
 * named steps. 167 functions over 80 lines → 160; worst complexity 350 → 188. This guard keeps it that way:
 *
 *   ★★ every function over 80 lines is one tests/fixtures/fn-size.json already lists (by file and name) — the list may only
 *      SHRINK. A new long function, or a short one that grew past 80, fails here: split it into named steps.
 *   ★  no function is more complex than the worst one recorded
 *   ★  a listed function that is no longer long must leave the list (`node scripts/fn-size.cjs --write`), so the ratchet
 *      tightens instead of leaving room for the next one to creep back
 *
 * Counted by scripts/fn-size.cjs on tests/support/js-scan.cjs (no parser dependency). No DB, no network.
 */
'use strict';
const path = require('path');
const CHITS = require('../tools/chits-files.cjs'); /* the four handlers are named by NAME: they stay steps wherever a split puts them */
const { measure, LIMIT, FIXTURE } = require(path.join(__dirname, '..', 'scripts', 'fn-size.cjs'));

let pass = 0, fail = 0;
const t = (name, ok, why) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  XX  ' + name + (why ? '\n        ' + why : '')); } };

const want = require(FIXTURE);
const m = measure();

/* multiset difference: names present now beyond what the fixture allows, per file */
function beyond(now, allowed) {
  const out = [];
  for (const file of Object.keys(now)) {
    const left = (allowed[file] || []).slice();
    for (const name of now[file]) {
      const i = left.indexOf(name);
      if (i >= 0) left.splice(i, 1); else out.push(file + ' · ' + name);
    }
  }
  return out;
}

console.log('\nfunction size · the ratchet (limit ' + LIMIT + ' lines, lib/ + routes/)');
const added = beyond(m.perFile, want.long);
t('★★ no function over ' + LIMIT + ' lines that the list does not already hold (' + m.long.length + ' now, ' + want.long_functions + ' allowed)',
  added.length === 0,
  'new long function(s) — split into named steps (see routes/chits.js POST /send, lib/network-build-run.js):\n        ' + added.slice(0, 15).join('\n        '));
const gone = beyond(want.long, m.perFile);
t('★ the list holds no function that is no longer long — run `node scripts/fn-size.cjs --write` so it cannot creep back',
  gone.length === 0, gone.slice(0, 15).join('\n        '));
t('★ no function more complex than the worst recorded (' + want.worst_complexity + ', ' + want.worst_at + ')',
  m.worst.complexity <= want.worst_complexity,
  m.worst.file + ':' + m.worst.line + ' ' + m.worst.name + ' is c' + m.worst.complexity);
/* the split itself must not come back — the four handlers this round named */
const back = m.long.filter((f) => (CHITS.list(path.join(__dirname, '..')).includes(f.file) && /^(POST \/send|POST \/:chit_id\/deliver-lines|GET \/:id\/trace|GET \/trace\/by-batch)$/.test(f.name))
  || (f.file === 'routes/network-design.js' && f.name === 'POST /build' && f.lines > 98)); /* iter1 (Athi, 19 Oct): formatted, POST /build is 98 lines; that is its baseline and it may only go down */
t('★★ the handlers T2-SPLIT named stay steps (send · deliver-lines · trace · by-batch · network build)', back.length === 0,
  back.map((f) => f.file + ':' + f.line + ' ' + f.name + ' ' + f.lines + ' lines').join('; '));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log('  ' + pass + ' checks');
process.exit(fail ? 1 : 0);

'use strict';
// case-fields.test.js — every field the build emits on a case survives the importCases door.
//
// ── ⚠️⚠️ WHY THIS FILE EXISTS: THREE TIMES IN TWO DAYS, SAME SHAPE ─────────────────────────────────────────
//
// `importCases` copies a NAMED LIST of fields into `rules` and discards anything not on the list, silently.
//
//   · `seq`          — emitted on 616 cases, dropped, and the board sorted alphabetically for a week
//   · `changed_at` / `needs` / `held` — dropped, and seven reds were judged DEFECTS using fields that never
//     arrived; two of those "defects" had been fixed hours earlier
//   · `menu` / `generated` — dropped, and 266 swept cases showed no door and no caveat
//
// Each time the symptom was different and the shape identical, and each time it was found by a person looking
// at the board and asking why a column was empty. That is an expensive way to find a one-line omission.
//
// ⭐ SO THE GUARD ASKS THE TWO ENDS WHETHER THEY AGREE, and it asks in the direction the bug actually runs:
// for every field the BUILD puts on a case, does the DOOR name it? The reverse direction is fine — the door
// may name a field no case happens to carry yet — so it is reported as a note, not a failure.
//
// ⚠️ It reads routes/testing.js as TEXT. A guard that imported the route would need a database and would not
// run here; reading the source is honest about what it can see, which is the literal list, and the literal
// list is exactly the thing that goes stale.
//
// Run: node tests/case-fields.test.js   · no network, no DB.
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  XX  ' + name + ' — ' + e.message); fail++; }
};

const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'test-cases.json'), 'utf8')).cases;
const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'testing.js'), 'utf8');

/**
 * The `rules: { … }` object inside importCases, as text. Bounded by the line that opens it and the line that
 * closes it, both of which are unique in the function.
 */
function rulesBlock() {
  const from = SRC.indexOf('async function importCases(');
  if (from < 0) throw new Error('importCases is gone — this guard no longer knows what it is guarding');
  const open = SRC.indexOf('rules: {', from);
  if (open < 0) throw new Error('importCases no longer builds a `rules` object — re-read this guard');
  const close = SRC.indexOf('\n      },', open);
  if (close < 0) throw new Error('cannot find the end of the `rules` object');
  /**
   * ⚠️ COMMENTS OUT, and this is not tidiness. Five thousand of that block's six thousand characters are the
   * notes recording the three times this bug happened — and those notes NAME the dropped fields, in prose,
   * with a colon after them ("the board showed `menu: (none)`"). A guard that reads its own incident report
   * as evidence that the field arrived would pass on the very day the field was dropped again.
   */
  return SRC.slice(open, close).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * ⚠️ IDENTITY IS NOT IN `rules`, and that is correct — these are columns of their own on the definition row,
 * or are re-derived at the far end. Naming them here says they were CONSIDERED, so a future reader does not
 * have to work out whether their absence is the bug this file is about.
 */
const NOT_IN_RULES = {
  case_key: 'the identity — its own column',
  id: 'the same identity under the build\'s name',
  module_key: 'its own column',
  module_name: 'carried, but read from the module not the case',
  version: 'set by the door, never by the document',
};

t('every field the build emits is named by the importCases door', () => {
  const block = rulesBlock();
  const emitted = {};
  CASES.forEach((c) => Object.keys(c).forEach((k) => { emitted[k] = (emitted[k] || 0) + 1; }));

  const dropped = Object.keys(emitted).sort().filter((k) => {
    if (NOT_IN_RULES[k]) return false;
    /* the door names a field as `name:` at the head of a property — anywhere in the rules object */
    return !new RegExp('(^|[\\s{,])' + k + '\\s*:').test(block);
  });

  if (dropped.length) {
    throw new Error('the door drops ' + dropped.length + ' field(s) the build emits, without a word: '
      + dropped.map((k) => k + ' (on ' + emitted[k] + ' case(s))').join(', ')
      + ' — add them to `rules` in routes/testing.js, or to NOT_IN_RULES here with the reason they belong '
      + 'somewhere else');
  }
});

/**
 * ⭐ AND THE ONE THAT MATTERS MOST, because it is the field a tester reads first: the menu sweep exists so a
 * person holding the screen knows WHICH DOOR they are standing in. If `menu` ever stops arriving, every one of
 * those cases silently becomes an instruction with no context.
 */
t('the swept cases carry their door and admit they were generated', () => {
  const swept = CASES.filter((c) => c.generated);
  if (!swept.length) throw new Error('no generated cases at all — did the sweep stop being built in?');
  const noMenu = swept.filter((c) => !c.menu);
  if (noMenu.length) throw new Error(noMenu.length + ' of ' + swept.length
    + ' generated cases carry no `menu`, e.g. ' + noMenu[0].case_key);
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

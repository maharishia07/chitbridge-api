#!/usr/bin/env node
'use strict';
/**
 * guard-static.test.cjs — MUTATION TEST FOR THE GUARD ITSELF.
 *
 * Check 3 went from 24 warnings to zero on 2026-08-15. That is either a codebase that is clean or a check that
 * has gone blind, and the two look identical from the outside. Every other harness in this repo is mutation-tested
 * for exactly this reason (cap-network-render fails 2 when the renderer creates the cart, 1 when `pick-net` is
 * renamed); a static guard deserves the same, because it is the thing standing between a defect and a deploy.
 *
 * The known-bad cases below were MEASURED in a live page, 400px row, with the global `.btn{width:100%}`:
 *     <input style="flex:1"> + <button class="btn">   →  INPUT 27px · BUTTON 367px
 *
 * ⚠️ Keep this in step with check 3 in guard-static.cjs. If that rule changes, this file is what proves the new
 * one still sees the bug the old one was written for.
 */

/* The rule under test, copied verbatim from guard-static.cjs check 3. */
const BTN = /<button[^>]*class=\\?"btn[^"\\]*\\?"[^>]*>/g;
function flags(line) {
  const siblings = line.replace(BTN, '');
  if (!/flex:\s*1/.test(siblings)) return false;
  return (line.match(BTN) || []).some((tag) => {
    const own = (tag.match(/style=\\?"([^"\\]*)/) || [])[1] || '';
    return !(/width:\s*auto/.test(own) || /flex:/.test(own));
  });
}

const CASES = [
  ['BUG · plain html — grown input beside a bare .btn',
    '<div style="display:flex"><input style="flex:1"><button class="btn">Go</button></div>', true],
  ['BUG · escaped, the way a cap-*.js emits it',
    '+ \'<div style="display:flex"><input style="flex:1"><button class=\\"btn\\">Go</button></div>\'', true],
  ['BUG · the button is second and still unguarded',
    '<div style="display:flex;gap:6px"><input class="inp" style="flex:1"><button class="btn" onclick="go()">Add</button></div>', true],
  ['SAFE · width:auto on the button',
    '<div style="display:flex"><input style="flex:1"><button class="btn" style="width:auto">Go</button></div>', false],
  ['SAFE · the button declares its own flex',
    '<div style="display:flex"><button class="btn" style="flex:1">A</button><button class="btn" style="flex:1">B</button></div>', false],
  ['SAFE · no flex anywhere — width:100% is just a block button',
    '<div><input><button class="btn">Go</button></div>', false],
  /**
   * ⚠️ THIS CASE CAUGHT ME WRITING A TEST TO MATCH THE CODE. I first wrote it `true` — labelled SAFE, expected
   * flagged — because that is what the rule did at the time. Measured, two bare `.btn`s in a flex row are
   * 197/197 in a 400px row: nothing is crushed, so flagging it is a false positive and encoding that as the
   * expectation is how a check becomes decoration. The rule was tightened to require a growing sibling.
   */
  ['SAFE · two bare .btns split the row 197/197 — no growing sibling to starve',
    '<div style="display:flex"><button class="btn">A</button><button class="btn">B</button></div>', false],
];

let bad = 0;
CASES.forEach(([name, line, want]) => {
  const got = flags(line);
  const ok = got === want;
  if (!ok) bad++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + '  → flagged=' + got + ' (want ' + want + ')');
});
console.log(bad
  ? '\n== GUARD-TEST ==  ' + bad + ' case(s) wrong — check 3 does not mean what it says'
  : '\n== GUARD-TEST ==  check 3 catches the measured bug and ignores the safe shapes');
process.exit(bad ? 1 : 0);

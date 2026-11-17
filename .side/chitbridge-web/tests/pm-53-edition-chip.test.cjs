#!/usr/bin/env node
// @type: unit
// UNIT      29/Editions (shop / auditor / …)
/**
 * pm-53-edition-chip.test.cjs — PM-53 (proof 2026-11-14): the 'Auditor view' edition chip in the bar is a BUTTON that opens the Edition choice, and the x
 * beside it goes back to Everything (public/app/shell.js editionChipsHTML / wireEditionChips / openEditionChoice, the real code, over a stand-in page).
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node tests/pm-53-edition-chip.test.cjs
 */
'use strict';
const assert = require('assert');
const { sliceFrom, run } = require('./lib/proof-lift.cjs');

let pass = 0;
const ok = (condition, name) => { assert(condition, name); pass++; console.log('  ok  ' + name); };

const code = sliceFrom('public/app/shell.js', '  function editionChipsHTML(edition) {', '  /* ── the money glyph');
const calls = { avatarClicks: 0, setCalls: [], scrolled: 0, firstFocused: 0 };
const first = { focus() { calls.firstFocused++; } };
const group = { scrollIntoView() { calls.scrolled++; }, querySelector: (s) => (s === 'button' ? first : null) };
const avatarButton = { click() { calls.avatarClicks++; } };
const root = {
  document: { querySelector: (s) => (s === '[data-testid="avatar"]' ? avatarButton : s === '[data-testid="edition-group"]' ? group : null) },
  CBAvatar: { isOpen: () => false, set: (key, value) => calls.setCalls.push([key, value]) }
};
const sandbox = { root, esc: (s) => String(s), W: {}, shellMount: () => '' };
run(code + '\nthis.editionChipsHTML = editionChipsHTML; this.wireEditionChips = wireEditionChips;', sandbox);

const html = sandbox.editionChipsHTML({ key: 'auditor', chip: 'Auditor view' });
ok(/<button type="button"[^>]*data-testid="shell-edition-chip"[^>]*data-edition="auditor"[^>]*>Auditor view<\/button>/.test(html), 'PM-53: the edition chip is a <button> carrying the edition name, not a label');
ok(/title="Change what this shows"/.test(html), 'PM-53: the chip says what pressing it does');
ok(/data-testid="shell-edition-off"[^>]*aria-label="Show everything"/.test(html), 'PM-53: a way back from the bar: the x button named "Show everything"');
ok(sandbox.editionChipsHTML(null) === '', 'PM-53: the full app (no edition) draws no chip');

const spot = { chip: {}, off: {}, querySelector(s) { return s.indexOf('shell-edition-chip') >= 0 ? this.chip : s.indexOf('shell-edition-off') >= 0 ? this.off : null; } };
sandbox.wireEditionChips(spot);
spot.chip.onclick();
ok(calls.avatarClicks === 1, 'PM-53: pressing the chip opens the avatar menu');
ok(calls.scrolled === 1 && calls.firstFocused === 1, 'PM-53: and puts the Edition group in view with its first choice focused');
spot.off.onclick();
ok(calls.setCalls.length === 1 && calls.setCalls[0].join() === 'edition,full', 'PM-53: the x goes straight back to the full showing (CBAvatar.set edition full)');
root.CBAvatar.isOpen = () => true;
spot.chip.onclick();
ok(calls.avatarClicks === 1, 'PM-53: with the menu already open the chip does not toggle it shut');
console.log(pass + ' passed');

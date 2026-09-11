/**
 * ── tests/type-tokens.test.js · A NEW SURFACE CANNOT IGNORE THE READER ────────────────────────────────────────
 *
 * Athi, 2026-09-11, on the test panel: *"the text size is not changing if I increase the size, I guess you have
 * not used the capability here. I am just trying to test how the capability behaves when we design a new one."*
 *
 * ⭐⭐⭐ HE WAS TESTING THE CAPABILITY, NOT THE PANEL — and the answer he got is the one this file exists to
 * change. `appearanceApply()` scales the `--fs-*` tokens on `<html>`, so anything written as `var(--fs-2)` follows
 * a reader who chose Large or Extra large. A raw `12px` does not. The mechanism works perfectly and inherits all
 * the way down the DOM without a single import — but NOTHING MADE A NEW FILE USE IT, so the newest file in the
 * repository shipped 36 raw sizes and the whole panel ignored the setting.
 *
 * ⚠️⚠️ THAT IS THE WORST SHAPE OF ACCESSIBILITY FAULT: invisible to everyone who never changes the setting, and
 * total for the person who did. Nobody reports it, because the people who would are the people who left.
 *
 * ── ⭐⭐ WHY A RATCHET AND NOT A SWEEP ──────────────────────────────────────────────────────────────────────
 *
 * `e2e/type-scale.cjs` already measured the whole platform and found ~1,033 raw declarations across app.html and
 * the standalone pages, on a scale that was designed independently of the token scale. Rewriting those would
 * resize 656 of them down and 377 up — a visual redesign of every screen, and Athi's call rather than a sweep.
 *
 * ⭐ So this guards the CAPABILITY FILES, where the numbers are small and the rule is clean: every existing file
 * is budgeted at what it has today, and a file that is not in the budget must have NONE. Write a new capability
 * and the only way to pass is to use the tokens. The cascade is the mechanism; this is what makes it
 * unforgettable.
 *
 * Run: node tests/type-tokens.test.js   · no network, no DB.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..', '..', 'chitbridge-web', 'public', 'app');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

/**
 * ⚠️ RECORDED, NOT BLESSED. Each of these is a place a reader who chose Extra large is still ignored. The number
 * may go DOWN at any time and the test below says so; it may never go up.
 */
const BUDGET = {
  'cart.js': 9,              // the money block and the badges — the densest surface we have
  'cap-workforce.js': 3,
  'cap-catsetup.js': 3,
  'catalogue-lines.js': 2,
  'cap-legend.js': 2,
  'cap-definitions.js': 2,
  'cap-admin.js': 2,
  'cap-intake.js': 1,
  'cap-dispute.js': 1,
  'cap-connector.js': 1,
};

const RAW = /font-size:\s*[0-9.]+px/g;

function counts() {
  const out = {};
  fs.readdirSync(APP).filter((f) => f.endsWith('.js')).forEach((f) => {
    const n = (fs.readFileSync(path.join(APP, f), 'utf8').match(RAW) || []).length;
    if (n) out[f] = n;
  });
  return out;
}

console.log('— a size the reader cannot change is a size the reader is stuck with —');

const found = counts();

it('⭐⭐⭐ a capability that is not budgeted uses the TOKENS, not raw pixels', () => {
  /**
   * ⭐ THIS IS THE WHOLE TEST. A new file has a budget of zero, so the only way to pass is `var(--fs-1..5)` —
   * which is what makes the Appearance capability reach a surface nobody remembered to think about.
   */
  const newOnes = Object.keys(found).filter((f) => !(f in BUDGET))
    .map((f) => f + ': ' + found[f] + ' raw size(s)');
  assert.deepStrictEqual(newOnes, [],
    'These use raw pixel sizes, so a reader who set Large or Extra large is ignored on them. Use the declared '
    + 'scale — var(--fs-1) 11 · var(--fs-2) 12.5 · var(--fs-3) 14 · var(--fs-4) 16 · var(--fs-5) 20 — which '
    + 'appearanceApply() scales on <html>. If a size genuinely cannot be a token, add it to BUDGET and say why.');
});

it('⚠️ no budgeted file has grown', () => {
  const worse = Object.keys(BUDGET).filter((f) => (found[f] || 0) > BUDGET[f])
    .map((f) => f + ': ' + found[f] + ' (budget ' + BUDGET[f] + ')');
  assert.deepStrictEqual(worse, [], 'a file with known debt added more of it');
});

it('⭐ the budget does not name files that are clean now', () => {
  /* ⚠️ A budget left behind after the debt is paid quietly re-permits it. Lower it when you fix one. */
  const stale = Object.keys(BUDGET).filter((f) => !found[f]);
  assert.deepStrictEqual(stale, [], 'these are clean — remove them from BUDGET so it cannot creep back');
  Object.keys(BUDGET).sort().forEach((f) => {
    if ((found[f] || 0) < BUDGET[f]) console.log('        ↓ ' + f + ': ' + found[f] + ' of ' + BUDGET[f] + ' — lower the budget');
  });
});

it('⚠️ and the tokens themselves are still the ones appearanceApply scales', () => {
  /**
   * ⚠️ THE OTHER HALF OF THE MECHANISM. If FS_BASE stopped naming a token, every `var(--fs-N)` using it would
   * fall back to whatever the stylesheet declared and stop responding — the same failure, arrived at from the
   * opposite direction, and with nothing on screen to show for it.
   */
  const app = fs.readFileSync(path.join(APP, '..', 'app.html'), 'utf8');
  const m = app.match(/var FS_BASE = \{([^}]*)\}/);
  assert.ok(m, 'FS_BASE is gone — nothing scales the type any more');
  ['--fs-1', '--fs-2', '--fs-3', '--fs-4', '--fs-5'].forEach((t) => {
    assert.ok(m[1].indexOf(t) >= 0, t + ' is no longer scaled by appearanceApply');
  });
  assert.ok(/Object\.keys\(FS_BASE\)[\s\S]{0,200}setProperty/.test(app),
    'appearanceApply no longer writes the FS_BASE tokens onto the root element');
});

console.log('\n  ' + pass + ' checks · ' +
  Object.keys(found).reduce((a, f) => a + found[f], 0) + ' raw sizes across ' +
  Object.keys(found).length + ' capability files\n');

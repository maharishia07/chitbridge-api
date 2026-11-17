/**
 * e2e/tooltip-length.cjs — a tooltip is a label, not a paragraph.
 *
 * Athi, 2026-08-22: *"the messages you are showing are going away from the screen… I am talking about the
 * fingertip message, many of them are overflowing, you may have to correct all."*
 *
 * ⚠️⚠️ AND THE WORST ONE WAS WRITTEN AN HOUR EARLIER, BY ME. Turning Metrics / Group sum / Rules into icons
 * meant the `title` became the only place the name survived — and I used that as licence to move the whole
 * explanation into it. 187 characters, two sentences, hovering over a 30px button.
 *
 * ⭐ THE RULE IS ABOUT WHERE EXPLANATION LIVES, NOT ABOUT CHARACTERS. A tooltip is read in a hover, cannot be
 * scrolled, cannot be selected, is not readable at all on a touch screen, and covers whatever is under it.
 * Anything a person needs in order to ACT belongs on the screen where they can keep it. The Group sum caveat
 * about counting every status went into the PANE for exactly this reason, and the tooltip kept the name.
 *
 * ⚠️ MEASURE THE LONGEST RENDERED BRANCH, NOT THE SOURCE. Half of these are templates —
 * `'+(verified?'…':'…')+'` — whose source is long while every branch renders short. A checker that measures
 * the literal would flag correct code and be relaxed until it measured nothing, which is how a guard dies.
 */
const fs = require('fs');
const path = require('path');

const W = path.join(__dirname, '..', 'public');
const files = ['app.html'].concat(
  fs.readdirSync(path.join(W, 'app')).filter((f) => f.endsWith('.js')).map((f) => path.posix.join('app', f)));

/** ⭐ The bar: one comfortable line of hover text. */
const MAX = 80;

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

/**
 * Reduce a title's SOURCE to the longest text a reader can actually see.
 *  · `'+expr+'` and `${expr}`  → an interpolated value; counted as a short stand-in, not as its source
 *  · `a ? 'x' : 'y'`           → whichever branch is longer, since only one is ever shown
 */
function longestRendered(src) {
  let s = src;
  const longer = (a, b) => (a.length >= b.length ? a : b);

  /**
   * ⚠️⚠️ THE WRAPPER AND ITS TERNARY MUST RESOLVE TOGETHER, and my first version did them in two steps: it
   * turned the ternary into prose and then the NEXT rule saw `'+(ok prose)+'`, recognised the wrapper, and
   * replaced the prose it had just recovered with a placeholder. Every branchy tooltip measured 1 character.
   *
   * ⭐ A two-pass rewrite where pass two can eat pass one's output is not a smaller bug than a wrong regex —
   * it is the same bug with a longer fuse, and it failed in the SAFE direction, which is how it would have
   * survived: a checker that reports everything as short simply never complains.
   */
  for (let i = 0; i < 4; i++) {
    s = s.replace(/'\s*\+\s*\(?[^?+]*\?\s*'([^']*)'\s*:\s*'([^']*)'\s*\)?\s*\+\s*'/g, (m, a, b) => longer(a, b));
    s = s.replace(/\$\{[^}?]*\?\s*'([^']*)'\s*:\s*'([^']*)'\s*\}/g, (m, a, b) => longer(a, b));
    s = s.replace(/\?\s*'([^']*)'\s*:\s*'([^']*)'/g, (m, a, b) => longer(a, b));
  }
  /* whatever interpolation is left stands for one value a reader sees as a word or two */
  s = s.replace(/\$\{[^}]*\}/g, '…').replace(/'\s*\+[^+]*\+\s*'/g, '…');
  /* leftover code punctuation that never reaches the screen */
  s = s.replace(/\+\s*esc\([^)]*\)/g, '…').replace(/[()]/g, '');
  return s.trim();
}

const long = [];
let total = 0;
for (const rel of files) {
  const src = fs.readFileSync(path.join(W, rel), 'utf8');
  for (const m of src.matchAll(/title="([^"]{1,400})"/g)) {
    total++;
    const shown = longestRendered(m[1]);
    if (shown.length > MAX) long.push({ key: rel + '  ' + shown.slice(0, 72), show: rel + '  ' + shown.length + '  ' + shown.slice(0, 72) });
  }
}

console.log('\n── a tooltip names the thing; the screen explains it ──');
console.log('  ' + total + ' tooltips scanned, bar is ' + MAX + ' characters\n');
/* QA-154: known findings live in e2e/scanner-known.json; only a NEW one fails */
const RK = require('./lib/known-findings.cjs').ratchet('tooltip-length', long, { owner: 'ux-locale' });
console.log(RK.line);
t('no NEW tooltip is longer than a line', RK.fresh.length === 0, RK.fresh.length ? '' : 'none beyond the known');
RK.fresh.forEach((l) => console.error('      ' + l.show));

/**
 * ⚠️ AND THE MEASURER MUST BE SHOWN TO MEASURE. Every scan written this week was wrong before it was right —
 * this one in the over-matching direction, which is the direction that gets a guard deleted.
 */
console.log('\n── it reads templates the way a reader sees them ──');
t('a ternary counts only the branch that shows',
  longestRendered("'+(ok?'short':'a rather longer branch here')+'").length === 'a rather longer branch here'.length,
  JSON.stringify(longestRendered("'+(ok?'short':'a rather longer branch here')+'")));
t('an interpolated value is not counted as its source',
  longestRendered("Arrived over ${someVeryLongExpressionNameThatGoesOnAndOn} now").length < 30,
  JSON.stringify(longestRendered('Arrived over ${someVeryLongExpressionNameThatGoesOnAndOn} now')));
t('  …and a genuinely long sentence is still caught',
  longestRendered('Group sum — what this whole track adds up to: quantity per item, cost, and who asked. Counts every chit regardless of the tab.').length > MAX);

console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
process.exit(fail ? 1 : 0);

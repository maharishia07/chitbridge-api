'use strict';
/**
 * till-watch.test.js — THE WATCH LIST NAMES REAL GATES ([TILL-144]).
 *
 * ── ⚠️⚠️⚠️ WHAT THIS DEFENDS ────────────────────────────────────────────────────────────────────────────
 *
 * Athi, with the line simulator on: *"can you bring what are to be affected in the test location itself?
 * … what will be other issues to be listed? can we make it explicit?"* — and then *"can we bring all those
 * under watchdog?"*
 *
 * WATCH has three readers: the simulator panel (what WILL stop), the watchdog (what HAS stopped), and the
 * health page. That only works while every row corresponds to a gate that really refuses. The first draft of
 * the list named THREE functions that do not exist — reportSend, aliasLook, speakStart — written from memory
 * rather than read off the page. Nothing would have failed: the panel would have gone on listing a capability
 * nothing watches, and the watchdog would have gone on reporting green past a gate that had moved.
 *
 * ⚠️⚠️ THAT IS THE EXACT FAILURE THIS PRODUCT KEEPS PAYING FOR — a true-sounding statement with nothing
 * behind it. So `at` is checked against the source, every time.
 *
 * Run: node tests/till-watch.test.js   · no DB, no browser.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/** the declared list, lifted out of the page */
const BODY = (function () {
  const a = PAGE.indexOf('var WATCH = [');
  assert.ok(a > 0, 'WATCH is gone — this guard is measuring nothing');
  const b = PAGE.indexOf('\n];', a);
  assert.ok(b > a, 'WATCH does not close');
  return PAGE.slice(a, b);
})();
const ROWS = BODY.split(/\{\s*id:/).slice(1).map((chunk) => ({
  id:   (chunk.match(/^'([a-z]+)'/) || [])[1],
  at:   (chunk.match(/at:'([^']+)'/) || [])[1],
  name: (chunk.match(/name:'([^']*)'/) || [])[1],
  costs:(chunk.match(/costs:'([^']*)'/) || [])[1],
  /* ⚠️ MOVED ([TILL-151]): a row now carries a bucket, and a blocked row carries the way round it */
  bucket:(chunk.match(/bucket:'([a-z_]+)'/) || [])[1],
  fix:  (chunk.match(/fix:'([^']*)'/) || [])[1],
}));

console.log('\nTHE WATCH LIST\n');

it('there is a list, and it is not a token one', () => {
  assert.ok(ROWS.length >= 10, 'only ' + ROWS.length + ' rows — the line touches far more than that');
});

/**
 * ⚠️⚠️⚠️ THE ONE THAT WOULD HAVE CAUGHT MY OWN MISTAKE. Three of twelve rows named a function that has never
 * existed in this page. A watch row whose gate cannot be found is watching nothing.
 */
it('⚠️⚠️⚠️ every row names a gate that exists in the page', () => {
  const missing = ROWS.filter((r) => {
    if (!r.at) return true;
    const leaf = r.at.replace(/^CloudHost\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !(new RegExp('function\\s+' + leaf + '\\s*\\(|async\\s+' + leaf + '\\s*\\(|\\b' + leaf + '\\b')
      .test(PAGE.replace(BODY, '')));
  });
  assert.strictEqual(missing.length, 0,
    'these rows name something that is not in the page: ' + missing.map((r) => r.id + '->' + r.at).join(', '));
});

it('every row says something a shopkeeper can use, not what the code does', () => {
  /* ⚠️ MOVED ([TILL-151]): a row earns its place with a consequence OR a way round it. A 'waits' row often
     needs neither — "Sold-out marks and price changes, 3 waiting" is complete — so the rule is that it must
     never be written for US. That half is unchanged and is the half that matters. */
  const jargon = ROWS.filter((r) => /fetch|endpoint|api\b|promise|payload/i.test((r.costs || '') + (r.fix || '')));
  assert.strictEqual(jargon.length, 0, 'written for us, not for the shop: ' + jargon.map((r) => r.id).join(', '));
});

/**
 * ⭐⭐ THE ORDER IS THE MESSAGE ([TILL-151], design-handoff/without-the-line). Athi: *"ten 'stopped' bullets
 * against two 'working' reads as a catastrophe."* The registry must contain what CARRIES ON, or the panel can
 * only ever sound like bad news — that was the whole defect, and it is a property of the data, not the CSS.
 */
it('⭐⭐ it knows what carries on, not only what breaks', () => {
  const normal = ROWS.filter((r) => r.bucket === 'normal');
  assert.ok(normal.length >= 6, 'only ' + normal.length + ' rows carry on as normal — the panel will read as a disaster');
  assert.ok(normal.some((r) => /Selling/i.test(r.name || '')), 'selling is not listed as carrying on');
  assert.ok(normal.some((r) => /Printing/i.test(r.name || '')), 'printing is not listed as carrying on');
  assert.ok(normal.some((r) => /Taking money/i.test(r.name || '')), 'taking money is not listed as carrying on');
});

/** ⚠️⚠️ EVERY BLOCKED THING CARRIES ITS WAY ROUND IT, ON ITS OWN CARD (spec §8.2) */
it('⚠️⚠️ nothing is blocked without saying what to do instead', () => {
  const need = ROWS.filter((r) => r.bucket === 'needs_line');
  assert.ok(need.length >= 4, 'only ' + need.length + ' rows need the line');
  const bare = need.filter((r) => !r.fix || r.fix.length < 6);
  assert.strictEqual(bare.length, 0, 'blocked with no way round it: ' + bare.map((r) => r.id).join(', '));
});

/**
 * ⚠️⚠️ A WATCH LIST THAT ONLY KNOWS ABOUT THE INTERNET IS THE COMFORTABLE ONE. It goes green on a counter
 * that cannot save a bill — and green is the answer that stops somebody looking. Storage is the only fault
 * in this product that can LOSE work.
 */
it('⚠️⚠️ it watches the one fault that can lose work', () => {
  const save = ROWS.find((r) => r.id === 'save');
  assert.ok(save, 'storage is not watched at all');
  assert.ok(/MEM\.fail/.test(BODY), 'it does not read the flag that a refused write actually sets');
  /* ⚠️ MOVED ([TILL-152]): the row now reads positively because it sits in "carries on as normal", and the
     alarm moved to lineFaults(), which lifts a broken 'normal' row out ABOVE everything else on the panel. */
  assert.ok(/function lineFaults\(/.test(PAGE), 'a broken device row is no longer lifted out of the good news');
  assert.ok(/till-line-fault/.test(PAGE), 'and it has nowhere on the panel to appear');
});

it('and it watches whether this counter still holds its number', () => {
  /* ⚠️ MOVED ([TILL-151]): the row is 'nos' — bill numbers — which is what a lost counter actually costs */
  const own = ROWS.find((r) => r.id === 'nos');
  assert.ok(own, 'a counter taken over elsewhere is still not watched');
  assert.ok(/COUNTER_CLOSED/.test(BODY), 'it does not read the code the server actually returns');
});

console.log('\nTHE WATCHDOG\n');

const TICK = (function () {
  const a = PAGE.indexOf('function watchTick(){');
  assert.ok(a > 0, 'the watchdog is gone');
  return PAGE.slice(a, PAGE.indexOf('\n}', a));
})();

it('it reads the same reading the health page reads', () => {
  const a = PAGE.indexOf('function watchNow');
  assert.ok(/healthReading\(\)/.test(PAGE.slice(a, PAGE.indexOf('\n}', a))),
    'watchNow asks the gates again instead of reusing healthReading — the two can now disagree');
});

/** ⚠️ a line that repeats every fifteen seconds is wallpaper, and wallpaper is how the next real one is missed */
it('⚠️ it speaks on the CHANGE, not on the state', () => {
  assert.ok(/WATCH_WAS/.test(TICK), 'it does not remember what it said last time');
  assert.ok(/if \(now === WATCH_WAS\) return;/.test(TICK), 'it would repeat itself on every tick');
});

it('and the first reading is a baseline, not news', () => {
  assert.ok(/was === null/.test(TICK),
    'a counter that starts up offline would announce it as if it had just happened');
});

/** ⚠️⚠️ never diagnose a fault the tester chose — except the one that loses work ([TILL-140]) */
it('⚠️⚠️ it does not report a simulated fault as a real one', () => {
  assert.ok(/netNow\(\) !== 'full'/.test(TICK), 'it cannot tell a simulated outage from a real one');
  assert.ok(/sim && one\.id !== 'save'/.test(TICK),
    'either it cries wolf during a simulation, or it would stay silent about storage during one');
});

it('storage is reported first when several things break at once', () => {
  assert.ok(/'save' \? -1 : 0/.test(TICK), 'the one that can lose work is not sorted to the front');
});

it('it rides a timer that already exists rather than adding one', () => {
  assert.ok(/paintStatus\(\); watchTick\(\);/.test(PAGE),
    'the watchdog is not on the 15s repaint — a second timer is a second path');
  assert.strictEqual((PAGE.match(/setInterval\(watchTick/g) || []).length, 0,
    'it started its own timer as well');
});

console.log('\nAND THE SIMULATOR SAYS WHAT IT BREAKS\n');

it('the bar offers the list', () => {
  assert.ok(/till-net-what"/.test(PAGE), 'there is no control to see what the simulation affects');
  assert.ok(/till-net-what-panel/.test(PAGE), 'there is no panel for it to open');
});

/** ⭐ the point of the whole change: the panel is MEASURED, not written down twice */
it('⭐ the panel reads the watch list rather than a second copy of it', () => {
  /**
   * ⚠️⚠️ MOVED TWICE, NEVER DELETED. The builder came out of netMore ([TILL-149]); then [TILL-153] found the
   * counter holding TWO panels — the rebuilt one on the pill and the old text wall still under the line
   * switch — and Athi opened the stale one. Now there is one paintLine and every door leads to it.
   */
  const a = PAGE.indexOf('async function paintLine(into){');
  assert.ok(a > 0, 'the one painter is gone');
  const body = PAGE.slice(a, PAGE.indexOf('\n}', a));
  assert.ok(/watchNow\(/.test(body), 'the panel keeps its own list — it will drift from what is watched');
  /* ⚠️⚠️⚠️ AND THERE IS EXACTLY ONE OF IT. A duplicate definition wins silently and the loser rots. */
  assert.strictEqual((PAGE.match(/function paintLine\(/g) || []).length, 1,
    'paintLine is defined more than once — one of them is dead code nobody will notice');
  assert.ok(!/function netWhatHTML/.test(PAGE), 'the second panel builder is back');
  ['netMore', 'netInline'].forEach(function (f) {
    const at = PAGE.indexOf('function ' + f + '(){');
    assert.ok(at > 0, f + ' is gone');
    assert.ok(/openLine\(\)|paintLine\(/.test(PAGE.slice(at, PAGE.indexOf('\n}', at))),
      f + ' does not lead to the one panel');
  });
});

it('and it does not claim billing is at risk, because it never is', () => {
  assert.ok(/never touch/.test(PAGE), 'the panel does not say that billing is untouched by the line');
  assert.ok(!ROWS.some((r) => /^Billing/.test(r.name || '')),
    'billing is in the watch list — it does not depend on the line and must not look as if it does');
});

console.log('\n' + pass + ' checks passed\n');

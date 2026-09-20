'use strict';
/**
 * till-exits.test.js — EVERY SCREEN HAS A WAY OUT THAT CHANGES NOTHING ([TILL-155]).
 *
 * ── ⚠️⚠️⚠️ WHAT THIS DEFENDS ────────────────────────────────────────────────────────────────────────────
 *
 * Athi, stuck in the product editor: *"I couldn't close this page at all… can you check in every screen,
 * close button exists, that should allow move away without performing an operation."*
 *
 * Then, having found it: *"it is my bad, there is a close button, but it was next to Change photo, I
 * understood it will delete the photo."*
 *
 * ⚠️⚠️ THAT SECOND MESSAGE IS THE REAL FINDING, AND IT IS NOT HIS MISTAKE. The ✕ was there and he could not
 * use it, because a ✕ touching a photo button reads as "remove the photo" — and the cost of guessing wrong
 * looked like losing the picture, so he did not press it. A control means what its NEIGHBOURS suggest it
 * means. Being present is not the same as being usable.
 *
 * So this checks three things of every screen, and the third is the one that was missing:
 *   1. there is a way out at all
 *   2. it is reachable by Escape as well as by pressing
 *   3. the way OUT does not sit in a row of ways to CHANGE something
 *
 * Run: node tests/till-exits.test.js   · no DB, no browser.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/** every dialog in the page, with its markup */
const DIALOGS = [];
PAGE.replace(/<dialog\b[^>]*id="([a-z0-9_]+)"[^>]*>/g, (all, id, at) => {
  const end = PAGE.indexOf('</dialog>', at);
  DIALOGS.push({ id, html: PAGE.slice(at, end > 0 ? end : at + 4000) });
  return all;
});

console.log('\nEVERY SCREEN HAS A LID\n');

it('the screens are found', () => {
  assert.ok(DIALOGS.length >= 18, 'only ' + DIALOGS.length + ' dialogs found — this guard is looking in the wrong place');
});

/**
 * ⚠️⚠️⚠️ A <dialog> WITHOUT A LID IS A TRAP. showModal() takes the whole screen and swallows every click
 * behind it, so if nothing inside closes it the counter is stuck until the page is reloaded — and a reload on
 * a counter mid-bill is not free.
 */
it('⚠️⚠️⚠️ every screen has something that closes it', () => {
  /* a dialog may be filled at runtime, so an empty shell is allowed only if a painter names it */
  /**
   * ⚠️ ASK WHETHER SOMETHING REALLY CLOSES **THIS** DIALOG, rather than matching names. An earlier version
   * built a regex from the id and missed #dayrep, whose closer is dayReportClose() — same dialog, different
   * capitalisation. A guard that can be defeated by a capital letter is not measuring the property.
   */
  const bad = DIALOGS.filter((d) => {
    const grabs = new RegExp("getElementById\\('" + d.id + "'\\)", 'g');
    let m, found = false;
    while ((m = grabs.exec(PAGE))) {
      /* a closer looks like: get the element, then call .close() on it within the same handful of lines */
      if (/\.close\(\)/.test(PAGE.slice(m.index, m.index + 260))) { found = true; break; }
    }
    return !found;
  });
  assert.strictEqual(bad.length, 0, 'no way out of: ' + bad.map((d) => '#' + d.id).join(', '));
});

/**
 * ⚠️⚠️ ESCAPE IS THE OTHER HALF. A <dialog> opened with showModal() closes on Escape by default — but only
 * while nothing cancels that event, and this page cancels keydown in several places for the bill.
 */
it('⚠️⚠️ and Escape is not taken away from them', () => {
  /* if anything preventDefaults Escape globally, it must exempt an open dialog */
  const esc = PAGE.indexOf("e.key === 'Escape'");
  if (esc < 0) { return; }                    /* nothing intercepts it at all — the browser default stands */
  const near = PAGE.slice(Math.max(0, esc - 1500), esc + 1500);
  assert.ok(/dialog\[open\]|\.open\b|openDialog|anyOpen/.test(near),
    'Escape is handled globally with no regard for an open dialog — a screen could swallow its own lid');
});

console.log('\n⚠️⚠️ AND THE WAY OUT IS NOT MIXED IN WITH THE WAYS TO CHANGE THINGS\n');

/**
 * ⚠️⚠️⚠️ THE ONE ATHI ACTUALLY HIT. The editor's ✕ sat in the header row, immediately after "Change photo",
 * so it read as a control belonging to the photo. It is now pinned to the corner of the pane, out of every
 * row, and it says in its own label that pressing it changes nothing.
 */
it('⚠️⚠️⚠️ the editor\'s lid is pinned to the corner, not sitting beside "Change photo"', () => {
  const x = (PAGE.match(/<button class="sheetx"[^>]*data-testid="card-close"[^>]*/) || [])[0]
         || (PAGE.match(/data-testid="card-close"[^>]*/) || [])[0] || '';
  assert.ok(x, 'the editor has no close control');
  assert.ok(!/class="pill sheetx"/.test(PAGE),
    'the lid is still a pill in the header row — that is the row "Change photo" lives in');
  assert.ok(/\.sheetx\{position:absolute/.test(PAGE),
    'the lid is not pinned out of the flow, so it sits next to whatever the header draws last');
  /* ⚠️ and the header must leave room, or the lid clips the button under it — the same confusion, moved */
  assert.ok(/body\.cardopen \.cardhd\{padding-right/.test(PAGE),
    'the header does not reserve room, so the pinned lid overlaps "Change photo"');
});

/** ⭐ and it says what it does, because a ✕ alone is what he read wrongly in the first place */
it('⭐ and it says that pressing it changes nothing', () => {
  const at = PAGE.indexOf('data-testid="card-close"');
  const near = PAGE.slice(at - 200, at + 300);
  assert.ok(/nothing is changed|without changing anything/i.test(near),
    'the lid does not say that it changes nothing — which is exactly what was unclear');
});

/**
 * ⚠️ A LID IS NEVER THE LOUD BUTTON, and never the last thing in a row of actions, where a thumb lands by
 * habit. This checks the shape of the few screens that can destroy or send something.
 */
it('⚠️ closing is never dressed as the action', () => {
  /**
   * ⚠️⚠️ A NAME IS NOT A BEHAVIOUR. The first version of this flagged #shiftdlg, because its primary button
   * calls shiftClose() — which closes the SHIFT, not the dialog. "Count and hand over" is exactly the action
   * that button should be. So the check reads the BUTTON'S WORDS, not the handler's name.
   * [[feedback-name-vs-behaviour]]
   */
  const loud = [];
  DIALOGS.forEach((d) => {
    d.html.replace(/<button[^>]*class="pri"[^>]*>([^<]*)</g, (all, label) => {
      if (/^\s*(close|cancel|back|not now|never mind)\b/i.test(label)) loud.push('#' + d.id + ' ("' + label.trim() + '")');
      return all;
    });
  });
  assert.strictEqual(loud.length, 0,
    'the quiet way out is dressed as the loud action on: ' + loud.join(', '));
});

console.log('\n' + pass + ' checks passed\n');

'use strict';
/**
 * till-hidden.test.js — [hidden] MUST WIN ([TILL-148]).
 *
 * ── ⚠️⚠️⚠️ WHAT THIS DEFENDS ────────────────────────────────────────────────────────────────────────────
 *
 * Athi, on a live counter: an empty white box sitting across the header, over "Customer (optional)".
 *
 * `.netwhat{...display:grid...}` beats the user-agent stylesheet's `[hidden]{display:none}` — a class selector
 * outranks it — so a panel that was `position:fixed` at the top of the page rendered ALWAYS, empty, on every
 * counter whether the simulator was on or not. It shipped to Vercel and he found it before any test did.
 *
 * ⚠️⚠️ THE FILE ALREADY SAID SO. Twenty lines above the rule I wrote, in this same stylesheet:
 *   "Any element in this file that sets display and is toggled by .hidden needs its own [hidden] rule."
 * A written warning that nothing enforces is a comment, not a guard. This is the enforcement.
 *
 * ⚠️ AND THE E2E DID NOT CATCH IT because every check opened the panel first and asserted what was IN it.
 * Nothing asserted that a CLOSED panel is invisible — the state the counter is in all day.
 *
 * Run: node tests/till-hidden.test.js   · no DB, no browser.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html');
const PAGE = fs.readFileSync(FILE, 'utf8');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/** the stylesheet, without the markup below it */
const CSS = PAGE.slice(0, PAGE.indexOf('</style>') + 8);

/** every element that carries a bare `hidden` attribute in the markup, with its classes */
const MARKUP = PAGE.slice(PAGE.indexOf('</style>'));
const HIDDEN_ELS = [];
MARKUP.replace(/<(\w+)([^>]*\bhidden\b[^>]*)>/g, (all, tag, attrs) => {
  const cls = (attrs.match(/class="([^"]*)"/) || [])[1];
  const id  = (attrs.match(/id="([^"]*)"/) || [])[1];
  if (cls) HIDDEN_ELS.push({ tag, id: id || null, classes: cls.split(/\s+/).filter(Boolean) });
  return all;
});

console.log('\n[hidden] MUST WIN\n');

it('the markup really does use the hidden attribute', () => {
  assert.ok(HIDDEN_ELS.length >= 5,
    'only ' + HIDDEN_ELS.length + ' hidden elements with classes — this guard may be looking in the wrong place');
});

/**
 * ⚠️⚠️⚠️ THE ONE THAT WOULD HAVE CAUGHT IT. For each class on a `hidden` element, if that class sets `display`
 * anywhere in the stylesheet, there must also be a rule that restores `display:none` when hidden.
 */
it('⚠️⚠️⚠️ no class that sets display leaves a hidden element visible', () => {
  const bad = [];
  HIDDEN_ELS.forEach((el) => {
    el.classes.forEach((c) => {
      const cls = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      /* does any rule for this class set display? (ignore rules that already scope to [hidden]) */
      const sets = new RegExp('\\.' + cls + '(?![\\w-])(?![^{]*\\[hidden\\])[^{]*\\{[^}]*display\\s*:', 'g');
      if (!sets.test(CSS)) return;
      /* then something must put it back — by class, or by this element's id */
      const guarded = new RegExp('(\\.' + cls + '\\[hidden\\]|#' + (el.id || '\\u0000')
        + '\\[hidden\\])[^{]*\\{[^}]*display\\s*:\\s*none', 'g');
      if (!guarded.test(CSS)) bad.push('.' + c + (el.id ? ' (#' + el.id + ')' : ''));
    });
  });
  assert.strictEqual(bad.length, 0,
    'these set display but do not restore display:none when hidden, so they render anyway: ' + bad.join(', '));
});

/** ⚠️ the specific one Athi found, named so a rename cannot quietly drop the cover */
it('⚠️ the simulator panel is one of them', () => {
  assert.ok(/\.netwhat\[hidden\]\s*\{[^}]*display\s*:\s*none/.test(CSS),
    'the what-this-affects panel would sit empty across the header again');
});

/** ⚠️⚠️ AND IT IS NOT DRAWN OVER THE COUNTER WITHOUT BEING ASKED FOR */
it('⚠️⚠️ it starts hidden in the markup', () => {
  const el = (MARKUP.match(/<div[^>]*id="netwhat"[^>]*>/) || [''])[0];
  assert.ok(/\bhidden\b/.test(el), 'the panel ships open — it would cover the header on first paint');
});

console.log('\n' + pass + ' checks passed\n');

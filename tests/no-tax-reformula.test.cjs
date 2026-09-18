'use strict';
// no-tax-reformula.test.cjs — a UI file must not re-derive the tax split; it calls CBTax.splitLineTax() and paints
// the answer.
//
// ── ⚠️⚠️ THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────────────────────────────────
//
// Athi, 2026-09-17: *"UI should use the results given… no computation should be tightly bound to the presentation
// logic anywhere — we are more worried about the computation and the logic."* Asked to check, till.html turned out
// to have THREE separate, hand-written copies of the tax split (billMoney, the day-close report, goods received),
// each taking the inclusive shortcut `net − assessable` instead of `assessable × rate ÷ 100` — the formula
// lib/tax.js actually invoices by. They agree most of the time and NOT always: ₹10 at 18% inclusive already lands
// a paisa apart (tests/tax.test.js SPLIT-01), so the counter could show a customer one figure while the GST
// invoice the server builds at completion declares another, with nothing anywhere to say so.
//
// ⭐ THE FIX MOVED THE FORMULA INTO lib/tax.js AS splitLineTax() (window.CBTax.splitLineTax in the browser) and
// pointed every counter call site at it. This guard is what stops a FOURTH copy appearing quietly later: it
// counts the raw formula's shape in the counter page and fails if there are more copies than the two permitted
// fallbacks (used only when CBTax failed to load — see the note beside each).
//
// Run: node tests/no-tax-reformula.test.cjs   · no network, no DB.
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  XX  ' + name + ' — ' + e.message); fail++; }
};

const API = path.join(__dirname, '..');
const TILL = path.join(API, 'tools', 'tally-connector', 'till.html');
const src = fs.readFileSync(TILL, 'utf8');

/* the inclusive-side shape: `<amount> * 100 / (100 + <rate>)` — the assessable-value half of the split, with the
   spacing this file happens to use. Loose on the operand names, strict on the shape, so a reformatting does not
   make the guard blind and a genuinely different computation does not trip it. */
const SPLIT_SHAPE = /\*\s*100\s*\/\s*\(\s*100\s*\+/g;

const PERMITTED_FALLBACKS = 3;   // billMoney(), the day-close report, rcvLineTax() — each beside its own CBTax.splitLineTax() call

t('splitLineTax has exactly the permitted fallback copies of its own formula, and no new one crept in', () => {
  const hits = (src.match(SPLIT_SHAPE) || []).length;
  /* the permitted fallbacks are each guarded by `window.CBTax && CBTax.splitLineTax) ? … : …` immediately beside
     them — a browser old enough, or broken enough, to have loaded the counter without its own tax engine still
     needs a number, just never a SECOND source of truth for one. */
  if (hits > PERMITTED_FALLBACKS) {
    throw new Error(hits + ' copies of the tax-split formula in till.html (expected ' + PERMITTED_FALLBACKS
      + ', each inside a "window.CBTax && CBTax.splitLineTax) ? … :" fallback) — a new one calls '
      + 'CBTax.splitLineTax() instead');
  }
  if (hits < PERMITTED_FALLBACKS) {
    throw new Error('found ' + hits + ' — a fallback was removed without checking this guard first; update '
      + 'PERMITTED_FALLBACKS here if that was deliberate');
  }
});

t('every fallback copy sits directly beside a CBTax.splitLineTax() call it falls back FROM', () => {
  const idx = [];
  let m; SPLIT_SHAPE.lastIndex = 0;
  while ((m = SPLIT_SHAPE.exec(src))) idx.push(m.index);
  idx.forEach((i) => {
    const before = src.slice(Math.max(0, i - 400), i);
    if (!/CBTax\.splitLineTax/.test(before)) {
      throw new Error('a tax-split formula at offset ' + i + ' has no CBTax.splitLineTax() call before it — '
        + 'it reads like a second, independent formula rather than a documented fallback');
    }
  });
});

/**
 * ⚠️⚠️ THE WHOLE FUNCTION, NOT THE FIRST 2400 CHARACTERS. This guard used a fixed window, and on 2026-09-18 a
 * comment block added to dayCloseSheet() pushed its CBTax.splitLineTax() call past the cut — so the guard
 * reported that the function had started doing its own tax arithmetic again, which it had not. A guard that
 * fails for a reason that is not the reason it exists trains people to ignore it, which is how the real
 * regression gets through. Reading to the closing brace says exactly what was meant all along.
 * ⚠️ Braces inside strings and comments are not discounted — they balance out in practice here, and a real
 * parser for one assertion is a worse trade than a guard that is one brace too generous.
 */
function bodyOf(at) {
  let depth = 0, started = false;
  for (let i = at; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return src.slice(at, i + 1); }
  }
  return src.slice(at);
}

t('billMoney(), dayCloseSheet() and rcvLineTax() each call CBTax.splitLineTax(), not their own arithmetic', () => {
  ['function billMoney(', 'function dayCloseSheet(', 'function rcvLineTax('].forEach((sig) => {
    const at = src.indexOf(sig);
    if (at < 0) throw new Error(sig + ' not found — this guard is stale, or the function was renamed');
    const body = bodyOf(at);
    if (!/CBTax\.splitLineTax\(/.test(body)) {
      throw new Error(sig + ' no longer calls CBTax.splitLineTax() — it is computing the split itself again');
    }
  });
});

console.log('\n' + (fail ? 'XX ' + fail + ' failed, ' : '') + pass + ' checks\n');
process.exit(fail ? 1 : 0);

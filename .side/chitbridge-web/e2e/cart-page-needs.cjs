/* cart-page-needs.cjs — EVERY PAGE THAT LOADS THE CART LOADS WHAT THE CART READS, FIRST. (2026-09-28)
 *
 * cart.js reads two engines it does not carry: CBMoney (the one rounder and the one price reader — no copy of its
 * own since the loader step) and CBLocale (the money format and the symbol, cart.js:886/906/2052). The four
 * *-design.html pages loaded neither locale nor, until the loader step, money — so they threw "CBLocale is not
 * defined" the moment a price was painted (found by the maintenance baseline and the engine-finish run).
 *
 * ⚠️ A load-order fault is invisible in review: every page LOOKS like it has the cart. It fails only in a browser, on
 * the first price. This reads the real <script src> tags (not comments) and asks the one question: does each
 * dependency come BEFORE cart.js on every page that loads it?
 *
 * Run: node e2e/cart-page-needs.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const NEEDS = [
  { what: 'the money engine (CBMoney)', re: /(^|\/)engine\/money\.js$/ },
  { what: 'the locale engine (CBLocale)', re: /(^|\/)(app|engine)\/locale\.js$/ },
];
const pages = fs.readdirSync(PUB).filter((n) => /\.html$/.test(n));
let bad = 0, checked = 0;
console.log('── every page that loads the cart loads what the cart reads, first ──');
for (const n of pages) {
  const html = fs.readFileSync(path.join(PUB, n), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const srcs = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/g)].map((m) => m[1].split('?')[0].replace(/^\//, ''));
  const cartAt = srcs.findIndex((s) => /(^|\/)app\/cart\.js$/.test(s));
  if (cartAt < 0) continue;
  checked++;
  const miss = NEEDS.filter((d) => { const at = srcs.findIndex((s) => d.re.test(s)); return at < 0 || at > cartAt; });
  if (miss.length) { bad++; console.log('  ✗ ' + n + ' loads cart.js without ' + miss.map((d) => d.what).join(' and ') + ' before it'); }
  else console.log('  ✓ ' + n);
}
if (checked < 5) { console.log('✗ only ' + checked + ' page(s) load the cart — the scan is broken, not the pages fixed'); process.exit(1); }
console.log(bad ? '\n✗ ' + bad + ' page(s) would throw on the first price\n' : '\n✓ ' + checked + ' page(s) load money and locale before the cart\n');
process.exit(bad ? 1 : 0);

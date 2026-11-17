'use strict';
// @type: unit
/**
 * ui-codes-cart.test.cjs - the shared basket (public/app/cart.js) wears ITS identity codes (UX-137, one-pass ops lane, screen SCR037 "Cart").
 *
 * OWNS      the proof that every control cart.js draws carries a data-cbsid code of screen SCR037, that each code sits on ITS element (a marker only
 *           that element carries must follow the code before the next code starts: a swap of two codes fails), that no code is written twice,
 *           that the file has exactly 32 SCR037 elements, that the close and remove marks keep their component codes, and that no code is retired.
 *           A tag drawn by a row builder wears ONE code for all its rows (the stepper's minus is one element in the register, drawn once per row).
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-cart.test.cjs   (CART_ID_MUTATE=swap or remove must fail it)
 * CARD      storefront-and-catalogue/cart
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as
 *           pending (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.CART_ID_MUTATE || '';
const SOURCE = path.join(__dirname, '..', 'public', 'app', 'cart.js');
const WINDOW = 400; /* how far after a code its own marker may sit when no other code starts first */

let src = fs.readFileSync(SOURCE, 'utf8').split('\r\n').join('\n');
if (mutate === 'remove') src = src.split('data-cbsid="SCR037-B01"').join('');
if (mutate === 'swap') src = src.split('SCR037-B01').join('SWAPX').split('SCR037-B02').join('SCR037-B01').split('SWAPX').join('SCR037-B02');

let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };

/** code -> a marker only its element carries (a class, a test id, an aria-label or the word it is drawn with) */
const WANT = {
  'SCR037-B01': 'data-testid="pick-catg',
  'SCR037-C01': 'title="Open the cart to review',
  'SCR037-C02': 'class="cbcart-x"',
  'SCR037-B02': 'CBCart.setQty(',
  'SCR037-B03': 'rnd + \'" onclick="event.stopPropagation();CBCart.add(',
  'SCR037-I01': 'placeholder="your price" value="',
  'SCR037-C03': 'display:inline-flex;align-items:center;gap:8px',
  'SCR037-B04': 'CBCart.dec(',
  'SCR037-I02': 'width:52px',
  'SCR037-B05': 'color:#fff" onclick="CBCart.add(',
  'SCR037-B06': "tx('Show everything')",
  'SCR037-C04': 'class="cbcart-grp"',
  'SCR037-B07': "'Keep shopping'",
  'SCR037-B08': 'data-testid="cart-checkout"',
  'SCR037-I03': 'class="inp cbpick-q"',
  'SCR037-B09': 'class="cbcart-float-pill"',
  'SCR037-B10': 'class="cbcart-float-x"',
  'SCR037-B11': 'class="cbcat-pick',
  'SCR037-B12': "call('dec')",
  'SCR037-I04': 'aria-label="quantity"',
  'SCR037-B13': 'aria-label="more"',
  'SCR037-B14': 'aria-label="add"',
  'SCR037-I05': 'class="cbcat-offer"',
  'SCR037-C05': 'class="cbcat-moret"',
  'SCR037-C06': 'class="cbcat-all"',
  'SCR037-I06': 'class="cbcat-q" disabled',
  'SCR037-B15': 'data-testid="cbcat-checkout-',
  'SCR037-I07': 'class="cbcat-note"',
  'SCR037-I08': 'type="file"',
  'SCR037-I09': 'class="cbcat-q" placeholder=',
  'SCR037-B16': 'data-testid="pick-onoffer"',
  'SCR037-B17': 'class="cbcart-bar cbcat-chip'
};

/** the text from a code up to the next code of the file (at most WINDOW characters): the tag it sits in */
function tagAfter(code) {
  const at = src.indexOf('data-cbsid="' + code + '"');
  if (at < 0) return null;
  const rest = src.slice(at + 12);
  const next = rest.search(/data-cbsid=/);
  return rest.slice(0, next >= 0 ? Math.min(next, WINDOW) : WINDOW);
}

for (const [code, marker] of Object.entries(WANT)) {
  const tag = tagAfter(code);
  check(tag !== null && tag.indexOf(marker) >= 0, code + ' sits on the element with ' + marker);
}

/** every code is written once; the file has exactly the 32 coded elements of this screen */
const written = [...src.matchAll(/data-cbsid="(SCR037-[A-Z][0-9]{2})"/g)].map((m) => m[1]);
const dup = written.filter((c, i) => written.indexOf(c) !== i);
check(dup.length === 0, 'no code is written on two elements' + (dup.length ? ' (' + dup.join(',') + ')' : ''));
check(written.length === 32 && Object.keys(WANT).length === 32, 'the file has 32 coded elements, counted by code: ' + written.length + ' written, ' + Object.keys(WANT).length + ' expected');
check(!/data-cbsid="(?!SCR037-|CMP005"|CMP008")/.test(src), 'no code of another screen is written here (only the component codes CMP005 close and CMP008 remove)');
check(/data-cbsid="CMP005"/.test(src) && /data-cbsid="CMP008"/.test(src), 'the close and remove marks keep their component codes');

/** the register */
let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { console.log('  note: register ' + p + ' did not parse (' + e.message + ')'); } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((r) => { if (r.code) rows[r.code] = r; });
  const all = Object.keys(WANT), missing = all.filter((c) => !rows[c]), retired = all.filter((c) => rows[c] && rows[c].retired);
  console.log('  register: ' + (all.length - missing.length) + ' of ' + all.length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.length + ')' : ''));
  if (process.env.UIID_REG) check(!missing.length, "every code is in the register UIID_REG names (" + missing.length + " missing)"); /* a set register: a missing code FAILS, no pending */
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);

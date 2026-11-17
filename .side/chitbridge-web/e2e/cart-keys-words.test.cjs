/* cart-keys-words.test.cjs - the cart's keyboard controls speak in the person's language (cb-ux-locale, 2026-11-12).
 * OWNS      app/cart.js: the three screen-reader names of the cart bar (Open the cart), the clear mark (Clear the cart) and the line remove mark (Remove from the cart) go through tx();
 *           each key has a real translation in hi, ta, fr and ar, and the Age cell of Collections keeps "61-90 days" on one line.
 * CALLED BY ci.yml (QA-79).   FLOW  read the sources -> no English aria-label literal for the three -> each key differs from English in every pack -> the age tail is nowrap.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 */
'use strict';
const fs = require('fs'), path = require('path');
const app = path.join(__dirname, '..', 'public', 'app');
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  XX  ') + m); if (!c) fail++; };
const cart = fs.readFileSync(path.join(app, 'cart.js'), 'utf8'), fin = fs.readFileSync(path.join(app, 'cap-finance.js'), 'utf8');
const KEYS = ['Open the cart', 'Clear the cart', 'Remove from the cart'];
KEYS.forEach((k) => {
  ok(!new RegExp('aria-label="' + k + '"').test(cart), 'cart.js has no English literal aria-label "' + k + '"');
  ok(cart.indexOf("translated('" + k + "')") >= 0, 'cart.js names "' + k + '" through translated() (tx)');
});
['hi', 'ta', 'fr', 'ar'].forEach((l) => {
  const B = {}; B[l] = {};
  new Function('CBSTR', 'renderApp', fs.readFileSync(path.join(app, 'strings-' + l + '.js'), 'utf8'))(B, function () {});
  KEYS.forEach((k) => ok(typeof B[l][k] === 'string' && B[l][k] && B[l][k] !== k, l + ': "' + k + '" is translated'));
});
ok(/data-b="age"[^>]*white-space:nowrap/.test(fin), 'the Age tail ("61-90 days") is nowrap, so it never breaks at the hyphen');
console.log(fail ? '\n' + fail + ' failure(s)' : '\ncart-keys-words: all passed');
process.exit(fail ? 1 : 0);

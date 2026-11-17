/**
 * one-cart.cjs — THE CART IS THE ONLY PLACE MONEY IS COMPUTED FOR A BUYER'S EYES.
 *   node e2e/one-cart.cjs
 *
 * Athi, 2026-09-05: "either storefront or supplier or through API, all should have the same principle … single source of
 * truth … keep it as a practice". The storefront had its own basket math for two days and drifted (no GST on the Suppliers
 * screen, a badge no screen could show). This guard fails the moment a second implementation appears:
 *   – only app/cart.js (the CART capability) may build the "Total incl. tax" row or a per-rate tax table (`byRate`);
 *   – only app/cart.js and engine/offers.js may call CBOffers.evaluate for a BASKET (the product page's single-line preview
 *     and the offer form's test panel are allowed: they preview one product, they never total a basket).
 */
const fs = require('fs'); const path = require('path');
const PUB = process.env.ONE_CART_ROOT || path.join(__dirname, '..', 'public');   /* ONE_CART_ROOT = a COPY of public/ (e2e/one-cart-breaks.cjs) */
const files = ['app.html', 'shop.html'].concat(fs.readdirSync(path.join(PUB, 'app')).filter((f) => f.endsWith('.js')).map((f) => 'app/' + f));
const OWNER = 'app/cart.js';
/* the renderer pair (cart-ui + catalogue-ui) and the engine itself may evaluate; anyone else only for ONE line ("lines:[line]") */
const ALLOW_EVALUATE = new Set([OWNER, 'engine/offers.js',
  'app.html'              /* the product page previews ONE product (prodOfferCartHTML, the bulk preview) — and the Compose cart, see DEBT below */,
  'app/cap-definitions.js' /* the offer form's preview and Test panel: one product */]);
/* KNOWN DEBT, printed every run until it is gone: the Compose cart (CC.offers) still totals its own offers — step 3 of the convergence */
const DEBT = [['app.html', /offers\s*:\s*CC\.offers/, 'the Compose cart evaluates its own offers (CC.offers) — converge onto CBCart.money (step 3)']];
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '');
let bad = 0;
for (const rel of files) {
  const s = stripComments(fs.readFileSync(path.join(PUB, rel), 'utf8'));
  /* ⭐ NEVER RECOMPUTE A BILL (Athi, 2026-10-02: "never ever recompute"; DECISIONS.md "Compute once, at billing; everyone else reads"): the Task
     detail (Content + Summary tabs, the Order tab in cap-chit2.js) and every other reader of an issued chit read the frozen figures through
     CBSheet.moneyFor. CBCart.moneyFromLines works a total out from lines at new Date() — only the cart itself (app/cart.js) may; and app.html's one
     CBCart.money( is the Compose cart (offers: CC.offers), where an order is being MADE. Any other call is a reader recomputing. */
  if (rel !== OWNER && /\bmoneyFromLines\s*\(/.test(s)) { console.log('  ✗ ' + rel + ' calls moneyFromLines — a reader of an issued chit must read the frozen bill (CBSheet.moneyFor), never work its money out again'); bad++; }
  if (rel !== OWNER) {
    const mc = (s.match(/CBCart\.money\(/g) || []).length, okc = rel === 'app.html' ? (s.match(/CBCart\.money\(\s*\w+\s*,\s*\{\s*offers\s*:\s*CC\.offers/g) || []).length : 0;
    if (mc > okc && rel !== "shop.html") { console.log('  ✗ ' + rel + ' calls CBCart.money( outside the cart / the Compose cart — a screen that shows an issued chit reads it (CBSheet.moneyFor)'); bad++; }
    /* the MARKUP of the row (">Total incl. tax<"), not the words — the Legend and the docs may name it */
    if (/>\s*Total incl\. tax\s*</.test(s)) { console.log('  ✗ ' + rel + ' renders its own "Total incl. tax" — the cart owns that row (CBCart.moneyRowsHTML)'); bad++; }
    if (/\bbyRate\s*\[/.test(s) && !/CBCart\.money\(/.test(s)) { console.log('  ✗ ' + rel + ' builds a per-rate tax table of its own — call CBCart.money'); bad++; }
  }
  /* a screen that reads the cart's bare total must also ask it for the money rows — a bare Total beside offers and tax is the
     Suppliers-review defect of 2026-09-05 ("₹400" while the storefront basket said "₹378 incl. tax") */
  if (rel !== OWNER && /\b(?:c|cart|_CART|UI\._\w+Cart)\.total\(\)/.test(s)) { console.log('  ✗ ' + rel + ' reads the cart total itself — the cart prints its own money block: c.reviewHTML({ totalTestid })'); bad++; }
  /* ⭐ ONE ROW: only the cart draws an offer badge or a stock stamp. Found 2026-09-06: the Catalogue list had its own chip and its own
     'QTY 91 AS OF 05/09/2026' beside the cart's 'in stock 91 · as of 1 min ago' — one fact, two formats. */
  if (rel !== OWNER && /data-testid="cat-row-offer"|tx\('as of'\)|class="cbcat-off"/.test(s)) { console.log('  ✗ ' + rel + ' draws its own offer badge or stock stamp — the cart row (CBCatUI.rowHTML) draws those'); bad++; }
  if (!ALLOW_EVALUATE.has(rel)) {
    const calls = s.match(/CBOffers\.evaluate\(\s*\{[^}]*/g) || [];
    for (const c of calls) if (!/lines\s*:\s*\[\s*[A-Za-z_$][\w$]*\s*\]/.test(c) && !/lines\s*:\s*lines\b/.test(c) && !/lines\s*:\s*\[cbOfferLine/.test(c)) { console.log('  ✗ ' + rel + ' evaluates offers for a basket — go through CBCart.money: ' + c.slice(0, 60)); bad++; }
  }
}
for (const [rel, re, why] of DEBT) { try { if (re.test(stripComments(fs.readFileSync(path.join(PUB, rel), 'utf8')))) console.log('  ⚠ debt · ' + rel + ': ' + why); } catch (_) {} }
/**
 * THE OUTLET REGISTRY. Athi, 2026-09-05: "the cart is the fundamental unit of data movement … it should be capable of
 * transferring any data, but the same way across different channels … we may create a few more outlets but still should
 * be able to follow the rules." An OUTLET is any screen that holds a CBCart.create() handle. Every one is listed here with
 * the spec that proves it prints the same money as the storefront; a new CBCart.create() that is not registered fails the
 * run — the rule is written at C:/dev/catalogue/CART-OUTLET-RULES-2026-09-05.md and the registry is how it is kept.
 */
const OUTLETS = {
  'shop.html':          [['Storefront (public)',              '[SF-01] [PAR-01] [PAR-02]']],
  'app.html':           [['Record a sale / Bill (the counter)', '[SB-01] [PAR-02]'],
                         ['Compose (self, any recipient)',    'order-steps › Compose · [CAP-02] the same send path'],
                         ['Suppliers › our own stock',        'order-steps › OUR OWN STOCK'],
                         ['Suppliers › a supplier',           '[PAR-01] [PAR-02]'],
                         ["Catalogue list (the seller's own products, read-only rows)", '[CAT-01] · e2e/shot-rows.cjs'],
                         ['Design 1 chit › Content + Summary (read-only: the chit IS the cart; Summary = its money block + delivery, cover by flag)', '[PAR-03] the order page and its Summary equal the cart'],],
  'offer-lab-next.html': [['Offer lab (the engine as a page: the same rows, badges and money block)', '[LAB-01] the offer lab: switch, see, compare, advise']],
  'app/cap-network-member.js': [['Network › a store catalogue (the member half of Network, split from cap-network.js)', 'network-cascade']],
  'app/pick.js':        [['CBPick overlay (worklist: take materials)', 'order-steps › the picker over any screen']],
  'app/cap-chit2.js':   [["The chit's Order tab (read-only: the chit IS the cart)", '[PAR-03] the order page equals the cart']],
};
for (const rel of files) {
  const src = stripComments(fs.readFileSync(path.join(PUB, rel), 'utf8'));
  const n = (src.match(/CBCart\.create\(/g) || []).length; if (!n) continue;
  const reg = OUTLETS[rel] || [];
  if (n !== reg.length) { console.log('  ✗ ' + rel + ' holds ' + n + ' cart outlet(s), the registry lists ' + reg.length + ' — register it in e2e/one-cart.cjs OUTLETS with the spec that proves its money'); bad++; }
}
console.log('  outlets: ' + Object.values(OUTLETS).reduce((a, b) => a + b.length, 0) + ' registered, each with a parity proof');
console.log('\n══ ONE CART ══');
console.log(bad ? '  ' + bad + ' second implementation(s) found\n' : '  ✓ money is computed in one place (app/cart.js — the CART capability); every screen delegates\n');
process.exit(bad ? 1 : 0);

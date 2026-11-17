/** @covers FR-N10 — repainting does not empty the cart */
/** @covers FR-N9 — it sends through the one createChit compose uses */
/**
 * cap-network-render.test.mjs — DOES THE NETWORK BROWSE SCREEN ACTUALLY RENDER?
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────────────────────
 * The Network store-browse screen is the one ordering surface with NO automated gate at all. It sits behind login,
 * and cap-network.js is lazy-loaded via ensureCap('network'), so render-smoke never reaches it and variants never
 * touches it. Authed e2e is blocked (dev OTP closed on production).
 *
 * That left `node -c` as the only check — and `node -c` is precisely what passed on all five defects of
 * 2026-08-09: a deleted function still being called, a renamed data-testid, a changed number format and an
 * out-of-scope variable are every one of them legal JavaScript. Two of them took the public storefront down.
 *
 * So this drives the real code instead of parsing it. cap-network.js declares plain top-level functions rather
 * than exporting a module, so it is evaluated in a node:vm context alongside the real cart-ui.js and
 * catalogue-lines.js, with the handful of globals the browse path touches stubbed. Then it calls netBrowse() and
 * reads the HTML that comes back out of _netBrowseBody().
 *
 * ⚠️ IT IS NOT A SUBSTITUTE FOR A BROWSER. It cannot see layout, CSS or a real click. It answers the narrower
 * question the cheap checks structurally cannot: does this screen still build its cart, and does it still render
 * the catalogue and the hooks it publishes?
 *
 *      node scripts/cap-network-render.test.mjs
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* netBrowse fires a promise chain and does not return it — the screen paints when the fetch LANDS, not when the
   click returns. So the harness drains the queue, which is what the browser does between paints. */
const settle = () => new Promise((r) => setImmediate(r));

let failed = 0;
function ok(label, cond) {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
}

/* THE CATALOGUE a store publishes: one product with two sizes, plus a standalone line. */
const CAT = {
  shop: { bridge_id: 'CBSTORE01', display_name: 'Beta Depot' },
  // ⚠️ The VARIANT rides on the group's line, not on the item — that is the server's shape, and a fixture that
  // invented its own would prove the walk works on data the API never sends.
  groups: [{ label: 'Emulsion', lines: [{ item_id: 'e4', variant: '4L' }, { item_id: 'e10', variant: '10L' }] }],
  items: [
    { item_id: 'e4', item_data: { name: 'Emulsion', unit: '4L', price: 900 } },
    { item_id: 'e10', item_data: { name: 'Emulsion', unit: '10L', price: 2100 } },
    { item_id: 'br', item_data: { name: 'Brush', unit: 'each', price: 120 } },
  ],
};

/* ── the browser-shaped globals the browse path actually touches ───────────────────────────────────────────── */
const painted = [];
/**
 * Every element the code asks for, remembered by id, so a paint is observable instead of discarded. Deliberately
 * minimal: it answers the handful of properties a renderer touches and nothing more, because a stub that grows
 * a whole DOM ends up testing the stub.
 */
const paints = new Map();
const mount = (id) => {
  if (!paints.has(id)) {
    paints.set(id, {
      id, _html: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = String(v == null ? '' : v); },
      set textContent(v) { this._html = String(v == null ? '' : v); },
      get textContent() { return this._html; },
      setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
      appendChild() {}, remove() {}, focus() {}, querySelector: () => null,
      querySelectorAll: () => [], addEventListener() {}, scrollIntoView() {},
    });
  }
  return paints.get(id);
};

const ctx = {
  console,
  __painted: () => [...paints.values()].map((e) => e._html).join('\n'),
  UI: {},
  esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  cbAmount: (p) => (p && typeof p === 'object' && p.amount !== undefined ? p.amount : p),
  supCatalogueFull: async () => CAT,
  compose: (arg) => { ctx.__composed = arg; },
  // sendChit lives in app.html and is the ONE send. Stubbed here so the harness can read exactly what this screen
  // would put on the wire, without minting anything.
  sendChit: (v) => { ctx.__sent = v; return Promise.resolve({ chit_id: 'stub' }); },
  /**
   * ⚠️⚠️ THE HARNESS HAD BEEN FAILING SINCE THE L3 WRAP and nobody saw it, because `npm run check` was not being
   * run. The wrap put `tx()` on labels throughout cap-network.js; the sandbox never declared it, so the screen
   * threw `tx is not defined` before rendering anything — the one test that drives this code, dead.
   *
   * ⭐ Identity IS the faithful stub, not a shortcut: this codebase adopted gettext semantics, where **English
   * is the key**. `tx('Needed by')` returns 'Needed by' whenever no pack overrides it, which is exactly the
   * default the assertions below were written against. A stub returning a marker like `[[Needed by]]` would
   * have been the lie.
   */
  tx: (s) => s,
  txf: (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : m)),
  SESSION: { entity: 'North Depot' },
  toast: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  // No real DOM: every paint target resolves to nothing, which is the honest shape for a headless run. What we
  // assert on is the HTML the screen BUILDS, not where it would have put it. body/head DO accept appends, because
  // the cart mounts its popup host on create() and a stub that threw there would be testing the stub.
  /**
   * ⚠️⚠️ RETURNING null FROM getElementById IS WHY FIVE ASSERTIONS WERE FAILING, and the product was never at
   * fault. When this harness was written the screen built its own item rows and handed them back as a string,
   * so reading `_netBrowseBody()` saw everything. The catalogue redesign moved row rendering INTO the shared
   * cart, which paints through `document.getElementById(id).innerHTML` — so the rows now go somewhere the
   * harness threw away, and the assertions were reading a surface the code had stopped using.
   *
   * ⭐ So the mount node is now a RECORDER: it accepts the write and keeps it. `ctx.__painted()` returns
   * everything painted anywhere, and the assertions read the body plus the paints — which is what "did this
   * screen render the catalogue?" actually means once a shared component owns the rows.
   */
  document: { getElementById: (id) => { painted.push(id); return mount(id); },
              createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
              querySelector: () => null,
              body: { appendChild() {} }, head: { appendChild() {} }, documentElement: { appendChild() {} } },
};
ctx.globalThis = ctx;
ctx.window = undefined;
createContext(ctx);

/* The REAL modules, in the order app.html loads them. */
/* ⚠ locale.js FIRST. cart-ui and catalogue-ui both reach for CBLocale to format money, and without it
   the cart bar throws mid-paint — which the old null-returning DOM stub hid, because paintBar never ran. */
runInContext(read('public/engine/locale.js'), ctx, { filename: 'locale.js' });
runInContext(read('public/app/step-flow.js'), ctx, { filename: 'step-flow.js' });
runInContext(read('public/app/catalogue-model.js'), ctx, { filename: 'catalogue-model.js' });
runInContext(read('public/app/catalogue-lines.js'), ctx, { filename: 'catalogue-lines.js' });
/**
 * ⚠️⚠️ THIS TEST HAD BEEN BROKEN SINCE THE CART CAPABILITY LANDED (bf14516, 2026-09-05), and nothing said so in
 * words anybody read: cart-ui.js and catalogue-ui.js were MERGED into cart.js, "every loader repointed" — every
 * loader except this one. It then died at ENOENT before its first assertion, so the suite counted it red and the
 * five things it actually guards were proving nothing at all.
 *
 * ⭐ Both globals survived the merge on purpose (CBCart and CBCatUI), so one file replaces the two loads. The
 * ordering note that used to live here — catalogue-ui AFTER cart-ui, because it reads CBCart.fmt — is now the
 * file's own internal order and cannot be got wrong from outside.
 *
 * ⚠️ What it guards is unchanged and still worth having: cap-network.js calls CBCatalogue.pickerHTML, the browse
 * screen sits behind a login AND behind ensureCap(), and no browser spec reaches it.
 * [[feedback-improvise-update-cases]] — a change and its test case ship together.
 */
runInContext(read('public/app/cart.js'), ctx, { filename: 'cart.js' });
runInContext(read('public/app/cap-network.js'), ctx, { filename: 'cap-network.js' });
runInContext(read('public/app/cap-network-member.js'), ctx, { filename: 'cap-network-member.js' });   // the member half (P2 split) — loaded with it by ensureCap

console.log('\ncap-network · the browse screen renders');
ok('★ cap-network.js evaluates and CBCart is reachable from it',
   typeof ctx.netBrowse === 'function' && typeof ctx.CBCart === 'object');

ctx.netBrowse('E1', 'Beta Depot', 'CBSTORE01'); await settle();
const html = ctx._netBrowseBody();

ok('★★ it renders their catalogue rather than "Reading their catalogue…"',
   html.includes('Emulsion') && html.includes('Brush') && !html.includes('Reading their catalogue'));
ok('★★ the cart bar is on the page — the screen is orderable, not a read-only list',
   html.includes('id="cbcartbar_net"') && html.includes('cbcart-bar'));
ok('★ the published hooks are intact — a renamed test id is how a spec silently finds nothing',
   html.includes('data-testid="pick-net"') && html.includes('data-testid="pick-search-net"')
   && html.includes('id="cbpick_net"'));
ok('★ the shared walk grouped the variants — one product, its sizes underneath',
   html.includes('2 options') && (html.split('>Emulsion<').length - 1) === 1);
ok('★ the store name is in the head, escaped', html.includes('Beta Depot'));

console.log('\ncap-network · the cart is HELD, not rebuilt by the renderer');
const cart = ctx.UI._netCart;
ok('★ browsing a store creates exactly one held cart', !!cart && ctx.UI._netCartFor === 'E1');
cart.add('e4'); cart.add('e4'); cart.add('br');
ok('it fills like any cart', cart.lines() === 2 && cart.qtyOf('e4') === 2);

/* ⚠️ THE BUG THE HANDLE EXISTS TO MAKE IMPOSSIBLE. _netBrowseBody runs on every press of +, because onChange
   repaints the panel. If it ever creates a cart again, the basket cannot survive its own first click. */
const again = ctx._netBrowseBody();
ok('★★ REPAINTING DOES NOT EMPTY THE CART — the renderer renders, it does not create',
   ctx.UI._netCart === cart && cart.lines() === 2 && again.includes('Emulsion'));

/* Re-entering the SAME store re-reads the catalogue; the basket you were filling is not an abandoned thing. */
ctx.netBrowse('E1', 'Beta Depot', 'CBSTORE01'); await settle();
ok('★★ coming back to the same store keeps the basket',
   ctx.UI._netCart === cart && cart.qtyOf('e4') === 2);

/* A different store is a different basket — carrying lines across would address an order to someone who never
   listed the item. */
ctx.netBrowse('E2', 'Gamma Yard', 'CBSTORE02'); await settle();
ok('★★ a DIFFERENT store gets a different, empty cart',
   ctx.UI._netCart !== cart && ctx.UI._netCartFor === 'E2' && ctx.UI._netCart.lines() === 0);

console.log('\ncap-network · the step flow');
const f = ctx.UI._netFlow;
ok('★ browsing a store creates a flow beside the cart', !!f && f.steps().length === 3);
ok('★★ THREE steps and no "To" — the store IS the recipient',
   f.steps().map((s) => s.k).join(',') === 'items,details,review');
ok('★★ an empty cart blocks the first step, and SAYS why',
   f.blockedBecause() === 'Add at least one item.' && f.footHTML().includes('Add at least one item'));
ctx.UI._netCart.add('e10');
ok('★ adding a line unblocks it', f.blockedBecause() === null);
ok('★ the rail and the body are both on the panel',
   ctx._netBrowseBody().includes('id="net_rail"') && ctx._netBrowseBody().includes('id="net_body"'));
f.next();
ok('★ Details renders and proposes a subject', f.step() === 'details'
   && ctx._netStepDetails().includes('data-testid="net-subject"') && ctx.UI._netOrder.subject.indexOf('Request —') === 0);
f.next();
ok('★ Review renders the total and names what it sends', f.step() === 'review'
   && ctx._netStepReview().includes('data-testid="net-total"') && f.footHTML().includes('Send request to'));
ok('★ the escape hatch is offered on Review only', ctx._netBrowseBody().includes('net-open-compose'));

console.log('\ncap-network · ⚠️ your own store');
/* You can be looking at yourself: your own store is in your own network. Ordering from yourself is not a transfer,
   it is a mistake — and it must be caught on the CHIP, not discovered at Review. */
ctx.UI._brStores = { stores: [{ entity_id: 'E2', name: 'Gamma Yard', is_me: true }] };
ok('★★ the own-store guard blocks EVERY step, not just the first',
   f.blockedBecause() === 'This is your own store — pick another.');
ok('★★ …and it is said ON the chip, where it cannot be missed',
   ctx._netBrowseBody().includes('this is your own store'));
const before = ctx.__composed;
ctx.netSendCart();
ok('★★ …and sending is refused outright', ctx.__composed === before);
ctx.UI._brStores = { stores: [{ entity_id: 'E2', name: 'Gamma Yard', is_me: false }] };

console.log('\ncap-network · what it sends');
ctx.netSendCart();
const sent = ctx.__sent;
ok('★★ it SENDS — one createChit, the same one compose uses, not a second path',
   !!sent && sent.recipients[0].name === 'Gamma Yard' && sent.recipients[0].role === 'to');
ok('★★ the quantity set at the ROW travels through — the stepper is a decision, not a suggestion',
   sent.line_items.length === 1 && sent.line_items[0].quantity === 1 && sent.line_items[0].particulars === 'Emulsion 10L');
ok('★ their price rides along as they stamped it', sent.line_items[0].price === 2100);
ok('★ the chit schema is filled from the Details step',
   sent.schema_values.subject === sent.subject && 'delivery_by' in sent.schema_values);

console.log('\ncap-network · the escape hatch still hands to compose');
ctx.netBrowse('E2', 'Gamma Yard', 'CBSTORE02'); await settle();
// sendChit is stubbed here, so its onSent (which releases the cart) never runs — clear explicitly rather than
// assert against whatever the previous case happened to leave behind.
ctx.UI._netCart.clear();
ctx.UI._netCart.add('br');
ctx.netOpenInCompose();
const composed = ctx.__composed;
ok('★ "Open in compose" carries the store, the lines and the catalogue',
   !!composed && composed.supplier.entity_id === 'E2' && composed.items.length === 1 && composed.catalogue.length === 3);

console.log('\n  ' + (failed ? failed + ' FAILED' : 'all passed') + '\n');
process.exit(failed ? 1 : 0);

/**
 * tests/detail-placement.test.cjs — DESIGN TRACK pass 2 (UX-11 · UX-17 · UX-96): the ONE bill/order detail chooses its place by width, and the
 * avatar menu points where NAV-MAP §6 item 10 says.
 *   · the detail is a SIDE PANE above the skeleton's 1100 px, a FULL PAGE below it (phone and tablet), the old popup only where a wide page has no pane seat
 *   · the sample detail (labelled, from fixed figures) reads as a real bill: lines, one GST rate, a total; no arithmetic in the sheet
 *   · Profile → Settings › Your business; the owner has Settings on every page; Support is hidden until a support page exists
 * No browser. Run: node tests/detail-placement.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const APP = (f) => path.join(__dirname, '..', 'public', 'app', f);
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(APP('helpers.js'), 'utf8'));   /* the page's one esc · fmtMoney */
globalThis.document = { getElementById: () => null };
globalThis.counterOfBill = () => '';
eval(fs.readFileSync(APP('chit-sheet.js'), 'utf8'));
const S = globalThis.CBSheet;

/* 1 · placement: the boundary is the skeleton's 1100 px collapse */
assert.strictEqual(S.placeFor(390, true), 'page', 'phone → full page');
assert.strictEqual(S.placeFor(760, true), 'page', 'the skeleton\'s phone edge → full page');
assert.strictEqual(S.placeFor(1100, true), 'page', 'tablet (sidebar collapsed) → full page');
assert.strictEqual(S.placeFor(1101, true), 'pane', 'wide → side pane');
assert.strictEqual(S.placeFor(1366, true), 'pane', '1366 → side pane');
assert.strictEqual(S.placeFor(1366, false), 'popup', 'wide with no pane seat (the workshop) keeps the popup');
assert.strictEqual(S.placeFor(390, false), 'page', 'phone is a full page even with no seat');
assert.strictEqual(S.placeFor(undefined, true), 'page', 'an unknown width is never a pane');
console.log('  ok  placement by width');

/* 2 · the sample: a labelled order drawn from fixed figures, read through the sheet's own model */
const m = S.sample();
assert.strictEqual(m.who, 'Meena', 'from Meena');
assert.strictEqual(m.lines.length, 2, 'two lines');
assert.strictEqual(m.money.total, 1129.8, 'the total is the typed figure');
const gst = S.moneyBlockHTML(m);
assert(/cs-gst/.test(gst) && /5%/.test(gst) && /cs-total/.test(gst), 'GST by rate and the total are painted');
assert(S.orderHTML(m).includes('Ring first'), 'the order block shows the remark');
console.log('  ok  sample detail');

/* 3 · the avatar menu */
const store = () => { const mm = new Map(); return { getItem: (k) => (mm.has(k) ? mm.get(k) : null), setItem: (k, v) => mm.set(k, String(v)), removeItem: (k) => mm.delete(k), key: (i) => Array.from(mm.keys())[i], get length() { return mm.size; } }; };
const el = () => ({ style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, setAttribute() {}, removeAttribute() {}, classList: { add() {}, toggle() {} } });
const g = { localStorage: store(), sessionStorage: store() };
g.document = { documentElement: el(), addEventListener() {}, getElementById: () => null, createElement: el, head: { appendChild() {} } };
g.getComputedStyle = () => ({ getPropertyValue: () => '', fontSize: '16px' });
g.location = { href: 'http://x/accounts.html' }; g.URL = URL; g.setTimeout = () => 1; g.clearTimeout = () => {}; g.addEventListener = () => {};
g.CBScreen = { APP_THEMES: {} };
new Function('window', 'localStorage', 'document', fs.readFileSync(APP('avatar.js'), 'utf8')).call(g, g, g.localStorage, g.document);
const menu = (o) => g.CBAvatar.menuHtml(Object.assign({ person: { name: 'Asha', role: 'Owner', owner: true } }, o));
const owner = menu({});
assert(/data-testid="nav-profile"[^>]*href="\/settings\.html#\/shop"/.test(owner), 'Profile → Settings › Your business');
assert(/data-testid="nav-settings"[^>]*href="\/settings\.html"/.test(owner), 'the owner has Settings with no page opting in');
assert(!/av-support/.test(owner), 'Support is hidden until a support page exists');
assert(!/know-your-business/.test(owner), 'Profile no longer opens Know your business');
assert(/data-testid="av-support"[^>]*href="\/help\.html"/.test(menu({ supportHref: '/help.html' })), 'a page that has a support page gets the item');
assert(/data-av="support"/.test(menu({ onSupport: () => {} })), 'the workshop\'s own Support handler still shows it');
assert(!/nav-settings/.test(menu({ person: { name: 'Ravi', role: 'Cashier', owner: false } })), 'a person who is not the owner has no Settings');
console.log('  ok  avatar menu targets');
console.log('detail-placement: all ok');

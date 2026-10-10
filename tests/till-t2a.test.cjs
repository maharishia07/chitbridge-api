'use strict';
/**
 * till-t2a.test.cjs - ROUND T2a (walk 2026-10-10, M126 M127 M128 M129 M130 M84b M131), measured against the page and the route.
 * No DB, no network, no browser: the page's own functions are lifted out of till.html and run; the route is read.
 * Run: node tests/till-t2a.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const ROUTE = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8').replace(/\r\n/g, '\n');
const CBRollup = require(path.join(API, 'tools', 'tally-connector', 'rollup.js'));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

/** lift one top-level function out of the page, by name */
function lift(name) {
  const i = PAGE.indexOf('\nfunction ' + name + '(');
  assert(i >= 0, name + ' is not in the page');
  let d = 0, j = PAGE.indexOf('{', i);
  for (let k = j; k < PAGE.length; k++) {
    if (PAGE[k] === '{') d++;
    else if (PAGE[k] === '}') { d--; if (d === 0) return PAGE.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}

console.log('- M128: a despatch note is never a bill');
const isDocRow = new Function(lift('isDocRow') + '; return isDocRow;')();
ok('isDocRow: a despatch / receipt / doc row is a document; a bill, a credit note, an expense is not', () => {
  assert(isDocRow({ doc: true }) && isDocRow({ kind: 'despatch' }) && isDocRow({ kind: 'receipt' }));
  assert(!isDocRow({ kind: 'cash' }) && !isDocRow({ kind: 'credit_note' }) && !isDocRow({ kind: 'expense' }) && !isDocRow({}) && !isDocRow(null));
});
ok('the count is ONE engine (CBRollup.totals) over bills only: 2 bills + 1 return + 1 despatch = 2 bills, not 3 or 4', () => {
  const rows = [
    { no: 'C5/26-27/0004', kind: 'cash', total: 175, payments: [{ how: 'Cash', amount: 175 }] },
    { no: 'C5/26-27/0005', kind: 'cash', total: 195, payments: [{ how: 'Card', amount: 195 }] },
    { no: 'CN/C5/26-27/0001', kind: 'credit_note', total: -50, refunds: [{ how: 'Cash', amount: 50 }] },
    { no: 'D/C5/26-27/0001', kind: 'despatch', doc: true, lines: [] },
  ];
  assert.strictEqual(CBRollup.totals(rows.filter((b) => !isDocRow(b))).count, 2);
  assert.strictEqual(CBRollup.totals(rows).count, 3, 'the bug: unfiltered, the packing slip is a bill');
});
ok('the three readers of today\'s rows filter through isDocRow (state, bills, local)', () => {
  assert.strictEqual((PAGE.match(/&& !isDocRow\(b\)/g) || []).length, 3);
});

console.log('- M126 / M129: an online order is billed, then leaves the open list');
ok('a shop that holds no stock bills the order (orderToBill); the order rides the bill as order.from', () => {
  assert(/if \(!holdsStock\(\)\) \{[\s\S]{0,200}orderToBill\(ot\)/.test(PAGE));
  assert(PAGE.includes("order: BILL_ORDER ? { type: BILL_ORDER.kind, table: null, kots: [], from: BILL_ORDER.chit_id }"));
  assert(/if \(BILL_ORDER\) \{ var boDone = BILL_ORDER; BILL_ORDER = null; orderBilledDone\(boDone, r\.bill\); \}/.test(PAGE));
});
ok('the host marks the order done through the same deliver-lines queue a despatch uses, referenced by the BILL number', () => {
  assert(/async orderBilled\(bo, bill\)[\s\S]{0,600}reference: bill\.no[\s\S]{0,200}deliver: \{ chit_id: bo\.chit_id/.test(PAGE));
});
ok('a billed order never comes back from a read made before its mark reached the shop', () => {
  assert(PAGE.includes('ONLINE.billed && ONLINE.billed[t.chit_id]'));
});
ok('/api/till/tasks says how an online order was placed (orderOf), from summary_json.order_details', () => {
  const orderOf = new Function(ROUTE.slice(ROUTE.indexOf('function orderOf('), ROUTE.indexOf('router.get(\'/tasks\'')) + '; return orderOf;')();
  assert.strictEqual(orderOf(null), null);
  assert.strictEqual(orderOf({ order_details: { channel: 'online', fulfilment: 'delivery', address: 'Anna Nagar' } }).fulfilment, 'delivery');
  assert.strictEqual(orderOf({ order_details: { channel: 'online', fulfilment: 'pickup' } }).fulfilment, 'pickup');
  assert.strictEqual(orderOf({ order_details: { channel: 'whatsapp' } }), null);
  assert(ROUTE.includes('order: orderOf(h.summary_json), lines'));
});

console.log('- M127: the mode menu');
ok('holdsStock: the server says, the counter may override, an order-ticket counter serves', () => {
  const mk = (S, opt, kot, open) => new Function('S', 'tillOpt', 'kotOn', 'purposeHas',
    lift('holdsStock').replace('function holdsStock', 'function holdsStock') + '; return holdsStock();')(S, () => opt, () => kot, () => open);
  assert.strictEqual(mk({ shop: { holds_stock: true } }, {}, false, false), true);
  assert.strictEqual(mk({ shop: { holds_stock: false } }, {}, false, false), false);
  assert.strictEqual(mk({ shop: {} }, {}, false, false), true, 'unknown = general trade = holds stock');
  assert.strictEqual(mk({ shop: { holds_stock: false } }, { stock: true }, false, false), true, 'the counter overrides');
  assert.strictEqual(mk({ shop: { holds_stock: true } }, {}, true, false), false, 'a kitchen-ticket counter serves');
});
ok('Receive / Despatch are shown to every shop and greyed WITH the reason; the saved mode cannot strand a restaurant in Despatch', () => {
  assert(PAGE.includes("return ((m === 'receive' || m === 'despatch') && !holdsStock()) ? 'This shop does not hold stock.' : '';"));
  assert(PAGE.includes("(why ? ' disabled title=\"' + esc(why) + '\"' : '')"));
  assert(/var whyNot = modeWhy\(m\); if \(whyNot\) \{ toastLine\(whyNot\); m = 'sell'; \}/.test(PAGE));
});
ok('the current mode is a named pill; one tap back to Sell; F10 and F8 work in every mode (F8 stays "next carton" in Despatch)', () => {
  assert(PAGE.includes('id="modepill"') && PAGE.includes('id="modeback"') && PAGE.includes("onclick=\"setMode('sell')\""));
  assert(PAGE.includes("if (e.key === 'F10'){ dayClose(); e.preventDefault(); }"));
  assert(PAGE.includes("if (e.key === 'F8' && MODE !== 'despatch'){ openBills();"));
  assert(PAGE.includes("toastLine('Park is for the Sell screen. Tap Sell.')"));
});
ok('the snapshot says whether the shop holds stock (SERVES_RE over its sectors)', () => {
  const re = new Function('return ' + ROUTE.match(/const SERVES_RE = (\/.*\/i);/)[1])();
  ['Restaurant', 'Hotel', 'Cafe / Bakery cafe', 'Catering', 'Salon'].forEach((s) => assert(re.test(s), s));
  ['Grocery', 'Pharma', 'Hardware', 'Spare parts', 'Textiles'].forEach((s) => assert(!re.test(s), s));
  assert(ROUTE.includes("holds_stock: !SERVES_RE.test((Array.isArray(sectors) ? sectors : []).join(' '))"));
});

console.log('- M130: no 403 on a normal load');
ok('GET /quick-keys/hidden answers an empty list to a login that holds no counter', () => {
  const at = ROUTE.indexOf("router.get('/quick-keys/hidden'");
  const body = ROUTE.slice(at, ROUTE.indexOf("router.post('/quick-keys/hide'", at));
  assert(body.includes("if (!counter_id) return res.json({ hidden: [] });"));
  assert(!body.includes('status(403)'));
});

console.log('- M84b: a closed day can be sent again or reopened');
ok('the closed slip offers Send the day and Reopen; the send is the same daySummarySend', () => {
  assert(PAGE.includes('id="slipdaysend"') && PAGE.includes('id="slipdayreopen"'));
  assert(PAGE.includes('if (await daySummarySend(d.closed))'));
  assert(PAGE.includes('dayClosedButtons(!!d.closed);'));
});

console.log('- M131: phone keys are compact');
ok('under 601 px: 3 keys a row, a small photo, and a Pictures / Names switch on the bar', () => {
  assert(PAGE.includes('grid-template-columns:repeat(3,minmax(0,1fr))!important'));
  assert(PAGE.includes('data-testid="till-quick-pn"') && PAGE.includes('screenSet({photos:'));
});

console.log('\n' + n + ' checks');

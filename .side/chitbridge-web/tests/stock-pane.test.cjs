'use strict';
/* tests/stock-pane.test.cjs — THE STOCK SCREEN PAINTS THE SERVER'S QUANTITIES AND COMPUTES NONE (public/app/cap-stock.js, Operations › Stock).
 * UNIT      13 INVENTORY / STOCK & TRACEABILITY / On hand & movements (web half; the card's tests were the counter's Receive screen and a walk)
 * OWNS      what the pane may and may not do: one read of GET /api/till/stock?detail=1, once however often it is asked while busy · the quantity per product is the
 *           server's number (a non-number reads 0, never NaN) · a product the ledger never moved is ABSENT, not a row of 0 · "below zero" and "none left" are said in
 *           words, not left as a bare minus · LEAST ON HAND FIRST is the default sort (no reorder level exists, so "low stock" is never claimed) · an expired batch
 *           and one expiring within 30 days are told apart from a healthy one · a not-switched-on shop gets the server's sentence, a failed read says so and offers
 *           a retry (never an empty "no stock") · every server string is escaped.
 * CALLED BY .github/workflows/ci.yml (web guards). No browser, no network: the page globals (CBList, api, esc, tx) are stubs; CBList captures the options the pane hands it.
 * FLOW      vm sandbox → CBStock.mount(host) → opts captured by the CBList stub → columns / filters / sorts / head / empty / state asserted
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 * Run: node tests/stock-pane.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

const DAY = 86400000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

function page(reply) {
  const calls = [], logs = [];
  let opts = null, listRefreshes = 0;
  const cx = vm.createContext({
    console,
    esc: (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    tx: (s) => s,
    cblog: (lvl, msg) => logs.push(lvl + ': ' + msg),
    EP: {},
    api: (name, o) => { calls.push([name, o]); return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply); },
    CBList: { mount: (el, o) => { opts = o; return { refresh: () => { listRefreshes++; }, destroy: () => {} }; } }
  });
  cx.window = cx;
  vm.runInContext(fs.readFileSync(__dirname + '/../public/app/cap-stock.js', 'utf8'), cx);
  const host = { innerHTML: '', querySelector: () => ({}) };
  return { cx, calls, logs, host, opts: () => opts, refreshes: () => listRefreshes };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

(async () => {
  const BAL = {
    r1: { name: 'Basmati rice', unit: 'kg', qty: 12.5, lots: [{ lot: 'B-7', qty: 12.5, expires_at: iso(200) }] },
    r2: { name: 'Milk', unit: 'l', qty: -3, lots: [{ lot: 'M-1', qty: -3, expires_at: iso(-2) }] },
    r3: { name: 'Salt', unit: 'kg', qty: 0, lots: [] },
    r4: { name: null, unit: null, qty: 'lots', lots: [{ lot: 'X-1', qty: 4, expires_at: iso(10) }] },
    r5: { name: '<img src=x onerror=1>', unit: '"', qty: 2, lots: [] }
  };
  const p = page({ balances: BAL });
  const handle = p.cx.CBStock.mount(p.host);
  await settle();
  const o = p.opts();
  ok(p.calls.length === 1 && p.calls[0][0] === 'stockOnHand' && p.calls[0][1].query.detail === '1', 'mount reads the one stock reader once, with ?detail=1');
  ok(p.cx.EP.stockOnHand && p.cx.EP.stockOnHand.p === '/api/till/stock' && p.cx.EP.stockOnHand.m === 'GET', 'the endpoint is registered as GET /api/till/stock when the page has not');

  const rows = o.rows();
  ok(rows.length === 5, 'one row per product the server named — five in, five rows');
  ok(rows.find((r) => r.id === 'r4').qty === 0, 'a quantity that is not a number reads 0, never NaN on screen');
  ok(rows.find((r) => r.id === 'r1').qty === 12.5 && rows.find((r) => r.id === 'r2').qty === -3, 'quantities are the server\'s numbers, untouched (12.5 and -3)');
  ok(o.state() === null, 'with rows loaded and no error the list is in its normal state');

  /* ── an absent product is absent ── */
  const empty = page({ balances: {} });
  empty.cx.CBStock.mount(empty.host); await settle();
  const e = empty.opts().empty();
  ok(/No stock moved yet/.test(e.title) && /once a delivery is received or a sale is made/.test(e.sub), 'no balances: the empty state says nothing has MOVED, not "you have no stock"');
  ok(empty.opts().head().chips.length === 0, 'no rows: no "0 items" chip');

  /* ── columns ── */
  const cols = o.columns();
  const cell = (key, id) => cols.find((c) => c.key === key).cell(rows.find((r) => r.id === id));
  ok(/below zero/.test(cell('qty', 'r2')) && /tag red/.test(cell('qty', 'r2')) && /stock-below-r2/.test(cell('qty', 'r2')), 'a negative quantity is said in words: "below zero", red, with its own testid');
  ok(/none left/.test(cell('qty', 'r3')) && /tag amber/.test(cell('qty', 'r3')), 'zero is "none left", amber');
  ok(/12\.5/.test(cell('qty', 'r1')) && /kg/.test(cell('qty', 'r1')) && !/tag/.test(cell('qty', 'r1')), 'a healthy quantity is the number and its unit with no warning tag');
  ok(/Item r4/.test(cell('name', 'r4')), 'a product with no name is "Item <id>", not a blank row');
  ok(/&lt;img/.test(cell('name', 'r5')) && !/<img/.test(cell('name', 'r5')), 'a product name with markup is escaped');
  ok(/not kept by batch/.test(cell('lots', 'r3')), 'no batches: "not kept by batch", not "0 batches"');
  ok(/1 batch(?!es)/.test(cell('lots', 'r1')) && !/1 batches/.test(cell('lots', 'r1')), 'one batch is singular');
  ok(/expired/.test(cell('lots', 'r2')) && /tag red/.test(cell('lots', 'r2')), 'an expired batch says expired, red');
  ok(/tag amber/.test(cell('lots', 'r4')) && /expires/.test(cell('lots', 'r4')), 'a batch expiring in 10 days is amber');
  ok(!/tag/.test(cell('lots', 'r1')) && /class="sub"/.test(cell('lots', 'r1')), 'a batch 200 days out carries no warning tag');

  /* ── next level ── */
  ok(/not kept by batch — one count for all of it/.test(o.next(rows.find((r) => r.id === 'r3'))), 'the next level of an untracked product says it is one count');
  ok(/B-7/.test(o.next(rows.find((r) => r.id === 'r1'))) && /12\.5 kg/.test(o.next(rows.find((r) => r.id === 'r1'))), 'the next level lists the batch with its quantity and unit');

  /* ── head / notices ── */
  const head = o.head();
  ok(head.chips[0].text === '5 items' && head.chips[0].tid === 'stock-count', 'the count chip counts the rows');
  ok(head.notices.length === 1 && /1 below zero — count it/.test(head.notices[0].text) && head.notices[0].cls === 'bad', 'one product below zero → one notice, singular, asking for a count');
  const two = page({ balances: { a: { qty: -1, lots: [] }, b: { qty: -2, lots: [] }, c: { qty: 4, lots: [] } } });
  two.cx.CBStock.mount(two.host); await settle();
  ok(/2 below zero — count them/.test(two.opts().head().notices[0].text), 'two below zero → plural');
  ok(two.opts().head().chips[0].text === '3 items', 'the chip counts all three');
  const one = page({ balances: { a: { qty: 1, lots: [] } } });
  one.cx.CBStock.mount(one.host); await settle();
  ok(one.opts().head().chips[0].text === '1 item' && one.opts().head().notices.length === 0, 'one product: "1 item", and no notice when nothing is below zero');

  /* ── sorts ── */
  ok(o.sorts[0].key === 'least' && /Least on hand first/.test(o.sorts[0].label), 'the default sort is LEAST ON HAND FIRST');
  ok(!o.sorts.some((s) => /low stock|reorder/i.test(s.label)), 'no sort claims "low stock" or a reorder level — none is kept');
  const byLeast = rows.slice().sort(o.sorts[0].cmp).map((r) => r.id);
  ok(byLeast[0] === 'r2' && [byLeast[1], byLeast[2]].sort().join() === 'r3,r4' && byLeast[3] === 'r5' && byLeast[4] === 'r1', 'least first: below zero, then none left, then the rest (' + byLeast.join(',') + ')');
  const byExpiry = rows.slice().sort(o.sorts.find((s) => s.key === 'expiry').cmp).map((r) => r.id);
  ok(byExpiry[0] === 'r2', 'expiring first puts the expired batch first');
  ok(byExpiry[byExpiry.length - 1] === 'r3' || byExpiry[byExpiry.length - 1] === 'r5', 'products with no expiry go last');

  /* ── filters ── */
  const fState = o.filters.find((f) => f.key === 'state'), fExp = o.filters.find((f) => f.key === 'exp');
  const ids = (f, v) => rows.filter((r) => f.match(r, v)).map((r) => r.id).sort().join(',');
  ok(ids(fState, 'below') === 'r2' && ids(fState, 'none') === 'r3,r4' && ids(fState, 'on') === 'r1,r5', 'How much: below zero · none left (zero or unreadable) · on the shelf');
  ok(ids(fExp, 'gone') === 'r2' && ids(fExp, 'soon') === 'r4', 'Expiry: expired is r2 only, within 30 days is r4 only (200 days out is neither)');

  /* ── search ── */
  ok(/B-7/.test(o.search(rows.find((r) => r.id === 'r1'))) && /Basmati/.test(o.search(rows.find((r) => r.id === 'r1'))), 'search finds a product by name AND by batch number');

  /* ── not switched on ── */
  const off = page({ not_ready: true, says: 'Stock is not switched on for this shop yet. Run b214.', balances: {} });
  off.cx.CBStock.mount(off.host); await settle();
  ok(off.opts().empty().title === 'Stock is not switched on for this shop yet. Run b214.' && !off.opts().empty().sub, 'not_ready: the server\'s own sentence is the empty state');
  const off2 = page({ not_ready: true, balances: {} });
  off2.cx.CBStock.mount(off2.host); await settle();
  ok(/not switched on/.test(off2.opts().empty().title), 'not_ready with no sentence still says "not switched on", not "no stock moved yet"');

  /* ── failure ── */
  const bad = page(new Error('502'));
  bad.cx.CBStock.mount(bad.host); await settle();
  ok(bad.opts().state() === 'error', 'a failed read puts the list in its error state');
  ok(/Could not read your stock/.test(bad.opts().error().title) && /Nothing was changed/.test(bad.opts().error().sub), 'the error says what happened and that nothing changed');
  ok(bad.logs.some((l) => /GET \/api\/till\/stock failed — 502/.test(l)), 'the failure is logged with the route');
  bad.opts().onRetry(); await settle();
  ok(bad.calls.length === 2, 'retry reads again');

  /* ── one read at a time ── */
  const busy = page({ balances: BAL });
  busy.cx.CBStock.mount(busy.host);
  busy.cx.CBStock.load(); busy.cx.CBStock.load();
  await settle();
  ok(busy.calls.length === 1, 'asked three times while the first read was out, it read ONCE');

  ok(typeof handle.refresh === 'function', 'mount hands back a refresh');
  console.log(n + ' checks');
  console.log(n + ' passed');
})().catch((e) => { console.error('  FAIL ' + (e && e.stack ? e.stack : e)); process.exit(1); });

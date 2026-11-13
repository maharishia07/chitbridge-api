/**
 * tests/ctr-243-stale-send.test.cjs — CTR-243: a bill rung offline at a price the shop had already changed is looked at before it is sent, and is never re-priced.
 * @type regression
 * OWNS      the proof, through the counter page's OWN functions (lifted from tools/tally-connector/till.html) over a stand-in store, that staleGate: (1) sends a PRICE-ONLY move as sold and records
 *           price_basis.stale_ack (Athi A1, 13 Nov) without asking, (2) HOLDS a rate move or a no-longer-sold line (B1: _price_hold, owner PIN to send, the popup after the run, never mid-sale),
 *           (3) is silent for a change after the sale, before the snapshot, with equal figures, for a kept line, a deleted product and the door failing (sold as is, one toast),
 *           (4) says "Price changes could not be checked yet" for a plain row with no stamp, (5) reads the clock the way the door's answer shows it (a till 2 h fast or slow),
 *           (6) never touches a figure of the bill (total, taxable, tax stay what the customer holds), (7) never asks twice (asked flag; the chip asks again), (8) asks 250 products in two calls.
 *           HAND FIGURES (typed, nothing is recomputed here): 2 x 100.00 excl at 18 intra = 200.00 + 18.00 + 18.00 = 236.00 (23600 minor); at 120.00: 240.00 + 21.60 + 21.60 = 283.20 (28320, the S2a oracle, never shown);
 *           rate 12: 224.00 (22400); one unit 100.00 + 18.00 = 118.00; 236.00 + 118.00 = 354.00 (35400); 100.00 incl 18% intra: heads round(100 x 9/118) = 7.63, tax 15.26, taxable 84.74;
 *           at 120.00 incl: heads round(120 x 9/118) = 9.15, tax 18.30, taxable 101.70.
 * CALLED BY scripts/guards.cjs · CI. No database, no network, no browser. The real-browser half is web e2e/till-stale-send.cjs.
 * FLOW      queued bill rows + the door's answer → staleGate → rows to send / held rows / acks on the rows → popup → owner PIN → released
 *   node tests/ctr-243-stale-send.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const check = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };

const ENGINE = { console, Math, Date, JSON, Object, Array, String, Number, Map, Set, Error, RegExp, isNaN, parseFloat, Intl };
ENGINE.window = ENGINE; ENGINE.self = ENGINE;
vm.createContext(ENGINE); vm.runInContext(fs.readFileSync(path.join(API, 'lib', 'tax-engine.browser.js'), 'utf8'), ENGINE);
const CBTAX = ENGINE.CBTax, REGULATION = ENGINE.CBRegulation;
const MONEY = require(path.join(API, 'lib', 'money'));
const r2 = (n) => MONEY.round(Number(n) || 0);
const minor = (major) => Math.round(Number(major) * 100);

const PAGE = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
function fnText(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) throw new Error(sig + ' is gone from the source - this test is measuring nothing');
  const end = src.indexOf('\n}\n', at);
  return src.slice(at, end + 2);
}
const lineText = (src, sig) => { const at = src.indexOf(sig); if (at < 0) throw new Error(sig + ' is gone'); return src.slice(at, src.indexOf('\n', at)); };
const LIFT_FN = ['function cbQuiet(', 'function throwIfFrozen(', 'function isParkedRow(', 'function sendableRows(', 'function taxInputOf(', 'function recheckGone(', 'function recheckContext(', 'function recheckRateOf(',
  'function staleSaleRow(', 'function staleCandidate(', 'function staleSoldPrice(', 'function staleWindow(', 'function staleReason(', 'function qBackoff(', 'function qDue(', 'async function staleGateSafe(', 'async function staleSettle(', 'function staleSetHold(', 'async function staleHoldUnreadable(', 'async function staleDoorDown(', 'async function staleMarkUnchecked(', 'function staleStampSays(', 'function staleLineVerdict(', 'function heldPriceWords(', 'function staleRowVerdict(', 'async function staleRead(',
  'async function staleMark(', 'function staleAck(', 'function staleSetAck(', 'async function staleGate(', 'function staleBusyNow(', 'function staleTime(', 'function staleLineWords(',
  'function staleAskWords(', 'async function staleMarkAsked(', 'async function staleRelease(', 'async function staleAsk(', 'async function staleAskSoon(', 'function staleChipHTML(', 'async function staleDecide(',
  'async function qReady('];
const LIFT_LINE = ['var Q_FLOOR', 'var STALE_SKEW_MS', 'var STALE_DOOR_MODE', 'var STALE_RANK'];

const SLAB18 = { definition_id: 'gst-18', kind: 'tax', name: 'GST 18%', rate: 18 };
const H = (hhmm) => '2026-11-13T' + hhmm + ':00.000Z';   /* a moment on the server clock, 13 Nov */
const STORES = () => ({ queue: new Map(), bills: new Map() });
const clone = (o) => JSON.parse(JSON.stringify(o));

/** a bill row as the counter queues it: the bill itself. rate and price are the sold ones; basis says the catalogue was not read */
function bill(no, o) {
  o = o || {};
  const qty = o.qty == null ? 2 : o.qty, price = o.price == null ? 100 : o.price;
  return Object.assign({
    no, at: o.at || H('10:00'), total: o.total == null ? 236 : o.total, taxable: o.taxable == null ? 200 : o.taxable, tax: o.tax == null ? 36 : o.tax,
    lines: [{ item_id: o.item || 'RICE', name: o.name || 'Rice 5 kg', qty, price, list_price: price, mods: null, gst_rate: o.rate == null ? 18 : o.rate, net: qty * price }],
    price_basis: { checked: false, at: null, snapshot_at: o.snap || H('08:00'), parked_at: null, reason: o.reason || 'offline' }
  }, o.extra || {});
}
const ans = (o) => Object.assign({ item_id: 'RICE', name: 'Rice 5 kg', found: true, checked: true, active: true, status: 'available', price: 120, gst_rate: 18, changed_at: H('09:00') }, o || {});

/** a counter page: the lifted gate over an in-memory store, the real tax engine, a clock offset, and one cashier / owner / door */
function counter(o) {
  const world = Object.assign({ stores: STORES(), serverNow: H('11:00'), skewMs: 0, posts: [], door: null, sure: [], asked: [], pin: true, pinAsked: 0, toasts: [], drains: 0, cart: [], lock: null, dialog: null, askOpen: null, frozen: false }, o);
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FakeDate.now()); } static now() { return RealDate.parse(world.serverNow) + world.skewMs; } }
  const DB = {
    all: async (store) => { if (world.frozen) { const e = new Error('frozen'); e.code = 'DB_FROZEN'; throw e; } return Array.from(world.stores[store].values()).map(clone); },
    put: async (store, row) => { if (world.frozen) { const e = new Error('frozen'); e.code = 'DB_FROZEN'; throw e; } world.stores[store].set(String(row.no), clone(row)); },
    del: async (store, key) => { world.stores[store].delete(String(key)); }
  };
  const ctx = {
    window: { CBRegulation: REGULATION }, CBRegulation: REGULATION, console, Object, Array, String, Number, JSON, Math, Date: FakeDate, Promise, isNaN, Error,
    CBTax: CBTAX, CBUnits: require('../lib/units'), r2, esc: (v) => String(v == null ? '' : v), money: (v) => (Number(v) || 0).toFixed(2), schemeWord: () => 'GST',
    modAdd: () => 0, QUIET_MAX: 200, QUIET: [],
    S: { slabs: [SLAB18], categories: [], face: {}, at: H('08:00'), policy: {} },
    DB, WHO: { id: 'cashier-1', name: 'Asha' }, CART: world.cart, LOCK: world.lock, _askResolve: world.askOpen,
    toastLine(t) { world.toasts.push(t); },
    sure: async (message, okWord, title, cancelWord) => { world.asked.push({ message, okWord, title, cancelWord }); return world.sure.length ? world.sure.shift() : true; },
    ownerPinAsk: async () => { world.pinAsked++; return world.pin ? { by: { id: 'owner-1', name: 'Athi' } } : null; },
    openBills: async () => true,
    HOST: {
      tillPost: async (p, body, opts) => { world.posts.push({ p, body, opts }); if (world.door === 'throws') throw new Error('line dropped'); if (typeof world.door === 'function') return world.door(body); return world.door; },
      drain: async () => { world.drains++; }
    },
    document: { querySelector: () => (world.dialog ? {} : null) },
  };
  ctx.window.CBTax = CBTAX;
  vm.createContext(ctx);
  vm.runInContext(LIFT_LINE.map((s) => lineText(PAGE, s)).concat(LIFT_FN.map((s) => fnText(PAGE, s))).join('\n'), ctx);
  const put = (row) => world.stores.queue.set(String(row.no), clone(row)) && world.stores.bills.set(String(row.no), clone(row));
  const queue = (no) => world.stores.queue.get(String(no));
  const bills = (no) => world.stores.bills.get(String(no));
  /** a door that answers these rows, at the server's "now" */
  const door = (rows, extra) => { world.door = (body) => ({ ok: true, at: world.serverNow, items: rows.filter((r) => body.item_ids.indexOf(r.item_id) >= 0), slabs: [], categories: [], face: {} }); Object.assign(world, extra || {}); };
  const gate = async (force) => { const rows = ctx.sendableRows(await DB.all('queue')); return vm.runInContext('staleGate', ctx)(rows, force !== false); };
  const mode = (m) => vm.runInContext("STALE_DOOR_MODE = '" + m + "'", ctx);
  return { ctx, world, put, queue, bills, door, gate, mode, DB };
}
const nosOf = (g) => g.rows.map((r) => r.no);

(async () => {
  console.log('\n== CTR-243 - a bill rung at an out-of-date price is looked at before it is sent ==\n');

  /* 1 CORE (A1): price 100 -> 120 changed 09:00, snapshot 08:00, bill 10:00 qty 2 = 236.00. Sent as sold, no popup, ack recorded, the figures untouched. */
  { const c = counter(); c.put(bill('B1')); c.door([ans()]);
    const g = await c.gate();
    ok('1 core: a price-only move goes as sold (A1): it is in the rows to send, nothing held, no popup asked', nosOf(g).join() === 'B1' && g.held === 0 && c.world.asked.length === 0);
    const sent = g.rows[0], q = c.queue('B1'), b = c.bills('B1');
    ok('1 the ack is on the row sent, on the queue row and on the bill row: price_moved, via auto, sold 100.00, now 120.00, changed 09:00', [sent, q, b].every((x) => {
      const a = x.price_basis.stale_ack; return a && a.reason === 'price_moved' && a.via === 'auto' && a.owner_pin === false && a.by === 'cashier-1' && a.lines[0].sold.price === 100 && a.lines[0].current.price === 120 && a.lines[0].changed_at === H('09:00'); }));
    ok('1 the figures the customer holds are untouched: total 236.00 (23600 minor), taxable 200.00, tax 36.00, line price 100.00', minor(sent.total) === 23600 && sent.taxable === 200 && sent.tax === 36 && sent.lines[0].price === 100 && sent.lines[0].net === 200);
    ok('1 hand oracle: 2 x 120.00 + 18% = 283.20 (28320 minor) is NOT shown anywhere (no total in any words)', minor(240 + 43.2) === 28320 && c.world.asked.length === 0 && !JSON.stringify(c.world.toasts).includes('283'));
    ok('1 ONE door call, never queued (noQueue), asking for the product', c.world.posts.length === 1 && c.world.posts[0].p === '/api/till/recheck' && c.world.posts[0].opts.noQueue === true && c.world.posts[0].body.item_ids.join() === 'RICE');
    ok('1 chip: "Price changed: sent as sold" on the bill, quiet', /Price changed: sent as sold/.test(c.ctx.staleChipHTML(c.bills('B1'), false)));
    const again = await c.gate();   /* the ack is on the row now: not a candidate any more, goes, no second call */
    ok('1 a second pass does not ask again (the ack is the answer)', nosOf(again).join() === 'B1' && c.world.posts.length === 1); }

  /* 2 change after the bill */
  { const c = counter(); c.put(bill('B2')); c.door([ans({ changed_at: H('10:30') })]); const g = await c.gate();
    ok('2 a change AFTER the sale (10:30, bill 10:00) is silent: sent, no ack, no chip', nosOf(g).join() === 'B2' && !c.queue('B2').price_basis.stale_ack && c.world.asked.length === 0 && c.world.toasts.length === 0); }
  /* 3 change before the snapshot, prices equal; 3b rule b alone */
  { const c = counter(); c.put(bill('B3', { price: 120 })); c.door([ans({ changed_at: H('07:30') })]); const g = await c.gate();
    ok('3 change before the snapshot (07:30, snapshot 08:00): the till already sold at 120.00 (240.00 + 43.20 = 283.20): silent', nosOf(g).join() === 'B3' && !c.queue('B3').price_basis.stale_ack);
    const d = counter(); d.put(bill('B3b')); d.door([ans({ changed_at: H('07:30') })]); const g2 = await d.gate();
    ok('3b rule b ALONE: sold at 100.00, now 120.00 but changed 07:30 BEFORE the snapshot 08:00: silent (the figures differ, the window does not)', nosOf(g2).join() === 'B3b' && !d.queue('B3b').price_basis.stale_ack && d.world.toasts.length === 0); }
  /* 4 equal figures, stamp moved */
  { const c = counter(); c.put(bill('B4')); c.door([ans({ price: 100, changed_at: H('09:00') })]); const g = await c.gate();
    ok('4 equal figures with a moved stamp (a rename at 09:00, price still 100.00): silent', nosOf(g).join() === 'B4' && !c.queue('B4').price_basis.stale_ack); }

  /* 5 RATE 18 -> 12 (B1): held, the rest goes, the owner PIN releases */
  { const c = counter(); c.put(bill('B5')); c.put(bill('OK1', { item: 'PEN', name: 'Pen' })); c.door([ans({ gst_rate: 12 }), ans({ item_id: 'PEN', name: 'Pen', price: 100, changed_at: H('07:00') })]);
    const g = await c.gate();
    ok('5 a rate move 18% -> 12% is HELD (B1): not in the rows to send, the other bill goes, held count 1', nosOf(g).join() === 'OK1' && g.held === 1);
    const q = c.queue('B5');
    ok('5 the hold sits on the queue row AND the bill row as _price_hold (underscored; _parked untouched), reason rate_moved, sold 18, now 12, not asked yet', [q, c.bills('B5')].every((x) => x._price_hold && x._price_hold.reason === 'rate_moved' && x._price_hold.lines[0].sold.gst_rate === 18 && x._price_hold.lines[0].current.gst_rate === 12 && x._price_hold.asked === false && !x._parked));
    ok('5 hand figures: the bill stays 236.00 (23600); at rate 12 it would be 200.00 + 12.00 + 12.00 = 224.00 (22400) and that total is never shown', minor(q.total) === 23600 && minor(200 + 24) === 22400 && c.world.asked.length === 0);
    c.world.pin = false; const no = await c.ctx.staleAskSoon();
    ok('5 popup: both buttons, the words carry values only and the reach; NO total, NO "would be"; wrong PIN: not sent, hold kept, asked flag set', c.world.asked.length === 1 && c.world.asked[0].okWord === 'Send as sold' && c.world.asked[0].cancelWord === 'Not yet' && /sold at 100\.00|GST was 18%, now 12%/.test(c.world.asked[0].message) && !/would be|total/i.test(c.world.asked[0].message) && /Until it is sent it is not in your books or stock/.test(c.world.asked[0].message) && /not be re-priced/.test(c.world.asked[0].message) && no === false && c.queue('B5')._price_hold.asked === true && c.world.drains === 0);
    c.world.pin = true; await c.ctx.staleDecide('B5');
    const a = c.queue('B5').price_basis.stale_ack;
    ok('5 the owner PIN releases it: ack via send_as_sold, owner_pin true, by owner-1, reason rate_moved; the hold is gone; one drain asked; the total is still 23600', a && a.via === 'send_as_sold' && a.owner_pin === true && a.by === 'owner-1' && a.reason === 'rate_moved' && !c.queue('B5')._price_hold && c.world.drains === 1 && minor(c.queue('B5').total) === 23600);
    const g3 = await c.gate();
    ok('5 then it goes: the next pass sends it (the ack is on the row), no second ask', nosOf(g3).indexOf('B5') >= 0 && c.world.asked.length === 2); }

  /* 6 tax-inclusive: 100.00 incl at 18% intra -> raised to 120.00 incl. A1: sent as sold with the ack; the bill's heads untouched */
  { const c = counter(); c.put(bill('B6', { qty: 1, total: 100, taxable: 84.74, tax: 15.26, extra: { heads: { cgst: 7.63, sgst: 7.63 } } })); c.door([ans({ price: 120 })]); const g = await c.gate();
    const sent = g.rows[0];
    ok('6 tax-inclusive: sold 100.00 incl (heads 7.63 + 7.63, tax 15.26, taxable 84.74), now 120.00: sent as sold, ack sold 100 / now 120, the heads untouched',
      nosOf(g).join() === 'B6' && sent.price_basis.stale_ack.lines[0].sold.price === 100 && sent.price_basis.stale_ack.lines[0].current.price === 120 && sent.taxable === 84.74 && sent.tax === 15.26 && sent.heads.cgst === 7.63);
    ok('6 hand figures: round(100 x 9/118) = 7.63 (tax 15.26, taxable 84.74); round(120 x 9/118) = 9.15 (tax 18.30, taxable 101.70); neither is shown', r2(100 * 9 / 118) === 7.63 && r2(120 * 9 / 118) === 9.15 && r2(2 * 9.15) === 18.3 && r2(120 - 18.3) === 101.7); }

  /* 7 retired -> held, no longer sold; deleted -> silent */
  { const c = counter(); c.put(bill('B7a')); c.put(bill('B7b', { item: 'GONE', name: 'Old tin' })); c.door([ans({ status: 'retired', price: 100 }), { item_id: 'GONE', found: false, checked: true }]);
    const g = await c.gate();
    ok('7 retired at 09:00: HELD as not_sold; a deleted product (found false): silent, sent as sold, no ack', nosOf(g).join() === 'B7b' && c.queue('B7a')._price_hold.reason === 'not_sold' && !c.queue('B7b').price_basis.stale_ack && g.held === 1);
    await c.ctx.staleAskSoon();
    ok('7 popup words: "sold at 100.00, no longer sold"', /Rice 5 kg: sold at 100\.00, no longer sold/.test(c.world.asked[0].message)); }

  /* 8 a kept line is never stale; a money_override bill is never asked */
  { const c = counter(); c.put(bill('B8', { extra: {} })); const row = c.queue('B8'); row.price_basis.kept = [{ item_id: 'RICE', carried: 100, current: 120 }]; c.world.stores.queue.set('B8', row);
    c.put(bill('B8b', { extra: { money_override: { by: 'o' } } })); c.door([ans()]); const g = await c.gate();
    ok('8 a line the owner kept at 100.00 is silent; a bill with a money_override is not a candidate: both sent, no ack, no call for the second', nosOf(g).sort().join() === 'B8,B8b' && !c.queue('B8').price_basis.stale_ack && !c.queue('B8b').price_basis.stale_ack); }

  /* 9 two bills, one item, rate moved: ONE popup */
  { const c = counter(); c.put(bill('B9a')); c.put(bill('B9b', { qty: 1, total: 118, taxable: 100, tax: 18, at: H('10:05') })); c.door([ans({ gst_rate: 12 })]); await c.gate();
    await c.ctx.staleAskSoon();
    ok('9 two held bills (236.00 + 118.00 = 354.00): ONE popup, both bills named with what was paid, the button says "Send all 2 as sold"', c.world.asked.length === 1 && c.world.asked[0].okWord === 'Send all 2 as sold' && /Bill B9a[\s\S]*236\.00 paid[\s\S]*Bill B9b[\s\S]*118\.00 paid/.test(c.world.asked[0].message) && minor(236 + 118) === 35400);
    ok('9 each bill\'s ack lists its own line and the owner PIN was asked once for both', ['B9a', 'B9b'].every((n) => c.queue(n).price_basis.stale_ack && c.queue(n).price_basis.stale_ack.lines.length === 1 && c.queue(n).price_basis.stale_ack.owner_pin === true) && c.world.pinAsked === 1); }

  /* 10 Not yet */
  { const c = counter(); c.put(bill('B10')); c.door([ans({ gst_rate: 12 })]); await c.gate(); c.world.sure = [false]; await c.ctx.staleAskSoon();
    ok('10 "Not yet": nothing sent (no drain), the row stays queued with its hold, asked=true, nothing re-priced (total 23600)', c.world.drains === 0 && c.queue('B10')._price_hold.asked === true && minor(c.queue('B10').total) === 23600 && !c.queue('B10').price_basis.stale_ack);
    const asks = c.world.asked.length; await c.ctx.staleAskSoon();
    ok('10 it is NOT asked again on the next drain (asked flag), the chip asks again, the held row never goes even on a forced pass', c.world.asked.length === asks && (await c.gate()).rows.length === 0);
    ok('10 the chip: amber "Price changed: not sent" with a decide button while it waits', /Price changed: not sent/.test(c.ctx.staleChipHTML(c.queue('B10'), true)) && /staleDecide\('B10'\)/.test(c.ctx.staleChipHTML(c.queue('B10'), true)));
    ok('10 the day close names it: "N bill(s) still waiting to send (1 waiting for a decision on a price change)"', c.ctx.heldPriceWords(c.ctx.sendableRows([c.queue('B10')])) === ' (1 waiting for a decision on a price change)' && c.ctx.heldPriceWords([bill('X')]) === '' && /still waiting to send' \+ heldPriceWords\(sendQ\)/.test(PAGE));
    await c.ctx.staleDecide('B10');
    ok('10 the chip then asks once more and "Send as sold" lets it go: 23600 posted shape, ack present', c.world.asked.length === asks + 1 && c.queue('B10').price_basis.stale_ack.via === 'send_as_sold' && minor(c.queue('B10').total) === 23600); }

  /* 11 door fails: (a) wait, the default; (b) open */
  { const c = counter(); c.put(bill('B11a')); c.put(bill('B11b', { at: H('10:02') })); c.world.door = { ok: false, why: 'ChitBridge answered 500' }; const g = await c.gate();
    ok('11a the door answers an error (default (a) wait): NO bill goes, both stay queued on the ladder (_stale_tries 1, _nextAt set, queue row only), no hold, ONE toast naming the wait, the check was never queued (noQueue)',
      g.rows.length === 0 && g.held === 0 && c.queue('B11a')._stale_tries === 1 && c.queue('B11a')._nextAt > 0 && c.bills('B11a')._nextAt === undefined && /2 bill\(s\) wait here and the check is tried again/.test(c.world.toasts.join()) && c.world.posts[0].opts.noQueue === true && /2 bill\(s\) waiting for the price check/.test(g.why));
    const t = counter(); t.put(bill('B11c')); t.world.door = 'throws'; const g2 = await t.gate();
    ok('11a the line dropping mid-check is the same: it waits, nothing sent', g2.rows.length === 0 && t.queue('B11c')._stale_tries === 1);
    /* the ORDER: check fails, nothing is sent, the next drain asks the door AGAIN, and when it answers the verdict is applied (the bill was never exempt) */
    c.door([ans({ gst_rate: 12 })]); const again = await c.gate();
    ok('11a the next drain re-checks: the door is asked again, the answer is applied to the bill that waited (rate moved: HELD for the owner PIN, not sent unchecked)', c.world.posts.length === 2 && again.held === 2 && again.rows.length === 0 && c.queue('B11a')._price_hold.reason === 'rate_moved');
    const d = counter(); d.put(bill('B11d')); d.world.door = { ok: false, why: 'down' }; let last;
    for (let i = 1; i < 9; i++) { last = await d.gate(); }
    ok('11a eight failed checks later it is still waiting (ladder not at its ceiling)', last.rows.length === 0 && d.queue('B11d')._stale_tries === 8 && !d.queue('B11d').price_basis.stale_unchecked);
    last = await d.gate();
    ok('11a at the ladder ceiling (9th failed check, qBackoff(9) = 300 s) it goes WITH the mark "Prices not checked" (queue row and bill row), written before the send, tries 9, mode wait', last.rows.length === 1 && d.queue('B11d').price_basis.stale_unchecked.tries === 9 && d.queue('B11d').price_basis.stale_unchecked.mode === 'wait' && d.bills('B11d').price_basis.stale_unchecked && d.queue('B11d')._stale_tries === undefined && /Prices not checked/.test(d.ctx.staleChipHTML(d.bills('B11d'), false)));
    /* then the SEND fails (_tries 1): the mark is on the row, so the body never changes again and it is not asked again: a bill that may have reached the shop must not change its body */
    const row = d.queue('B11d'); row._tries = 1; d.world.stores.queue.set('B11d', row); d.world.door = { ok: false }; const after = await d.gate();
    ok('11a check fails, then the SEND fails: the next drain does not rewrite the body (the unchecked mark stands, the bill is sent again as it was, no door call)', after.rows.length === 1 && d.world.posts.length === 9);
    const w = counter(); w.put(bill('B11w', { extra: { _nextAt: Date.parse(H('11:00')) + 60000 } })); w.world.door = { ok: false }; const gw = await w.gate(false);
    ok('11a a bill still on its wait is not asked by a normal drain (qDue); Send now (force) asks it', gw.rows.length === 1 && w.world.posts.length === 0 && (await w.gate(true)).rows.length === 0 && w.world.posts.length === 1);
    const o = counter(); o.mode('open'); o.put(bill('B11o')); o.put(bill('B11p', { at: H('10:02') })); o.world.door = { ok: false }; const go = await o.gate();
    ok('11b fail-open (STALE_DOOR_MODE open): both go at once WITH the mark "Prices not checked" (mode open, tries 1), nothing held, one toast "These bills are sent without it"', go.rows.length === 2 && go.held === 0 && o.queue('B11o').price_basis.stale_unchecked.mode === 'open' && o.queue('B11p').price_basis.stale_unchecked.tries === 1 && /sent without it/.test(o.world.toasts.join()));
    const o2 = counter(); o2.mode('open'); o2.put(bill('B11q')); o2.world.door = { ok: false }; await o2.gate(); const q = o2.queue('B11q'); q._tries = 1; o2.world.stores.queue.set('B11q', q); o2.door([ans({ gst_rate: 12 })]); const g3 = await o2.gate();
    ok('11b (b) accepts: once sent unchecked and the send failed, the bill is not checked again (the body is fixed): it goes again as it was', g3.rows.length === 1 && o2.world.posts.length === 1);
    const chip = c.ctx.staleChipHTML({ no: 'X', price_basis: { stale_unchecked: { tries: 9 } } }, false);
    ok('11 the chip for an unchecked bill is quiet and says "Prices not checked"', /Prices not checked/.test(chip) && !/not sent/.test(chip)); }

  /* 12 a row that was ever tried is not asked; the gate precedes the first send in drain (source order) */
  { const c = counter(); c.put(bill('B12', { extra: { _tries: 1 } })); c.door([ans({ gst_rate: 12 })]); const g = await c.gate();
    ok('12 a row with _tries > 0 is not a candidate: sent as is, no door call', nosOf(g).join() === 'B12' && c.world.posts.length === 0);
    const drain = fnText(PAGE.slice(PAGE.indexOf('  async drain(')), '  async drain(');
    ok('12 in drain the gate runs before the first request is built or sent, and a failed first try can only happen after it', drain.indexOf('staleGateSafe(rows') > 0 && drain.indexOf('staleGateSafe(rows') < drain.indexOf("var url = this.api + '/api/chits/send'") && drain.indexOf('staleGateSafe(rows') < drain.indexOf('fetchBy(url')); }

  /* 13 frozen store */
  { const c = counter({ frozen: true }); c.put(bill('B13')); c.world.frozen = true; let threw = false; try { await c.gate(); } catch (e) { threw = e.code === 'DB_FROZEN'; }
    ok('13 a frozen store REJECTS (DB_FROZEN), nothing is decided from an empty read, nothing posted', threw && c.world.posts.length === 0);
    const d = counter(); d.put(bill('B13b')); d.door([ans({ gst_rate: 12 })]); const orig = d.DB.put; d.DB.put = async () => { const e = new Error('frozen'); e.code = 'DB_FROZEN'; throw e; };
    let threw2 = false; try { await d.gate(); } catch (e) { threw2 = e.code === 'DB_FROZEN'; }
    ok('13 a hold that cannot be written stops the pass with the frozen error (rethrown, never sent unrecorded)', threw2); }

  /* 14 old build / online finish */
  { const c = counter(); const old = bill('B14a'); delete old.price_basis; c.put(old); c.put(bill('B14b', { extra: {} })); const row = c.queue('B14b'); row.price_basis.checked = true; c.world.stores.queue.set('B14b', row);
    c.door([ans({ gst_rate: 12 })]); const g = await c.gate();
    ok('14 a bill with no price_basis (an old build) and a checked:true bill pass untouched, no door call', nosOf(g).sort().join() === 'B14a,B14b' && c.world.posts.length === 0); }

  /* 15 copy and both buttons */
  { const c = counter(); c.put(bill('B15')); c.door([ans({ gst_rate: 12 })]); await c.gate(); await c.ctx.staleAskSoon(); const w = c.world.asked[0];
    ok('15 both buttons on the popup ("Send as sold" / "Not yet"), titled "Price changed", no credit-note exit offered (case 23), neutral words (never "wrong")', w.okWord && w.cancelWord === 'Not yet' && w.title === 'Price changed' && !/credit note|wrong|mistake/i.test(w.message));
    ok('15 the reach line says the owner sends it and that Not yet is only a delay', /Only the owner can send it/.test(w.message) && /only a delay/.test(w.message)); }

  /* 16 later change hides an earlier stale; change then revert after the bill */
  { const c = counter(); c.put(bill('B16')); c.door([ans({ price: 125, changed_at: H('10:30') })]); const g = await c.gate();
    ok('16 09:00 100->120, bill 10:00 at 100, 10:30 120->125: the one stamp reads 10:30 > 10:00 so it is SILENT (a named false negative: the stamp has no history)', nosOf(g).join() === 'B16' && !c.queue('B16').price_basis.stale_ack);
    const d = counter(); d.put(bill('B16b')); d.door([ans({ price: 100, changed_at: H('10:40') })]); const g2 = await d.gate();
    ok('16 a change then a revert after the bill: silent (figures equal, stamp after)', nosOf(g2).join() === 'B16b' && !d.queue('B16b').price_basis.stale_ack); }
  /* 17 change then revert BEFORE the bill */
  { const c = counter(); c.put(bill('B17')); c.door([ans({ price: 100, changed_at: H('09:30') })]); const g = await c.gate();
    ok('17 09:00 to 120, 09:30 back to 100, bill 10:00 at 100: stamp 09:30, figures equal: silent', nosOf(g).join() === 'B17' && !c.queue('B17').price_basis.stale_ack); }

  /* 18 clock skew both ways */
  { const fast = counter({ skewMs: 2 * 3600000 }); fast.put(bill('B18f', { at: H('12:00') })); fast.door([ans({ changed_at: H('11:00') })]); const g = await fast.gate();
    ok('18 a till 2 h FAST (the true 10:00 bill reads 12:00 on its clock; change at 11:00 on the server): with the offset the answer showed it is silent, not a false popup', nosOf(g).join() === 'B18f' && !fast.queue('B18f').price_basis.stale_ack && g.held === 0);
    const fast2 = counter({ skewMs: 2 * 3600000 }); fast2.put(bill('B18g', { at: H('12:00') })); fast2.door([ans({ changed_at: H('09:00') })]); const g2 = await fast2.gate();
    ok('18 the same fast till, change at 09:00 (before the true 10:00): still stale, sent as sold with the ack', nosOf(g2).join() === 'B18g' && fast2.queue('B18g').price_basis.stale_ack.reason === 'price_moved');
    const slow = counter({ skewMs: -2 * 3600000 }); slow.put(bill('B18s', { at: H('08:00') })); slow.door([ans({ changed_at: H('09:00') })]); const g3 = await slow.gate();
    ok('18 a till 2 h SLOW (the true 10:00 bill reads 08:00): with the offset the change at 09:00 is found, not missed', nosOf(g3).join() === 'B18s' && slow.queue('B18s').price_basis.stale_ack && slow.queue('B18s').price_basis.stale_ack.reason === 'price_moved');
    const near = counter(); near.put(bill('B18n', { at: H('10:00') })); near.door([ans({ changed_at: H('10:01') })]); const g4 = await near.gate();
    ok('18 the 2-minute tolerance leans toward a popup only: a change 1 minute after the bill counts (10:01 vs 10:00), 5 minutes after does not', near.queue('B18n').price_basis.stale_ack && (() => { const f = counter(); f.put(bill('B18m')); f.door([ans({ changed_at: H('10:05') })]); return true; })());
    const far = counter(); far.put(bill('B18p')); far.door([ans({ changed_at: H('10:05') })]); await far.gate();
    ok('18 a change 5 minutes after the bill is silent', !far.queue('B18p').price_basis.stale_ack); }

  /* 19 null changed_at */
  { const c = counter(); c.put(bill('B19a')); c.door([ans({ changed_at: null })]); const g = await c.gate();
    ok('19 column absent (changed_at null) on a plain row whose figures differ: sent as sold, NO ack, ONE toast "Price changes could not be checked yet."', nosOf(g).join() === 'B19a' && !c.queue('B19a').price_basis.stale_ack && c.world.toasts.join() === 'Price changes could not be checked yet.');
    const d = counter(); d.put(bill('B19b')); d.door([(() => { const r = ans(); delete r.changed_at; return r; })()]); await d.gate();
    ok('19 an older api that sends no changed_at key at all is the same null case (one toast)', d.world.toasts.join() === 'Price changes could not be checked yet.' && !d.queue('B19b').price_basis.stale_ack);
    const e = counter(); e.put(bill('B19c', { item: 'src:brand:pen', name: 'Brand Pen' })); e.door([ans({ item_id: 'src:brand:pen', name: 'Brand Pen', changed_at: null })]); await e.gate();
    ok('19 a network (src:) line is decided by its VALUES: price 100 -> 120 with no stamp = price_moved, acked, no toast', e.queue('B19c').price_basis.stale_ack && e.queue('B19c').price_basis.stale_ack.reason === 'price_moved' && e.world.toasts.length === 0);
    const f = counter(); f.put(bill('B19d')); f.door([ans({ changed_at: null, price: 100 })]); await f.gate();
    ok('19 null stamp but equal figures: nothing to say, no toast', f.world.toasts.length === 0); }

  /* 20 never mid-sale */
  { for (const how of ['cart', 'ask', 'lock', 'dialog']) {
      const c = counter({ cart: how === 'cart' ? [{ item_id: 'RICE' }] : [], askOpen: how === 'ask' ? () => 1 : null, lock: how === 'lock' ? { reason: 'idle' } : null, dialog: how === 'dialog' });
      c.put(bill('B20')); c.door([ans({ gst_rate: 12 })]); await c.gate(); const r = await c.ctx.staleAskSoon();
      ok('20 busy (' + how + '): the popup is NOT raised; the chip is there; the hold waits unasked', r === false && c.world.asked.length === 0 && c.queue('B20')._price_hold.asked === false && /Price changed: not sent/.test(c.ctx.staleChipHTML(c.queue('B20'), true))); }
    const idle = counter(); idle.put(bill('B20i')); idle.door([ans({ gst_rate: 12 })]); await idle.gate(); await idle.ctx.staleAskSoon();
    ok('20 at the next idle moment it is raised', idle.world.asked.length === 1); }

  /* 21 drain with an unanswered popup: 19 sent, 1 held, the count is right */
  { const c = counter(); for (let i = 1; i <= 19; i++) c.put(bill('N' + String(i).padStart(2, '0'), { item: 'PEN', name: 'Pen', at: H('10:0' + (i % 10)) })); c.put(bill('HELD'));
    c.door([ans({ gst_rate: 12 }), ans({ item_id: 'PEN', name: 'Pen', price: 100, changed_at: H('07:00') })]); const g = await c.gate();
    ok('21 20 queued, one held: the gate hands drain 19 to send and the held one stays queued (never posted)', g.rows.length === 19 && g.held === 1 && !nosOf(g).includes('HELD') && !!c.queue('HELD'));
    const waiting = c.ctx.sendableRows(await c.DB.all('queue')).length;
    ok('21 the waiting count still counts the held bill ONCE (20 rows = 20, the held one included, no double count)', waiting === 20 && !/_price_hold[^\n]{0,40}queued\s*\+/.test(PAGE));
    const drain = fnText(PAGE.slice(PAGE.indexOf('  async drain(')), '  async drain(');
    ok('21 the popup is raised AFTER the run: no staleAsk inside the send loop, only via setTimeout in the finally, after _busy is released', !/await staleAsk/.test(drain) && /this\._busy = false;\n\s+if \(priceHeld\) \{ try \{ setTimeout\(staleAskLater, 0\)/.test(drain)); }

  /* 22 every sender is gated */
  { const c = counter(); c.put(bill('HELD22', { extra: { _price_hold: { at: H('10:50'), reason: 'rate_moved', lines: [], asked: true } } })); c.put(bill('B22', { extra: { _nextAt: Date.now() + 99999 } }));
    const g = await c.gate(); ok('22 a held row is never handed to a send, however it is asked (the gate drops it before any request)', !nosOf(g).includes('HELD22'));
    const stores = c.world.stores; await c.ctx.qReady('Send now'); ok('22 qReady (Send now) clears _nextAt only: the hold stays', stores.queue.get('HELD22')._price_hold && stores.queue.get('HELD22')._price_hold.reason === 'rate_moved' && !stores.queue.get('B22')._nextAt);
    ok('22 there is ONE place a sale bill is posted (drain) and every sender reaches it: sendNow, drainSoon, a key-change refresh, "send this bill", the 20 s tick all call HOST.drain', (PAGE.match(/\/api\/chits\/send'/g) || []).length === 1 && /async function sendNow\(\)/.test(PAGE) && /HOST\.drain\(\{ force: true \}\)/.test(PAGE)); }

  /* 23 credit note against a held bill: no exit offered */
  { const c = counter(); c.put(bill('B23')); c.door([ans({ gst_rate: 12 })]); await c.gate(); await c.ctx.staleAskSoon();
    ok('23 a credit note against a held, unsent bill waits behind it (WAITS_FOR_BILL): the popup offers NO cancel or credit-note exit, only Send as sold / Not yet', !/credit|cancel|void/i.test(c.world.asked[0].message + c.world.asked[0].okWord + c.world.asked[0].cancelWord) && /WAITS_FOR_BILL = 'BILL_NOT_RECORDED'/.test(PAGE)); }

  /* 24 250 ids -> two calls */
  { const c = counter(); const lines = []; const rows = [];
    for (let i = 0; i < 250; i++) { lines.push({ item_id: 'I' + i, name: 'P' + i, qty: 1, price: 10, list_price: 10, mods: null, gst_rate: 18 }); rows.push(ans({ item_id: 'I' + i, name: 'P' + i, price: 10, changed_at: H('07:00') })); }
    const b = bill('B24'); b.lines = lines; c.put(b); c.door(rows); const g = await c.gate();
    ok('24 250 products: two door calls (200 + 50), both noQueue, every answer joined, the bill goes (nothing moved)', c.world.posts.length === 2 && c.world.posts[0].body.item_ids.length === 200 && c.world.posts[1].body.item_ids.length === 50 && c.world.posts.every((p) => p.opts.noQueue) && nosOf(g).join() === 'B24');
    const d = counter(); const b2 = bill('B24b'); b2.lines = lines; d.put(b2); d.door((rows.map((r, i) => (i === 249 ? Object.assign({}, r, { price: 12, changed_at: H('09:00') }) : r)))); const g2 = await d.gate();
    ok('24 a move in the SECOND chunk is found (product 250: 10.00 -> 12.00): acked as price_moved', d.queue('B24b').price_basis.stale_ack && d.queue('B24b').price_basis.stale_ack.lines[0].item_id === 'I249' && nosOf(g2).join() === 'B24b'); }

  /* 25 a hold put racing another writer of the same row */
  { const c = counter(); c.put(bill('B25')); c.door([ans({ gst_rate: 12 })]);
    const rows = c.ctx.sendableRows(await c.DB.all('queue'));
    const stale = clone(rows[0]);                         /* the copy drain read a moment ago */
    const q = c.world.stores.queue.get('B25'); q._why = 'the line dropped'; q._tries = 0; c.world.stores.queue.set('B25', q);   /* another writer got there first */
    const g = await c.ctx.staleGate(rows, true);
    ok('25 the mark re-reads the row by key: the other writer\'s _why survives and the hold is added to the FRESH copy', c.queue('B25')._why === 'the line dropped' && !!c.queue('B25')._price_hold);
    ok('25 the held row object is not handed back to drain, so no later put of the older copy can undo the hold', g.rows.length === 0 && stale._price_hold === undefined && c.queue('B25')._price_hold.reason === 'rate_moved'); }

  /* 26 a malformed row cannot stop the queue (review 1) */
  { const c = counter(); const bad1 = bill('M1'); bad1.lines = [null]; const bad2 = bill('M2'); bad2.price_basis.kept = 'not a list'; const good = bill('G1', { item: 'PEN', name: 'Pen' });
    c.put(bad1); c.put(bad2); c.put(good); c.door([ans({ item_id: 'PEN', name: 'Pen', price: 100, changed_at: H('07:00') }), ans()]);
    const g = await c.gate();
    ok('26 a bill with a null line and a bill whose kept list is not a list are each HELD with the reason "unreadable" (queue row and bill row, asked false), the good bill goes, nothing thrown', g.rows.map((r) => r.no).join() === 'G1' && g.held === 2 && ['M1', 'M2'].every((n) => c.queue(n)._price_hold && c.queue(n)._price_hold.reason === 'unreadable' && c.queue(n)._price_hold.why.length > 0 && c.queue(n)._price_hold.asked === false && c.bills(n)._price_hold));
    const chipM1 = c.ctx.staleChipHTML(c.queue('M1'), true);
    await c.ctx.staleAskSoon();
    ok('26 the popup says why in words (values, no total), the chip says "Not sent: prices not checked", and the owner PIN still lets it go', /its prices could not be checked \(/.test(c.world.asked[0].message) && /Not sent: prices not checked/.test(chipM1) && c.queue('M1').price_basis.stale_ack && c.queue('M1').price_basis.stale_ack.reason === 'unreadable' && c.queue('M1').price_basis.stale_ack.via === 'send_as_sold');
    const n = counter(); n.put(bill('N1')); n.door([ans()]); vm.runInContext('staleRead = async function(){ throw new Error("boom"); }', n.ctx);
    const rows = n.ctx.sendableRows(await n.DB.all('queue')); const safe = await n.ctx.staleGateSafe(rows, true);
    ok('26 the gate itself failing (not one bill) never stops the queue: staleGateSafe sends every open bill as sold with ONE toast, and a held bill stays out', safe.rows.length === 1 && n.world.toasts.join() === 'Prices could not be checked. These bills are sent as sold.');
    const z = counter({ frozen: true }); let rethrown = false; try { await z.ctx.staleGateSafe([bill('Z1')], true); } catch (e) { rethrown = e.code === 'DB_FROZEN' || true; }
    ok('26 in drain the gate is called through the safe wrapper (source)', /staleGateSafe\(rows, opts && opts\.force\)/.test(PAGE) && !/await staleGate\(rows\)/.test(PAGE)); }

  /* 27 a product soft-removed after the sale does not hold the bill (review 4) */
  { const c = counter(); c.put(bill('R1')); c.door([ans({ active: false, status: 'available', price: 100, changed_at: H('07:00') })]); const g = await c.gate();
    ok('27 soft-removed AFTER the sale (is_active false, nothing stamps it): the bill goes as sold, no hold, no ack, no popup', g.rows.length === 1 && g.held === 0 && !c.queue('R1')._price_hold && !c.queue('R1').price_basis.stale_ack && c.world.asked.length === 0);
    const d = counter(); d.put(bill('R2')); d.door([ans({ active: false, status: 'retired', changed_at: H('09:00') })]); const g2 = await d.gate();
    ok('27 the same with a stamp that falls inside the window: still no hold (a removal cannot be dated, so it is never a reason to hold)', g2.rows.length === 1 && !d.queue('R2')._price_hold);
    const e = counter(); e.put(bill('R3')); e.door([ans({ status: 'retired', price: 100, changed_at: H('09:00') })]); await e.gate();
    ok('27 a RETIRED product (status moves the stamp, still active) sold after 09:00 IS held as not_sold (unchanged)', e.queue('R3')._price_hold && e.queue('R3')._price_hold.reason === 'not_sold'); }

  /* 28 the rate truth is the catalogue's resolved rate: the law pack's dated band is CTR-251 (review 3), stated not hidden */
  check('28 the deferred rate truth is stated in the design and in the backlog, not claimed: no law-pack band in the gate', () => {
    assert.ok(!/asOf|CBRegulation|dated band/.test(fnText(PAGE, 'function staleLineVerdict(') + fnText(PAGE, 'function staleRowVerdict(')));
    const design = fs.readFileSync(path.join(API, 'docs', 'critique', 'CTR-243-DESIGN.md'), 'utf8');
    assert.match(design, /Rate truth: DEFERRED to CTR-251/);
  });

  /* the build stamp moved, so a stale page reloads (pageStale) */
  check('TILL_BUILD is bumped for this change (pageStale reloads a counter on the old page)', () => assert.match(PAGE, /var TILL_BUILD = '2026-11-13\.ctr243';/));

  console.log('\n' + (fail ? '  FAIL ' + fail + ' failed' : '  ok ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

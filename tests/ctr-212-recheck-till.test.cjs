/**
 * tests/ctr-212-recheck-till.test.cjs — CTR-212 S2a: the counter reads the catalogue again before a bill is finished, and the engine prices it ONCE.
 * @type regression
 * OWNS      the proof, through the counter page's OWN functions (lifted from tools/tally-connector/till.html) over the REAL tax engine (lib/tax.js), that
 *           recheckBeforeBill / recheckAfterUnpark: do nothing when a check is not due (parked 11 h 59 m, setting not answered: 236.00 kept), check a bill parked 12 h 01 m (popup 236.00 to 283.20),
 *           check every bill when the owner said yes (parked 1 minute, price 100 to 120: 283.20 shown), refuse Keep on a rate move (224.00 shown, no Keep, no PIN asked),
 *           refuse Keep without the owner PIN and record it with the PIN (236.00 kept, price_basis.kept), never bill a deleted or soft-removed product (Remove or Go back only),
 *           catch a rate moved through a slab edit (no Keep) and a brand-published price (a network line), sell on when the door fails (recheck_failed) or the line is down (offline),
 *           and work on the price-includes-tax path (100.00 incl at 18%: 100.00, taxable 84.74, tax 15.26; price 118: 118.00, taxable 100.00, tax 18.00).
 *           HAND FIGURES (typed here, the engine is only read): 2 x 100.00 excl at 18 intra = 200.00 + 18.00 + 18.00 = 236.00 (23600 minor); price 120: 240.00 + 21.60 + 21.60 = 283.20 (28320);
 *           rate 12: 200.00 + 12.00 + 12.00 = 224.00 (22400). Breaks once: finish() without the recheck call, and the apply step without its engine run.
 * CALLED BY scripts/guards.cjs · CI. No database, no network, no browser.
 * FLOW      cart (price, rate facts) + the door's answer → recheck* functions → popup choice → cart → billMoney() (CBTax.determine, once) → net, taxable, tax
 *   node tests/ctr-212-recheck-till.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
/* the counter's own engine bundle (what /engine/tax.js serves), in a page-like global: CBTax with .slab, the registry and the packs */
const ENGINE = { console, Math, Date, JSON, Object, Array, String, Number, Map, Set, Error, RegExp, isNaN, parseFloat, Intl };
ENGINE.window = ENGINE; ENGINE.self = ENGINE;
vm.createContext(ENGINE); vm.runInContext(fs.readFileSync(path.join(API, 'lib', 'tax-engine.browser.js'), 'utf8'), ENGINE);
const CBTAX = ENGINE.CBTax, REGULATION = ENGINE.CBRegulation;
const MONEY = require(path.join(API, 'lib', 'money'));
const r2 = (n) => MONEY.round(Number(n) || 0);

const PAGE = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
function fnText(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) throw new Error(sig + ' is gone from the source - this test is measuring nothing');
  const end = src.indexOf('\n}\n', at);
  return src.slice(at, end + 2);
}
const LIFT = ['var QUIET_MAX = 200, QUIET = [];', 'function cbQuiet(', 'function billMoney(', 'function billWhen(', 'function engineReadyFor(', 'function tzOpt(', 'function shopTz(', 'function shopPack(', 'function docCountry(', 'function shopDayOf(', 'function bandWordsOf(', 'function stampBands(', 'function moneyOf(', 'function noCountryMoney(', 'function moneyStop(', 'function walkInNote(',
  'function taxIncluded(', 'function taxInputOf(', 'function lineOf(', 'function pricedAt(', 'function price(',
  'var RECHECK_FIELDS', 'function recheckSetting(', 'function parkHoursOf(', 'function parkedTooLong(', 'function cartParkedAt(', 'function recheckDue(', 'async function recheckRead(',
  'function recheckGone(', 'function recheckContext(', 'function recheckRateOf(', 'function recheckBaseOf(', 'function recheckLineChange(', 'function recheckPriceMove(', 'function recheckRateMove(', 'function recheckUnitMove(', 'function recheckChanges(', 'function recheckRefresh(',
  'function recheckApply(', 'function recheckTotal(', 'function recheckTrial(', 'function recheckWords(', 'async function recheckAsk(', 'async function recheckKeep(', 'function recheckStamp(',
  'function recheckRemoveGone(', 'async function recheckResolve(', 'function recheckBasis(', 'function recheckKeptList(', 'async function recheckBeforeBill(', 'async function recheckAfterUnpark('];

const SLAB18 = { definition_id: 'gst-18', kind: 'tax', name: 'GST 18%', rate: 18 };
const itemData = (rate) => ({ name: 'Pen', gst_rate: rate });
const line = (o) => Object.assign({ key: 'A', item_id: 'A', name: 'Pen', unit: 'piece', price: 100, qty: 2, hsn: '9608', mods: null, item_data: itemData(18) }, o || {});
const row = (o) => Object.assign({ item_id: 'A', name: 'Pen', found: true, checked: true, active: true, status: 'available', price: 100, mrp: null, hsn: '9608', gst_rate: 18, stamp: null }, o || {});
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

/** a counter page: its own recheck functions, the real engine, one cart; `world` says what the door answers and what the cashier presses */
function counter(o) {
  const world = Object.assign({ inclusive: false, setting: null, line: true, door: { ok: true, items: [row()] }, sure: [], pin: true, asked: [], kept: false, posts: 0 }, o);
  const els = {}; const el = () => ({ value: '', textContent: '', className: '', innerHTML: '', classList: { remove() {}, add() {} } });
  const ctx = {
    window: { CBRegulation: REGULATION }, CBRegulation: REGULATION, console, Object, Array, String, Number, JSON, Math, Date, Promise, isNaN,
    CBTax: CBTAX, CBUnits: require('../lib/units'), MONEY: () => MONEY, r2, esc: (v) => String(v == null ? '' : v), money: (v) => (Number(v) || 0).toFixed(2),
    S: { shop: { name: 'Tally Test', gstin: '33AABCK1234F1Z6', state_code: '33', country: 'IN', reg_type: 'regular' }, slabs: [SLAB18], categories: [], face: {}, at: '2026-11-08T05:00:00.000Z', offers: [],
         policy: { price_includes_tax: world.inclusive ? 'yes' : 'no', recheck_prices: world.setting, park_max_hours: 12 } },
    CART: (world.cart || [line()]).map((c) => Object.assign({}, c)), BILL_DELIVERY: null,
    packSplitsByState: () => true, shopTax: () => ({ charges: true, kind: 'tax' }), shopCur: () => 'INR', custKnown: () => null, schemeWord: () => 'GST',
    modAdd: () => 0, netKey: (k) => k, EV: null,
    paintCartRow: () => true, paintCart() {}, paintTotals() {}, paintQuick() {}, paintHits() {}, paintDayPill() {}, draftSave() {},
    toastLine(t) { world.note = t; }, lineUp: () => world.line,
    sure: async (message, okWord, title, cancelWord) => { world.asked.push({ message, okWord, title, cancelWord }); return world.sure.length ? world.sure.shift() : true; },
    ownerPinAsk: async () => { world.pinAsked = (world.pinAsked || 0) + 1; return world.pin ? { by: { id: 'owner-1', name: 'Athi' } } : null; },
    HOST: { tillPost: async (p, body) => { world.posts++; world.lastPost = { p, body }; if (world.door === 'throws') throw new Error('line dropped'); return world.door; } },
    document: { getElementById: () => el(), querySelectorAll: () => [] },
  };
  ctx.window.CBTax = CBTAX;
  vm.createContext(ctx);
  vm.runInContext(LIFT.map((s) => fnText(PAGE, s)).join('\n'), ctx);
  return { ctx, world, net: () => vm.runInContext('price(), billMoney()', ctx) };
}
const minor = (major) => Math.round(Number(major) * 100);
const moneyOf = (c) => { const m = c.net(); return { net: minor(m.net), base: minor(m.base), tax: minor(m.tax) }; };

(async () => {
  console.log('\n== CTR-212 S2a - the counter reads prices again before a bill is finished ==\n');

  /* the baseline: the hand figure through the real engine path */
  let c = counter({});
  ok('baseline: 2 x 100.00 excl at 18% intra is 236.00 (23600 minor: taxable 20000, tax 3600)', (() => { const m = moneyOf(c); return m.net === 23600 && m.base === 20000 && m.tax === 3600; })(), JSON.stringify(moneyOf(c)));

  /* 1 · parked 11 h 59 m, setting not answered, price 100 to 120: NO recheck, finishes at 236.00 */
  c = counter({ setting: null, door: { ok: true, items: [row({ price: 120 })] } });
  c.ctx.CART.forEach((l) => { l.parked_at = minutesAgo(11 * 60 + 59); });
  let basis = await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('parked 11 h 59 m, setting not answered, price 100 to 120: no recheck (the door is not called), 236.00 kept, reason snapshot_fresh', c.world.posts === 0 && moneyOf(c).net === 23600 && basis.reason === 'snapshot_fresh' && basis.checked === false, JSON.stringify(basis));

  /* 2 · parked 12 h 01 m, same: popup 236.00 to 283.20, then 283.20 */
  c = counter({ setting: null, door: { ok: true, items: [row({ price: 120 })] } });
  c.ctx.CART.forEach((l) => { l.parked_at = minutesAgo(12 * 60 + 1); });
  basis = await vm.runInContext('recheckBeforeBill()', c.ctx);
  const m2 = moneyOf(c);
  ok('parked 12 h 01 m, setting not answered: the door is asked once with the cart ids, the popup says 236.00 → 283.20, and the bill is 283.20 (28320: taxable 24000, tax 4320)',
    c.world.posts === 1 && c.world.lastPost.p === '/api/till/recheck' && c.world.lastPost.body.item_ids.join() === 'A' && /236\.00 → 283\.20/.test(c.world.asked[0].message) && m2.net === 28320 && m2.base === 24000 && m2.tax === 4320, JSON.stringify([c.world.asked, m2]));
  ok('the basis says it was checked (reason recheck, parked_at kept, snapshot_at carried) and a checked line is no longer parked', basis.checked === true && basis.reason === 'recheck' && basis.parked_at && basis.snapshot_at === '2026-11-08T05:00:00.000Z' && !c.ctx.CART[0].parked_at, JSON.stringify(basis));

  /* 2b · CAT-264b: a unit move is shown (quantity stays), a spelling of the same unit is not (CBUnits.sameUnit folds case) */
  c = counter({ setting: 'on', door: { ok: true, items: [row({ unit: 'kg' })] } });
  await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('unit piece to kg, price same: popup says sold per piece → per kg and the quantity stays 2, bill 236.00', c.world.asked.length === 1 && /sold per piece → per kg [(]the quantity stays 2[)]/.test(c.world.asked[0].message) && c.world.asked[0].cancelWord === 'Go back' && moneyOf(c).net === 23600);
  c = counter({ setting: 'on', cart: [line({ unit: 'Kg' })], door: { ok: true, items: [row({ unit: 'kg' })] } });
  await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('unit Kg to kg: no popup (the same unit, hand: nothing moved), 236.00', c.world.asked.length === 0 && moneyOf(c).net === 23600);
  /* 3 · setting on, parked 1 minute, 100 to 120: 283.20 shown */
  c = counter({ setting: 'on', door: { ok: true, items: [row({ price: 120 })] } });
  c.ctx.CART.forEach((l) => { l.parked_at = minutesAgo(1); });
  await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('setting on, parked 1 minute, price 100 to 120: popup 236.00 → 283.20 and the bill is 283.20', /236\.00 → 283\.20/.test(c.world.asked[0].message) && moneyOf(c).net === 28320);
  c = counter({ setting: 'on', door: { ok: true, items: [row({ price: 120 })] } });
  await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('setting on and the bill was never parked: still checked (every bill)', c.world.posts === 1 && moneyOf(c).net === 28320);
  c = counter({ setting: 'off', door: { ok: true, items: [row({ price: 120 })] } });
  await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('setting answered off and never parked: not checked (the owner said no), 236.00', c.world.posts === 0 && moneyOf(c).net === 23600);

  /* 4 · rate 18 to 12: 224.00 shown, no Keep, no PIN */
  c = counter({ setting: 'on', door: { ok: true, items: [row({ gst_rate: 12 })] }, sure: [false] });
  basis = await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('rate 18 → 12: the popup says 236.00 → 224.00 and offers NO Keep (the cancel word is Go back), pressing it asks for no PIN and bills nothing (false), the cart is untouched',
    /236\.00 → 224\.00/.test(c.world.asked[0].message) && c.world.asked[0].cancelWord === 'Go back' && basis === false && !c.world.pinAsked && moneyOf(c).net === 23600, JSON.stringify(c.world.asked));
  c = counter({ setting: 'on', door: { ok: true, items: [row({ gst_rate: 12 })] }, sure: [true] });
  await vm.runInContext('recheckBeforeBill()', c.ctx);
  const m4 = moneyOf(c);
  ok('rate 18 → 12 accepted: 224.00 (22400: taxable 20000, tax 2400)', m4.net === 22400 && m4.base === 20000 && m4.tax === 2400, JSON.stringify(m4));

  /* 5 · a rate moved through a slab edit (the product row is unchanged): no Keep, 224.00 */
  c = counter({ setting: 'on', door: { ok: true, items: [row({ gst_rate: 18 })], slabs: [{ definition_id: 'gst-18', kind: 'tax', name: 'GST 18%', rate: 12 }], categories: [], face: {} },
    cart: [line({ item_data: { name: 'Pen', tax_slab: 'gst-18' } })] });
  c.ctx.S.slabs = [SLAB18];
  c.world.door.items[0].tax_slab = 'gst-18'; c.world.door.items[0].gst_rate = null;
  c.world.sure = [false];
  basis = await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('a rate changed by a SLAB edit (no write to the product row) is caught by value: popup 236.00 → 224.00, no Keep', /236\.00 → 224\.00/.test((c.world.asked[0] || {}).message || '') && c.world.asked[0].cancelWord === 'Go back' && basis === false, JSON.stringify(c.world.asked));

  /* 6 · deleted, soft-removed, retired: Remove or Go back only; never billed */
  for (const [label, answer] of [['hard-deleted', row({ found: false })], ['soft-removed (inactive)', row({ active: false })], ['retired', row({ status: 'retired' })]]) {
    c = counter({ setting: 'on', door: { ok: true, items: [answer] }, sure: [false] });
    basis = await vm.runInContext('recheckBeforeBill()', c.ctx);
    ok(label + ': Remove or Go back only (cancel word Go back, ok word Remove them); Go back leaves the cart whole and bills nothing', c.world.asked[0].okWord === 'Remove them' && c.world.asked[0].cancelWord === 'Go back' && basis === false && c.ctx.CART.length === 1 && !c.world.pinAsked);
    c = counter({ setting: 'on', door: { ok: true, items: [answer] }, sure: [true] });
    basis = await vm.runInContext('recheckBeforeBill()', c.ctx);
    ok(label + ': Remove them takes the line off, so it is never billed (the bill is empty of it)', c.ctx.CART.length === 0 && basis && basis.reason === 'recheck');
  }

  /* 7 · a brand-published price (a network line the store follows): popup 236.00 → 283.20 */
  c = counter({ setting: 'on', cart: [line({ key: 'src:brand:pen', item_id: 'src:brand:pen' })], door: { ok: true, items: [row({ item_id: 'src:brand:pen', price: 120 })] } });
  await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('a brand-published price on a network line: the popup says 236.00 → 283.20 and the bill is 283.20', /236\.00 → 283\.20/.test((c.world.asked[0] || {}).message || '') && moneyOf(c).net === 28320);
  c = counter({ setting: 'on', cart: [line({ item_id: 'src:brand:pen' })], door: { ok: true, items: [{ item_id: 'src:brand:pen', found: null, checked: false, why: 'network_not_read' }] } });
  await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('a line the door did not check (checked:false) is left as it was: no popup, 236.00', c.world.asked.length === 0 && moneyOf(c).net === 23600);

  /* 8 · Keep as quoted: owner PIN, recorded; without the PIN it does not keep */
  c = counter({ setting: 'on', door: { ok: true, items: [row({ price: 120 })] }, sure: [false], pin: true });
  basis = await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('price 100 → 120, Keep as quoted offered (cancel word Keep as quoted), the owner PIN is asked, 236.00 stays and price_basis.kept records who, when and why "price kept"',
    c.world.asked[0].cancelWord === 'Keep as quoted' && c.world.pinAsked === 1 && moneyOf(c).net === 23600 && basis.kept && basis.kept[0].by === 'owner-1' && basis.kept[0].why === 'price kept' && basis.kept[0].carried === 100 && basis.kept[0].current === 120, JSON.stringify(basis));
  await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('a second check on the same bill does not ask again about the price that was kept (it is the same 120), 236.00', c.world.asked.length === 1 && c.world.pinAsked === 1 && moneyOf(c).net === 23600);
  c = counter({ setting: 'on', door: { ok: true, items: [row({ price: 120 })] }, sure: [false], pin: false });
  basis = await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('Keep without the owner PIN: nothing is kept and nothing is billed (false), the cart is as it was', basis === false && moneyOf(c).net === 23600 && !c.ctx.CART[0].kept);

  /* 9 · the door fails or the line is down: the sale goes on, never blocked */
  c = counter({ setting: 'on', door: { ok: false, why: 'ChitBridge answered 500' } });
  basis = await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('the door answers 500: the bill sells at 236.00, reason recheck_failed, one visible line on screen, nothing thrown', basis.reason === 'recheck_failed' && basis.checked === false && moneyOf(c).net === 23600 && /could not be checked/.test(c.world.note || ''));
  c = counter({ setting: 'on', door: 'throws' });
  basis = await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('the call throws (the line drops): treated the same, recheck_failed, 236.00', basis.reason === 'recheck_failed' && moneyOf(c).net === 23600);
  c = counter({ setting: 'on', line: false });
  basis = await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('offline and a check is due: the door is not called, the sale goes on at 236.00, reason offline (S2b adds the stale confirm)', basis.reason === 'offline' && c.world.posts === 0 && moneyOf(c).net === 23600);

  /* 10 · unpark: marks the lines with when they were parked; checks at once when due and online */
  c = counter({ setting: null, door: { ok: true, items: [row({ price: 120 })] } });
  await vm.runInContext('recheckAfterUnpark(' + JSON.stringify(minutesAgo(13 * 60)) + ')', c.ctx);
  ok('unpark of a bill parked 13 h: the popup says 236.00 → 283.20 and the bill is 283.20 (must-path, setting not answered)', c.world.posts === 1 && /236\.00 → 283\.20/.test(c.world.asked[0].message) && moneyOf(c).net === 28320);
  c = counter({ setting: null, line: false });
  await vm.runInContext('recheckAfterUnpark(' + JSON.stringify(minutesAgo(13 * 60)) + ')', c.ctx);
  ok('unpark offline: allowed, the lines carry parked_at, finish applies the same timer (R1: a bill finished by any path, not only unpark)', c.world.posts === 0 && !!c.ctx.CART[0].parked_at && vm.runInContext('recheckDue()', c.ctx) === true);
  c = counter({ setting: null, cart: [line({ parked_at: minutesAgo(13 * 60) })], door: { ok: true, items: [row({ price: 120 })] } });
  await vm.runInContext('recheckBeforeBill()', c.ctx);
  ok('a cart restored with parked_at (restore or import of p.at, no unpark) is checked at finish all the same: 283.20', c.world.posts === 1 && moneyOf(c).net === 28320);

  /* 11 · the price-includes-tax path (hand: 100.00 incl at 18, intra: each head round(100 x 9/118) = 7.63, tax 15.26, taxable 84.74) */
  c = counter({ inclusive: true, cart: [line({ qty: 1, price: 100 })], setting: 'on', door: { ok: true, items: [row({ price: 100 })] } });
  let mi = moneyOf(c);
  ok('inclusive 100.00 at 18% (hand): total 100.00, taxable 84.74, tax 15.26 (V08-04 rule)', mi.net === 10000 && mi.base === 8474 && mi.tax === 1526, JSON.stringify(mi));
  c = counter({ inclusive: true, cart: [line({ qty: 1, price: 100 })], setting: 'on', door: { ok: true, items: [row({ price: 118 })] } });
  await vm.runInContext('recheckBeforeBill()', c.ctx);
  mi = moneyOf(c);
  ok('inclusive, price 100 → 118 through the recheck (hand): total 118.00, taxable 100.00, tax 18.00 (118 x 18/118)', /100\.00 → 118\.00/.test(c.world.asked[0].message) && mi.net === 11800 && mi.base === 10000 && mi.tax === 1800, JSON.stringify([c.world.asked, mi]));

  /* 12 · the page: finish() takes the basis before the number, and stores it */
  const finishText = fnText(PAGE, 'async function finish(');
  ok('finish() reads the catalogue again BEFORE billMoney() and stores price_basis on the bill and the chit body', finishText.indexOf('recheckBeforeBill()') > 0 && finishText.indexOf('recheckBeforeBill()') < finishText.indexOf('var m = billMoney();') && /price_basis: basis/.test(finishText) && /price_basis: bill\.price_basis/.test(PAGE));
  ok('unpark() calls recheckAfterUnpark with the moment it was parked', /recheckAfterUnpark\(p\.at\)/.test(fnText(PAGE, 'function unpark(')));
  ok('no copy of the timer in the till: the 12 comes from the snapshot policy only', !/PARK_MAX_HOURS\s*=/.test(PAGE) && /S\.policy\.park_max_hours/.test(PAGE));

  /* BREAKS: take the recheck out and the 283.20 case must fail; take the engine run out of the trial and the popup shows no after */
  const broken = PAGE.replace('var basis = await recheckBeforeBill(); if (basis === false) return { ok: false };', 'var basis = null;');
  ok('break 1: finish() without the recheck call no longer holds the source pin (the 283.20 case would fail)', !/recheckBeforeBill\(\)/.test(fnText(broken, 'async function finish(')));
  const brokenTrial = PAGE.replace('var after = recheckTotal(true, changes);', 'var after = before;');
  ok('break 2: a trial that never runs the engine on the new facts shows after == before (the popup would say 236.00 → 236.00)', /var after = before;/.test(fnText(brokenTrial, 'function recheckTrial(')));

  console.log('\n' + (fail ? '  FAIL ' + fail + ' failed' : '  ok ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

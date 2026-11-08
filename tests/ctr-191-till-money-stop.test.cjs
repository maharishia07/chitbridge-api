/**
 * tests/ctr-191-till-money-stop.test.cjs — CTR-191 (ACC-206 PR H): THE COUNTER STOPS A BILL WHOSE MONEY DOES NOT ADD UP.
 *
 * OWNS      billMoney().stop (read off the engine's invoice._cb.bridge, no sum of its own) · the warn row on the bill · moneyStopAsk (owner PIN + a typed
 *           reason → business_json.money_override) · the chit carrying it (chitOf) · the "Money checked by" slip foot; and that the server's door
 *           (lib/finance-terms overrideBy, the one helper) accepts exactly what the till writes from a counter key.
 * CALLED BY scripts/guards.cjs · by hand: node tests/ctr-191-till-money-stop.test.cjs
 * FLOW      till.html functions -> vm + lib/tax (real engine; one run has its bridge broken on purpose) -> m.stop -> finish() -> body.money_override -> chitOf
 * CARD      counter/billing-and-the-bill
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const HTML = fs.readFileSync(process.env.TILL_FILE || path.join(__dirname, '../tools/tally-connector/till.html'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = async (name, fn) => { try { await fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };
/** a function's source by brace count; '' when it is not there (so a missing function fails the assertion, not the load) */
function grab(name) {
  let at = HTML.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = HTML.indexOf('\nasync function ' + name + '(');
  if (at < 0) return '';
  let i = HTML.indexOf('{', at), depth = 0;
  for (; i < HTML.length; i++) { if (HTML[i] === '{') depth++; else if (HTML[i] === '}' && --depth === 0) break; }
  return HTML.slice(at, i + 1);
}
const CBTAX = require('../lib/tax.js'), PMAP = require('../lib/profile-map'), MONEY = require('../lib/money');
const BROKEN = { ok: false, step: 'total', unexplained_minor: 500, words: 'Does not add up at total: 5.00 unexplained.' };
/** the real engine; `broken` makes its bridge say the money does not add up (what a hand-edited offer amount would cause) */
function engine(broken) {
  if (!broken) return CBTAX;
  return Object.assign({}, CBTAX, { determine: (input) => { const inv = CBTAX.determine(input); inv._cb = Object.assign({}, inv._cb, { bridge: BROKEN }); return inv; } });
}
function page(o) {
  o = o || {};
  const tax = engine(o.broken);
  const ctx = {
    window: { CBProfileMap: PMAP, CBTax: tax }, CBProfileMap: PMAP, CBTax: tax, console, Object, Array, String, Number, Math, JSON, RegExp, Date,
    r2: (n) => MONEY.round(Number(n) || 0), said: [], pins: [], asked: [],
    S: { shop: { name: 'TN Shop', gstin: '33AABCK1234F1Z6', state_code: '33', country: 'IN', reg_type: 'regular' }, policy: { price_includes_tax: 'yes' } },
    CART: [{ key: 'x', name: 'Goods', unit: 'piece', qty: 2, price: 118, unitPrice: 118, hsn: '', gst_rate: 18, cess_rate: 0, save: 0 }],
    BILL_DELIVERY: null, shopTax: () => ({ charges: true, kind: 'tax' }), packSplitsByState: () => true, cbQuiet: () => {},
    custKnown: () => null, document: { getElementById: () => ({ value: '' }) },
    esc: (t) => String(t), unratedNames: () => [], shopStateClash: () => null, dayWarnWords: () => '', buyerWarnWords: () => '',
    say: (w) => ctx.said.push(w),
    ownerPinAsk: async (msg, title) => { ctx.pins.push({ msg, title }); return o.owner === false ? null : { by: { id: 'own-1', name: 'Asha' } }; },
    ask: async (msg) => { ctx.asked.push(msg); return o.why == null ? null : o.why; }
  };
  vm.createContext(ctx);
  vm.runInContext(['billMoney', 'moneyOf', 'noCountryMoney', 'walkInNote', 'taxIncluded', 'moneyStop', 'moneyStopAsk', 'billWarnHTML', 'billWarnLine', 'slipCheckedHTML'].map(grab).join('\n')
    + '\nthis.__f = { billMoney: billMoney, moneyStopAsk: typeof moneyStopAsk === "function" ? moneyStopAsk : null, billWarnHTML: typeof billWarnHTML === "function" ? billWarnHTML : null, slipCheckedHTML: typeof slipCheckedHTML === "function" ? slipCheckedHTML : null };', ctx);
  return ctx;
}

(async () => {
  console.log('\n== CTR-191 · the till stops a bill that does not add up ==\n');
  await ok('a bill the engine balances has no stop (m.stop null) and no warn row', () => {
    const p = page(); const m = p.__f.billMoney();
    assert.strictEqual(m.stop, null); assert.ok(!/till-warn-money/.test(p.__f.billWarnHTML(m)));
  });
  await ok('a bill whose bridge is not ok carries the engine\'s own step, amount and words — read, not worked out', () => {
    const m = page({ broken: true }).__f.billMoney();
    assert.ok(m.stop, 'no stop on a bill the engine says does not add up');
    assert.deepStrictEqual([m.stop.step, m.stop.unexplained_minor, m.stop.words], [BROKEN.step, BROKEN.unexplained_minor, BROKEN.words]);
  });
  await ok('the sentence is said on the bill where it is sold (till-warn-money), offline, in the engine\'s words', () => {
    const p = page({ broken: true }); const html = p.__f.billWarnHTML(p.__f.billMoney());
    assert.ok(/data-testid="till-warn-money"/.test(html) && html.includes(BROKEN.words) && /owner/i.test(html), html);
  });
  await ok('the owner\'s PIN and a typed reason let it through -> { by, at, why, step, unexplained_minor }', async () => {
    const p = page({ broken: true, why: '  weighed twice  ' }); const m = p.__f.billMoney();
    const o = await p.__f.moneyStopAsk(m.stop);
    assert.strictEqual(o.by, 'own-1'); assert.strictEqual(o.why, 'weighed twice'); assert.strictEqual(o.step, 'total'); assert.strictEqual(o.unexplained_minor, 500);
    assert.ok(!isNaN(Date.parse(o.at)), 'no moment'); assert.strictEqual(p.pins.length, 1);
  });
  await ok('no owner PIN, or no reason typed -> the sale stops (false), and a missing reason is said', async () => {
    const a = page({ broken: true, owner: false }); assert.strictEqual(await a.__f.moneyStopAsk(a.__f.billMoney().stop), false);
    const b = page({ broken: true, why: '   ' }); assert.strictEqual(await b.__f.moneyStopAsk(b.__f.billMoney().stop), false); assert.strictEqual(b.said.length, 1);
  });
  await ok('a bill that adds up asks nothing (null)', async () => {
    const p = page(); assert.strictEqual(await p.__f.moneyStopAsk(p.__f.billMoney().stop), null); assert.strictEqual(p.pins.length, 0);
  });
  await ok('finish() asks BEFORE payment is taken, and the chit carries the override; the slip says who checked', () => {
    const f = grab('finish');
    assert.ok(/moneyStopAsk\(m\.stop\)/.test(f) && f.indexOf('moneyStopAsk') > f.indexOf('billMoney()') && f.indexOf('moneyStopAsk') < f.indexOf('tenderParts'), 'finish() order');
    assert.ok(/money_override: moneyOver/.test(f), 'body does not carry money_override');
    assert.ok(/money_override: bill\.money_override/.test(grab('chitOf')), 'chitOf drops money_override');
    const p = page(); const foot = p.__f.slipCheckedHTML({ money_override: { by: 'own-1', by_name: 'Asha' } });
    assert.ok(/Money checked by Asha/.test(foot) && p.__f.slipCheckedHTML({}) === '');
  });
  await ok('the server door accepts exactly what the till writes: a counter key with a reason; no reason, or a plain key, is refused', () => {
    const { overrideBy } = require('../lib/finance-terms');
    const mine = { by: 'own-1', why: 'weighed twice', step: 'total', unexplained_minor: 500 };
    assert.strictEqual(overrideBy({ api_key: 'k', till: { kind: 'key', counter: true } }, mine, { needWhy: true }), 'own-1');
    assert.strictEqual(overrideBy({ api_key: 'k', till: { kind: 'key', counter: true } }, Object.assign({}, mine, { why: '' }), { needWhy: true }), null);
    assert.strictEqual(overrideBy({ api_key: 'k', till: { kind: 'key' } }, mine, { needWhy: true }), null);
  });
  await ok('a queued bill the server stopped (409 MONEY_UNBALANCED) keeps its code and shows RED in the outbox; a re-send clears it', () => {
    assert.ok(HTML.includes('bill._code = code || null'), 'drain keeps the server code on the row');
    assert.ok(HTML.includes("q._code === 'MONEY_UNBALANCED' ? ' stoprow'"), 'the waiting list marks that row stoprow');
    assert.ok(HTML.includes('.t.warnrow.stoprow{color:var(--bad'), 'stoprow is red (--bad), not the amber warn');
    assert.ok(HTML.includes('delete fresh._why; delete fresh._code') && HTML.includes('delete moved._why; delete moved._code'), 'a re-sent or renumbered row drops the old code');
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();

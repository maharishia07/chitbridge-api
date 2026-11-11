/**
 * tests/ctr-186-till-deliver-to.test.cjs — CTR-186: THE COUNTER RECORDS WHERE THE GOODS GO.
 *
 * OWNS      deliverTo / deliverAsk / deliverPick (till.html) lifted into a vm with the REAL tax engine (lib/tax = window.CBTax):
 *           a TN shop (GSTIN 33) sells 10 x 1,180 (tax-inclusive, 18%) to a registered KA buyer (GSTIN 29).
 *             over the counter  -> CGST 900 + SGST 900, Pos 33 (IGST s10(1)(a): the shop's state), as before
 *             despatched to KA  -> BILL_DELIVERY {state_code:'29'}, IGST 1,800, Pos 29
 *           and the server reads the same fact (lib/send-money invoiceOfLines over the chit's business_json.delivery) -> IGST 1,800.
 *           placeOfSupply is unchanged (the engine's one rule); only the till side records the fact.
 * CALLED BY scripts/guards.cjs · by hand: node tests/ctr-186-till-deliver-to.test.cjs
 * FLOW      till.html functions -> vm + lib/tax + lib/profile-map -> BILL_DELIVERY -> billMoney() invoice -> business_json.delivery -> tax-copy.withRecordedPos
 * CARD      counter/billing-and-the-bill
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const HTML = fs.readFileSync(path.join(__dirname, '../tools/tally-connector/till.html'), 'utf8').replace(/\r\n/g, '\n');
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
const r2 = (n) => MONEY.round(Number(n) || 0);

/** the page: a TN shop, one registered KA customer on the bill, 10 x 1,180 inclusive at 18%; despatched / typed = the answers the person gives */
function page(o) {
  o = o || {};
  const box = { cname: { value: o.cust === false ? '' : 'KA Dealer' }, cphone: { value: '' }, deliverbtn: { textContent: '', title: '' } };
  const ctx = {
    window: { CBProfileMap: PMAP }, CBProfileMap: PMAP, CBTax: CBTAX, console, Object, Array, String, Number, Math, JSON, RegExp,
    r2, S: { shop: { name: 'TN Shop', gstin: '33AABCK1234F1Z6', state_code: '33', country: 'IN', reg_type: 'regular' }, policy: { price_includes_tax: 'yes' } },
    CART: [{ key: 'x', name: 'Goods', unit: 'piece', qty: 10, price: 1180, unitPrice: 1180, hsn: '', gst_rate: 18, cess_rate: 0, save: 0 }],
    BILL_DELIVERY: null, BILL_DELIVERY_ASKED: false, said: [], asked: [],
    shopTax: () => ({ charges: true, kind: 'tax' }), packSplitsByState: () => true, cbQuiet: () => {},
    custKnown: () => (o.cust === false ? null : { identity_id: 'c1', name: 'KA Dealer', gstin: '29BBBBB0000B1Z5' }),
    document: { getElementById: (id) => box[id] || { value: '' } }, paintTotals: () => {}, draftSave: () => {},
    sure: async (message, okWord, title, cancelWord) => { ctx.asked.push({ message, okWord, cancelWord }); return !!o.despatched; },
    ask: async (message) => { ctx.asked.push({ message }); return o.typed == null ? null : o.typed; },
    say: (w) => ctx.said.push(w), box
  };
  ctx.window.CBTax = CBTAX;
  vm.createContext(ctx);
  vm.runInContext(['billMoney', 'billWhen', 'engineReadyFor', 'shopDayOf', 'tzOpt', 'shopTz', 'shopPack', 'docCountry', 'bandWordsOf', 'moneyOf', 'noCountryMoney', 'walkInNote', 'taxIncluded', 'moneyStop', 'deliverTo', 'deliverAsk', 'deliverPick', 'paintDeliver'].map(grab).join('\n')
    + '\nthis.__f = { billMoney: billMoney, deliverTo: typeof deliverTo === "function" ? deliverTo : null, deliverAsk: typeof deliverAsk === "function" ? deliverAsk : null, deliverPick: typeof deliverPick === "function" ? deliverPick : null };', ctx);
  return ctx;
}
const sum = (m, re) => m.heads.filter((h) => re.test(h.name)).reduce((a, h) => a + h.amount, 0);
const heads = (m) => ({ cgst: sum(m, /^CGST/i), sgst: sum(m, /^SGST/i), igst: sum(m, /^IGST/i) });

(async () => {
  console.log('\n== CTR-186 · the till records the deliver-to state ==\n');
  await ok('baseline: a registered KA buyer, nothing recorded -> over the counter: CGST 900 + SGST 900, Pos 33 (placeOfSupply unchanged)', () => {
    const p = page(); const m = p.__f.billMoney();
    assert.deepStrictEqual(heads(m), { cgst: 900, sgst: 900, igst: 0 }); assert.strictEqual(String(m.pos_state), '33');
  });
  await ok('"Deliver to" KA (29) chosen -> BILL_DELIVERY {state_code:29}; the bill is IGST 1,800, Pos 29', () => {
    const p = page(); assert.ok(p.__f.deliverTo, 'deliverTo is not on the page');
    p.__f.deliverTo('29');
    assert.strictEqual(p.BILL_DELIVERY && p.BILL_DELIVERY.state_code, '29');
    const m = p.__f.billMoney(); assert.deepStrictEqual(heads(m), { cgst: 0, sgst: 0, igst: 1800 }); assert.strictEqual(String(m.pos_state), '29');
  });
  await ok('the person types the state NAME ("Karnataka") in the Deliver-to popup -> the same 29', async () => {
    const p = page({ typed: 'Karnataka' }); assert.ok(p.__f.deliverPick, 'deliverPick is not on the page');
    await p.__f.deliverPick(); assert.strictEqual(p.BILL_DELIVERY && p.BILL_DELIVERY.state_code, '29');
    assert.strictEqual(heads(p.__f.billMoney()).igst, 1800);
  });
  await ok('an empty answer clears the delivery (back over the counter); a word that is no state changes nothing and says so', async () => {
    const p = page({ typed: '' }); assert.ok(p.__f.deliverTo, 'deliverTo is not on the page');
    p.__f.deliverTo('29'); await p.__f.deliverPick(); assert.strictEqual(p.BILL_DELIVERY, null);
    const q = page({ typed: 'Atlantis' }); await q.__f.deliverPick(); assert.strictEqual(q.BILL_DELIVERY, null); assert.strictEqual(q.said.length, 1, 'the refusal must be said');
  });
  await ok('registered buyer from ANOTHER state: asked "over the counter or despatched?"; despatched -> state 29, IGST 1,800', async () => {
    const p = page({ despatched: true }); assert.ok(p.__f.deliverAsk, 'deliverAsk is not on the page');
    await p.__f.deliverAsk();
    assert.strictEqual(p.asked.length, 1); assert.strictEqual(p.asked[0].cancelWord, 'Over the counter');
    assert.strictEqual(p.BILL_DELIVERY && p.BILL_DELIVERY.state_code, '29'); assert.strictEqual(heads(p.__f.billMoney()).igst, 1800);
  });
  await ok('...over the counter -> nothing recorded, CGST 900 + SGST 900; asked once per bill', async () => {
    const p = page({ despatched: false }); assert.ok(p.__f.deliverAsk, 'deliverAsk is not on the page');
    await p.__f.deliverAsk(); await p.__f.deliverAsk();
    assert.strictEqual(p.asked.length, 1); assert.strictEqual(p.BILL_DELIVERY, null); assert.deepStrictEqual(heads(p.__f.billMoney()), { cgst: 900, sgst: 900, igst: 0 });
  });
  await ok('no question when it is not needed: walk-in, buyer of the shop\'s own state, or a delivery already chosen', async () => {
    const a = page({ cust: false }); assert.ok(a.__f.deliverAsk, 'deliverAsk is not on the page');
    await a.__f.deliverAsk(); assert.strictEqual(a.asked.length, 0);
    const b = page(); b.custKnown = () => ({ name: 'TN Dealer', gstin: '33BBBBB0000B1Z5' }); await b.__f.deliverAsk(); assert.strictEqual(b.asked.length, 0);
    const c = page(); c.__f.deliverTo('29'); await c.__f.deliverAsk(); assert.strictEqual(c.asked.length, 0);
  });
  await ok('finish() asks BEFORE the bill is worked out, and the page has the control with its id', () => {
    const f = grab('finish'); assert.ok(/deliverAsk\(\)/.test(f) && f.indexOf('deliverAsk()') < f.indexOf('billMoney()'), 'finish() must ask before billMoney()');
    assert.ok(/id="deliverbtn"[^>]*data-testid="till-deliver-to"|data-testid="till-deliver-to"[^>]*id="deliverbtn"/.test(HTML), 'the Deliver-to button has no id / testid');
  });
  await ok('the SERVER reads the same fact: the chit\'s business_json.delivery -> invoiceOfLines -> IGST 1,800 (10 x 1,000 excl at 18%); no delivery stays CGST+SGST for a TN buyer', async () => {
    const dbId = require.resolve('../db'); const rows = {};
    const q = async (sql, args) => ({ rows: ((args && args[0]) || []).map((id) => rows[id]).filter(Boolean) });
    require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { query: q, pool: { query: q }, withEntity: async (id, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }), onEntity: async (id, db, fn) => fn({ query: q }), readBatch: async () => ({}), trySavepoint: async (db, fn, fb) => fn(db).catch(() => fb) } };
    const { invoiceOfLines } = require('../lib/send-money');
    const S = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
    rows[S] = { identity_id: S, gstn: '33AAAAA0000A1Z5', display_name: 'TN Seller', policy_flags: { price_includes_tax: 'no' }, country: 'IN' };
    rows[B] = { identity_id: B, gstn: '33BBBBB0000B1Z5', display_name: 'TN Buyer', policy_flags: {}, country: 'IN' };
    const p = page(); assert.ok(p.__f.deliverTo, 'deliverTo is not on the page'); p.__f.deliverTo('29');
    const send = async (b) => (await invoiceOfLines({ lines: [{ particulars: 'Goods', quantity: 10, price: 1000, gst_rate: 18 }], sellerId: S, buyerId: B, business_json: b, currency_code: 'INR' })).ValDtls;
    const v = await send({ delivery: JSON.parse(JSON.stringify(p.BILL_DELIVERY)) }); assert.deepStrictEqual([v.CgstVal, v.SgstVal, v.IgstVal], [0, 0, 1800]);
    const w = await send({}); assert.deepStrictEqual([w.CgstVal, w.SgstVal, w.IgstVal], [900, 900, 0]);
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();

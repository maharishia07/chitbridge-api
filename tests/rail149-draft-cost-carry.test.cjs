/**
 * tests/rail149-draft-cost-carry.test.cjs — RAIL-149 (HOTFIX): a cost-blind co-assist who re-sends a priced draft does not erase its price.
 *
 * OWNS      the proof that POST /chits/send with promote_draft_id, from an actor without can_see_costs on a draft the shop BUYS on (or whose side is unknown), keeps the STORED
 *           line money (price, total, item_data cost keys) when the line comes back with none (null, missing, '' or the web's 0), for the send and for the re-save (is_draft:true);
 *           that a real figure sent by him is a 403 COST_BLIND (blocked = key names) with nothing delivered; that a line he ADDS may carry no money (refused with money, allowed
 *           with none); that a list shifted under index matching is a 400; that the write transaction re-checks the stored money under FOR UPDATE (409 when it moved); that a
 *           sale-side draft, the owner and a cost-allowed actor are exactly as before (no extra statement).
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/chits.js over the route-golden stand-ins; mint.deliver records the copies, never writes.
 * FLOW      scene (who · the draft header · the stored lines) → real POST /send → status, body, the copies handed to mint.deliver, the statements seen → the rule
 * CARD      01-rail-core-the-chit/chits-routes
 *
 * Run: node tests/rail149-draft-cost-carry.test.cjs
 */
'use strict';
const assert = require('assert'), path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;

const SHOP = '11111111-1111-4111-8111-111111111111', SUPPLIER = '22222222-2222-4222-8222-222222222222', CUSTOMER = '33333333-3333-4333-8333-333333333333';
const STRANGER = '44444444-4444-4444-8444-444444444444', BLIND_ID = '55555555-5555-4555-8555-555555555555', GRANTED_ID = '66666666-6666-4666-8666-666666666666';
const DRAFT = '77777777-7777-4777-8777-777777777777', L1 = '88888888-8888-4888-8888-888888888881', L2 = '88888888-8888-4888-8888-888888888882';
const STORED = 4242.5, STORED_TOTAL = 42425, STORED_COST = 3131.25, TRIED = 9797.25;
const row = (id, name, bridge) => ({ identity_id: id, bridge_id: bridge, display_name: name, country: 'IN', currency_code: 'INR', policy_flags: {}, status: 'active', user_id: name });
const ROWS = { [SHOP]: row(SHOP, 'Mayur Traders', 'CBSHOP0001'), [SUPPLIER]: row(SUPPLIER, 'Rice Mill', 'CBMILL0001'), [CUSTOMER]: row(CUSTOMER, 'Ravi Stores', 'CBRAVI0001'), [STRANGER]: row(STRANGER, 'Who Ltd', 'CBWHO00001') };
const OWNER = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CBSHOP0001', display_name: 'Mayur Traders' };
const BLIND = { identity_id: BLIND_ID, identity_type: 'actor', access_level: 'editor', parent_entity_id: SHOP, hat: 'manager', bridge_id: 'CBSHOP0001', display_name: 'Blind' };
const GRANTED = Object.assign({}, BLIND, { identity_id: GRANTED_ID, display_name: 'Granted' });
/** the draft as stored: line 1 priced at the supplier's rate (with a cost on its item), line 2 never priced */
const PAYLOAD = [
  { line_id: L1, seq: 10, particulars: 'Basmati rice 1kg', quantity: 10, unit: 'kg', price: STORED, total: STORED_TOTAL, item_data: { name: 'Basmati', unit_cost: STORED_COST } },
  { line_id: L2, seq: 20, particulars: 'Toor dal 1kg', quantity: 5, unit: 'kg' }
];
const headerFor = (other) => ({ purpose: 'order', sender_entity_id: SHOP, all_recipients: [{ entity_id: SHOP, role: 'sender' }, { entity_id: other, role: 'receiver' }], business_json: {} });

let delivered = [];
const SCENE = { header: headerFor(SUPPLIER), payload: PAYLOAD, roleOf: { [SUPPLIER]: 'supplier', [CUSTOMER]: 'customer' }, granted: false, moved: null };
function rows(s, p) {
  if (/WITH s AS \(SELECT c\.id, c\.path FROM identities/.test(s)) return [{ brand_id: SUPPLIER, built: false, edge_id: null }];
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: SCENE.definers !== false }];
  if (/can_see_costs FROM identities/.test(s)) return [{ can_see_costs: p[0] === GRANTED_ID }];
  if (/SELECT ch\.purpose, ch\.sender_entity_id, ch\.all_recipients/.test(s)) return SCENE.header ? [SCENE.header] : [];
  if (/FROM unnest\(\$2::uuid\[\]\)/.test(s)) return p[1].map((id) => ({ id, customer: SCENE.roleOf[id] === 'customer', supplier: SCENE.roleOf[id] === 'supplier' }));
  if (/SELECT role, business_json->>'page' AS page FROM chit_header/.test(s)) return [{ role: 'Draft', page: null }];
  if (/SELECT line_items FROM chit_detail WHERE entity_id = \$1 AND chit_id = \$2 LIMIT 1 FOR UPDATE/.test(s)) {
    SCENE.locked = (SCENE.locked || 0) + 1;
    return [{ line_items: SCENE.locked > 1 && SCENE.moved ? SCENE.moved : SCENE.payload }];
  }
  if (/SELECT country, currency_code, timezone FROM identities/.test(s)) return [{ country: 'IN', currency_code: 'INR', timezone: null }];
  if (/SELECT self_copy_pref, currency_code FROM identities/.test(s)) return [{ self_copy_pref: null, currency_code: 'INR' }];
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s) && !/status = 'active'/.test(s)) { const r = ROWS[p[0]]; return r ? [r] : []; }
  if (/SELECT bridge_id, display_name FROM identities WHERE identity_id = \$1/.test(s)) { const r = ROWS[p[0]]; return r ? [{ bridge_id: r.bridge_id, display_name: r.display_name }] : []; }
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s)) { const r = ROWS[p[0]]; return r ? [r] : []; }
  return [];
}
const h = G.harness({ rows, known: { [SHOP]: 'SHOP', [SUPPLIER]: 'SUPPLIER' } });
const mint = require(path.join(API, 'lib', 'mint'));
mint.deliver = async (sender, chit, copies) => { delivered.push({ sender, chit, copies }); return { ok: true }; };
require(path.join(API, 'lib', 'books-hooks')).afterChit = () => Promise.resolve({});
require(path.join(API, 'lib', 'meter')).meter = async () => {};
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async () => null;
require(path.join(API, 'lib', 'stock-from-chit')).postFor = async () => ({ failed: [], skipped: [] });
require(path.join(API, 'lib', 'events')).notifyAfter = () => {};
const app = h.app('/api/chits', require(path.join(API, 'routes', 'chits')));

/** what a blind resume really sends: the web's compose turns the hidden price into 0 (price: +item.price || 0, total: 0), or a client may send null */
const resent = (over) => Object.assign({ particulars: 'Basmati rice 1kg', unit: 'kg', quantity: 10, price: null }, over);
const body = (lines, extra) => Object.assign({ purpose: 'order', manual_subject: 'PO', recipients: [{ entity_id: SUPPLIER, role: 'to' }], line_items: lines, promote_draft_id: DRAFT }, extra || {});
const send = async (who, payload, scene) => {
  Object.assign(SCENE, { header: headerFor(SUPPLIER), payload: PAYLOAD, roleOf: { [SUPPLIER]: 'supplier', [CUSTOMER]: 'customer' }, locked: 0, moved: null, definers: true }, scene || {});
  delivered = [];
  const r = await h.run(app, { url: '/api/chits/send', body: payload, identity: who, ctx: {} });
  const lines = delivered.length ? JSON.parse(JSON.stringify(delivered[0].copies)) : null;
  return Object.assign(r, { copies: lines, wrote: delivered.length });
};
/** the line items of the sender's copy as handed to mint.deliver */
const sentLines = (r) => {
  const copy = (r.copies || []).find((item) => item && item.line_items) || (r.copies || [])[0];
  return (copy && copy.line_items) || [];
};
const reads = (r) => r.calls.filter((c) => /FOR UPDATE/.test(c.sql || '')).length;

let pass = 0, fail = 0;
const it = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  XX  ' + name + ' — ' + e.message); } };
const noMoney = (r) => !/ ?4242|9797|42425|3131/.test(JSON.stringify(r.body));

(async () => {
  /* FIRST: chits.js caches definersReady once it answers true, so the not-ready scene must run before any other send in this process */
  await it('the legacy write path (definers not ready) cannot re-check under the lock: a blind promote is refused 409, nothing written; the owner is not refused', async () => {
    const r = await send(BLIND, body([resent({})]), { definers: false });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.wrote, 0);
    assert.ok(!r.calls.some((c) => /INSERT INTO chit_header|DELETE FROM chit_header/i.test(c.sql || '')), 'something was written');
    const own = await send(OWNER, body([resent({})]), { definers: false });
    assert.notStrictEqual(own.status, 409, JSON.stringify(own.body));
  });
  console.log('\nRAIL-149 · a blind co-assist re-sends a priced draft — the stored money is carried');
  for (const [label, flags] of [['send', {}], ['re-save (is_draft:true)', { is_draft: true }]]) {
    await it(label + ': the price comes back null (or 0): the STORED price, total and item cost are what goes on the chit', async () => {
      for (const empty of [null, 0, '', undefined]) {
        const r = await send(BLIND, body([resent({ price: empty, total: 0, item_data: { name: 'Basmati' } }), resent({ particulars: 'Toor dal 1kg', quantity: 5 })], flags));
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        const line = sentLines(r)[0];
        assert.strictEqual(line.price, STORED, 'price for ' + empty + ': ' + JSON.stringify(line));
        assert.strictEqual(line.total, STORED_TOTAL);
        assert.strictEqual(line.item_data.unit_cost, STORED_COST);
        assert.strictEqual(line.item_data.name, 'Basmati');
        assert.ok(line.line_id, 'a line id');
        assert.strictEqual(sentLines(r)[1].price == null || sentLines(r)[1].price === 0 || sentLines(r)[1].price === undefined, true, 'the never-priced line stays unpriced');
      }
    });
  }
  await it('the send ANSWER of a blind resume carries no money: no money key, no total_value, no figure, no rupee sign; cost_hidden:true; the owner answer is not pruned', async () => {
    for (const flags of [{}, { is_draft: true }]) {
      const r = await send(BLIND, body([resent({}), resent({ particulars: 'Toor dal 1kg', quantity: 5 })], flags));
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      const text = JSON.stringify(r.body);
      assert.ok(!/"(total_value|money|net|total|price|tax|taxable|gross|grand_total|amount)"/.test(text), 'a money key: ' + text);
      assert.ok(!/₹|4242|42425/.test(text), 'a figure: ' + text);
      assert.strictEqual(r.body.cost_hidden, true);
      assert.strictEqual(r.body.chit_id !== undefined && r.body.summary.line_item_count, 2, 'the rest of the answer stays');
    }
    const own = await send(OWNER, body([resent({ price: 9 })]));
    assert.strictEqual(own.body.cost_hidden, undefined);
    assert.ok('total_value' in own.body.summary, 'the owner still reads the total');
    const sale = await send(BLIND, body([resent({ price: TRIED })], { recipients: [{ entity_id: CUSTOMER, role: 'to' }] }), { header: headerFor(CUSTOMER) });
    assert.strictEqual(sale.body.cost_hidden, undefined, 'a sale-side answer is as before');
  });
  await it('the match is by line_id when the client sends it, in any order; a changed quantity recomputes the total from the STORED price', async () => {
    const r = await send(BLIND, body([resent({ line_id: L2, particulars: 'Toor dal 1kg', quantity: 5 }), resent({ line_id: L1, quantity: 12, total: 0 })]));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const lines = sentLines(r);
    assert.strictEqual(lines[1].price, STORED);
    assert.strictEqual(lines[1].total, 50910);
    assert.ok(lines[0].price == null || lines[0].price === 0);
  });
  await it('the stored money is read FOR UPDATE and read again in the write transaction (twice), once per send', async () => {
    const r = await send(BLIND, body([resent({})]));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(reads(r), 2);
  });
  await it('the draft moved between the two reads (the owner repriced it): 409, nothing delivered', async () => {
    const moved = PAYLOAD.map((l) => (l.line_id === L1 ? Object.assign({}, l, { price: 6161.75 }) : l));
    const r = await send(BLIND, body([resent({})]), { moved });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.wrote, 0);
  });

  console.log('\nRAIL-149 · a blind co-assist cannot write a figure');
  await it('a real price: 403 COST_BLIND naming price, nothing delivered, the figure not echoed', async () => {
    const r = await send(BLIND, body([resent({ price: TRIED })]));
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    assert.ok(/COST_BLIND/.test(JSON.stringify(r.body)) && /price/.test(JSON.stringify(r.body.blocked || r.body)), JSON.stringify(r.body));
    assert.strictEqual(r.wrote, 0);
    assert.ok(noMoney(r) && !/9797/.test(JSON.stringify(r.body)));
  });
  await it('the stored price re-sent unchanged is not a change', async () => {
    const r = await send(BLIND, body([resent({ price: STORED })]));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(sentLines(r)[0].price, STORED);
  });
  await it('a cost key, a total or a discount with a figure is refused too (every key named)', async () => {
    const r = await send(BLIND, body([resent({ total: 12, discount: 3, item_data: { unit_cost: 1 } })]));
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    const blocked = r.body.blocked || [];
    for (const key of ['total', 'discount', 'unit_cost']) assert.ok(blocked.includes(key), key + ' in ' + JSON.stringify(blocked));
    assert.strictEqual(r.wrote, 0);
  });
  await it('a line he ADDS (a line_id the draft never had) with money is refused; without money it is allowed, unpriced', async () => {
    const withMoney = await send(BLIND, body([resent({}), resent({ line_id: '99999999-9999-4999-8999-999999999999', particulars: 'Sugar', price: 40 })]));
    assert.strictEqual(withMoney.status, 403, JSON.stringify(withMoney.body));
    assert.strictEqual(withMoney.wrote, 0);
    const bare = await send(BLIND, body([resent({}), resent({ line_id: '99999999-9999-4999-8999-999999999999', particulars: 'Sugar', quantity: 3 })]));
    assert.strictEqual(bare.status, 200, JSON.stringify(bare.body));
    const added = sentLines(bare)[1];
    assert.ok(added.price == null || added.price === 0, 'the added line carries no stored money: ' + JSON.stringify(added));
    assert.strictEqual(sentLines(bare)[0].price, STORED);
  });
  await it('a line past the end of the stored list (no id) is an added line: refused with money', async () => {
    const r = await send(BLIND, body([resent({}), resent({ particulars: 'Toor dal 1kg', quantity: 5 }), resent({ particulars: 'Sugar', price: 40 })]));
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  });
  await it('index matching never carries across items: a shifted list (another name at the position, no id) is a 400, nothing delivered', async () => {
    const r = await send(BLIND, body([resent({ particulars: 'Toor dal 1kg', quantity: 5 })]));
    assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    assert.strictEqual(r.wrote, 0);
  });
  await it('line_id and line_index naming two different stored lines: 400', async () => {
    const r = await send(BLIND, body([resent({ line_id: L1, line_index: 1 })]));
    assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    assert.strictEqual(r.wrote, 0);
  });

  await it('a cost BELOW the top level (item_data.modifiers[].cost) cannot be carried: 409 COST_CARRY_NESTED, nothing delivered, the figure not echoed', async () => {
    const nested = [Object.assign({}, PAYLOAD[0], { item_data: { name: 'Basmati', modifiers: [{ name: 'Bag', options: [{ cost: 777.5 }] }] } }), PAYLOAD[1]];
    const r = await send(BLIND, body([resent({})]), { payload: nested });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.ok(/COST_CARRY_NESTED/.test(JSON.stringify(r.body)) && !/777/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
    assert.strictEqual(r.wrote, 0);
    const own = await send(OWNER, body([resent({})]), { payload: nested });
    assert.strictEqual(own.status, 200, 'the owner is not refused');
  });
  await it('a top-level money key of item_data (price, unit_cost) IS carried, byte for byte', async () => {
    const rich = [Object.assign({}, PAYLOAD[0], { item_data: { name: 'Basmati', price: { amount: 61, currency: 'INR' }, unit_cost: STORED_COST } })];
    const r = await send(BLIND, body([resent({ item_data: { name: 'Basmati' } })]), { payload: rich });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(sentLines(r)[0].item_data, { name: 'Basmati', price: { amount: 61, currency: 'INR' }, unit_cost: STORED_COST });
  });

  console.log('\nRAIL-149 · the side, fail closed; everyone else untouched');
  await it('UNKNOWN side (a counterparty on neither list) hides: the price is carried', async () => {
    const r = await send(BLIND, body([resent({})], { recipients: [{ entity_id: STRANGER, role: 'to' }] }), { header: headerFor(STRANGER), roleOf: {} });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(sentLines(r)[0].price, STORED);
  });
  await it('UNKNOWN side: a figure is refused', async () => {
    const r = await send(BLIND, body([resent({ price: TRIED })], { recipients: [{ entity_id: STRANGER, role: 'to' }] }), { header: headerFor(STRANGER), roleOf: {} });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  });
  await it('no draft header at all (the side read comes back empty) is unknown: a figure is refused', async () => {
    const r = await send(BLIND, body([resent({ price: TRIED })]), { header: null });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  });
  await it('a SALE-side draft (the counterparty is on the customer list only): exactly as before — what he sends is what is sent, nothing read for update', async () => {
    const r = await send(BLIND, body([resent({ price: TRIED, total: 7 })], { recipients: [{ entity_id: CUSTOMER, role: 'to' }] }), { header: headerFor(CUSTOMER) });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(sentLines(r)[0].price, TRIED);
    assert.strictEqual(reads(r), 0);
  });
  await it('the OWNER: byte-identical — the line goes as sent, no cost read, no FOR UPDATE, no carry', async () => {
    const r = await send(OWNER, body([resent({ price: null }), resent({ particulars: 'Toor dal 1kg', price: 9, quantity: 5 })]));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(sentLines(r)[0].price, null);
    assert.strictEqual(sentLines(r)[1].price, 9);
    assert.strictEqual(reads(r), 0);
    assert.ok(!r.calls.some((c) => /can_see_costs/.test(c.sql || '')), 'the owner pays no permission read');
    const priced = await send(OWNER, body([resent({ price: TRIED })]));
    assert.strictEqual(sentLines(priced)[0].price, TRIED);
  });
  await it('a cost-ALLOWED actor: as sent, one permission read, no carry', async () => {
    const r = await send(GRANTED, body([resent({ price: TRIED })]));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(sentLines(r)[0].price, TRIED);
    assert.strictEqual(reads(r), 0);
  });
  await it('a blind actor sending a NEW chit to a customer (no promote_draft_id, a SALE): untouched, as RAIL-146 left it', async () => {
    const r = await send(BLIND, body([resent({ price: TRIED })], { promote_draft_id: undefined, recipients: [{ entity_id: CUSTOMER, role: 'to' }] }));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(sentLines(r)[0].price, TRIED);
    assert.strictEqual(reads(r), 0);
  });
  await it('RAIL-156: a blind actor sending a NEW priced chit to a SUPPLIER (no draft) is 403 COST_BLIND, nothing delivered (it was 200 and written)', async () => {
    const r = await send(BLIND, body([resent({ price: TRIED })], { promote_draft_id: undefined }));
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    assert.ok(/COST_BLIND/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
    assert.strictEqual(delivered.length, 0);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

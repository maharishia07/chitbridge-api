// mode-survives-order.spec.js — does the DECLARED MODE survive the transaction?
//
// Athi, 2026-08-06: "you only looked at visibility. Make a chit and send it to the supplier and see the result as a
// chit as well. What is selected should reach the supplier — if it is a cart it should reach as a cart, if it is a
// range it should reach as a range."
//
// He is right that the matrix tested the easy half. Rendering a price proves the catalogue READS correctly. It
// says nothing about whether the declaration SURVIVES an order — and the whole product claim is that a business
// receives what it declared it would receive.
//
// So this places real orders through the real endpoints and inspects the resulting CHIT.
//
//   npx playwright test mode-survives-order --project=noauth

const { test, expect } = require('@playwright/test');

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = require('../fixtures').signinCode();   // SEC1: the tester code (E2E_TESTER_CODE) on a deployed api, the local code on a local one
require('../fixtures').needCode(test);   // no code → the file SKIPS with a CI warning naming the secret

const SHOPS = {
  INR: { email: 'alpha@test-cb.com', name: 'Alpha Paints',  bridge: 'CB6C7UQHUB' },
  USD: { email: 'gamma@test-cb.com', name: 'Gamma Exports', bridge: 'CBQVKXNTF6' },
};

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    /* API-3 S36: an unsigned write is a public door (order/start, order/confirm): each call is its own attempt with its own key */
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(!token && method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

async function signIn(email, name) {
  await api('/api/entities/register', { method: 'POST', body: { email, display_name: name, user_id: 'e' + Date.now() + Math.floor(Math.random()*1e6) } });
  const v = await api('/api/entities/verify', { method: 'POST', body: { email, otp: OTP } });
  const j = v.json || {};
  return j.token || (j.entity && j.entity.token) || null;
}

/** Set a shop's declared input mode, add one product, and return what a customer would order. */
async function arrange(shop, preset, pipeline) {
  const token = await signIn(shop.email, shop.name);
  await api('/api/catalogue-face', { method: 'PUT', token,
    body: { face: { method: preset, order_input: { preset, pipeline }, units: ['tonne'] } } });
  const name = `mode-${preset}-${Date.now() % 100000}`;
  const add = await api('/api/products', { method: 'POST', token, body: { item_data: { name, unit: 'tonne', price: 500 } } });
  return { token, name, itemId: add.json && add.json.item && add.json.item.item_id };
}

/** Place an order as an anonymous customer: start (OTP issued) then confirm. */
async function order(bridge, line_items) {
  const email = `buyer-${Date.now()}@test-cb.com`;
  const start = await api(`/api/catalogue/${bridge}/order/start`, { method: 'POST', body: { email } });
  const otp = (start.json && start.json.dev_otp) || OTP;
  const conf = await api(`/api/catalogue/${bridge}/order/confirm`, { method: 'POST', body: { email, otp, line_items } });
  return { email, start, conf };
}

test.describe('the declared mode must survive into the chit', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test('CART — the chit records a cart order with a settled total', async () => {
    const shop = SHOPS.INR;
    const { token, name, itemId } = await arrange(shop, 'cart', 'commerce');

    const { conf } = await order(shop.bridge, [{ item_id: itemId, name, quantity: 2 }]);
    expect(conf.status, `order/confirm: ${JSON.stringify(conf.json).slice(0, 260)}`).toBeLessThan(400);

    // Read the chit back from the SHOP's side — what the business actually received.
    const chits = await api('/api/chits/inbox?limit=5', { token });
    const rows = (chits.json && (chits.json.chits || chits.json)) || [];
    const chit = (Array.isArray(rows) ? rows : [])[0];
    expect(chit, 'the shop received no chit at all').toBeTruthy();

    const s = chit.summary_json || {};
    expect(s.order_preset, 'the chit does not record WHICH mode produced it').toBe('cart');
    expect(s.pipeline).toBe('commerce');
    expect(chit.purpose, 'a cart order is an order').toBe('order');
    expect(s.total_value, 'a cart order carries a settled total').not.toBeNull();
    expect(s.currency_code, 'a monetary chit carries its currency').toBe('INR');
  });

  test('RANGE — the chit records an OFFER, with no settled total', async () => {
    const shop = SHOPS.USD;
    const { token, name, itemId } = await arrange(shop, 'range', 'commerce');

    // The buyer NAMES a price. This is the thing a cart cannot express.
    const { conf } = await order(shop.bridge, [{ item_id: itemId, name, quantity: 3, proposal: { price: 420 } }]);
    expect(conf.status, `order/confirm: ${JSON.stringify(conf.json).slice(0, 260)}`).toBeLessThan(400);

    const chits = await api('/api/chits/inbox?limit=5', { token });
    const rows = (chits.json && (chits.json.chits || chits.json)) || [];
    const chit = (Array.isArray(rows) ? rows : [])[0];
    expect(chit, 'the shop received no chit at all').toBeTruthy();

    const s = chit.summary_json || {};
    expect(s.order_preset, 'a range order must arrive AS a range').toBe('range');

    // THE ASSERTION THAT MATTERS. A buyer-proposed price is not an agreed price. If this chit said
    // purpose:'order' with a total_value, it would be a two-party sealed record asserting a figure NEITHER PARTY
    // AGREED — and lib/kyb.js sums total_value into trade-history trust signals.
    expect(chit.purpose, 'a proposed price is an OFFER, not an order').toBe('offer');
    expect(s.total_value, 'an offer must carry NO settled total').toBeNull();
    expect(s.indicative_total, 'the seller figure is kept, under a name nobody can mistake for a total').toBeDefined();
    expect(s.currency_code, 'an offer is still monetary — it carries a currency').toBe('USD');
  });

  test('ENQUIRY — a non-monetary chit carries no currency and no total', async () => {
    const shop = SHOPS.INR;
    const { token, name, itemId } = await arrange(shop, 'enquiry', 'payload');

    // The declared fields go in `payload`, not at the top level — the server refused my first attempt with
    // '"message" is required', which is the declaration doing its job: an enquiry catalogue declares `message`,
    // and a submission without it is not an enquiry.
    const { conf } = await order(shop.bridge, [{ item_id: itemId, name, payload: { message: 'how soon can you deliver?' } }]);
    expect(conf.status, `order/confirm: ${JSON.stringify(conf.json).slice(0, 260)}`).toBeLessThan(400);

    const chits = await api('/api/chits/inbox?limit=5', { token });
    const rows = (chits.json && (chits.json.chits || chits.json)) || [];
    const chit = (Array.isArray(rows) ? rows : [])[0];
    expect(chit).toBeTruthy();

    const s = chit.summary_json || {};
    expect(s.pipeline, 'an enquiry is a payload, not commerce').toBe('payload');
    // The rule settled on 2026-07-31: no currency means this is information, not money.
    expect(s.currency_code, 'a non-monetary chit must carry NO currency').toBeNull();
    expect(s.total_value, 'a non-monetary chit must carry NO total').toBeNull();
  });
});

test.describe('TWO items, TWO modes, ONE chit', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  // Athi: "did you pass one item per chit or more than one? Send two or more, each a different mode, and confirm
  // the mode survives per item."
  //
  // The single-item tests proved the CATALOGUE's mode survives. They cannot tell us whether the mode is recorded
  // PER ITEM or merely once for the whole chit — and that difference decides whether a mixed catalogue is real or
  // decorative.
  test('a cart item and a range item travel together, each keeping its own shape', async () => {
    const shop = SHOPS.USD;
    const token = await signIn(shop.email, shop.name);

    // The CATALOGUE is a cart. Both items live under it; one overrides itself to `range`.
    await api('/api/catalogue-face', { method: 'PUT', token,
      body: { face: { method: 'cart', order_input: { preset: 'cart', pipeline: 'commerce' }, units: ['tonne'] } } });

    const stamp = Date.now() % 100000;
    const mk = async (preset) => {
      const name = `two-${preset}-${stamp}`;
      const r = await api('/api/products', { method: 'POST', token, body: { item_data: {
        name, unit: 'tonne', price: 500, order_input: { preset, pipeline: 'commerce' } } } });
      expect(r.status, `creating the ${preset} item: ${JSON.stringify(r.json)}`).toBeLessThan(400);
      return { name, id: r.json.item.item_id };
    };
    const cartItem  = await mk('cart');    // fixed price — the shop's number stands
    const rangeItem = await mk('range');   // the buyer names a price

    // ONE order carrying BOTH.
    const { conf } = await order(shop.bridge, [
      { item_id: cartItem.id,  name: cartItem.name,  quantity: 2 },
      { item_id: rangeItem.id, name: rangeItem.name, quantity: 3, proposal: { price: 420 } },
    ]);

    // ── THE ANSWER, and it is NOT what the catalogue implies ─────────────────────────────────────────────
    //
    //   422 — "This shop does not take offers — 'two-range-…' is sold at the listed price"
    //
    // So per-item mode is only PARTLY real. An item may refine the SCHEMA it asks for, but it cannot make itself
    // negotiable inside a shop that is not: `validateProposal` branches on the SHOP's declaration before it looks
    // at the item. That is the same guard as T3.2 (an item may not switch the pipeline), and it is deliberate —
    // an item that could unilaterally accept a customer-supplied price inside a fixed-price shop is how you get a
    // sealed chit carrying a number the seller never offered.
    //
    // But it means "one catalogue, mixed modes" does not hold for NEGOTIATION. The catalogue will happily store a
    // `range` item beside a `cart` item — the earlier test proved that — and the shop will then refuse to trade it
    // that way. Accepted at authoring time, refused at order time, with nothing in between to warn the owner.
    //
    // Asserted as-is so the behaviour is pinned rather than assumed. Changing it is a product decision, not a fix.
    expect(conf.status, 'a range item inside a cart shop should be refused at order time').toBe(422);
    expect(String((conf.json || {}).message || ''), 'the refusal must name the item and the reason')
      .toMatch(/does not take offers|listed price/i);

    // Everything below is what WOULD be asserted if mixed negotiation were supported. Kept, skipped, and pointed
    // at the decision — deleting it would lose the specification of the thing we chose not to build.
    test.skip(true, 'mixed-negotiation catalogues are refused at order time — see the comment above');

    const chits = await api('/api/chits/inbox?limit=5', { token });
    const rows = (chits.json && (chits.json.chits || chits.json)) || [];
    const chit = (Array.isArray(rows) ? rows : [])[0];
    expect(chit, 'the shop received no chit').toBeTruthy();

    // Pull the DETAIL — line items live there, not on the header.
    const full = await api(`/api/chits/${chit.chit_id}`, { token });
    const det = (full.json && (full.json.detail || full.json)) || {};
    const lis = det.line_items || [];
    expect(lis.length, `expected 2 line items, got ${lis.length}: ${JSON.stringify(lis).slice(0, 300)}`).toBe(2);

    const li = (n) => lis.find((x) => (x.name || x.particulars || '').includes(n));
    const c = li(`two-cart-${stamp}`), r = li(`two-range-${stamp}`);
    expect(c, 'the cart line is missing').toBeTruthy();
    expect(r, 'the range line is missing').toBeTruthy();

    // ── THE ASSERTION ────────────────────────────────────────────────────────────────────────────────────
    // The negotiated line must carry the buyer's proposal; the fixed line must NOT. If both look the same on the
    // chit, "per-item mode" is a catalogue-authoring convenience that vanishes at the moment it would matter —
    // which is when two parties later disagree about what was agreed.
    expect(r.proposal, 'the range line lost the buyer\'s proposed price').toBeTruthy();
    expect(c.proposal, 'a FIXED-price line must not carry a proposal').toBeFalsy();

    // Recorded rather than asserted: one negotiable line makes the WHOLE chit an offer, because a total cannot be
    // settled while any part of it is unagreed. Printed so the behaviour is visible in the run either way.
    const s = chit.summary_json || {};
    console.log(`      [mixed chit] purpose=${chit.purpose} total_value=${JSON.stringify(s.total_value)} ` +
                `indicative=${JSON.stringify(s.indicative_total)} preset=${s.order_preset}`);
    expect(chit.purpose, 'a chit containing an unagreed line cannot be a settled order').toBe('offer');
    expect(s.total_value, 'no settled total while one line is only proposed').toBeNull();
  });
});

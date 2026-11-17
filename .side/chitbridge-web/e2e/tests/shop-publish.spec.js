// shop-publish.spec.js — CAN A NEW BUSINESS ACTUALLY OPEN ITS SHOP?
//
// ⚠️ WHY THIS EXISTS: until 2026-08-18 the answer was NO, and every storefront spec in this suite passed anyway.
// They all used `alpha` and `gamma` — two long-lived accounts whose schemas happened to have been created public
// by an earlier path. So the tests exercised a shop that was ALREADY open and never once exercised the act of
// OPENING one, which is the only part a new customer performs.
//
// The bug: `identities.catalogue_visibility` is what Settings writes; `entity_schemas.visibility` is what
// buildPublicView() requires and what the b49 RLS policy keys off. The second was a snapshot taken during
// REGISTRATION — before the owner could choose — so every entity onboarded through the UI had a private schema
// permanently, and nothing in the front end ever called the route that would change it.
//
// ⚠️ THE SHAPE OF THE MISS IS THE LESSON: a fixture that is already in the end state cannot test the transition
// into it. This spec starts from nothing, every time.
//
//   npx playwright test shop-publish --project=noauth

const { test, expect } = require('@playwright/test');

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = require('../fixtures').signinCode();   // SEC1: the tester code (E2E_TESTER_CODE) on a deployed api, the local code on a local one
require('../fixtures').needCode(test);   // no code → the file SKIPS with a CI warning naming the secret

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}
async function signIn(email, name) {
  await api('/api/entities/register', { method: 'POST', body: { email, display_name: name, user_id: 'e' + Date.now() + Math.floor(Math.random()*1e6) } });
  const v = await api('/api/entities/verify', { method: 'POST', body: { email, otp: OTP } });
  const j = v.json || {};
  return { token: j.token || (j.entity && j.entity.token) || null, entity: j.entity || null };
}
const uniq = (p) => `${p}-${Date.now() % 1000000}-${Math.floor(Math.random() * 9999)}`;

test.describe('Opening a shop · a brand-new business, from nothing', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let seller, bridge;

  test('[PUB-0] a brand-new entity starts CLOSED', async () => {
    seller = await signIn(`${uniq('pub')}@test-cb.com`, 'Pub Shop');
    expect(seller.token, 'the new entity must sign in').toBeTruthy();
    const me = await api('/api/entities/me', { token: seller.token });
    bridge = me.json && (me.json.bridge_id || (me.json.entity && me.json.entity.bridge_id));
    expect(bridge, 'a new entity must have a bridge id').toBeTruthy();

    /* ⚠️ ASSERTED, NOT ASSUMED. "It starts closed" is half the claim being tested — if a new shop were open by
       default, PUB-2 would pass without the fix and prove nothing. */
    const before = await api(`/api/catalogue/${bridge}`);
    expect(before.status, 'a shop nobody has opened must not be servable').toBe(404);
  });

  test('[PUB-1] the owner sets up a catalogue and one product', async () => {
    const face = await api('/api/catalogue-face', { method: 'PUT', token: seller.token,
      body: { face: { method: 'cart', order_input: { preset: 'cart', pipeline: 'commerce' }, units: ['tonne'] } } });
    expect([200, 201, 204].includes(face.status), `the face must save, got ${face.status}`).toBe(true);
    const add = await api('/api/products', { method: 'POST', token: seller.token,
      body: { item_data: { name: uniq('Openable'), unit: 'tonne', price: 500 } } });
    expect(add.status, 'the product must be added').toBe(200);
  });

  test('[PUB-2] ⭐⭐ SETTING IT PUBLIC MAKES IT REACHABLE — to a stranger, and to the owner', async () => {
    const set = await api('/api/entities/profile', { method: 'PATCH', token: seller.token,
      body: { catalogue_visibility: 'public' } });
    expect([200, 204].includes(set.status), `the owner must be allowed to open their shop, got ${set.status}`).toBe(true);

    /* ⚠️ ANONYMOUS FIRST — that is who a customer is. Checking it only as the owner is how this stayed broken:
       the owner's own view can be served by paths a stranger never touches. */
    const anon = await api(`/api/catalogue/${bridge}`);
    expect(anon.status, 'a customer with no session must be able to reach the shop').toBe(200);

    const owner = await api(`/api/catalogue/${bridge}`, { token: seller.token });
    expect(owner.status, 'the owner must see their own shop too').toBe(200);

    const buyer = await signIn(`${uniq('pub-buyer')}@test-cb.com`, 'Pub Buyer');
    const asBuyer = await api(`/api/catalogue/${bridge}`, { token: buyer.token });
    expect(asBuyer.status, 'another signed-in business must be able to reach it').toBe(200);
  });

  test('[PUB-3] setting it back to private closes it again', async () => {
    const set = await api('/api/entities/profile', { method: 'PATCH', token: seller.token,
      body: { catalogue_visibility: 'private' } });
    expect([200, 204].includes(set.status)).toBe(true);
    const anon = await api(`/api/catalogue/${bridge}`);
    /* ⚠️ THE REVERSE DIRECTION MATTERS AS MUCH. A fix that only ever opens shops would be worse than the bug:
       it would mean a business could not withdraw its catalogue once published. And the answer must stay 404 —
       "private" and "no such shop" are deliberately the same reply, or the difference is an existence oracle. */
    expect(anon.status, 'closing a shop must actually close it, and answer 404 rather than "private"').toBe(404);
  });
});

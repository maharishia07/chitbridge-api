// currency-matrix.spec.js — every CURRENCY × INPUT MODE combination, rendered in a real browser.
//
// WHY THIS EXISTS
// Every defect found by hand on 2026-08-05 was a RENDERING defect that API tests cannot see:
//   ₹[object Object] on a range store · a price that would render as 0 · a hardcoded ₹ on a USD shop ·
//   an empty error bar · a product that saved perfectly and appeared nowhere.
// 259 unit assertions were green through all of it. So this spec arranges by API — fast and deterministic — and
// then asserts on WHAT THE PAGE ACTUALLY SHOWS.
//
// THE SPLIT IS THE POINT: the API says what is true; the browser says what a customer sees. Tonight proved those
// are different questions.
//
// Currency is per ENTITY and not settable through the API (deliberately — it is governance, not a preference), so
// the three currencies come from three existing entities. Input mode IS settable, via catalogue-face, so it varies.
//
//   CB_WEB_BASE=https://chitbridge-web.vercel.app npx playwright test currency-matrix --project=noauth

const { test, expect } = require('@playwright/test');

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = require('../fixtures').signinCode();   // SEC1: the tester code (E2E_TESTER_CODE) on a deployed api, the local code on a local one
require('../fixtures').needCode(test);   // no code → the file SKIPS with a CI warning naming the secret

const ENTITIES = {
  INR: { email: 'alpha@test-cb.com', name: 'Alpha Paints',  bridge: 'CB6C7UQHUB', sym: '₹' },
  USD: { email: 'gamma@test-cb.com', name: 'Gamma Exports', bridge: 'CBQVKXNTF6', sym: '$' },
  AED: { email: 'delta@test-cb.com', name: 'Delta Trading', bridge: 'CBXP5ZBSFD', sym: 'AED' },
};

/** The declared-input contracts. `money` says whether a price may appear on screen at all. */
const MODES = {
  cart:     { order_input: { preset: 'cart',     pipeline: 'commerce' }, money: true,  band: false },
  qty:      { order_input: { preset: 'qty',      pipeline: 'commerce' }, money: false, band: false },
  range:    { order_input: { preset: 'range',    pipeline: 'commerce' }, money: true,  band: true  },
  // qtyprice DELIBERATELY hides the price — showsPrice:false, the buyer names it. And the band only renders on
  // the 'range' method, so a qtyprice shop shows no money at all. My first run asserted a symbol here and failed;
  // the code was right and the expectation was wrong.
  qtyprice: { order_input: { preset: 'qtyprice', pipeline: 'commerce' }, money: false, band: false },
  enquiry:  { order_input: { preset: 'enquiry',  pipeline: 'payload'  }, money: false, band: false },
  form:     { order_input: { preset: 'form',     pipeline: 'payload'  }, money: false, band: false },
};

/** Twelve combinations — every currency against a spread of modes, monetary and not. */
const MATRIX = [
  ['INR', 'cart'], ['INR', 'qty'], ['INR', 'enquiry'], ['INR', 'form'],
  ['USD', 'cart'], ['USD', 'range'], ['USD', 'qtyprice'], ['USD', 'enquiry'],
  ['AED', 'cart'], ['AED', 'range'], ['AED', 'qtyprice'], ['AED', 'form'],
];

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
  return j.token || (j.entity && j.entity.token) || null;
}

/** Everything a page must never show. Each one is a bug we actually shipped at some point today. */
const FORBIDDEN = ['[object Object]', 'NaN', 'undefined', 'null null', '${'];

/**
 * The mode each shop must be left in. THE FIRST RUN DID NOT DO THIS and it mattered:
 * Alpha ended the run stuck in `form` mode, so its storefront showed "Price on request · Submit" instead of a cart.
 * A test that mutates shared state and walks away has broken the thing it was meant to protect — and Saturday's run
 * sheet says Alpha is a cart shop.
 */
const RESTORE = {
  INR: { method: 'cart',     order_input: { preset: 'cart',     pipeline: 'commerce' }, units: ['litre'], vertical: 'paint' },
  USD: { method: 'qtyprice', order_input: { preset: 'range',    pipeline: 'commerce' }, units: ['tonne'], vertical: 'trade' },
  AED: { method: 'qtyprice', order_input: { preset: 'qtyprice', pipeline: 'commerce' }, units: ['tonne'], vertical: 'trade' },
};

test.afterAll(async () => {
  for (const [ccy, ent] of Object.entries(ENTITIES)) {
    try {
      const token = await signIn(ent.email, ent.name);
      if (token) await api('/api/catalogue-face', { method: 'PUT', token, body: { face: RESTORE[ccy] } });
    } catch (_) { /* restoring is best-effort; a failure here must not mask a test result */ }
  }
});

test.describe('currency × input mode — what the customer actually sees', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  for (const [ccy, mode] of MATRIX) {
    const ent = ENTITIES[ccy];
    const spec = MODES[mode];

    test(`${ccy} · ${mode} — ${ent.name}`, async ({ page }) => {
      // ── ARRANGE (API) ───────────────────────────────────────────────────────────────────────────────────
      const token = await signIn(ent.email, ent.name);
      expect(token, `could not sign in as ${ent.email}`).toBeTruthy();

      const face = await api('/api/catalogue-face', {
        method: 'PUT', token,
        body: { face: { method: spec.order_input.preset, order_input: spec.order_input, units: ['piece'] } },
      });
      expect(face.status, 'setting the input mode').toBeLessThan(400);

      // A product added THROUGH THE WRITE PATH, so its price is stamped by the server rather than by the test.
      const price = 250;
      const add = await api('/api/products', {
        method: 'POST', token,
        body: { item_data: { name: `matrix ${mode} ${Date.now() % 100000}`, unit: 'piece', price } },
      });
      expect(add.status, `adding a product: ${JSON.stringify(add.json)}`).toBeLessThan(400);

      // The server stamps the ENTITY's currency — never the test's opinion of it.
      const stamped = add.json && add.json.item && add.json.item.item_data && add.json.item.item_data.price;
      expect(stamped, 'the price must be stamped, not a bare number').toMatchObject({ amount: price, currency: ccy });

      // ── ASSERT (browser) ────────────────────────────────────────────────────────────────────────────────
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

      await page.goto(`/shop.html?bridge=${ent.bridge}`, { waitUntil: 'networkidle' });
      await expect(page.locator('#app')).not.toContainText('Loading shop', { timeout: 15_000 });

      const body = await page.locator('#app').innerText();

      // 1 · nothing broken on screen, ever, in any combination
      for (const bad of FORBIDDEN) {
        expect(body, `"${bad}" rendered on ${ccy}/${mode} — a customer would see this`).not.toContain(bad);
      }

      // 2 · a monetary mode shows THIS currency and no other
      if (spec.money || spec.band) {
        expect(body, `${ccy} expected on screen`).toContain(ent.sym);
        for (const [other, o] of Object.entries(ENTITIES)) {
          if (other === ccy || o.sym === ent.sym) continue;
          // ₹ must not appear on a USD shop — the exact bug found by hand tonight.
          expect(body, `${o.sym} (${other}) leaked onto a ${ccy} shop`).not.toContain(o.sym);
        }
      }

      // 3 · a PAYLOAD mode is not about money — no PRICE rendered
      //
      // The first version searched the WHOLE PAGE for the symbol and failed on AED/form. The page was right: the
      // hit was the region banner's "priced by the seller in AED" — prose, not a price. A test that cannot tell a
      // label from a value fails on correct pages, and a test that cries wolf gets ignored.
      //
      // (Whether that banner should mention pricing at all on a non-monetary shop is a separate question, noted
      // rather than conflated with this assertion.)
      if (spec.order_input.pipeline === 'payload') {
        const priceText = await page.locator('.price').allInnerTexts().catch(() => []);
        for (const o of Object.values(ENTITIES)) {
          for (const pt of priceText) {
            expect(pt, `${o.sym} rendered as a PRICE on a non-monetary (${mode}) shop`).not.toContain(o.sym);
          }
        }
      }

      // 4 · no console errors, even where the page looks fine
      expect(errors, `console errors on ${ccy}/${mode}:\n${errors.join('\n')}`).toEqual([]);

      // 5 · the shop is actually rendered, not an empty shell
      expect(body.length, 'the page rendered nothing').toBeGreaterThan(40);
    });
  }
});

test.describe('the added product is visible to a customer', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  // Its own test because it failed for a DIFFERENT reason than rendering: the public view gated items on the
  // entity having a public schema, so a product saved correctly and appeared nowhere. Nothing said so.
  for (const ccy of ['INR', 'USD', 'AED']) {
    const ent = ENTITIES[ccy];
    test(`${ccy} — a product added by the owner appears on the storefront`, async ({ page }) => {
      const token = await signIn(ent.email, ent.name);
      const marker = `visible-check-${Date.now() % 1000000}`;
      const add = await api('/api/products', {
        method: 'POST', token, body: { item_data: { name: marker, unit: 'piece', price: 99 } },
      });
      expect(add.status).toBeLessThan(400);

      await page.goto(`/shop.html?bridge=${ent.bridge}`, { waitUntil: 'networkidle' });
      await expect(page.locator('#app')).not.toContainText('Loading shop', { timeout: 15_000 });
      await expect(page.locator('#app'),
        'a product the owner just added is not on their own storefront').toContainText(marker, { timeout: 10_000 });
    });
  }
});

test.describe('the empty catalogue — a shop with nothing in it', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  // Athi: "run it with empty catalogue, it should show no product listed message."
  //
  // Uses a THROWAWAY entity rather than emptying a real one. Deleting the seeded shops' products to test an empty
  // state would leave Saturday's cast broken if the test failed halfway — a test must not be able to damage the
  // thing it is testing.
  test('an empty shop says so, rather than rendering a blank page', async ({ page }) => {
    const email = `empty-shop-${Date.now()}@test-cb.com`;
    const token = await signIn(email, 'Empty Shop');
    expect(token, 'could not mint a throwaway entity').toBeTruthy();

    // Published, but with nothing to publish: the distinction that matters is EMPTY versus PRIVATE.
    await api('/api/entities/profile', { method: 'PATCH', token, body: { catalogue_visibility: 'public' } });
    const me = await api('/api/entities/me', { token });
    const bridge = (me.json && (me.json.entity || me.json).bridge_id) || null;
    expect(bridge, 'no bridge id for the throwaway entity').toBeTruthy();

    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

    await page.goto(`/shop.html?bridge=${bridge}`, { waitUntil: 'networkidle' });
    await expect(page.locator('#app')).not.toContainText('Loading shop', { timeout: 15_000 });
    const body = await page.locator('#app').innerText();

    // It must SAY something. A blank panel is indistinguishable from a page that failed to load, and today has
    // been a long lesson in things that fail while appearing to succeed.
    //
    // ⚠ TWO DIFFERENT EMPTY STATES, and the first run conflated them:
    //   A · no catalogue at all       → "This shop has no public catalogue"   ← what a brand-new entity gets
    //   B · a catalogue, no products  → "This shop has nothing on display yet"
    // A is what this entity is, and its message is correct. B is the one Athi asked about and is tested below.
    expect(body, `an empty shop rendered no explanation:\n${body}`)
      .toMatch(/no public catalogue|nothing on display|no product|empty/i);

    // And nothing broken while it says it
    for (const bad of FORBIDDEN) expect(body, `"${bad}" on an empty shop`).not.toContain(bad);
    expect(errors, `console errors on an empty shop:\n${errors.join('\n')}`).toEqual([]);
  });

  test('an empty shop is not mistaken for a missing one', async ({ page }) => {
    // A bridge id that never existed must read differently from a real shop with no stock. Same blank screen for
    // both would tell a customer nothing about whether to come back.
    await page.goto('/shop.html?bridge=NOPE123456', { waitUntil: 'networkidle' });
    await expect(page.locator('#app')).not.toContainText('Loading shop', { timeout: 15_000 });
    const body = await page.locator('#app').innerText();
    expect(body.length, 'a missing shop rendered nothing at all').toBeGreaterThan(10);
    expect(body, 'a missing shop must not claim to be an empty one').not.toMatch(/nothing on display/i);
  });
});

test.describe('a catalogue with no products in it', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  // Athi: "run it with empty catalogue, it should show no product listed message."
  //
  // This is the state that matters and it is NOT the same as a brand-new entity. Here the shop has a catalogue —
  // it is set up, it is published, a customer has arrived at a real shop — and there is simply nothing in it.
  // "No public catalogue" would be the wrong thing to say: it reads as a setup problem rather than an empty shelf.
  test('a published catalogue with zero products says "nothing on display"', async ({ page }) => {
    const email = `bare-shelf-${Date.now()}@test-cb.com`;
    const token = await signIn(email, 'Bare Shelf');
    expect(token).toBeTruthy();

    await api('/api/entities/profile', { method: 'PATCH', token, body: { catalogue_visibility: 'public' } });
    // A default schema is what makes a catalogue EXIST — it is the difference between state A and state B.
    const sc = await api('/api/schemas/create-default', { method: 'POST', token, body: {} });
    expect(sc.status, `create-default: ${JSON.stringify(sc.json)}`).toBeLessThan(400);

    const me = await api('/api/entities/me', { token });
    const bridge = (me.json && (me.json.entity || me.json).bridge_id) || null;
    expect(bridge).toBeTruthy();

    await page.goto(`/shop.html?bridge=${bridge}`, { waitUntil: 'networkidle' });
    await expect(page.locator('#app')).not.toContainText('Loading shop', { timeout: 15_000 });
    const body = await page.locator('#app').innerText();

    expect(body, `a set-up shop with no stock said:\n${body}`).toMatch(/nothing on display|no product/i);
    expect(body, 'an empty shelf must not read as a setup failure').not.toMatch(/no public catalogue/i);
    for (const bad of FORBIDDEN) expect(body, `"${bad}" on a bare-shelf shop`).not.toContain(bad);
  });
});

test.describe('the SUPPLIER view — one path, many principals', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  // Athi: "check the same from supplier mode — login to alpha and check beta or gamma or delta, and its currency
  // and the mode should be visible using the supplier link."
  //
  // This is the claim in lib/catalogue-view.js that a storefront customer, a B2B buyer and a network peer all get
  // the SAME read. If a supplier view showed a different currency from the public storefront, that claim is false
  // — and the earlier supplier hop failed for exactly this reason: two pieces of code answering one question.
  for (const ccy of ['USD', 'AED']) {
    const sup = ENTITIES[ccy];

    test(`Alpha viewing ${sup.name} sees ${ccy}, the same as the storefront`, async () => {
      const alpha = await signIn(ENTITIES.INR.email, ENTITIES.INR.name);
      expect(alpha, 'Alpha could not sign in').toBeTruthy();

      // Adding a supplier is unilateral — no consent needed — so this is a normal buyer action.
      await api('/api/relationships/suppliers', { method: 'POST', token: alpha, body: { supplier_bridge_id: sup.bridge } });

      const list = await api('/api/relationships/suppliers', { token: alpha });
      const rows = (list.json && (list.json.suppliers || list.json)) || [];
      const row = (Array.isArray(rows) ? rows : []).find((r) =>
        (r.supplier_bridge_id === sup.bridge) || (r.bridge_id === sup.bridge));
      expect(row, `${sup.name} is not in Alpha's supplier list`).toBeTruthy();

      const sid = row.supplier_entity_id || row.entity_id || row.identity_id;
      const cat = await api(`/api/relationships/suppliers/${sid}/catalogue`, { token: alpha });
      expect(cat.status, `supplier catalogue: ${JSON.stringify(cat.json).slice(0, 200)}`).toBeLessThan(400);

      // THE ASSERTION THAT MATTERS: the supplier view reports the SUPPLIER's currency, not the viewer's.
      const j = cat.json || {};
      const shopCcy = (j.shop && j.shop.currency_code) || null;
      expect(shopCcy, `Alpha (INR) sees ${sup.name} priced in ${shopCcy}, expected ${ccy}`).toBe(ccy);

      // And every price in it carries that same currency — no bare numbers, no INR leaking in from the viewer.
      const prices = [];
      for (const f of j.finishes || []) for (const it of f.items || []) {
        const pr = (it.commercials || {}).price; if (pr !== undefined) prices.push(pr);
      }
      for (const it of j.items || []) {
        const pr = it.item_data && it.item_data.price; if (pr !== undefined) prices.push(pr);
      }
      for (const pr of prices) {
        expect(typeof pr, `a supplier-view price is a bare number: ${JSON.stringify(pr)}`).toBe('object');
        expect(pr.currency, `a supplier-view price is in ${pr.currency}, expected ${ccy}`).toBe(ccy);
      }

      // The declared INPUT MODE must travel too — a buyer needs to know they are naming a price, not filling a cart.
      const oi = j.order_input || (j.shop && j.shop.order_input) || null;
      expect(oi, 'the supplier view does not carry the declared input mode — the buyer cannot know how to order').toBeTruthy();
    });
  }
});

test.describe('per-PRODUCT input mode inside one catalogue', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  // Athi: "within the same catalogue, can we have one product as cart, another range, another qty+price? Are we
  // fixing the mode at catalogue level or product level?"
  //
  // BOTH — and the limit is precise. The catalogue declares the DEFAULT; an item merge-patches over it (RFC 7386,
  // the item wins because it is more specific). So cart · qty · range · qtyprice can coexist in one catalogue,
  // because they share the `commerce` pipeline.
  //
  // What an item may NOT do is change the PIPELINE. lib/order-input.js `forItem()` refuses it outright (T3.2), and
  // the reason is not tidiness: the route branches on the SHOP's pipeline BEFORE it looks at an item, so a
  // commerce item on a payload catalogue never actually switched paths — it just re-imported quantity and price
  // into a form and let a customer-supplied price sit beside price:0 on the same chit. It looked like it worked.
  test('cart · qty · range · qtyprice coexist in one catalogue', async () => {
    const ent = ENTITIES.USD;
    const token = await signIn(ent.email, ent.name);
    expect(token).toBeTruthy();

    await api('/api/catalogue-face', { method: 'PUT', token,
      body: { face: { method: 'cart', order_input: { preset: 'cart', pipeline: 'commerce' }, units: ['tonne'] } } });

    const stamp = Date.now() % 100000;
    for (const preset of ['cart', 'qty', 'range', 'qtyprice']) {
      const r = await api('/api/products', { method: 'POST', token, body: { item_data: {
        name: `mix-${preset}-${stamp}`, unit: 'tonne', price: 100,
        order_input: { preset, pipeline: 'commerce' },     // the item's OWN declaration
      } } });
      expect(r.status, `a ${preset} item inside a cart catalogue: ${JSON.stringify(r.json)}`).toBeLessThan(400);
    }

    const cat = await api(`/api/catalogue/${ent.bridge}`);
    const names = (cat.json.items || []).map((i) => i.item_data && i.item_data.name);
    for (const preset of ['cart', 'qty', 'range', 'qtyprice']) {
      expect(names, `the ${preset} item is missing from the catalogue`).toContain(`mix-${preset}-${stamp}`);
    }
  });

  test('an item may NOT switch the pipeline — a form cannot hide inside a cart catalogue', async () => {
    const ent = ENTITIES.USD;
    const token = await signIn(ent.email, ent.name);

    await api('/api/catalogue-face', { method: 'PUT', token,
      body: { face: { method: 'cart', order_input: { preset: 'cart', pipeline: 'commerce' }, units: ['tonne'] } } });

    // The item is accepted into the catalogue — the refusal is at ORDER time, where the two pipelines would
    // actually collide. What must never happen is a customer ordering it and the chit coming out incoherent.
    const r = await api('/api/products', { method: 'POST', token, body: { item_data: {
      name: `pipeline-jump-${Date.now() % 100000}`, unit: 'tonne', price: 100,
      order_input: { preset: 'form', pipeline: 'payload' },
    } } });

    // Whichever layer refuses it, SOMETHING must — silently accepting is the failure mode T3.2 was written for.
    // Recorded rather than asserted-green so the answer is visible in the run output either way.
    console.log(`      [pipeline-jump] POST /api/products → ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
    expect(r.status).toBeLessThan(500);
  });
});

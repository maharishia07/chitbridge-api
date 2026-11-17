// [ADOPT-01] A DELIVERY BECOMES YOUR OWN CATALOGUE — or is refused, and says why.
//
// Athi, 2026-09-10: "one shop connects to 3 different shops… each shop can send its relative information to the
// receiver, so the receiver shop A can have the details of each product with its attributes and can it show in
// the catalogue so it can reflect in counter, storefront?"
//
// This is that, with two suppliers in two trades: an FMCG distributor whose goods a grocery may sell, and a
// PHARMA supplier whose goods it may not — until a person says so. Plus the sundry case, which never touches the
// catalogue at all.
//
// ⚠️ FRESH ENTITIES EVERY RUN. Catalogues accumulate and a shop that already stocks something is answered
// 'already' rather than offered, so a re-used shop would drift towards testing nothing.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct } = require('../fixtures');

/**
 * ⚠️ THE APP AUTHENTICATES WITH A BEARER TOKEN, NOT A COOKIE. The first cut sent cookies and got a flat 401 —
 * SESSION.token in app/core.js is what every call carries, so a test talking to the API directly must carry it
 * too. Read from the page rather than re-implementing a sign-in.
 */
const authOf = async (p) => ({ Authorization: 'Bearer ' + await p.evaluate(() => SESSION.token),
                               'Content-Type': 'application/json' });
/** ⚠️ sectors live on entity_profile (PUT /api/governance/profile) — saveProfile PATCHes something else, so the
    first cut of this spec set nothing and every gate below would have tested nothing. */
async function setSector(p, API, sectors) {
  const r = await p.request.put(API + '/api/governance/profile',
    { headers: await authOf(p), data: { sectors } });
  if (!r.ok()) throw new Error('could not set the sector: ' + r.status() + ' ' + (await r.text()).slice(0, 200));
  /* ⚠️ READ IT BACK. A 200 is not evidence the sector stuck, and every gate in this spec rests on it — an
     unverified precondition turns a red assertion into a hunt through the wrong layer. */
  const back = await p.request.get(API + '/api/governance/profile', { headers: await authOf(p) });
  const got = await back.json();
  const have = (got && (got.sectors || (got.profile && got.profile.sectors))) || [];
  if (!String(have).includes(sectors[0])) throw new Error('the sector did not stick: asked ' + JSON.stringify(sectors)
    + ' got ' + JSON.stringify(got).slice(0, 300));
}
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[ADOPT-01] goods arrive from two trades; one is offered, one is refused until a person overrides', async ({ page, browser }) => {
  test.setTimeout(420000);

  /* ── the receiver: a grocery ── */
  await mintEntity(page, { fresh: true, name: 'Grocery ' + Date.now().toString().slice(-6) });
  const me = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const m = await api('me'); const e = (m && m.entity) || m || {};
    return { id: e.entity_id || e.identity_id, handle: e.user_id || e.bridge_id };
  });
  expect(me.handle, 'the receiving shop needs a handle a supplier can address').toBeTruthy();
  await setSector(page, API, ['kirana']);

  await test.step('⭐ the shop declares its trade, and that is what the gate reads', async () => {
    const rr = await page.request.get(API + '/api/governance/profile', { headers: await authOf(page) });
    const p = await rr.json();
    const sectors = (p && (p.sectors || (p.profile && p.profile.sectors))) || [];
    expect(String(sectors), 'the sector must stick, or every gate below is meaningless').toMatch(/kirana/i);
  });

  /* ── supplier one: FMCG, same trade as the grocery ── */
  const fmcgCtx = await browser.newContext();
  const fmcg = await fmcgCtx.newPage();
  await mintEntity(fmcg, { fresh: true, name: 'ABC Distributors ' + Date.now().toString().slice(-5) });
  await fmcg.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
  await setSector(fmcg, API, ['fmcg']);

  let fmcgChit;
  await test.step('⭐⭐ the FMCG distributor sends a delivery carrying its own attributes', async () => {
    fmcgChit = await fmcg.evaluate(async (to) => api('createChit', { body: {
      recipients: [{ entity_id: to }], purpose: 'receipt',
      subject: 'Goods received', manual_subject: 'Goods received',
      client_ref: 'GRN-FMCG-' + Date.now().toString().slice(-6),
      business_json: { doc: 'receipt', doc_no: 'GRN-FMCG', party: { name: 'ABC Distributors' } },
      line_items: [
        { particulars: 'Aachi Masala 100g', quantity: 24, unit: 'packet', price: 38,
          item_data: { batch: 'F-4471', unit_cost: 41.5 } },
        { particulars: 'Shelf labels', quantity: 200, unit: 'piece', price: 0.5, item_data: { unit_cost: 0.5 } },
      ] } }), me.id);
    expect(fmcgChit && fmcgChit.chit_id, JSON.stringify(fmcgChit)).toBeTruthy();
  });

  await test.step('⭐⭐⭐ the grocery is OFFERED the masala — with the cost, never a selling price', async () => {
    const r = await page.request.get(API + '/api/adopt/' + fmcgChit.chit_id,
      { headers: await authOf(page) });
    expect(r.status(), await r.text()).toBe(200);
    const j = await r.json();
    const masala = j.rows.find((x) => /Masala/.test(x.particulars));
    expect(masala.may, JSON.stringify(masala)).toBe('offer');
    /* ⚠️ THE COST TRAVELS AS A COST. A form that pre-filled the selling price would have a shop selling at cost. */
    expect(masala.seed.cost, 'the LANDED cost, not the supplier list price').toBe(41.5);
    expect(masala.seed.price, 'what to sell at is the shop\'s decision, always').toBeNull();
    expect(masala.seed.sku, 'the supplier\'s SKU is never adopted').toBeNull();
    expect(masala.seed.suggested_sku, 'but a suggestion saves typing forty of them').toBeTruthy();
    /* ⚠️ WHICH HALF IS MISSING? The trade travels ON the chit (source stamp) and the batch travels in the
       LINE. Asserting the vertical first means a red here names the cause instead of leaving two suspects. */
    expect(j.from.vertical, 'the sender trade did not travel on the chit: ' + JSON.stringify(j.from)).toBe('food');
    expect(masala.seed.attributes.batch, 'the batch did not survive the line: ' + JSON.stringify(masala.seed)).toBe('F-4471');
    expect(masala.seed.batch_tracked, 'FMCG keeps stock per batch').toBe(true);
  });

  /* ── supplier two: PHARMA, a different trade ── */
  const medCtx = await browser.newContext();
  const med = await medCtx.newPage();
  await mintEntity(med, { fresh: true, name: 'MedCo ' + Date.now().toString().slice(-5) });
  await med.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
  await setSector(med, API, ['pharma']);

  let medChit;
  await test.step('⭐⭐ a PHARMA supplier sends medicine to a grocery', async () => {
    medChit = await med.evaluate(async (to) => api('createChit', { body: {
      recipients: [{ entity_id: to }], purpose: 'receipt',
      subject: 'Goods received', manual_subject: 'Goods received',
      client_ref: 'GRN-MED-' + Date.now().toString().slice(-6),
      business_json: { doc: 'receipt', doc_no: 'GRN-MED', party: { name: 'MedCo' } },
      line_items: [{ particulars: 'Paracetamol 500mg strip', quantity: 50, unit: 'strip', price: 9,
                     item_data: { batch: 'P-2291', expiry: '2027-06-30', unit_cost: 9.4 } }] } }), me.id);
    expect(medChit && medChit.chit_id, JSON.stringify(medChit)).toBeTruthy();
  });


  await test.step('⭐⭐⭐ it is REFUSED — and the sentence says what stocking it would oblige', async () => {
    const r = await page.request.get(API + '/api/adopt/' + medChit.chit_id, { headers: await authOf(page) });
    const j = await r.json();
    const row = j.rows[0];
    expect(row.may, JSON.stringify(row)).toBe('refuse');
    expect(row.refused).toBe('vertical');
    /* ⚠️ NOT "vertical mismatch" — that is a word from our world. It has to say what it MEANS. */
    expect(row.why).toMatch(/batch and an expiry/);
    expect(row.why).toMatch(/recall/);
    expect(row.override_says, 'a refusal with no way through is a wall, not a gate').toBeTruthy();
  });

  await test.step('⚠️⚠️ and it cannot be accepted without the override — the refusal is not advisory', async () => {
    const r = await page.request.post(API + '/api/adopt/' + medChit.chit_id, {
      headers: await authOf(page),
      data: { accept: [{ line: 0, name: 'Paracetamol 500', sku: 'MED-PAR-500', price: 14 }] } });
    const j = await r.json();
    expect(j.added.length, 'a refused line was adopted without anybody overriding: ' + JSON.stringify(j)).toBe(0);
    expect(j.refused[0].refused).toBe('vertical');
  });

  await test.step('⭐⭐ with the override it lands — as the SHOP\'s product, and the override leaves a trace', async () => {
    const r = await page.request.post(API + '/api/adopt/' + medChit.chit_id, {
      headers: await authOf(page),
      data: { accept: [{ line: 0, name: 'Paracetamol 500', sku: 'MED-PAR-500', price: 14, override: true }] } });
    const j = await r.json();
    expect(j.added.length, JSON.stringify(j)).toBe(1);

    const items = await page.evaluate(async () => api('prodList'));
    const list = (items && (items.items || items.products || items)) || [];
    const got = list.find((x) => /Paracetamol/.test((x.item_data && x.item_data.name) || x.name || ''));
    expect(got, 'the adopted product is not in the catalogue').toBeTruthy();
    const d = got.item_data || got;
    /* the SHOP's words and the SHOP's price — not the supplier's */
    expect(d.name).toBe('Paracetamol 500');
    expect(d.sku).toBe('MED-PAR-500');
    /* ⚠️ A PRICE IS MONEY-STAMPED on the way in — { amount, currency } — because a bare number has no currency
       and CB refuses to carry one. Reading it as a number said NaN about a perfectly good price. */
    const paise = (v) => (v && typeof v === 'object') ? Number(v.amount) : Number(v);
    expect(paise(d.price), 'the shop own price, stamped with its currency: ' + JSON.stringify(d.price)).toBe(14);
    if (d.price && typeof d.price === 'object') expect(d.price.currency, 'and it carries one').toBeTruthy();
    /* the vertical's attributes travelled, and it arrives already keeping stock per batch */
    expect(d.batch).toBe('P-2291');
    expect(d.expiry).toBe('2027-06-30');
    expect(d.batch_tracked).toBe(true);
    /* ⚠️ SOMEBODY LOOKING AT THIS IN A YEAR can see a person decided it, not that it slipped through */
    expect(d.adopted_override, 'an override with no trace is indistinguishable from no gate').toBe('pharma');
    expect(d.adopted_from && d.adopted_from.name, 'and who it came from').toBeTruthy();
  });

  await test.step('⚠️ a name or an SKU the shop has not chosen is refused — it must be THEIR product', async () => {
    const r = await page.request.post(API + '/api/adopt/' + fmcgChit.chit_id, {
      headers: await authOf(page),
      data: { accept: [{ line: 0, name: 'Aachi Masala 100g' }] } });   /* no sku */
    const j = await r.json();
    expect(j.added.length).toBe(0);
    expect(j.refused[0].why).toMatch(/own SKU/);
  });

  await test.step('⭐⭐⭐ and there is no "accept everything"', async () => {
    const r = await page.request.post(API + '/api/adopt/' + fmcgChit.chit_id, {
      headers: await authOf(page), data: { all: true } });
    expect(r.status(), 'a one-tap accept must not exist').toBe(400);
    expect((await r.json()).message).toMatch(/no "accept everything"/);
  });

  await test.step('⭐⭐ SUPPLIES: a sundry purchase that never came through a channel', async () => {
    const r = await page.request.post(API + '/api/supplies/purchase', {
      headers: Object.assign(await authOf(page), { 'Idempotency-Key': 'adopt-purchase-' + Date.now() }), /* OPS-114: a purchase requires one key per attempt */
      data: { ref: 'CASH-' + Date.now().toString().slice(-6), from: 'Corner Hardware',
              lines: [{ name: 'Floor cleaner 5L', qty: 2, unit: 'can', cost: 400 },
                      { name: 'Carry covers', qty: 2000, unit: 'piece', cost: 0.9, keep_stock: true }] } });
    expect(r.status(), await r.text()).toBe(200);
    const j = await r.json();
    expect(j.recorded.length).toBe(2);
    /* ⚠️ the small one is EXPENSED, the bulk one is COUNTED — materiality, declared per item */
    expect(j.expensed).toBe(1);
    expect(j.stocked).toBe(1);

    const list = await page.request.get(API + '/api/supplies', { headers: await authOf(page) });
    const sj = await list.json();
    expect(sj.supplies.map((s) => s.name)).toEqual(expect.arrayContaining(['Floor cleaner 5L', 'Carry covers']));
    /* ⚠️⚠️ AND NONE OF IT IS IN THE CATALOGUE. This is the assertion the whole separate table exists for. */
    const items = await page.evaluate(async () => api('prodList'));
    const names = ((items && (items.items || items.products || items)) || [])
      .map((x) => (x.item_data && x.item_data.name) || x.name || '');
    expect(names.join(' | ')).not.toMatch(/Floor cleaner|Carry covers/);
  });

  await fmcgCtx.close(); await medCtx.close();
});

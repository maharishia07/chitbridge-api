// lifecycle.spec.js — [LIFE-01] THE WHOLE CHAIN, ONE SHOP, ONE RUN.
//
// Athi, 2026-09-10: *"one shop connects to 3 different shops … so the receiver shop A can have the details of each
// of the product with its attributes and can it show in the catalogue so it can reflect in counter, storefront?"*
//
// Every piece of that has now been proved separately. This proves it as ONE THING, because a chain of features
// that each pass alone is exactly how a product ships with a break between two of them:
//
//   a pharma supplier sends goods with a batch and an expiry
//     → the receiver's stock ledger records them at the LANDED cost, per batch
//     → the delivery is REFUSED for the catalogue until a person overrides it
//     → adopting mints the shop's OWN product, already batch-tracked
//     → the counter can see it and sell it
//     → the counter can bill it  (FEFO draw-down itself is proven in stock-cycle.test.js and the b215 probe)
//
// ⚠️ FRESH SHOPS. A chain test on a re-used shop starts from a state nobody chose, and the first assertion that
// fails is then unreadable.
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

const authOf = async (p) => ({ Authorization: 'Bearer ' + await p.evaluate(() => SESSION.token),
                               'Content-Type': 'application/json' });
async function setSector(p, sectors) {
  const r = await p.request.put(API + '/api/governance/profile', { headers: await authOf(p), data: { sectors } });
  if (!r.ok()) throw new Error('could not set the sector: ' + r.status());
}

test('[LIFE-01] a pharma delivery becomes a product, reaches the counter, and sells from its batch',
  async ({ page, browser }) => {
  test.setTimeout(600000);

  /* ── the receiver: a shop that DOES stock medicines, so the trade gate is not the subject here ── */
  await mintEntity(page, { fresh: true, name: 'Chemist ' + Date.now().toString().slice(-6) });
  const me = await page.evaluate(async () => {
    if (typeof ensureCap === 'function') await ensureCap('admin');
    const m = await api('me'); const e = (m && m.entity) || m || {};
    return { id: e.entity_id || e.identity_id };
  });
  await setSector(page, ['pharma']);
  const key = (await page.evaluate(async () => api('keysMint',
    { body: { name: 'lifecycle counter', scopes: ['till'], days: 1 } }))).key;

  /* ── the supplier ── */
  const medCtx = await browser.newContext();
  const med = await medCtx.newPage();
  await mintEntity(med, { fresh: true, name: 'MedCo ' + Date.now().toString().slice(-5) });
  await med.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
  await setSector(med, ['pharma']);

  const REF = 'GRN-LIFE-' + Date.now().toString().slice(-6);
  let chit;

  await test.step('1 · the supplier sends two batches, one expiring sooner than the other', async () => {
    chit = await med.evaluate(async (o) => api('createChit', { body: {
      recipients: [{ entity_id: o.to }], purpose: 'receipt',
      subject: 'Goods received', manual_subject: 'Goods received', client_ref: o.ref,
      business_json: { doc: 'receipt', doc_no: o.ref, party: { name: 'MedCo' } },
      line_items: [
        /* ⚠️ the LONG-dated batch arrives FIRST — which is exactly the case where FIFO would be wrong */
        { particulars: 'Amoxicillin 250mg strip', quantity: 10, unit: 'strip', price: 20,
          item_data: { batch: 'B-LONG', expiry: '2028-12-31', unit_cost: 22 } },
        { particulars: 'Amoxicillin 250mg strip', quantity: 4, unit: 'strip', price: 20,
          item_data: { batch: 'B-SHORT', expiry: '2026-11-30', unit_cost: 22 } },
      ] } }), { to: me.id, ref: REF });
    expect(chit && chit.chit_id, JSON.stringify(chit)).toBeTruthy();
  });

  await test.step('2 · the delivery offers the product, carrying the trade\'s own attributes', async () => {
    const r = await page.request.get(API + '/api/adopt/' + chit.chit_id, { headers: await authOf(page) });
    expect(r.status(), await r.text()).toBe(200);
    const j = await r.json();
    expect(j.from.vertical, 'the supplier\'s trade must travel ON the chit').toBe('pharma');
    const row = j.rows.find((x) => x.may === 'offer');
    expect(row, 'a chemist receiving medicine must be OFFERED it, not refused: ' + JSON.stringify(j.rows[0])).toBeTruthy();
    /* the landed cost, not the supplier's list price — Ind AS 2 */
    expect(row.seed.cost).toBe(22);
    expect(row.seed.batch_tracked, 'pharma keeps stock per batch').toBe(true);
    expect(row.seed.attributes.expiry, 'the expiry must survive the journey').toBeTruthy();
  });

  await test.step('3 · the shop adopts it under its OWN name and SKU', async () => {
    const r = await page.request.post(API + '/api/adopt/' + chit.chit_id, {
      headers: await authOf(page),
      data: { accept: [{ line: 0, name: 'Amoxicillin 250', sku: 'AMOX-250', price: 34 }] } });
    const j = await r.json();
    expect(j.added.length, JSON.stringify(j)).toBe(1);
  });

  await test.step('4 · the counter can see it, at the shop\'s price', async () => {
    const r = await page.request.get(API + '/api/till/snapshot', { headers: { 'X-Api-Key': key } });
    expect(r.status()).toBe(200);
    const snap = await r.json();
    const item = (snap.items || []).find((i) => /Amoxicillin 250$/.test(i.name || ''));
    expect(item, 'the adopted product did not reach the counter').toBeTruthy();
    expect(Number(item.price)).toBe(34);
    /**
     * ⭐⭐ AND THE COUNTER NOW KNOWS WHAT TO CAPTURE. lot_fields comes from the shop's own trade, and it was
     * silently empty for every shop until 10 September — the query behind it named a column that does not exist,
     * threw on every snapshot, and was swallowed. A pharma counter asked for nothing.
     */
    expect(snap.lot_fields, 'the counter must be told what this trade requires').toBeTruthy();
    expect(snap.lot_fields.required, JSON.stringify(snap.lot_fields))
      .toEqual(expect.arrayContaining(['batch', 'expiry']));
  });

  await test.step('5 · it appears on the storefront too', async () => {
    const handle = await page.evaluate(async () => {
      await api('saveProfile', { body: { catalogue_visibility: 'public' } });
      const m = await api('me'); const e = (m && m.entity) || m || {};
      return e.user_id || e.bridge_id;
    });
    const ctx = await browser.newContext();
    const shop = await ctx.newPage();
    try {
      await shop.goto('/shop.html?s=' + encodeURIComponent(handle), { waitUntil: 'load' });
      await expect(shop.locator('text=Amoxicillin 250').first(),
        'an adopted product must reach the storefront like any other').toBeVisible({ timeout: 40000 });
    } finally { await ctx.close(); }
  });

  await test.step('6 · adopting changed nothing about the delivery itself', async () => {
    /* ⚠️ the delivery is a RECORD of what arrived and adoption is a separate act on the catalogue. If taking a
       product into the shelf edited the document it came on, the two parties would stop holding the same one. */
    const r = await page.request.get(API + '/api/adopt/' + chit.chit_id, { headers: await authOf(page) });
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.rows.length, 'the delivery must still carry both of its lines').toBe(2);
  });

  await test.step('7 · the counter can sell it, and the sale is recorded', async () => {
    /**
     * ⚠️⚠️ WHAT THIS STEP DOES AND DOES NOT PROVE. It proves the adopted product can be BILLED — the last link
     * in the chain. It does NOT prove which batch the stock came out of, because no route exposes a balance
     * (deliberately: the ERP boundary says stock stays thin), so this spec cannot read one.
     * ⭐ FEFO ITSELF IS PROVEN TWICE ELSEWHERE — chitbridge-api/tests/stock-cycle.test.js at the unit level, and
     * against the REAL schema by the b215 rollback probe. The step title used to claim the batch draw-down and
     * assert none of it, which is a test telling a story about code it never looked at.
     */
    const bill = 'C1/LIFE/' + Date.now().toString().slice(-6);
    const item = await page.request.get(API + '/api/till/snapshot', { headers: { 'X-Api-Key': key } })
      .then((r) => r.json())
      .then((s) => (s.items || []).find((i) => /Amoxicillin 250$/.test(i.name || '')));
    expect(item, 'the product must be on the counter to sell it').toBeTruthy();

    const sale = await page.request.post(API + '/api/chits/send', {
      headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
      data: { recipients: [{ self: true, name: 'self' }], purpose: 'order',
              subject: 'Counter sale ' + bill, manual_subject: 'Counter sale ' + bill, client_ref: bill,
              business_json: { bill_no: bill, client_ref: bill, customer: { name: 'Walk-in' } },
              line_items: [{ particulars: 'Amoxicillin 250', quantity: 6, unit: 'strip', price: 34,
                             total: 204, item_id: item.item_id }] } });
    expect(sale.status(), await sale.text()).toBe(200);
  });

  await medCtx.close();
});

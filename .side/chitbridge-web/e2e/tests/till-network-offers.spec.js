// [TILL-26] A BRAND RELEASES AN OFFER; A STORE TAKES IT OR NOT; THE STORE'S COUNTER HONOURS IT FROM THE RELEASE MOMENT.
//
// Athi, 2026-09-17: *"only offers the store opts into — that can be a setting, opt-in, opt-out … a controlled mechanism of
// releasing the offer, not to change in the middle of the day … those offers reflect in every store and every counter.
// When an offer is released and pushed, each store that uses the reference gets it, and pushes it to its counters."*
//
// Two shops, as two separate sign-ins: the BRAND authors a catalogue and an offer; the STORE adopts the catalogue and runs a
// counter. Driven through the same routes the screens use, and the counter's own shop read.
const { test, expect } = require('@playwright/test');
const { mintEntity, mintInContext, approveJoins } = require('../fixtures');

const api = (page, name, opts) => page.evaluate(async ({ name, opts }) => {
  try { return { ok: true, body: await api(name, opts || {}) }; }
  catch (e) { return { ok: false, message: (e && e.message) || String(e) }; }
}, { name, opts });
const snap = (page, key) => page.evaluate(async (key) => {
  const r = await fetch(CFG.API_BASE + '/api/till/snapshot', { headers: { 'X-Api-Key': key } });
  return r.json();
}, key);
const netOffersIn = (s, brandOffer) => (s.offers || []).filter((o) => o.network && String(o.id) === String(brandOffer));

test('[TILL-26] network offers: released, taken or declined, and on the counter from the release moment', async ({ page, browser }) => {
  test.setTimeout(420000);
  const stamp = Date.now().toString().slice(-6);

  /* ── the BRAND ── */
  await mintEntity(page, { fresh: true, name: 'Brand ' + stamp });
  await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
  const sourceKey = 'brand-' + stamp + '@v1';
  const pub = await api(page, 'catSourcePut', { body: { source_key: sourceKey, title: 'Brand ' + stamp,
    items: [{ name: 'Smart kettle', category: 'Kitchen' }, { name: 'Toaster', category: 'Kitchen' }] } });
  expect(pub.ok, 'the brand could not publish its catalogue: ' + pub.message).toBe(true);
  const mkOffer = async (name) => {
    const r = await api(page, 'defAdd', { body: { kind: 'offer', sub_kind: 'percent_off', name, status: 'live', confirmed: true,
      rules: { kind: 'percent_off', label: name, percent: 10, scope: 'line', applies_to: { category: 'Kitchen' } } } });
    expect(r.ok, 'the brand could not declare an offer: ' + r.message).toBe(true);
    return r.body.definition_id || (r.body.definition && r.body.definition.definition_id) || r.body.id;
  };
  const offerNow = await mkOffer('Kitchen week 10%');
  const offerLater = await mkOffer('Diwali preview 10%');
  expect(offerNow && offerLater, 'no offer id came back').toBeTruthy();

  /* ── the STORE, its own sign-in, its own GSTIN world ── */
  const store = await mintInContext(browser, { fresh: true, name: 'Store ' + stamp });
  await store.page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
  const ad = await api(store.page, 'catalogueAdopt', { body: { source: sourceKey, commercials: { 'Smart kettle': { price: 2000, unit: 'piece' } } } });
  expect(ad.ok, 'the store could not adopt the brand catalogue: ' + ad.message).toBe(true);
  const cid = (await api(store.page, 'counterAdd', { body: { name: 'Showroom' } })).body.counter.id;
  const key = (await api(store.page, 'counterOpen', { params: { id: cid } })).body.key;

  /* moved 2026-09-17: adopting no longer PUTS a store in the network — it ASKS to join, and the brand decides (Athi: "the
     network has to approve"). The assertion "the store is counted" now holds only after the approval. */
  await test.step('⭐⭐ adopting ASKS to join — the brand sees the request, and the store sells none of its products yet', async () => {
    const v = await api(page, 'netOffers');
    expect(v.body.brand.is_brand).toBe(true);
    const ask = (v.body.brand.members || []).find((m) => m.state === 'requested' && m.asked_by === 'store');
    expect(ask, 'adopting did not ask to join the brand\'s network').toBeTruthy();
    expect(v.body.brand.stores, 'a store that only asked is counted as in').toBe(0);
    const s = await snap(store.page, key);
    expect((s.items || []).filter((i) => i.source).length, '⚠️ a store outside the network sells the brand\'s products').toBe(0);
    const mine = ((await api(store.page, 'netOffers')).body.store.networks || [])[0];
    expect(mine && mine.membership && mine.membership.state, 'the store is not told it is waiting').toBe('asked');
  });

  await test.step('⭐ the brand approves — the store is in, and counted', async () => {
    expect(await approveJoins(page)).toBe(1);
    const v = await api(page, 'netOffers');
    expect(v.body.brand.stores, 'the approved store is not counted').toBeGreaterThanOrEqual(1);
    const s = await snap(store.page, key);
    expect((s.items || []).some((i) => i.name === 'Smart kettle'), 'an approved store still cannot sell the brand\'s product').toBe(true);
  });

  await test.step('⭐⭐ OPT-IN: released now, but NOT applied until the store takes it', async () => {
    expect((await api(page, 'netOfferPolicy', { body: { policy: 'opt_in' } })).ok).toBe(true);
    const rel = await api(page, 'netOfferRelease', { params: { id: offerNow }, body: { at: 'now' } });
    expect(rel.ok, rel.message).toBe(true);
    expect(rel.body.pushed.stores, 'the release told no store').toBeGreaterThanOrEqual(1);
    const s = await snap(store.page, key);
    expect(netOffersIn(s, offerNow).length, 'opt-in applied an offer the store never took').toBe(0);
    const seen = await api(store.page, 'netOffers');
    const row = seen.body.store.networks[0].offers.find((o) => o.id === offerNow);
    expect(row, 'the store cannot see the released offer to take it').toBeTruthy();
    expect(row.applies).toBe(false);
  });

  await test.step('⭐⭐⭐ the store takes it — its counter gets the offer, from the brand, and the engine prices it', async () => {
    expect((await api(store.page, 'netOfferChoice', { params: { id: offerNow }, body: { choice: 'in' } })).ok).toBe(true);
    const s = await snap(store.page, key);
    const o = netOffersIn(s, offerNow)[0];
    expect(o, 'a taken network offer did not reach the counter').toBeTruthy();
    expect(o.network.brand_name).toContain('Brand ' + stamp);
    expect(new Date(o.valid_from).getTime(), 'a release NOW should already be in force').toBeLessThanOrEqual(Date.now() + 1000);
    const kettle = (s.items || []).find((i) => i.name === 'Smart kettle');
    expect(kettle, 'the network product is not on the counter').toBeTruthy();
    /* priced by the SAME engine the counter uses */
    const priced = await store.page.evaluate(async ({ kettle, offers }) => {
      if (!window.CBOffers) { await new Promise((ok) => { const s = document.createElement('script'); s.src = '/engine/offers.js'; s.onload = ok; document.head.appendChild(s); }); }
      /* the engine's own documented input: { key, item_id, sku, category, qty, unitPrice } → { subtotal, total, … } */
      const ev = CBOffers.evaluate({ lines: [{ key: 'k1', item_id: kettle.item_id, sku: kettle.code, category: kettle.category,
        qty: 1, unitPrice: kettle.price }], offers, ctx: { currency: 'INR', now: new Date().toISOString() } });
      return ev ? (Number(ev.subtotal) - Number(ev.total)) : null;
    }, { kettle, offers: s.offers });
    expect(Math.abs(Number(priced)), 'the network offer did not price the network product').toBe(200);
  });

  await test.step('⭐⭐ a release with no time waits for the NEXT OPENING — not in the middle of the day', async () => {
    const rel = await api(page, 'netOfferRelease', { params: { id: offerLater }, body: {} });
    expect(rel.ok, rel.message).toBe(true);
    expect(new Date(rel.body.release.at).getTime(), 'a default release took effect mid-day').toBeGreaterThan(Date.now());
    await api(store.page, 'netOfferChoice', { params: { id: offerLater }, body: { choice: 'in' } });
    const o = netOffersIn(await snap(store.page, key), offerLater)[0];
    expect(o, 'the pending offer did not travel to the counter ahead of its moment').toBeTruthy();
    expect(new Date(o.valid_from).getTime(), 'the counter was told to apply it early').toBeGreaterThan(Date.now());
  });

  await test.step('⭐⭐⭐ AN EDIT DOES NOT REACH THE STORES UNTIL IT IS RELEASED — then it replaces the old one at its moment', async () => {
    /* the brand changes the running offer from 10% to 15% */
    const ed = await api(page, 'defSave', { params: { id: offerNow }, body: { rules: { kind: 'percent_off', label: 'Kitchen week 15%',
      percent: 15, scope: 'line', applies_to: { category: 'Kitchen' } } } });
    expect(ed.ok, 'the brand could not change its offer: ' + ed.message).toBe(true);
    let o = netOffersIn(await snap(store.page, key), offerNow);
    expect(o.length).toBe(1);
    expect(o[0].percent, '⚠️ an unreleased edit reached the store mid-day').toBe(10);
    const view = await api(page, 'netOffers');
    expect(view.body.brand.offers.find((x) => x.id === offerNow).changed, 'the brand is not told its edit is unreleased').toBe(true);
    /* released NOW — the new version is in force, the old one has ended */
    const rel = await api(page, 'netOfferRelease', { params: { id: offerNow }, body: { at: 'now' } });
    expect(rel.ok, rel.message).toBe(true);
    o = netOffersIn(await snap(store.page, key), offerNow);
    const now = Date.now();
    const inForce = o.filter((x) => (!x.valid_from || new Date(x.valid_from).getTime() <= now + 1000) && (!x.valid_to || new Date(x.valid_to).getTime() > now + 1000));
    expect(inForce.map((x) => x.percent), 'after the re-release the store should run exactly the new version').toEqual([15]);
  });

  await test.step('⭐ OPT-OUT: every released offer applies — until the store declines one', async () => {
    await api(store.page, 'netOfferChoice', { params: { id: offerNow }, body: { choice: null } });
    expect((await api(page, 'netOfferPolicy', { body: { policy: 'opt_out' } })).ok).toBe(true);
    expect(netOffersIn(await snap(store.page, key), offerNow).length, 'opt-out did not apply a released offer').toBe(1);
    await api(store.page, 'netOfferChoice', { params: { id: offerNow }, body: { choice: 'out' } });
    expect(netOffersIn(await snap(store.page, key), offerNow).length, 'a declined offer still reached the counter').toBe(0);
  });

  await test.step('⚠️ withdrawn NOW — the counter is told the offer has ended', async () => {
    await api(store.page, 'netOfferChoice', { params: { id: offerNow }, body: { choice: null } });
    const w = await api(page, 'netOfferWithdraw', { params: { id: offerNow }, body: { at: 'now' } });
    expect(w.ok, w.message).toBe(true);
    const o = netOffersIn(await snap(store.page, key), offerNow)[0];
    expect(o && o.valid_to, 'a withdrawn offer carried no end').toBeTruthy();
    expect(new Date(o.valid_to).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  await store.context.close();
});

// [DEMO-PRESTIGE] A NETWORK BRAND, FIVE STORES, THEIR COUNTERS — built to be kept and looked at (Athi, 2026-09-17).
//
// *"Create a network store called Prestige, pull the catalogue from the net and upload, create 5 network stores underneath,
// then change the offer at the network level — it has to broadcast the offer to the store, and the store should push it to
// the counters."* · *"just 5 products, and images"* · *"first only the network root has the product; later when a new store
// is set up it inherits the product and its offer; then when the offer changes it gets that as well"* · *"use Playwright so
// each store and counter opens and performs a different activity, but still gets the offers."*
//
// ⚠️ RE-RUNNABLE: every account uses a fixed email (create-or-reuse), products are matched by name, counters by name, offers
// by name — running it twice tidies up rather than piling up.
// ⚠️ The product pictures are drawn here, not copied from a retailer: the names and list prices are public facts, the
// photographs are somebody's work.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { mintEntity, mintInContext, approveJoins } = require('../fixtures');

const OUT = path.join(__dirname, '..', 'demo-prestige-summary.json');
const SOURCE = 'prestige-home@v1';
const PRODUCTS = [
  { name: 'Prestige Apex Mixer Grinder 500W', category: 'Mixer grinders', mrp: 4035, hsn: '8509', code: 'PR-APEX-500', shape: 'mixer' },
  { name: 'Prestige Supreme Juicer Mixer Grinder 750W', category: 'Mixer grinders', mrp: 5995, hsn: '8509', code: 'PR-SUP-750', shape: 'mixer' },
  { name: 'Prestige PIC 16.0+ Induction Cooktop 2000W', category: 'Induction cooktops', mrp: 4685, hsn: '8516', code: 'PR-PIC16', shape: 'induction' },
  { name: 'Prestige PIC 20.0 Induction Cooktop 1600W', category: 'Induction cooktops', mrp: 4095, hsn: '8516', code: 'PR-PIC20', shape: 'induction' },
  { name: 'Prestige Marvel Plus GTM 02 Gas Hob', category: 'Gas stoves', mrp: 6860, hsn: '7321', code: 'PR-GTM02', shape: 'hob' },
];
const STORES = [
  { handle: 'prestige-annanagar', email: 'prestige.annanagar@test.example', area: 'Anna Nagar' },
  { handle: 'prestige-tnagar',    email: 'prestige.tnagar@test.example',    area: 'T Nagar' },
  { handle: 'prestige-velachery', email: 'prestige.velachery@test.example', area: 'Velachery' },
  { handle: 'prestige-adyar',     email: 'prestige.adyar@test.example',     area: 'Adyar' },
  { handle: 'prestige-omr',       email: 'prestige.omr@test.example',       area: 'OMR' },
];
const OFFER_A = 'Prestige Festive Mixer Offer';
const OFFER_B = 'Prestige Induction Week';

const log = [];
const note = (who, what) => { log.push({ at: new Date().toISOString(), who, what }); console.log('DEMO · ' + who + ' · ' + what); };

const call = (page, name, opts) => page.evaluate(async ({ name, opts }) => {
  try { return { ok: true, body: await api(name, opts || {}) }; }
  catch (e) { return { ok: false, message: (e && e.message) || String(e) }; }
}, { name, opts });

/** a product picture, drawn on a canvas in the page — no copied photograph */
const drawPicture = (page, p) => page.evaluate(({ p }) => {
  const c = document.createElement('canvas'); c.width = 480; c.height = 480;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 480); grad.addColorStop(0, '#f3f6f5'); grad.addColorStop(1, '#dfe8e5');
  g.fillStyle = grad; g.fillRect(0, 0, 480, 480);
  g.fillStyle = '#1f2a27'; g.strokeStyle = '#1f2a27'; g.lineWidth = 6;
  if (p.shape === 'mixer') {
    g.fillStyle = '#b8231b'; g.beginPath(); g.roundRect(150, 250, 180, 120, 18); g.fill();
    g.fillStyle = '#cfe3ef'; g.beginPath(); g.moveTo(170, 250); g.lineTo(190, 110); g.lineTo(290, 110); g.lineTo(310, 250); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#1f2a27'; g.fillRect(200, 92, 80, 20);
    g.beginPath(); g.arc(240, 310, 18, 0, Math.PI * 2); g.fillStyle = '#f3f6f5'; g.fill();
  } else if (p.shape === 'induction') {
    g.fillStyle = '#16201d'; g.beginPath(); g.roundRect(90, 140, 300, 230, 24); g.fill();
    g.strokeStyle = '#e46a3a'; g.lineWidth = 8; [70, 50, 30].forEach((r) => { g.beginPath(); g.arc(240, 240, r, 0, Math.PI * 2); g.stroke(); });
    g.fillStyle = '#9fb3ad'; for (let i = 0; i < 4; i++) g.fillRect(150 + i * 50, 335, 30, 14);
  } else {
    g.fillStyle = '#2b2b2b'; g.beginPath(); g.roundRect(60, 170, 360, 170, 20); g.fill();
    g.strokeStyle = '#c9ced1'; g.lineWidth = 7;
    [150, 330].forEach((x) => { g.beginPath(); g.arc(x, 250, 50, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x, 250, 22, 0, Math.PI * 2); g.stroke(); });
    g.fillStyle = '#c9ced1'; [150, 330].forEach((x) => { g.beginPath(); g.arc(x, 318, 9, 0, Math.PI * 2); g.fill(); });
  }
  g.fillStyle = '#0d6a5b'; g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('Prestige', 240, 60);
  g.fillStyle = '#56655f'; g.font = '500 17px system-ui, sans-serif'; g.fillText(p.category + ' · demo picture', 240, 440);
  return c.toDataURL('image/png').split(',')[1];
}, { p });

test('[DEMO-PRESTIGE] a brand, five stores, their counters, and an offer that travels', async ({ page, browser }) => {
  test.setTimeout(1500000);

  /* ════ 1 · THE NETWORK ROOT — only Prestige has the products ════ */
  await mintEntity(page, { fresh: true, email: 'prestige.brand@test.example', name: 'prestige-brand' });
  await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
  note('Prestige (brand)', 'signed in as prestige.brand@test.example');

  const sourceItems = [];
  for (const p of PRODUCTS) {
    let id = await page.evaluate(async (nm) => {
      const r = await api('prodList', { query: { limit: 200 } });
      const list = Array.isArray(r) ? r : ((r && (r.items || r.products)) || []);
      const hit = list.find((x) => String(((x.item_data || x).name) || '') === nm);
      return hit ? (hit.item_id || hit.id) : null;
    }, p.name);
    if (!id) {
      const made = await call(page, 'prodAdd', { body: { item_data: { name: p.name, price: p.mrp, mrp: p.mrp, unit: 'piece',
        category: p.category, hsn: p.hsn, code: p.code, brand: 'Prestige' } } });
      expect(made.ok, 'could not add ' + p.name + ': ' + made.message).toBe(true);
      id = await page.evaluate(async (nm) => {
        const r = await api('prodList', { query: { limit: 200 } });
        const list = Array.isArray(r) ? r : ((r && (r.items || r.products)) || []);
        const hit = list.find((x) => String(((x.item_data || x).name) || '') === nm);
        return hit ? (hit.item_id || hit.id) : null;
      }, p.name);
    }
    expect(id, 'no id for ' + p.name).toBeTruthy();
    const b64 = await drawPicture(page, p);
    const up = await call(page, 'prodMediaAdd', { params: { id }, body: { name: p.code + '.png', mime: 'image/png', data_base64: b64 } });
    expect(up.ok, 'picture upload failed for ' + p.name + ': ' + up.message).toBe(true);
    const image = await page.evaluate(async ({ id }) => {
      const r = await api('prodList', { query: { limit: 200 } });
      const list = Array.isArray(r) ? r : ((r && (r.items || r.products)) || []);
      const hit = list.find((x) => (x.item_id || x.id) === id);
      return hit ? ((hit.item_data || hit).image || null) : null;
    }, { id });
    expect(image, 'the picture did not become the product image: ' + p.name).toBeTruthy();
    sourceItems.push({ name: p.name, category: p.category, hsn: p.hsn, code: p.code, sku: p.code, mrp: p.mrp, unit: 'piece', brand: 'Prestige', image });
    note('Prestige (brand)', 'product ready with picture — ' + p.name + ' (MRP ₹' + p.mrp + ')');
  }
  const pub = await call(page, 'catSourcePut', { body: { source_key: SOURCE, title: 'Prestige', collection: 'Prestige Home Appliances', items: sourceItems } });
  expect(pub.ok, 'publishing the network catalogue failed: ' + pub.message).toBe(true);
  note('Prestige (brand)', 'published the network catalogue "' + SOURCE + '" with ' + sourceItems.length + ' products');

  expect((await call(page, 'netOfferPolicy', { body: { policy: 'opt_out' } })).ok).toBe(true);
  note('Prestige (brand)', 'network model: every released offer applies unless a store declines it (opt-out)');

  const offerId = async (name, rules) => {
    const v = await call(page, 'netOffers');
    const found = ((v.body && v.body.brand && v.body.brand.offers) || []).find((o) => o.name === name);
    if (found) {
      await call(page, 'defSave', { params: { id: found.id }, body: { rules } });
      return found.id;
    }
    const r = await call(page, 'defAdd', { body: { kind: 'offer', sub_kind: rules.kind, name, status: 'live', confirmed: true, rules } });
    expect(r.ok, 'offer ' + name + ': ' + r.message).toBe(true);
    return r.body.definition_id || (r.body.definition && r.body.definition.definition_id) || r.body.id;
  };
  const A = await offerId(OFFER_A, { kind: 'percent_off', label: 'Festive 10% off mixer grinders', percent: 10, scope: 'line', applies_to: { category: 'Mixer grinders' } });
  const relA = await call(page, 'netOfferRelease', { params: { id: A }, body: { at: 'now' } });
  expect(relA.ok, relA.message).toBe(true);
  note('Prestige (brand)', 'released "' + OFFER_A + '" (10% off mixer grinders) — NOW, for the demo; the default would be the next opening');

  /* ════ 2 · THE STORES ARRIVE LATER — each inherits the products and the running offer ════ */
  const stores = [];
  for (const s of STORES) {
    const st = await mintInContext(browser, { fresh: true, email: s.email, name: s.handle });
    await st.page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); });
    /* each store prices the network's products itself — Anna Nagar sells the Apex below MRP */
    const commercials = {};
    for (const p of PRODUCTS) commercials[p.name] = { price: (s.area === 'Anna Nagar' && p.code === 'PR-APEX-500') ? 3799 : p.mrp, unit: 'piece' };
    /* ⭐ JOINING THE NETWORK (Athi, 2026-09-17: "the network has to approve"): Prestige INVITES this existing store, and the store
       ACCEPTS — the network's own edge. A re-run finds it already in and moves on. */
    const myHandle = await st.page.evaluate(async () => { const me = await api('me'); const e = (me && me.entity) || me || {}; return e.user_id || e.bridge_id; });
    await call(page, 'netConnect', { body: { childHandle: myHandle, type: 'commercial' } });
    const mine = ((await call(st.page, 'netOffers')).body.store.networks || []).find((n) => n.membership && n.membership.state === 'invited');
    if (mine) {
      const acc = await call(st.page, 'netApprove', { params: { id: mine.membership.edge_id }, body: {} });
      expect(acc.ok, s.area + ' could not accept the invitation: ' + acc.message).toBe(true);
      note(s.area, 'accepted Prestige\'s invitation to its network');
    }
    const ad = await call(st.page, 'catalogueAdopt', { body: { source: SOURCE, commercials } });
    expect(ad.ok, s.area + ' could not adopt the network catalogue: ' + ad.message).toBe(true);
    /* the store's own particulars — what its counter prints at the top of every bill */
    const idt = await call(st.page, 'vaultSave', { body: { vault: { sections: [{ type: 'identity', label: 'Business identity', rows: [
      { name: 'Trade / brand name', value: 'Prestige Smart Kitchen · ' + s.area, tag: 'trade_name' },
      { name: 'City', value: 'Chennai', tag: 'city' }, { name: 'State', value: 'Tamil Nadu', tag: 'state' }] }] } } });
    expect(idt.ok, s.area + ' could not save its trade name: ' + idt.message).toBe(true);
    /* a clean slate on re-runs: no leftover choice */
    await call(st.page, 'netOfferChoice', { params: { id: A }, body: { choice: null } });
    /* the store's counter — reused by name, released if a previous run left it held */
    const cname = 'Billing desk 1';
    let list = (await call(st.page, 'counters')).body.counters || [];
    let c = list.find((x) => x.name === cname);
    if (!c) c = (await call(st.page, 'counterAdd', { body: { name: cname } })).body.counter;
    if (c.state !== 'closed') await call(st.page, 'counterRelease', { params: { id: c.id } });
    const open = await call(st.page, 'counterOpen', { params: { id: c.id } });
    expect(open.ok, s.area + ' could not open its counter: ' + open.message).toBe(true);
    const till = await st.context.newPage();
    await till.goto('/till.html#key=' + encodeURIComponent(open.body.key));
    await till.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 60000 });
    await till.evaluate(() => refresh());
    const seen = await till.evaluate(() => ({
      products: (S.items || []).filter((i) => i.source).map((i) => ({ name: i.name, price: i.price, image: !!i.image })),
      offers: (S.offers || []).filter((o) => o.network).map((o) => ({ label: o.label, percent: o.percent, from: o.valid_from })),
      counter: tillId(),
      shop: S.shop && S.shop.name, address: S.shop && S.shop.address,
    }));
    expect(seen.products.length, s.area + '\'s counter does not have the network products').toBe(5);
    expect(seen.products.every((x) => x.image), s.area + '\'s counter is missing product pictures').toBe(true);
    expect(seen.offers.some((o) => o.percent === 10), s.area + ' did not inherit the running offer').toBe(true);
    expect(seen.shop, s.area + ' — the counter does not show its trade name').toBe('Prestige Smart Kitchen · ' + s.area);
    note(s.area, 'store "' + seen.shop + '" (' + seen.address + ') set up; adopted the network catalogue; counter ' + seen.counter + ' opened with ' + seen.products.length
      + ' products (all with pictures) and inherited "' + OFFER_A + '" at 10%');
    /* ⚠️ MEMORY: seven browser windows at once got the run stopped. The store's app page has done its job — Adyar makes
       its choice first — and only the counters stay open for billing. */
    if (s.area === 'Adyar') {
      await call(st.page, 'netOfferChoice', { params: { id: A }, body: { choice: 'out' } });
      note('Adyar', 'declined "' + OFFER_A + '" for this store');
    }
    await st.page.close().catch(() => {});
    stores.push(Object.assign({}, s, { ctx: st.context, till, counter: c.id, key: open.body.key }));
  }

  const adyar = stores.find((x) => x.area === 'Adyar');

  /* ════ 4 · THE BRAND CHANGES THE OFFER — broadcast to every store, pushed to every counter ════ */
  await call(page, 'defSave', { params: { id: A }, body: { rules: { kind: 'percent_off', label: 'Festive 15% off mixer grinders', percent: 15, scope: 'line', applies_to: { category: 'Mixer grinders' } } } });
  note('Prestige (brand)', 'changed "' + OFFER_A + '" from 10% to 15% — not yet released, so every store still runs 10%');
  const stillTen = await stores[0].till.evaluate(async () => {
    const r = await fetch(CloudHost.api + '/api/till/snapshot', { headers: { 'X-Api-Key': CloudHost.key } });
    const j = await r.json();
    return (j.offers || []).filter((o) => o.network).map((o) => o.percent);
  });
  expect(stillTen, 'an unreleased change reached a store').toContain(10);
  const relA2 = await call(page, 'netOfferRelease', { params: { id: A }, body: { at: 'now' } });
  expect(relA2.ok, relA2.message).toBe(true);
  note('Prestige (brand)', 'released the change — told ' + relA2.body.pushed.stores + ' store(s)');

  const B = await offerId(OFFER_B, { kind: 'percent_off', label: 'Induction week 5% off', percent: 5, scope: 'line', applies_to: { category: 'Induction cooktops' } });
  const relB = await call(page, 'netOfferRelease', { params: { id: B }, body: {} });
  expect(relB.ok, relB.message).toBe(true);
  note('Prestige (brand)', 'released "' + OFFER_B + '" (5% off induction cooktops) for the NEXT OPENING — ' + relB.body.release.at);

  /* every counter should hear about it by PUSH — no refresh pressed here */
  for (const st of stores) {
    const want = st.area === 'Adyar' ? 'none' : 15;
    let got = null;
    for (let i = 0; i < 45; i++) {
      got = await st.till.evaluate(() => {
        const now = Date.now();
        const live = (S.offers || []).filter((o) => o.network && (!o.valid_from || new Date(o.valid_from).getTime() <= now)
          && (!o.valid_to || new Date(o.valid_to).getTime() > now) && /Mixer/i.test(JSON.stringify(o.applies_to || {})));
        const later = (S.offers || []).filter((o) => o.network && o.valid_from && new Date(o.valid_from).getTime() > now);
        return { percents: live.map((o) => o.percent), later: later.map((o) => o.label) };
      });
      if (want === 'none' ? got.percents.length === 0 : got.percents.indexOf(15) >= 0) break;
      await st.till.waitForTimeout(2000);
    }
    if (want === 'none') expect(got.percents, 'Adyar declined, yet its counter runs the mixer offer').toEqual([]);
    else expect(got.percents, st.area + '\'s counter never received the change').toEqual([15]);
    note(st.area, 'counter received the change by push — mixer offer now ' + (want === 'none' ? 'not applied (declined)' : '15%')
      + (got.later.length ? '; waiting for the next opening: ' + got.later.join(', ') : ''));
  }

  /* ════ 5 · EACH COUNTER DOES SOMETHING DIFFERENT — and the offer is on the bill ════
     ⚠️ MEMORY: five counters open at once crashed a tab on this machine. They were all open together for the push proof
     above; for billing, each store's counter is reopened on its own and closed again. Same key, same counter, same copy. */
  for (const st of stores) { await st.till.close().catch(() => {}); st.till = null; }
  const reopen = async (st) => {
    const t = await st.ctx.newPage();
    t.on('crash', () => note(st.area, '⚠️ the counter tab CRASHED'));
    await t.goto('/till.html#key=' + encodeURIComponent(st.key));
    await t.waitForFunction(() => window.CBOffers && window.CBTax, null, { timeout: 60000 });
    await t.evaluate(() => refresh());
    await t.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });
    st.till = t;
    return t;
  };
  const done = async (st) => {
    await st.till.evaluate(() => HOST.drain()).catch(() => {});
    let pend = 0;
    for (let i = 0; i < 10; i++) {
      pend = await st.till.evaluate(async () => ((await DB.all('queue')) || []).length).catch(() => -1);
      if (pend === 0) break;
      await st.till.waitForTimeout(1500);
      await st.till.evaluate(() => HOST.drain()).catch(() => {});
    }
    note(st.area, pend === 0 ? 'every bill reached ChitBridge' : (pend + ' bill(s) still sending'));
  };
  const bill = async (st, picks, pay) => {
    const t = st.till;
    /* ⚠️ say what, if anything, is covering the counter — a modal makes the search box uneditable */
    const cover = await t.evaluate(() => ({ dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => d.id + ': ' + (d.innerText || '').slice(0, 120)),
      breakOn: !document.getElementById('breakcover') || !document.getElementById('breakcover').hidden }));
    if (cover.dialogs.length || cover.breakOn) note(st.area, 'before billing, the counter was covered by: ' + JSON.stringify(cover));
    await t.screenshot({ path: require('path').join(__dirname, '..', 'demo-' + st.handle + '-before-bill.png') }).catch(() => {});
    for (const [code, qty] of picks) {
      try { await t.fill('#q', code, { timeout: 8000 }); }
      catch (e) {
        const why = await t.evaluate(() => {
          const q = document.getElementById('q');
          const chain = []; for (let n = q; n; n = n.parentElement) {
            if (n.hasAttribute && (n.hasAttribute('inert') || n.getAttribute('aria-disabled') === 'true' || n.disabled))
              chain.push((n.id || n.tagName) + (n.hasAttribute('inert') ? ' inert' : '') + (n.getAttribute('aria-disabled') ? ' aria-disabled' : '') + (n.disabled ? ' disabled' : ''));
          }
          return { dialogs: [...document.querySelectorAll('dialog')].filter((d) => d.open).map((d) => d.id + ' :: ' + (d.innerText || '').slice(0, 200)),
                   blockedBy: chain, readOnly: q.readOnly, disabled: q.disabled, active: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
                   bodyInert: document.body.inert };
        });
        note(st.area, 'SEARCH BOX NOT EDITABLE: ' + JSON.stringify(why));
        await t.screenshot({ path: require('path').join(__dirname, '..', 'demo-' + st.handle + '-stuck.png') }).catch(() => {});
        throw e;
      }
      /* ⚠️ AN EXACT CODE IS A SCAN — the counter has already put it on the bill ([TILL-27]); pressing + as well billed two */
      const onBill = await t.evaluate((code) => CART.some((c) => { const i = (S.items || []).find((x) => x.item_id === c.item_id); return i && i.code === code; }), code);
      if (!onBill) await t.click('[data-testid="till-add-0"]');
      if (qty > 1) {
        const n = await t.evaluate((code) => CART.findIndex((c) => { const i = (S.items || []).find((x) => x.item_id === c.item_id); return i && i.code === code; }), code);
        await t.fill('[data-testid="till-qty-' + n + '"]', String(qty));
        await t.locator('[data-testid="till-qty-' + n + '"]').dispatchEvent('change');
      }
    }
    const money = await t.evaluate(() => { const m = billMoney(); return { gross: m.gross, net: m.net, off: m.save }; });
    await t.click('[data-testid="till-pay-' + pay + '"]').catch(() => t.click('[data-testid="till-pay-cash"]'));
    await t.fill('#tendered', String(Math.ceil(money.net))).catch(() => {});
    await t.click('#save');
    /* ⚠️ the dialog opens titled just "Bill" — the number arrives a moment later */
    await expect(t.locator('#sliptitle')).toHaveText(/^Bill \S+ ·/, { timeout: 20000 });
    const no = (await t.locator('#sliptitle').textContent()).replace('Bill ', '').split(' ·')[0].trim();
    await t.click('#slipdlg button:has-text("Close")').catch(() => {});
    return Object.assign({ no }, money);
  };

  /* ⚠️ a tab that crashes is reopened and the activity tried once more — a starved machine must not sink the demo */
  const attempt = async (st, label, fn) => {
    for (let i = 1; i <= 2; i++) {
      try { await fn(); return; }
      catch (e) {
        note(st.area, label + ' — attempt ' + i + ' failed: ' + String(e.message || e).split(String.fromCharCode(10))[0]);
        try { if (st.till) await st.till.close(); } catch (_) {}
        if (i === 2) throw e;
      }
    }
  };
  /* the brand's work is done — its heavy app page is closed to give the counters room */
  await page.close().catch(() => {});
  const an = stores.find((x) => x.area === 'Anna Nagar');
  await attempt(an, 'billing', async () => {
    await reopen(an);
    const r = await bill(an, [['PR-APEX-500', 1]], 'cash'); expect(r.net, 'the bill total is wrong — a line was added twice, or the offer did not apply').toBeCloseTo(3229.15, 2);
    await done(an); await an.till.close();
    note('Anna Nagar', 'billed ' + r.no + ' — Apex mixer at the store\'s own ₹3,799, 15% network offer applied (₹' + r.off + ' off): ₹' + r.net + ' (cash)');
  });

  const tn = stores.find((x) => x.area === 'T Nagar');
  await attempt(tn, 'billing', async () => {
    await reopen(tn);
    const r = await bill(tn, [['PR-SUP-750', 1], ['PR-PIC16', 1]], 'upi'); expect(r.net, 'the bill total is wrong — a line was added twice, or the offer did not apply').toBeCloseTo(9780.75, 2);
    await done(tn); await tn.till.close();
    note('T Nagar', 'billed ' + r.no + ' — Supreme juicer mixer (15% off) + PIC 16.0 (its offer starts at the next opening): ₹' + r.net + ' (₹' + r.off + ' off, UPI)');
  });

  const ve = stores.find((x) => x.area === 'Velachery');
  await attempt(ve, 'park and break', async () => {
    await reopen(ve);
    await ve.till.fill('#q', 'PR-GTM02'); await ve.till.click('[data-testid="till-add-0"]');
    await ve.till.evaluate(() => parkBill());
    await ve.till.evaluate(() => takeBreak());
    await expect(ve.till.locator('[data-testid="till-break-cover"]')).toBeVisible();
    await ve.till.waitForTimeout(2000);           /* let "on break" reach ChitBridge */
    await ve.till.close();
    note('Velachery', 'parked a gas-hob bill for a customer who stepped away, then went ON BREAK — left on break for you to see');
  });

  await attempt(adyar, 'billing', async () => {
    await reopen(adyar);
    const r = await bill(adyar, [['PR-APEX-500', 1]], 'cash'); expect(r.net, 'the bill total is wrong — a line was added twice, or the offer did not apply').toBeCloseTo(4035, 2);
    await done(adyar); await adyar.till.close();
    note('Adyar', 'billed ' + r.no + ' — Apex mixer at full ₹4,035; the store declined the network offer, so ₹' + r.off + ' off: ₹' + r.net + ' (cash)');
  });

  const om = stores.find((x) => x.area === 'OMR');
  await attempt(om, 'billing', async () => {
    await reopen(om);
    const r = await bill(om, [['PR-GTM02', 2], ['PR-APEX-500', 1]], 'cash'); expect(r.net, 'the bill total is wrong — a line was added twice, or the offer did not apply').toBeCloseTo(17149.75, 2);
    await done(om); await om.till.close();
    note('OMR', 'billed ' + r.no + ' — 2 × gas hob + Apex mixer (15% off the mixer, ₹' + r.off + ' off): ₹' + r.net + ' (cash)');
  });

  /* ════ 6 · THE SUMMARY ════ */
  fs.writeFileSync(OUT, JSON.stringify({ ran: new Date().toISOString(), source: SOURCE, activities: log,
    sign_in: { otp: '<the tester code — E2E_TESTER_CODE, shared privately>', brand: 'prestige.brand@test.example', stores: STORES.map((s) => ({ area: s.area, email: s.email })) } }, null, 2));
  for (const st of stores) await st.ctx.close().catch(() => {});
});

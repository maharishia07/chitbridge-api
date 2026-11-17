#!/usr/bin/env node
/**
 * e2e/walk-rate-screens.cjs - THE OWNER SETS A GST RATE, ON THE ITEM AND AT THE COUNTER (F5 W1a, 2026-10-24; walk R122, P1).
 * Black box over a stand-in api: catalogue.html's item sheet (the amber "No GST rate yet" chip, ONE Set rate, the ask-once menu with the pack's
 * suggestion first, a confirm BEFORE the one PATCH, the row repainted in place) and till.html's bill ("1 item has no tax rate" → Fix opens the
 * ask-once sheet for an owner, a confirm BEFORE POST /api/till/rate, the line re-prices through the engine; a cashier or a keyed counter sees Fix
 * greyed WITH the server's own sentence; a 403 is said in words). The confirm is the page's <dialog open> (no role attribute): select dialog[open].
 * Screens: public/catalogue.html + app/cap-catalogue.js (the rate row), app/tax-slab-ui.js (the chip, the menu, the pickers moved out of app.html and
 * app/cap-categories.js), public/till.html (rateAskOpen · rateAskPick). Every word on the catalogue goes through the string layer (T( → tx); the
 * counter's are its own English, as the rest of till.html.
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-rate-screens.cjs          the stand-in
 *   node e2e/walk-rate-screens.cjs --show                                   watch it
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-rate-screens-NN.png.
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const J = C.json;

/* the fixture shop: a regular GST registration (so the shop CHARGES), two live slabs on today's menu plus a dead 12%, Veg Meals coded 996331 with no rate */
const SHOP = { display_name: 'Kaveri Mess', currency_code: 'INR', country_code: 'IN', country: 'IN', gstn: '33AAAAA0000A1Z5', policy_flags: {} };
const SLABS = [
  { definition_id: 's5', kind: 'tax', name: 'GST 5%', status: 'live', rules: { rate: 5 }, current_version: 1 },
  { definition_id: 's12', kind: 'tax', name: 'GST 12%', status: 'live', rules: { rate: 12 }, current_version: 1 },
  { definition_id: 's18', kind: 'tax', name: 'GST 18%', status: 'live', rules: { rate: 18 }, current_version: 1 }
];
const CATS = [{ definition_id: 'c1', kind: 'category', name: 'Meals', status: 'live', rules: { parent: null }, current_version: 1 }];
const fixtureItems = () => [
  { item_id: 'veg', item_data: { name: 'Veg Meals', unit: 'plate', price: { amount: 120, currency: 'INR' }, code: '996331', categories: ['c1'], status: 'available' } },
  { item_id: 'tea', item_data: { name: 'Tea', unit: 'cup', price: { amount: 15, currency: 'INR' }, status: 'available' } }
];

const walk = async (w) => {
  const { page, ctx, base } = w;
  const S = { calls: [], items: fixtureItems(), rate: { status: 200 } };
  const sess = W.session('Kaveri Owner', 'Kaveri Mess');
  await ctx.addInitScript((a) => { try { localStorage.setItem('cb_api_base', a.api); localStorage.setItem('cb_sess', a.sess); } catch (_) {} }, { api: base, sess });
  const wrote = (re) => S.calls.filter((c) => re.test(c));
  const txt = async (sel) => { const el = await page.$(sel); return el ? (await el.innerText()).replace(/\s+/g, ' ').trim() : ''; };
  await ctx.route('**/api/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
    let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch (_) {}
    if (m !== 'GET') S.calls.push(m + ' ' + p + (body ? ' ' + JSON.stringify(body) : ''));
    if (p === '/api/entities/me') return J(r, 200, { entity: SHOP });
    if (p === '/api/entities/me/can-see-costs') return J(r, 200, { can_see_costs: true, is_owner: true });
    if (p === '/api/facts/rail') return J(r, 200, { suppliers: 0, customers: 0, in: 0, out: 0, stuck: 0 });
    if (p === '/api/schemas/fields') return J(r, 200, { fields: [] });
    if (p === '/api/catalogue-face') return J(r, 200, { face: {} });
    if (p === '/api/definitions' && m === 'GET') { const kinds = (u.searchParams.get('kind') || '').split(','); return J(r, 200, { definitions: SLABS.concat(CATS).filter((d) => !kinds[0] || kinds.indexOf(d.kind) >= 0) }); }
    if (p === '/api/products' && m === 'GET') return J(r, 200, { items: S.items, count: S.items.length, total: S.items.length, offset: 0, limit: 100, truncated: false, status_counts: { available: 2, unavailable: 0, redundant: 0, retired: 0 }, category_counts: { c1: 1 }, uncategorised: 1 });
    if (/^\/api\/products\/[^/]+$/.test(p) && m === 'PATCH') {
      const it = S.items.filter((x) => x.item_id === p.split('/').pop())[0];
      if (it && body && body.merge) Object.keys(body.item_data || {}).forEach((k) => { if (body.item_data[k] === null) delete it.item_data[k]; else it.item_data[k] = body.item_data[k]; });
      return J(r, 200, { message: 'Product updated', item: it });
    }
    if (p === '/api/till/rate' && m === 'POST') {
      if (S.rate.status !== 200) return J(r, S.rate.status, { error: 'Forbidden', code: 'TILL_RATE_OWNER_ONLY', message: 'Ask the owner or a manager to set the tax rate.', may: false, why: 'Ask the owner or a manager to set the tax rate.' });
      return J(r, 200, { ok: true, item_id: body.item_id, slab_id: body.slab_id, rate: 5, changed: true, words: 'Veg Meals now carries GST 5%.' });
    }
    /* the counter's own sync (snapshot · verify · bills) is refused, so the shop set up inside the page stays the shop under test */
    if (p.indexOf('/api/till/') === 0) return J(r, 404, { error: 'not found' });
    return J(r, 200, { ok: true });
  });

  /* ── catalogue.html ── */
  const openSheet = async () => {
    await page.goto(base + '/catalogue.html?t=' + Date.now() + '#/items');   /* clock-ok: a cache-busting suffix */
    await page.waitForSelector('[data-testid="cat-row-veg"]', { timeout: 30000 });
    await page.click('[data-testid="cat-row-veg"]');
    await page.waitForSelector('[data-testid="cat-tax-chip"]', { timeout: 8000 });
  };
  await w.step('R1', 'Catalogue -> Veg Meals -> the sheet shows a GST row: the amber "No GST rate yet" chip and ONE Set rate button', async () => {
    await openSheet();
    const chip = await txt('[data-testid="cat-tax-chip"]'), tone = await page.getAttribute('[data-testid="cat-tax-chip"]', 'data-tone');
    const set = await page.$('[data-testid="cat-rate-set"]'), label = await txt('[data-testid="cat-tax-row"] b');
    return { ok: /No GST rate yet/.test(chip) && tone === 'none' && !!set && label === 'GST', saw: label + ' · ' + chip + ' · ' + (set ? 'Set rate' : 'no button') };
  });
  await w.step('R2', 'Set rate -> the menu: the suggestion "996331 · restaurant · 5%" FIRST with Use and ⓘ, then 18%; the dead 12% is not offered', async () => {
    await page.click('[data-testid="cat-rate-set"]');
    await page.waitForSelector('[data-testid="rate-menu"]', { timeout: 5000 });
    const btns = await page.$$eval('[data-testid="rate-menu"] button', (els) => els.map((e) => e.getAttribute('data-testid') + ':' + e.innerText.replace(/\s+/g, ' ').trim()));
    const cite = await page.$('[data-testid="rate-cite"]');
    return { ok: btns.length === 2 && /^rate-pick-s5:996331 · restaurant · 5% Use/.test(btns[0]) && /^rate-pick-s18:GST 18%/.test(btns[1]) && !!cite, saw: btns.join(' | ') + (cite ? ' · ⓘ' : ' · no ⓘ') };
  });
  await w.step('R3', 'Use -> a CONFIRM (dialog[open]) names the item and the rate; NOTHING is written yet', async () => {
    const before = wrote(/PATCH/).length;
    await page.click('[data-testid="rate-pick-s5"]');
    await page.waitForSelector('dialog[open][data-testid="confirm"]', { timeout: 5000 });
    const words = await txt('dialog[open][data-testid="confirm"]');
    return { ok: /Veg Meals: GST 5%\?/.test(words) && wrote(/PATCH/).length === before, saw: words.slice(0, 90) + ' · PATCHes so far: ' + (wrote(/PATCH/).length - before) };
  });
  await w.step('R4', 'Set rate (confirm) -> ONE PATCH, merge:true, exactly what setOn writes (tax_slab · tax_slab_name · gst_rate); the row repaints in place "GST 5% on this item"', async () => {
    const before = wrote(/PATCH/).length;
    await page.click('dialog[open] [data-testid="confirm-ok"]');
    await page.waitForFunction(() => { const c = document.querySelector('[data-testid="cat-tax-chip"]'); return c && c.getAttribute('data-tone') === 'rate'; }, null, { timeout: 8000 });
    const patches = wrote(/PATCH \/api\/products\/veg/), last = patches[patches.length - 1] || '';
    let b = null; try { b = JSON.parse(last.slice(last.indexOf(' {'))); } catch (_) {}
    const exact = b && b.merge === true && Object.keys(b.item_data).sort().join(',') === 'gst_rate,tax_slab,tax_slab_name' && b.item_data.tax_slab === 's5' && b.item_data.gst_rate === 5;
    const row = await txt('[data-testid="cat-tax-row"]'), out = await txt('[data-testid="cat-sheet-out"]'), still = await page.$('[data-testid="cat-sheet-title"]');
    return { ok: patches.length - before === 1 && exact && /GST 5%/.test(row) && /on this item/.test(row) && /now carries GST 5%/.test(out) && !!still, saw: (patches.length - before) + ' PATCH ' + JSON.stringify(b && b.item_data) + ' · ' + row + ' · "' + out + '"' };
  });

  /* ── till.html: the counter, as a PERSON session (the credential the server reads) ── */
  const tillAs = async (person, staff) => {
    await page.goto(base + '/till.html?t=' + Date.now());   /* clock-ok: a cache-busting suffix */
    await page.waitForFunction(() => typeof window.rateAskOpen === 'function' && typeof window.addItem === 'function', null, { timeout: 30000 });
    await page.waitForTimeout(600);   /* the page's own boot settles (its sync is refused above) before the shop is set up inside it */
    await page.evaluate(([api, person, staff, slabs, at]) => {
      CloudHost.api = api; CloudHost.key = person ? null : 'k'; CloudHost.person = person; HOST = CloudHost;
      window.lineUp = function () { return true; };
      window.S = { shop: { name: 'Kaveri Mess', gstin: '33AAAAA0000A1Z5', reg_type: 'regular', country: 'IN', state_code: '33' }, at: at,   /* the one injected today (QW1-TODAY), never the runner's clock */
        items: [{ item_id: 'veg', name: 'Veg Meals', unit: 'plate', price: 120, code: '996331', categories: ['c1'] }], slabs: slabs, categories: [], face: {}, staff: staff || [], policy: {} };
      CART.length = 0; setMode('sell'); addItem(S.items[0]); price();
    }, [base, person, staff || [], SLABS, W.nowIso()]);
    await page.waitForSelector('[data-testid="till-warn-norate"]', { timeout: 8000 });
  };
  const OWNER = { token: 't', entity_id: 'e1', kind: 'entity', identity_id: 'ent1', by: 'ent1' };
  await w.step('T1', 'Counter (owner signed in) -> Veg Meals on the bill -> "1 item has no tax rate" with Fix ENABLED', async () => {
    await tillAs(OWNER);
    const row = await txt('[data-testid="till-warn-norate"]'), dis = await page.getAttribute('[data-testid="till-warn-norate-fix"]', 'disabled');
    return { ok: /1 item has no tax rate/.test(row) && dis === null, saw: row + (dis === null ? ' · Fix enabled' : ' · Fix DISABLED') };
  });
  await w.step('T2', 'Fix -> the ask-once sheet "Veg Meals: GST?" with the suggestion first (Use), 18% after, never 12%', async () => {
    await page.click('[data-testid="till-warn-norate-fix"]');
    await page.waitForSelector('dialog[open][data-testid="till-rate"]', { timeout: 5000 });
    const title = await txt('[data-testid="till-rate-title"]');
    const btns = await page.$$eval('[data-testid="till-rate"] [data-testid="rate-menu"] button', (els) => els.map((e) => e.getAttribute('data-testid') + ':' + e.innerText.replace(/\s+/g, ' ').trim()));
    return { ok: title === 'Veg Meals: GST?' && btns.length === 2 && /^rate-pick-s5:996331 · restaurant · 5% Use/.test(btns[0]) && /^rate-pick-s18:/.test(btns[1]), saw: title + ' · ' + btns.join(' | ') };
  });
  await w.step('T3', 'Use -> the counter CONFIRMS (dialog[open]) before anything is sent; nothing posted yet', async () => {
    const before = wrote(/POST \/api\/till\/rate/).length;
    await page.click('[data-testid="till-rate"] [data-testid="rate-pick-s5"]');
    await page.waitForSelector('dialog#askdlg[open]', { timeout: 5000 });
    const words = await txt('#askdlg[open]'), ok = await txt('[data-testid="till-ask-ok"]');
    return { ok: /Veg Meals: GST 5% from now on/.test(words) && ok === 'Set rate' && wrote(/POST \/api\/till\/rate/).length === before, saw: words.slice(0, 80) + ' · [' + ok + '] · posts: ' + (wrote(/POST \/api\/till\/rate/).length - before) };
  });
  await w.step('T4', 'Set rate -> ONE POST /api/till/rate { item_id, slab_id }; the line re-prices through the engine (5%), the warning leaves the bill, the outcome is said', async () => {
    const before = wrote(/POST \/api\/till\/rate/).length;
    await page.click('[data-testid="till-ask-ok"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="till-warn-norate"]'), null, { timeout: 8000 });
    const posts = wrote(/POST \/api\/till\/rate/), last = posts[posts.length - 1] || '';
    let b = null; try { b = JSON.parse(last.slice(last.indexOf(' {'))); } catch (_) {}
    const st = await page.evaluate(() => ({ rate: CART[0] && CART[0].gst_rate, tax: CART[0] && CART[0].tax, cgst: CART[0] && CART[0].cgst, sgst: CART[0] && CART[0].sgst, incl: taxIncluded(), slab: S.items[0].tax_slab, name: S.items[0].tax_slab_name, note: (document.getElementById('lastnote') || {}).textContent, open: !!(document.querySelector('[data-testid="till-rate"]') || {}).open }));
    const exact = b && b.item_id === 'veg' && b.slab_id === 's5' && Object.keys(b).length === 2;
    /* the walk's pass figure (plan v2, critic 9): ₹120 INCLUDING tax (the India pack's prices_include_tax) → GST 5.72 as CGST 2.86 + SGST 2.86, each head rounded on its own */
    const money = st.incl ? st.cgst === 2.86 && st.sgst === 2.86 && st.tax === 5.72 : st.tax === 6;
    return { ok: posts.length - before === 1 && exact && st.rate === 5 && st.slab === 's5' && st.name === 'GST 5%' && /now carries GST 5%/.test(st.note) && !st.open && money,
      saw: (posts.length - before) + ' POST ' + last.slice(last.indexOf(' {')) + ' · line rate ' + st.rate + ' · ' + (st.incl ? 'incl.' : 'excl.') + ' GST ' + st.tax + ' (CGST ' + st.cgst + ' + SGST ' + st.sgst + ') · "' + st.note + '"' };
  });
  await w.step('T5', 'a CASHIER (hat act) -> Fix is SHOWN, greyed, with the server\'s own sentence beside it', async () => {
    await tillAs({ token: 't', entity_id: 'e1', kind: 'coassist', identity_id: 'a1', by: 'a1' }, [{ id: 'a1', name: 'Bala', hat: 'act' }]);
    const row = await txt('[data-testid="till-warn-norate"]'), dis = await page.getAttribute('[data-testid="till-warn-norate-fix"]', 'disabled');
    return { ok: dis !== null && /Ask the owner or a manager to set the tax rate/.test(row), saw: row + (dis !== null ? ' · Fix greyed' : ' · Fix ENABLED') };
  });
  await w.step('T6', 'a MANAGER (hat manager) -> Fix enabled; a KEYED counter (no person) -> greyed', async () => {
    await tillAs({ token: 't', entity_id: 'e1', kind: 'coassist', identity_id: 'm1', by: 'm1' }, [{ id: 'm1', name: 'Mani', hat: 'manager' }]);
    const mgr = await page.getAttribute('[data-testid="till-warn-norate-fix"]', 'disabled');
    await tillAs(null);
    const key = await page.getAttribute('[data-testid="till-warn-norate-fix"]', 'disabled');
    return { ok: mgr === null && key !== null, saw: 'manager ' + (mgr === null ? 'enabled' : 'greyed') + ' · key ' + (key !== null ? 'greyed' : 'enabled') };
  });
  await w.step('T7', 'the server refuses (403 TILL_RATE_OWNER_ONLY) -> ITS sentence in the sheet, in words; the line keeps no rate', async () => {
    S.rate.status = 403;
    await tillAs(OWNER);
    await page.click('[data-testid="till-warn-norate-fix"]'); await page.waitForSelector('dialog[open][data-testid="till-rate"]', { timeout: 5000 });
    await page.click('[data-testid="till-rate"] [data-testid="rate-pick-s5"]'); await page.waitForSelector('dialog#askdlg[open]', { timeout: 5000 });
    await page.click('[data-testid="till-ask-ok"]');
    await page.waitForFunction(() => { const o = document.getElementById('rateout'); return o && !o.hidden && o.textContent; }, null, { timeout: 8000 });
    const said = await txt('[data-testid="till-rate-out"]'), rate = await page.evaluate(() => CART[0] && CART[0].gst_rate);
    S.rate.status = 200;
    return { ok: /Ask the owner or a manager/.test(said) && rate == null, saw: '"' + said + '" · line rate ' + rate };
  });
};

W.run('rate-screens', walk);

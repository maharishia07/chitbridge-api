#!/usr/bin/env node
/**
 * e2e/walk-rate-sources.cjs - A RATE FROM THE CATEGORY OR THE SHOP DEFAULT; THE ITEM GOES INTO A CATEGORY; HSN SAVED (F5 W1b, 2026-10-24; walk R85).
 * Black box over a stand-in api, catalogue.html only (the shop default's Save in Catalogue setup is proved in e2e/rate-sources.test.cjs; the till is
 * vendored and untouched). The paths: the category sheet's rate picker → a confirm BEFORE the one PUT → the outcome where the list is → the item
 * chip reads "GST 5% · from category Meals"; an item put INTO a category through the form's chips (R85: there was no way before) → ONE merge-patch;
 * the face's default_slab → "from shop default"; "996331" typed in Code / HSN → saved to `hsn`, "12345" refused in words, nothing sent; the exempt
 * button only when the shop has a 0% exempt slab; an editor sees every rate door greyed WITH the sentence, a manager the api vouches for
 * (may_set_rate, api #429) sees them enabled. The confirm is the page's <dialog open> (no role attribute): select dialog[open].
 * Screens: public/catalogue.html + app/cap-catalogue.js (the item form's chips, the category sheet, the Code / HSN slot), app/tax-slab-ui.js (the
 * chip, the picker, the menu). Every word on the catalogue goes through the string layer (T( → tx).
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-rate-sources.cjs          the stand-in
 *   node e2e/walk-rate-sources.cjs --show                                   watch it
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-rate-sources-NN.png.
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const J = C.json;

/* the fixture shop: a regular GST registration (so the shop CHARGES), two live slabs on today's menu, Meals with no slab yet, Veg Meals coded 996331 under `code` */
const SHOP = { display_name: 'Kaveri Mess', currency_code: 'INR', country_code: 'IN', country: 'IN', gstn: '33AAAAA0000A1Z5', policy_flags: {} };
const SLABS = [
  { definition_id: 's5', kind: 'tax', name: 'GST 5%', status: 'live', rules: { rate: 5 }, current_version: 1 },
  { definition_id: 's18', kind: 'tax', name: 'GST 18%', status: 'live', rules: { rate: 18 }, current_version: 1 }
];
const EXEMPT = { definition_id: 'sx', kind: 'tax', name: 'Exempt goods', status: 'live', rules: { rate: 0, nil_kind: 'exempt' }, current_version: 1 };
const fixtureCats = () => [{ definition_id: 'c1', kind: 'category', name: 'Meals', status: 'live', rules: { parent: null }, current_version: 1 }];
const fixtureItems = () => [
  { item_id: 'veg', item_data: { name: 'Veg Meals', unit: 'plate', price: { amount: 120, currency: 'INR' }, code: '996331', categories: ['c1'], category_names: ['Meals'], status: 'available' } },
  { item_id: 'tea', item_data: { name: 'Tea', unit: 'cup', price: { amount: 15, currency: 'INR' }, status: 'available' } },
  { item_id: 'water', item_data: { name: 'Water', unit: 'bottle', price: { amount: 20, currency: 'INR' }, status: 'available' } }
];

const walk = async (w) => {
  const { page, ctx, base } = w;
  const S = { calls: [], items: fixtureItems(), cats: fixtureCats(), slabs: SLABS.slice(), face: {}, cost: { can_see_costs: true, is_owner: true } };
  const sess = W.session('Kaveri Owner', 'Kaveri Mess');
  await ctx.addInitScript((a) => { try { localStorage.setItem('cb_api_base', a.api); localStorage.setItem('cb_sess', a.sess); } catch (_) {} }, { api: base, sess });
  const wrote = (re) => S.calls.filter((c) => re.test(c));
  const lastBody = (re) => { const l = wrote(re); const s = l[l.length - 1] || ''; try { return JSON.parse(s.slice(s.indexOf(' {'))); } catch (_) { return null; } };
  const txt = async (sel) => { const el = await page.$(sel); return el ? (await el.innerText()).replace(/\s+/g, ' ').trim() : ''; };
  const counts = () => { const by = {}; let none = 0; S.items.forEach((it) => { const c = it.item_data.categories || []; if (!c.length) none++; c.forEach((id) => { by[id] = (by[id] || 0) + 1; }); }); return { by, none }; };
  await ctx.route('**/api/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
    let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch (_) {}
    if (m !== 'GET') S.calls.push(m + ' ' + p + (body ? ' ' + JSON.stringify(body) : ''));
    if (p === '/api/entities/me') return J(r, 200, { entity: SHOP });
    if (p === '/api/entities/me/can-see-costs') return J(r, 200, S.cost);
    if (p === '/api/facts/rail') return J(r, 200, { suppliers: 0, customers: 0, in: 0, out: 0, stuck: 0 });
    if (p === '/api/schemas/fields') return J(r, 200, { fields: [] });
    if (p === '/api/catalogue-face') return J(r, 200, { face: S.face });
    if (p === '/api/definitions' && m === 'GET') { const kinds = (u.searchParams.get('kind') || '').split(','); return J(r, 200, { definitions: S.slabs.concat(S.cats).filter((d) => !kinds[0] || kinds.indexOf(d.kind) >= 0) }); }
    if (/^\/api\/definitions\/[^/]+$/.test(p) && m === 'PUT') {
      const cat = S.cats.filter((x) => x.definition_id === p.split('/').pop())[0];
      if (cat && body) { if (body.name) cat.name = body.name; if (body.rules) cat.rules = body.rules; if (body.status) cat.status = body.status; }
      return J(r, 200, { message: 'Saved', definition: cat });
    }
    if (p === '/api/products' && m === 'GET') { const k = counts(); return J(r, 200, { items: S.items, count: S.items.length, total: S.items.length, offset: 0, limit: 100, truncated: false, status_counts: { available: S.items.length, unavailable: 0, redundant: 0, retired: 0 }, category_counts: k.by, uncategorised: k.none }); }
    if (/^\/api\/products\/[^/]+$/.test(p) && m === 'PATCH') {
      const it = S.items.filter((x) => x.item_id === p.split('/').pop())[0];
      if (it && body && body.merge) Object.keys(body.item_data || {}).forEach((k) => { if (body.item_data[k] === null) delete it.item_data[k]; else it.item_data[k] = body.item_data[k]; });
      return J(r, 200, { message: 'Product updated', item: it });
    }
    return J(r, 200, { ok: true });
  });

  const open = async (section) => {
    await page.goto(base + '/catalogue.html?t=' + Date.now() + '#/' + section);   /* clock-ok: a cache-busting suffix */
    await page.waitForSelector(section === 'items' ? '[data-testid="cat-row-veg"]' : '[data-testid="catg-row-c1"]', { timeout: 30000 });
  };
  const openItem = async (id) => { await open('items'); await page.click('[data-testid="cat-row-' + id + '"]'); await page.waitForSelector('[data-testid="cat-tax-chip"]', { timeout: 8000 }); };
  const chip = async () => ({ words: await txt('[data-testid="cat-tax-row"]'), tone: await page.getAttribute('[data-testid="cat-tax-chip"]', 'data-tone') });

  /* ── the category carries a rate ── */
  await w.step('C1', 'Categories -> Meals -> the sheet shows the GST picker (owner: enabled); pick GST 5% -> Save -> a CONFIRM "Meals: GST 5%?"; NOTHING is written yet', async () => {
    await open('categories');
    await page.click('[data-testid="catg-row-c1"]');
    await page.waitForSelector('[data-testid="catg-slab"]', { timeout: 8000 });
    const label = await txt('label[for="catg_slab"]'), disabled = await page.getAttribute('[data-testid="catg-slab"]', 'disabled');
    await page.selectOption('[data-testid="catg-slab"]', 's5');
    const before = wrote(/PUT/).length;
    await page.click('[data-testid="catg-save"]');
    await page.waitForSelector('dialog[open][data-testid="confirm"]', { timeout: 5000 });
    const words = await txt('dialog[open][data-testid="confirm"]');
    return { ok: label === 'GST' && disabled === null && /Meals: GST 5%\?/.test(words) && wrote(/PUT/).length === before, saw: label + ' · enabled · "' + words.slice(0, 70) + '" · PUTs so far: ' + (wrote(/PUT/).length - before) };
  });
  await w.step('C2', 'Set rate (confirm) -> ONE PUT /definitions/c1 with rules { parent, default_slab: s5 }; the sheet closes; the outcome names the rate and how many items follow', async () => {
    const before = wrote(/PUT/).length;
    await page.click('dialog[open] [data-testid="confirm-ok"]');
    await page.waitForFunction(() => { const o = document.querySelector('[data-testid="catg-out"]'); return o && o.textContent; }, null, { timeout: 8000 });
    const b = lastBody(/PUT \/api\/definitions\/c1/), out = await txt('[data-testid="catg-out"]'), sheet = await page.$('dialog[open][data-testid="catg-sheet"]');
    const exact = b && b.rules && b.rules.default_slab === 's5' && 'parent' in b.rules && b.name === 'Meals';
    return { ok: wrote(/PUT/).length - before === 1 && exact && /Meals now carries GST 5%/.test(out) && /1 item\(s\) follow/.test(out) && !sheet, saw: (wrote(/PUT/).length - before) + ' PUT ' + JSON.stringify(b && b.rules) + ' · "' + out + '"' + (sheet ? ' · sheet still open' : '') };
  });
  await w.step('C3', 'Items -> Veg Meals (in Meals, no rate of its own) -> the chip reads "GST 5%" and "from category Meals" (the engine\'s source words)', async () => {
    await openItem('veg');
    const c = await chip();
    return { ok: c.tone === 'rate' && /GST 5%/.test(c.words) && /from category Meals/.test(c.words), saw: c.words };
  });

  /* ── R85: the item goes INTO a category ── */
  await w.step('C4', 'Tea -> Edit -> the form shows the category chips (Meals unticked) -> tick Meals -> Save -> ONE merge-patch { categories, category_names }; the view says Categories: Meals and the chip "GST 5% · from category Meals"', async () => {
    await openItem('tea');
    await page.click('[data-testid="cat-edit"]');
    await page.waitForSelector('[data-testid="cat-catg-c1"]', { timeout: 5000 });
    const wasOn = await page.evaluate(() => document.querySelector('[data-testid="cat-catg-c1"]').classList.contains('on'));
    await page.click('[data-testid="cat-catg-c1"]');
    const before = wrote(/PATCH/).length;
    await page.click('[data-testid="cat-save"]');
    await page.waitForFunction(() => { const c = document.querySelector('[data-testid="cat-tax-chip"]'); return c && c.getAttribute('data-tone') === 'rate'; }, null, { timeout: 8000 });
    const b = lastBody(/PATCH \/api\/products\/tea/), facts = await txt('[data-testid="cat-facts"]'), c = await chip();
    const exact = b && b.merge === true && JSON.stringify(b.item_data.categories) === '["c1"]' && JSON.stringify(b.item_data.category_names) === '["Meals"]';
    return { ok: !wasOn && wrote(/PATCH/).length - before === 1 && exact && /Categories Meals/i.test(facts.replace(/\s+/g, ' ')) && /from category Meals/.test(c.words), saw: (wrote(/PATCH/).length - before) + ' PATCH ' + JSON.stringify(b && b.item_data) + ' · ' + c.words };
  });

  /* ── the shop default ── */
  await w.step('C5', 'the face carries tax.default_slab = GST 18% -> Water (no category, no rate) -> the chip reads "GST 18%" and "from shop default"', async () => {
    S.face = { tax: { default_slab: 's18' } };
    await openItem('water');
    const c = await chip();
    return { ok: c.tone === 'rate' && /GST 18%/.test(c.words) && /from shop default/.test(c.words), saw: c.words };
  });

  /* ── the Code / HSN slot ── */
  await w.step('C6', 'Veg Meals -> Edit -> Code / HSN "996331" -> Save -> the PATCH moves it to `hsn` (code cleared); "12345" -> refused "An HSN has 4, 6 or 8 digits.", nothing sent', async () => {
    await openItem('veg');
    await page.click('[data-testid="cat-edit"]');
    await page.waitForSelector('[data-testid="cat-field-code"]', { timeout: 5000 });
    const label = await txt('label[for="ct_code"], label.fl:has(+ #ct_code)');
    const shown = await page.inputValue('[data-testid="cat-field-code"]');
    await page.click('[data-testid="cat-save"]');
    await page.waitForSelector('[data-testid="cat-edit"]', { timeout: 8000 });
    const b = lastBody(/PATCH \/api\/products\/veg/);
    const moved = b && b.item_data.hsn === '996331' && b.item_data.code === null;
    await page.click('[data-testid="cat-edit"]');
    await page.waitForSelector('[data-testid="cat-field-code"]', { timeout: 5000 });
    const still = await page.inputValue('[data-testid="cat-field-code"]');
    await page.fill('[data-testid="cat-field-code"]', '12345');
    const before = wrote(/PATCH/).length;
    await page.click('[data-testid="cat-save"]');
    await page.waitForFunction(() => { const o = document.querySelector('[data-testid="cat-sheet-out"]'); return o && /HSN/.test(o.textContent); }, null, { timeout: 5000 });
    const said = await txt('[data-testid="cat-sheet-out"]');
    return { ok: shown === '996331' && moved && still === '996331' && /An HSN has 4, 6 or 8 digits\./.test(said) && wrote(/PATCH/).length === before, saw: (label || 'Code / HSN') + ' "' + shown + '" → ' + JSON.stringify(b && b.item_data) + ' · the field still shows ' + still + ' · "' + said + '" · PATCHes after: ' + (wrote(/PATCH/).length - before) };
  });

  /* ── the exempt button ── */
  await w.step('C7', 'Tea -> Change -> no "No GST (exempt)" button while the shop has no exempt slab; with a 0% slab whose nil_kind is exempt the menu offers it, reading "No GST (exempt)"', async () => {
    S.items = fixtureItems(); S.cats = fixtureCats(); S.face = {};
    await openItem('tea');
    await page.click('[data-testid="cat-rate-set"]');
    await page.waitForSelector('[data-testid="rate-menu"]', { timeout: 5000 });
    const without = await page.$$eval('[data-testid="rate-menu"] button', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    S.slabs = SLABS.concat([EXEMPT]);
    await openItem('tea');
    await page.click('[data-testid="cat-rate-set"]');
    await page.waitForSelector('[data-testid="rate-menu"]', { timeout: 5000 });
    const withIt = await page.$$eval('[data-testid="rate-menu"] button', (els) => els.map((e) => e.getAttribute('data-testid') + ':' + e.innerText.replace(/\s+/g, ' ').trim()));
    S.slabs = SLABS.slice();
    return { ok: without.every((t) => !/exempt/.test(t)) && withIt.some((t) => /^rate-pick-sx:No GST \(exempt\)/.test(t)), saw: 'without: ' + without.join(' | ') + ' · with: ' + withIt.join(' | ') };
  });

  /* ── the role gate on every door ── */
  await w.step('C8', 'an EDITOR (is_owner false, no may_set_rate) -> Set rate greyed WITH the sentence on the item; the category picker greyed WITH the sentence', async () => {
    S.cost = { can_see_costs: true, is_owner: false };
    await openItem('tea');
    const dis = await page.getAttribute('[data-testid="cat-rate-set"]', 'disabled'), why = await txt('[data-testid="cat-rate-set-why"]');
    await open('categories');
    await page.click('[data-testid="catg-row-c1"]');
    await page.waitForSelector('[data-testid="catg-slab"]', { timeout: 8000 });
    const pick = await page.getAttribute('[data-testid="catg-slab"]', 'disabled'), pickWhy = await txt('[data-testid="catg-slab-why"]');
    return { ok: dis !== null && /Ask the owner or a manager/.test(why) && pick !== null && /Ask the owner or a manager/.test(pickWhy), saw: 'item: ' + (dis !== null ? 'greyed' : 'ENABLED') + ' "' + why + '" · category: ' + (pick !== null ? 'greyed' : 'ENABLED') + ' "' + pickWhy + '"' };
  });
  await w.step('C9', 'a MANAGER the api vouches for (may_set_rate: true, api #429) -> Set rate enabled on the item; the category picker enabled', async () => {
    S.cost = { can_see_costs: true, is_owner: false, may_set_rate: true };
    await openItem('tea');
    const dis = await page.getAttribute('[data-testid="cat-rate-set"]', 'disabled'), why = await page.$('[data-testid="cat-rate-set-why"]');
    await open('categories');
    await page.click('[data-testid="catg-row-c1"]');
    await page.waitForSelector('[data-testid="catg-slab"]', { timeout: 8000 });
    const pick = await page.getAttribute('[data-testid="catg-slab"]', 'disabled'), pickWhy = await page.$('[data-testid="catg-slab-why"]');
    return { ok: dis === null && !why && pick === null && !pickWhy, saw: 'item: ' + (dis === null ? 'enabled' : 'GREYED') + ' · category: ' + (pick === null ? 'enabled' : 'GREYED') };
  });
};

W.run('rate-sources', walk);

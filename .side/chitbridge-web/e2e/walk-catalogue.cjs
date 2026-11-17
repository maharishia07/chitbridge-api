#!/usr/bin/env node
/**
 * e2e/walk-catalogue.cjs - CATALOGUE, WALKED (T3-CATALOGUE, 2026-10-14: catalogue.html + app/cap-catalogue.js CBCatalogueApp, cap-categories.js's writers).
 * Black box: it presses what a shopkeeper presses - the items list (server-paged, the true total), Next, a search, a row → the item sheet, Edit → Save
 * (ONE PATCH, merge:true, only the diff), a Save the server refuses (its sentence painted, never a raw error), a login that may not see prices (the price
 * greyed WITH the sentence, never hidden), Categories (the list, ＋ New category → the same writer cap-categories.js uses), Import (paste → Check →
 * decisions → Import, confirm:true) - and reads what the screen says. A FIXTURE shop by default; the API is a stand-in answering inside the page.
 * Then RULE 13 (owner, 13 Oct) on every section: Cream and Dark at 1366 and 390 px - AA contrast, no clipping, no inner sideways scroll, nothing
 * floating over a control, no link to app.html, copy in budget (e2e/lib/rule13.cjs, the one copy).
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-catalogue.cjs            the stand-in
 *   node e2e/walk-catalogue.cjs --real                                     the local api (e2e/lib/real-stack.cjs: ../chitbridge-api/server.js on CB_REAL_DB);
 *                                                                          the sim shop's owner - reads, one edit put back, the preflight; nothing else is written
 *   node e2e/walk-catalogue.cjs --show                                     watch it
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-catalogue-NN.png.
 */
'use strict';
const TD = require('./lib/today.cjs');   /* QW1-TODAY: the one injected today (CB_TODAY) — never the runner's clock */
const W = require('./lib/walk.cjs');
const { rule13 } = require('./lib/rule13.cjs');
const REAL = process.argv.includes('--real');
const C = require('./lib/contract.cjs');   /* M43: every answer for a route in the API contract is held to it (the facts family: /api/facts/product-lab) */
const J = C.json;

/* ── the fixture shop: 130 items (so the server pages), 3 categories, one declared column ── */
const CATS = [
  { definition_id: 'c1', kind: 'category', name: 'Grains', status: 'live', rules: { parent: null }, current_version: 1 },
  { definition_id: 'c2', kind: 'category', name: 'Rice', status: 'live', rules: { parent: 'c1' }, current_version: 1 },
  { definition_id: 'c9', kind: 'category', name: 'Old shelf', status: 'retired', rules: { parent: null }, current_version: 1 }
];
function fixtureItems() {
  const out = [];
  for (let i = 1; i <= 130; i++) {
    const rice = i % 10 === 0;
    out.push({ item_id: 'it' + i, item_data: { name: rice ? 'Ponni rice ' + i : 'Item ' + i, unit: rice ? 'kg' : 'piece', price: { amount: 10 + i, currency: 'INR' }, cost: { amount: 8 + i, currency: 'INR' },
      code: 'C' + String(i).padStart(4, '0'), desc: rice ? 'Boiled rice, 25 kg bag' : '', categories: rice ? ['c1', 'c2'] : (i % 3 === 0 ? ['c1'] : []), status: i % 25 === 0 ? 'unavailable' : 'available', brand: i % 7 === 0 ? 'Annam' : undefined } });
  }
  return out;
}

const walk = async (w) => {
  const { page, ctx, base } = w;
  const S = { calls: [], costs: true, refuse: false, items: fixtureItems(), stack: null };
  let api = base, sess;
  if (REAL) {
    S.stack = await require('./lib/real-stack.cjs').up({ webBase: base });
    api = S.stack.api;
    const owner = await require('./lib/real-stack.cjs').signIn(api, 'simstores@test.example');
    sess = typeof owner.session === 'string' ? owner.session : JSON.stringify(owner.session);
    ctx.on('request', (q) => { if (q.url().startsWith(api) && q.method() !== 'GET' && q.method() !== 'OPTIONS') S.calls.push(q.method() + ' ' + new URL(q.url()).pathname + ' ' + (q.postData() || '')); });
  } else {
    sess = W.session('Fixture Owner', 'Fixture Shop');
    const listOf = (u) => {
      const q = (u.searchParams.get('q') || '').toLowerCase(), st = u.searchParams.get('status') || '';
      const limit = Number(u.searchParams.get('limit') || 2000), offset = Number(u.searchParams.get('offset') || 0);
      let all = S.items.filter((p) => !q || JSON.stringify(p.item_data).toLowerCase().indexOf(q) >= 0);
      if (st === 'not-available') all = all.filter((p) => p.item_data.status && p.item_data.status !== 'available');
      else if (st) all = all.filter((p) => (p.item_data.status || 'available') === st);
      const items = all.slice(offset, offset + limit).map((p) => ({ item_id: p.item_id, item_data: S.costs ? p.item_data : Object.assign({}, p.item_data, { cost: undefined }) }));
      const counts = { available: 0, unavailable: 0, redundant: 0, retired: 0 }; S.items.forEach((p) => { counts[p.item_data.status || 'available']++; });
      const cc = {}; let none = 0; S.items.forEach((p) => { const c = p.item_data.categories || []; if (!c.length) none++; c.forEach((id) => { cc[id] = (cc[id] || 0) + 1; }); });
      return { items, count: items.length, total: all.length, offset, limit, truncated: offset + items.length < all.length, status_counts: counts, category_counts: cc, uncategorised: none };
    };
    await ctx.route('**/api/**', async (r) => {
      const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
      let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch (_) {}
      if (m !== 'GET') S.calls.push(m + ' ' + p + (body ? ' ' + JSON.stringify(body) : ''));
      if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR', country_code: 'IN' } });
      if (p === '/api/entities/me/can-see-costs') return J(r, 200, { can_see_costs: S.costs, is_owner: S.costs });
      if (p === '/api/facts/rail') return J(r, 200, { suppliers: 0, customers: 0, in: 0, out: 0, stuck: 0 });
      if (p === '/api/schemas/fields') return J(r, 200, { fields: [{ field_key: 'brand', field_name: 'Brand', field_type: 'text', display_order: 1 }] });
      if (p === '/api/definitions' && m === 'GET') { const all = u.searchParams.get('all') === '1'; return J(r, 200, { definitions: CATS.filter((c) => all || c.status === 'live') }); }
      if (p === '/api/definitions' && m === 'POST') { const d = { definition_id: 'c3', kind: 'category', name: body.name, status: 'draft', rules: body.rules || {}, current_version: 1 }; CATS.push(d); return J(r, 200, { definition_id: 'c3' }); }
      if (/^\/api\/definitions\/[^/]+$/.test(p) && m === 'PUT') { const d = CATS.filter((c) => c.definition_id === p.split('/').pop())[0]; if (d) Object.assign(d, body.status ? { status: body.status } : { name: body.name, rules: body.rules }); return J(r, 200, { ok: true }); }
      if (/^\/api\/definitions\/[^/]+$/.test(p) && m === 'DELETE') { const d = CATS.filter((c) => c.definition_id === p.split('/').pop())[0]; if (d) d.status = 'retired'; return J(r, 200, { ok: true }); }
      if (p === '/api/products' && m === 'GET') return J(r, 200, listOf(u));
      if (p === '/api/products' && m === 'POST') { const it = { item_id: 'it-new', item_data: body.item_data }; S.items.unshift(it); return J(r, 200, { message: 'Product added', item: it }); }
      if (p === '/api/products/template') return J(r, 200, { csv: 'name,unit,price,code,desc,brand\n', filename: 'catalogue-template.csv', columns: ['name', 'unit', 'price', 'code', 'desc', 'brand'], optional: ['desc', 'brand'], notes: ['Prices are in INR.'] });
      if (p === '/api/products/import/preflight') return J(r, 200, { dry_run: true, accepted: ['name', 'unit', 'price', 'code', 'desc', 'brand'], optional: ['desc', 'brand'],
        report: { ready: false, mapping: [{ incoming: 'Product', how: 'synonym', canonical: 'name' }, { incoming: 'Rate', how: 'fuzzy', canonical: 'price' }, { incoming: 'Colour', how: 'unmatched', canonical: null }],
          summary: { rows: 2, importable: 2, errors: 0, warnings: 1 }, issues: [{ row: 2, column: 'Rate', severity: 'warning', message: 'read as 12.5' }], notes: [] } });
      if (p === '/api/products/import') { if (body.confirm !== true) return J(r, 400, { error: 'Not confirmed', message: 'Nothing was imported — this needs an explicit confirmation.' });
        return J(r, 200, { message: 'Imported 2 products.', summary: { created: 2 }, created_columns: body.decisions.some((d) => d.action === 'create') ? ['Colour'] : [], outcome: [{ line: 2, name: 'Blue mug', action: 'created' }, { line: 3, name: 'Red mug', action: 'created' }] }); }
      const mi = /^\/api\/products\/([^/]+)(\/status)?$/.exec(p);
      if (mi && m === 'PATCH') {
        if (S.refuse) return J(r, 403, { error: 'Not permitted', message: 'Your access does not include cost or price. You can change availability; the account owner can grant "Sees costs" in Co-assists to change: price.' });
        const it = S.items.filter((x) => x.item_id === mi[1])[0]; if (!it) return J(r, 404, { error: 'Not found' });
        if (body.merge === true) Object.keys(body.item_data).forEach((k) => { if (body.item_data[k] === null) delete it.item_data[k]; else it.item_data[k] = body.item_data[k]; }); else it.item_data = body.item_data;
        if (typeof it.item_data.price === 'number') it.item_data.price = { amount: it.item_data.price, currency: 'INR' };
        return J(r, 200, { message: 'Product updated', item: it });
      }
      if (mi && mi[2] && m === 'PUT') { const it = S.items.filter((x) => x.item_id === mi[1])[0]; if (it) it.item_data.status = body.status; return J(r, 200, { item: it }); }
      return J(r, 200, {});
    });
  }
  await ctx.addInitScript((a) => { try { localStorage.setItem('cb_ids', '1'); localStorage.setItem('cb_api_base', a.api); localStorage.setItem('cb_sess', a.sess); } catch (_) {} }, { api, sess });

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const wrote = (re) => S.calls.filter((c) => re.test(c));
  /* ?t= : a same-hash goto keeps the page (and an open sheet) — every visit is a fresh load, as walk-settings notes */
  const items = async (hash) => { await page.goto(base + '/catalogue.html?t=' + Date.now() + (hash || '#/items')); await page.waitForSelector('[data-testid="cat-items"] .cbl-row, [data-testid="cbl-empty-catalogue-items"], [data-testid="cat-read-err"]', { timeout: 30000 }); await page.waitForTimeout(400); };   /* clock-ok: a cache-busting suffix, not a business date */
  const rows = () => page.locator('[data-testid="cat-items"] .cbl-row').count();

  await items();
  await w.step('C1', 'Catalogue -> Items: the list, the TRUE total beside the page (the server counts), one page of rows', async () => {
    const c = await txt('[data-testid="cat-count"]'), n = await rows(), pager = await txt('[data-testid="cat-pager"]');
    const total = Number((/(\d+)\s+items?/.exec(c) || [])[1]);
    return { ok: REAL ? (total > 0 && n > 0 && n <= 100) : (total === 130 && n === 100 && /1–100 of 130/.test(pager)), saw: '"' + c + '" · ' + n + ' rows · pager "' + pager + '"' };
  });
  if (!REAL) {
    await w.step('C2', 'Items -> Next -> the SERVER is asked for the next page (offset), the pager says 101-130', async () => {
      await page.click('[data-testid="cat-next"]'); await page.waitForTimeout(600);
      const pager = await txt('[data-testid="cat-pager"]'), n = await rows();
      return { ok: /101–130 of 130/.test(pager) && n === 30, saw: pager + ' · ' + n + ' rows' };
    });
  }
  await w.step('C3', 'Items -> type in the list\'s search -> the server searches (?q), the count says "matching"', async () => {
    await items();
    await page.fill('[data-testid="cat-items"] .cbl-search input', REAL ? 'a' : 'ponni'); await page.waitForTimeout(900);
    const c = await txt('[data-testid="cat-count"]'), n = await rows();
    return { ok: /matching/.test(c) && n > 0 && (REAL || n === 13), saw: '"' + c + '" · ' + n + ' rows' };
  });
  await w.step('C3b', 'Filters ▾ -> Status: Not available -> the SERVER filters (?status=not-available), the chip shows, the count says matching', async () => {
    await items();
    await page.click('[data-testid="cbl-filters-catalogue-items"]'); await page.waitForSelector('[data-testid="cbl-filters-pop-catalogue-items"] select[data-filt="status"]', { timeout: 5000 });
    await page.selectOption('[data-testid="cbl-filters-pop-catalogue-items"] select[data-filt="status"]', 'unavailable'); await page.waitForTimeout(900);
    const c = await txt('[data-testid="cat-count"]'), n = await rows(), chip = await txt('[data-testid="cat-items"] .cbl-fchips');
    return { ok: /matching/.test(c) && (REAL || n === 5) && /Not available/.test(chip), saw: '"' + c + '" · ' + n + ' rows · chip "' + chip + '"' };
  });
  await w.step('C4', 'a row -> the item sheet: the name, the status, the price with the shop\'s symbol, the declared column', async () => {
    await items();
    /* a row with everything on it in the fixture (two categories, the declared Brand); the sim shop's first row in --real */
    const row = REAL ? page.locator('[data-testid="cat-items"] .cbl-row').first() : page.locator('[data-testid="cat-row-it70"]');
    await row.scrollIntoViewIfNeeded(); await row.click(); await page.waitForSelector('[data-testid="cat-facts"]', { timeout: 8000 });
    const t = await txt('[data-testid="cat-sheet-title"]'), f = await txt('[data-testid="cat-facts"]'), st = await txt('[data-testid="cat-sheet-status"]');
    return { ok: t.length > 0 && /price/i.test(f) && (REAL || (/₹/.test(f) && /brand/i.test(f) && /Grains · Rice/.test(f))) && st.length > 0, saw: t + ' · ' + st + ' · ' + f.slice(0, 120) };
  });
  await w.step('C5', 'the sheet -> Edit -> change one field -> Save -> ONE PATCH, merge:true, ONLY the changed key; the sheet says Saved', async () => {
    await page.click('[data-testid="cat-edit"]'); await page.waitForSelector('[data-testid="cat-save"]', { timeout: 5000 });
    const before = wrote(/PATCH \/api\/products\//).length;
    const desc = await page.inputValue('[data-testid="cat-field-desc"]');
    await page.fill('[data-testid="cat-field-desc"]', desc + ' (walked)'); await page.click('[data-testid="cat-save"]'); await page.waitForTimeout(900);
    const patches = wrote(/PATCH \/api\/products\//), last = patches[patches.length - 1] || '';
    let only = false; try { const b = JSON.parse(last.slice(last.indexOf(' {'))); only = b.merge === true && Object.keys(b.item_data).join(',') === 'desc'; } catch (_) {}
    const out = await txt('[data-testid="cat-sheet-out"]'), toast = await txt('#toast');
    if (REAL) { await page.click('[data-testid="cat-edit"]'); await page.waitForSelector('[data-testid="cat-save"]'); await page.fill('[data-testid="cat-field-desc"]', desc); await page.click('[data-testid="cat-save"]'); await page.waitForTimeout(900); }   /* put back */
    return { ok: patches.length - before === 1 && only && /Saved/.test(toast + out), saw: (patches.length - before) + ' PATCH · ' + last.slice(last.indexOf(' {'), last.indexOf(' {') + 80) + ' · "' + (toast || out) + '"' };
  });
  if (!REAL) {
    await w.step('C6', 'Save refused by the server (403) -> ITS sentence under the control, never a raw error; nothing else moves', async () => {
      S.refuse = true;
      await page.click('[data-testid="cat-edit"]'); await page.waitForSelector('[data-testid="cat-save"]', { timeout: 5000 });
      await page.fill('[data-testid="cat-field-price"]', '99'); await page.click('[data-testid="cat-save"]'); await page.waitForTimeout(900);
      const out = await txt('[data-testid="cat-sheet-out"]'); S.refuse = false;
      return { ok: /Your access does not include cost or price/.test(out) && !/403|undefined|Error/.test(out), saw: '"' + out + '"' };
    });
    await w.step('C7', 'a login that may not see costs (the server\'s field) -> the price column says "not shown"; Edit greys the price WITH the sentence, never hides it', async () => {
      S.costs = false; await items();
      const col = await txt('[data-testid="cat-price-hidden"]');
      await page.locator('[data-testid="cat-items"] .cbl-row').first().click(); await page.waitForSelector('[data-testid="cat-edit"]', { timeout: 8000 });
      await page.click('[data-testid="cat-edit"]'); await page.waitForSelector('[data-testid="cat-field-price"]', { timeout: 5000 });
      const disabled = await page.getAttribute('[data-testid="cat-field-price"]', 'disabled'), why = await txt('[data-testid="cat-price-why"]');
      S.costs = true;
      return { ok: /not shown/.test(col) && disabled !== null && /does not include cost or price/.test(why), saw: '"' + col + '" · disabled=' + (disabled !== null) + ' · "' + why + '"' };
    });
  }
  const catgs = async () => { await page.goto(base + '/catalogue.html?t=' + Date.now() + '#/categories'); await page.waitForSelector('[data-testid="cat-categories"] .cbl-row, [data-testid="cbl-empty-catalogue-categories"], [data-testid="catg-read-err"]', { timeout: 30000 }); await page.waitForTimeout(400); };   /* clock-ok: a cache-busting suffix, not a business date */
  await w.step('C8', 'Categories: the shelf as a list with the server\'s counts; the sidebar marks Categories; the chip says CTG002', async () => {
    await catgs();
    const c = await txt('[data-testid="catg-count"]'), n = await page.locator('[data-testid="cat-categories"] .cbl-row').count();
    const active = await page.getAttribute('[data-testid="skel-nav-categories"]', 'class'), chip = await txt('[data-testid="screen-id"]');
    return { ok: /categor/.test(c) && (REAL || n === 3) && /active/.test(active || '') && (chip === '' || /CTG002/.test(chip)), saw: '"' + c + '" · ' + n + ' rows · chip "' + chip + '"' };
  });
  if (!REAL) {
    await w.step('C9', '＋ New category -> name -> Add -> the SAME writer (POST /definitions + PUT live), the list re-reads with the new row', async () => {
      await page.click('[data-testid="catg-new"]'); await page.waitForSelector('[data-testid="catg-name"]', { timeout: 5000 });
      await page.fill('[data-testid="catg-name"]', 'Pulses'); await page.selectOption('[data-testid="catg-parent"]', 'c1'); await page.click('[data-testid="catg-save"]'); await page.waitForTimeout(900);
      const posts = wrote(/POST \/api\/definitions/), puts = wrote(/PUT \/api\/definitions\/c3/), n = await page.locator('[data-testid="cat-categories"] .cbl-row').count();
      return { ok: posts.length === 1 && /Pulses/.test(posts[0]) && /"parent":"c1"/.test(posts[0]) && puts.length === 1 && /live/.test(puts[0]) && n === 4, saw: posts.length + ' POST · ' + puts.length + ' PUT · ' + n + ' rows' };
    });
  }
  const imp = async () => { await page.goto(base + '/catalogue.html?t=' + Date.now() + '#/import'); await page.waitForSelector('[data-testid="cat-check-run"]', { timeout: 30000 }); await page.waitForTimeout(300); };   /* clock-ok: a cache-busting suffix, not a business date */
  await w.step('C10', 'Import: paste rows -> Check -> the preflight (writes nothing) -> a decision per column, Import enabled only when the file is sound', async () => {
    await imp();
    await page.fill('[data-testid="cat-check-text"]', 'Product,Rate,Colour\nBlue mug,12.5,blue\nRed mug,12.5,red'); await page.click('[data-testid="cat-check-run"]'); await page.waitForTimeout(1200);
    const pre = wrote(/POST \/api\/products\/import\/preflight/), imps = wrote(/POST \/api\/products\/import /), out = await txt('[data-testid="cat-check-out"]');
    const sel = await page.locator('[data-cfcol]').count(), dis = await page.getAttribute('[data-testid="cat-import-run"]', 'disabled');
    return { ok: pre.length === 1 && imps.length === 0 && (REAL ? /row/.test(out) : (sel === 3 && dis === null && /2 row/.test(out))), saw: pre.length + ' preflight · ' + imps.length + ' import · ' + sel + ' decisions · "' + out.slice(0, 70) + '"' };
  });
  if (!REAL) {
    await w.step('C11', 'Import -> the page\'s own confirm -> ONE POST with confirm:true and the three decisions; the outcome per line', async () => {
      await page.click('[data-testid="cat-import-run"]'); await page.waitForSelector('[data-testid="confirm-ok"]', { timeout: 5000 }); await page.click('[data-testid="confirm-ok"]'); await page.waitForTimeout(1000);
      const imps = wrote(/POST \/api\/products\/import /), out = await txt('[data-testid="cat-check-out"]');
      let ok = false; try { const b = JSON.parse(imps[0].slice(imps[0].indexOf(' {'))); ok = b.confirm === true && b.decisions.length === 3 && b.decisions.some((d) => d.action === 'create' && d.incoming === 'Colour'); } catch (_) {}
      return { ok: imps.length === 1 && ok && /Imported 2 products/.test(out) && /Blue mug/.test(out), saw: imps.length + ' POST · "' + out.slice(0, 90) + '"' };
    });
  }
  await w.step('C12', 'Home\'s manifest: Catalogue is BUILT, routes to /catalogue.html and reads an existing facts card; the page links nowhere into app.html', async () => {
    const m = require('./../public/app/manifest.json').entries.filter((e) => e.id === 'catalogue')[0] || {};
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'catalogue.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');   /* comments out, as index-not-app reads it */
    return { ok: m.state === 'built' && m.route === '/catalogue.html' && /^\/api\/facts\//.test(m.facts || '') && !m.via && !/app\.html/.test(src), saw: m.state + ' · ' + m.route + ' · ' + m.facts };
  });

  /* ── RULE 13: two themes × two widths × three sections (e2e/lib/rule13.cjs) ── */
  await items(); await rule13(w, 'C13', 'Items', 'cat');
  await catgs(); await rule13(w, 'C14', 'Categories', 'cat');
  await imp(); await page.fill('[data-testid="cat-check-text"]', 'Product,Rate\nBlue mug,12.5'); await page.click('[data-testid="cat-check-run"]'); await page.waitForTimeout(800); await rule13(w, 'C15', 'Import (with a preflight on screen)', 'cat');
  await page.evaluate(() => { CBAvatar.applyTheme('cream'); }).catch(() => {});
  if (w.errs.length) w.note('C99', 'page errors seen during the walk', w.errs.slice(0, 3).join(' | '));
  if (S.stack) await S.stack.stop();
};
walk.opts = { viewport: { width: 1366, height: 900 } };
W.run('catalogue', walk);

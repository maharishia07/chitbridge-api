#!/usr/bin/env node
/**
 * e2e/walk-operations.cjs — CB OPERATIONS, WALKED (T3-OPS, 2026-10-14: operations.html + app/cap-stock.js + app/cap-suppliers.js in CBFrame's pane).
 * Black box: it presses what an owner presses and reads what the screen says.
 *   Stock      least on hand first (below zero, then none left) · a product's batches with expired / expiring in words · a failed read said in
 *              words with Try again · a shop whose stock ledger is not switched on gets the server's sentence, never "nothing here"
 *   Suppliers  Trade and Other as the list's views · can-you-order in three answers · add by User ID → 404 → "Add as a local supplier" → added ·
 *              a refused add shows the server's sentence · Remove asks first, then one DELETE · Preferred is one PATCH
 *   Home       the manifest: CB Operations built at /operations.html with its facts card; Stock and Suppliers point into it
 *   default   the API is a stand-in answering inside the page (nothing leaves the runner)
 *   --real    the local api (e2e/lib/real-stack.cjs: ../chitbridge-api/server.js on CB_REAL_DB, DEV_OTP 123456), signed in as WX_SHOP
 *             (default simstores@test.example, a shop tools/sim-load.cjs loaded): the two screens read the real routes; no write is made
 * Then RULE 13: both tabs, Cream and Dark, 1366 and 390 px — AA contrast (lib/theme-measure.cjs), no clipped text, no inner sideways scroll,
 * nothing floating over a control, no link to app.html, copy within the text budget (≤140 chars, ≤2 sentences, as walk-settings says it).
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-operations.cjs [--real] [--show]
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-operations-NN.png.
 */
'use strict';
const TD = require('./lib/today.cjs');   /* QW1-TODAY: the one injected today (CB_TODAY) — never the runner's clock */
const W = require('./lib/walk.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const REAL = process.argv.includes('--real');
const C = require('./lib/contract.cjs');   /* M43: every answer for a route in the API contract is held to it (RAIL-LAB-SRV1: the facts family) */
const J = C.json;
const crmApi = require('./lib/crm-api.cjs');   /* RAIL-LAB-SRV1: the rail card (GET /api/facts/rail) from its one builder */
const ymd = (days) => TD.dayPlus(days);

const walk = async (w) => {
  const { page, ctx, base } = w;
  const S = { calls: [], stock: 'ok', addRefuse: false, stack: null };
  const STOCK = () => ({ at: TD.nowIso(), balances: {
    rice: { qty: 6.5, avg_cost: 50, name: 'Ponni Rice', unit: 'kg', lots: [{ lot: 'B1', qty: 4, expires_at: ymd(-3) }, { lot: 'B2', qty: 2.5, expires_at: ymd(10) }] },
    dal: { qty: -1, avg_cost: 140, name: 'Toor Dal', unit: 'kg', lots: [] },
    salt: { qty: 0, avg_cost: 20, name: 'Salt', unit: null, lots: [] },
    oil: { qty: 12, avg_cost: 210, name: 'Groundnut Oil', unit: 'L', lots: [] } } });
  const SUPS = [
    { supplier_list_id: 's1', display_name: 'Kumar Trading', nickname: null, preferred: true, category: 'Grains', supply_kind: 'resale', on_rail: true, has_catalogue: true, user_id: 'kumartrade', bridge_id: 'CBKT0001', facts: { gstin: '33AAACK1234B1Z5', gstin_rung: 'checked', country: 'IN' } },
    { supplier_list_id: 's2', display_name: 'Corner Hardware', nickname: null, preferred: false, category: null, supply_kind: 'resale', on_rail: false, has_catalogue: false, user_id: '~fixture.corner-hardware', bridge_id: 'CBCH0001', facts: null },
    { supplier_list_id: 's3', display_name: 'Clean Co', nickname: 'Cleaning', preferred: false, category: null, supply_kind: 'own_use', on_rail: true, has_catalogue: false, user_id: 'cleanco01', bridge_id: 'CBCC0001', facts: null },
  ];
  let api = base;
  if (REAL) {
    const R = require('./lib/real-stack.cjs');
    S.stack = await R.up({ webBase: base }); api = S.stack.api;
    const who = await R.signIn(api, process.env.WX_SHOP || 'simstores@test.example');
    await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} }, who.session);
  } else {
    await ctx.route('**/api/**', async (r) => {
      const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
      let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch (_) {}
      if (m !== 'GET') S.calls.push(m + ' ' + p + (body ? ' ' + JSON.stringify(body) : ''));
      if (p === '/api/till/stock') {
        if (S.stock === 'fail') return J(r, 500, { error: 'Failed', message: 'boom' });
        if (S.stock === 'off') return J(r, 200, { balances: {}, at: TD.nowIso(), not_ready: 'STOCK_LEDGER_MISSING', says: 'Stock is not switched on for this shop yet. Receive a delivery and it starts.' });
        return J(r, 200, STOCK());
      }
      if (p === '/api/relationships/suppliers' && m === 'GET') return J(r, 200, { suppliers: SUPS, count: SUPS.length });
      if (p === '/api/relationships/suppliers' && m === 'POST') {
        if (S.addRefuse) return J(r, 403, { error: 'Forbidden', message: 'A view-only login cannot add suppliers.' });
        if (body.supplier_bridge_id) return J(r, 404, { error: 'Not found', message: 'No business with that User ID, bridge ID, or email' });
        SUPS.push({ supplier_list_id: 's9', display_name: body.name, preferred: false, supply_kind: body.supply_kind, on_rail: false, has_catalogue: false, user_id: '~fixture.x', facts: null });
        return J(r, 200, { message: 'Supplier added', supplier: { display_name: body.name, on_rail: false } });
      }
      const mm = /^\/api\/relationships\/suppliers\/(\w+)$/.exec(p);
      if (mm && m === 'PATCH') { const x = SUPS.find((s) => s.supplier_list_id === mm[1]); Object.assign(x, body); return J(r, 200, { message: 'ok' }); }
      if (mm && m === 'DELETE') { const i = SUPS.findIndex((s) => s.supplier_list_id === mm[1]); if (i >= 0) SUPS.splice(i, 1); return J(r, 200, { message: 'Supplier removed' }); }
      if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', country_code: 'IN', currency_code: 'INR' } });
      if (p === '/api/facts/rail') return J(r, 200, crmApi.railFacts({ suppliers: 2, customers: 0, in: 0, out: 0, stuck: 0 }));
      return J(r, 200, {});
    });
    await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
  }
  await ctx.addInitScript((a) => { try { localStorage.setItem('cb_api_base', a); } catch (_) {} }, api);

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const wrote = (re) => S.calls.filter((c) => re.test(c));
  /* a fresh load each time (?r=): a same-hash goto keeps the page (walk-settings T6A) */
  const stock = async () => { await page.goto(base + '/operations.html?r=' + Date.now() + '#/stock'); await page.waitForSelector('[data-testid="ops-stock"] .cbl-list', { timeout: 20000 }); await page.waitForFunction(() => !document.querySelector('[data-testid="ops-stock"] [aria-busy="true"]'), null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(250); };   /* clock-ok: a cache-busting suffix, not a business date */
  const sups = async () => { await page.goto(base + '/operations.html?r=' + Date.now() + '#/suppliers'); await page.waitForSelector('[data-testid="ops-suppliers"] .cbl-list', { timeout: 20000 }); await page.waitForFunction(() => !document.querySelector('[data-testid="ops-suppliers"] [aria-busy="true"]'), null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(250); };   /* clock-ok: a cache-busting suffix, not a business date */
  const order = (pre) => page.$$eval('[data-testid^="' + pre + '"]', (ns) => ns.map((n) => n.getAttribute('data-testid')));

  if (REAL) {
    await stock();
    await w.step('R1', '--real · Stock: the real GET /api/till/stock?detail=1 paints rows, an empty sentence or the not-switched-on sentence — never an error', async () => {
      const t = await txt('[data-testid="ops-stock"]');
      return { ok: !/could not read/i.test(t) && t.length > 10, saw: t.slice(0, 160) };
    });
    await sups();
    await w.step('R2', '--real · Suppliers: the real list with a can-you-order answer per row (or the no-suppliers sentence)', async () => {
      const t = await txt('[data-testid="ops-suppliers"]'), n = (await order('sup-ready-')).length;
      return { ok: !/could not read/i.test(t) && (n > 0 || /No suppliers yet/.test(t)), saw: n + ' rows · ' + t.slice(0, 120) };
    });
  } else {
    await stock();
    await w.step('O1', 'Stock: least on hand first — Toor Dal (below zero) then Salt (none left); the below-zero notice in the head', async () => {
      const rows = await order('stock-row-'), notice = await txt('[data-testid="stock-below-notice"]'), dal = await txt('[data-testid="stock-qty-dal"]');
      return { ok: rows[0] === 'stock-row-dal' && rows[1] === 'stock-row-salt' && rows[rows.length - 1] === 'stock-row-oil' && /1 below zero/.test(notice) && /below zero/.test(dal), saw: rows.join(',') + ' · notice "' + notice + '" · dal "' + dal + '"' };
    });
    await w.step('O2', 'Stock -> Ponni Rice -> its batches, earliest expiry first: B1 expired, B2 expires (in words)', async () => {
      await page.click('[data-testid="stock-row-rice"]'); await page.waitForSelector('[data-testid="stock-next-rice"]', { timeout: 5000 });
      const t = await txt('[data-testid="stock-next-rice"]');
      return { ok: /B1.*expired/.test(t) && /B2.*expires/.test(t) && t.indexOf('B1') < t.indexOf('B2'), saw: '"' + t + '"' };
    });
    await w.step('O3', 'Stock: search "groundnut" -> one row; the count chip says 4 items', async () => {
      await page.fill('[data-testid="ops-stock"] .cbl-search input', 'groundnut'); await page.waitForTimeout(400);
      const rows = await order('stock-row-'), c = await txt('[data-testid="stock-count"]');
      return { ok: rows.length === 1 && rows[0] === 'stock-row-oil' && /4 items/.test(c), saw: rows.join(',') + ' · "' + c + '"' };
    });
    await w.step('O4', 'Stock read fails -> "Could not read your stock." with Try again; Try again reads again and paints the rows', async () => {
      await page.fill('[data-testid="ops-stock"] .cbl-search input', '').catch(() => {});
      S.stock = 'fail'; await stock();
      const e = await txt('[data-testid="cbl-error-ops-stock"]');
      S.stock = 'ok'; await page.click('[data-testid="cbl-error-ops-stock"] [data-cbl-retry]'); await page.waitForSelector('[data-testid="stock-row-dal"]', { timeout: 8000 }).catch(() => {});
      const back = (await order('stock-row-')).length;
      return { ok: /Could not read your stock/.test(e) && !/500|boom|undefined/.test(e) && back === 4, saw: '"' + e + '" · after Try again ' + back + ' rows' };
    });
    await w.step('O5', 'Stock ledger not switched on -> the server\'s sentence, never "nothing here"', async () => {
      S.stock = 'off'; await stock(); const t = await txt('[data-testid="cbl-empty-ops-stock"]'); S.stock = 'ok';
      return { ok: /not switched on/.test(t) && !/nothing here/i.test(t), saw: '"' + t + '"' };
    });

    await sups();
    await w.step('O6', 'Suppliers: the Trade view lists the two to sell, with can-you-order in words; Other lists the one to use', async () => {
      const trade = await order('sup-row-'), r1 = await txt('[data-testid="sup-ready-s1"]'), r2 = await txt('[data-testid="sup-ready-s2"]');
      await page.click('[data-testid="sup-view-other"]'); await page.waitForTimeout(300);
      const other = await order('sup-row-'), r3 = await txt('[data-testid="sup-ready-s3"]');
      await page.click('[data-testid="sup-view-trade"]'); await page.waitForTimeout(300);
      return { ok: trade.join() === 'sup-row-s1,sup-row-s2' && /catalogue/i.test(r1) && /Not on the network/.test(r2) && other.join() === 'sup-row-s3' && /no catalogue/.test(r3), saw: trade.join(',') + ' "' + r1 + '" "' + r2 + '" | other ' + other.join(',') + ' "' + r3 + '"' };
    });
    await w.step('O7', 'Suppliers -> a row\'s next level says the certificate check is not here yet (OPS-S2), never a green tick', async () => {
      await page.click('[data-testid="sup-row-s1"]'); await page.waitForSelector('[data-testid="sup-next-s1"]', { timeout: 5000 });
      const t = await txt('[data-testid="sup-next-s1"]');
      return { ok: /certificates are checked in a later release/i.test(t), saw: '"' + t + '"' };
    });
    await w.step('O8', '+ Add supplier -> a User ID nobody has -> 404 -> "Add as a local supplier" -> one POST { name } -> the row is listed', async () => {
      await page.click('[data-testid="sup-add-open"]'); await page.fill('[data-testid="sup-add-q"]', 'ramstores1'); await page.click('[data-testid="sup-add-go"]');
      await page.waitForSelector('[data-testid="sup-add-local"]', { timeout: 5000 });
      const said = await txt('[data-testid="sup-add-out"]');
      await page.click('[data-testid="sup-add-local"]'); await page.waitForSelector('[data-testid="sup-row-s9"]', { timeout: 8000 }).catch(() => {});
      const posts = wrote(/POST \/api\/relationships\/suppliers/);
      return { ok: /No business/.test(said) && posts.length === 2 && /supplier_bridge_id/.test(posts[0]) && /"name":"ramstores1"/.test(posts[1]) && (await page.locator('[data-testid="sup-row-s9"]').count()) === 1, saw: '"' + said + '" · ' + posts.join(' | ') };
    });
    await w.step('O9', 'Add refused by the server -> its sentence in the dialog, never a raw error', async () => {
      S.addRefuse = true; await page.click('[data-testid="sup-add-open"]'); await page.fill('[data-testid="sup-add-q"]', 'Some Name'); await page.click('[data-testid="sup-add-go"]'); await page.waitForTimeout(600);
      const t = await txt('[data-testid="sup-add-out"]'); S.addRefuse = false; await page.keyboard.press('Escape');
      return { ok: /view-only login cannot add suppliers/.test(t) && !/403|undefined/.test(t), saw: '"' + t + '"' };
    });
    await w.step('O10', 'Corner Hardware -> Preferred ★ -> one PATCH { preferred:true }', async () => {
      await sups(); await page.click('[data-testid="sup-row-s2"]'); await page.waitForSelector('[data-act="preferred"][data-actrow="s2"]', { timeout: 5000 });
      const before = wrote(/PATCH/).length; await page.click('[data-act="preferred"][data-actrow="s2"]'); await page.waitForTimeout(600);
      const p = wrote(/PATCH/).slice(before);
      return { ok: p.length === 1 && /suppliers\/s2 \{"preferred":true\}/.test(p[0]), saw: p.join(' | ') };
    });
    await w.step('O11', 'Corner Hardware -> Remove -> asks first; Cancel sends nothing; Remove sends one DELETE', async () => {
      await sups(); await page.click('[data-testid="sup-row-s2"]'); await page.waitForSelector('[data-act="remove"][data-actrow="s2"]', { timeout: 5000 });
      await page.click('[data-act="remove"][data-actrow="s2"]'); await page.waitForSelector('[data-testid="confirm-cancel"]', { timeout: 5000 });
      await page.click('[data-testid="confirm-cancel"]'); await page.waitForTimeout(300); const after1 = wrote(/DELETE/).length;
      await page.click('[data-act="remove"][data-actrow="s2"]'); await page.waitForSelector('[data-testid="confirm-ok"]', { timeout: 5000 }); await page.click('[data-testid="confirm-ok"]'); await page.waitForTimeout(700);
      const d = wrote(/DELETE/);
      return { ok: after1 === 0 && d.length === 1 && /suppliers\/s2$/.test(d[0]), saw: 'after cancel ' + after1 + ' · ' + d.join(' | ') };
    });
  }
  await w.step('O12', 'Home: Operations is built at /operations.html with a facts card; Stock and Suppliers point into it', async () => {
    const m = await page.evaluate(() => fetch('/app/manifest.json').then((r) => r.json()));
    const by = Object.fromEntries(m.entries.map((e) => [e.id, e]));
    const o = by.operations, s = by.stock, p = by.suppliers;
    return { ok: o.state === 'built' && o.route === '/operations.html' && o.facts === '/api/facts/operations' && s.state === 'built' && /^\/operations\.html#\/stock$/.test(s.route) && p.state === 'built' && /^\/operations\.html#\/suppliers$/.test(p.route), saw: [o.state, o.route, o.facts, s.route, p.route].join(' · ') };
  });

  /* ── RULE 13: two themes × two widths × two tabs ── */
  const audit = () => page.evaluate(() => {
    const host = document.getElementById('ops'), out = { clip: [], frameClip: [], scroll: [], cover: [], app: [], budget: [] };
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    document.querySelectorAll('body *').forEach((el) => {
      if (!vis(el) || el.closest('#cb-avatar,#toast,script,style')) return;
      const cs = getComputedStyle(el), hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
      /* the one scroller CBList owns (.cbl-list) may scroll both ways at a narrow width only when its grid is wider — the list standard; anything else may not */
      if (/auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el !== document.documentElement && el !== document.body && !el.classList.contains('cbl-list')) out.scroll.push(el.tagName + '.' + el.className + ' ' + el.scrollWidth + '>' + el.clientWidth);
      if (hasText && (cs.textOverflow === 'ellipsis' || /hidden|clip/.test(cs.overflowX)) && el.scrollWidth > el.clientWidth + 1) (host.contains(el) ? out.clip : out.frameClip).push(el.textContent.trim().slice(0, 40));
      const href = (el.getAttribute('href') || '') + ' ' + (el.getAttribute('onclick') || '');
      if (/app\.html/.test(href)) out.app.push(el.outerHTML.slice(0, 80));
    });
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.scroll.push('page ' + document.documentElement.scrollWidth + '>' + window.innerWidth);
    host.querySelectorAll('button,input,select,textarea,a').forEach((c) => {
      if (!vis(c)) return; const r = c.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;   /* off the visible pane: the unit's own scroller holds it */
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && hit !== c && !c.contains(hit) && !hit.contains(c) && !hit.closest('#toast') && host.contains(hit) === false) out.cover.push((c.dataset.testid || c.id || c.tagName) + ' under ' + (hit.id || hit.className || hit.tagName));
    });
    host.querySelectorAll('p,.sub,.err,.cbl-state').forEach((n) => {
      const t = n.textContent.replace(/\s+/g, ' ').replace(/Try again$/, '').trim(); if (!t) return;
      const sentences = t.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length;
      if (t.length > 140 || sentences > 2) out.budget.push(t.length + ' chars / ' + sentences + ' sentences: "' + t.slice(0, 50) + '…"');
    });
    return out;
  });
  let k = 0; const frameClip = new Set();
  for (const theme of ['cream', 'dark']) {
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      for (const sec of ['stock', 'suppliers']) {
        k++;
        await w.step('T' + k, sec + ' · ' + theme + ' · ' + width + ' px -> AA contrast, no clipping, no inner sideways scroll, nothing floating over a control, no app.html link, copy in budget', async () => {
          if (sec === 'stock') await stock(); else await sups();
          await page.evaluate((t) => { CBAvatar.applyTheme(t); }, theme); await page.waitForTimeout(150);
          /* open one row's next level so its words are measured too */
          const first = page.locator(sec === 'stock' ? '[data-testid="stock-row-rice"]' : '[data-testid^="sup-row-"]').first();
          if (await first.count()) { await first.click().catch(() => {}); await page.waitForTimeout(200); }
          const pairs = await page.evaluate(measure), bad = pairs.filter((x) => !x.grad && x.ratio < x.need);
          const a = await audit();
          const fails = [].concat(bad.map((x) => 'contrast ' + x.ratio + ' "' + x.text + '"'), a.clip.map((x) => 'clipped "' + x + '"'), a.scroll.map((x) => 'scroll ' + x),
            a.cover.map((x) => 'covered ' + x), a.app.map((x) => 'app.html ' + x), a.budget.map((x) => 'budget ' + x));
          a.frameClip.forEach((x) => frameClip.add(x));
          return { ok: !fails.length && pairs.length > 10, saw: pairs.length + ' texts measured, lowest ' + Math.min.apply(null, pairs.map((x) => x.ratio)) + (fails.length ? ' · ' + fails.slice(0, 4).join(' · ') : ' · clean') };
        });
      }
    }
  }
  await page.evaluate(() => { CBAvatar.applyTheme('cream'); }).catch(() => {});
  if (frameClip.size) w.note('T9', 'the shared frame\'s top bar at 390 px (not this page\'s pane)', 'ellipsised: ' + [...frameClip].join(' · '));
  if (w.errs.length) w.note('T99', 'page errors seen during the walk', w.errs.slice(0, 3).join(' | '));
  if (S.stack) S.stack.stop();
};
walk.opts = { viewport: { width: 1366, height: 900 } };
W.run('operations', walk);

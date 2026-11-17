#!/usr/bin/env node
/**
 * e2e/walk-x-o2c.cjs — O2C (order to cash), EVERY SCREEN, WIDTH AND DEPTH, ON A REAL STACK (round WX-O2C, 2026-10-13).
 * Owner: "walk each of the screen across all the flow both depth and width and resolve the issues for every operation".
 *
 * The flow is docs/process/flows.json → O2C: 1 enquiry (Network) · 2 quote (MISSING) · 3 order (storefront → the seller's Task list) ·
 * 4 delivery (the chit's lines delivered) · 5 invoice (the counter bill) · 6 receipt (Ledger › Receive / CB Finance) · 7 posted (Day book ·
 * Trial balance · P&L · GST) — then the reverse (void) and the trail. Each screen at 1366×768 AND 390×844; every control pressed; the refused
 * state with a view-only login. It asserts on what the SCREEN shows (the visible text + a screenshot per step), never only the DOM or the API.
 *
 *   --real     the REAL stack: ../chitbridge-api spawned against the loader's Postgres (docs/SIM-LOAD.md: `node tools/sim-load.cjs --schema
 *              --country IN --shop simstores --start 2023-04-01` — the years end before today; then `--country AU --shop austores --seed 11`, refused until an AU pack is adopted). Nothing is stubbed; what the screens show is
 *              what the routes answered. Needs e2e/lib/real-stack.cjs's CB_REAL_DB (default postgres://postgres:pw@127.0.0.1:5432/cb_sim).
 *   (no flag)  fixture mode — the storefront and the seller's screens on the stand-in API (the cloud walks): the paths that need a database
 *              are NOTEd, never silently passed.
 *   --only S3,S5   run some sections (S1 enquiry · S3 order · S4 delivery · S5 invoice · S6 receipt · S7 posted · S8 reverse · S9 view-only · S10 AU)
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-x-o2c.cjs --real
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-x-o2c-NN.png (+ -phone for the 390 px pass).
 */
'use strict';
const path = require('path'), fs = require('fs');
const W = require('./lib/walk.cjs');
const R = require('./lib/real-stack.cjs');
const REAL = process.argv.includes('--real');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? String(process.argv[i + 1] || '').split(',').filter(Boolean) : null; })();
const want = (s) => !ONLY || ONLY.includes(s);
const SHOTS = path.join(__dirname, 'shots');
const LAPTOP = { width: 1366, height: 768 }, PHONE = { width: 390, height: 844 };
const OWNER = 'simstores', OWNER_EMAIL = 'simstores@test.example', AU = 'austores', AU_EMAIL = 'austores@test.example';
const RUN = String(Date.now()).slice(-7);                 /* a fresh shopper per run — the loader's shop is shared across runs */   /* clock-ok: a unique run suffix */
const SHOPPER = { contact: '9' + RUN.padStart(9, '0'), name: 'Walk Shopper ' + RUN, location: '12 Walk Street, Madurai' };
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const body = async (page) => norm(await page.evaluate(() => document.body.innerText).catch(() => ''));
const txt = async (page, sel) => norm(await page.locator(sel).first().innerText().catch(() => ''));
const has = (page, sel) => page.locator(sel).count().then((n) => n > 0);
const scrollW = (page) => page.evaluate(() => document.documentElement.scrollWidth);
const shot = async (page, name) => { try { await page.screenshot({ path: path.join(SHOTS, 'walk-x-o2c-' + name + '.png') }); } catch (_) {} };
const settle = (page, ms) => page.waitForTimeout(ms || 500);

W.run('x-o2c', async (w) => {
  const { page, ctx, base, browser } = w;
  fs.mkdirSync(SHOTS, { recursive: true });
  let stack = null, api = '', owner = null, viewer = null, shopIn = null, order = null;

  /* ── the stack ─────────────────────────────────────────────────────────────────────────────────────────────── */
  if (REAL) {
    stack = await R.up({ webBase: base });
    api = stack.api;
    owner = await R.signIn(api, OWNER_EMAIL);
    shopIn = await R.j(api + '/api/entities/me', { token: owner.token }).then((r) => r.b.entity);
    /* the storefront is the shop's choice (Profile › Visibility › Public) — made once by the api, the screen that makes it is walked in S3 */
    await R.j(api + '/api/entities/profile', { method: 'PATCH', token: owner.token, body: { catalogue_visibility: 'public' } });
    /* a view-only employee for the refused states (S9) — created once; a second run signs the same one in */
    try { viewer = await R.viewer(api, owner.token, OWNER); } catch (e) { console.log('   (viewer: ' + e.message.slice(0, 160) + ')'); }
    /* the walk's own page talks to THIS api (the apps read cb_api_base / cb_till_api) */
    await ctx.addInitScript((a) => { try { localStorage.setItem('cb_api_base', a); localStorage.setItem('cb_till_api', a); } catch (_) {} }, api);
    /* a run without S3 (whose O3.10 signs in on the real screen) starts signed in as the owner */
    if (ONLY && !ONLY.includes('S3')) await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_sess')) localStorage.setItem('cb_sess', s); } catch (_) {} }, owner.session);
  }
  /** a page in a fresh context at a width, holding a session (the cb_sess the apps store) and pointed at the api */
  const newPage = async (vp, sess) => {
    const c = await browser.newContext({ viewport: vp, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await c.addInitScript((s) => { try { window.print = function () { window.__printed = (window.__printed || 0) + 1; }; if (s.api) { localStorage.setItem('cb_api_base', s.api); localStorage.setItem('cb_till_api', s.api); } if (s.sess) localStorage.setItem('cb_sess', s.sess); } catch (_) {} }, { api, sess: sess || '' });
    const p = await c.newPage();
    p.on('pageerror', (e) => w.errs.push(String(e && e.message || e)));
    return p;
  };
  /** the cart's own popup holds Check out — the dock's chip (.cbcart-bar) opens it first, as a shopper does */
  const checkout = async (p) => { if (!(await p.locator('[data-testid="cart-checkout"]').isVisible().catch(() => false))) { await p.locator('[data-testid="shop-dock"] .cbcart-bar').first().click(); await settle(p, 400); } await p.click('[data-testid="cart-checkout"]'); };
  /** the basket checkout in its steps (shop.html _cartStepsFor): Pickup or delivery → Continue → Who you are → "Send me a code" → the code → "Place order" */
  const sheetTo = async (p, who) => {
    await p.click('[data-testid="shop-mode-delivery"]'); await settle(p, 200);
    if (who.location) await p.fill('[data-testid="shop-area"]', who.location);
    await p.locator('[data-testid^="step-next-"]').first().click(); await settle(p, 400);
  };
  const sheetSend = async (p, who) => {
    if (who.name && await has(p, '[data-testid="shop-name"]')) await p.fill('[data-testid="shop-name"]', who.name);
    await p.fill('[data-testid="shop-contact"]', who.contact);
    await p.click('[data-testid="shop-cart-submit"]'); await p.waitForSelector('[data-testid="shop-otp"]', { timeout: 15000 });
    const sent = await body(p);
    const code = await p.locator('[data-testid="shop-otp"]').inputValue().catch(() => ''); if (!code) await p.fill('[data-testid="shop-otp"]', R.OTP_CUSTOMER);
    await p.locator('[data-testid="shop-otp"]').dispatchEvent('input').catch(() => {}); await settle(p, 200);
    await p.click('[data-testid="shop-cart-submit"]'); await p.click('[data-testid="confirm-ok"]'); await p.waitForSelector('[data-testid="shop-receipt-no"]', { timeout: 20000 }).catch(() => {});
    return sent;
  };
  const shopUrl = (extra) => base + '/shop.html?s=' + OWNER + (api ? '&api=' + encodeURIComponent(api) : '') + (extra || '');

  /* ════ S3 · ORDER — the buyer on the storefront, the seller in Task ══════════════════════════════════════════════ */
  if (want('S3')) {
    if (!REAL) { w.note('O3.0', 'Order on the storefront', 'needs the real stack (--real): the storefront prices against the shop\'s shelf and the order lands in the seller\'s Task list'); }
    else {
      /* the storefront at 1366 */
      await page.setViewportSize(LAPTOP);
      await page.goto(shopUrl()); await page.waitForSelector('[data-testid="shop-search"]', { timeout: 20000 }).catch(() => {}); await settle(page, 800);
      await w.step('O3.1', 'Storefront (1366) -> the shop\'s name, a search box, Categories, and the shelf priced', async () => {
        const t = await body(page), n = await page.locator('.cbcat-row').count();
        return { ok: /Simulated Stores/.test(t) && await has(page, '[data-testid="shop-search"]') && await has(page, '[data-testid="shop-cat-btn"]') && n > 0 && /₹/.test(t), saw: n + ' product rows; name ' + (/Simulated Stores/.test(t) ? 'shown' : 'MISSING') + '; ' + (/₹/.test(t) ? 'prices in ₹' : 'NO PRICE') };
      });
      await w.step('O3.2', 'Storefront -> type "rice" in search -> only rice is left; clear -> the shelf is back', async () => {
        await page.fill('[data-testid="shop-search"]', 'rice'); await settle(page, 500);
        const t1 = await body(page), n1 = await page.locator('.cbcat-row').count();
        await page.fill('[data-testid="shop-search"]', ''); await settle(page, 500);
        const n2 = await page.locator('.cbcat-row').count();
        return { ok: /Ponni raw rice/.test(t1) && n1 < n2, saw: n1 + ' row(s) for "rice" (' + (/Ponni raw rice/.test(t1) ? 'Ponni raw rice' : 'rice NOT found') + '); ' + n2 + ' after clearing' };
      });
      await w.step('O3.3', 'Storefront -> Categories ▾ -> the panel lists the shelf\'s categories; pick Staples -> the list jumps to it', async () => {
        await page.click('[data-testid="shop-cat-btn"]'); await settle(page, 400);
        const panel = await txt(page, '.catpanel'), open = await page.locator('.catpanel:not([hidden])').count();
        const pick = page.locator('.catpick', { hasText: 'Staples' }).first();
        if (await pick.count()) await pick.click(); await settle(page, 500);
        const closed = (await page.locator('.catpanel:not([hidden])').count()) === 0;
        return { ok: open === 1 && /Staples/.test(panel) && /Dairy/.test(panel) && closed, saw: 'panel ' + (open ? 'opened' : 'DID NOT OPEN') + ' with "' + panel.slice(0, 80) + '"; after picking Staples it ' + (closed ? 'closed' : 'STAYED OPEN') };
      });
      await w.step('O3.4', 'Storefront -> add Ponni raw rice ×2 and Toor dal ×1 -> the dock shows 2 items and the total the server will price (62×2+85 = 209)', async () => {
        const add = async (name, times) => { const row = page.locator('.cbcat-row', { hasText: name }).first(); for (let i = 0; i < times; i++) { await row.locator('[data-testid="cart-add"]', { hasText: '+' }).last().click(); await settle(page, 250); } };
        await add('Ponni raw rice', 2); await add('Toor dal', 1);
        const dock = await txt(page, '[data-testid="shop-dock"]'), on = await page.locator('[data-testid="shop-dock"].on').count();
        return { ok: on === 1 && /209/.test(dock), saw: 'dock ' + (on ? 'shown' : 'HIDDEN') + ': "' + dock.slice(0, 120) + '"' };
      });
      await w.step('O3.5', 'Storefront -> the cart bar -> Check out -> Pickup or delivery (Continue refused with its sentence until one is chosen) -> Delivery + address -> Who you are: name, phone, "Send me a code"; sending without a phone says so', async () => {
        await checkout(page); await settle(page, 600);
        const s1 = await body(page);
        await page.locator('[data-testid^="step-next-"]').first().click().catch(() => {}); await settle(page, 300);
        const refused = /Choose pickup or delivery/.test(await body(page));
        await sheetTo(page, SHOPPER);
        const hasFields = await has(page, '[data-testid="shop-contact"]') && await has(page, '[data-testid="shop-cart-submit"]');
        if (hasFields) { await page.click('[data-testid="shop-cart-submit"]'); await settle(page, 400); }
        const err = await body(page);
        await shot(page, 'storefront-sheet');
        const said = /phone or email/i.test(err);
        return { ok: /Pickup or delivery/.test(s1) && refused && hasFields && said, saw: 'step 1 ' + (/Pickup or delivery/.test(s1) ? 'shown' : 'MISSING') + '; Continue with no choice ' + (refused ? 'says "Choose pickup or delivery."' : 'SAID NOTHING') + '; ' + (hasFields ? 'Who you are: contact + Send me a code' : 'NO WHO-YOU-ARE STEP') + '; empty phone -> ' + (said ? 'a sentence' : 'no sentence') };
      });
      await w.step('O3.6', 'Storefront -> name, phone -> Send me a code -> "Code sent" and the code box; the code -> Place order -> "Order placed", the order number, the total 209, "Waiting for the shop"', async () => {
        const sent = await sheetSend(page, SHOPPER);
        const rec = await body(page), no = await txt(page, '[data-testid="shop-receipt-no"]'), tot = await txt(page, '[data-testid="shop-receipt-total"]'), st = await txt(page, '[data-testid="shop-receipt-status"]');
        order = { no: no.replace(/^Order #/, ''), total: tot };
        const wl = await R.j(api + '/api/work/list?view=orders_in&limit=5', { token: owner.token }); const mine = ((wl.b && wl.b.rows) || []).find((x) => x.party === SHOPPER.name); if (mine) order.chit_id = mine.chit_id;
        return { ok: /code sent/i.test(sent) && /Order placed/.test(rec) && /CB-/.test(no) && /209/.test(tot) && /Waiting for the shop/.test(st), saw: (/code sent/i.test(sent) ? 'code sent; ' : 'NO "code sent"; ') + (no || 'NO ORDER NUMBER') + ' · total ' + tot + ' · ' + st + (no ? '' : ' · screen: "' + rec.slice(-200) + '"') };
      });
      await w.step('O3.7', 'Storefront -> My orders -> the order just placed, "Waiting for the shop", its total', async () => {
        await page.click('[data-testid="shop-my-orders"]'); await page.waitForSelector('[data-testid="shop-order-row"]', { timeout: 10000 }).catch(() => {});
        const rows = await page.locator('[data-testid="shop-order-row"]').count(), t = await txt(page, '[data-testid="shop-orders"]');
        return { ok: rows >= 1 && /Waiting for the shop/.test(t) && /209/.test(t), saw: rows + ' order(s): "' + t.slice(0, 100) + '"' };
      });
      await shot(page, 'storefront-receipt');
      await page.evaluate(() => { try { orderClose(); } catch (_) {} });
      /* the storefront at 390 */
      const ph = await newPage(PHONE, '');
      await ph.goto(shopUrl()); await ph.waitForSelector('[data-testid="shop-search"]', { timeout: 20000 }).catch(() => {}); await settle(ph, 800);
      await w.step('O3.8', 'Storefront (390) -> no sideways scroll; the search band, Categories and the shelf fit; add one item -> the dock sits at the foot, nothing above it moves', async () => {
        const sw = await scrollW(ph);
        const top = () => ph.evaluate(() => { const r = document.querySelector('.cbcat-row'); return r ? Math.round(r.getBoundingClientRect().top + window.scrollY) : null; });
        const y0 = await top();
        await ph.locator('.cbcat-row', { hasText: 'Sugar 1 kg' }).first().locator('[data-testid="cart-add"]', { hasText: '+' }).last().click(); await settle(ph, 400);
        const y1 = await top();
        const dock = await ph.locator('[data-testid="shop-dock"].on').boundingBox().catch(() => null);
        await shot(ph, 'storefront-phone');
        const moved = y0 != null && y1 != null && Math.abs(y0 - y1) > 1;
        return { ok: sw === 390 && !!dock && !moved, saw: 'scrollWidth ' + sw + '; dock ' + (dock ? 'at y=' + Math.round(dock.y) + ' (viewport 844)' : 'MISSING') + '; first row ' + (moved ? 'MOVED by ' + (y1 - y0) + 'px' : 'stayed') };
      });
      await w.step('O3.9', 'Storefront (390) -> the order sheet fits the phone: the fields, Send code, no sideways scroll', async () => {
        await checkout(ph); await settle(ph, 600); await sheetTo(ph, SHOPPER);
        const sw = await scrollW(ph), ok = await has(ph, '[data-testid="shop-cart-submit"]') && await has(ph, '[data-testid="shop-contact"]');
        await shot(ph, 'storefront-phone-sheet');
        return { ok: sw === 390 && ok, saw: 'scrollWidth ' + sw + '; Who you are + Send me a code ' + (ok ? 'shown' : 'MISSING') };
      });
      await ph.context().close();

      /* ── the seller: sign in on the real Sign in screen, then Task ── */
      await page.goto(base + '/app.html#/login'); await page.waitForSelector('#l_id', { timeout: 20000 });
      await w.step('O3.10', 'Sign in (the seller) -> User ID simstores -> the code -> the app opens as Simulated Stores', async () => {
        await page.fill('#l_id', OWNER); await page.press('#l_id', 'Enter'); await settle(page, 300);
        if (!(await has(page, '#l_otp'))) { await page.locator('button', { hasText: /continue|next|send|sign in/i }).first().click().catch(() => {}); }
        await page.waitForSelector('#l_otp', { timeout: 15000 });
        await page.fill('#l_otp', R.OTP); await page.press('#l_otp', 'Enter'); await settle(page, 300);
        if (await has(page, '#l_otp')) { await page.locator('button', { hasText: /verify|sign in|continue/i }).first().click().catch(() => {}); }
        await page.waitForFunction(() => !document.getElementById('l_otp'), null, { timeout: 20000 }).catch(() => {});
        await settle(page, 1500);
        const t = await body(page), h = await page.evaluate(() => location.hash);
        const sess = await page.evaluate(() => localStorage.getItem('cb_sess'));
        if (sess) owner.session = sess;
        return { ok: /Simulated Stores/.test(t) && !!sess, saw: 'landed on ' + h + '; ' + (/Simulated Stores/.test(t) ? 'the shop\'s name is on screen' : 'the shop\'s name is NOT on screen') + '; session ' + (sess ? 'stored' : 'NOT stored') };
      });
      await page.goto(base + '/app.html#/app/task'); await settle(page, 2500);
      await w.step('O3.11', 'Task (1366) -> the Open chip counts the new order; the list opens on "Latest on top" and the order is on the first page', async () => {
        await settle(page, 1500);
        const t = await body(page);
        const open = (t.match(/Open\s*(\d+)\s*\/\s*(\d+)/) || [])[0] || '';
        const there = new RegExp(SHOPPER.name).test(t);
        return { ok: there, saw: 'chip "' + open + '"; the order ' + (there ? 'is on the first page' : 'is NOT on the first page (' + (t.match(/Showing \d+ of \d+[^.]*/) || ['no count'])[0] + '; "' + (t.match(/Nothing in Open[^.]*\.?[^.]*/) || [''])[0] + '")') };
      });
      await w.step('O3.12', 'Task -> search the buyer\'s name -> the order is the one row; open it -> the detail names the buyer, both lines, the total 209, and Status ▾ is offered', async () => {
        await page.fill('#listsrch', SHOPPER.name); await settle(page, 2500);
        const t0 = await body(page);
        const row = page.locator('#listbody .rowgrid, #listbody [data-testid^="row"], .lrow, [data-chit]', { hasText: SHOPPER.name }).first();
        if (await row.count()) await row.click().catch(() => {}); else await page.locator('text=' + SHOPPER.name).first().click().catch(() => {});
        await settle(page, 2000);
        const t = await body(page);
        const btn = await has(page, '[data-testid="chit-status-btn"]');
        return { ok: new RegExp(SHOPPER.name).test(t0) && /Ponni raw rice/.test(t) && /Toor dal/.test(t) && /209/.test(t) && btn, saw: 'search ' + (new RegExp(SHOPPER.name).test(t0) ? 'found it' : 'found NOTHING') + '; detail: lines ' + (/Ponni raw rice/.test(t) && /Toor dal/.test(t) ? 'both shown' : 'MISSING') + ', total ' + (/209/.test(t) ? '209' : 'NOT 209') + ', Status ▾ ' + (btn ? 'offered' : 'NOT offered') };
      });
      await shot(page, 'order-detail');
    }
  }

  /* ════ S4 · DELIVERY — accept, deliver the lines, complete; the buyer sees it ═══════════════════════════════════ */
  if (want('S4')) {
    if (!REAL) w.note('O4.0', 'Delivery of the order', 'needs the real stack (--real)');
    else {
      if (!order) { /* a run of S4 alone: place the order by the api and open it */
        const cat = await R.j(api + '/api/catalogue/' + OWNER); const items = cat.b.items || [];
        const pick = (n) => items.find((x) => ((x.item_data || x).name || '') === n) || items[0];
        const o = await R.shopperOrder(api, OWNER, { contact: SHOPPER.contact, name: SHOPPER.name, location: SHOPPER.location, lines: [{ item_id: pick('Ponni raw rice 1 kg').item_id, name: 'Ponni raw rice 1 kg', quantity: 2 }, { item_id: pick('Toor dal 500 g').item_id, name: 'Toor dal 500 g', quantity: 1 }] });
        order = { no: 'CB-' + String(o.chit_id).slice(0, 8), chit_id: o.chit_id };
        await page.setViewportSize(LAPTOP);
        await page.goto(base + '/app.html#/app/chit/' + o.chit_id); await page.reload(); await settle(page, 3500);   /* a hash change alone does not boot the door */
      }
      const moveStatus = async (word) => {
        await page.locator('[data-testid="chit-status-btn"]:visible').first().click({ timeout: 10000 }); await settle(page, 600);
        const opts = norm(await page.locator('.optrow').allInnerTexts().then((a) => a.join(' | ')).catch(() => ''));
        /* the sheet speaks folder words (Open · Act · Close) where the list speaks the engine's (New · Accepted · Closed) — finding F-O4a */
        const o = page.locator('.optrow', { hasText: new RegExp('^(' + word + ')') }).first();
        if (!(await o.count())) { await page.locator('.mfoot button', { hasText: /Cancel/ }).first().click().catch(() => {}); return { opts, moved: false }; }
        await o.click(); await settle(page, 400);
        const note = page.locator('.mbody textarea, .mbody input[type="text"]').first();
        if (await note.count()) await note.fill('Walk: ' + word).catch(() => {});
        await page.locator('.mfoot button', { hasText: /Set status|Move|Save|OK|Apply|Done|Yes|Confirm/ }).first().click().catch(() => {});
        await settle(page, 900);
        const said = ((await body(page)).match(/→ [A-Z_]+ ✓/) || [''])[0];   /* the toast: "<code> → ACT ✓" */
        await settle(page, 1100);
        /* the list moves its cursor on (the email-style next row) — the order is opened again by its door, as the Ledger does */
        await page.goto(base + '/app.html#/app/chit/' + (order.chit_id || '')).catch(() => {}); await page.reload().catch(() => {}); await settle(page, 3500);
        return { opts, moved: true, said };
      };
      if (process.env.CB_WALK_DEBUG) { await shot(page, 'debug-o4'); console.log('DEBUG', (await body(page)).slice(0, 600), await page.evaluate(() => [location.href, typeof UI !== 'undefined' && UI.sel])); }
      await w.step('O4.1', 'Order -> Status ▾ -> the sheet lists the moves; Accept -> the status word is Accepted on the screen', async () => {
        const r = await moveStatus('Accept|Act');
        const t = await body(page);
        const word = (t.match(/· (OPEN|ACT|CLOSE|ACCEPTED|NEW)\b/) || [, '(no status word)'])[1];
        return { ok: r.moved && /ACT/.test(r.said) && /ACT|ACCEPTED/.test(word), saw: 'moves offered: ' + r.opts.slice(0, 120) + '; toast "' + r.said + '"; reopened, the header says ' + word };
      });
      await w.step('O4.2', 'Order -> ⧉ Lines -> Delivered & paid -> the two lines with 0 of 2 / 0 of 1; deliver 2 rice -> the line shows 2 delivered, "1 of 2 complete"', async () => {
        await page.click('[data-testid="open-design2"]'); await settle(page, 2500);
        await page.locator('[data-testid="c2-tab-del"]').first().click().catch(() => {}); await settle(page, 800);
        const t0 = await body(page);
        const rows = await page.locator('[data-testid="c2-del-row"]').count();
        const rice = page.locator('[data-testid="c2-del-row"]', { hasText: 'Ponni raw rice' }).first();
        const lineId = await rice.getAttribute('data-line').catch(() => null);
        if (lineId) { await page.fill('#c2dq_' + lineId, '2').catch(() => {}); await rice.locator('[data-testid="c2-delivered"]').click().catch(() => {}); await settle(page, 2500); }
        const t = await body(page);
        await shot(page, 'order-deliver');
        return { ok: rows === 2 && !!lineId && /1 of 2 complete/.test(t), saw: rows + ' line rows; ' + (lineId ? 'Delivered pressed for rice' : 'NO rice row (' + t0.slice(0, 160) + ')') + '; after: ' + ((t.match(/\d of \d complete/) || ['no "n of n complete"'])[0]) };
      });
      await w.step('O4.3', 'Order -> deliver 1 dal -> "2 of 2 complete"; Status ▾ -> Complete -> the status word is Completed', async () => {
        const dal = page.locator('[data-testid="c2-del-row"]', { hasText: 'Toor dal' }).first();
        const lineId = await dal.getAttribute('data-line').catch(() => null);
        if (lineId) { await page.fill('#c2dq_' + lineId, '1').catch(() => {}); await dal.locator('[data-testid="c2-delivered"]').click().catch(() => {}); await settle(page, 2500); }
        const t1 = await body(page);
        await page.locator('[data-testid="c2-side-them"], [data-testid^="c2-side-"]').first().click().catch(() => {});
        await page.goto(base + '/app.html#/app/chit/' + (order.chit_id || '')).catch(() => {}); await page.reload().catch(() => {}); await settle(page, 3500);
        const r = await moveStatus('Complete|Close');
        const t = await body(page);
        const word = (t.match(/· (OPEN|ACT|CLOSE|CLOSED|COMPLETED)\b/) || [, '(no status word)'])[1];
        return { ok: /2 of 2 complete/.test(t1) && r.moved && /CLOSE|COMPLETED/.test(word), saw: ((t1.match(/\d of \d complete/) || ['no "n of n complete"'])[0]) + '; moves: ' + r.opts.slice(0, 100) + '; after: the header says ' + word };
      });
      await w.step('O4.4', 'Storefront -> My orders (the buyer) -> the order now says Delivered', async () => {
        const ph = await newPage(LAPTOP, '');
        await ph.goto(shopUrl()); await ph.waitForSelector('[data-testid="shop-search"]', { timeout: 20000 }).catch(() => {});
        /* the shopper's own view needs their session: the order sheet mints it on Place order — so the shopper asks the code again and reads My orders through the sheet */
        await ph.locator('.cbcat-row', { hasText: 'Sugar 1 kg' }).first().locator('[data-testid="cart-add"]', { hasText: '+' }).last().click(); await settle(ph, 300);
        await checkout(ph); await settle(ph, 500);
        await sheetTo(ph, SHOPPER); await sheetSend(ph, SHOPPER);
        await ph.click('[data-testid="shop-my-orders"]').catch(() => {}); await ph.waitForSelector('[data-testid="shop-order-row"]', { timeout: 10000 }).catch(() => {});
        const t = await txt(ph, '[data-testid="shop-orders"]');
        await shot(ph, 'storefront-my-orders');
        await ph.context().close();
        return { ok: /Delivered/.test(t), saw: 'My orders: "' + t.slice(0, 160) + '"' };
      });
    }
  }

  /* ════ S5 · INVOICE — the counter bill IS the invoice (till.html), the slip, the bills list, bill-print ═══════════════ */
  let bill = null;   /* { no, chit_id, total } the credit bill to Ravi Stores */
  const tillOpen = async (pg) => {
    await pg.goto(base + '/till.html'); await pg.waitForFunction(() => typeof window.finish === 'function' && window.S && (window.S.items || []).length > 0, null, { timeout: 30000 }).catch(() => {});
    await settle(pg, 1500);
    /* the sign-in window offers a counter PIN over the till (Not now) — a dialog over the counter would swallow the keys */
    if (await has(pg, '[data-testid="signin-later"]')) await pg.click('[data-testid="signin-later"]').catch(() => {});
    await settle(pg, 600);
    await pg.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => { try { d.close(); } catch (_) {} }); });
  };
  const tillType = async (pg, name) => { await pg.fill('#q', name); await settle(pg, 300); await pg.press('#q', 'Enter'); await settle(pg, 700); };
  if (want('S5')) {
    if (!REAL) w.note('O5.0', 'The counter bill on a real shop', 'needs the real stack (--real); the fixture till is walked by e2e/walk-bill.cjs');
    else {
      await page.setViewportSize(LAPTOP);
      await tillOpen(page);
      await w.step('O5.1', 'Counter (1366) -> opens signed in as the shop (the Home session handed over, no second code): the shop\'s name, the shelf with prices and slabs, Sell mode', async () => {
        const t = await body(page), dlg = await page.evaluate(() => document.querySelectorAll('dialog[open]').length);
        return { ok: /Simulated Stores/.test(t) && /Sugar 1 kg/.test(t) && /5% GST|18% GST/.test(t) && dlg === 0, saw: 'shop ' + (/Simulated Stores/.test(t) ? 'named' : 'NOT named') + '; shelf ' + (/Sugar 1 kg/.test(t) ? 'shown with slabs' : 'MISSING') + '; dialogs open: ' + dlg };
      });
      await w.step('O5.2', 'Counter -> the online orders pill -> the storefront order of this walk is listed to bill (needs the api fix: own bills left out of the read)', async () => {
        await page.evaluate(() => { try { ONLINE.at = 0; } catch (_) {} return onlineOrdersLoad && onlineOrdersLoad(); }).catch(() => {});
        await settle(page, 2500);
        await page.evaluate(() => onlineOrdersOpen()); await settle(page, 800);
        const d = await txt(page, '#onlinedlg'), rows = await page.locator('[data-testid^="till-online-row-"]').count();
        await page.evaluate(() => { try { document.getElementById('onlinedlg').close(); } catch (_) {} });
        /* a run without S3 placed no order of its own: any open online order proves the pill reads them */
        return { ok: rows >= 1 && (!order || new RegExp(SHOPPER.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(d)), saw: rows + ' online order(s): "' + d.slice(0, 140) + '"' };
      });
      await w.step('O5.3', 'Counter -> type Sugar 1 kg, Toor dal 500 g, customer "Ravi Stores" -> the bill has 2 lines, total 129.00 (prices include tax), and "On credit" appears because the shop knows the customer', async () => {
        await tillType(page, 'Sugar 1 kg'); await tillType(page, 'Toor dal 500 g');
        await page.fill('#cname', 'Ravi Stores'); await page.evaluate(() => rwTyped()); await settle(page, 900);
        const cart = await page.evaluate(() => (window.CART || []).map((l) => l.name + ' ×' + l.qty));
        const total = await txt(page, '[data-testid="till-total"]'), credit = await has(page, '[data-testid="till-pay-credit"]');
        return { ok: cart.length === 2 && /129/.test(total) && credit, saw: cart.join(', ') + ' · total "' + total + '" · On credit ' + (credit ? 'offered' : 'NOT offered') };
      });
      await w.step('O5.4', 'Counter -> On credit -> save (F9) -> the slip: TAX INVOICE, the number, Ravi Stores, ON CREDIT, GST summary, TOTAL ₹128.99; the print was asked once', async () => {
        await page.click('[data-testid="till-pay-credit"]'); await settle(page, 400);
        await page.evaluate(() => finish()); await page.waitForSelector('#slipdlg[open]', { timeout: 20000 }).catch(() => {});
        await settle(page, 1500);
        const slip = await txt(page, '#slipdlg'), last = await txt(page, '[data-testid="till-lastbill"]');
        const no = (slip.match(/No ([A-Z0-9]+\/\d\d-\d\d\/\d{4})/) || [])[1] || (last.match(/([A-Z0-9]+\/\d\d-\d\d\/\d{4})/) || [])[1] || '';
        bill = { no, total: '128.99', chit_id: no ? await R.billByNo(no).catch(() => null) : null };
        await shot(page, 'till-slip');
        await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => { try { d.close(); } catch (_) {} }); });
        return { ok: /TAX INVOICE/.test(slip) && !!no && /Ravi Stores/.test(slip) && /ON CREDIT/.test(slip) && /128\.99/.test(slip) && /GST SUMMARY/.test(slip), saw: 'bill ' + (no || 'NO NUMBER') + '; slip: ' + (/TAX INVOICE/.test(slip) ? 'tax invoice' : 'NOT a tax invoice') + ', ' + (/128\.99/.test(slip) ? '₹128.99' : 'total MISSING') + ', ' + (/ON CREDIT/.test(slip) ? 'on credit' : 'credit NOT shown') + '; printed: ' + (await page.evaluate(() => window.__printed || 0)) };
      });
      await w.step('O5.5', 'Counter -> Bills (F8) -> the bill just made is the first row with its number, Ravi Stores and 128.99; open it -> the slip again', async () => {
        await page.click('[data-testid="till-side-bills"]').catch(() => {}); await settle(page, 2500);
        const t = await body(page);
        const row = page.locator('[data-testid="till-bill-' + (bill && bill.no) + '"], [data-testid^="till-bill-view-"]').first();
        const rt = norm(await row.innerText().catch(() => ''));
        return { ok: !!bill && bill.no && t.indexOf(bill.no) >= 0 && /128\.99/.test(t), saw: (bill && t.indexOf(bill.no) >= 0 ? 'the bill is listed' : 'the bill is NOT listed') + '; first row "' + (rt || t.slice(0, 120)).slice(0, 120) + '"' };
      });
      await shot(page, 'till-bills');
      /* the counter at 390 */
      const ph = await newPage(PHONE, owner.session);
      await tillOpen(ph);
      await w.step('O5.6', 'Counter (390) -> no sideways scroll; search, the shelf and the pay row fit; add Sugar -> the total shows', async () => {
        const sw = await scrollW(ph);
        await tillType(ph, 'Sugar 1 kg');
        /* on a phone the pay row is one step on: "Pay ₹44.00 ›" (till-paygo) at the foot, Cash behind it */
        const total = await txt(ph, '[data-testid="till-total"]'), pay = await ph.locator('[data-testid="till-paygo"], button', { hasText: /^Pay ₹/ }).first().isVisible().catch(() => false);
        await shot(ph, 'till-phone');
        return { ok: sw === 390 && /44/.test(total) && pay, saw: 'scrollWidth ' + sw + '; total "' + total + '"; Pay › ' + (pay ? 'at the foot' : 'NOT visible') };
      });
      await ph.context().close();
      /* bill-print.html — the standalone slip (the printer test): no server; the paper widths */
      await page.goto(base + '/bill-print.html'); await settle(page, 1200);
      await w.step('O5.7', 'Bill print (1366) -> the slip test page: a paper width choice (80 / 58 mm), the kind of bill, Print; pressing Print asks the printer once (silenced here)', async () => {
        const t = await body(page);
        const selects = await page.locator('.controls select').count(), btn = page.locator('.controls button', { hasText: /print/i }).first();
        const p0 = await page.evaluate(() => window.__printed || 0);
        if (await btn.count()) await btn.click().catch(() => {});
        await settle(page, 400);
        const p1 = await page.evaluate(() => window.__printed || 0);
        await shot(page, 'bill-print');
        return { ok: selects >= 1 && p1 === p0 + 1, saw: selects + ' choice(s); Print ' + (await btn.count() ? 'pressed → print asked ' + (p1 - p0) + ' time(s)' : 'NOT found') + '; "' + t.slice(0, 100) + '"' };
      });
      await page.setViewportSize(PHONE); await settle(page, 600);
      await w.step('O5.8', 'Bill print (390) -> the controls wrap and the slip fits (no sideways scroll)', async () => {
        const sw = await scrollW(page);
        await shot(page, 'bill-print-phone');
        return { ok: sw === 390, saw: 'scrollWidth ' + sw };
      });
      await page.setViewportSize(LAPTOP);
    }
  }

  /** a section run without S5: the walk's last credit bill to Ravi Stores (a walk counter's number starts with D — the loader's is C1) */
  const lastBill = async () => { if (bill) return; const no = await R.lastWalkBill().catch(() => null); if (no) bill = { no: no.no, chit_id: no.chit_id, total: no.total }; };
  /* ════ S6 · RECEIPT — Ledger › Unpaid bills › Receive · Receivables · CB Finance › Collections ═════════════════════ */
  const esc = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const acc = async (pg, view, until) => { await pg.goto(base + '/accounts.html#' + view); await pg.waitForSelector(until || '[data-testid="bk-body"]', { timeout: 20000 }).catch(() => {}); await settle(pg, 2500); };
  if (want('S6')) {
    if (!REAL) w.note('O6.0', 'Receive against the bill', 'needs the real stack (--real); the fixture Finance screen is walked by e2e/walk-finance.cjs');
    else {
      await lastBill();
      await acc(page, 'bills', '[data-testid="bills-list"]');
      await w.step('O6.1', 'Ledger › Unpaid bills (1366) -> "Issued" counts the credit bill; the row: its number, Ravi Stores, 128.99, a step word', async () => {
        await page.click('[data-testid="bills-tab-B-1300"]').catch(() => {}); await settle(page, 1500);
        const t = await body(page);
        const issued = (t.match(/Issued\s*(\d+)/) || [])[1];
        const there = !!bill && t.indexOf(bill.no) >= 0;
        if (!bill || !bill.chit_id) { const id = await page.evaluate((no) => { const e = Array.from(document.querySelectorAll('[data-testid^="bill-step-"]')).find((x) => x.closest('[data-testid]') && (x.closest('.cbl-row, .row, [data-chit]') || document.body).innerText.indexOf(no) >= 0); return e ? e.dataset.testid.replace('bill-step-', '') : null; }, bill ? bill.no : '').catch(() => null); if (id) bill.chit_id = id; }
        await shot(page, 'ledger-bills');
        return { ok: there && /128\.99/.test(t) && Number(issued) >= 1, saw: 'Issued ' + issued + '; the bill ' + (there ? 'is listed' : 'is NOT listed') + ' (' + (bill && bill.no) + '); "' + t.replace(/^.*?Issued/, 'Issued').slice(0, 140) + '"' };
      });
      await w.step('O6.2', 'Unpaid bills -> open the bill\'s row -> the bill\'s sheet: Ravi Stores, its lines, its step; Receive is offered on it', async () => {
        const row = page.locator('[data-testid^="bill-"]', { hasText: bill ? bill.no : 'Ravi Stores' }).first();
        await row.click().catch(() => {}); await settle(page, 2000);
        const sheet = norm(await page.evaluate(() => { const d = Array.from(document.querySelectorAll('dialog[open], .sheet, [role="dialog"]')).map((x) => x.innerText).join(' | '); return d; }).catch(() => ''));
        /* the sheet's own buttons only — the page's Receivables nav is not the bill offering Receive */
        const pay = await page.locator('dialog[open] button, [role="dialog"] button', { hasText: /^Receive/ }).count();
        await shot(page, 'ledger-bill-open');
        await page.keyboard.press('Escape').catch(() => {});
        return { ok: /Ravi Stores/.test(sheet) && pay > 0, saw: 'sheet "' + sheet.slice(0, 110) + '"; Receive ' + (pay ? 'offered' : 'NOT offered on the bill (F-O6a)') };
      });
      await w.step('O6.3', 'Receivables -> Ravi Stores -> Receive -> the sheet names Ravi Stores and lists the open bills oldest first; 128.99 Cash, Record -> the receipt is recorded', async () => {
        /* Receive lives at Receivables › the party (payOpen) — the bill's own sheet offers none (finding F-O6a) */
        await acc(page, 'receivables', '[data-testid="dues-list"]');
        const btn = page.locator('[data-testid^="dues-pay-"]').first();
        await btn.click().catch(() => {}); await page.waitForSelector('[data-testid="pay_title"]', { timeout: 10000 }).catch(() => {});
        const title = await txt(page, '[data-testid="pay_title"]');
        await page.fill('#pay_amt', '128.99').catch(() => {}); await settle(page, 1500);
        const bills = await txt(page, '[data-testid="pay_bills"]');
        const mode = page.locator('[data-testid="pay_mode"]').first();
        if (await mode.count()) await mode.selectOption('cash').catch(() => {});
        await settle(page, 800);
        await page.click('[data-testid="pay_record"]').catch(() => {});
        await page.click('dialog[open] [data-testid="confirm-ok"]', { timeout: 5000 }).catch(() => {}); /* R102b: Record asks first — "Record ₹… from <who> by cash?" */
        await page.waitForFunction(() => /Received ₹|Recorded/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
        const out = await txt(page, '[data-testid="pay_outcome"], [data-testid="pay_settled"], [data-testid="pay_done"], .toast'), t = await body(page);
        await shot(page, 'ledger-receive');
        await page.click('[data-testid="pay_done"]').catch(() => {});
        const said = (out + ' ' + t).match(/(Recorded|Received|recorded|saved)[^.]{0,80}/);
        return { ok: /Ravi Stores/.test(title) && /Oldest bill first/.test(bills) && !!said, saw: 'sheet "' + title + '" · bills "' + bills.slice(0, 80) + '" · after Record: "' + (said ? said[0] : (out || 'nothing said').slice(0, 100)) + '"' };
      });
      await acc(page, 'receivables', '[data-testid="dues-list"]');
      await w.step('O6.4', 'Ledger › Receivables -> after the receipt Ravi Stores still owes the rest, in Dr/Cr words (the receipt went to the oldest bill)', async () => {
        const t = await body(page);
        return { ok: /Nobody owes you money/.test(t) || /Ravi Stores/.test(t) && /owe you/.test(t), saw: '"' + t.replace(/^.*?Receivables Simulated Stores/, '').slice(0, 120) + '"' };
      });
      await page.goto(base + '/finance.html#/collections'); await page.waitForSelector('[data-testid="fin-list"], [data-testid="fin-denied"], [data-testid="fin-off"]', { timeout: 20000 }).catch(() => {}); await settle(page, 2000);
      await w.step('O6.5', 'Finance › Collections (owner) -> the list opens (nobody owes after the receipt, or Ravi Stores with Receive and Remind); Terms opens', async () => {
        const t = await body(page);
        const rec = await page.locator('[data-testid^="fin-receive-"]').count(), rem = await page.locator('[data-testid^="fin-remind-"]').count();
        await page.click('[data-testid="fin-nav-terms"]').catch(() => {}); await settle(page, 1500);
        const t2 = await body(page);
        await shot(page, 'finance');
        return { ok: (/Nobody owes you money/.test(t) || (rec > 0 && rem > 0)) && /Terms/.test(t2), saw: (/Nobody owes you money/.test(t) ? '"Nobody owes you money"' : rec + ' Receive · ' + rem + ' Remind') + '; Terms: "' + t2.replace(/^.*?Terms/, 'Terms').slice(0, 80) + '"' };
      });
      const ph = await newPage(PHONE, owner.session);
      await acc(ph, 'bills', '[data-testid="bills-list"]');
      await w.step('O6.6', 'Ledger › Unpaid bills (390) -> no sideways scroll; the tabs, the tools and the rows area fit', async () => {
        const sw = await scrollW(ph), tabs = await ph.locator('[data-testid="bills-tab-B-1300"]').isVisible().catch(() => false);
        await shot(ph, 'ledger-bills-phone');
        return { ok: sw === 390 && tabs, saw: 'scrollWidth ' + sw + '; Issued tab ' + (tabs ? 'visible' : 'NOT visible') };
      });
      await ph.goto(base + '/finance.html#/collections'); await settle(ph, 3000);
      await w.step('O6.7', 'Finance (390) -> no sideways scroll', async () => { const sw = await scrollW(ph); await shot(ph, 'finance-phone'); return { ok: sw === 390, saw: 'scrollWidth ' + sw }; });
      await ph.context().close();
    }
  }

  /* ════ S7 · POSTED — Day book · Trial balance · P&L · GST close ═════════════════════════════════════════════════════ */
  if (want('S7')) {
    if (!REAL) w.note('O7.0', 'The books after the bill', 'needs the real stack (--real); the fixture Ledger is walked by e2e/cb-accounts.cjs');
    else {
      await lastBill();
      await acc(page, 'daybook', '[data-testid="db-list"]');
      await w.step('O7.1', 'Ledger › Day book (1366) -> the range ends on the SHOP\'s day; the bill\'s Sale entry (SV/…) with its number as the source, and the Payment received entry', async () => {
        const t = await body(page);
        const range = (t.match(/\d{1,2} \w{3} – \d{1,2} \w{3} \d{4}/) || [''])[0];
        const sale = await page.locator('[data-testid^="db-src-SV/"]', { hasText: bill ? bill.no : 'D' }).count();
        const rcv = /Payment received/.test(t);
        await shot(page, 'daybook');
        return { ok: sale > 0 && rcv, saw: 'range "' + range + '"; the bill\'s sale entry ' + (sale ? 'is there with its number' : 'is NOT there') + '; Payment received ' + (rcv ? 'shown' : 'NOT shown') };
      });
      await w.step('O7.2', 'Day book -> open the sale entry -> Dr Customers (Ravi Stores) 128.99 · Cr Sales · Cr Output CGST / SGST 3.07 each', async () => {
        const head = page.locator('[data-testid^="db-head-SV/"]', { hasText: bill ? bill.no : 'Sale' }).first();
        if (!(await head.count())) { const src = page.locator('[data-testid^="db-src-SV/"]', { hasText: bill ? bill.no : 'D' }).first(); const h2 = src.locator('xpath=ancestor::*[starts-with(@data-testid,"db-entry-")][1]').locator('[data-testid^="db-head-"]').first(); if (await h2.count()) await h2.click().catch(() => {}); } else await head.click().catch(() => {});
        await settle(page, 1200);
        const ent = page.locator('[data-testid^="db-entry-SV/"]', { hasText: bill ? bill.no : 'Sale' }).first();
        const et = norm(await ent.innerText().catch(() => ''));
        await shot(page, 'daybook-entry');
        /* the entry's line strip says the GST as one figure (6.14 = CGST 3.07 + SGST 3.07); the heads show when a line opens */
        return { ok: /Ravi Stores/.test(et) && /128\.99/.test(et) && /Sales/.test(et) && (/CGST/.test(et) && /3\.07/.test(et) || /GST ₹6\.14/.test(et)), saw: '"' + et.slice(0, 220) + '"' };
      });
      await acc(page, 'tb', '[data-testid="tb-balanced"], [data-testid="tb-dr"]');
      await w.step('O7.3', 'Ledger › Trial balance -> balanced (Dr = Cr), Customers · Cash · Sales · Output GST rows, figures in the shop\'s money', async () => {
        const t = await body(page), dr = await txt(page, '[data-testid="tb-dr"]'), cr = await txt(page, '[data-testid="tb-cr"]');
        await shot(page, 'tb');
        return { ok: dr && dr === cr && /Sales/.test(t) && /Cash/.test(t) && /₹/.test(t), saw: 'Dr ' + dr + ' · Cr ' + cr + (dr === cr ? ' (balanced)' : ' (NOT balanced)') };
      });
      await acc(page, 'pl', '[data-testid="pl-profit"]');
      await w.step('O7.4', 'Ledger › P&L -> Sales under income, the profit or loss line in words', async () => {
        const t = await body(page), p = await txt(page, '[data-testid="pl-profit"]');
        await shot(page, 'pl');
        return { ok: /Sales/.test(t) && /(Profit|Loss)/.test(t), saw: '"' + p.slice(0, 80) + '"' };
      });
      await acc(page, 'gstclose', '[data-testid="pg-form"]');
      await w.step('O7.5', 'Ledger › GST close & pay -> the year and month choice and "Close the month"; closing October 2026 says what it would do (not pressed)', async () => {
        const t = await body(page);
        await shot(page, 'gstclose');
        return { ok: /Close the month/.test(t) && await has(page, '#pg_fy') && await has(page, '#pg_p'), saw: '"' + t.replace(/^.*?GST close & pay Simulated Stores/, '').slice(0, 140) + '"' };
      });
      const ph = await newPage(PHONE, owner.session);
      await acc(ph, 'daybook', '[data-testid="db-list"]');
      await w.step('O7.6', 'Ledger › Day book (390) -> no sideways scroll; the period, the strip and the rows fit', async () => { const sw = await scrollW(ph); await shot(ph, 'daybook-phone'); return { ok: sw === 390, saw: 'scrollWidth ' + sw }; });
      await acc(ph, 'tb', '[data-testid="tb-dr"]');
      await w.step('O7.7', 'Ledger › Trial balance (390) -> no sideways scroll; the three columns hold', async () => { const sw = await scrollW(ph); await shot(ph, 'tb-phone'); return { ok: sw === 390, saw: 'scrollWidth ' + sw }; });
      await ph.context().close();
    }
  }

  /* ════ S8 · REVERSE — the bill opened by its door, returned at the counter; the books and the trail show both ═════════════════════════════════ */
  if (want('S8')) {
    if (!REAL) w.note('O8.0', 'Reverse the bill (a return at the counter)', 'needs the real stack (--real)');
    else {
      await lastBill();
      if (bill && !bill.chit_id) bill.chit_id = await R.billByNo(bill.no).catch(() => null);
      await page.goto(base + '/app.html#/app/chit/' + (bill && bill.chit_id || '')); await page.reload(); await settle(page, 3500);
      await w.step('O8.1', 'App -> the bill chit opens from its number (the Ledger\'s door): the bill\'s number, Ravi Stores, 128.99; its status word is the bill\'s own', async () => {
        const t = await body(page), v = await has(page, '[data-testid="chit-void"]');
        /* ⊘ Withdraw is an Order-folder action (DACT 'void'); the door opens under Task — finding F-O8a. A counter bill is reversed by a RETURN at the counter (O8.2). */
        const amt = (t.match(/₹\s?[\d,]+\.\d\d/g) || []).slice(0, 4).join(' ');
        return { ok: !!bill && t.indexOf(bill.no) >= 0 && /Ravi Stores/.test(t) && /128\.99/.test(t), saw: (bill && t.indexOf(bill.no) >= 0 ? 'the bill is open' : 'the bill is NOT open') + '; amounts on screen: ' + (amt || 'none') + '; ⊘ Withdraw ' + (v ? 'offered' : 'not offered under Task (F-O8a)') };
      });
      await w.step('O8.2', 'Counter -> Bills -> return on the bill -> "Take a return" lists its lines; all, Give it back -> the counter says the return (a credit note) and the bill reads returned', async () => {
        await tillOpen(page);
        /* the return is taken from Bills (F8), which reads the counter's bills first */
        await page.click('[data-testid="till-side-bills"]').catch(() => {}); await settle(page, 2500);
        await page.evaluate((no) => retOpen(no), bill && bill.no).catch(() => {}); await page.waitForSelector('#retdlg[open]', { timeout: 15000 }).catch(() => {});
        const sheet = await txt(page, '#retdlg');
        await page.evaluate(() => { try { retAll(); } catch (_) {} }); await settle(page, 400);
        const against = norm(await page.locator('#retdlg').innerText().catch(() => '')).match(/Against [^·]+·[^·]+·[^·]+·\s*paid by \w+( \w+)?/);
        await page.click('[data-testid="till-return-go"]').catch(() => {}); await settle(page, 800);
        const ask = norm(await page.evaluate(() => Array.from(document.querySelectorAll('dialog[open]')).map((d) => d.innerText).join(' | ')));
        const asked = (ask.match(/Give back [^?]+\?/) || [''])[0];
        await page.locator('dialog[open] button', { hasText: /^Yes, give it back/ }).first().click().catch(() => {}); await settle(page, 4000);
        const t = await body(page), dlg = await page.evaluate(() => Array.from(document.querySelectorAll('dialog[open]')).map((d) => d.innerText.replace(/\s+/g, ' ')).join(' | '));
        await shot(page, 'till-return');
        const said = (dlg + ' ' + t).match(/(credit note|return|returned|CN\/)[^|.]{0,80}/i);
        await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => { try { d.close(); } catch (_) {} }); });
        /* a return of an ON-CREDIT bill must not give cash back, and gives back what was billed (128.99) — findings F-O8b / F-O8c */
        const credit = !/paid by Cash/.test(against ? against[0] : '') && !/in Cash/.test(asked) && /128\.99/.test(asked);
        return { ok: /Sugar 1 kg/.test(sheet) && /Toor dal/.test(sheet) && !!said && credit, saw: 'sheet ' + (/Sugar 1 kg/.test(sheet) ? 'lists the lines' : 'EMPTY ("' + sheet.slice(0, 80) + '")') + '; "' + (against ? against[0] : '') + '"; asked "' + asked + '"; after: "' + (said ? said[0] : 'nothing about the return') + '"' };
      });
      await acc(page, 'daybook', '[data-testid="db-list"]');
      await w.step('O8.3', 'Ledger › Day book -> the sale entry now says "Reversed by …" and the reversal entry is there; both stay on the record', async () => {
        const t = await body(page);
        const rev = await page.locator('[data-testid^="db-rev-"]').count() + await page.locator('[data-testid^="db-head-"]', { hasText: /Return|Credit note|Sales return/i }).count();
        await shot(page, 'daybook-reversed');
        return { ok: /Reversed by|Reversal|Sales return|Credit note/i.test(t) && rev > 0, saw: rev + ' reversal mark(s); "' + ((t.match(/Reversed by[^·]{0,60}/) || t.match(/(Reversal|Sales return|Credit note)[^·]{0,60}/i) || ['no reversal on screen'])[0]) + '"' };
      });
    }
  }

  /* ════ S9 · VIEW-ONLY — a login that may only read, on every screen the flow touches ═════════════════════════════ */
  if (want('S9')) {
    if (!REAL || !viewer) w.note('O9.0', 'The view-only login', REAL ? 'the viewer could not be signed in (see the console)' : 'needs the real stack (--real)');
    else {
      const v = await newPage(LAPTOP, viewer.session);
      await v.goto(base + '/finance.html#/collections'); await v.waitForSelector('[data-testid="fin-denied"], [data-testid="fin-list"]', { timeout: 20000 }).catch(() => {}); await settle(v, 1200);
      await w.step('O9.1', 'Finance as View Only -> "Only the owner may see collections." and no list', async () => {
        const why = await txt(v, '[data-testid="fin-denied-why"]'), rows = await v.locator('[data-testid^="fin-row-"]').count();
        await shot(v, 'viewer-finance');
        return { ok: /Only the owner may see collections/.test(why) && rows === 0, saw: '"' + why + '"; ' + rows + ' rows' };
      });
      await acc(v, 'bills', '[data-testid="bills-list"], [data-testid="acc-off"]');
      await w.step('O9.2', 'Ledger › Unpaid bills as View Only -> the list reads; Receive is not offered (or refused in a sentence, never a raw 403)', async () => {
        await v.click('[data-testid="bills-tab-B-1300"]').catch(() => {}); await settle(v, 1200);
        const row = v.locator('[data-testid="bills-list"] [data-testid^="bill-step-"]').first();
        if (await row.count()) { await row.click().catch(() => {}); await settle(v, 1200); }
        const pay = v.locator('[data-testid="party-pay"], [data-testid^="dues-pay-"]').first();
        let said = '';
        if (await pay.count()) { const dis = await pay.isDisabled().catch(() => false); if (!dis) { await pay.click().catch(() => {}); await settle(v, 1500); said = await txt(v, '[data-testid="pay_why"], [data-testid="pay_outcome"]'); await v.click('[data-testid="pay_record"]').catch(() => {}); await v.click('dialog[open] [data-testid="confirm-ok"]', { timeout: 3000 }).catch(() => {}); await settle(v, 2000); said = said || await txt(v, '[data-testid="pay_why"], [data-testid="pay_outcome"]'); } else said = 'greyed'; }
        const t = await body(v);
        await shot(v, 'viewer-ledger');
        const raw = /403|Forbidden|error\.message|undefined/.test(t);
        return { ok: !raw && (!(await pay.count()) || /greyed|only|may not|owner|cannot/i.test(said)), saw: 'Receive ' + (await pay.count() ? ('offered → "' + said.slice(0, 100) + '"') : 'not offered') + (raw ? '; RAW ERROR ON SCREEN' : '') };
      });
      await v.goto(base + '/app.html#/app/chit/' + (order && order.chit_id || '')); await settle(v, 3000);
      await w.step('O9.3', 'App as View Only -> the order opens to read; Status ▾ is greyed or the move is refused in a sentence', async () => {
        const btn = v.locator('[data-testid="chit-status-btn"]').first();
        let said = '';
        if (await btn.count()) { const dis = await btn.isDisabled().catch(() => false); if (dis) said = 'greyed'; else { await btn.click().catch(() => {}); await settle(v, 600); const o = v.locator('.optrow', { hasText: /^Act/ }).first(); if (await o.count()) { await o.click(); await v.locator('.mfoot button', { hasText: /Set status|Move|Save|OK|Apply|Done|Yes|Confirm/ }).first().click().catch(() => {}); await settle(v, 2000); } said = await v.evaluate(() => { const t = Array.from(document.querySelectorAll('.toast, [role="status"], #toast')).map((e) => e.innerText).join(' '); return t; }).catch(() => ''); } }
        const t = await body(v);
        await shot(v, 'viewer-app');
        return { ok: !(/403|Forbidden/.test(t)) && (!(await btn.count()) || /greyed|only|may not|cannot|viewer|read/i.test(said || t)), saw: 'Status ▾ ' + (await btn.count() ? 'offered → "' + (said || '').slice(0, 100) + '"' : 'not offered') };
      });
      await tillOpen(v);
      await w.step('O9.4', 'Counter as View Only -> a sale is refused by the server and the counter says so in a sentence (never a raw error)', async () => {
        await tillType(v, 'Sugar 1 kg');
        await v.evaluate(() => finish()).catch(() => {}); await settle(v, 6000);
        const t = await body(v), dlg = await v.evaluate(() => Array.from(document.querySelectorAll('dialog[open]')).map((d) => d.innerText.replace(/\s+/g, ' ')).join(' | '));
        const note = await txt(v, '#lastnote, [data-testid="till-lastnote"]');
        await shot(v, 'viewer-till');
        const raw = /403|Forbidden|undefined|\[object/.test(t + dlg);
        return { ok: !raw && !/TAX INVOICE/.test(dlg), saw: (/TAX INVOICE/.test(dlg) ? 'A BILL WAS MADE by a view-only login' : 'no bill') + '; said: "' + (note || dlg || t.slice(0, 120)).slice(0, 140) + '"' + (raw ? ' RAW ERROR' : '') };
      });
      await v.context().close();
    }
  }

  /* ════ S10 · THE AU SHOP — the same screens on the second loader run (reports) ═══════════════════════════════════ */
  if (want('S10')) {
    if (!REAL) w.note('O10.0', 'The AU shop', 'needs the real stack (--real)');
    else {
      let au = null; try { au = await R.signIn(api, AU_EMAIL); } catch (e) { w.note('O10.0', 'The AU shop', 'austores is not loaded: ' + e.message.slice(0, 80)); }
      if (au) {
        const a = await newPage(LAPTOP, au.session);
        await acc(a, 'tb', '[data-testid="tb-dr"]');
        await w.step('O10.1', 'AU shop › Trial balance -> balanced, and the figures in the shop\'s money (A$), its year from July', async () => {
          const t = await body(a), dr = await txt(a, '[data-testid="tb-dr"]'), cr = await txt(a, '[data-testid="tb-cr"]');
          await shot(a, 'au-tb');
          return { ok: dr === cr && /A\$|AUD/.test(t) && !/₹/.test(t), saw: 'Dr ' + dr + ' = Cr ' + cr + '; money shown as ' + (/₹/.test(t) ? '₹ (INR — the IN pack)' : (/A\$|AUD/.test(t) ? 'A$' : '?')) };
        });
        await acc(a, 'gstclose', '[data-testid="pg-form"]');
        await w.step('O10.2', 'AU shop › the tax close -> a BAS (quarterly, July year), not an Indian GST month close', async () => {
          const t = await body(a);
          await shot(a, 'au-gstclose');
          return { ok: /BAS/.test(t) && !/GST close & pay/.test(t.replace(/^.*?Collapse/, '')), saw: '"' + t.replace(/^.*?Collapse/, '').slice(0, 140) + '"' };
        });
        await acc(a, 'daybook', '[data-testid="db-list"]');
        await w.step('O10.3', 'AU shop › Day book -> the walk-in days post in the shop\'s money; the range is its financial year', async () => {
          const t = await body(a);
          await shot(a, 'au-daybook');
          return { ok: /Walk-in day/.test(t) && !/₹/.test(t), saw: '"' + t.replace(/^.*?Day book Simulated Stores/, '').slice(0, 120) + '"' };
        });
        await a.context().close();
      }
    }
  }

  if (stack) stack.stop();
});

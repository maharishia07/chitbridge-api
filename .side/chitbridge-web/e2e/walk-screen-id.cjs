#!/usr/bin/env node
/**
 * e2e/walk-screen-id.cjs — EVERY SMALL APP SHOWS ITS SCREEN CODE, AND A SHEET SHOWS ITS OWN CODE WHEREVER IT IS OPENED (round SCREEN-ID).
 *
 * Athi, 2026-10-14: *"if we are calling the task details from accounts, task screen name should be visible in the task screen. so we know
 * that we are calling the same function."* Black box: it opens every small app and reads the chip in its header (the code of the section on
 * show, following a section change); then it opens the three chit-sheet kinds — Task details, Bill, Supplier bill — from CB Accounts,
 * CB Finance and CB CRM and reads the SAME code in each sheet's title row while the page's own chip keeps the page's code. A tap copies the
 * code. Rule 13 on the chip: AA contrast in light AND dark at 1366 and 390 px, not clipped, not covered, no sideways scroll on the page.
 * A FIXTURE shop: the site is served from this checkout; the API is a stand-in inside the page (nothing reaches localhost:3000 or the live site).
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-screen-id.cjs      headless        --show   headed, a caption per step
 * Screenshots: e2e/shots/walk-screen-id-NN.png.
 */
'use strict';
const TD = require('./lib/today.cjs');
const W = require('./lib/walk.cjs');
const { measure } = require('./lib/theme-measure.cjs');

const SHOP = 'Fixture Shop', TODAY = TD.TODAY;
const me = { role: 'sender', display_name: SHOP, entity_id: 'ent-walk' };
const line = { particulars: 'Rice 5kg', quantity: 1, unit: 'piece', price: 100, total: 100 };
const CHITS = {
  tk1: { header: { chit_id: 'tk1', purpose: 'general', current_status: 'accepted', manual_subject: 'Fix the shutter', created_at: TODAY + 'T04:00:00.000Z',
    all_recipients: [me, { role: 'receiver', display_name: 'Ravi Repairs', entity_id: 'ent-ravi' }], summary_json: { currency_code: 'INR', total_value: 100 }, business_json: {} },
    detail: { line_items: [line] }, state_log: [], actions: {} },
  ch1: { header: { chit_id: 'ch1', purpose: 'order', current_status: 'completed', manual_subject: 'Counter sale', created_at: TODAY + 'T05:10:00.000Z',
    all_recipients: [me, { role: 'receiver', display_name: 'self' }], summary_json: { currency_code: 'INR', total_value: 100 },
    business_json: { bill_no: 'C2/26-27/0002', till: { id: 't2', name: 'Counter 2' } } },
    detail: { line_items: [line] }, state_log: [], actions: {} },
  sb1: { doc: 'bill_received', header: { chit_id: 'sb1', purpose: 'invoice', current_status: 'delivered', manual_subject: 'Bill 77', created_at: TODAY + 'T06:00:00.000Z',
    all_recipients: [{ role: 'sender', display_name: 'Sri Ganesh Provisions', entity_id: 'ent-sg' }, { role: 'receiver', display_name: SHOP, entity_id: 'ent-walk' }],
    summary_json: { currency_code: 'INR', total_value: 100 }, business_json: { bill_no: '77' } },
    detail: { line_items: [line] }, state_log: [], actions: {} },
};
/* each small app, where it opens, and the code its chip must show (the register: public/app/screen-id.js) */
const APPS = [
  ['/', 'HOM001', 'Home'], ['/accounts.html', 'BKS001', 'Accounts › To do'], ['/finance.html', 'FIN001', 'Finance › Collections'],
  ['/crm.html', 'CRM001', 'CRM › Parties'], ['/tasks.html', 'TSK001', 'Tasks & Orders › Orders in'], ['/settings.html#/shop', 'SET001', 'Settings › Your shop'],
  ['/employees.html', 'EMP001', 'Employees › People'], ['/network.html', 'NET001', 'Network › My network'], ['/country-lab.html', 'CLB003', 'Country lab › Countries'],
  ['/know-your-business.html', 'KYB001', 'Know your business'], ['/authority-forms.html', 'DOC001', 'Documents'],
  /* SHELL-ONE: every page wears the frame, so every page shows its code — the standards page, the storefront, the shop screen, the labs */
  ['/standards.html', 'STD001', 'Standards'], ['/shop.html?s=CBWALK0001', 'SHP001', 'Shop'], ['/network-shop.html?bridge=CBWALK0001', 'NSH001', 'Network shop'], ['/store.html?net=CBWALK0001', 'STR001', 'Store'],
  ['/embed.html?bridge=CBWALK0001', 'EMB001', 'Catalogue embed'], ['/promo.html', 'PRM001', 'Shop screen'], ['/product-lab.html', 'PLB001', 'Product Lab'], ['/offer-lab-next.html', 'OLB001', 'Offer Lab'],
  ['/offer-lab-next.html?mode=combo', 'OLB002', 'Combo Lab'], ['/conversion-lab.html', 'CVL001', 'Conversion lab'], ['/network-design.html', 'NLB001', 'Network Lab'],
];
const SHEETS = [['tk1', 'TSK005', 'Task details'], ['ch1', 'BIL001', 'Bill'], ['sb1', 'BIL002', 'Supplier bill']];

const walk = async (w) => {
  const { page, ctx, base } = w;
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await ctx.route('**/api/**', async (r) => {
    const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
    const J = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    let mm = /^\/api\/chits\/([^/]+)\/messages$/.exec(p);
    if (mm && m === 'GET') return J(200, { messages: [], count: 0 });
    mm = /^\/api\/chits\/([^/]+)$/.exec(p);
    if (mm && m === 'GET') return CHITS[mm[1]] ? J(200, CHITS[mm[1]]) : J(404, { error: { code: 'CHIT_NOT_FOUND', message: 'no such chit' } });
    if (p === '/api/entities/me') return J(200, { entity: { display_name: SHOP, currency_code: 'INR' } });
    if (p === '/api/notifications') return J(200, { notifications: [], unseen: 0 });
    return J(404, { error: { message: 'not in this stand-in' } });
  });
  await ctx.addInitScript((s) => { try { if (!sessionStorage.getItem('cb_noids')) localStorage.setItem('cb_ids', '1'); localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', SHOP));

  const chipCode = () => page.evaluate(() => { const c = document.querySelector('[data-testid="screen-id"]'); return c ? c.getAttribute('data-cbsid') : null; });
  const chipText = () => page.evaluate(() => { const c = document.querySelector('[data-testid="screen-id"]'); return c ? c.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const open = async (url) => {
    await page.goto(base + url);
    await page.waitForFunction(() => { const c = document.querySelector('[data-testid="screen-id"][data-cbsid]'); return c && c.getBoundingClientRect().width > 0; }, null, { timeout: 20000 });
    await page.waitForTimeout(300);
  };

  /* ── 1 · every small app: the chip, in its header, with the code of the screen on show ── */
  for (const [url, code, name] of APPS) {
    await w.step('A-' + code, name + ' (' + url + ') -> the header chip reads "' + code + '"', async () => {
      await open(url);
      const c = await chipCode(), t = await chipText(), inHeader = await page.evaluate(() => !!document.querySelector('[data-testid="screen-id"]').closest('header,.cbsh-hdr,.who'));
      return { ok: c === code && t.indexOf(code) >= 0 && inHeader, saw: '"' + t + '" · in the header ' + inHeader };
    });
  }

  /* ── 2 · a section change: the chip follows the section, never the page it started on ── */
  await w.step('S1', 'Finance: tap Cash in the sidebar -> the chip reads FIN003', async () => {
    await open('/finance.html'); await page.click('[data-testid="fin-nav-cash"]'); await page.waitForTimeout(400);
    const c = await chipCode(); return { ok: c === 'FIN003', saw: c };
  });
  await w.step('S2', 'Settings: open Country -> the chip reads SET002', async () => {
    await open('/settings.html#/shop'); await page.click('[data-testid="skel-nav-country"]'); await page.waitForTimeout(400);
    const c = await chipCode(); return { ok: c === 'SET002', saw: c };
  });
  await w.step('S3', 'Accounts: open Ledgers by its address -> the chip reads BKS003', async () => {
    await open('/accounts.html#ledgers'); const c = await chipCode(); return { ok: c === 'BKS003', saw: c };
  });
  await w.step('S4', 'Tasks & Orders: tap Done -> the chip reads TSK004', async () => {
    await open('/tasks.html'); await page.click('[data-testid="skel-nav-done"]'); await page.waitForTimeout(400);
    const c = await chipCode(); return { ok: c === 'TSK004', saw: c };
  });

  /* ── UX-1 · a shop never sees the codes; the tester switch (?ids=1) brings them back and keeps them ── */
  await w.step('H1', 'Accounts without the tester switch -> the chip is in the page but not drawn; ?ids=1 draws it; ?ids=0 hides it again', async () => {
    await page.goto(base + '/'); await page.evaluate(() => { sessionStorage.setItem('cb_noids', '1'); localStorage.removeItem('cb_ids'); });
    const seen = async (query) => {
      await page.goto(base + '/accounts.html' + query + '#ledgers');
      await page.waitForSelector('[data-testid="screen-id"][data-cbsid]', { state: 'attached', timeout: 20000 });
      await page.waitForTimeout(300);
      return page.evaluate(() => { const c = document.querySelector('[data-testid="screen-id"]'); return !!c && c.getBoundingClientRect().width > 0; });
    };
    const shop = await seen(''), tester = await seen('?ids=1'), stays = await seen(''), off = await seen('?ids=0');
    await page.evaluate(() => { sessionStorage.removeItem('cb_noids'); localStorage.setItem('cb_ids', '1'); });
    return { ok: !shop && tester && stays && !off, saw: 'shop ' + shop + ' · ?ids=1 ' + tester + ' · next visit ' + stays + ' · ?ids=0 ' + off };
  });

  /* ── 3 · the sheets: the SAME code from three pages; the page's own chip keeps the page's code ── */
  const sheetFrom = async (url, id) => {
    await open(url);
    const pageCode = await chipCode();
    await page.evaluate((i) => openChitSheet(i), id);
    await page.waitForSelector('#chitsheet[open] [data-testid="screen-id-sheet"]', { timeout: 10000 });
    const r = await page.evaluate(() => { const b = document.querySelector('#chitsheet[open] [data-testid="screen-id-sheet"]'); return { code: b.getAttribute('data-cbsid'), text: b.innerText.replace(/\s+/g, ' ').trim(), inTop: !!b.closest('.cs-top') }; });
    r.pageCode = pageCode; r.pageAfter = await chipCode();
    return r;
  };
  for (const [id, code, name] of SHEETS) {
    const seen = [];
    for (const url of ['/accounts.html', '/finance.html', '/crm.html']) {
      await w.step('K-' + code + url.replace(/\W+/g, '-'), name + ' opened from ' + url + ' -> its title row reads ' + code + ' (the page keeps its own)', async () => {
        const r = await sheetFrom(url, id); seen.push(r.code);
        return { ok: r.code === code && r.inTop && r.text.indexOf(code) >= 0 && r.pageAfter === r.pageCode && r.pageCode !== code, saw: '"' + r.text + '" · page chip ' + r.pageCode };
      });
      await page.evaluate(() => CBSheet.close());
    }
    await w.step('K-' + code + '-same', name + ': one screen, one code from every page that opens it', async () => ({ ok: seen.length === 3 && seen.every((c) => c === code), saw: seen.join(' · ') }));
  }

  /* ── 4 · a tap copies the code (for a bug report), on the page chip and on a sheet chip ── */
  await w.step('C1', 'Tap the header chip on CRM -> the clipboard holds CRM001 and the chip says Copied', async () => {
    await open('/crm.html'); await page.click('[data-testid="screen-id"]');
    await page.waitForSelector('[data-testid="screen-id"][data-copied="1"]', { timeout: 3000 }).catch(() => {});   /* the clipboard answers asynchronously */
    const said = await chipText(), clip = await page.evaluate(() => navigator.clipboard.readText());
    return { ok: clip === 'CRM001' && /Copied/.test(said), saw: 'clipboard "' + clip + '" · chip "' + said + '"' };
  });
  await w.step('C2', 'Tap the Task details chip -> the clipboard holds TSK005', async () => {
    await page.evaluate(() => openChitSheet('tk1')); await page.waitForSelector('#chitsheet[open] [data-testid="screen-id-sheet"]');
    await page.click('#chitsheet[open] [data-testid="screen-id-sheet"]');
    const clip = await page.evaluate(() => navigator.clipboard.readText()), open1 = await page.evaluate(() => document.getElementById('chitsheet').open);
    await page.evaluate(() => CBSheet.close());
    return { ok: clip === 'TSK005' && open1, saw: 'clipboard "' + clip + '" · the sheet stays open ' + open1 };
  });

  /* ── 5 · rule 13 on the chip: AA in light and dark at 1366 and 390, never clipped, never covered, no sideways scroll ── */
  const chipAudit = (sel) => page.evaluate((sel) => {
    const c = document.querySelector(sel); if (!c) return { missing: true };
    const r = c.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { w: r.width, inView: r.left >= 0 && r.right <= window.innerWidth + 0.5, clipped: c.scrollWidth > c.clientWidth + 1, covered: !(hit && (hit === c || c.contains(hit))),
      sw: document.documentElement.scrollWidth, iw: window.innerWidth, text: c.innerText.replace(/\s+/g, ' ').trim() };
  }, sel);
  const chipContrast = async (sel) => {
    const pairs = await page.evaluate(measure), texts = await page.evaluate((sel) => Array.from(document.querySelectorAll(sel + ' *')).map((e) => (e.textContent || '').trim()).filter(Boolean), sel);
    return pairs.filter((x) => texts.indexOf(String(x.text).trim()) >= 0);
  };
  const r13 = async (id, label, url, sel, sheet) => {
    for (const theme of ['cream', 'dark']) for (const width of [1366, 390]) {
      await w.step(id + '·' + theme + '·' + width, label + ' · ' + theme + ' · ' + width + ' px -> AA, not clipped, not covered, no sideways scroll', async () => {
        await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
        await open(url);
        await page.evaluate((t) => CBAvatar.applyTheme(t), theme); await page.waitForTimeout(200);
        if (sheet) { await page.evaluate(() => openChitSheet('tk1')); await page.waitForSelector('#chitsheet[open] [data-testid="screen-id-sheet"]'); await page.waitForTimeout(200); }
        const a = await chipAudit(sel), pairs = await chipContrast(sel), low = pairs.filter((x) => !x.grad && x.ratio < x.need);
        if (sheet) await page.evaluate(() => CBSheet.close());
        const ok = !a.missing && a.inView && !a.clipped && !a.covered && a.sw <= a.iw + 1 && pairs.length > 0 && !low.length && (width > 700 || /^[A-Z]{3}\d{3}$/.test(a.text));
        return { ok, saw: '"' + a.text + '" · ' + pairs.length + ' texts, lowest ' + (pairs.length ? Math.min.apply(null, pairs.map((x) => x.ratio)) : '-') + ':1 · clipped ' + a.clipped + ' · covered ' + a.covered + ' · page ' + a.sw + '/' + a.iw };
      });
    }
    await page.evaluate(() => CBAvatar.applyTheme('cream')).catch(() => {});
    await page.setViewportSize({ width: 1366, height: 900 });
  };
  await r13('R13-own', 'Accounts (its own header): the chip', '/accounts.html', '[data-testid="screen-id"]');
  await r13('R13-frame', 'Tasks & Orders (the CBShell bar): the chip', '/tasks.html', '[data-testid="screen-id"]');
  await r13('R13-sheet', 'Task details over Finance: the sheet chip', '/finance.html', '#chitsheet[open] [data-testid="screen-id-sheet"]', true);

  await w.step('X1', 'No link to the workshop on the chips (no app.html)', async () => {
    await open('/crm.html');
    const n = await page.evaluate(() => Array.from(document.querySelectorAll('.cbsid')).filter((c) => /app\.html/.test(c.outerHTML)).length);
    return { ok: n === 0, saw: n + ' chip(s) naming app.html' };
  });
};
walk.opts = { viewport: { width: 1366, height: 900 } };
W.run('screen-id', walk);

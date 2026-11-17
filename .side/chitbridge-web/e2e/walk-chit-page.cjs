#!/usr/bin/env node
/**
 * e2e/walk-chit-page.cjs - THE CHIT PAGE IN CB CRM, WALKED (round CRM2: crm.html#/chit/<id> = the chit sheet mounted full-page, app/chit-sheet.js CBSheet.mount).
 * Black box: it opens the page as the sheet's "Open page" does, and reads what the screen says - the bill as frozen (lines · GST · total equal
 * CBTax.moneyOf(invoice) to the paisa), the history, messages and files, the action row (Print, never "Open page" on the page itself), and rule 13:
 * AA contrast in light AND dark at 1366 and 390 px (e2e/lib/theme-measure.cjs), no clipped text, no inner sideways scroll, no fixed control over
 * the content, no link to app.html, every string within the text budget.
 * A FIXTURE shop: the site is served from this checkout, the API is a stand-in answering inside the page; nothing reaches localhost:3000 or the live site.
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-chit-page.cjs      headless, fast        node e2e/walk-chit-page.cjs --show   headed, a caption per step
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-chit-page-NN.png.
 */
'use strict';
const TD = require('./lib/today.cjs');
const fs = require('fs'), path = require('path'), vm = require('vm');
const W = require('./lib/walk.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const ROOT = path.join(__dirname, '..', 'public');
const C = require('./lib/contract.cjs');   /* M43: every /api/books · /api/crm answer this stand-in serves is held to the API contract (INT4) */
const J = (r, status, body) => C.json(r, status, body);
const crmApi = require('./lib/crm-api.cjs');   /* RAIL-LAB-SRV1: the rail card (GET /api/facts/rail) from its one builder */
const SHOP = 'Fixture Shop', TODAY = TD.TODAY;

/* the frozen invoice the counter determined - the one money engine, run once here, so the page's figures have a reference to the paisa */
const eng = {}; eng.window = eng; eng.self = eng; vm.createContext(eng);
for (const f of ['engine/money.js', 'engine/tax.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), eng);
const LINES = [{ name: 'Rice 5kg', unit: 'piece', qty: 2, unit_price: 97.16, discount: 10, gst_rate: 12 }, { name: 'Soap', unit: 'piece', qty: 3, unit_price: 98.7, discount: 0, gst_rate: 18 },
  { name: 'Oil 1L', unit: 'piece', qty: 1, unit_price: 89.48, discount: 5.25, gst_rate: 12 }, { name: 'Tea', unit: 'piece', qty: 2, unit_price: 54.8, discount: 0, gst_rate: 18 }];
const INV = eng.CBTax.determine({ seller: { Gstin: '33AAAAA0000A1Z5', State: '33', Country: 'IN', LglNm: SHOP }, buyer: { LglNm: 'Walk-in', State: '', Pos: '33', Country: 'IN' }, lines: LINES, priceIncludesTax: true });
const EXP = eng.CBTax.moneyOf(INV, 'INR');
const f2 = (n) => Number(n).toFixed(2);
const digits = (s) => String(s || '').replace(/[^0-9.]/g, '');

const me = { role: 'sender', display_name: SHOP, entity_id: 'ent-walk' };
const CHITS = {
  ch1: { header: { chit_id: 'ch1', purpose: 'order', current_status: 'completed', manual_subject: 'Counter sale C2/26-27/0002', created_at: TODAY + 'T05:10:00.000Z',
    all_recipients: [me, { role: 'receiver', display_name: 'self' }], summary_json: { currency_code: 'INR', money: { total: 1, tax: 1 } },
    business_json: { bill_no: 'C2/26-27/0002', billed_at: TODAY + 'T05:10:00.000Z', till: { id: 't2', name: 'Counter 2', by: { name: 'Asha Kumar' } }, customer: { name: 'Walk-in' },
      payment: { mode: 'cash+upi', paid: EXP.total, change: 25.74, parts: [{ how: 'cash', amount: 500 }, { how: 'upi', amount: Math.round((EXP.total - 500) * 100) / 100 }] }, invoice: INV } },
    detail: { line_items: LINES.map((l) => ({ particulars: l.name, quantity: l.qty, unit: l.unit, price: l.unit_price, total: Math.round(l.qty * l.unit_price * 100) / 100, gst_rate: l.gst_rate, offer: l.discount ? { off: l.discount, label: 'Festival offer' } : undefined })) },
    state_log: [{ action: 'created', new_status: 'delivered', action_by_display_name: 'Asha Kumar', created_at: TODAY + 'T05:10:00.000Z' },
      { action: 'status_completed', new_status: 'completed', action_by_display_name: 'Asha Kumar', created_at: TODAY + 'T05:11:00.000Z' }],
    actions: { message: { ok: true }, attach: { ok: true } } },
  tk1: { header: { chit_id: 'tk1', purpose: 'general', current_status: 'accepted', manual_subject: 'Fix the shutter', created_at: TODAY + 'T04:00:00.000Z',
    all_recipients: [me, { role: 'receiver', display_name: 'Ravi Repairs', entity_id: 'ent-ravi' }], summary_json: { currency_code: 'INR', total_value: 1200 },
    business_json: { page: 'service.repair.job@2.0' } },
    detail: { line_items: [{ particulars: 'Shutter repair', quantity: 1, unit: 'piece', price: 1200, total: 1200 }] },
    state_log: [{ action: 'created', new_status: 'delivered', action_by_display_name: SHOP, created_at: TODAY + 'T04:00:00.000Z' },
      { action: 'status_accepted', new_status: 'accepted', action_by_display_name: 'Ravi Repairs', created_at: TODAY + 'T04:30:00.000Z' }],
    actions: { message: { ok: true }, attach: { ok: true } } },
};

const walk = async (w) => {
  const { page, ctx, base } = w;
  const S = { calls: [] };
  await ctx.route('**/api/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), m = q.method(), p = u.pathname;
    if (m !== 'GET' && /^\/api\/chits\//.test(p)) S.calls.push(m + ' ' + p);   /* a write to the CHIT (status · use · a message); the bell's own stream ticket is not one */
    if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: SHOP, currency_code: 'INR' } });
    if (p === '/api/facts/rail') return J(r, 200, crmApi.railFacts({ suppliers: 0, customers: 0, in: 0, out: 0, stuck: 0 }));
    if (p === '/api/facts/rail/chits') return J(r, 200, { chits: [{ chit_id: 'ch1', tab: 'out', subject: 'Counter sale C2/26-27/0002', who: 'Walk-in', age_days: 0, status: 'completed', stuck: false, purpose: 'order', total_value: EXP.total, currency_code: 'INR' }] });
    if (p === '/api/books/health') return J(r, 404, { error: { message: 'off' } });
    if (p === '/api/crm/parties') return J(r, 200, { parties: [], alerts: {} });
    if (p === '/api/notifications') return J(r, 200, { notifications: [], unseen: 0 });
    let mm = /^\/api\/chits\/([^/]+)\/messages$/.exec(p);
    if (mm && m === 'GET') return J(r, 200, { messages: [], count: 0 });
    mm = /^\/api\/chits\/([^/]+)$/.exec(p);
    if (mm && m === 'GET') return CHITS[mm[1]] ? J(r, 200, CHITS[mm[1]]) : J(r, 404, { error: { code: 'CHIT_NOT_FOUND', message: 'no such chit' } });
    return J(r, 404, { error: 'not found' });
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', SHOP));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const openPage = async (id) => { await page.goto(base + '/crm.html#/chit/' + id); await page.waitForSelector('[data-testid="cs-page"] [data-testid="cs-no"], [data-testid="cs-page"] [data-testid="cs-err"]', { timeout: 20000 }); await page.waitForTimeout(400); };
  const count = (sel) => page.locator(sel).count();
  /* rule 13, measured: every visible text at ≥ 4.5:1 (3:1 large) against what is painted behind it; a gradient ground is flagged, not judged */
  const contrastFails = async () => (await page.evaluate(measure)).filter((x) => !x.grad && x.ratio < x.need);
  const say = (bad) => bad.slice(0, 3).map((x) => x.cat + ' "' + x.text + '" ' + x.ratio + ':1').join(' | ');
  const fit = () => page.evaluate(() => {
    const host = document.getElementById('chit_page'); const out = { sw: document.documentElement.scrollWidth, iw: window.innerWidth, inner: [], clipped: [], covered: [] };
    if (!host) return out;
    const hr = host.getBoundingClientRect();
    host.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el); if (cs.display === 'none') return;
      if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(cs.overflowX)) out.inner.push(el.className || el.tagName);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.clipped.push((el.textContent || '').trim().slice(0, 30));
    });
    document.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el); if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
      if (r.left < hr.right && r.right > hr.left && r.top < hr.bottom && r.bottom > hr.top && (el.textContent || '').trim()) out.covered.push(el.id || el.className || el.tagName);
    });
    return out;
  });

  await openPage('ch1');
  await w.step('C1', 'Open page -> crm.html#/chit/ch1: the bill as frozen - number, 4 lines, GST 12% and 18%, the total to the paisa', async () => {
    const no = await txt('[data-testid="cs-no"]'), tot = digits(await txt('[data-testid="cs-total"]')), lines = await count('[data-testid^="cs-line-"]');
    const g12 = await count('[data-testid="cs-gst-12"]'), g18 = await count('[data-testid="cs-gst-18"]'), ttl = await txt('[data-testid="cs-title"]');
    return { ok: no === 'C2/26-27/0002' && lines === 4 && g12 === 1 && g18 === 1 && tot === f2(EXP.total) && ttl === 'Bill', saw: ttl + ' ' + no + ' · ' + lines + ' lines · total ' + tot + ' (engine ' + f2(EXP.total) + ')' };
  });
  await w.step('C2', 'The action row is the sheet\'s for this step (Print · Return) - no "Open page" on the page itself; the crumb leads back to Chits', async () => {
    const pg = await count('[data-testid="cs-act-page"]'), pr = await count('[data-testid="cs-act-print"]'), back = await page.getAttribute('[data-testid="chit-page-back"]', 'href');
    return { ok: pg === 0 && pr === 1 && back === '#/chits', saw: 'page icons ' + pg + ' · print ' + pr + ' · back ' + back };
  });
  await w.step('C3', 'History: the chit\'s log as held - Created, then Done, each with who', async () => {
    const h0 = await txt('[data-testid="cs-hist-0"]'), h1 = await txt('[data-testid="cs-hist-1"]');
    return { ok: /Created/.test(h0) && /Asha Kumar/.test(h0) && /Done/.test(h1), saw: h0 + ' / ' + h1 };
  });
  await w.step('C4', 'Messages and files are on the page (the rail units), and nothing was written by opening it', async () => {
    const rail = await count('[data-testid="cs-rail-thread"]'), att = await count('[data-testid="cs-rail-attach"]');
    return { ok: rail === 1 && att === 1 && S.calls.length === 0, saw: 'thread ' + rail + ' · attach ' + att + ' · writes ' + S.calls.length };
  });
  await w.step('C5', 'No door to the workshop: no link on the page names app.html', async () => {
    const n = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).filter((a) => /app\.html/.test(a.getAttribute('href'))).length);
    const t = await page.evaluate(() => /app\.html/.test(document.body.innerText));
    return { ok: n === 0 && !t, saw: n + ' links · in text: ' + t };
  });
  await w.step('C6', 'Text budget: every string on the page is 20 words or fewer, the title 5 or fewer', async () => {
    const r = await page.evaluate(() => { const host = document.getElementById('chit_page'); const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT); const long = []; let max = 0;
      for (let t; (t = walker.nextNode());) { const s = t.nodeValue.replace(/\s+/g, ' ').trim(); if (!s) continue; const n = s.split(' ').length; max = Math.max(max, n); if (n > 20) long.push(s.slice(0, 40)); }
      const ttl = (host.querySelector('[data-testid="cs-title"]') || {}).textContent || ''; return { max, long, ttlWords: ttl.trim().split(/\s+/).length }; });
    return { ok: r.long.length === 0 && r.ttlWords <= 5, saw: 'longest ' + r.max + ' words · title ' + r.ttlWords + (r.long.length ? ' · over: ' + r.long.join(' / ') : '') };
  });
  await w.step('C7', 'Light theme at 1366 px: every text reads at AA (measured)', async () => {
    const bad = await contrastFails(); return { ok: bad.length === 0, saw: bad.length ? bad.length + ' under: ' + say(bad) : 'all pairs pass' };
  });
  await w.step('C8', 'Dark theme at 1366 px: every text reads at AA (measured)', async () => {
    await page.evaluate(() => CBAvatar.applyTheme('dark')); await page.waitForTimeout(300);
    const bad = await contrastFails(); return { ok: bad.length === 0, saw: bad.length ? bad.length + ' under: ' + say(bad) : 'all pairs pass' };
  });
  await w.step('C9', 'A phone (390 px), dark: no sideways scroll, no inner horizontal scroll, no clipped text, no fixed control over the bill', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
    const r = await fit();
    return { ok: r.sw === 390 && r.inner.length === 0 && r.clipped.length === 0 && r.covered.length === 0, saw: 'scrollWidth ' + r.sw + ' · inner ' + r.inner.join(',') + ' · clipped ' + r.clipped.join(',') + ' · covered ' + r.covered.join(',') };
  });
  await w.step('C10', 'A phone (390 px), dark: every text reads at AA (measured)', async () => {
    const bad = await contrastFails(); return { ok: bad.length === 0, saw: bad.length ? bad.length + ' under: ' + say(bad) : 'all pairs pass' };
  });
  await w.step('C11', 'A phone (390 px), light: fits, and every text reads at AA (measured)', async () => {
    await page.evaluate(() => CBAvatar.applyTheme('cream')); await page.waitForTimeout(300);
    const r = await fit(), bad = await contrastFails();
    return { ok: r.sw === 390 && r.inner.length === 0 && r.clipped.length === 0 && bad.length === 0, saw: 'scrollWidth ' + r.sw + (bad.length ? ' · ' + bad.length + ' under: ' + say(bad) : ' · all pairs pass') };
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await w.step('C12', 'A task made with a page this install lacks: the note "made with service.repair.job@2.0 - page not installed", the task still opens', async () => {
    await openPage('tk1');
    const note = await txt('[data-testid="page-note"]'), ttl = await txt('[data-testid="cs-title"]'), step = await txt('[data-testid="cs-step"]');
    return { ok: /service\.repair\.job@2\.0/.test(note) && ttl === 'Task' && step === 'Accepted', saw: ttl + ' · ' + step + ' · ' + note };
  });
  await w.step('C13', 'A chit that cannot be read: plain words, never the server\'s message', async () => {
    await openPage('nope');
    const e = await txt('[data-testid="cs-err"]');
    return { ok: e.length > 0 && !/no such chit|CHIT_NOT_FOUND|\{/.test(e), saw: e };
  });
  await w.step('C14', 'From Chits, a row\'s sheet still offers "Open page", and it lands on this page in the same tab (Back returns)', async () => {
    await page.goto(base + '/crm.html#/chits'); await page.waitForSelector('[data-testid="chits-list"]', { timeout: 20000 }); await page.waitForTimeout(600);
    await page.evaluate(() => openChitSheet('ch1')); await page.waitForSelector('#chitsheet[open] [data-testid="cs-act-page"]', { timeout: 10000 });
    const popupPrint = await count('#chitsheet[open] [data-testid="cs-act-print"]');
    await page.click('#chitsheet[open] [data-testid="cs-act-page"]'); await page.waitForSelector('[data-testid="cs-page"] [data-testid="cs-no"]', { timeout: 10000 }); await page.waitForTimeout(300);
    const hash = await page.evaluate(() => location.hash), dlgOpen = await count('#chitsheet[open]'), hist = await count('[data-testid="cs-hist-0"]');
    await page.goBack(); await page.waitForTimeout(500); const back = await page.evaluate(() => location.hash);
    return { ok: hash === '#/chit/ch1' && dlgOpen === 0 && hist === 1 && popupPrint === 1 && back === '#/chits', saw: 'landed ' + hash + ' · popup closed ' + (dlgOpen === 0) + ' · back ' + back };
  });
  await w.step('C15', 'The three ledger pages\' "Open page" and the registry point at CRM, none at the workshop (static)', async () => {
    const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    const pages = ['accounts.html', 'finance.html', 'crm.html'].map((f) => { const s = rd(f); return f + ':' + (/function openChitPage\([^)]*\)\s*\{[^}]*chitPageHref/.test(s) && !/openChitPage[^\n]*app\.html/.test(s)); });
    const reg = JSON.parse(rd('app/pages.json')), baseRow = reg.pages.find((r) => r.name + '@' + r.version === reg.base);
    const shell = /chit: '\/crm\.html#\/chit\/'/.test(rd('app/accounts-shell.js'));
    return { ok: pages.every((x) => /true$/.test(x)) && baseRow.script === 'crm.html' && shell, saw: pages.join(' ') + ' · base script ' + baseRow.script + ' · CB_HOMES.chit ' + shell };
  });
  await w.step('M43', 'the stand-in answered every /api/books and /api/crm call as the API contract says', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });
};
walk.opts = { viewport: { width: 1366, height: 900 } };
W.run('chit-page', walk);

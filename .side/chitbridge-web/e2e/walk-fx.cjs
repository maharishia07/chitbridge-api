#!/usr/bin/env node
/**
 * e2e/walk-fx.cjs - FOREIGN CURRENCY, WALKED (FX1, 2026-10-14): CB Accounts › Setup › Rates, Receivables / Payables in two currencies, Month lock's revaluation.
 * Black box over the REAL books: the page's /api/books/** is answered by chitbridge-api's own routes/books.js running in this process over the in-memory
 * books (api tests/support/books-harness.cjs + the sibling engines ≥ v1.45.0). Nothing touches a database. Every rates / revaluation answer is held to the
 * API contract (C.json). Two shops: an Indian one exporting to a USD customer, an Australian one importing from a USD supplier.
 *   F1  Setup › Rates, none yet -> the empty line, "Add rate" (the server says the owner may), the pack's tax-rate rule (CGST r.34)
 *   F2  Add rate: USD 83.25 for 14 Oct -> ONE add call; the row "1 USD = 83.25 INR · Typed"
 *   F3  Import CSV -> the good rows in (source Official / Imported, the file as reference), the bad line named
 *   F4  a USD export bill posts at 14 Oct's rate -> Receivables shows both: ₹83,250.00 · US$1,000.00
 *   F5  Month lock: October's foreign balances at the 31 Oct closing rate -> the gain, Revalue -> two entries (31 Oct, back on 1 Nov)
 *   F6  AU: a USD import bill at 1.50 -> Payables shows A$1,500.00 · US$1,000.00
 *   F7  rule 13, Cream and Dark at 1366 and 390: AA contrast, no sideways scroll, nothing clipped, nothing over the bar, no app.html link, copy in budget
 *   F8  every rates / revaluation answer had the API's keys, nesting and types (the contract)
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-fx.cjs        (needs ../chitbridge-api with its node_modules; ../chitbridge-engines ≥ v1.45.0 if beside, else the api's adopted lib/ copies)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const API = process.env.CB_API_DIR || path.join(__dirname, '..', '..', 'chitbridge-api');

/* the doors the page calls (e2e/contract.cjs reads these literals to know this harness answers them) */
const DOORS = { list: '/api/books/fx-rates', add: '/api/books/fx-rates', imp: '/api/books/fx-rates/import', reval: '/api/books/fx-revalue', revalPost: '/api/books/fx-revalue' };
const HELD = ['GET /api/books/fx-rates', 'POST /api/books/fx-rates', 'GET /api/books/fx-revalue', 'POST /api/books/fx-revalue'];

const IN_SHOP = '11111111-1111-4111-8111-111111111111', AU_SHOP = 'aaaaaaaa-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222', SUPP = '33333333-3333-4333-8333-333333333333';
const WHO = { identity_id: IN_SHOP, identity_type: 'entity', display_name: 'Mayur Exports' };
async function realBooks() {
  const H = require(path.join(API, 'tests', 'support', 'books-harness.cjs'));
  const auth = Object.assign((req, res, next) => { req.identity = Object.assign({}, WHO); next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
  if (!process.env.BOOKS_ENGINES_SRC && !H.enginesSrc().dir) process.env.BOOKS_ENGINES_SRC = path.join(API, 'lib');
  const X = H.load({ auth });
  if (!X.src.dir) throw new Error('the books engines are not beside this checkout: ' + X.src.why);
  if (typeof X.E.posting().fxRevaluation !== 'function') throw new Error('the books engines are older than v1.45.0 (no fxRevaluation) — adopt v1.45.0');
  const express = require(path.join(API, 'node_modules', 'express'));
  const app = express(); app.use(express.json({ limit: '8mb' })); app.use('/api/books', require(path.join(API, 'routes', 'books')));
  const srv = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  /* ONE "today" for the walk (the area pack's pitfall): 5 Nov 2026 — October is over */
  const K = require(path.join(API, 'lib', 'books-hooks')), realDay = K.dayOf, DAY = '2026-11-05';
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));   /* clock-ok: matches the posting instant of this very call, the walk's own DAY is fixed */
  require(path.join(API, 'lib', 'shop-clock')).set(DAY + 'T06:00:00Z');
  const call = (m, p, b) => fetch('http://127.0.0.1:' + srv.address().port + '/api/books' + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  await X.store.saveSetting(X.db, IN_SHOP, { enabled: false }); await call('POST', '/enable', {});
  X.T.parties.push({ owner: IN_SHOP, party_id: CUST, party_no: 'P-00001', name: 'Acme Inc', customer: true, credit_days: 30 });
  /* April to September are locked, so October is the month Month lock asks about next */
  for (let p = 1; p <= 6; p++) await call('POST', '/periods/2026-27/' + p + '/lock', { reason: 'walk' });
  WHO.identity_id = AU_SHOP;
  await X.store.saveSetting(X.db, AU_SHOP, { enabled: false, country: 'AU' }); await call('POST', '/enable', {});
  X.T.parties.push({ owner: AU_SHOP, party_id: SUPP, party_no: 'P-00001', name: 'Chip Co', supplier: true, credit_days: 30 });
  WHO.identity_id = IN_SHOP;
  const post = async (e, ev) => { const r = await X.B.postEntry(X.db, e, ev); if (!r.ok) throw new Error(JSON.stringify(r)); return r; };
  return { X, srv, port: srv.address().port, post, shop: (id) => { WHO.identity_id = id; } };
}

const text = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }, sel);
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const rowsOf = (page, sel) => page.$$eval(sel + ' .cbl-row,' + sel + ' .cbl-lrec', (es) => es.map((e) => e.innerText.replace(/\s+/g, ' ')));

let RIG = null;
W.run('fx', async (w) => {
  const { page, ctx, base } = w;
  RIG = await realBooks();
  const sent = { add: [], imp: [], reval: [] };
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); localStorage.setItem('cb_api_base', location.origin); if (!localStorage.getItem('cb_theme')) localStorage.setItem('cb_theme', 'cream'); } catch (_) {} }, W.session('Walk Owner', 'Mayur Exports'));
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: r.request().method() === 'GET' ? '{}' : '{"ok":true}' }));
  await ctx.route('**/api/entities/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entity: { display_name: 'Mayur Exports', currency_code: 'INR' } }) }));
  await ctx.route('**/api/books/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (m === 'POST' && u.pathname === DOORS.add) sent.add.push(JSON.parse(q.postData() || '{}'));
    if (m === 'POST' && u.pathname === DOORS.imp) sent.imp.push(JSON.parse(q.postData() || '{}'));
    if (m === 'POST' && u.pathname === DOORS.revalPost) sent.reval.push(JSON.parse(q.postData() || '{}'));
    const res = await fetch('http://127.0.0.1:' + RIG.port + u.pathname + u.search, { method: m, headers: { 'content-type': 'application/json' }, body: m === 'GET' ? undefined : q.postData() || '{}' });
    const type = res.headers.get('content-type') || 'application/json', body = await res.text();
    if (/json/.test(type) && HELD.indexOf(m + ' ' + u.pathname) >= 0 && res.status < 300) return C.json(r, res.status, JSON.parse(body));
    return r.fulfill({ status: res.status, contentType: type, body });
  });
  const open = async (view, sel) => { await page.goto('about:blank'); await page.goto(base + '/accounts.html#' + view); await page.waitForSelector(sel, { timeout: 20000 }); await page.waitForTimeout(300); };

  await w.step('F1', 'Setup › Rates, none yet -> the empty line, "Add rate" (the server says the owner may), the pack\'s tax-rate rule', async () => {
    await open('rates', '[data-testid="fx"] [data-testid="fx-add"]');
    await page.waitForSelector('[data-testid="fx-rows"] .cbl-empty,[data-testid="fx-rows"] [class*="empty"]', { timeout: 10000 }).catch(() => {});
    const add = await page.$eval('[data-testid="fx-add"]', (b) => ({ dis: b.disabled, t: b.textContent.trim() }));
    const rule = await text(page, '[data-testid="fx-rule"]'), rows = await text(page, '[data-testid="fx-rows"]'), nav = await text(page, '[data-testid="acc-nav-rates"]'), title = await text(page, '#title');
    return { ok: !add.dis && add.t === 'Add rate' && /CBIC customs exchange rate/.test(rule) && /No rates yet/.test(rows) && nav === 'Rates' && title === 'Rates', saw: add.t + (add.dis ? ' (greyed)' : '') + ' · "' + rule.slice(0, 60) + '" · "' + rows.slice(0, 40) + '" · title ' + title };
  });
  await w.step('F2', 'Add rate: USD 83.25 for 14 Oct -> ONE add call; the row "1 USD = 83.25 INR · Typed"', async () => {
    await page.click('[data-testid="fx-add"]'); await page.waitForSelector('[data-testid="fx-form"]');
    await page.fill('[data-testid="fx-date"]', '2026-10-14'); await page.fill('[data-testid="fx-cur"]', 'usd'); await page.fill('[data-testid="fx-rate"]', '83.25');
    await page.click('[data-testid="fx-save"]');
    await page.waitForSelector('[data-testid="fx-row-USD-2026-10-14"]', { timeout: 10000 });
    const row = await text(page, '[data-testid="fx-row-USD-2026-10-14"]'), b = sent.add[0] || {};
    return { ok: sent.add.length === 1 && b.currency === 'USD' && b.rate === '83.25' && b.date === '2026-10-14' && /1 USD = 83\.25 INR/.test(row) && /Typed/.test(row) && !(await page.$('[data-testid="fx-form"]')), saw: sent.add.length + ' add call · ' + JSON.stringify(b) + ' · "' + row + '"' };
  });
  await w.step('F3', 'Import CSV -> the good rows in (Official / Imported, the file as reference), the bad line named', async () => {
    const f = path.join(os.tmpdir(), 'cbic-oct.csv');
    fs.writeFileSync(f, 'date,currency,rate,source\n2026-10-31,USD,84.00,official\n2026-10-31,EUR,abc\n2026-11-02,USD,84.10\n');
    await page.setInputFiles('[data-testid="fx-import"]', f);
    await page.waitForSelector('[data-testid="fx-row-USD-2026-10-31"]', { timeout: 10000 });
    const toast = await page.evaluate(() => (document.querySelector('.toast,#toast,[role="status"]') || {}).textContent || '');
    const all = await rowsOf(page, '[data-testid="fx-rows"]');
    const off = all.find((r) => /84\b|84\.00|= 84 /.test(r) && /31/.test(r)) || '';
    return { ok: sent.imp.length === 1 && sent.imp[0].file_name === 'cbic-oct.csv' && all.length === 3 && /Official/.test(off) && /cbic-oct\.csv/.test(off) && all.some((r) => /Imported/.test(r)),
      saw: sent.imp.length + ' import call · ' + all.length + ' rows · "' + off.slice(0, 80) + '" · toast "' + toast.slice(0, 90) + '"' };
  });
  await w.step('F4', 'A USD export bill posts at 14 Oct\'s rate -> Receivables shows both: ₹83,250.00 · US$1,000.00', async () => {
    await RIG.post(IN_SHOP, { type: 'sale_bill', date: '2026-10-14', currency: 'USD', party: CUST, by_rate: [{ rate: 0, taxable: 1000 }], source_ref: 'chit:ex1', ref: 'EX-1' });
    await open('receivables', '[data-testid="dues-fx-' + CUST + '-USD"]');
    const row = (await rowsOf(page, '#content')).find((r) => /Acme/.test(r)) || '', fx = await text(page, '[data-testid="dues-fx-' + CUST + '-USD"]');
    return { ok: /83,250\.00/.test(row) && /1,000\.00/.test(fx) && /\$/.test(fx), saw: '"' + row.slice(0, 120) + '" · foreign "' + fx + '"' };
  });
  await w.step('F5', 'Month lock: October at the 31 Oct closing rate -> the gain, Revalue -> two entries (31 Oct, back on 1 Nov)', async () => {
    await open('lock', '[data-testid="lk-fx"]');
    const before = await text(page, '[data-testid="lk-fx"]');
    await page.click('[data-testid="lk-fx-revalue"]');
    await page.waitForFunction(() => /Revalued/.test((document.querySelector('[data-testid="lk-fx-words"]') || {}).textContent || ''), null, { timeout: 10000 });
    const after = await text(page, '[data-testid="lk-fx-words"]');
    const E = RIG.X.T.entries.filter((e) => /^fxrev:/.test(e.source_ref || '')).map((e) => String(e.posting_date).slice(0, 10));
    return { ok: /Foreign balances/.test(before) && /Gain/.test(before) && /750\.00/.test(before) && sent.reval.length === 1 && sent.reval[0].period === 7 && E.join(',') === '2026-10-31,2026-11-01' && /Revalued/.test(after),
      saw: '"' + before.slice(0, 110) + '" · ' + sent.reval.length + ' revalue call · entries ' + E.join(',') + ' · "' + after + '"' };
  });
  RIG.shop(AU_SHOP);
  await w.step('F6', 'AU: a USD import bill at 1.50 -> Payables shows A$1,500.00 · US$1,000.00', async () => {
    const r = await (await fetch('http://127.0.0.1:' + RIG.port + '/api/books/fx-rates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: '2026-10-14', currency: 'USD', rate: '1.50' }) })).json();
    await RIG.post(AU_SHOP, { type: 'purchase_bill', date: '2026-10-14', currency: 'USD', party: SUPP, by_rate: [{ rate: 0, taxable: 1000 }], source_ref: 'chit:im1', ref: 'IM-1' });
    await open('payables', '[data-testid="dues-fx-' + SUPP + '-USD"]');
    const row = (await rowsOf(page, '#content')).find((x) => /Chip/.test(x)) || '', fx = await text(page, '[data-testid="dues-fx-' + SUPP + '-USD"]');
    return { ok: r.rate && /1,500\.00/.test(row) && /1,000\.00/.test(fx), saw: '"' + row.slice(0, 120) + '" · foreign "' + fx + '"' };
  });
  RIG.shop(IN_SHOP);

  /* F7: rule 13 — the Rates screen in two themes and two widths */
  const SH = path.join(__dirname, 'shots', 'fx'); fs.mkdirSync(SH, { recursive: true });
  for (const theme of ['cream', 'dark']) {
    for (const [vw, vh] of [[1366, 860], [390, 844]]) {
      await page.evaluate((t) => localStorage.setItem('cb_theme', t), theme);
      await page.setViewportSize({ width: vw, height: vh });
      await open('rates', '[data-testid="fx-rows"] .cbl-row,[data-testid="fx-rows"] .cbl-lrec');
      await w.step('F7-' + theme + '-' + vw, 'Rates, ' + theme + ' at ' + vw + ' px -> AA contrast, no sideways scroll, nothing clipped, nothing over the bar, no app.html, copy in budget', async () => {
        const rec = await page.evaluate(measure);
        const low = rec.filter((r) => !r.grad && r.ratio < r.need && r.inMain !== false).map((r) => r.text + ' ' + (Math.round(r.ratio * 100) / 100));
        const g = await page.evaluate(() => {
          const root = document.querySelector('[data-testid="fx"]'), bar = document.getElementById('fx_bar');
          const clipped = [...root.querySelectorAll('button,label,[data-testid="fx-rule"],[data-testid="fx-why"]')].filter((e) => e.offsetParent && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)).map((e) => e.textContent.trim().slice(0, 30));
          const br = bar.getBoundingClientRect();
          const floats = [...document.querySelectorAll('body *')].filter((e) => { const cs = getComputedStyle(e); if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width && r.height && r.left < br.right && br.left < r.right && r.top < br.bottom && br.top < r.bottom && !e.contains(bar) && !bar.contains(e); }).map((e) => e.className || e.tagName);
          const main = document.getElementById('content') || document.body;
          return { sw: Math.max(document.documentElement.scrollWidth - innerWidth, main.scrollWidth - main.clientWidth), clipped, floats, appLinks: [...root.querySelectorAll('a[href]')].filter((a) => /app\.html/.test(a.getAttribute('href'))).length,
            title: (document.getElementById('title') || {}).textContent || '', strings: [...root.querySelectorAll('button,label,[data-testid="fx-rule"]')].map((e) => e.textContent.trim()) };
        });
        await page.screenshot({ path: path.join(SH, 'rates-' + theme + '-' + vw + '.png') });
        const budget = words(g.title) <= 5 && g.strings.every((s) => words(s) <= 20);
        const ok = !low.length && g.sw <= 1 && !g.clipped.length && !g.floats.length && !g.appLinks && budget;
        return { ok, saw: (low.length ? 'LOW CONTRAST ' + low.slice(0, 4).join(' | ') : 'contrast AA (' + rec.length + ' texts)') + ' · sideways ' + g.sw + ' · clipped ' + (g.clipped.join('/') || 'none') + ' · floating over the bar ' + (g.floats.join('/') || 'none') + ' · app.html links ' + g.appLinks + ' · copy ' + (budget ? 'in budget' : 'OVER: ' + g.strings.filter((s) => words(s) > 20).join(' / ')) };
      });
    }
  }
  await w.step('F8', 'Every rates / revaluation answer had the API\'s keys, nesting and types (the contract)', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });
});
process.on('exit', () => { try { RIG && RIG.srv.close(); } catch (_) {} });

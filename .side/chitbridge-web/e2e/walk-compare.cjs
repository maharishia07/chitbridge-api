#!/usr/bin/env node
/**
 * e2e/walk-compare.cjs - PARALLEL RUN, WALKED (PR1, 2026-10-13): CB Accounts › Books › Parallel run — their Tally / Xero period beside ours.
 * Black box over the REAL compare: the page's /api/books/** is answered by chitbridge-api's own routes/books.js running in this process over the in-memory
 * books (api tests/support/books-harness.cjs + the sibling engines) — the same lib/parallel-run, lib/books, engines and SQL-free store the api tests use.
 * Nothing touches a database; nothing is posted (the walk checks the day book is unchanged). Every compare answer is held to the API contract (C.json).
 * Two shops: an Indian one beside a Tally trial balance (XML), an Australian one beside a Xero trial balance + P&L (CSV, headings on row 5).
 *   C1  Books › Parallel run, no snapshot yet -> the empty line and "Load their figures" (the server says the owner may)
 *   C2  load the Tally TB (XML) -> read at once, no columns to pick -> Keep -> ONE keep call; the compare opens, differences first
 *   C3  the Sales line -> different, both figures, WHY names the rail bill they keyed later; its next level lists our entry and the chit
 *   C4  Open the ledger -> the Ledgers view on that ledger for the period (the entries behind it); nothing was posted by the compare
 *   C5  Download CSV -> the server's file, every line with the why
 *   C6  AU: Xero TB (CSV, headings on row 5, columns guessed) -> kept; then add their P&L to the same snapshot (the date column picked)
 *   C7  AU compare: Sales the same ✓, Bank Fees not mapped (said why), GST paid only ours
 *   C8  rule 13, Cream and Dark at 1366 and 390: AA contrast of every text, no sideways scroll, nothing clipped, nothing floating over the bar, no app.html link, copy in budget
 *   C9  every compare answer had the API's keys, nesting and types (the contract)
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-compare.cjs        (needs ../chitbridge-api with its node_modules; ../chitbridge-engines if beside, else the api's adopted lib/ copies)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const FIX = (f) => path.join(__dirname, 'fixtures', 'parallel-run', f);
const API = process.env.CB_API_DIR || path.join(__dirname, '..', '..', 'chitbridge-api');

/* the doors the page calls (e2e/contract.cjs reads these literals to know this harness answers them) */
const DOORS = { list: '/api/books/compare', preflight: '/api/books/compare/preflight', keep: '/api/books/compare/snapshots', read: '/api/books/compare/:id', csv: '/api/books/compare/:id/csv' };

/* ── the api's real books routes, in this process, over the in-memory books — two shops, their posts ── */
const IN_SHOP = '11111111-1111-4111-8111-111111111111', AU_SHOP = 'aaaaaaaa-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222', SUPP = '33333333-3333-4333-8333-333333333333';
const WHO = { identity_id: IN_SHOP, identity_type: 'entity', display_name: 'Mayur Traders' };
async function realBooks() {
  const H = require(path.join(API, 'tests', 'support', 'books-harness.cjs'));
  const auth = Object.assign((req, res, next) => { req.identity = Object.assign({}, WHO); next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
  /* the engines: the sibling working copy on the dev PC, else the api's ADOPTED copies (lib/ledger.js · accounts-packs.js · … — the released,
     pinned engines production runs). The walks CI checks out only the api — engines is private — so without this the walk stopped in 1 s (FIX-INT5a). */
  if (!process.env.BOOKS_ENGINES_SRC && !H.enginesSrc().dir) process.env.BOOKS_ENGINES_SRC = path.join(API, 'lib');
  const X = H.load({ auth });
  if (!X.src.dir) throw new Error('the books engines are not beside this checkout: ' + X.src.why);
  const express = require(path.join(API, 'node_modules', 'express'));
  const app = express(); app.use(express.json({ limit: '8mb' })); app.use('/api/books', require(path.join(API, 'routes', 'books')));
  const srv = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const K = require(path.join(API, 'lib', 'books-hooks')), realDay = K.dayOf; let DAY = '2026-10-05';
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));   /* clock-ok: matches the posting instant of this very call, the walk's own DAY is fixed */
  const call = (m, p, b) => fetch('http://127.0.0.1:' + srv.address().port + '/api/books' + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  /* India: two bills on the rail (the second on the 28th) and a purchase typed here */
  await X.store.saveSetting(X.db, IN_SHOP, { enabled: false }); await call('POST', '/enable', {});
  X.T.parties.push({ owner: IN_SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', customer: true }, { owner: IN_SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true });
  X.T.chits.push({ chit_id: 'c0000000-0000-4000-8000-00000000000a', entity_id: IN_SHOP, business_json: { printed_as: 'B-1' } }, { chit_id: 'c0000000-0000-4000-8000-00000000000b', entity_id: IN_SHOP, business_json: { printed_as: 'B-2' } });
  const ADOPTED = X.src.dir === path.join(API, 'lib');
  const post = async (e, ev) => {
    let r; try { r = await X.B.postEntry(X.db, e, ev); } catch (err) { r = { ok: false, why: err.message }; }
    if (!r.ok) throw new Error(JSON.stringify(r) + (ADOPTED ? ' — on the api\'s ADOPTED engines (engines.lock.json posting ' + JSON.parse(fs.readFileSync(path.join(API, 'engines.lock.json'), 'utf8')).pins.posting
      + '): a shop outside India needs the pack-driven tax heads (engines b2, after v1.20.0) — the api must adopt the current release of posting · ledger · bookpack · period · receivables (tools/adopt.cjs)' : ''));
  };
  await post(IN_SHOP, { type: 'sale_bill', date: '2026-09-05', currency: 'INR', party: CUST, source_chit_id: 'c0000000-0000-4000-8000-00000000000a', source_ref: 'chit:a', by_rate: [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], paid: {}, round_off: 0 });
  await post(IN_SHOP, { type: 'sale_bill', date: '2026-09-28', currency: 'INR', party: CUST, source_chit_id: 'c0000000-0000-4000-8000-00000000000b', source_ref: 'chit:b', by_rate: [{ rate: 18, taxable: 500, cgst: 45, sgst: 45, igst: 0 }], paid: {}, round_off: 0 });
  await post(IN_SHOP, { type: 'purchase_bill', date: '2026-09-06', currency: 'INR', party: SUPP, source_ref: 'pur:K7', by_rate: [{ rate: 18, taxable: 500, cgst: 45, sgst: 45, igst: 0 }], paid: {}, round_off: 0 });
  /* Australia: a counter day and a purchase */
  WHO.identity_id = AU_SHOP; DAY = '2026-10-20';
  await X.store.saveSetting(X.db, AU_SHOP, { enabled: false, country: 'AU' }); await call('POST', '/enable', {});
  X.T.parties.push({ owner: AU_SHOP, party_id: SUPP, party_no: 'P-00001', name: 'Kumar Traders', supplier: true });
  await post(AU_SHOP, { type: 'walkin_day', ref: 'D1', date: '2026-07-01', currency: 'AUD', modes: { cash: 110 }, by_rate: [{ rate: 10, taxable: 100, gst: 10 }], round_off: 0, source_ref: 'walkin:C1:2026-07-01' });
  await post(AU_SHOP, { type: 'purchase_bill', ref: 'P1', date: '2026-09-06', currency: 'AUD', party: SUPP, by_rate: [{ rate: 10, taxable: 500, gst: 50 }], paid: {}, round_off: 0, source_ref: 'pur:P1' });
  WHO.identity_id = IN_SHOP;
  return { X, srv, port: srv.address().port, shop: (id) => { WHO.identity_id = id; } };
}

const text = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }, sel);
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

let RIG = null;
W.run('compare', async (w) => {
  const { page, ctx, base } = w;
  RIG = await realBooks();
  const sent = { keep: [], preflight: [] };
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); localStorage.setItem('cb_api_base', location.origin); if (!localStorage.getItem('cb_theme')) localStorage.setItem('cb_theme', 'cream'); } catch (_) {} }, W.session('Walk Owner', 'Mayur Traders'));
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: r.request().method() === 'GET' ? '{}' : '{"ok":true}' }));
  await ctx.route('**/api/entities/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entity: { display_name: 'Mayur Traders', currency_code: 'INR' } }) }));
  /* every /api/books call goes to the real routes; the compare answers are held to the contract on the way back */
  await ctx.route('**/api/books/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.pathname === DOORS.keep) sent.keep.push(JSON.parse(q.postData() || '{}'));
    if (u.pathname === DOORS.preflight) sent.preflight.push(JSON.parse(q.postData() || '{}'));
    const res = await fetch('http://127.0.0.1:' + RIG.port + u.pathname + u.search, { method: m, headers: { 'content-type': 'application/json' }, body: m === 'GET' ? undefined : q.postData() || '{}' });
    const type = res.headers.get('content-type') || 'application/json', body = await res.text();
    if (/json/.test(type) && /\/api\/books\/compare/.test(u.pathname) && !/\/csv$/.test(u.pathname)) return C.json(r, res.status, JSON.parse(body));
    return r.fulfill({ status: res.status, contentType: type, body, headers: { 'content-disposition': res.headers.get('content-disposition') || '' } });
  });
  const open = async () => { await page.goto('about:blank'); await page.goto(base + '/accounts.html#compare'); await page.waitForSelector('[data-testid="cmp"]', { timeout: 20000 }); await page.waitForSelector('[data-testid="cmp-empty"],[data-testid="cmp-compare"]', { timeout: 15000 }); };
  const entriesBefore = RIG.X.T.entries.length;

  await w.step('C1', 'Books › Parallel run, no snapshot yet -> the empty line and "Load their figures" (the server says the owner may)', async () => {
    await open();
    const empty = await text(page, '[data-testid="cmp-empty"]'), load = await page.$eval('[data-testid="cmp-load"]', (b) => ({ dis: b.disabled, t: b.textContent.trim() }));
    const nav = await page.$eval('[data-testid="acc-nav-compare"]', (b) => b.textContent.trim()), title = await text(page, '#title');
    return { ok: /No snapshot yet/.test(empty) && !load.dis && load.t === 'Load their figures' && nav === 'Parallel run' && title === 'Parallel run', saw: '"' + empty + '" · ' + load.t + (load.dis ? ' (greyed)' : '') + ' · title ' + title };
  });
  await w.step('C2', 'Load the Tally TB (XML) -> read at once, no columns to pick -> Keep -> ONE keep call; the compare opens, differences first', async () => {
    await page.click('[data-testid="cmp-load"]'); await page.waitForSelector('[data-testid="cmp-file-step"]');
    const greyed = await page.$eval('[data-testid="cmp-next"]', (b) => b.title);
    await page.fill('[data-testid="cmp-label"]', 'Tally H1');
    await page.fill('[data-testid="cmp-to"]', '2026-09-30'); await page.dispatchEvent('[data-testid="cmp-to"]', 'change');
    await page.setInputFiles('[data-testid="cmp-file"]', FIX('tally-tb-ledgers.xml'));
    await page.waitForSelector('[data-testid="cmp-file-name"]');
    await page.waitForFunction(() => { const b = document.querySelector('[data-testid="cmp-next"]'); return b && !b.disabled; });
    await page.click('[data-testid="cmp-next"]'); await page.waitForSelector('[data-testid="cmp-xml-read"]', { timeout: 10000 });
    const read = await text(page, '[data-testid="cmp-xml-read"]');
    await page.click('[data-testid="cmp-keep"]'); await page.waitForSelector('[data-testid="cmp-compare"]', { timeout: 15000 });
    await page.waitForSelector('[data-testid="cmp-rows"] .cbl-row,[data-testid="cmp-rows"] .cbl-lrec', { timeout: 10000 });
    const n = [await text(page, '[data-testid="cmp-n-diff"]'), await text(page, '[data-testid="cmp-n-gap"]'), await text(page, '[data-testid="cmp-n-same"]')];
    const first = await page.$$eval('[data-testid="cmp-rows"] [data-status]', (es) => es.slice(0, 3).map((e) => e.getAttribute('data-status')));
    const k = sent.keep[0] || {};
    return { ok: /Pick the file first|Give the snapshot a name/.test(greyed) && /10 ledgers/.test(read) && sent.keep.length === 1 && k.xml && k.part === 'tb' && k.period_to === '2026-09-30' && n.join(',') === '5,1,4' && first[0] === 'different',
      saw: 'greyed "' + greyed + '" · "' + read + '" · ' + sent.keep.length + ' keep call · different ' + n[0] + ' · not mapped ' + n[1] + ' · same ' + n[2] + ' · first ' + first.join(',') };
  });
  await w.step('C3', 'The Sales line -> different, both figures, WHY names the rail bill they keyed later; its next level lists our entry and the chit', async () => {
    await page.fill('[data-testid="cmp-rows"] input[type="search"]', 'Sales');
    const row = page.locator('[data-testid="cmp-row-tb-3"]'); await row.waitFor({ timeout: 5000 });
    const t = (await row.innerText()).replace(/\s+/g, ' ');
    await row.click(); await page.waitForSelector('[data-testid="cmp-entries"]', { timeout: 5000 });
    const nx = await text(page, '[data-testid="cmp-entries"]');
    return { ok: /Different/.test(t) && /bill B-2 of 2026-09-28/.test(t) && /keyed later/.test(t) && /1,500\.00/.test(t) && /1,000\.00/.test(t) && /bill B-2/.test(nx) && /on the rail/.test(nx) && !!(await page.$('[data-testid="cmp-open-4000"]')),
      saw: t.slice(0, 200) + ' || next: ' + nx.slice(0, 120) };
  });
  await w.step('C4', 'Open the ledger -> the Ledgers view on Sales for the period; the compare posted nothing (the day book is as it was)', async () => {
    await page.click('[data-testid="cmp-open-4000"]');
    await page.waitForSelector('[data-testid="bk-lt"]', { timeout: 15000 }); await page.waitForTimeout(800);
    const head = await page.evaluate(() => { const p = document.getElementById('lt_pane'); return p ? p.innerText.replace(/\s+/g, ' ').slice(0, 160) : ''; });
    const hash = await page.evaluate(() => location.hash);
    return { ok: hash === '#ledgers' && /Sales/.test(head) && RIG.X.T.entries.length === entriesBefore, saw: hash + ' · ' + head + ' · entries ' + entriesBefore + ' → ' + RIG.X.T.entries.length };
  });
  await w.step('C5', 'Download CSV -> the server\'s file: every line with the why', async () => {
    await open();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('[data-testid="cmp-csv"]')]);
    const body = fs.readFileSync(await dl.path(), 'utf8');
    return { ok: /^statement,status,line/.test(body) && /"Trial balance","different","Sales"/.test(body) && /keyed later/.test(body), saw: dl.suggestedFilename() + ' · ' + body.split('\n').length + ' lines' };
  });

  RIG.shop(AU_SHOP);
  await w.step('C6', 'AU: Xero TB (CSV, headings on row 5, columns guessed) -> kept; then their P&L added to the same snapshot (the date column picked)', async () => {
    await open();
    await page.click('[data-testid="cmp-load"]'); await page.waitForSelector('[data-testid="cmp-file-step"]');
    await page.fill('[data-testid="cmp-label"]', 'Xero Q1');
    await page.selectOption('[data-testid="cmp-source"]', 'xero');
    await page.fill('[data-testid="cmp-from"]', '2026-07-01'); await page.dispatchEvent('[data-testid="cmp-from"]', 'change');
    await page.fill('[data-testid="cmp-to"]', '2026-09-30'); await page.dispatchEvent('[data-testid="cmp-to"]', 'change');
    await page.fill('[data-testid="cmp-hrow"]', '5'); await page.dispatchEvent('[data-testid="cmp-hrow"]', 'change');
    await page.setInputFiles('[data-testid="cmp-file"]', FIX('xero-tb.csv'));
    await page.waitForFunction(() => { const b = document.querySelector('[data-testid="cmp-next"]'); return b && !b.disabled; });
    await page.click('[data-testid="cmp-next"]'); await page.waitForSelector('[data-testid="cmp-columns-step"]', { timeout: 10000 });
    const dr = await page.$eval('[data-testid="cmp-pick-Debit - Year to date"]', (s) => s.value);
    await page.click('[data-testid="cmp-keep"]'); await page.waitForSelector('[data-testid="cmp-compare"]', { timeout: 15000 });
    /* the P&L: Adding to the picked snapshot */
    await page.click('[data-testid="cmp-load"]'); await page.waitForSelector('[data-testid="cmp-adding"]');
    const adding = await text(page, '[data-testid="cmp-adding"]');
    await page.selectOption('[data-testid="cmp-part"]', 'pl');
    await page.fill('[data-testid="cmp-hrow"]', '5'); await page.dispatchEvent('[data-testid="cmp-hrow"]', 'change');
    await page.setInputFiles('[data-testid="cmp-file"]', FIX('xero-pl.csv'));
    await page.waitForFunction(() => { const b = document.querySelector('[data-testid="cmp-next"]'); return b && !b.disabled; });
    await page.click('[data-testid="cmp-next"]'); await page.waitForSelector('[data-testid="cmp-columns-step"]', { timeout: 10000 });
    const keepGrey = await page.$eval('[data-testid="cmp-keep"]', (b) => b.title || '');
    await page.selectOption('[data-testid="cmp-pick-30 Sep 2026"]', 'amount');
    await page.click('[data-testid="cmp-keep"]'); await page.waitForSelector('[data-testid="cmp-part-pl"]', { timeout: 15000 });
    const pl = sent.keep[sent.keep.length - 1] || {};
    return { ok: dr === 'debit' && adding === 'Xero Q1' && /Amount/.test(keepGrey) && sent.keep.length === 3 && pl.snapshot_id && pl.part === 'pl' && pl.header_row === 5 && (pl.decisions || []).some((d) => d.incoming === '30 Sep 2026' && d.field === 'amount'),
      saw: 'Debit - Year to date → ' + dr + ' · adding to ' + adding + ' · Keep greyed "' + keepGrey + '" until the amount column was picked · ' + sent.keep.length + ' keep calls' };
  });
  await w.step('C7', 'AU compare: Sales the same ✓, Bank Fees not mapped (said why), GST paid only ours; the P&L tab beside it', async () => {
    await page.click('[data-testid="cmp-part-tb"]'); await page.waitForTimeout(300);
    const rows = await page.$$eval('[data-testid="cmp-rows"] .cbl-row,[data-testid="cmp-rows"] .cbl-lrec', (es) => es.map((e) => e.innerText.replace(/\s+/g, ' ')));
    const has = (re) => rows.some((r) => re.test(r));
    await page.click('[data-testid="cmp-part-pl"]'); await page.waitForTimeout(300);
    const pl = await page.$$eval('[data-testid="cmp-rows"] .cbl-row,[data-testid="cmp-rows"] .cbl-lrec', (es) => es.map((e) => e.innerText.replace(/\s+/g, ' ')));
    return { ok: has(/^▸?Sales .*Same ✓/) && has(/Bank Fees.*Not mapped.*No ledger here matches "Bank Fees"/) && has(/GST paid.*Only ours/) && pl.some((r) => /Net profit/.test(r)),
      saw: rows.length + ' TB lines · ' + rows.filter((r) => /Bank Fees|GST paid|^Sales/.test(r)).map((r) => r.slice(0, 70)).join(' | ') + ' · P&L ' + pl.length + ' lines' };
  });

  /* C8: rule 13 — the compare in two themes and two widths (the AU shop's snapshot is on screen) */
  const SH = path.join(__dirname, 'shots', 'compare'); fs.mkdirSync(SH, { recursive: true });
  for (const theme of ['cream', 'dark']) {
    for (const [vw, vh] of [[1366, 860], [390, 844]]) {
      await page.evaluate((t) => localStorage.setItem('cb_theme', t), theme);
      await page.setViewportSize({ width: vw, height: vh });
      await open(); await page.waitForSelector('[data-testid="cmp-rows"] .cbl-row,[data-testid="cmp-rows"] .cbl-lrec', { timeout: 10000 }); await page.waitForTimeout(400);
      await w.step('C8-' + theme + '-' + vw, 'Parallel run, ' + theme + ' at ' + vw + ' px -> AA contrast, no sideways scroll, nothing clipped, nothing over the bar, no app.html, copy in budget', async () => {
        const rec = await page.evaluate(measure);
        const low = rec.filter((r) => !r.grad && r.ratio < r.need && r.inMain !== false).map((r) => r.text + ' ' + (Math.round(r.ratio * 100) / 100));
        const g = await page.evaluate(() => {
          const root = document.querySelector('[data-testid="cmp"]'), bar = document.getElementById('cmp_bar');
          const clipped = [...root.querySelectorAll('button,.optchip,.step,[data-status],[data-testid="cmp-sub"],[data-testid="cmp-effort"],[data-testid^="cmp-n-"]')].filter((e) => e.offsetParent && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)).map((e) => e.textContent.trim().slice(0, 30));
          const br = bar.getBoundingClientRect();
          const floats = [...document.querySelectorAll('body *')].filter((e) => { const cs = getComputedStyle(e); if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width && r.height && r.left < br.right && br.left < r.right && r.top < br.bottom && br.top < r.bottom && !e.contains(bar) && !bar.contains(e); }).map((e) => e.className || e.tagName);
          const main = document.getElementById('content') || document.body;
          return { sw: Math.max(document.documentElement.scrollWidth - innerWidth, main.scrollWidth - main.clientWidth), clipped, floats, appLinks: [...root.querySelectorAll('a[href]')].filter((a) => /app\.html/.test(a.getAttribute('href'))).length,
            title: (document.getElementById('title') || {}).textContent || '', sub: (document.querySelector('[data-testid="cmp-sub"]') || {}).textContent || '', strings: [...root.querySelectorAll('button,[data-testid="cmp-sub"],[data-testid="cmp-effort"],[data-testid="cmp-why"]')].map((e) => e.textContent.trim()) };
        });
        await page.screenshot({ path: path.join(SH, 'compare-' + theme + '-' + vw + '.png') });
        const budget = words(g.title) <= 5 && words(g.sub) <= 12 && g.strings.every((s) => words(s) <= 20);
        const ok = !low.length && g.sw <= 1 && !g.clipped.length && !g.floats.length && !g.appLinks && budget;
        return { ok, saw: (low.length ? 'LOW CONTRAST ' + low.slice(0, 4).join(' | ') : 'contrast AA (' + rec.length + ' texts)') + ' · sideways ' + g.sw + ' · clipped ' + (g.clipped.join('/') || 'none') + ' · floating over the bar ' + (g.floats.join('/') || 'none') + ' · app.html links ' + g.appLinks + ' · copy ' + (budget ? 'in budget' : 'OVER: ' + g.title + ' / ' + g.sub) };
      });
    }
  }
  await w.step('C9', 'Every compare answer had the API\'s keys, nesting and types (the contract)', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });
});
process.on('exit', () => { try { RIG && RIG.srv.close(); } catch (_) {} });

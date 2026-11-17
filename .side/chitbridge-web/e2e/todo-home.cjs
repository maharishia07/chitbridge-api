/* todo-home.cjs — CB ACCOUNTS OPENS ON "TO DO", PROVED (docs/design/cb-accounts-ia/REQUIREMENT.md §1).
 * Pattern: cb-accounts.cjs — Playwright, a stand-in API answering INSIDE the page, a free port for the static server; nothing leaves the machine.
 * The stand-in answers GET /api/books/todo with [{ kind, count, words, action:{ label, screen, call } }] — the shape chitbridge-api lib/books-todo.js returns.
 *
 *  1  several items: the page opens on To do (first in the sidebar, lit); one row per item, in the API's order; each row = symbol · count · the
 *     server's sentence · ONE button carrying the API's label; the page adds, drops and re-words nothing
 *  2  a button opens the right page (Waiting, Month lock); a screen with no page yet says it starts after an update and stays put
 *  3  none: one line "✓ Books up to date", no rows, no buttons
 *  4  a 503 item (and a 503 on the whole call): "Starts after an update", never a raw message; the row still has its (waiting) button
 *  5  390 px: no sideways scroll, every button whole, 44 px tall, under its sentence
 * Screenshots: e2e/shots/todo-home-{laptop,phone}.png
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), SHOTS = path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const C = require('./lib/contract.cjs'), books = require('./lib/books-api.cjs');   /* every answer served for a route in the API contract is checked (e2e/fixtures/web-api.contract.json) */
const J = C.json;

const SEVERAL = [
  { kind: 'bills_to_accept', count: 3, words: '3 supplier bills are waiting for you to confirm the goods. Confirm them and they post.', action: { label: 'Open the bills', screen: 'waiting', call: 'GET /api/books/health' } },
  { kind: 'months_not_locked', count: 2, words: '2 months are over but still open: August 2026, September 2026. Lock each once its books are done, so nothing changes behind you.', action: { label: 'Lock the months', screen: 'periods', call: 'POST /api/books/periods/:fy/:period/lock' } },
  { kind: 'closing_stock_missing', count: 1, words: 'No closing stock for September 2026 yet. Count the stock and enter its value, so profit is right.', action: { label: 'Enter closing stock', screen: 'closing-stock', call: 'POST /api/books/closing-stock' } },
  { kind: 'gst_due', count: 1, words: 'GST for September 2026 is still to pay, due by 20 Oct. Close the month, then pay by challan.', action: { label: 'Close GST', screen: 'gst', call: 'POST /api/books/gst/close' } },
  { kind: 'gstr2b_missing', count: 2, words: '2 purchase bills are missing from GSTR-2B. Review them before you file.', action: { label: 'Review', screen: '2b-match', call: 'GET /api/books/2b' } },
  { kind: 'recurring_due', count: 1, words: '1 repeating entry is due: Rent. Accept each to post it, or skip it.', action: { label: 'Review', screen: 'recurring', call: 'POST /api/books/recurring/:id/post' } },
];

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if (((!f.startsWith(PUB)) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const threw = [], offHost = [];
  const tok = (c) => { const e = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return e({ alg: 'none' }) + '.' + e(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, c)) + '.x'; };
  const OWNER = { token: tok({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan' };

  async function open(S, vp) {
    const ctx = await b.newContext({ viewport: vp || { width: 1360, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offHost.push(r.request().url()); return r.abort(); });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => {
      const u = new URL(r.request().url()), p = u.pathname; S.calls.push(r.request().method() + ' ' + p);
      if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR' } });
      if (p === '/api/books/health') return J(r, 200, books.health());
      if (p === '/api/books/todo') return S.status ? J(r, S.status, { error: 'internal detail that must never reach the screen' }) : (S.rawTodo ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(S.todo) }) /* the page's defensive per-item 503 is not an API shape: not held to the contract */ : J(r, 200, S.todo.map((x) => Object.assign({ items: [] }, x))));
      if (p === '/api/books/periods') return J(r, 200, books.periods([]));
      /* A1: this shop is India's - the contract's rail answer (the returns screen says the GST return is made from the bills, not from these books) */
      if (p === '/api/books/returns') return J(r, 200, books.returnsRail());
      if (p.startsWith('/api/books')) return J(r, 200, {});
      return J(r, 200, {});
    });
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, OWNER);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + '/accounts.html');
    return { ctx, p };
  }
  const stand = (todo, status) => ({ calls: [], todo, status: status || 0 });

  /* ── 1 · SEVERAL ITEMS (laptop) ── */
  {
    const S = stand(SEVERAL), { ctx, p } = await open(S);
    await p.waitForSelector('[data-testid="todo-list"]', { timeout: 15000 });
    const labels = await p.$$eval('#nav .nav-btn', (x) => x.map((e) => e.getAttribute('aria-label')));
    ok(labels[0] === 'To do' && labels.indexOf('Day book') > 0, 'To do is first in the sidebar, before Day book (the MIS overview "How we are doing", merged 232f497d, sits between) (' + labels.slice(0, 3).join(' · ') + ')');
    ok(await p.evaluate(() => document.querySelector('.nav-btn.active').getAttribute('aria-label')) === 'To do' && (await p.textContent('#title')).trim() === 'To do', 'Accounts opens on To do, and it is the lit entry');
    ok(S.calls.filter((c) => c === 'GET /api/books/todo').length === 1, 'one read of GET /api/books/todo');
    const rows = await p.$$eval('.todo-row', (r) => r.map((x) => ({ kind: x.getAttribute('data-kind'), n: x.querySelector('.todo-n').textContent.trim(), words: x.querySelector('.todo-words').textContent.trim(), btn: Array.from(x.querySelectorAll('button')).map((b) => b.textContent.trim()), sym: x.querySelector('.todo-sym').textContent.trim() })));
    ok(rows.length === SEVERAL.length && rows.every((r, i) => r.kind === SEVERAL[i].kind), 'one row per item, in the API\'s order (' + rows.map((r) => r.kind).join(', ') + ')');
    ok(rows.every((r, i) => r.n === String(SEVERAL[i].count) && r.words === SEVERAL[i].words), 'each row shows the API\'s count and its sentence word for word — the page adds and re-words nothing');
    ok(rows.every((r, i) => r.btn.length === 1 && r.btn[0] === SEVERAL[i].action.label && r.sym), 'every row has a symbol and ONE button carrying the API\'s label (' + rows.map((r) => r.btn.join('/')).join(' | ') + ')');
    ok(await p.locator('[data-testid="todo-none"]').count() === 0, 'with items there is no "up to date" line');
    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'no sideways scroll at 1360');
    await p.screenshot({ path: path.join(SHOTS, 'todo-home-laptop.png') });

    /* ── 2 · A BUTTON OPENS THE RIGHT PAGE ── */
    await p.click('[data-testid="todo-go-bills_to_accept"]');
    await p.waitForSelector('[data-testid="wait-empty"], [data-testid="wait-0"], #bk_body .cbl, #bk_body .empty, #bk_body');
    /* A1 (2026-10-03): Waiting is no longer a menu item, so no nav button lights for it. What proves the button opened the Waiting page is the page itself:
       the tab is waiting AND its own heading 'Waiting to be recorded' is painted (a body still saying 'Reading…' does not count). */
    await p.waitForFunction(() => /Waiting to be recorded/i.test((document.querySelector('#bk_body') || {}).innerText || ''), null, { timeout: 5000 }).catch(() => {});
    const onWaiting = await p.evaluate(() => ({ tab: window.BK && window.BK.tab, text: (document.querySelector('#bk_body') || {}).innerText || '' }));
    ok(onWaiting.tab === 'waiting' && /Waiting to be recorded/i.test(onWaiting.text), '"Open the bills" opens the Waiting page (the tab is waiting; its heading "Waiting to be recorded" is on screen)');
    await p.click('[data-testid="acc-nav-todo"]'); await p.waitForSelector('[data-testid="todo-list"]');
    await p.click('[data-testid="todo-go-months_not_locked"]');
    await p.waitForFunction(() => document.querySelector('.nav-btn.active').getAttribute('aria-label') === 'Month lock', null, { timeout: 5000 }).catch(() => {});
    ok(await p.evaluate(() => document.querySelector('.nav-btn.active').getAttribute('aria-label')) === 'Month lock', '"Lock the months" opens Month lock');
    await p.click('[data-testid="acc-nav-todo"]'); await p.waitForSelector('[data-testid="todo-list"]');
    await p.click('[data-testid="todo-go-gst_due"]');
    await p.waitForFunction(() => document.querySelector('.nav-btn.active').getAttribute('aria-label') === 'GST close & pay', null, { timeout: 5000 }).catch(() => {});
    ok(await p.evaluate(() => document.querySelector('.nav-btn.active').getAttribute('aria-label')) === 'GST close & pay', '"Close GST" opens GST close & pay (a page now)');
    await p.click('[data-testid="acc-nav-todo"]'); await p.waitForSelector('[data-testid="todo-list"]');
    await p.click('[data-testid="todo-go-gstr2b_missing"]');
    await p.waitForSelector('#toast .toast', { timeout: 3000 }).catch(() => {});
    ok(/starts after an update/i.test(await p.textContent('#toast').catch(() => '')) && await p.locator('[data-testid="todo-list"]').count() === 1, 'a screen with no page yet says it starts after an update and stays on To do');
    ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
    await ctx.close();
  }

  /* ── 3 · NONE ── */
  {
    const S = stand([]), { ctx, p } = await open(S);
    await p.waitForSelector('[data-testid="todo-none"]', { timeout: 15000 });
    ok((await p.textContent('[data-testid="todo-none"]')).trim() === '✓ Books up to date', 'nothing to do → one line "✓ Books up to date"');
    ok(await p.locator('.todo-row').count() === 0 && await p.locator('#bk_body button').count() === 0, 'no rows, no buttons');
    await ctx.close();
  }

  /* ── 4 · A 503 ITEM · A 503 ON THE WHOLE CALL ── */
  {
    const off = SEVERAL.slice(0, 1).concat([{ kind: 'year_close_possible', count: 1, status: 503, words: 'internal detail that must never reach the screen', action: { label: 'Close the year', screen: 'year-close', call: 'POST /api/books/year/2025-26/close' } }]);
    const S = stand(off); S.rawTodo = true; const { ctx, p } = await open(S);
    await p.waitForSelector('[data-testid="todo-list"]', { timeout: 15000 });
    const w = (await p.textContent('[data-testid="todo-words-year_close_possible"]')).trim();
    ok(w === 'Starts after an update' && !/internal/.test(await p.textContent('#bk_body')), 'a 503 item says "Starts after an update" — never the raw message (' + w + ')');
    ok(await p.locator('[data-testid="todo-go-year_close_possible"]').count() === 1 && await p.locator('[data-testid="todo-go-year_close_possible"]').isDisabled(), 'it still has its button, waiting (disabled)');
    ok(await p.locator('[data-testid="todo-go-bills_to_accept"]').isEnabled(), 'the other row\'s button works');
    await ctx.close();
    const S2 = stand([], 503), c2 = await open(S2);
    await c2.p.waitForSelector('[data-testid="todo-503"]', { timeout: 15000 });
    ok(/^⏳ Starts after an update$/.test((await c2.p.textContent('[data-testid="todo-503"]')).trim()) && !/internal/.test(await c2.p.textContent('#bk_body')), 'a 503 on the whole call is one calm line, not an error card');
    await c2.ctx.close();
  }

  /* ── 5 · PHONE, 390 px ── */
  {
    const S = stand(SEVERAL), { ctx, p } = await open(S, { width: 390, height: 844 });
    await p.waitForSelector('[data-testid="todo-list"]', { timeout: 15000 });
    await p.waitForTimeout(300);
    const m = await p.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.todo-row')), main = document.querySelector('.main');
      return { dsw: document.documentElement.scrollWidth, iw: innerWidth, msw: main.scrollWidth, mcw: main.clientWidth,
        btns: Array.from(document.querySelectorAll('.todo-go')).map((b) => { const r = b.getBoundingClientRect(), w = b.closest('.todo-row').querySelector('.todo-words').getBoundingClientRect(); return { h: Math.round(r.height), l: Math.round(r.left), r: Math.round(r.right), under: r.top >= w.bottom - 1 }; }),
        rowsIn: rows.every((r) => r.getBoundingClientRect().right <= innerWidth + 1) };
    });
    ok(m.dsw === 390 && m.msw <= m.mcw, 'at 390 px nothing scrolls sideways (' + m.dsw + ', ' + m.msw + '/' + m.mcw + ')');
    ok(m.btns.length === SEVERAL.length && m.btns.every((x) => x.h >= 44 && x.l >= 0 && x.r <= 390 && x.under) && m.rowsIn, 'every button is whole, at least 44 px tall and under its sentence; every row is inside the screen (' + m.btns.map((x) => x.h).join(',') + ')');
    await p.screenshot({ path: path.join(SHOTS, 'todo-home-phone.png') });
    await ctx.close();
  }

  ok(offHost.filter((u) => !/fonts\.g/.test(u)).length === 0, 'nothing but the stand-in was reachable' + (offHost.length ? ' — refused: ' + offHost.join(' ') : ''));
  await b.close(); srv.close();
  ok(...C.finish());
  console.log('\n  todo-home: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  XX  the harness stopped: ' + e.message); process.exit(1); });

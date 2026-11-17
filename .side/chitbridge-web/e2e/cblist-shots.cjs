#!/usr/bin/env node
/* cblist-shots.cjs — THE REAL SCREENS ON CBList, SEEN: Task · Customers (app.html) and Day book · Dues (CB Accounts), laptop and phone.
 * Not a proof of the unit (that is list-unit.cjs on the lab): a smoke test that the pages which MOUNT it actually do — no page error, the
 * unit is there, its header has a resize handle, the rows area fills the window, the head is within its share — and the pictures to look at.
 * The stand-in API is books-web.cjs's own (required, not copied); the Task list's inbox is stubbed here. Nothing reaches a server.
 * Screenshots: e2e/shots/cblist-{task,customers,daybook,dues}-{laptop,phone}.png
 * Run one at a time:  NODE_PATH=e2e/node_modules node e2e/cblist-shots.cjs                                                            */
'use strict';
const { chromium } = require('@playwright/test');
const path = require('path'), fs = require('fs');
const { standIn, route } = require('./books-web.cjs');
const { serve, PUBLIC } = require('./lib/serve.cjs');
const SHOTS = path.join(__dirname, 'shots');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const J = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });

/* a Task list the way /api/chits/inbox sends it */
const WHO = ['Ravi Stores', 'Meena Traders', 'Kumar Spares', 'Lakshmi Hardware', 'Senthil Auto', 'Tally Test Shop'];
const STATUS = ['pending', 'delivered', 'accepted', 'in_progress', 'completed', 'pending', 'read', 'accepted'];
const CHITS = Array.from({ length: 18 }, (_, i) => ({
  chit_id: 'task-' + i, created_at: new Date(Date.UTC(2026, 8, 1 + i, 9 + (i % 5), 10)).toISOString(), purpose: i % 4 === 0 ? 'order' : 'quote', role: 'Receiver',
  manual_subject: ['Brake pads and oil filters', 'Monthly wiper blade order', 'Spark plugs, 40 nos', 'Clutch plate set', 'Battery 12V 65Ah', 'Coolant 20 L'][i % 6] + ' · ' + (i + 1),
  current_status: STATUS[i % STATUS.length], priority_flag: i % 7 === 0 ? 'urgent' : 'normal', read_at: i % 3 === 0 ? null : '2026-09-30T10:00:00Z', message_count: i % 4, star_flag: i % 5 === 0,
  summary_json: { total_value: 1800 + i * 735, currency_code: 'INR', line_item_count: 1 + (i % 4), money: { total: (1800 + i * 735) * 1.12, tax: (1800 + i * 735) * 0.12 } },
  all_recipients: [{ role: 'sender', display_name: WHO[i % WHO.length] }, { role: 'receiver', display_name: 'Books Shop' }],
}));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = standIn(), web = await serve(PUBLIC), b = await chromium.launch(), errs = [];
  const open = async (vw, vh, hash) => {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => { if (new URL(r.request().url()).pathname === '/api/chits/inbox') return J(r, 200, { chits: CHITS, total: CHITS.length, page: 1, limit: 50 }); return route(S, r); });
    await ctx.addInitScript(() => { try {
      const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const tok = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-books', identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x';
      localStorage.setItem('cb_sess', JSON.stringify({ token: tok, role: 'entity', name: 'Books Shop' })); } catch (_) {} });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(String(e.message)));
    await p.goto(web.url(hash));
    return { ctx, p };
  };
  const mounted = (p, sel) => p.evaluate((s) => {
    const el = document.querySelector(s); if (!el || !el.classList.contains('cbl')) return null;
    const list = el.querySelector('.cbl-list'), hdr = el.querySelector('.cbl-hdr'), hh = hdr && getComputedStyle(hdr).display !== 'none' ? hdr.offsetHeight : 0;
    return { hdr: !!hdr, handles: el.querySelectorAll('.cbl-rz').length, headPct: Math.round(((list.getBoundingClientRect().top - el.getBoundingClientRect().top) + hh) / window.innerHeight * 1000) / 10,
      bottom: Math.round(el.getBoundingClientRect().bottom), vh: window.innerHeight, rows: el.querySelectorAll('.cbl-row,.cbl-lrec').length, sideways: document.documentElement.scrollWidth > window.innerWidth + 1 };
  }, sel);

  for (const [dev, vw, vh] of [['laptop', 1366, 768], ['phone', 390, 844]]) {
    console.log('\n== ' + dev + ' ' + vw + '×' + vh + ' ==');
    /* app.html: Task, then Customers */
    {
      const { ctx, p } = await open(vw, vh, '/app.html#/app');
      await p.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 }).catch(() => {});
      await p.waitForSelector('#rows .cbl-row', { timeout: 15000 }).catch(() => {});
      const t = await mounted(p, '#rows');
      ok(!!t && t.rows > 0, dev + ' · Task: #rows is a CBList mount with ' + (t && t.rows) + ' rows');
      if (t) { ok(t.hdr || vw < 620, dev + ' · Task: ' + (t.hdr ? 'a column header with ' + t.handles + ' resize handles' : 'cards (no header on a phone)')); ok(!t.sideways, dev + ' · Task: no sideways page scroll'); }
      await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(SHOTS, 'cblist-task-' + dev + '.png') });
      await p.locator('#panel .list').screenshot({ path: path.join(SHOTS, 'cblist-task-' + dev + '-pane.png') }).catch(() => {});
      if (t && vw > 620) {
        await p.click('[data-testid="view-lines-task"]'); await p.waitForTimeout(150);
        ok(await p.locator('#rows .cbl-lrec').count() > 0, dev + ' · Task gains ▤ / ☰: lines view draws ' + await p.locator('#rows .cbl-lrec').count() + ' records');
        await p.click('[data-testid="view-grid-task"]');
      }
      if (t && vw > 620) {
        /* select-many: the unit draws the lead column; the page owns what a tick means */
        await p.evaluate(() => { UI.selectMode = true; paintRowsOnly(); }); await p.waitForTimeout(150);
        ok(await p.locator('#rows .cbl-row .cbx').count() > 0 && await p.locator('#rows .cbl-hdr [role=columnheader]').count() >= 4, dev + ' · Task: select mode adds a tick column the page draws (' + await p.locator('#rows .cbl-row .cbx').count() + ' ticks)');
        await p.evaluate(() => { UI.selectMode = false; paintRowsOnly(); });
        /* sorting by a heading is the SERVER's: a click on Date asks for it */
        const asked = await p.evaluate(() => { let q = null; const was = window.loadList; window.loadList = function () { q = { sort: UI.sort, dir: UI.dir }; }; document.querySelector('#rows .cbl-hdr [data-sort="date"]').click(); window.loadList = was; return q; });
        ok(asked && asked.sort === 'date', dev + ' · Task: a click on the Date heading asks the server to sort by it (' + JSON.stringify(asked) + ')');
      }
      if (vw <= 620) { await p.evaluate(() => { try { UI.mdetail = false; } catch (_) {} }); }
      await p.evaluate(() => navTo('customers'));
      await p.waitForSelector('[data-testid="cust-row-c1"]', { timeout: 15000 }).catch(() => {});
      await p.waitForTimeout(500);
      const c = await mounted(p, '#tbl_customers');
      ok(!!c && c.rows >= 2, dev + ' · Customers: #tbl_customers is a CBList mount with ' + (c && c.rows) + ' rows');
      if (c) { ok(c.handles >= 2 || vw < 620, dev + ' · Customers: header with resize handles (' + c.handles + ')'); ok(!c.sideways, dev + ' · Customers: no sideways page scroll'); }
      await p.screenshot({ path: path.join(SHOTS, 'cblist-customers-' + dev + '.png') });
      /* Suppliers: the same CRM columns, our own shelf above the table */
      await p.evaluate(() => navTo('suppliers'));
      await p.waitForSelector('[data-testid="sup-row-sl1"]', { timeout: 15000 }).catch(() => {});
      const sp = await mounted(p, '#tbl_suppliers');
      ok(!!sp && sp.rows >= 1, dev + ' · Suppliers: #tbl_suppliers is a CBList mount with ' + (sp && sp.rows) + ' row(s)');
      /* Platform: its table is a CBList mount over its own server pager (painted straight, there is no operator session here) */
      const pl = await p.evaluate(() => {
        try {
          UI.platSort = { sort: 'name', dir: 'asc' };
          UI.plat = { rows: [1, 2, 3].map((i) => ({ identity_id: 'e' + i, display_name: 'Shop ' + i, user_id: 'shop' + i, entity_kind: 'business', plan: 'plus', seats: i, last_seen: null })), matched: 250, controls: { sortable: ['name', 'handle'], applied: {} } };
          const host = document.createElement('div'); host.id = 'pl_rows'; host.style.height = '420px'; document.body.appendChild(host);
          platTablePaint(host, platTableOpts());
          const el = document.getElementById('pl_table_host');
          return { mounted: !!(el && el.classList.contains('cbl')), rows: el.querySelectorAll('.cbl-row').length, heads: el.querySelectorAll('[role=columnheader]').length, sortable: el.querySelectorAll('[data-sort]').length, foot: !!el.querySelector('.cbl-foot'), count: el.querySelector('.cbl-count').textContent.trim(), oldChooser: !!document.querySelector('[data-testid="plat-cols"],[data-testid="plat-colmenu"]') };
        } catch (e) { return { err: String(e.message) }; }
      });
      ok(pl && pl.mounted && pl.rows === 3 && pl.heads >= 3 && pl.sortable === 2 && pl.foot && !pl.oldChooser, dev + ' · Platform: the server-paged table is a CBList mount (' + JSON.stringify(pl) + ')');
      await ctx.close();
    }
    /* accounts.html: Day book, then Dues */
    {
      const { ctx, p } = await open(vw, vh, '/accounts.html#daybook');
      await p.waitForSelector('[data-testid^="db-entry-"]', { timeout: 20000 }).catch(() => {});
      await p.waitForTimeout(400);
      const d = await mounted(p, '#bk_dvlist');
      ok(!!d && d.rows > 0, dev + ' · Day book: #bk_dvlist is a CBList mount with ' + (d && d.rows) + ' records');
      if (d) { ok(d.headPct <= (vw <= 640 ? 30 : 20), dev + ' · Day book: the head is ' + d.headPct + '% of the window (limit ' + (vw <= 640 ? 30 : 20) + '%)'); ok(Math.abs(d.bottom - d.vh) <= 12, dev + ' · Day book: the rows area fills the window (bottom ' + d.bottom + ' of ' + d.vh + ')'); ok(!d.sideways, dev + ' · Day book: no sideways page scroll'); }
      await p.screenshot({ path: path.join(SHOTS, 'cblist-daybook-' + dev + '.png') });
      await p.click('[data-testid="acc-nav-receivables"]');
      await p.waitForSelector('[data-testid="dues-c1"]', { timeout: 15000 }).catch(() => {});
      await p.waitForTimeout(300);
      const u = await mounted(p, '#bkl_dues');
      ok(!!u && u.rows > 0, dev + ' · Dues: #bkl_dues is a CBList mount with ' + (u && u.rows) + ' rows');
      if (u) { ok(u.headPct <= (vw <= 640 ? 30 : 20), dev + ' · Dues: the head is ' + u.headPct + '% of the window'); ok(!u.sideways, dev + ' · Dues: no sideways page scroll'); }
      await p.screenshot({ path: path.join(SHOTS, 'cblist-dues-' + dev + '.png') });
      await ctx.close();
    }
  }
  ok(errs.length === 0, 'no page error on any screen' + (errs.length ? ': ' + errs.slice(0, 4).join(' | ').slice(0, 400) : ''));
  await b.close(); web.close();
  console.log('\n  cblist-shots: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

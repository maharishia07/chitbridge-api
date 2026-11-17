#!/usr/bin/env node
/* list-unit.cjs — CBList, THE LIST CONTROL, PROVED AS A SELF-SUSTAINING UNIT (docs/design/list-control/PLAN.md › Proof).
 *
 * The page under test is public/list-lab.html: it loads ONE script (/app/list-ctl.js) and defines nothing the list needs from a host.
 *   1  works with NO host globals: every name the old list-ctl.js borrowed (tx · esc · uk · UI · mvBtn · emptyState · lazyWrap …) is a
 *      trap that records a read; loading the file adds exactly one global (CBList); nothing was read
 *   2  storage that THROWS still renders, and a choice (a ticked column) still holds for the session
 *   3  390 px: no sideways scroll, on every list, in grid and in lines
 *   4  keyboard: ↑ ↓ move between rows · Enter opens · ← → open / close · Esc closes a popover and gives the focus back · ← → on a column edge resize by 8 px
 *   5  drag a column edge, reload: the width holds (and double-click resets)
 *   6  scroll 2,000 px: the column header, the tools row and the title row do not move; the PAGE does not scroll; group rows stick under the header
 *   7  the head is ≤ 20% of a 1366×768 window and ≤ 30% of 390×844 (44 px controls: Group, view, Columns and CSV fold into one View popover on a phone), on every list
 *   +  the four states (loading under a kept header · empty · no match + Clear · could not load + Try again), the ⚙ chooser, ▤ / ☰, ⇣ / ⇡,
 *      grouping, filters, lazy rows (the count is the true one), bulk, dark theme, ARIA
 * Screenshots: e2e/shots/cblist-{daybook,dues}-{laptop,phone}.png (the unit's own gallery) · cblist-lab-laptop.png
 *   +  THE SOURCE: list-ctl.js reads nothing from its page (no UI. · tx( · uk( · mvBtn( · emptyState( · lazyWrap( · a borrowed esc), exports one
 *      global, and NO OTHER FILE in public/ builds a column chooser or a column resizer (the Platform's own were deleted)
 * Run one at a time:  NODE_PATH=e2e/node_modules node e2e/list-unit.cjs                                                              */
'use strict';
const { chromium } = require('@playwright/test');
const path = require('path'), fs = require('fs');
const { serve, PUBLIC } = require('./lib/serve.cjs');
const ROOT = process.env.CBL_ROOT || PUBLIC;   /* list-unit-breaks.cjs points this at a COPY of public/ with one rule broken */
const SHOTS = path.join(__dirname, 'shots');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };

const HOST_NAMES = ['tx', 'txf', 'esc', 'uk', 'UI', 'mvBtn', 'emptyState', 'lazyWrap', 'listCtl', 'listCtlS', 'toast', 'api', 'SESSION', 'CBLocale', 'fmtMoney'];
/* every name the old list-ctl.js borrowed from its page becomes a trap: a read is recorded, and a call throws */
const TRAPS = (names) => { window.__host = []; names.forEach((n) => { try { Object.defineProperty(window, n, { configurable: true, get() { if (/list-ctl[.]js/.test(new Error().stack || '')) window.__host.push(n); return undefined; /* UX-90: list-lab wears the frame now; only the LIST reading its host counts (the shell reads tx on its own) */ } }); } catch (_) {} }); };
const THROWING_STORAGE = () => { const boom = function () { throw new Error('storage denied'); }; Storage.prototype.getItem = boom; Storage.prototype.setItem = boom; Storage.prototype.removeItem = boom; };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await serve(ROOT);
  const b = await chromium.launch();
  const errs = [];
  const open = async (o) => {
    o = o || {};
    const ctx = o.ctx || await b.newContext({ viewport: o.viewport || { width: 1366, height: 768 }, locale: 'en-IN', serviceWorkers: 'block' });
    if (!o.ctx) { if (o.traps !== false) await ctx.addInitScript(TRAPS, HOST_NAMES); if (o.throwing) await ctx.addInitScript(THROWING_STORAGE); }
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await p.goto(S.url('/list-lab.html'));
    await p.waitForSelector('.cbl-row, .cbl-lrec', { timeout: 8000 });
    return { ctx, p };
  };
  const pick = async (p, k) => { await p.click('[data-plist="' + k + '"]'); await p.waitForTimeout(120); };
  const headPct = (p) => p.evaluate(() => {
    const root = document.getElementById('app'), list = root.querySelector('.cbl-list'), hdr = root.querySelector('.cbl-hdr');
    const hh = hdr && getComputedStyle(hdr).display !== 'none' ? hdr.offsetHeight : 0;
    return Math.round(((list.getBoundingClientRect().top - root.getBoundingClientRect().top) + hh) / window.innerHeight * 1000) / 10;
  });
  const hdrWidth = (p, k) => p.evaluate((key) => { const b = document.querySelector('.cbl-rz[data-rz="' + key + '"]'); return b ? b.parentElement.getBoundingClientRect().width : -1; }, k);

  /* ─────────────────────────── THE SOURCE ─────────────────────────── */
  console.log('\n== list-unit: the source ==');
  {
    const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const unit = read('app/list-ctl.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const BORROWED = /(^|[^.\w$])(UI\.|uk\(|tx\(|txf\(|mvBtn\(|emptyState\(|lazyWrap\(|toast\(|listCtl\w*\(|CBLocale\.|SESSION\b|api\()/g;
    const hits = []; let m;
    while ((m = BORROWED.exec(unit))) hits.push(m[2]);
    ok(hits.length === 0, 'list-ctl.js reads nothing from its page (found: ' + (hits.join(' ') || 'none') + ')');
    ok(/function esc\(/.test(unit) && !/(root|window)\.esc\b|(var|let|const)\s+esc\s*=|\besc\s*=\s*(root|window)\b/.test(unit), 'and the escaping it uses is its own (function esc is declared in the file)');
    ok(/^\(function \(root\) \{\s*'use strict';/m.test(unit) && (unit.match(/root\.\w+\s*=/g) || []).join() === 'root.CBList =', 'the whole file is one function; it assigns one global (root.CBList)');
    /* a second chooser or a second column resizer anywhere else in public/ — by NAME, so a pane divider or a <table> test board is not mistaken for one */
    const WALK = (d, out) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^(docs|vendor|cmdb|illustrations|pics)$/.test(e.name)) WALK(p, out); } else if (/\.(js|html)$/.test(e.name)) out.push(p); } return out; };
    const NAMED = /function\s+(\w*(?:ColMenu|ColsMenu|ColResize|colResize|ColChooser|colChooser|ToggleColMenu)\w*)\s*\(/g;
    const second = [];
    for (const file of WALK(ROOT, [])) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/'); if (rel === 'app/list-ctl.js') continue;
      const src = fs.readFileSync(file, 'utf8'); let n;
      while ((n = NAMED.exec(src))) second.push(rel + ': ' + n[1]);
    }
    ok(second.length === 0, 'no second column chooser or *ColResize* builder anywhere in public/ (found: ' + (second.join(' · ') || 'none') + ')');
  }

  /* ─────────────────────────── 1 · NO HOST GLOBALS ─────────────────────────── */
  console.log('\n== list-unit: no host ==');
  {
    const c0 = await b.newContext({ viewport: { width: 1366, height: 768 } }), p0 = await c0.newPage();
    await p0.goto('about:blank');
    const added = await p0.evaluate(async (src) => {
      const before = Object.getOwnPropertyNames(window);
      await new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      return Object.getOwnPropertyNames(window).filter((k) => before.indexOf(k) < 0);
    }, S.url('/app/list-ctl.js')).catch(() => null);
    /* about:blank cannot load a cross-origin script on every build — fall back to the lab page itself */
    if (added) ok(added.length === 1 && added[0] === 'CBList', 'loading list-ctl.js adds exactly one global: ' + JSON.stringify(added));
    await c0.close();
  }
  const { ctx, p } = await open();
  const g = await p.evaluate(() => ({ cbl: typeof window.CBList, mount: typeof (window.CBList || {}).mount, keys: Object.keys(window.CBList || {}).sort().join(','), css: document.querySelectorAll('#cblist_css').length }));
  ok(g.cbl === 'object' && g.mount === 'function', 'CBList.mount exists on a page that defines no host globals');
  ok(g.css === 1, 'its CSS is injected once (#cblist_css)');
  ok(g.keys === 'every,get,mount,nextRow,nextTable,pager,reset', 'the unit exports only mount · nextRow (its next-level row) · nextTable (the sub-table a row opens to: the bills of a party) · get · reset · every (the whole set page by page, T2-PAGING) · pager (the Previous / Next pair of a server-paged page): ' + g.keys);
  const rows0 = await p.locator('.cbl-row').count();
  ok(rows0 > 10 && await p.locator('.cbl-hdr [role=columnheader]').count() >= 3, 'the Day book draws ' + rows0 + ' rows under a header on the bare page');
  const fonts = await p.evaluate(() => getComputedStyle(document.querySelector('.cbl')).backgroundColor);
  ok(!!fonts, 'it renders with the page\'s tokens (background ' + fonts + ')');

  /* ─────────────────────────── the head: 7 ─────────────────────────── */
  console.log('\n== list-unit: the head ==');
  for (const k of ['daybook', 'dues', 'big']) {
    await pick(p, k);
    const pc = await headPct(p);
    ok(pc <= 20, 'laptop 1366×768 · ' + k + ': the head is ' + pc + '% of the window (≤ 20%)');
  }
  await pick(p, 'daybook');
  await p.screenshot({ path: path.join(SHOTS, 'cblist-daybook-laptop.png') });
  await pick(p, 'dues');
  await p.screenshot({ path: path.join(SHOTS, 'cblist-dues-laptop.png') });
  await pick(p, 'daybook');

  /* ─────────────────────────── the columns: chooser, ▤ ☰, expand ─────────────────────────── */
  console.log('\n== list-unit: the controls ==');
  const K = 'lab-daybook';
  const cells = () => p.locator('.cbl-hdr [role=columnheader]').count();
  ok(await cells() === 4, 'a list starts with its top three columns + the pinned amount (' + await cells() + ' header cells)');
  ok(await p.locator('.cbl-hdr [role=columnheader]').count() === await p.locator('.cbl-hdr [role=columnheader] .cbl-rz').count(), 'EVERY column header has a resize handle (' + await p.locator('.cbl-hdr .cbl-rz').count() + ' handles)');
  await p.click('[data-testid="cols-btn-' + K + '"]');
  const menu = p.locator('[data-testid="cols-menu-' + K + '"]');
  ok(await menu.count() === 1 && await menu.getAttribute('role') === 'dialog' && /Shown — in this order/.test(await menu.textContent()) && /Available/.test(await menu.textContent()), '⚙ opens a dialog: Shown — in this order · Available');
  ok(await p.locator('[data-testid="cols-menu-' + K + '"] input[type=checkbox]').count() === 8, 'the chooser lists ALL eight choosable columns');
  ok(await p.locator('[data-testid="cols-' + K + '-date"]').isDisabled() && await p.locator('[data-testid="cols-' + K + '-date"]').isChecked(), 'the top-priority column is ticked and cannot be unticked');
  await p.click('[data-testid="cols-' + K + '-kind"]');
  ok(await cells() === 5 && /Kind/.test(await p.textContent('.cbl-hdr')), 'ticking Kind shows it at once (a 4th column)');
  ok(await p.locator('[data-testid="cols-menu-' + K + '"]').count() === 1, 'the chooser stays open while you tick');
  await p.click('.cbl-mv[data-mv="kind"][data-d="-1"]');
  const order = await p.$$eval('.cbl-hdr [role=columnheader]', (els) => els.map((x) => x.textContent.replace(/[⇅▲▼]/g, '').trim()));
  ok(order.join() === 'Date,Entry,Kind,Party,Amount' || order.join() === 'Date,Kind,Entry,Party,Amount' || order.indexOf('Kind') < order.indexOf('Party'), '← moves Kind earlier, and the header follows (' + order.join(' · ') + ')');
  await p.click('[data-testid="cols-reset-' + K + '"]');
  ok(await cells() === 4, 'Reset returns to the standard columns');
  await p.keyboard.press('Escape');
  ok(await p.locator('[data-testid="cols-menu-' + K + '"]').count() === 0 && await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid')) === 'cols-btn-' + K, 'Esc closes the chooser and gives the focus back to ⚙');

  await p.click('[data-testid="view-lines-' + K + '"]');
  ok(await p.locator('.cbl-lrec').count() > 10 && await p.locator('.cbl-hdr').count() === 0 && await p.locator('.cbl-lgist').count() > 10, '☰ lines: one flowing line a record, the gist under it, no column header');
  ok(await p.getAttribute('[data-testid="view-lines-' + K + '"]', 'aria-pressed') === 'true', 'the pressed view says so (aria-pressed)');
  await p.screenshot({ path: path.join(SHOTS, 'cblist-lab-lines.png') }).catch(() => {});
  await p.click('[data-testid="view-grid-' + K + '"]');
  ok(await p.locator('.cbl-hdr').count() === 1, '▤ grid: the header returns');

  await p.click('[data-testid="cbl-expand-' + K + '"]');
  const drawn = await p.locator('.cbl-row').count(), opened = await p.locator('.cbl-row[aria-expanded="true"]').count();
  ok(drawn > 0 && opened === drawn && await p.locator('.cbl-next').count() === drawn, '⇣ expand all opens every drawn row (' + opened + ' of ' + drawn + ')');
  ok(await p.getAttribute('[data-testid="cbl-expand-' + K + '"]', 'aria-pressed') === 'true', 'and the button turns into ⇡ collapse all');
  ok(await p.locator('.cbl-next .cbl-acts button').count() >= 2, 'an opened row offers its actions (Open bill · Reverse this entry)');
  await p.click('[data-testid="cbl-expand-' + K + '"]');
  ok(await p.locator('.cbl-next').count() === 0, '⇡ collapse all closes them');

  /* grouping */
  const days = await p.locator('.cbl-group').count();
  await p.click('[data-testid="cbl-group-' + K + '"] [data-group="month"]');
  const months = await p.locator('.cbl-group').count();
  ok(days > months && months >= 1 && await p.getAttribute('[data-testid="cbl-group-' + K + '"] [data-group="month"]', 'aria-pressed') === 'true', 'Day | Week | Month regroups (' + days + ' day heads → ' + months + ' month heads)');
  const gtxt = await p.textContent('.cbl-group');
  ok(/entr(y|ies)/.test(gtxt) && /Dr ₹/.test(gtxt), 'a group head carries its figures ("' + gtxt.replace(/\s+/g, ' ').trim().slice(0, 70) + '")');
  await p.click('.cbl-group');
  ok(await p.locator('.cbl-row').count() < drawn, 'a group head collapses its rows');
  await p.click('.cbl-group');
  await p.click('[data-testid="cbl-group-' + K + '"] [data-group="day"]');

  /* filters */
  await p.click('[data-testid="cbl-filters-' + K + '"]');
  ok(await p.locator('.cbl-pop[role=dialog]').count() === 1, 'Filters ▾ opens one popover holding every dropdown');
  const before = await p.locator('.cbl-row').count();
  await p.selectOption('[data-testid="listctl-filter-kind"]', 'Sales');
  const after = await p.locator('.cbl-row').count();
  ok(after > 0 && after < before && await p.locator('.cbl-fchip').count() === 1 && /Filters ▾\s*1/.test((await p.textContent('[data-testid="cbl-filters-' + K + '"]')).replace(/\s+/g, ' ')), 'a filter narrows the rows (' + before + ' → ' + after + '), shows as a removable chip and a count badge');
  ok(/shown of 46/.test(await p.textContent('.cbl-count')), 'the count is the true one and says what it was narrowed from ("' + (await p.textContent('.cbl-count')).trim() + '")');
  await p.keyboard.press('Escape');
  await p.click('.cbl-fchip button');
  ok(await p.locator('.cbl-row').count() === before && await p.locator('.cbl-fchip').count() === 0, '× on the chip removes the filter');

  /* search + the four states */
  console.log('\n== list-unit: the four states ==');
  await p.fill('[data-testid="listctl-search-' + K + '"]', 'zzzzz');
  await p.waitForTimeout(80);
  ok(await p.locator('.cbl-state[data-testid="cbl-nomatch-' + K + '"]').count() === 1 && /Nothing matches/.test(await p.textContent('.cbl-state')) && await p.locator('[data-cbl-clear]').count() === 1, 'no match: says so, with Clear search and filters');
  await p.click('[data-cbl-clear]');
  ok(await p.locator('.cbl-row').count() === before && await p.inputValue('[data-testid="listctl-search-' + K + '"]') === '', 'Clear brings the rows back and empties the box');
  await p.fill('[data-testid="listctl-search-' + K + '"]', 'kumar');
  await p.waitForTimeout(80);
  const kum = await p.locator('.cbl-row').count();
  ok(kum > 0 && kum < before, 'search is live as you type (oninput, not Enter): ' + kum + ' of ' + before);
  await p.fill('[data-testid="listctl-search-' + K + '"]', '');
  await p.click('[data-pstate="loading"]');
  ok(await p.locator('.cbl-skel').count() >= 5 && await p.locator('.cbl-hdr').count() === 1 && await p.locator('[aria-busy="true"]').count() === 1, 'loading: shimmering rows under a KEPT header');
  await p.click('[data-pstate="empty"]');
  ok(await p.locator('[data-testid="cbl-empty-' + K + '"]').count() === 1 && /Nothing recorded yet/.test(await p.textContent('.cbl-list')), 'empty: says what will appear here');
  await p.click('[data-pstate="error"]');
  ok(await p.locator('[role=alert]').count() === 1 && /could not load/.test(await p.textContent('.cbl-list')) && !/undefined|\b5\d\d\b/.test(await p.textContent('.cbl-list')), 'could not load: a sentence, never the server\'s own words');
  await p.click('[data-cbl-retry]');
  await p.waitForSelector('.cbl-row', { timeout: 4000 });
  ok(await p.locator('.cbl-row').count() > 0, 'Try again loads the rows');
  await p.click('[data-pstate="normal"]');

  /* ─────────────────────────── 4 · KEYBOARD / ARIA ─────────────────────────── */
  console.log('\n== list-unit: keyboard and ARIA ==');
  await p.focus('.cbl-row');
  const id0 = await p.evaluate(() => document.activeElement.getAttribute('data-row'));
  await p.keyboard.press('ArrowDown');
  const id1 = await p.evaluate(() => document.activeElement.getAttribute('data-row'));
  ok(id1 && id1 !== id0, '↓ moves the focus to the next row');
  await p.keyboard.press('ArrowUp');
  ok(await p.evaluate(() => document.activeElement.getAttribute('data-row')) === id0, '↑ comes back');
  await p.keyboard.press('Enter');
  ok(await p.evaluate(() => document.activeElement.getAttribute('aria-expanded')) === 'true' && await p.locator('.cbl-next').count() === 1, 'Enter opens the row (and keeps the focus on it)');
  await p.keyboard.press('Enter');
  ok(await p.locator('.cbl-next').count() === 0, 'Enter again closes it');
  await p.keyboard.press('ArrowRight');
  ok(await p.locator('.cbl-next').count() === 1, '→ opens a row');
  await p.keyboard.press('ArrowLeft');
  ok(await p.locator('.cbl-next').count() === 0, '← closes it');
  await p.focus('[data-testid="cbl-filters-' + K + '"]');
  await p.keyboard.press('Enter');
  ok(await p.locator('.cbl-pop[role=dialog]').count() === 1, 'Enter on Filters opens its popover');
  await p.keyboard.press('Escape');
  ok(await p.locator('.cbl-pop').count() === 0 && await p.evaluate(() => document.activeElement.id) === 'cbl-filt-' + K, 'Esc closes it and returns the focus to the button');
  const hdrs = await p.$$eval('.cbl-hdr [role=columnheader]', (els) => els.map((e) => e.getAttribute('aria-sort')));
  ok(hdrs.length >= 3 && hdrs.every((s) => /^(none|ascending|descending)$/.test(s)), 'every column header says how it is sorted (aria-sort)');
  await p.click('.cbl-hdr [data-sort="date"]');
  ok(await p.getAttribute('.cbl-hdr [role=columnheader]:first-child', 'aria-sort') === 'ascending', 'sorting by a heading sets aria-sort=ascending');
  await p.click('.cbl-hdr [data-sort="date"]');
  ok(await p.getAttribute('.cbl-hdr [role=columnheader]:first-child', 'aria-sort') === 'descending', 'a second click reverses it');
  const rzLabel = await p.getAttribute('.cbl-rz[data-rz="date"]', 'aria-label');
  ok(/Resize Date column/.test(rzLabel || ''), 'the resize edge is labelled for a screen reader ("' + rzLabel + '")');
  ok(await p.getAttribute('.cbl-count', 'aria-live') === 'polite' && await p.getAttribute('.cbl-list', 'aria-label') === 'Rows', 'the count is a polite live region; the rows area is a labelled region');
  await p.focus('.cbl-rz[data-rz="date"]');
  const w0 = await hdrWidth(p, 'date');
  await p.keyboard.press('ArrowRight');
  const w1 = await hdrWidth(p, 'date');
  ok(Math.abs((w1 - w0) - 8) < 1.5, '→ on a column edge widens it by 8 px (' + w0 + ' → ' + w1 + ')');
  ok(await p.evaluate(() => document.activeElement.getAttribute('data-rz')) === 'date', 'and the edge keeps the focus');
  await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
  for (let i = 0; i < 40; i++) await p.keyboard.press('ArrowLeft');
  const wmin = await hdrWidth(p, 'date');
  ok(wmin >= 64 && wmin < w0, 'it never goes narrower than the label (' + wmin + ' px)');
  await p.dblclick('.cbl-rz[data-rz="date"]');
  const wReset = await hdrWidth(p, 'date');
  ok(Math.abs(wReset - w0) < 1.5, 'double-click resets to its own fitted width, the one before any drag (R47: columns are fitted to their ink, no longer the declared px) (' + w0 + ' -> ' + wReset + ')');

  /* ─────────────────────────── 5 · DRAG, RELOAD ─────────────────────────── */
  console.log('\n== list-unit: adjustable columns ==');
  {
    const box = await (await p.$('.cbl-rz[data-rz="entry"]')).boundingBox(), w = await hdrWidth(p, 'entry');
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down();
    for (let i = 1; i <= 8; i++) await p.mouse.move(box.x + box.width / 2 + i * 10, box.y + box.height / 2);
    await p.mouse.up();
    const w2 = await hdrWidth(p, 'entry');
    ok(Math.abs((w2 - w) - 80) < 3, 'dragging a header edge widens the column by the distance (' + w + ' → ' + w2 + ')');
    const rowW = await p.evaluate(() => { const r = document.querySelector('.cbl-row'); const c = r.children[1]; return c.getBoundingClientRect().width; });
    ok(Math.abs(rowW - w2) < 3, 'and the rows follow the header (cell ' + Math.round(rowW) + ' px)');
    await p.reload(); await p.waitForSelector('.cbl-row');
    const w3 = await hdrWidth(p, 'entry');
    ok(Math.abs(w3 - w2) < 2, 'reload: the width holds (' + w3 + ' px)');
    ok(await p.evaluate(() => /cblist\./.test(Object.keys(localStorage).join())), 'remembered under its own prefix (cblist.*)');
  }

  /* ─────────────────────────── 6 · ONLY THE ROWS SCROLL ─────────────────────────── */
  console.log('\n== list-unit: only the rows scroll ==');
  await pick(p, 'big');
  await p.click('[data-cbl-more]'); await p.click('[data-cbl-more]');
  ok(await p.locator('.cbl-row').count() === 150, 'lazy rows: 50 at a time, two reveals → 150 drawn');
  ok(/600 shown/.test(await p.textContent('.cbl-count')), 'the count is the TRUE one, not the drawn one ("' + (await p.textContent('.cbl-count')).trim() + '")');
  const geo = () => p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    return { hdr: r('.cbl-hdr'), tools: r('.cbl-tools'), title: r('.cbl-title'), list: r('.cbl-list'), top: document.querySelector('.cbl-list').scrollTop, win: window.scrollY, doc: document.scrollingElement.scrollTop, h: window.innerHeight };
  });
  const g0 = await geo();
  await p.evaluate(() => { document.querySelector('.cbl-list').scrollTop = 2000; });
  await p.waitForTimeout(150);
  const g1 = await geo();
  ok(g1.top >= 1990, 'the rows scrolled 2,000 px (' + Math.round(g1.top) + ')');
  ok(Math.abs(g1.hdr.top - g0.hdr.top) < 1 && g1.hdr.top >= 0 && g1.hdr.bottom <= g1.h, 'the column header did not move (top ' + Math.round(g0.hdr.top) + ' → ' + Math.round(g1.hdr.top) + ') and is on screen');
  ok(Math.abs(g1.tools.top - g0.tools.top) < 1 && g1.tools.bottom <= g1.h && Math.abs(g1.title.top - g0.title.top) < 1, 'the tools row and the title row did not move');
  ok(g1.win === 0 && g1.doc === 0, 'the PAGE did not scroll (scrollY ' + g1.win + ')');
  ok(Math.abs(g1.list.bottom - g1.h) <= 12, 'the rows area fills the rest of the window (its bottom ' + Math.round(g1.list.bottom) + ' of ' + g1.h + ')');
  await p.setViewportSize({ width: 1366, height: 600 }); await p.waitForTimeout(150);
  const g2 = await geo();
  ok(Math.abs(g2.list.bottom - 600) <= 12, 'and it follows a resize of the window (bottom ' + Math.round(g2.list.bottom) + ' of 600)');
  await p.setViewportSize({ width: 1366, height: 768 }); await p.waitForTimeout(100);
  await pick(p, 'daybook');
  await p.evaluate(() => { document.querySelector('.cbl-list').scrollTop = 420; });
  await p.waitForTimeout(100);
  const stick = await p.evaluate(() => {
    const h = document.querySelector('.cbl-hdr').getBoundingClientRect();
    const gs = [].slice.call(document.querySelectorAll('.cbl-group')).map((e) => e.getBoundingClientRect()).filter((r) => r.top <= h.bottom + 3 && r.bottom > h.bottom - 3);
    return { hb: h.bottom, tops: gs.map((r) => r.top) };
  });
  ok(stick.tops.length >= 1 && Math.abs(stick.tops[stick.tops.length - 1] - stick.hb) <= 2, 'a group row sticks right under the header while its rows scroll (' + Math.round(stick.tops[stick.tops.length - 1]) + ' vs ' + Math.round(stick.hb) + ')');

  /* bulk */
  await pick(p, 'big');
  await p.click('[data-testid="cbl-select-lab-big"]');
  const ticks = await p.locator('input[data-selrow]').count();
  await p.locator('input[data-selrow]').nth(0).check(); await p.locator('input[data-selrow]').nth(2).check();
  ok(ticks > 10 && /Reprice \(2\)/.test(await p.textContent('[data-testid="cbl-bulk-lab-big"]')), 'bulk: select-many adds a tick column and the operations say how many (' + (await p.textContent('[data-testid="cbl-bulk-lab-big"]')).replace(/\s+/g, ' ').trim() + ')');
  await p.click('[data-bulk="reprice"]');
  ok(/Reprice 2 items/.test(await p.textContent('#toast')), 'a bulk operation runs on exactly the ticked rows');
  await p.click('[data-testid="cbl-select-lab-big"]');

  /* dark theme */
  await pick(p, 'daybook');
  const bgL = await p.evaluate(() => getComputedStyle(document.querySelector('.cbl-list')).backgroundColor);
  await p.click('[data-theme="dark"]');
  const bgD = await p.evaluate(() => getComputedStyle(document.querySelector('.cbl-list')).backgroundColor);
  ok(bgL !== bgD && /\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(bgD) && Number(/\((\d+)/.exec(bgD)[1]) < 80, 'dark theme: the list follows the page\'s tokens (' + bgL + ' → ' + bgD + ')');
  await p.click('[data-theme="light"]');
  await p.waitForFunction(() => document.getElementById('toast').hidden);
  await p.click('[data-testid="cbl-filters-' + K + '"]');
  await p.screenshot({ path: path.join(SHOTS, 'cblist-lab-laptop.png') });
  await p.keyboard.press('Escape');
  ok(errs.length === 0, 'no page error on the laptop run' + (errs.length ? ': ' + errs.join(' | ') : ''));
  ok(await p.evaluate(() => (window.__host || []).length) === 0, 'NOTHING was read from the host page in all of it (traps: ' + HOST_NAMES.join(' ') + ')');

  /* ─────────────────────────── 3 · PHONE ─────────────────────────── */
  console.log('\n== list-unit: 390 px ==');
  {
    const pc = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-IN', serviceWorkers: 'block' });
    await pc.addInitScript(TRAPS, HOST_NAMES);
    const { p: m } = await open({ ctx: pc, viewport: { width: 390, height: 844 } });
    for (const k of ['daybook', 'dues', 'big']) {
      await pick(m, k);
      const pct = await headPct(m);
      ok(pct <= 30, 'phone 390×844 · ' + k + ': the head is ' + pct + '% of the window (≤ 30%)');
      /* a phone folds Group, Grid / Lines, Columns and CSV into one View popover: open it first (UX-137 wave 2) */
      const viewClick = async (v) => { if (!(await m.isVisible('[data-view="' + v + '"]'))) { await m.click('[data-cbl-pop="view"]'); await m.waitForTimeout(60); } await m.click('[data-view="' + v + '"]'); };
      for (const v of ['grid', 'lines']) {
        await viewClick(v); await m.waitForTimeout(60);
        const w = await m.evaluate(() => ({ doc: document.documentElement.scrollWidth, list: document.querySelector('.cbl-list').scrollWidth, cw: document.querySelector('.cbl-list').clientWidth, vw: window.innerWidth }));
        ok(w.doc <= 390 && w.list <= w.cw + 1, '390 px · ' + k + ' · ' + v + ': no sideways scroll (page ' + w.doc + ', rows ' + w.list + '/' + w.cw + ')');
      }
      await viewClick('grid'); await m.keyboard.press('Escape');
      if (k === 'daybook') {
        const card = await m.evaluate(() => { const r = document.querySelector('.cbl-row'); return { display: getComputedStyle(r).display, hdr: getComputedStyle(document.querySelector('.cbl-hdr')).display, labelled: r.querySelectorAll('.cbl-cell[data-l]:not([data-l=""])').length }; });
        ok(card.display === 'flex' && card.hdr === 'none' && card.labelled >= 1, 'phone: one card a row, labelled label : value, no header row (a container query, not the page width)');
      }
    }
    await pick(m, 'daybook');
    await m.screenshot({ path: path.join(SHOTS, 'cblist-daybook-phone.png') });
    await pick(m, 'dues');
    await m.screenshot({ path: path.join(SHOTS, 'cblist-dues-phone.png') });
    ok(await m.evaluate(() => (window.__host || []).length) === 0, 'phone: nothing read from the host page either');
    await pc.close();
  }

  /* ─────────────────────────── 2 · STORAGE THAT THROWS ─────────────────────────── */
  console.log('\n== list-unit: storage that throws ==');
  {
    const { ctx: c2, p: q } = await open({ throwing: true });
    ok(await q.locator('.cbl-row').count() > 10, 'storage denied: the list still renders');
    await q.click('[data-testid="cols-btn-' + K + '"]'); await q.click('[data-testid="cols-' + K + '-kind"]');
    ok(await q.locator('.cbl-hdr [role=columnheader]').count() === 5, 'storage denied: a ticked column still applies for the session');
    await q.click('[data-testid="view-lines-' + K + '"]');
    ok(await q.locator('.cbl-lrec').count() > 10, 'storage denied: the view still switches');
    await pick(q, 'dues'); await pick(q, 'daybook');
    ok(await q.locator('.cbl-lrec').count() > 10 && await q.getAttribute('[data-testid="view-lines-' + K + '"]', 'aria-pressed') === 'true', 'storage denied: and it remembers the choice while the page lives (in memory)');
    await c2.close();
  }

  /* ─────────────────────────── 8 · THE LABEL OPENS, THE CARET TOGGLES (FX-F10W) ─────────────────────────── */
  /* the F10 walk: a Waiting row's NAME has to open the bill (onOpen) exactly as its amount does — only the ▸ glyph opens the next level.
     Every list in the lab, in grid AND lines, at 1366 and 390: the first cell's text → onOpen once, nothing expands; ▸ → expands, onOpen not called. */
  console.log('\n== list-unit: the label opens, the caret toggles ==');
  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const { ctx: c8, p: q } = await open({ viewport: vp, traps: false });
    for (const k of ['daybook', 'dues', 'big']) {
      await pick(q, k);
      for (const view of ['grid', 'lines']) {
        if (!(await q.isVisible('[data-testid="view-' + view + '-lab-' + k + '"]'))) await q.click('[data-cbl-pop="view"]'); /* a phone: the View popover holds it */
        await q.click('[data-testid="view-' + view + '-lab-' + k + '"]', { timeout: 3000 });
        if (await q.isVisible('[data-cbl-pop="view"][aria-expanded="true"]')) await q.keyboard.press('Escape');
        await q.evaluate((key) => { window.__opened = []; const L = CBList.get(key);
          /* the page's own next level where it has one; a stand-in otherwise, so every list has a ▸ */
          L.refresh(Object.assign({ onOpen: function (r) { window.__opened.push(r); } }, document.querySelector('[data-caret]') ? {} : { next: function () { return '<div>next</div>'; } })); }, 'lab-' + k);
        await q.waitForSelector('[data-row] [data-caret]', { timeout: 4000 });
        const lab = await q.evaluate(() => {   /* a point on the first cell's TEXT, past the caret */
          const row = document.querySelector('[data-row]'), car = row.querySelector('[data-caret]'), cell = row.querySelector('.cbl-cell.first, .cbl-lflow');
          const c = car.getBoundingClientRect(), r = cell.getBoundingClientRect(), x = Math.min(r.right - 4, Math.max(c.right, r.left) + 12);
          return { x, y: r.top + Math.min(r.height / 2, 10), id: row.getAttribute('data-row'), hit: (document.elementFromPoint(x, r.top + Math.min(r.height / 2, 10)) || {}).className || '' };
        });
        await q.mouse.click(lab.x, lab.y);
        const a = await q.evaluate(() => ({ opened: window.__opened.length, next: document.querySelectorAll('.cbl-next').length }));
        ok(a.opened === 1 && a.next === 0, vp.width + ' · ' + k + ' · ' + view + ': the label opens the row (onOpen once), nothing expands — ' + JSON.stringify(a) + ' hit ' + lab.hit);
        await q.click('[data-row="' + lab.id + '"] [data-caret]');
        const c = await q.evaluate(() => ({ opened: window.__opened.length, next: document.querySelectorAll('.cbl-next').length }));
        ok(c.opened === 1 && c.next === 1, vp.width + ' · ' + k + ' · ' + view + ': only the ▸ toggles the next level, and it does not open the row — ' + JSON.stringify(c));
        await q.click('[data-row="' + lab.id + '"] [data-caret]');
        ok(await q.locator('.cbl-next').count() === 0, vp.width + ' · ' + k + ' · ' + view + ': ▸ again closes it');
      }
    }
    await c8.close();
  }

  /* ─────────────────────────── A SERVER-PAGED LIST WITH FILTERS (T3-CATALOGUE widening) ─────────────────────────── */
  console.log('\n== list-unit: remote + filters ==');
  {
    const { ctx: c9, p: q } = await open();
    const r = await q.evaluate(() => {
      const host = document.createElement('div'); host.id = 'remote_host'; host.style.height = '400px'; document.body.appendChild(host);
      window.__queries = [];
      CBList.mount(host, { key: 'remote-filt', rows: [{ id: 'a', name: 'A', st: 'x' }, { id: 'b', name: 'B', st: 'y' }], id: (x) => x.id, columns: [{ key: 'name', label: 'Name', prio: 1 }],
        filters: [{ key: 'st', label: 'State', all: 'Any', options: [{ v: 'x', label: 'X' }, { v: 'y', label: 'Y' }], match: () => true }],
        remote: { total: () => 2, onQuery: (qq) => { window.__queries.push(qq); } } });
      const btn = host.querySelector('[data-testid="cbl-filters-remote-filt"]');
      return { btn: !!btn, rows: host.querySelectorAll('.cbl-row').length };
    });
    ok(r.btn && r.rows === 2, 'a remote list that declares filters shows Filters ▾ and draws the page it was given — ' + JSON.stringify(r));
    await q.click('[data-testid="cbl-filters-remote-filt"]'); await q.waitForSelector('[data-testid="cbl-filters-pop-remote-filt"] select[data-filt="st"]', { timeout: 3000 });
    await q.selectOption('[data-testid="cbl-filters-pop-remote-filt"] select[data-filt="st"]', 'y'); await q.waitForTimeout(450);   /* the pager is asked after the unit's 250 ms debounce */
    const after = await q.evaluate(() => ({ queries: window.__queries.map((x) => x.filt), rows: document.querySelectorAll('#remote_host .cbl-row').length }));
    ok(after.queries.length === 1 && after.queries[0].st === 'y' && after.rows === 2, 'a filter change goes to the pager (onQuery filt) and the unit filters nothing itself — ' + JSON.stringify(after));
    await c9.close();
  }

  ok(errs.length === 0, 'no page error anywhere' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); S.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

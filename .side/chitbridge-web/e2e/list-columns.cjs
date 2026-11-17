#!/usr/bin/env node
/**
 * list-columns.cjs — THE COLUMN CHOOSER OF CBList (app/list-ctl.js), RUN FOR REAL on the lab (public/list-lab.html).
 *
 * Athi, 2026-10-02 ("Maximum three columns", DECISIONS.md): a list KEEPS every column, SHOWS its top three by the priority it declares, and the
 * chooser shows / hides / orders the rest, remembered per list.
 * Proves: default three visible (+ the pinned amount) · a 4th ticked shows · the choice and its order survive a reload · another list is not touched ·
 * storage that THROWS still renders three and still honours a tick for the session · the top column cannot be unticked · EVERY ticked column is
 * reachable (the rows scroll sideways; nothing is dropped, nothing is silently ignored) · on a phone every tick is a labelled card line · a stale
 * saved key is dropped · ▤ grid / ☰ lines is remembered per list.
 * This file used to drive tblCols* in a VM (and the "hidden — no room" fit). That fit is gone with the hover peek: a column that does not fit is now
 * reached by scrolling the rows sideways, which is the second-to-last claim here. The pixels and the keyboard are e2e/list-unit.cjs.
 */
'use strict';
const { chromium } = require('@playwright/test');
const { serve, PUBLIC } = require('./lib/serve.cjs');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  XX   ' + m); } };
const K = 'lab-daybook';
const heads = (p) => p.$$eval('.cbl-hdr [role=columnheader]', (els) => els.map((x) => x.textContent.replace(/[⇅▲▼]/g, '').trim()));

(async () => {
  const S = await serve(process.env.CBL_ROOT || PUBLIC), b = await chromium.launch();
  const open = async (ctx, pre) => { const p = await ctx.newPage(); if (pre) await p.addInitScript(pre); await p.goto(S.url('/list-lab.html')); await p.waitForSelector('.cbl-row, .cbl-lrec'); return p; };
  const tick = async (p, k) => { if (!await p.locator('[data-testid="cols-menu-' + K + '"]').count()) { if (!await p.isVisible('[data-testid="cols-btn-' + K + '"]')) await p.click('[data-cbl-pop="view"]'); /* a phone: Columns sits in the View popover */ await p.click('[data-testid="cols-btn-' + K + '"]'); } await p.click('[data-testid="cols-' + K + '-' + k + '"]'); };
  const shut = async (p) => { if (await p.locator('[data-testid="cols-menu-' + K + '"]').count()) await p.keyboard.press('Escape'); };

  console.log('\n== list-columns: the chooser ==');
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-IN', serviceWorkers: 'block' });
  let p = await open(ctx);
  ok((await heads(p)).join() === 'Date,Entry,Party,Amount', 'default: the top three by priority are shown (Date, Entry, Party) in declaration order, and the pinned Amount');
  ok(/data-testid="cols-btn-lab-daybook"/.test(await p.innerHTML('.cbl-tools')), 'the bar of a list carries the columns button');
  await p.click('[data-testid="cols-btn-' + K + '"]');
  const menu = await p.textContent('[data-testid="cols-menu-' + K + '"]');
  ok(/Shown/.test(menu) && /Available/.test(menu) && await p.locator('[data-testid="cols-menu-' + K + '"] input[type=checkbox]').count() === 8, 'the chooser lists ALL eight choosable columns: Shown and Available');
  ok(await p.locator('[data-testid="cols-' + K + '-date"]').isDisabled() && await p.locator('[data-testid="cols-' + K + '-date"]').isChecked(), 'the top-priority column is ticked and disabled');
  await p.evaluate(() => { const c = document.querySelector('[data-testid="cols-lab-daybook-date"]'); c.disabled = false; c.click(); });
  ok((await heads(p)).join() === 'Date,Entry,Party,Amount', 'the top column cannot be unticked (a forced change is put back)');
  await tick(p, 'bill');
  ok((await heads(p)).join() === 'Date,Entry,Party,Bill,Amount', 'ticking a 4th column shows it');
  ok(!await p.locator('[data-testid="cols-' + K + '-bill"]').isDisabled() && await p.locator('[data-testid="cols-' + K + '-bill"]').isChecked(), 'the ticked one is checked and can be unticked again');
  await p.click('.cbl-mv[data-mv="bill"][data-d="-1"]');
  ok((await heads(p)).join() === 'Date,Entry,Bill,Party,Amount', 'its order can be moved, and the order is the remembered choice');
  await shut(p); await p.close();

  p = await open(ctx);   /* a reload: a new page over the same storage */
  ok((await heads(p)).join() === 'Date,Entry,Bill,Party,Amount', 'reload keeps the choice and the order (remembered per list)');
  await p.click('[data-plist="dues"]'); await p.waitForTimeout(100);
  ok((await heads(p)).join() === 'Party,Total due,Oldest', 'another list key is not touched by it');
  await p.close();

  console.log('\n== list-columns: storage that throws ==');
  const ctx2 = await b.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  const boom = () => { const t = function () { throw new Error('denied'); }; Storage.prototype.getItem = t; Storage.prototype.setItem = t; };
  p = await open(ctx2, boom);
  ok((await heads(p)).join() === 'Date,Entry,Party,Amount', 'storage denied: the page still renders the top three');
  await tick(p, 'kind');
  ok((await heads(p)).join() === 'Date,Entry,Party,Kind,Amount', 'storage denied: a tick still applies for the session');
  await shut(p); await p.close(); await ctx2.close();

  console.log('\n== list-columns: every tick is reachable ==');
  const ctxN = await b.newContext({ viewport: { width: 1000, height: 768 }, locale: 'en-IN', serviceWorkers: 'block' });
  p = await open(ctxN);
  for (const k of ['kind', 'bill', 'tender', 'counter', 'person']) await tick(p, k);
  await shut(p);
  const all = await heads(p);
  ok(all.length === 9, 'ticking every column shows every column (' + all.length + ' headings: ' + all.join(' · ') + ')');
  const reach = await p.evaluate(() => { const l = document.querySelector('.cbl-list'), h = document.querySelector('.cbl-hdr'); return { sw: l.scrollWidth, cw: l.clientWidth, hw: h.scrollWidth, kids: [].map.call(h.children, (c) => Math.round(c.getBoundingClientRect().width)).reduce((a, x) => a + x, 0) }; });
  ok(reach.sw >= reach.cw && reach.hw <= reach.sw && reach.kids >= reach.cw, 'what does not fit is reached by scrolling the rows sideways or all fit at their minimum (scrollWidth ' + reach.sw + ' >= ' + reach.cw + ') - nothing is dropped, nothing is silently ignored');
  ok(!(await p.textContent('[data-testid="cols-menu-' + K + '"]').catch(() => '')).includes('hidden — no room'), 'so the chooser never has to say "hidden — no room" on a laptop');
  await p.close(); await ctxN.close();

  console.log('\n== list-columns: a phone ==');
  const ctx3 = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  p = await open(ctx3);
  await tick(p, 'bill'); await tick(p, 'kind'); await shut(p);
  const card = await p.evaluate(() => { const r = document.querySelector('.cbl-row'); return { display: getComputedStyle(r).display, labelled: [].map.call(r.querySelectorAll('.cbl-cell[data-l]:not([data-l=""])'), (c) => c.getAttribute('data-l')) }; });
  ok(card.display === 'flex' && card.labelled.join() === 'Entry,Party,Bill,Kind,Amount', 'below the card breakpoint every ticked column is kept, each a label : value line (' + card.labelled.join(' · ') + ')');
  await p.close(); await ctx3.close();

  console.log('\n== list-columns: stale keys and the view ==');
  const ctx4 = await b.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  p = await open(ctx4, () => { try { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('cblist.lab-daybook', JSON.stringify({ cols: ['gone', 'amount', 'party'] })); } } catch (_) {} });
  ok((await heads(p)).join() === 'Date,Party,Amount', 'a stale saved key is dropped; the top column is put back');
  ok(await p.locator('.cbl-hdr').count() === 1, 'a list opens as a grid unless it declares lines');
  await p.click('[data-testid="view-lines-' + K + '"]');
  ok(await p.getAttribute('[data-testid="view-lines-' + K + '"]', 'aria-pressed') === 'true' && await p.locator('.cbl-hdr').count() === 0, 'switching to lines drops the header and flows the fields');
  await p.reload(); await p.waitForSelector('.cbl-lrec, .cbl-row');
  ok(await p.getAttribute('[data-testid="view-lines-' + K + '"]', 'aria-pressed') === 'true', 'reload keeps the view (per list key)');
  await p.click('[data-testid="view-grid-' + K + '"]');
  ok((await heads(p)).join() === 'Date,Party,Amount', 'back to grid: the same columns');
  await p.close(); await ctx4.close();

  await ctx.close(); await b.close(); S.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

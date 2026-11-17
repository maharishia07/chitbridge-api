#!/usr/bin/env node
/**
 * e2e/walk-compat.cjs — COMPATIBILITY, WALKED (round T3-COMPAT, 2026-10-14): Home's Compatibility card → the Standards page's "Works with" tab.
 * Black box: the real Home (index.html + shell.js + manifest.json) and the real standards.html, with the real data/compat.json and cap-standards.js.
 * The Standards page reads no API; Home's stand-in answers {} (the Compatibility card has no facts read — none exists, so it shows no figure).
 *   C1  Home -> Compatibility is a built card, opens /standards.html#compared-with (STD-COMPARE: the Compared with tab, Works with one tab away), shows no invented figure, never app.html
 *   C2  #works-with -> the Works with tab is lit, the list is exactly the compat.json rows, each with Moves (In · Out · Both ways) and a status
 *   C3  a row opens to what moves, which way, its proof, its code and its test (the chitbridge-api paths); a planned row says "Not built yet"
 *   C4  the tab is the list's own filter: Everything lists the whole register (no Moves column, the address loses #works-with); Works with brings both back
 *   C5  Copy for a buyer or CA carries Moves, Code and Test
 *   C6  compat.json unreadable -> the Works with tab says it could not be read, in words, with Try again — never "nothing matches"
 *   C7  rule 13 on the Works with tab: Cream and Dark at 1366 and 390 px (lib/rule13.cjs)
 *   --real  the same on the local api (e2e/lib/real-stack.cjs: ../chitbridge-api against CB_REAL_DB), Home signed in as a real owner
 *
 *   NODE_PATH=e2e/node_modules node e2e/walk-compat.cjs [--real]
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const W = require('./lib/walk.cjs');
const { rule13 } = require('./lib/rule13.cjs');
const REAL = process.argv.includes('--real');
const PUB = path.join(__dirname, '..', 'public');
const J = (o, status) => ({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });

/* the rows the tab must hold: compat.json mapped by the register's own stdCompatRows (counted from the source, never a typed number) */
const ctx0 = { console, tx: (s) => s, esc: (s) => String(s) };   /* the two helpers the register asks its page for (as standards-page.cjs reads it) */
vm.createContext(ctx0);
vm.runInContext(fs.readFileSync(path.join(PUB, 'app', 'cap-standards.js'), 'utf8') + ';this.compat = stdCompatRows; this.DIR = STD_COMPAT_DIR;', ctx0);
const CJ = JSON.parse(fs.readFileSync(path.join(PUB, 'data', 'compat.json'), 'utf8'));
const CROWS = ctx0.compat(CJ);

W.run('compat', async (w) => {
  const { page, ctx, base } = w;
  let stack = null, api = '', failCompat = false;
  const calls = [];
  if (REAL) {
    const R = require('./lib/real-stack.cjs');
    stack = await R.up({ webBase: base }); api = stack.api;
    const owner = await R.signIn(api, process.env.CB_WALK_OWNER || 'compat-walk@example.test');
    await ctx.addInitScript((s) => { try { localStorage.setItem('cb_ids', '1'); localStorage.setItem('cb_api_base', s.api); localStorage.setItem('cb_sess', s.sess); } catch (_) {} }, { api, sess: owner.session });
  } else {
    await ctx.route('**/api/**', (r) => { calls.push(new URL(r.request().url()).pathname); return r.fulfill(J({})); });
    await ctx.addInitScript((s) => { try { localStorage.setItem('cb_ids', '1'); localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
  }
  await ctx.route('**/data/compat.json', (r) => (failCompat ? r.fulfill({ status: 404, contentType: 'text/plain', body: 'no' }) : r.continue()));

  const std = async (hash) => {
    await page.goto('about:blank'); await page.goto(base + '/standards.html' + (hash || ''));   /* about:blank first: the same address with a hash would not reload */ await page.waitForSelector('[data-testid="std-list"] .cbl-list', { timeout: 20000 }); await page.waitForTimeout(300);
  };
  const shown = () => page.$$eval('[data-testid^="std-row-"]', (els) => els.map((e) => +e.getAttribute('data-testid').slice(8)));
  const lit = () => page.$$eval('[data-testid^="std-view-"]', (els) => els.filter((e) => e.getAttribute('aria-selected') === 'true').map((e) => e.getAttribute('data-testid')));

  await w.step('C1', 'Home -> Compatibility is a built card that opens the Standards page on the Compared with tab (Works with beside it), with no invented figure', async () => {
    await page.goto(base + '/'); await page.waitForSelector('[data-testid="cbshell"]', { timeout: 20000 }); await page.waitForTimeout(600);
    const href = await page.getAttribute('[data-testid="shell-card-compatibility"]', 'href').catch(() => null);
    const facts = await page.locator('[data-testid="shell-facts-compatibility"]').innerText().catch(() => 'missing');
    const chip = await page.locator('[data-testid="shell-chip-compatibility"]').count();
    await page.click('[data-testid="shell-card-compatibility"]'); await page.waitForURL(/standards\.html#compared-with/, { timeout: 15000 });
    await page.waitForSelector('[data-testid="std-view-works-with"]', { timeout: 15000 }); await page.waitForTimeout(400);
    const tabs = await lit();
    return { ok: href === '/standards.html#compared-with' && !facts.trim() && chip === 0 && !/app\.html/.test(href || '') && tabs.join() === 'std-view-compared-with', saw: 'card → ' + href + ' · facts "' + facts.trim() + '" · chip ' + chip + ' · tabs ' + tabs.join() };
  });

  await w.step('C2', 'Works with tab -> #works-with: the tab is lit and the list is exactly the ' + CROWS.length + ' compat.json rows, each with Moves and a status', async () => {
    await page.click('[data-testid="std-view-works-with"]'); await page.waitForURL(/standards\.html#works-with/, { timeout: 15000 });
    await page.waitForSelector('[data-testid^="std-row-"]', { timeout: 15000 }); await page.waitForTimeout(400);
    const ids = await shown(), kinds = await page.$$eval('[data-testid^="std-row-"] [data-testid="std-kind"]', (e) => e.map((x) => x.textContent.trim()));
    const dirs = await page.$$eval('[data-testid^="std-row-"] [data-testid="std-dir"]', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    const sts = await page.$$eval('[data-testid^="std-row-"] .st[class*="st-"]', (e) => e.length);
    const hdr = await page.$$eval('.cbl-hc', (e) => e.map((x) => x.textContent.trim()).join('|'));
    const okDir = dirs.length === CROWS.length && dirs.every((d) => /^(↓ In|↑ Out|⇅ Both ways)$/.test(d));
    return { ok: ids.length === CROWS.length && kinds.every((k) => k === 'Compatibility') && okDir && sts === CROWS.length && /Moves/.test(hdr) && (await lit()).join() === 'std-view-works-with',
      saw: ids.length + ' rows · moves ' + Array.from(new Set(dirs)).join(', ') + ' · head ' + hdr };
  });

  await w.step('C3', 'A row opens to what moves, which way, its proof, code and test; a planned row says Not built yet', async () => {
    const all = await page.evaluate(() => ROWS.map((x) => ({ ix: x.ix, id: x.r.compat || '' })));
    const ix = (id) => all.find((x) => x.id === id).ix;
    const open = async (id) => { await page.click('[data-testid="std-row-' + ix(id) + '"]'); await page.waitForSelector('[data-testid="std-detail-' + ix(id) + '"]', { timeout: 5000 }); return page.innerText('[data-testid="std-detail-' + ix(id) + '"]'); };
    const xm = await open('xero-move-in'), xs = await open('xero-sync'), bk = await open('beckn');
    const ok = /From Xero into the network/.test(xm) && /lib\/move-in\.js/.test(xm) && /tests\/move-in\.test\.cjs/.test(xm) && /Proven on a stand-in/.test(xm)
      && /From the network out to Xero/.test(xs) && /Not built yet/.test(xs) && /No test yet/.test(xs)
      && /lib\/beckn-map\.js/.test(bk) && /tests\/beckn-map\.test\.js/.test(bk) && /Beckn-compatible, not ONDC-registered/.test(bk);
    return { ok, saw: 'xero-move-in "' + xm.replace(/\s+/g, ' ').slice(0, 90) + '…" · xero-sync ' + (/Not built yet/.test(xs) ? 'Not built yet' : '?') + ' · beckn ' + (/beckn-map/.test(bk) ? 'code+test' : '?') };
  });

  await w.step('C4', 'Everything -> the whole register, no Moves column, #works-with gone; Works with -> both back', async () => {
    await page.click('[data-testid="std-view-all"]'); await page.waitForTimeout(400);
    const n = (await shown()).length, hdr = await page.$$eval('.cbl-hc', (e) => e.map((x) => x.textContent.trim()).join('|')), h1 = await page.evaluate(() => location.hash);
    const total = await page.evaluate(() => ROWS.length);
    await page.click('[data-testid="std-view-works-with"]'); await page.waitForTimeout(400);
    const n2 = (await shown()).length, h2 = await page.evaluate(() => location.hash), hdr2 = await page.$$eval('.cbl-hc', (e) => e.map((x) => x.textContent.trim()).join('|'));
    return { ok: n > CROWS.length && !/Moves/.test(hdr) && h1 === '' && n2 === CROWS.length && h2 === '#works-with' && /Moves/.test(hdr2),
      saw: 'Everything ' + n + ' shown (of ' + total + '), hash "' + h1 + '" · Works with ' + n2 + ', hash "' + h2 + '"' };
  });

  await w.step('C5', 'Copy for a buyer or CA -> the statement carries Moves, Code and Test', async () => {
    const t = await page.evaluate(() => { const x = ROWS.find((r) => r.r.compat === 'csv'); return statementOf(x.r); });
    return { ok: /Moves: Both ways between the network and Any spreadsheet/.test(t) && /Code: chitbridge-api tools\/tally-connector\/adapters\/csv\.js/.test(t) && /Test: chitbridge-api tests\/csv\.test\.js/.test(t), saw: t.split('\n').filter((l) => /^(Moves|Code)/.test(l)).join(' / ') };
  });

  await w.step('C6', 'compat.json unreadable -> the Works with tab says it could not be read, with Try again (never "nothing matches")', async () => {
    failCompat = true; await std('#works-with'); failCompat = false;
    const err = await page.locator('[data-testid="cbl-error-standards"]').innerText().catch(() => '');
    const none = await page.locator('[data-testid="cbl-nomatch-standards"]').count();
    return { ok: /could not be read/.test(err) && /Try again/.test(err) && none === 0, saw: '"' + err.replace(/\s+/g, ' ').trim() + '"' };
  });

  await std('#works-with');
  /* rule 13 with a row open, so the opened sheet's words are measured too */
  await page.evaluate(() => { const x = ROWS.find((r) => r.r.compat === 'xero-move-in'); document.querySelector('[data-testid="std-row-' + x.ix + '"]').click(); });
  await rule13(w, 'C7', 'Standards › Works with, a row open', 'std_list');

  if (stack) stack.stop();
});

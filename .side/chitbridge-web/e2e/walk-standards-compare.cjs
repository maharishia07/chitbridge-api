#!/usr/bin/env node
/**
 * e2e/walk-standards-compare.cjs — COMPARED WITH, WALKED (round STD-COMPARE, 2026-10-15): the Standards page's "Compared with" tab —
 * the country comparison of accounting packages (data/compare.json) as a CBList view with its own rows, beside Works with.
 * Black box: the real standards.html, cap-standards.js, list-ctl.js, avatar.js and data/compare.json. The page reads no API; the avatar's one
 * /me read is answered by a stand-in here, so the tab's default country can be proved both ways (the shop's country · no country → none picked, a line says so).
 *   S1  #compared-with, signed in to an Australian shop -> the tab is lit, the list is exactly compare.json's AU rows, each with a symbol AND a word
 *   S2  #compared-with with no shop country -> no India default (CTRY-72): every country, a line to set it; the Package filter narrows to one package; the tab stays lit and the address keeps #compared-with
 *   S3  the country filter -> the UAE rows; a claim from memory is marked "to confirm"
 *   S4  a row opens its source: links for a web source; a document-only source is said in words and Open the source is greyed WITH its sentence
 *   S5  See it on a core-books row -> the parallel run (accounts.html#compare); no other row offers it
 *   S6  All -> the whole register with none of the comparison rows, the address loses #compared-with; Copy carries both sides and the source
 *   S7  compare.json unreadable -> the tab says it could not be read, in words, with Try again — never "nothing matches"
 *   S8  rule 13 on the tab with a row open: Cream and Dark at 1366 and 390 px (lib/rule13.cjs) — AA contrast, no clipped word, no sideways scroll
 *
 *   NODE_PATH=e2e/node_modules node e2e/walk-standards-compare.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const W = require('./lib/walk.cjs');
const { rule13 } = require('./lib/rule13.cjs');
const PUB = path.join(__dirname, '..', 'public');
const J = (o, status) => ({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });

/* the rows the tab must hold: compare.json mapped by the register's own stdCompareRows (counted from the source, never a typed number) */
const ctx0 = { console, tx: (s) => s, esc: (s) => String(s) };
vm.createContext(ctx0);
vm.runInContext(fs.readFileSync(path.join(PUB, 'app', 'cap-standards.js'), 'utf8') + ';this.compare = stdCompareRows; this.STATUS = STD_COMPARE_STATUS;', ctx0);
const CJ = JSON.parse(fs.readFileSync(path.join(PUB, 'data', 'compare.json'), 'utf8'));
const CROWS = ctx0.compare(CJ);
const byCountry = (c) => CROWS.filter((r) => r.c[0] === c);
const WORDS = Object.keys(ctx0.STATUS).map((k) => ctx0.STATUS[k][0] + ' ' + ctx0.STATUS[k][1]);

W.run('standards-compare', async (w) => {
  const { page, ctx, base } = w;
  let shopCountry = 'AU', failCompare = false;
  /* the stand-in api: /me carries the shop's country (the avatar's one read); everything else answers {} */
  await ctx.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    if (/\/api\/entities\/me$/.test(p)) return r.fulfill(J({ ok: true, data: { entity: shopCountry ? { country: shopCountry } : {} } }));
    return r.fulfill(J({}));
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
  await ctx.route('**/data/compare.json', (r) => (failCompare ? r.fulfill({ status: 404, contentType: 'text/plain', body: 'no' }) : r.continue()));

  const std = async (hash) => {
    await page.goto('about:blank'); await page.goto(base + '/standards.html' + (hash || ''));
    await page.waitForSelector('[data-testid="std-list"] .cbl-list', { timeout: 20000 }); await page.waitForTimeout(500);
  };
  const shown = () => page.$$eval('[data-testid^="std-cmp-c"]:not([data-testid="std-cmp-confirm"])', (els) => els.map((e) => e.getAttribute('data-testid')));
  const regRows = () => page.$$eval('[data-testid^="std-row-"]', (els) => els.length);
  const lit = () => page.$$eval('[data-testid^="std-view-"]', (els) => els.filter((e) => e.getAttribute('aria-selected') === 'true').map((e) => e.getAttribute('data-testid')));
  const statuses = () => page.$$eval('[data-testid="std-cmp-status"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  const hash = () => page.evaluate(() => location.hash);
  const ixOf = (id) => page.evaluate((id) => { const x = CMP_ROWS.find((r) => r.r.cmp === id); return x ? x.ix : ''; }, id);
  const setFilter = async (key, value) => {
    await page.click('[data-testid="cbl-filters-standards"]'); await page.waitForSelector('[data-testid="listctl-filter-' + key + '"]', { timeout: 5000 });
    await page.selectOption('[data-testid="listctl-filter-' + key + '"]', value); await page.waitForTimeout(400);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  };
  const open = async (id) => {   /* a row already open stays open (a second click would fold it) */
    const ix = await ixOf(id); if (await page.locator('[data-testid="std-detail-' + ix + '"]').count()) return ix;
    await page.click('[data-testid="std-cmp-' + ix + '"]');
    await page.waitForSelector('[data-testid="std-detail-' + ix + '"]', { timeout: 5000 }); return ix;
  };

  await w.step('S1', '#compared-with, signed in to an Australian shop -> the tab is lit and the list is exactly the ' + byCountry('AU').length + ' AU rows, each with a symbol and a word', async () => {
    await std('#compared-with'); await page.waitForTimeout(800);   /* the /me answer lands after the first paint: the tab follows it */
    const ids = await shown(), sts = await statuses(), tabs = await lit(), hdr = await page.$$eval('.cbl-hc', (e) => e.map((x) => x.textContent.trim()).join('|'));
    const okSt = sts.length === ids.length && sts.every((s) => WORDS.indexOf(s) >= 0);
    return { ok: ids.length === byCountry('AU').length && okSt && tabs.join() === 'std-view-compared-with' && /Package/.test(hdr) && /Compared/.test(hdr) && (await regRows()) === 0,
      saw: ids.length + ' rows · ' + Array.from(new Set(sts)).join(', ') + ' · tabs ' + tabs.join() + ' · head ' + hdr };
  });

  await w.step('S2', 'no shop country -> no country picked (never India) and a line says to set it; Package narrows to one package; the tab stays lit, the address keeps #compared-with', async () => {
    shopCountry = ''; await std('#compared-with'); await page.waitForTimeout(500);
    const n = (await shown()).length, h0 = await hash();
    const line = await page.$eval('[data-testid="std-nocountry-line"]', (e) => ({ hidden: e.hidden, text: e.textContent, link: (e.querySelector('a') || {}).getAttribute ? e.querySelector('a').getAttribute('href') : '' })).catch(() => null);
    await setFilter('package', 'Zoho Books');
    const n2 = (await shown()).length, want = CROWS.filter((r) => r.pkg === 'Zoho Books').length, tabs = await lit(), h1 = await hash();
    return { ok: n > byCountry('IN').length && n >= Math.min(CROWS.length, 50) && !!line && line.hidden === false && /Set your country first/.test(line.text) && /#\/country/.test(line.link) && n2 === want && n2 > 0 && tabs.join() === 'std-view-compared-with' && h0 === '#compared-with' && h1 === '#compared-with',
      saw: 'all ' + n + ' rows (no India default) · line ' + (line ? (line.hidden ? 'hidden' : 'shown') : 'missing') + ' · Zoho Books ' + n2 + ' · tabs ' + tabs.join() + ' · hash ' + h1 };
  });

  await w.step('S3', 'the country filter -> the UAE rows; a claim from memory is marked "to confirm"', async () => {
    await setFilter('package', ''); await setFilter('country', 'AE');
    const n = (await shown()).length, tc = await page.$$eval('[data-testid="std-cmp-confirm"]', (e) => e.length), memory = byCountry('AE').filter((r) => r.verified === 'memory').length;
    return { ok: n === byCountry('AE').length && tc === memory && (await lit()).join() === 'std-view-compared-with', saw: 'AE ' + n + ' rows · to confirm ' + tc + ' (memory rows ' + memory + ')' };
  });

  await w.step('S4', 'a row opens its source: a link for a web source; a document-only source said in words, Open the source greyed with its sentence', async () => {
    await setFilter('country', 'AU');
    const ix = await open('au-xero-core-books');
    const links = await page.$$eval('[data-testid="std-cmp-sources-' + ix + '"] a', (e) => e.map((a) => a.getAttribute('href') + '|' + a.getAttribute('target') + '|' + a.getAttribute('rel')));
    const copy = await page.innerText('[data-testid="std-cmp-sources-' + ix + '"]');
    const btn = await page.getAttribute('[data-testid="std-cmp-source"]', 'disabled');
    /* the document-only row is READ from the file, never a typed id (R120, 2026-10-24: every India row now cites a vendor URL; the remaining
       document-only sources are UAE rows) — a source with no web link and no copy on this checkout */
    const docOnly = CROWS.find((r) => r.src.length && r.src.every((s) => !s.url && !s.copy));
    await setFilter('country', docOnly.c[0]);
    const ix2 = await open(docOnly.cmp);
    const words = await page.innerText('[data-testid="std-cmp-sources-' + ix2 + '"]');
    const why = await page.locator('[data-testid="std-cmp-source-why"]').innerText().catch(() => '');
    const greyed = await page.getAttribute('[data-testid="std-cmp-source"]', 'aria-disabled');
    await setFilter('country', 'IN');   /* S5 onwards open India rows, as before */
    return { ok: links.length === 1 && /^https:\/\/www\.xero\.com\/au\/pricing-plans\/\|_blank\|noopener$/.test(links[0]) && /a copy is in this repository/.test(copy) && btn === null
        && /docs library/.test(words) && words.indexOf(docOnly.src[0].doc) >= 0 && greyed === 'true' && /docs library/.test(why),
      saw: 'xero: link ' + links[0] + ' · ' + docOnly.cmp + ': "' + words.replace(/\s+/g, ' ').slice(0, 70) + '…" · greyed ' + greyed + ' · why "' + why.slice(0, 60) + '"' };
  });

  await w.step('S5', 'See it on a core-books row -> the parallel run (accounts.html#compare); a non-books row offers no See it', async () => {
    const ixOther = await open('in-tally-prime-multi-currency');
    const none = await page.locator('.cbl-next[data-next="s' + ixOther + '"] [data-testid="std-cmp-see"]').count();   /* the opened row's own buttons (another row may be open too) */
    const ix = await open('in-tally-prime-core-books');
    const see = await page.locator('.cbl-next[data-next="s' + ix + '"] [data-testid="std-cmp-see"]').count();
    await page.click('.cbl-next[data-next="s' + ix + '"] [data-testid="std-cmp-see"]'); await page.waitForURL(/accounts\.html#compare/, { timeout: 15000 });
    const url = await page.evaluate(() => location.pathname + location.hash);
    return { ok: none === 0 && see === 1 && url === '/accounts.html#compare', saw: 'multi-currency See it ' + none + ' · core books See it ' + see + ' → ' + url };
  });

  await w.step('S6', 'All -> the whole register, no comparison row, the address loses #compared-with; Copy carries both sides and the source', async () => {
    await std('#compared-with'); await page.waitForTimeout(300);
    await page.click('[data-testid="std-view-all"]'); await page.waitForTimeout(400);
    const reg = await regRows(), cmp = (await shown()).length, h = await hash(), total = await page.evaluate(() => ROWS.length);
    const t = await page.evaluate(() => { const x = CMP_ROWS.find((r) => r.r.cmp === 'au-xero-inventory-with-batches'); return statementOf(x.r); });
    return { ok: reg > 0 && cmp === 0 && h === '' && /Theirs: Up to 4000 items/.test(t) && /Ours: Movement log/.test(t) && /Compared: Ahead/.test(t) && /Source: https:\/\/www\.xero\.com\/nz\/explore\/stock-control\//.test(t),
      saw: 'All ' + reg + ' of ' + total + ' register rows, ' + cmp + ' comparison rows, hash "' + h + '" · copy: ' + t.split('\n').filter((l) => /^(Compared|Source)/.test(l)).join(' / ').slice(0, 120) };
  });

  await w.step('S7', 'compare.json unreadable -> the Compared with tab says it could not be read, with Try again (never "nothing matches")', async () => {
    failCompare = true; await std('#compared-with'); failCompare = false;
    const err = await page.locator('[data-testid="cbl-error-standards"]').innerText().catch(() => '');
    const none = await page.locator('[data-testid="cbl-nomatch-standards"]').count();
    const note = await page.locator('[data-testid="std-compare-err"]').innerText().catch(() => '');
    return { ok: /Compared with list could not be read/.test(err) && /Try again/.test(err) && none === 0 && /could not be read/.test(note), saw: '"' + err.replace(/\s+/g, ' ').trim() + '"' };
  });

  shopCountry = 'AU'; await std('#compared-with'); await page.waitForTimeout(600);
  /* rule 13 with a row open, so the opened row's words (sources, verified) are measured too */
  await open('au-xero-bank-feeds-reconciliation');
  await rule13(w, 'S8', 'Standards › Compared with, a row open', 'std_list');
});

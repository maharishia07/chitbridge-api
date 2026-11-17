'use strict';
/*
 * e2e/flags-proof/walk.cjs — BROWSER PROOF of the private bookmarks and notes screens (W0-W3), headless Chromium against serve.cjs (same folder; its header says how it is run and what is mocked: ONLY the sign-in).
 *   BASE=http://flagsweb-node:4010 NODE_PATH=<playwright module folder> node e2e/flags-proof/walk.cjs
 * It proves, in the real pages (network.html Day book, app.html practice list), against the real routes on a real Postgres:
 *   1  a firm person bookmarks an entry ("My firm", preselected), writes a firm note and an "Only me" note: chips, sheet, Saved filter, "Checked n of m" unchanged
 *   2  a colleague of the SAME firm sees the firm bookmark and note, NEVER the "Only me" note
 *   3  a person of ANOTHER firm (adviser grant on the same client) sees none of the first firm's flags
 *   4  no /api/flags request ever carried X-Books-For or X-Books-Role (the server logs every one)
 *   5  1366x768 and 390x844: no sideways scroll on the page, the sheet inside the viewport
 * Nothing but the proof server's origin is reachable: every other host is blocked in the browser.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://flagsweb-node:4010';
const OUT = process.env.OUT || '/tmp/flagsweb-shots';
require('fs').mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 600) : '')); } };

let FX = null;
const labelOf = (who) => { const p = FX.people[who]; return 'h.' + Buffer.from(JSON.stringify({ identity_id: p.identity_id, parent_entity_id: p.parent_entity_id, display_name: p.display_name, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.s'; };
async function page(browser, who, size) {
  const ctx = await browser.newContext({ viewport: size || { width: 1366, height: 768 } });
  await ctx.route('**/*', (route) => (new URL(route.request().url()).origin === BASE ? route.continue() : route.abort()));
  await ctx.addInitScript((arg) => {
    try { localStorage.setItem('cb_sess', JSON.stringify({ token: arg.token, name: arg.name })); localStorage.setItem('cb_api_base', arg.base); } catch (e) { /* none */ }
  }, { token: labelOf(who), name: FX.people[who].display_name, base: BASE });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('   pageerror ' + String(e.message).slice(0, 200)));
  return p;
}
const dayBookUrl = (fx, extra) => BASE + '/network.html?open=' + fx.B + '&view=daybook&api=' + encodeURIComponent(BASE) + (extra || '');
async function openDayBook(p, fx, extra) {
  await p.goto(dayBookUrl(fx, extra), { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-testid="bv-list"] [data-row]', { timeout: 30000 });
  await p.waitForSelector('[data-fl]', { timeout: 15000 });
}
const rows = (p) => p.$$eval('[data-testid="bv-list"] [data-row]', (n) => n.length);
const chipState = (p) => p.$$eval('[data-fl]', (n) => n.map((b) => (b.className.indexOf('fl-on') >= 0 ? 'star' : b.className.indexOf('fl-note') >= 0 ? 'note' : 'none')));
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  const fx = await (await fetch(BASE + '/__fixture')).json();
  FX = fx;
  const browser = await chromium.launch();
  /* 1 · Una (Firm Two, auditor grant) */
  const u1 = await page(browser, 'U1');
  await openDayBook(u1, fx);
  const n = await rows(u1);
  ok('1a the Day book shows the four entries and a Saved chip on each', n === 4 && (await u1.$$('[data-fl]')).length === 4, 'rows ' + n);
  await u1.waitForSelector('[data-testid="mk-count"]', { timeout: 15000 }).catch(() => null);
  const checkedBefore = await u1.$eval('[data-testid="mk-count"]', (e) => e.textContent).catch(() => null);
  await u1.screenshot({ path: OUT + '/1-daybook-1366.png' });
  ok('1b the screen scrolls no sideways at 1366x768', await noSideways(u1));
  const first = (await u1.$$('[data-fl]'))[0];
  await first.click();
  await u1.waitForSelector('dialog[data-testid="fl-sheet"][open]');
  ok('1c the sheet opens with "My firm" preselected', await u1.$eval('input[name="fl_who"][value="org"]', (e) => e.checked));
  await u1.screenshot({ path: OUT + '/2-sheet-1366.png' });
  await u1.click('[data-testid="fl-bookmark"]');
  await u1.waitForSelector('.fl-item');
  await u1.click('dialog[data-testid="fl-sheet"] [data-act="close"]');
  ok('1d the first entry now shows a star', (await chipState(u1))[0] === 'star', JSON.stringify(await chipState(u1)));
  /* a firm note on entry 3, an Only me note on entry 2 */
  async function addNote(index, who, text) {
    await (await u1.$$('[data-fl]'))[index].click();
    await u1.waitForSelector('dialog[data-testid="fl-sheet"][open]');
    await u1.check('input[name="fl_who"][value="' + who + '"]');
    await u1.fill('[data-testid="fl-note"]', text);
    await u1.click('[data-testid="fl-add-note"]');
    await u1.waitForSelector('.fl-text');
    await u1.click('dialog[data-testid="fl-sheet"] [data-act="close"]');
  }
  await addNote(2, 'org', 'Ask about the round figure');
  await addNote(1, 'me', 'my private doubt');
  const afterU1 = await chipState(u1);
  ok('1e entry 1 star, entry 2 note (Only me, mine), entry 3 note (firm)', afterU1[0] === 'star' && afterU1[1] === 'note' && afterU1[2] === 'note' && afterU1[3] === 'none', JSON.stringify(afterU1));
  const checkedAfter = await u1.$eval('[data-testid="mk-count"]', (e) => e.textContent).catch(() => null);
  ok('1f "Checked n of m" is UNCHANGED by flags (' + checkedBefore + ')', checkedBefore !== null && checkedBefore === checkedAfter, checkedBefore + ' -> ' + checkedAfter);
  await openDayBook(u1, fx, '&dbf_flag=bookmarked');
  ok('1g the Saved filter "Bookmarked" (also from the address) keeps one entry', (await rows(u1)) === 1, 'rows ' + (await rows(u1)));
  await openDayBook(u1, fx);
  /* 2 · Umar, the colleague of the same firm */
  const u2 = await page(browser, 'U2');
  await openDayBook(u2, fx);
  const c2 = await chipState(u2);
  ok('2a the colleague sees the firm bookmark and the firm note, and NOT the Only me note', c2[0] === 'star' && c2[2] === 'note' && c2[1] === 'none', JSON.stringify(c2));
  await (await u2.$$('[data-fl]'))[1].click();
  await u2.waitForSelector('dialog[data-testid="fl-sheet"][open]');
  ok('2b the colleague opens that entry: the Only me note is nowhere in the sheet', !(await u2.content()).includes('my private doubt'));
  await u2.click('dialog[data-testid="fl-sheet"] [data-act="close"]');
  /* 3 · Asha, another firm with an adviser grant on the same client */
  const a1 = await page(browser, 'A1');
  await a1.goto(dayBookUrl(fx), { waitUntil: 'domcontentloaded' });
  await a1.waitForSelector('[data-testid="bv-list"] [data-row]', { timeout: 30000 }).catch(() => null);
  const seats = await a1.$$('[data-testid="bv-list"] [data-row]');
  if (!seats.length) { await a1.screenshot({ path: OUT + '/3-adviser-state.png' }); console.log('   (adviser door did not open directly: ' + (await a1.url()) + ')'); }
  await a1.waitForSelector('[data-fl]', { timeout: 15000 }).catch(() => null);
  const c3 = await chipState(a1);
  ok('3 another firm on the same client sees NONE of the first firm\'s flags (' + c3.length + ' chips)', c3.length > 0 && c3.every((s) => s === 'none'), JSON.stringify(c3));
  /* 4 · headers */
  const seen = await (await fetch(BASE + '/__seen')).json();
  ok('4 ' + seen.length + ' /api/flags requests, none carried X-Books-For or X-Books-Role', seen.length > 0 && seen.every((r) => !r.xbf && !r.xbr), JSON.stringify(seen.filter((r) => r.xbf || r.xbr).slice(0, 3)));
  /* 5 · the phone */
  const ph = await page(browser, 'U1', { width: 390, height: 844 });
  await openDayBook(ph, fx);
  await ph.screenshot({ path: OUT + '/4-daybook-390.png' });
  ok('5a no sideways scroll at 390x844', await noSideways(ph));
  await (await ph.$$('[data-fl]'))[0].click();
  await ph.waitForSelector('dialog[data-testid="fl-sheet"][open]');
  const box = await ph.$eval('dialog[data-testid="fl-sheet"]', (d) => { const r = d.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight }; });
  await ph.screenshot({ path: OUT + '/5-sheet-390.png' });
  ok('5b the sheet sits inside the 390x844 viewport', box.l >= 0 && box.r <= box.w + 1 && box.t >= 0 && box.b <= box.h + 1, JSON.stringify(box));
  /* 6 · the firm's Home: the client list's Saved column, the filter and the Bookmarks and notes count (app.html loads books-practice.js; the shell's own mount point is injected, the proof server does not serve the shell's reads) */
  const hp = await page(browser, 'U1');
  await hp.goto(BASE + '/?api=' + encodeURIComponent(BASE), { waitUntil: 'domcontentloaded' });
  await hp.evaluate(() => { if (!document.querySelector('[data-testid="shell-areas"]')) { const d = document.createElement('div'); d.setAttribute('data-testid', 'shell-areas'); document.body.appendChild(d); } });
  await hp.waitForSelector('[data-testid="practice"] [data-row]', { timeout: 30000 }).catch(() => null);
  await hp.waitForSelector('[data-testid="practice-flags"]', { timeout: 15000 }).catch(() => null);
  const count = await hp.$eval('[data-testid="practice-flags"]', (e) => e.textContent).catch(() => null);
  ok('6a Home shows "Bookmarks and notes" with the firm\'s open count (2 firm flags + 1 Only me = 3)', count !== null && /3$/.test(count), String(count));
  ok('6b the client list has a Saved chip on the client row', (await hp.$$('[data-testid="practice"] [data-fl-k="client"]')).length === 1);
  await (await hp.$('[data-testid="practice"] [data-fl-k="client"]')).click();
  await hp.waitForSelector('dialog[data-testid="fl-sheet"][open]');
  await hp.click('[data-testid="fl-bookmark"]');
  await hp.waitForSelector('.fl-item');
  await hp.click('dialog[data-testid="fl-sheet"] [data-act="close"]');
  const count2 = await hp.waitForFunction(() => /4$/.test((document.querySelector('[data-testid="practice-flags"]') || {}).textContent || ''), null, { timeout: 8000 }).then(() => true, () => false);
  ok('6c bookmarking the client turns its chip to a star and the count to 4', count2 && (await hp.$$('[data-testid="practice"] [data-fl-k="client"].fl-on')).length === 1);
  await hp.screenshot({ path: OUT + '/6-home-1366.png' });
  await hp.click('[data-testid="practice-flags"]');
  await hp.waitForSelector('dialog[data-testid="fl-worklist"][open] [data-row]', { timeout: 10000 }).catch(() => null);
  ok('6d the work list opens with the 4 open flags', (await hp.$$('dialog[data-testid="fl-worklist"] [data-row]')).length === 4, String((await hp.$$('dialog[data-testid="fl-worklist"] [data-row]')).length));
  await hp.screenshot({ path: OUT + '/7-worklist-1366.png' });
  ok('6e Home scrolls no sideways at 1366x768', await noSideways(hp));
  /* a colleague's Home count and the other firm's: the Only me note is not in Umar's count; Asha's firm counts none */
  const hu = await page(browser, 'U2');
  await hu.goto(BASE + '/?api=' + encodeURIComponent(BASE), { waitUntil: 'domcontentloaded' });
  await hu.evaluate(() => { const d = document.createElement('div'); d.setAttribute('data-testid', 'shell-areas'); document.body.appendChild(d); });
  await hu.waitForSelector('[data-testid="practice-flags"]', { timeout: 20000 }).catch(() => null);
  const cu = await hu.$eval('[data-testid="practice-flags"]', (e) => e.textContent).catch(() => null);
  ok('6f the colleague\'s Home count is 3 (the firm\'s 2 posting flags and the client bookmark; never U1\'s Only me note)', cu !== null && /3$/.test(cu), String(cu));
  const ha = await page(browser, 'A1');
  await ha.goto(BASE + '/?api=' + encodeURIComponent(BASE), { waitUntil: 'domcontentloaded' });
  await ha.evaluate(() => { const d = document.createElement('div'); d.setAttribute('data-testid', 'shell-areas'); document.body.appendChild(d); });
  await ha.waitForSelector('[data-testid="practice"] [data-row]', { timeout: 30000 }).catch(() => null);
  await ha.waitForTimeout(2500);
  ok('6g the other firm\'s Home has the client, its chip shows no star, and no "Bookmarks and notes" count', (await ha.$$('[data-testid="practice"] [data-fl-k="client"]')).length === 1 && (await ha.$$('[data-testid="practice"] [data-fl-k="client"].fl-on')).length === 0 && (await ha.$$('[data-testid="practice-flags"]')).length === 0);
  const seen2 = await (await fetch(BASE + '/__seen')).json();
  ok('7 ...and still no /api/flags request (' + seen2.length + ') carried X-Books-For or X-Books-Role', seen2.every((r) => !r.xbf && !r.xbr));
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('WALK FAILED', e); process.exit(2); });

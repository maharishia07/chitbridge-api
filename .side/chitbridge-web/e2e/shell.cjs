#!/usr/bin/env node
/* shell.cjs — THE SHELL UNIT, PROVED (public/app/shell.js · plan row N17 · decisions FIT §D Q1–Q10).
 * Pattern: one-avatar.cjs — Playwright, a stand-in API answering INSIDE the page (ctx.route), a static server on a free OS port.
 * Nothing here reaches localhost:3000 or the live site. The page is public/shell-lab.html (the shell's gallery).
 *
 * What it proves (exit 1 on any failure):
 *   1  static: the unit names no workshop page ("app.html"), no "tier", loads no application script, builds no avatar of its own;
 *      the manifest: every built entry's route is a page that exists, every other entry has no route (a dashed chip, I12)
 *   2  1366: it mounts; the bar holds mark · shop · licence slot · bell slot · avatar, and the avatar is CBAvatar (one button)
 *   3  1366: the sheet opens from the shop name and closes on Esc; /entities/header 404 → the empty state says "not available yet"
 *      and shows no number; no licence chip
 *   4  1366: N19's answer planted → the chip carries the server's band and days, four licence rows, the Renew link, 3 of 4 checks
 *   5  1366: cards from a PLANTED manifest — built = a link card with its facts lines (a failed facts read shows —), the rest dashed
 *   6  1366: the rail scrolls the work area to an area, and scrolling moves the highlight (scroll-spy)
 *   7  word budget per visible area (Q10): Home ≤ 120, every other area ≤ 100 — at 1366 and at 390
 *   8  390: bottom tabs, one area at a time; the kural sits at the foot of Home; scrollWidth === 390 with the sheet shut and open
 *   9  inside an app (?mode=app): no rail, a switcher in the bar listing the seven areas — at 1366 and at 390 (scrollWidth 390)
 *  10  the bar only (?mode=bar): header, nothing else · signed out: no shop button, no sheet, the avatar is the Sign in door,
 *      and /entities/header is never asked
 *  11  no page error
 * Screenshots: e2e/shots/shell-laptop.png (sheet open, N19 planted) · shell-phone.png (Home) · shell-phone-selling.png ·
 *              shell-laptop-empty-sheet.png · shell-app-phone.png
 * Run one at a time:  NODE_PATH=e2e/node_modules node e2e/shell.cjs                                                              */
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const C = require('./lib/contract.cjs');   /* M43: every answer for a route in the API contract is held to it (RAIL-LAB-SRV1: the facts family) */
const J = C.json;

/* N19's answer, planted (FIT row 95 shape). Bands and the penalty note are the SERVER's — the shell only shows them. */
const HEADER = {
  business: { name: 'Village Vegetables', legal_name: 'V V Traders', address: '12 Hillside Road, Chennai 600100', phone: '09840226357' },
  licences: [
    { scheme: 'fssai', label: 'FSSAI', number_masked: '12419…0041', valid_until: '2026-10-25', days_left: 18, band: 'soon', core: true, renew_url: '/know-your-business.html#fssai', note: 'Late fee after the 90-day mark' },
    { scheme: 'trade', label: 'Trade licence', number_masked: 'TN/CHN/8832', days_left: 243, band: 'ok', core: true },
    { scheme: 'se', label: 'Shop & Establishment', number_masked: 'SE-44190', days_left: 690, band: 'ok', core: true },
    { scheme: 'gstin', label: 'GSTIN', number_masked: null, days_left: null, band: null, core: false, registered: false }
  ],
  trade_ready: { checks: [{ key: 'address', label: 'Address proven', done: true }, { key: 'phone', label: 'Phone verified', done: true }, { key: 'pan', label: 'PAN on file', done: true }, { key: 'gstin', label: 'GSTIN', done: false }], done: 3, fix_url: '/know-your-business.html' }
};
/* a planted manifest: two built Selling apps with facts (one read fails), a workshop and a coming chip */
const PLANTED = { version: 1, entries: [
  { id: 'till', name: 'Till', route: '/till.html', icon: '▤', area: 'selling', state: 'built', what: 'Take money at the counter.', facts: '/api/facts/till' },
  { id: 'storefront', name: 'Storefront', route: '/shop.html', icon: '◇', area: 'selling', state: 'built', what: 'Your shop on the web.', facts: '/api/facts/broken' },
  { id: 'catalogue', name: 'Catalogue', route: null, icon: '▦', area: 'selling', state: 'workshop' },
  { id: 'orders', name: 'Orders', route: null, icon: '↓', area: 'selling', state: 'coming' },
  { id: 'accounts', name: 'Accounts', route: '/accounts.html', icon: '₹', area: 'running', state: 'built', what: 'What the shop made, and what it owes.' }
] };

async function run(o) {
  o = o || {};
  const { chromium } = require('@playwright/test');
  const { serve } = require('./lib/serve.cjs');
  const out = { pass: 0, fail: 0 };
  const ok = (c, m) => { if (c) out.pass++; else out.fail++; console.log((c ? '  ok  ' : '  XX  ') + m); };

  /* ── 1 · static ── */
  const unit = fs.readFileSync(path.join(ROOT, 'public', 'app', 'shell.js'), 'utf8');
  ok(!/app\.html/.test(unit), 'static · zero "app.html" in the unit (I12)');
  ok(!/\btier\b/i.test(unit), 'static · no word "tier" in the unit (Q5)');
  /* MNT-63: the shortcuts unit rides with the frame (loadShortcuts); it is the one script the shell may add, never a cap-*.js */
  const scriptTags = (unit.match(/createElement\(\s*['"]script/g) || []).length;
  const appended = (unit.match(/appendScript\(\s*'([^']+)'/g) || []).map((m) => m.replace(/^appendScript\(\s*'|'$/g, ''));
  ok(!/cap-[a-z-]+\.js|ensureCap/.test(unit) && scriptTags <= 1 && appended.every((u) => /^\/app\/shortcuts(-register)?\.js$/.test(u)), "static · the unit loads no application script (only the frame's own shortcuts unit)");
  ok(!/class="avmenu"|data-testid="avatar-menu"|class="avatar"|class="av"/.test(unit) && /CBAvatar\.mount|root\.CBAvatar\.mount/.test(unit), 'static · the avatar is CBAvatar mounted, never built here');
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'app', 'manifest.json'), 'utf8'));
  const exists = (r) => { if (/^https?:\/\//.test(r)) return true; /* TEMPORARY Coverage card (UX-141): an absolute URL */ const p = r.split(/[#?]/)[0]; return p === '/' ? fs.existsSync(path.join(ROOT, 'index.html')) : fs.existsSync(path.join(ROOT, 'public', p)); };
  const badBuilt = man.entries.filter((e) => e.state === 'built' && !(e.route && exists(e.route) && !/app\.html/.test(e.route))).map((e) => e.id);
  const badRest = man.entries.filter((e) => e.state !== 'built' && e.route).map((e) => e.id);
  ok(badBuilt.length === 0, 'manifest · every built entry routes to a utility page that exists' + (badBuilt.length ? ' — not: ' + badBuilt.join(', ') : ''));
  ok(badRest.length === 0 && man.entries.every((e) => ['built', 'coming', 'workshop'].includes(e.state)), 'manifest · coming / workshop entries have no route (dashed chips)' + (badRest.length ? ' — routed: ' + badRest.join(', ') : ''));
  ok(!/app\.html/.test(JSON.stringify(man)) && man.entries.every((e) => !('tier' in e)) && man.entries.every((e) => ['selling', 'running', 'labs', 'setup'].includes(e.area)), 'manifest · no app.html, no tier, every entry in one of the four areas');

  const web = await serve(), b = await chromium.launch(), errs = [];
  const SESSION = JSON.stringify({ token: 'tok-shell', role: 'entity', name: 'Asha', entity: 'Books Shop' });
  async function profile(vw, vh, p) {
    p = p || {};
    const seen = [];
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    if (p.manifest) await ctx.route('**/app/manifest.json', (r) => J(r, 200, p.manifest));
    await ctx.route('**/api/**', (r) => {
      const u = new URL(r.request().url()), m = r.request().method(); seen.push(u.pathname);
      if (u.pathname === '/api/entities/header') return p.header ? J(r, 200, p.header) : J(r, 404, { error: 'not found' });
      if (u.pathname === '/api/entities/me' && m === 'GET') return J(r, 200, { entity: { display_name: 'Books Shop', ui_prefs: {} } });
      if (u.pathname === '/api/facts/till') return J(r, 200, { lines: [{ text: '12 bills · {money}', money: { amount: 4280, currency: 'INR' } }, { text: '1 bill waiting to send', tone: 'dn', act: { label: 'Send now', href: '/till.html' } }] });
      if (u.pathname === '/api/facts/broken') return J(r, 500, { error: 'x' });
      return J(r, 200, { ok: true });
    });
    await ctx.addInitScript(([s, signedOut]) => { try { localStorage.setItem('cb_api_base', location.origin); if (signedOut) localStorage.removeItem('cb_sess'); else localStorage.setItem('cb_sess', s); } catch (_) {} }, [SESSION, !!p.signedOut]);
    return { ctx, seen };
  }
  async function open(ctx, q) {
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message)));
    await pg.goto(web.url('/shell-lab.html' + ((q || '?') + (q ? '&' : '') + 'harness=1')));
    await pg.waitForSelector('[data-testid="cbshell"]', { timeout: 20000 });
    await pg.evaluate(() => window.SHELL.ready);
    await pg.waitForTimeout(250);
    return pg;
  }
  const vis = (pg, sel) => pg.locator(sel).first().isVisible().catch(() => false);
  const words = (t) => (t.replace(/\s+/g, ' ').trim().match(/\S+/g) || []).length;
  async function areaWords(pg, area) {
    return pg.evaluate((a) => { const s = document.querySelector('.cbsh-sec.' + a); if (!s) return -1; return (s.innerText || '').replace(/\s+/g, ' ').trim().split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length; }, area);   /* words, not the chevron and icon glyphs beside them */
  }
  /* Q10: <= 100 words per area, Home <= 120 */
  const BUDGET = { home: 120, selling: 100, money: 100, running: 100, trade: 100, labs: 100, setup: 100 };
  fs.mkdirSync(SHOTS, { recursive: true });

  try {
    /* ── 2 + 3 · 1366, the real manifest, /entities/header 404 ── */
    {
      const { ctx, seen } = await profile(1366, 800), pg = await open(ctx);
      ok(await pg.locator('[data-testid="cbshell"]').count() === 1, '1366 · the shell mounts once');
      for (const id of ['shell-mark', 'shell-shop', 'shell-licence', 'shell-bell', 'shell-avatar']) ok(await pg.locator('[data-testid="shell-bar"] [data-testid="' + id + '"]').count() === 1, '1366 · the bar holds ' + id);
      ok(await pg.locator('[data-testid="shell-avatar"] [data-testid="cbavatar"] .cbav-btn').count() === 1 && await pg.locator('.cbav-btn').count() === 1, '1366 · the avatar is CBAvatar, and there is exactly one');
      ok(await pg.locator('[data-testid="shell-licence-chip"]').count() === 0, '1366 · no header answer → no licence chip');
      ok(seen.includes('/api/entities/header'), '1366 · the shell asked /api/entities/header');
      ok(!(await vis(pg, '[data-testid="shell-sheet"]')), '1366 · the sheet starts shut');
      await pg.click('[data-testid="shell-shop"]');
      ok(await vis(pg, '[data-testid="shell-sheet-empty"]'), '1366 · the shop name opens the sheet');
      const st = await pg.locator('[data-testid="shell-sheet"]').innerText();
      ok(/not available yet/i.test(st) && !/\d/.test(st.replace(/\b[A-Z]{2,4}\d{2,4}\b/g, '')), '1366 · 404 → the empty state says "not available yet" and shows no number ("' + st.replace(/\s+/g, ' ').trim() + '")');
      ok(await pg.getAttribute('[data-testid="shell-shop"]', 'aria-expanded') === 'true', '1366 · aria-expanded follows the sheet');
      await pg.screenshot({ path: path.join(SHOTS, 'shell-laptop-empty-sheet.png') });
      await pg.keyboard.press('Escape');
      ok(!(await vis(pg, '[data-testid="shell-sheet"]')), '1366 · Esc closes the sheet');
      /* cards from the real manifest */
      const built = man.entries.filter((e) => e.state === 'built').length, rest = man.entries.length - built;
      ok(await pg.locator('.cbsh-box').count() === built && await pg.locator('.cbsh-sc').count() === rest, '1366 · ' + built + ' cards and ' + rest + ' dashed chips from the manifest');
      ok(await pg.locator('.cbsh-main a[href*="app.html"]').count() === 0, '1366 · no link into app.html in the working area');
      /* NAMES-1: Running it draws flat, like Trade — its cards in one grid, no Operations / People sub-panels (the pillars stay on the rows) */
      ok(await pg.locator('.cbsh-sec.running .cbsh-pil').count() === 0 && await pg.locator('.cbsh-sec.running > .cbsh-grid [data-testid="shell-card-employees"]').count() === 1,
        '1366 · Running it is one flat group: no sub-panels, Employees a tile in it');
      /* 6 · the rail scrolls; scroll moves the highlight */
      await pg.click('[data-testid="shell-nav-labs"]'); await pg.waitForTimeout(1400);
      const top = await pg.evaluate(() => { const m = document.querySelector('.cbsh-main'), s = document.querySelector('.cbsh-sec.labs'); return Math.abs(m.scrollTop - (s.offsetTop - 6)) < 8 || m.scrollTop + m.clientHeight >= m.scrollHeight - 4; });
      ok(top && await pg.getAttribute('[data-testid="shell-nav-labs"]', 'aria-current') === 'true', '1366 · Labs on the rail scrolls the work area to Labs and lights it');
      await pg.evaluate(() => { const m = document.querySelector('.cbsh-main'); m.style.scrollBehavior = 'auto'; m.scrollTop = document.querySelector('.cbsh-sec.running').offsetTop; }); await pg.waitForTimeout(200);
      ok(await pg.getAttribute('[data-testid="shell-nav-running"]', 'aria-current') === 'true', '1366 · scrolling to Running moves the highlight (scroll-spy)');
      await pg.evaluate(() => { document.querySelector('.cbsh-main').scrollTop = 0; }); await pg.waitForTimeout(200);
      ok(await pg.getAttribute('[data-testid="shell-nav-home"]', 'aria-current') === 'true', '1366 · back at the top, Home is lit');
      for (const a of Object.keys(BUDGET)) { const n = await areaWords(pg, a); ok(n >= 0 && n <= BUDGET[a], '1366 · words in ' + a + ': ' + n + ' ≤ ' + BUDGET[a]); }
      ok(await pg.evaluate(() => !!document.querySelector('.cbsh-foot #cbkural')), '1366 · the kural is the footer band');
      await ctx.close();
    }

    /* ── 4 · 1366, N19 planted ── */
    {
      const { ctx } = await profile(1366, 800, { header: HEADER }), pg = await open(ctx);
      const chip = pg.locator('[data-testid="shell-licence-chip"]');
      ok(await chip.count() === 1 && await chip.getAttribute('data-band') === 'soon' && /FSSAI/.test(await chip.innerText()) && /18 days/.test(await chip.innerText()), '1366 · the chip carries the server\'s band and days ("' + (await chip.innerText().catch(() => '')).trim() + '")');
      ok(await pg.locator('[data-testid="shell-shop"] b').innerText() === 'Village Vegetables', '1366 · the shop name is the header\'s business name');
      await chip.click();
      ok(await vis(pg, '[data-testid="shell-sheet-full"]'), '1366 · the chip opens the sheet');
      ok(await pg.locator('[data-testid="shell-licence-row"]').count() === 4, '1366 · four licence rows');
      ok(await pg.locator('[data-testid="shell-renew"]').count() === 1 && await pg.getAttribute('[data-testid="shell-renew"]', 'href') === '/know-your-business.html#fssai', '1366 · one Renew, on the worst licence, to the server\'s renew_url');
      ok(await pg.locator('.cbsh-chk.y').count() === 3 && await pg.locator('[data-testid="shell-finish"]').count() === 1, '1366 · 3 of 4 checks done, Finish the checks offered');
      ok(/Late fee/.test(await pg.locator('[data-testid="shell-sheet"]').innerText()), '1366 · the penalty words are the server\'s note');
      const frac = await pg.evaluate(() => document.querySelector('.cbsh-hdr').getBoundingClientRect().height / innerHeight);
      console.log('  ..  1366×800 · header + open sheet = ' + (frac * 100).toFixed(1) + '% of the window (the prototype\'s cap: max(136px, 20vh − bar))');
      ok(frac <= 0.25, '1366 · header + open sheet ≤ 25% of the window (' + (frac * 100).toFixed(1) + '%)');
      await pg.waitForTimeout(300);
      await pg.screenshot({ path: path.join(SHOTS, 'shell-laptop.png') });
      await ctx.close();
    }

    /* ── 5 · a planted manifest: facts read, a failed read, dashed chips ── */
    {
      const { ctx } = await profile(1366, 800, { manifest: PLANTED }), pg = await open(ctx);
      await pg.waitForTimeout(300);
      ok(await pg.locator('.cbsh-box').count() === 3 && await pg.locator('.cbsh-sc').count() === 2, 'planted · 3 cards, 2 chips');
      ok(await pg.getAttribute('[data-testid="shell-card-till"]', 'href') === '/till.html', 'planted · a built card links to its route');
      const f = (await pg.locator('[data-testid="shell-facts-till"]').innerText()).replace(/\s+/g, ' ');
      const fm = await pg.$eval('[data-testid="shell-facts-till"]', (n) => (n.querySelector('.more') || {}).textContent || '');   /* one line on the tile + "+n"; every line in the drop-down */
      ok(/12 bills · (₹4,280|INR 4,?280)/.test(f) && /1 bill waiting to send Send now ›/.test(fm.replace(/\s+/g, ' ')) && !/{money}/.test(f + fm), 'planted · the facts lines are from the API (tile "' + f + '", drop-down "' + fm.trim() + '")');
      ok((await pg.locator('[data-testid="shell-facts-storefront"]').innerText()).trim() === '—', 'planted · a failed facts read shows —, never a number');
      ok(await pg.getAttribute('[data-testid="shell-chip-catalogue"]', 'data-state') === 'workshop' && await pg.getAttribute('[data-testid="shell-chip-orders"]', 'data-state') === 'coming', 'planted · workshop and coming are dashed chips with their state');
      ok(await pg.locator('[data-testid="shell-chip-catalogue"] a, a[data-testid="shell-chip-catalogue"]').count() === 0, 'planted · a workshop chip is not a link');
      await ctx.close();
    }

    /* ── 8 · 390: bottom tabs, one area at a time, kural on Home, no sideways scroll ── */
    {
      const { ctx } = await profile(390, 844, { header: HEADER }), pg = await open(ctx);
      const sw = () => pg.evaluate(() => document.scrollingElement.scrollWidth);
      ok(await sw() === 390, '390 · scrollWidth === 390 (' + await sw() + ')');
      const nav = await pg.evaluate(() => { const r = document.querySelector('.cbsh-nav').getBoundingClientRect(); return { bottom: Math.round(r.bottom), w: Math.round(r.width) }; });
      ok(nav.bottom === 844 && nav.w === 390, '390 · the seven areas are a bottom tab bar (' + JSON.stringify(nav) + ')');
      ok(await pg.evaluate(() => [...document.querySelectorAll('.cbsh-sec')].filter((s) => s.offsetParent).map((s) => s.dataset.area).join()) === 'home', '390 · one area at a time: Home');
      ok(await pg.evaluate(() => !!document.querySelector('[data-testid="shell-pfoot"] #cbkural')), '390 · the kural sits in the footer above the tab bar (never a card in Home)');
      await pg.screenshot({ path: path.join(SHOTS, 'shell-phone.png') });
      for (const a of Object.keys(BUDGET)) {
        const isMore = ['trade', 'labs', 'setup'].includes(a);
        await pg.click('[data-testid="shell-nav-' + (isMore ? 'more' : a) + '"]'); if (isMore) await pg.click('[data-testid="shell-row-' + a + '"]'); await pg.waitForTimeout(120);   /* five tabs: Trade, Labs and Setup are rows on More */
        const shown = await pg.evaluate(() => [...document.querySelectorAll('.cbsh-sec')].filter((s) => s.offsetParent).map((s) => s.dataset.area).join());
        const n = await areaWords(pg, a);
        ok((isMore ? shown === 'trade,labs,setup' : shown === a) && n <= BUDGET[a] && await sw() === 390, '390 · tab ' + a + ' shows only ' + a + ', ' + n + ' words ≤ ' + BUDGET[a] + ', no sideways scroll');
        if (a === 'selling') await pg.screenshot({ path: path.join(SHOTS, 'shell-phone-selling.png') });
      }
      await pg.click('[data-testid="shell-nav-home"]');
      ok(/18 days/.test(await pg.locator('[data-testid="shell-licence-chip"]').innerText()), '390 · the chip shows the days');
      await pg.click('[data-testid="shell-shop"]'); await pg.waitForTimeout(150);
      const sh = await pg.evaluate(() => { const r = document.querySelector('.cbsh-sheet').getBoundingClientRect(); return { l: r.left, r: Math.round(r.right), b: r.bottom }; });
      ok(await vis(pg, '[data-testid="shell-sheet-full"]') && sh.l === 0 && sh.r === 390 && sh.b <= 844 && await sw() === 390, '390 · the sheet drops over the page, inside the screen, no sideways scroll');
      await pg.click('[data-testid="shell-scrim"]', { position: { x: 200, y: 830 } }).catch(() => {});
      await pg.keyboard.press('Escape');
      ok(!(await vis(pg, '[data-testid="shell-sheet"]')), '390 · the sheet closes');
      await ctx.close();
    }

    /* ── 9 · inside an app: the switcher ── */
    for (const [vw, vh] of [[1366, 800], [390, 844]]) {
      const { ctx } = await profile(vw, vh), pg = await open(ctx, '?mode=app&app=accounts');
      ok(await pg.locator('[data-testid="shell-nav"]').count() === 0 && await pg.locator('[data-testid="shell-switcher"]').count() === 1, vw + ' · inside an app: no rail, one switcher');
      /* a phone: the switcher is its icon (INT7b) - the screen chip names the screen; the name shows from 1366 */
      if (vw === 390) ok(await pg.locator('[data-testid="shell-switcher"]').isVisible() && !(await pg.locator('[data-testid="shell-switcher"] .sn').first().isVisible().catch(() => false)), vw + ' · the switcher is an icon (the app name is the screen chip\x27s)');
      else ok(/Accounts/.test(await pg.locator('[data-testid="shell-switcher"]').innerText()), vw + ' · the switcher names the app');
      await pg.click('[data-testid="shell-switcher"]');
      const links = await pg.$$eval('[data-testid="shell-switcher-menu"] a', (as) => as.map((a) => a.getAttribute('href')));
      ok(links.join() === '/,/#selling,/#money,/#running,/#trade,/#labs,/#setup', vw + ' · the switcher lists the seven areas (' + links.join(' ') + ')');
      ok(await pg.getAttribute('[data-testid="shell-switch-running"]', 'aria-current') === 'true', vw + ' · the app\'s own area is marked');
      const r = await pg.evaluate(() => { const b = document.querySelector('.cbsh-swpop').getBoundingClientRect(); return { r: b.right, sw: document.scrollingElement.scrollWidth }; });
      console.log("      menu right edge "+r.r+" of "+vw+", scrollWidth "+r.sw);
      ok(r.r <= vw && (vw !== 390 || r.sw === 390), vw + ' · the switcher menu stays inside the screen' + (vw === 390 ? ', scrollWidth ' + r.sw : ''));
      ok(await vis(pg, '[data-testid="lab-app"]'), vw + ' · the app draws in the work slot');
      if (vw === 390) await pg.screenshot({ path: path.join(SHOTS, 'shell-app-phone.png') });
      await pg.keyboard.press('Escape');
      ok(!(await vis(pg, '[data-testid="shell-switcher-menu"]')), vw + ' · Esc closes the switcher');
      await ctx.close();
    }

    /* ── 10 · the bar only; signed out ── */
    {
      const { ctx } = await profile(390, 844), pg = await open(ctx, '?mode=bar');
      ok(await pg.locator('[data-testid="shell-bar"]').count() === 1 && await pg.locator('.cbsh-main, .cbsh-nav, .cbsh-foot').count() === 0, 'bar · the header bar and nothing else');
      ok(await pg.evaluate(() => document.scrollingElement.scrollWidth) === 390, 'bar · 390 wide, no sideways scroll');
      await ctx.close();
    }
    {
      const { ctx, seen } = await profile(1366, 800, { signedOut: true }), pg = await open(ctx);
      ok(await pg.locator('[data-testid="shell-shop"]').count() === 0 && await pg.locator('[data-testid="shell-sheet"]').count() === 0, 'signed out · no shop button, no sheet');
      ok(await pg.locator('[data-testid="shell-avatar"] [data-testid="signin-door"]').count() === 1, 'signed out · the avatar is the Sign in door');
      ok(!seen.includes('/api/entities/header'), 'signed out · /api/entities/header is never asked');
      await ctx.close();
    }

    ok(errs.length === 0, 'no page error' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  } finally { await b.close(); web.close(); }
  return out;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    console.log('  (free memory ' + (require('os').freemem() / 1073741824).toFixed(1) + ' GB)');
    const r = await run({});
    console.log('\n  ' + r.pass + ' passed, ' + r.fail + ' failed');
    process.exit(r.fail ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

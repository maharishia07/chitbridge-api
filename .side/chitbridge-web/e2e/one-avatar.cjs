#!/usr/bin/env node
/* one-avatar.cjs — ONE AVATAR ON EVERY PAGE, PROVED (public/app/avatar.js · DECISIONS.md "The avatar is ONE control").
 * Pattern: cblist-shots.cjs — Playwright, the stand-in API of books-web.cjs answering INSIDE the page, a static server on a free OS
 * port. Nothing here reaches localhost:3000, port 7351 or the live site: every /api/** call is fulfilled by ctx.route.
 *
 * What it proves (exit 1 on any failure):
 *   1  the avatar is present on app · CB Accounts · index · the List Lab, and its menu is the frozen simple one: a short header,
 *      Profile, Appearance (My device + every engine theme), four growing A's, Normal / Bold, Less motion, five fonts in their own
 *      faces, Support, Sign out — and no paragraph
 *   2  Settings is on app.html for the owner and on no other page
 *   3  a theme chosen on one page is the next page's theme (data-theme AND the page's own background); Terminal brings the mono face
 *   4  text size Large multiplies the eight --fs tokens by 1.15 and keeps their order; --k follows
 *   5  Bold: regular text 600, what was bold stays stronger
 *   6  Less motion: <html data-motion="reduce"> and transitions stop
 *   7  Sign out on one page signs out the others (index, CB Accounts, the app)
 *   8  the person's appearance syncs: a choice is PATCHed to /api/entities/me/prefs/ui, and a fresh device is dressed from /me
 *   9  390 px: no sideways scroll, menu open or shut, and the menu stays inside the screen
 *  11  a short window (1280×800, 390×700): the menu bottom is inside the window and every font row is reachable
 *  10  static: no second avatar builder anywhere; every page that reads cb_sess loads avatar.js
 * Screenshots: e2e/shots/one-avatar-{app,accounts,index}-{laptop,phone}.png · one-avatar-menu-open.png · one-avatar-terminal.png
 * Run one at a time:  NODE_PATH=e2e/node_modules node e2e/one-avatar.cjs
 * One-avatar-breaks.cjs imports run() and points it at a mutated COPY of the site.                                               */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const J = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });

/** a copy of the site as it deploys: public/ plus the repo-root index.html at its top */
function buildSite(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-avatar-'));
  fs.cpSync(path.join(ROOT, 'public'), dir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(dir, 'index.html'));
  if (mutate) mutate(dir);
  return dir;
}

const PAGES = [
  { id: 'app', hash: '/app.html#/app', testid: 'icon-avatar', ready: '[data-testid="icon-avatar"]' },
  { id: 'accounts', hash: '/accounts.html', testid: 'avatar', ready: '[data-testid="avatar"]' },
  { id: 'index', hash: '/', testid: 'avatar', ready: '[data-testid="avatar"]' },
  { id: 'list-lab', hash: '/list-lab.html', testid: 'avatar', ready: '[data-testid="avatar"]' },
];

/** run(site, { groups }) → { pass, fail, lines }. groups: static · present · theme · size · sync · signout · phone · short (default all) */
async function run(site, o) {
  o = o || {};
  const want = (g) => !o.groups || o.groups.includes(g);
  const inScope = (pg) => !o.pages || o.pages.includes(pg.id);   /* the breaks harness points a check at the one page it mutated */
  const { chromium } = require('@playwright/test');
  const { standIn, route: booksRoute } = require('./books-web.cjs');
  const { serve } = require('./lib/serve.cjs');
  const out = { pass: 0, fail: 0, lines: [] };
  const ok = (c, m) => { if (c) { out.pass++; out.lines.push('  ok  ' + m); } else { out.fail++; out.lines.push('  XX  FAIL · ' + m); } if (!o.quiet) console.log(out.lines[out.lines.length - 1]); };

  /* ── 10 · static: nothing but avatar.js builds an avatar ── */
  if (want('static')) {
    const files = [];
    (function walk(d) { fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const f = path.join(d, e.name); if (e.isDirectory()) { if (!/^(vendor|node_modules|docs|illustrations|pics|assets|cmdb)$/.test(e.name)) walk(f); } else if (/\.(html|js)$/.test(e.name)) files.push(f); }); })(site);
    const rel = (f) => path.relative(site, f).replace(/\\/g, '/');
    const BUILDER = /class="avmenu"|id="avmenu"|data-testid="avatar-menu"|class="avatar"|class="av"|UI\.avMenu|aria-label="[^"]*: your menu"/;
    const second = files.filter((f) => !/^(app\/avatar\.js|till\.html|till-sw\.js|cb-sw\.js)$/.test(rel(f)) && BUILDER.test(fs.readFileSync(f, 'utf8'))).map(rel);
    ok(second.length === 0, 'static · no second avatar builder anywhere in the site' + (second.length ? ' — found in: ' + second.join(', ') : ''));
    const exempt = /^(till\.html|shop\.html)$/;   /* the counter (vendored; wired in its own PR) · the storefront (reads the owner's token only, shows nobody) */
    const readers = files.filter((f) => /\.html$/.test(f) && !exempt.test(rel(f)) && /cb_sess/.test(fs.readFileSync(f, 'utf8')));
    const miss = readers.filter((f) => !/app\/avatar\.js/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    ok(readers.length >= 8 && miss.length === 0, 'static · every page that reads cb_sess loads avatar.js (' + readers.length + ' pages)' + (miss.length ? ' — missing on: ' + miss.join(', ') : ''));
    const noThemes = files.filter((f) => /\.html$/.test(f) && /app\/avatar\.js/.test(fs.readFileSync(f, 'utf8')) && !/engine\/screen\.js/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    ok(noThemes.length === 0, 'static · every page that loads avatar.js loads the engine themes (engine/screen.js) first' + (noThemes.length ? ' — missing on: ' + noThemes.join(', ') : ''));
  }
  if (!['present', 'theme', 'size', 'sync', 'signout', 'phone', 'short'].some(want)) return out;

  const S = standIn(), web = await serve(site), b = await chromium.launch(), errs = [];
  S.ui = {}; S.patches = [];
  const route = (r) => {
    const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
    if (p === '/api/entities/me' && m === 'GET') return J(r, 200, { entity: { display_name: 'Books Shop', currency_code: 'INR', ui_prefs: S.ui } });
    /* the server MERGES what it is sent (RFC 7386, api routes/entities.js savePrefSet; '' / null = removed) and /me reads it back — since FX-UX2 (F9)
       the server's ui_prefs is the truth, so a stand-in that answered ok:true and forgot the choice would reset the device on the next page */
    if (p === '/api/entities/me/prefs/ui' && m === 'PATCH') { try { const bd = JSON.parse(r.request().postData() || '{}'); S.patches.push(bd); Object.keys(bd).forEach((k) => { if (bd[k] == null || bd[k] === '') delete S.ui[k]; else S.ui[k] = bd[k]; }); } catch (_) {} return J(r, 200, { ok: true }); }
    return booksRoute(S, r);
  };
  const SESSION_INIT = (role) => {
    const b64 = (x) => btoa(JSON.stringify(x)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const tok = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-books', identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x';
    return JSON.stringify({ token: tok, role: role || 'entity', name: 'Books Shop', entity: 'Books Shop' });
  };
  /** a context = one browser profile (one localStorage), like one person's browser */
  async function profile(vw, vh, o2) {
    o2 = o2 || {};
    const ctx = await b.newContext({ viewport: { width: vw || 1366, height: vh || 800 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', route);
    if (!o2.signedOut) await ctx.addInitScript((s) => { try { if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', '1'); localStorage.setItem('cb_sess', s); } } catch (_) {} }, SESSION_INIT(o2.role));
    if (o2.prefs) await ctx.addInitScript((kv) => { try { if (!localStorage.getItem('__prefs')) { localStorage.setItem('__prefs', '1'); Object.keys(kv).forEach((k) => localStorage.setItem(k, kv[k])); } } catch (_) {} }, o2.prefs);
    return ctx;
  }
  async function open(ctx, pg) {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(pg.id + ': ' + String(e.message)));
    await p.goto(web.url(pg.hash));
    await p.waitForSelector(pg.ready, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(250);
    return p;
  }
  const btn = (p, pg) => p.locator('[data-testid="' + pg.testid + '"]');
  async function openMenu(p, pg) { if (!(await p.locator('[data-testid="avatar-menu"]').isVisible().catch(() => false))) await btn(p, pg).click(); await p.waitForSelector('[data-testid="avatar-menu"]', { timeout: 5000 }); }
  const cs = (p, sel, prop) => p.evaluate(([s, pr]) => getComputedStyle(document.querySelector(s))[pr], [sel, prop]);
  const html = (p, attr) => p.evaluate((a) => document.documentElement.getAttribute(a), attr);
  const tok = (p, name) => p.evaluate((n) => document.documentElement.style.getPropertyValue(n).trim(), name);
  const mem = () => (require('os').freemem() / 1073741824);

  try {
    /* ── 1 + 2 · present, and the frozen simple menu; Settings only in the app ── */
    if (want('present')) {
      for (const pg of PAGES.filter(inScope)) {
        const ctx = await profile(1366, 800), p = await open(ctx, pg);
        ok(await btn(p, pg).count() === 1, pg.id + ' · the avatar button is on the page (exactly one)');
        await openMenu(p, pg);
        const menu = p.locator('[data-testid="avatar-menu"]');
        const txt = (await menu.innerText()).replace(/\s+/g, ' ');
        const q = (id) => menu.locator('[data-testid="' + id + '"]').count();
        ok(/Books Shop/.test(txt) && /Owner/.test(txt), pg.id + ' · the header names the person and the role (name · role)');
        ok(await q('nav-profile') === 1 && await q('av-support') === (pg.id === 'app' ? 1 : 0) && await q('nav-signout') === 1, pg.id + ' · Profile · Sign out are in the menu; Support only where a support page exists (UX-96)');
        ok(/appearance/i.test(txt) && /My device/.test(txt) && /Terminal/.test(txt) && await menu.locator('[data-av-theme]').count() === 17, pg.id + ' · Appearance: My device + the 16 engine themes (Terminal among them) — ' + await menu.locator('[data-av-theme]').count() + ' dots');
        ok(await menu.locator('[data-av-fs]').count() === 4 && await menu.locator('[data-av-weight]').count() === 2 && await q('motion-switch') === 1, pg.id + ' · four growing A\'s · Normal / Bold · one Less motion switch');
        const sizes = await menu.locator('[data-av-fs]').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
        ok(sizes.every((v, i) => i === 0 || v > sizes[i - 1]), pg.id + ' · the four A\'s grow (' + sizes.join(' < ') + ')');
        const faces = await menu.locator('[data-av-font]').evaluateAll((els) => els.map((e) => getComputedStyle(e).fontFamily));
        ok(faces.length === 5 && new Set(faces).size === 5, pg.id + ' · five reading fonts, each in its own face');
        ok(txt.split(' ').length < 95 && !/[.!?] [A-Z]/.test(txt.replace(/e\.g\./g, '')), pg.id + ' · no explanatory text (' + txt.split(' ').length + ' words, no sentence)');
        const settings = await q('nav-settings');
        ok(settings === 1, pg.id + ' · Settings is in the owner menu on every page (UX-96)');
        if (pg.id === 'accounts') ok((await menu.locator('[data-testid="nav-profile"]').getAttribute('href')) === '/settings.html#/shop', 'accounts · Profile opens Settings › Your business, never the workshop');
        await p.keyboard.press('Escape');
        ok(!(await p.locator('[data-testid="avatar-menu"]').isVisible().catch(() => false)), pg.id + ' · Escape closes the menu');
        if (pg.id === 'app') {
          const co = await profile(1366, 800, { role: 'actor' }), p2 = await open(co, pg);
          await openMenu(p2, pg);
          ok(await p2.locator('[data-testid="nav-settings"]').count() === 0, 'app · a co-assist is never offered Settings');
          await co.close();
        }
        await ctx.close();
      }
      /* signed out: the index page's avatar is the Sign in door */
      if (inScope(PAGES[2])) {
      const ctx = await profile(1366, 800, { signedOut: true }), p = await open(ctx, { id: 'index', hash: '/', ready: '[data-testid="signin-door"]' });
      ok(await p.locator('[data-testid="signin-door"]').count() === 1 && await p.locator('[data-testid="avatar"]').count() === 0, 'index · signed out: the avatar is a "Sign in" door, and nothing else');
      await ctx.close();
      }
    }

    /* ── 3 · a theme chosen on one page is the next page's theme ── */
    if (want('theme')) {
      const ctx = await profile(1366, 800), idx = PAGES[2], p = await open(ctx, idx);
      await openMenu(p, idx);
      await p.click('[data-testid="theme-sand"]');
      ok((await html(p, 'data-theme')) === 'sand' && (await tok(p, '--paper')) === '#F3EDE1', 'theme · Sand chosen on the index page: <html data-theme="sand">, its tokens on the page');
      ok((await cs(p, 'body', 'backgroundColor')) === 'rgb(243, 237, 225)', 'theme · the index page itself is now Sand (' + await cs(p, 'body', 'backgroundColor') + ')');
      for (const pg of [PAGES[1], PAGES[0], PAGES[3]].filter(inScope)) {
        const q = await open(ctx, pg);
        const bg = pg.id === 'app' ? await cs(q, 'body', 'backgroundColor') : await cs(q, 'body', 'backgroundColor');
        ok((await html(q, 'data-theme')) === 'sand', 'theme · ' + pg.id + ' opens in Sand (data-theme)');
        if (pg.id !== 'app') ok(bg === 'rgb(243, 237, 225)', 'theme · ' + pg.id + '\'s own background follows the theme (' + bg + ')');
        await q.close();
      }
      /* Terminal: green screen, the mono face unless a font was chosen */
      await openMenu(p, idx); await p.click('[data-testid="theme-terminal"]');
      ok((await html(p, 'data-theme')) === 'terminal' && /mono/i.test(await tok(p, '--font-ui')), 'theme · Terminal brings the monospace face (' + (await tok(p, '--font-ui')).slice(0, 40) + ')');
      await p.click('[data-testid="font-serif"]');
      ok(/Georgia/.test(await tok(p, '--font-ui')), 'theme · a chosen reading font wins over Terminal\'s mono');
      await p.click('[data-testid="font-default"]');
      /* My device */
      await p.click('[data-testid="theme-device"]');
      ok((await p.evaluate(() => localStorage.getItem('cb_theme'))) === 'device' && (await html(p, 'data-theme')) === 'cream', 'theme · My device (light here) leaves no theme tokens behind');
      /* a stored name that no longer exists is never stamped on the document */
      await p.evaluate(() => localStorage.setItem('cb_theme', 'wobble')); await p.reload(); await p.waitForSelector('[data-testid="avatar"]');
      ok((await html(p, 'data-theme')) === 'cream', 'theme · a stale saved theme name falls back to Cream, never stamped');
      await ctx.close();
    }

    /* ── 4 · text size multiplies the eight --fs tokens, keeps their order ── */
    /* ⚠️ a page whose tokens are in rem (testing.html) — Large once read 0.8125rem as 0.8 px and drew the board at ~1 px (2026-10-07) */
    if (want('size') && !o.pages) {
      const pg = { id: 'testing', hash: '/testing.html', ready: '[data-testid="avatar"]' };
      const ctx = await profile(1366, 800, { prefs: { cb_fs: 'l' } }), p = await open(ctx, pg);
      await p.waitForTimeout(500);
      const px = await p.evaluate(() => [getComputedStyle(document.documentElement).getPropertyValue('--fs-1'), getComputedStyle(document.body).fontSize]);
      ok(parseFloat(px[0]) > 13 && /px$/.test(px[0].trim()), 'size · testing: Large turns --fs-1 (0.8125rem = 13px) into ~15px, never ~1px (' + px.join(' · ') + ')');
      await ctx.close();
    }
    if (want('size')) {
      for (const pg of [PAGES[0], PAGES[1], PAGES[2]].filter(inScope)) {
        const ctx = await profile(1366, 800), p = await open(ctx, pg);
        const TOK = ['--fs-1', '--fs-2', '--fs-3', '--fs-4', '--fs-5', '--fs-6', '--fs-7', '--fs-8'];
        const read = () => p.evaluate((t) => t.map((n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n))), TOK);
        const before = await read(), bodyBefore = parseFloat(await cs(p, 'body', 'fontSize'));
        await openMenu(p, pg); await p.click('[data-testid="fs-l"]');
        const after = await read(), k = await tok(p, '--k');
        if (pg.id === 'app') {
          ok(before.every((v) => v > 0) && after.every((v, i) => Math.abs(v / before[i] - 1.15) < 0.011), 'size · app: Large multiplies all eight --fs tokens by 1.15 (' + before.join('/') + ' → ' + after.join('/') + ')');
          ok(after.every((v, i) => i === 0 || v > after[i - 1]), 'size · app: the order of the eight is kept — a caption is still smaller than a heading');
        } else if (pg.id === 'accounts') {
          const own = before.slice(0, 3), ownAfter = after.slice(0, 3);
          ok(own.every((v) => v > 0) && ownAfter.every((v, i) => Math.abs(v / own[i] - 1.15) < 0.04), 'size · accounts: its own --fs-1..3 scale by 1.15 from ITS values (' + own.join('/') + ' → ' + ownAfter.join('/') + ')');
        }
        ok(k === '1.15', 'size · ' + pg.id + ': --k is 1.15 for the list control');
        if (pg.id !== 'app') ok(parseFloat(await cs(p, 'body', 'fontSize')) > bodyBefore * 1.1, 'size · ' + pg.id + ': the page text grows (' + bodyBefore + ' → ' + (await cs(p, 'body', 'fontSize')) + ')');
        ok((await p.evaluate(() => localStorage.getItem('cb_fs'))) === 'l', 'size · saved under the unchanged key cb_fs = l');
        ok(!(await p.evaluate(() => /zoom/.test(document.documentElement.getAttribute('style') || ''))), 'size · never zoom');
        /* bold */
        const w0 = parseInt(await cs(p, 'body', 'fontWeight'), 10);
        await p.click('[data-testid="weight-bold"]');
        const w1 = parseInt(await cs(p, 'body', 'fontWeight'), 10);
        ok((await html(p, 'data-weight')) === 'bold' && w1 === 600 && w0 < 600, 'bold · ' + pg.id + ': regular text goes ' + w0 + ' → ' + w1);
        const strong = await p.evaluate(() => { const e = document.querySelector('h1,b,strong'); return e ? parseInt(getComputedStyle(e).fontWeight, 10) : 0; });
        ok(strong >= 700, 'bold · ' + pg.id + ': what was bold stays the strongest (' + strong + ' > 600)');
        ok((await p.evaluate(() => localStorage.getItem('cb_weight'))) === 'bold', 'bold · saved as cb_weight = bold');
        /* motion */
        await p.click('[data-testid="motion-switch"]');
        ok((await html(p, 'data-motion')) === 'reduce' && (await p.locator('[data-testid="motion-switch"]').getAttribute('aria-checked')) === 'true', 'motion · ' + pg.id + ': Less motion sets <html data-motion="reduce"> and the switch is on');
        ok((await p.evaluate(() => getComputedStyle(document.querySelector('.cbav-toggle'), '::after').transitionDuration)) === '0s', 'motion · ' + pg.id + ': transitions stop (0s)');
        ok((await p.evaluate(() => localStorage.getItem('cb_motion'))) === 'reduce', 'motion · saved under the unchanged key cb_motion = reduce');
        await p.click('[data-testid="fs-m"]'); await p.click('[data-testid="weight-normal"]'); await p.click('[data-testid="motion-switch"]');
        ok((await html(p, 'data-weight')) === null && (await html(p, 'data-motion')) === null && (await tok(p, '--k')) === '', 'reset · ' + pg.id + ': back to Medium · Normal · motion leaves nothing on <html>');
        await ctx.close();
      }
    }

    /* ── 8 · the person's appearance follows them ── */
    if (want('sync')) {
      S.ui = {}; S.patches = [];
      const ctx = await profile(1366, 800), idx = PAGES[2], p = await open(ctx, idx);
      await openMenu(p, idx); await p.click('[data-testid="theme-slate"]'); await p.click('[data-testid="fs-xl"]'); await p.click('[data-testid="motion-switch"]');
      await p.click('[data-testid="font-serif"]'); await p.click('[data-testid="weight-bold"]');
      await p.waitForTimeout(900);
      const last = S.patches[S.patches.length - 1] || {};
      ok(last.theme === 'slate' && last.fs === 'xl' && last.motion === 'reduce', 'sync · a choice is PATCHed to /api/entities/me/prefs/ui as theme · fs · motion (' + JSON.stringify(last) + ')');
      ok(last.font === 'serif' && last.weight === 'bold', 'sync · CU3: reading font and bold reach the server too (were device-only)');
      await ctx.close();
      S.ui = { theme: 'azure', fs: 'l', motion: 'reduce', font: 'wide', weight: 'bold' };
      const fresh = await profile(1366, 800), q = await open(fresh, idx);
      await q.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'azure', null, { timeout: 5000 }).catch(() => {});
      ok((await html(q, 'data-theme')) === 'azure' && (await q.evaluate(() => localStorage.getItem('cb_fs'))) === 'l' && (await html(q, 'data-motion')) === 'reduce', 'sync · a fresh device is dressed from the server (azure · large · less motion)');
      ok((await q.evaluate(() => localStorage.getItem('cb_font'))) === 'wide' && (await html(q, 'data-weight')) === 'bold', 'sync · CU3: …and in the reading font and bold the person chose elsewhere');
      await fresh.close(); S.ui = {};
      /* offline is silent */
      const off = await profile(1366, 800), po = await open(off, idx);
      await off.setOffline(true); await openMenu(po, idx); await po.click('[data-testid="theme-ruby"]');
      ok((await html(po, 'data-theme')) === 'ruby', 'sync · offline: the look still changes, nothing complains');
      await off.close();
    }

    /* ── 7 · Sign out on one page signs out the others ── */
    if (want('signout')) {
      const ctx = await profile(1366, 800), idx = PAGES[2], acc = PAGES[1], app = PAGES[0];
      const pi = await open(ctx, idx), pa = await open(ctx, acc), pp = await open(ctx, app);
      await openMenu(pa, acc);
      await Promise.all([pa.waitForURL(/app\.html#\/login/, { timeout: 15000 }).catch(() => {}), pa.click('[data-testid="nav-signout"]')]);
      ok(!(await pa.evaluate(() => localStorage.getItem('cb_sess'))), 'signout · the session is gone from the browser');
      await pi.waitForSelector('[data-testid="signin-door"]', { timeout: 8000 }).catch(() => {});
      ok(await pi.locator('[data-testid="signin-door"]').count() > 0 && await pi.locator('[data-testid="avatar"]').count() === 0, 'signout · the index page follows (signed out, the avatar is the Sign in door)');
      await pp.waitForTimeout(800);
      ok(await pp.evaluate(() => { try { return !SESSION.token; } catch (_) { return false; } }), 'signout · the app tab follows (no session)');
      await ctx.close();
    }

    /* ── 9 · 390 px ── */
    if (want('phone')) {
      for (const pg of PAGES.filter(inScope)) {
        const ctx = await profile(390, 844), p = await open(ctx, pg);
        const sw = () => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth }));
        let w = await sw();
        ok(w.sw <= 390, pg.id + ' · 390 px: no sideways scroll, menu shut (scrollWidth ' + w.sw + ')');
        await openMenu(p, pg); w = await sw();
        const r = await p.locator('[data-testid="avatar-menu"]').boundingBox();
        ok(w.sw <= 390 && r && r.x >= 0 && r.x + r.width <= 390.5, pg.id + ' · 390 px: menu open — no sideways scroll, menu inside the screen (x ' + (r && Math.round(r.x)) + '…' + (r && Math.round(r.x + r.width)) + ')');
        await ctx.close();
      }
    }

    /* ── 11 · a SHORT window: the menu fits, or scrolls itself; no row is ever cut ── */
    if (want('short')) {
      for (const [vw, vh] of [[1280, 800], [390, 700]]) {
        for (const pg of PAGES.filter(inScope)) {
          const ctx = await profile(vw, vh), p = await open(ctx, pg);
          await openMenu(p, pg); await p.waitForTimeout(150);
          const m = await p.evaluate(() => {
            const pop = document.querySelector('[data-testid="avatar-menu"]'), r = pop.getBoundingClientRect();
            const rows = [...pop.querySelectorAll('[data-av-font]')], last = rows[rows.length - 1];
            const out = { sh: pop.scrollHeight, ch: pop.clientHeight, bottom: r.bottom, ih: innerHeight, fits: pop.scrollHeight <= pop.clientHeight + 1, n: rows.length, ov: getComputedStyle(pop).overflowY };
            last.scrollIntoView({ block: 'nearest' });
            const lr = last.getBoundingClientRect(), pr = pop.getBoundingClientRect();
            out.lastIn = lr.top >= pr.top - 1 && lr.bottom <= pr.bottom + 1 && lr.bottom <= innerHeight + 1;
            const so = pop.querySelector('[data-av="signout"]'); if (so) { so.scrollIntoView({ block: 'nearest' }); const q = so.getBoundingClientRect(); out.soIn = q.bottom <= innerHeight + 1 && q.bottom <= pop.getBoundingClientRect().bottom + 1; }
            return out;
          });
          ok(m.bottom <= m.ih + 0.5, pg.id + ' · ' + vw + '×' + vh + ': the menu bottom ' + Math.round(m.bottom) + ' ≤ the window ' + m.ih);
          ok(m.n >= 5 && m.lastIn, pg.id + ' · ' + vw + '×' + vh + ': every one of the ' + m.n + ' font rows is reachable');
          ok(m.soIn !== false, pg.id + ' · ' + vw + '×' + vh + ': Sign out is reachable');
          if (vw >= 1000) ok(m.fits, pg.id + ' · ' + vw + '×' + vh + ': nothing is hidden at all — no inner scroll needed (' + m.sh + ' of ' + m.ch + ')');
          await ctx.close();
        }
      }
    }

    /* ── pictures: the page with its avatar, laptop and phone; the open menu; Terminal ── */
    if (want('present') && !o.noShots) {
      fs.mkdirSync(SHOTS, { recursive: true });
      for (const [dev, vw, vh] of [['laptop', 1280, 800], ['phone', 390, 844]]) {
        for (const pg of PAGES.slice(0, 3)) {
          const ctx = await profile(vw, vh), p = await open(ctx, pg);
          await p.waitForTimeout(400);
          await p.screenshot({ path: path.join(SHOTS, 'one-avatar-' + pg.id + '-' + dev + '.png') });
          if (pg.id === 'app' && dev === 'laptop') { await openMenu(p, pg); await p.waitForTimeout(150); await p.screenshot({ path: path.join(SHOTS, 'one-avatar-menu-open.png') }); }
          if (pg.id === 'app' && dev === 'phone') { await openMenu(p, pg); await p.waitForTimeout(150); await p.screenshot({ path: path.join(SHOTS, 'one-avatar-menu-open-phone.png') }); }
          await ctx.close();
        }
      }
      const ctx = await profile(1366, 800, { prefs: { cb_theme: 'terminal' } }), p = await open(ctx, PAGES[0]);
      await p.waitForTimeout(400); await p.screenshot({ path: path.join(SHOTS, 'one-avatar-terminal.png') });
      await openMenu(p, PAGES[0]); await p.waitForTimeout(150); await p.screenshot({ path: path.join(SHOTS, 'one-avatar-terminal-menu.png') });
      await ctx.close();
    }
    const real = errs.filter((e) => !/Failed to fetch|NetworkError|Load failed|aborted/i.test(e));
    if (!o.groups || o.groups.includes('present')) ok(real.length === 0, 'no page error on any page' + (real.length ? ': ' + real.slice(0, 3).join(' | ') : ''));
  } finally { await b.close(); web.close(); }
  return out;
}

module.exports = { run, buildSite, PAGES };

if (require.main === module) {
  (async () => {
    const free = require('os').freemem() / 1073741824;
    console.log('  (free memory ' + free.toFixed(1) + ' GB)');
    const site = buildSite();
    const r = await run(site, {});
    fs.rmSync(site, { recursive: true, force: true });
    console.log('\n  ' + r.pass + ' passed, ' + r.fail + ' failed');
    process.exit(r.fail ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

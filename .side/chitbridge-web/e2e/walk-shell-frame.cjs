#!/usr/bin/env node
/**
 * e2e/walk-shell-frame.cjs — THE TOUR: EVERY PAGE WEARS THE SAME FRAME AS HOME (round SHELL-ONE, 2026-10-15).
 *
 * Athi, 14 Oct (VTOUR): *"i could find lot of in-consistencies in each page before sign-in itself"* — five different headers, four body fonts,
 * most apps without Home or a sign-in door. This walks EVERY customer page (Home, every manifest route, the storefront, the shop screen, the
 * labs) and holds each to the frame Home draws (public/app/shell.js through public/app/page-frame.js):
 *
 *   FRAME ROWS (hard — any one red fails the tour)                       per page, signed in, 1366 px
 *     shell    the shared shell header is drawn, once              [data-testid="shell-header"]
 *     home     ⌂ Home is in it (Home itself: the rail)              [data-testid="shell-home"]
 *     avatar   the ONE avatar, in the frame, nowhere else          [data-testid="shell-avatar"] .cbav-btn · no second .cbav-btn
 *     chip     the screen chip names the screen                     [data-testid="screen-id"][data-cbsid]
 *     font     the body face is the index's (SYSTEM.md §2)          computed font-family === Home's
 *     own      no header of the page's own                          no <header>, .top, .bar, #cb-avatar, #cbav in the page
 *     error    no script error
 *   SIGNED OUT (hard)                                                    per page, 1366 px
 *     the frame still draws; the avatar is the "Sign in" door       [data-testid="signin-door"]
 *   RULE 13 on the FRAME (hard) — Cream and Dark, 1366 and 390 px: every text IN the frame reads at AA, nothing in the frame is clipped or
 *     covered, the page has no sideways scroll, and no link into app.html.
 *   BODY CONTRAST (a ratchet — e2e/walk-shell-frame.baseline.json): the count of AA failures OUTSIDE the frame per page · theme · width may only
 *     FALL; `--write` records today's counts after a count went down. A page's own colours are its own round; this tour keeps them from
 *     getting worse and says where they stand.
 *
 * NOT WALKED, and why: public/till.html is VENDORED from chitbridge-api (its bar is the api's round); app.html is the workshop (index-not-app);
 * the DESIGN REFERENCES (public/app/screen-id.js DECLARED.references) are not customer navigation. The pages list is DERIVED from the manifest
 * (+ the storefront pages and the labs it links) so a new card is walked the day it lands.
 *
 * A FIXTURE SHOP: the site is served from this checkout (e2e/lib/serve.cjs), the API is a stand-in inside the page — a 404 for every read, which
 * the frame must survive (an empty state, never a blank header). Nothing reaches localhost:3000 or the live site.
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-shell-frame.cjs            ONLY=shop,crm narrows the pages · --write lowers the ratchet
 * Screenshots: e2e/shots/tour/<page>.png (1366, Cream, signed in).
 */
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('@playwright/test');
const { serve } = require('./lib/serve.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const { audit } = require('./lib/rule13.cjs');
const TD = require('./lib/today.cjs');   /* QW1-TODAY: the one injected today — never the runner's clock */

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots', 'tour');
const BASELINE = path.join(__dirname, 'walk-shell-frame.baseline.json');
const WRITE = process.argv.includes('--write');
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const SHOP = 'CBWALK0001';

/* ── the pages: Home + every manifest route (one row per page file) + the storefront pages + the labs those link ── */
function pages() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'app', 'manifest.json'), 'utf8'));
  const seen = new Map();
  const add = (url, name) => { const file = url.split(/[?#]/)[0]; if (!seen.has(file)) seen.set(file, { url, name }); };
  add('/', 'Home');
  manifest.entries.forEach((e) => { if (e.state === 'built' && e.route && !/^https?:\/\//.test(e.route) /* TEMPORARY Coverage card (UX-141): not a page of ours */) add(e.route.replace('{bridge_id}', SHOP), e.name); });
  add('/network-shop.html?bridge=' + SHOP, 'Network shop'); add('/store.html?net=' + SHOP, 'Store'); add('/embed.html?bridge=' + SHOP, 'Catalogue embed');
  add('/promo.html', 'Shop screen'); add('/country-lab.html', 'Country lab'); add('/conversion-lab.html', 'Conversion lab');
  seen.delete('/till.html');          /* VENDORED: the counter's bar is the api's round */
  seen.delete('/combo-lab.html');     /* forwards to offer-lab-next.html?mode=combo (walked as the Offer Lab) */
  return Array.from(seen.values()).filter((p) => !ONLY.length || ONLY.some((o) => p.url.indexOf(o) >= 0 || p.name.toLowerCase().indexOf(o) >= 0));
}
const pageKey = (p) => (p.url === '/' ? 'index' : p.url.split(/[?#]/)[0].replace(/^\//, '').replace(/\.html$/, ''));
/* the page's SOURCE draws no header of its own: no <header>, no .top / .bar header, no CBAvatar.mount, no avatar slot (comments stripped) */
function ownHeaderInSource(p) {
  const file = p.url === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, 'public', p.url.split(/[?#]/)[0].replace(/^\//, ''));
  const src = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const hits = [];
  if (/<header[\s>]/.test(src)) hits.push('<header>');
  if (/<header[^>]*class="(top|bar)"|<div class="top">/.test(src)) hits.push('.top/.bar header');
  if (/CBAvatar\.mount\(/.test(src)) hits.push('CBAvatar.mount');
  if (/id="(cb-avatar|cbav)"/.test(src)) hits.push('avatar slot');
  return hits.join(' ');
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const TOKEN = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-tour', identity_type: 'entity', exp: Math.floor(TD.nowMs() / 1000) + 3600 }) + '.x';
const SESSION = JSON.stringify({ token: TOKEN, role: 'entity', name: 'Fixture Owner', entity: 'Fixture Shop', bridgeId: SHOP });

/* runs in the page: the frame rows */
function frameRows() {
  const q = (s) => document.querySelector(s), n = (s) => document.querySelectorAll(s).length;
  const own = (q('body > header') ? 'body>header ' : '') + (q('main > header, .main > header') ? 'main>header ' : '') + (q('.who .home, a.home, #cb-avatar, #cbav') ? 'own-home/avatar ' : '');
  /* the FRAME is the shell's header (a CBFrame page without a skeleton puts its whole body in the shell's work slot — that is the page, not the frame) */
  const hdr = q('[data-testid="shell-header"]'); if (hdr && !hdr.id) hdr.id = '__tourframe';
  const shellTexts = Array.from(document.querySelectorAll('[data-testid="shell-header"] *')).map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28)).filter(Boolean);
  return {
    shell: n('[data-testid="shell-header"]'), home: !!q('[data-testid="shell-home"]') || !!q('[data-testid="shell-nav-home"]'),
    avatar: n('[data-testid="shell-avatar"] .cbav-btn, [data-testid="shell-avatar"] [data-testid="signin-door"]'), avatars: n('.cbav-btn, [data-testid="signin-door"]'),
    chip: !!q('[data-testid="screen-id"][data-cbsid]'), font: getComputedStyle(document.body).fontFamily, own: own.trim(), signin: n('[data-testid="signin-door"]'),
    shellTexts, sw: document.documentElement.scrollWidth, iw: innerWidth, appLinks: Array.from(document.querySelectorAll('a[href*="app.html"]')).length
  };
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
  const counts = {};
  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? '  ok  ' : '  XX  ') + m); };
  const web = await serve(), browser = await chromium.launch();
  const open = async (signedIn, width) => {
    const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 768 : 844 }, serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route(/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"message":"not in this stand-in"}}' }));
    await ctx.addInitScript(([s, on]) => { try { localStorage.setItem('cb_api_base', location.origin); if (on) localStorage.setItem('cb_sess', s); else localStorage.removeItem('cb_sess'); localStorage.removeItem('cb_theme'); } catch (_) {} }, [SESSION, signedIn]);
    const page = await ctx.newPage(), errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
    return { ctx, page, errs };
  };
  let indexFont = null;
  try {
    for (const pg of pages()) {
      const key = pageKey(pg), tag = key.padEnd(18);
      /* ── signed in, 1366: the frame rows ── */
      const { ctx, page, errs } = await open(true, 1366);
      await page.goto(web.url(pg.url)); await page.waitForTimeout(1200);
      const r = await page.evaluate(frameRows);
      if (key === 'index') indexFont = r.font;
      ok(r.shell === 1, tag + ' draws the shared shell header once (' + r.shell + ')');
      ok(r.home, tag + ' has ⌂ Home in the frame' + (key === 'index' ? ' (the rail)' : ''));
      ok(r.avatar === 1 && r.avatars === 1, tag + ' has the ONE avatar, in the frame (' + r.avatar + ' in the frame, ' + r.avatars + ' on the page)');
      ok(r.chip, tag + ' shows its screen chip');
      ok(indexFont && r.font === indexFont, tag + ' body font = Home\'s (' + r.font + ')');
      const own = ownHeaderInSource(pg);
      ok(!r.own && !own, tag + ' draws no header of its own' + (r.own ? ' — ' + r.own : '') + (own ? ' — in the source: ' + own : ''));
      ok(r.appLinks === 0, tag + ' no link into the workshop (app.html)');
      ok(errs.length === 0, tag + ' no script error' + (errs.length ? ' — ' + errs[0] : ''));
      await page.screenshot({ path: path.join(SHOTS, key + '.png') }).catch(() => {});
      /* ── rule 13 on the frame; the body as a ratchet ── */
      for (const theme of ['cream', 'dark']) {
        for (const width of [1366, 390]) {
          await page.setViewportSize({ width, height: width > 500 ? 768 : 844 });
          await page.evaluate((t) => { if (window.CBAvatar) CBAvatar.applyTheme(t); }, theme); await page.waitForTimeout(200);
          const pairs = await page.evaluate(measure), rows = await page.evaluate(frameRows), a = await audit(page, '__tourframe');
          const inFrame = (x) => rows.shellTexts.includes(x.text);
          const frameBad = pairs.filter((x) => inFrame(x) && !x.grad && x.ratio < x.need), bodyBad = pairs.filter((x) => !inFrame(x) && !x.grad && x.ratio < x.need);
          const id = key + '·' + theme + '·' + width, t2 = tag + ' ' + theme + ' ' + width + 'px';
          ok(frameBad.length === 0, t2 + ' frame AA' + (frameBad.length ? ' — ' + frameBad.slice(0, 3).map((x) => x.ratio + ' "' + x.text + '"').join(' · ') : ''));
          ok(a.clip.length === 0 && a.cover.length === 0, t2 + ' frame not clipped, nothing over its controls' + (a.clip.length ? ' — clipped ' + a.clip[0] : '') + (a.cover.length ? ' — covered ' + a.cover[0] : ''));
          ok(rows.sw <= rows.iw + 1 && a.app.length === 0, t2 + ' no sideways scroll (' + rows.sw + '/' + rows.iw + '), no app.html link');
          counts[id] = bodyBad.length;
          if (process.env.WSF_SHOW && bodyBad.length) bodyBad.forEach((x) => console.log('       under · ' + t2 + ' · ' + x.ratio + ' (need ' + x.need + ') "' + x.text + '"'));  /* WSF_SHOW=1: name each body text that reads under AA, so the ratchet can be paid down */
          const was = baseline[id];
          ok(was == null || bodyBad.length <= was, t2 + ' body AA failures ' + bodyBad.length + (was == null ? ' (new page: recorded)' : was === bodyBad.length ? ' (= ratchet)' : bodyBad.length < was ? ' (down from ' + was + ' — lower the ratchet: --write)' : ' — UP from ' + was + ': ' + bodyBad.slice(0, 3).map((x) => x.ratio + ' "' + x.text + '"').join(' · ')));
        }
      }
      await ctx.close();
      /* ── signed out, 1366: the frame still draws, the avatar is the Sign in door ── */
      const out = await open(false, 1366);
      await out.page.goto(web.url(pg.url)); await out.page.waitForTimeout(1000);
      const s = await out.page.evaluate(frameRows);
      ok(s.shell === 1 && s.signin >= 1 && s.avatars === 1, tag + ' signed out: the frame draws and the avatar is the Sign in door (' + s.signin + ')');
      ok(out.errs.length === 0, tag + ' signed out: no script error' + (out.errs.length ? ' — ' + out.errs[0] : ''));
      await out.ctx.close();
    }
  } finally { await browser.close(); web.close(); }
  if (WRITE || !fs.existsSync(BASELINE)) { fs.writeFileSync(BASELINE, JSON.stringify(counts, null, 1) + '\n'); console.log('  ..  ratchet written: ' + BASELINE); }
  console.log('\nwalk-shell-frame: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

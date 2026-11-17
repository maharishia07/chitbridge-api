#!/usr/bin/env node
/* lab-frame.cjs — UX-90: every lab wears the ONE Finance frame, and the cross-lab rules (walk 21 Oct W9 / W10 / W15) are shared helpers.
 * Proves (exit 1 on any failure):
 *   static  every lab page loads page-frame.js + lab-kit.js and calls CBFrame.lab; none keeps a bar-only mount of its own; the Labs list in lab-kit.js
 *           names the same routes as app/manifest.json's built labs (kept this round; cb-janitor retires it)
 *   page    each lab opens in the frame (sidebar + main), with the shell's own switcher naming the lab (W16: the left menu holds THIS lab's choices, never the other labs), the title "<Name> Lab · ChitBridge",
 *           the page face (never Times New Roman), no page error and no console error, at 1280 and at 390
 *   kit     plain words keep the code in the tooltip · "Not set up for <country> yet" · a reason instead of a blank · three lines + "and N more" that
 *           opens the CBList in a popup · progress "x of y ready · next: …" · Ready / Nearly / Not started · red only for a blocker
 * Nothing reaches a live server: every /api call and the production api host are answered here. Run one at a time:  node e2e/lab-frame.cjs */
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const LABS = [
  { id: 'product-lab', file: '/product-lab.html', title: 'Product Lab · ChitBridge' },
  { id: 'offer-lab', file: '/offer-lab-next.html', title: 'Offer Lab · ChitBridge' },
  { id: 'combo-lab', file: '/offer-lab-next.html?mode=combo', title: 'Combo Lab · ChitBridge' },
  { id: 'conversion-lab', file: '/conversion-lab.html', title: 'Conversion Lab · ChitBridge' },
  { id: 'country-lab', file: '/country-lab.html', title: 'Country Lab · ChitBridge' },
  { id: 'network-lab', file: '/network-design.html', title: 'Network Lab · ChitBridge' },
  { id: 'list-lab', file: '/list-lab.html', title: 'List Lab · ChitBridge' },
  { id: 'signin-lab', file: '/signin-lab.html', title: 'Sign-in Lab · ChitBridge' },
  { id: 'shell-lab', file: '/shell-lab.html', title: 'Shell Lab · ChitBridge' }
];
const out = { pass: 0, fail: 0 };
const ok = (c, m) => { if (c) out.pass++; else out.fail++; console.log((c ? '  ok  ' : '  XX  ') + m); };

function staticChecks() {
  const seen = new Set();
  for (const lab of LABS) {
    const file = lab.file.split('?')[0];
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(path.join(PUB, file), 'utf8');
    ok(/app\/page-frame\.js/.test(src) && /app\/lab-kit\.js/.test(src) && /CBFrame\.lab\(/.test(src), file + ' · static · loads the frame and the lab kit and calls CBFrame.lab');
    ok(!/CBFrame\.mount\(\s*\{\s*app/.test(src.replace(/<!--[\s\S]*?-->/g, '')), file + ' · static · no bar-only mount of its own');
    ok(/page-skeleton\.css/.test(src) && /lab-kit\.css/.test(src), file + ' · static · links the one skeleton stylesheet and the lab kit');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(PUB, 'app', 'manifest.json'), 'utf8'));
  const kit = fs.readFileSync(path.join(PUB, 'app', 'lab-kit.js'), 'utf8');
  (manifest.entries || []).filter((e) => e.pillar === 'labs' && e.state === 'built' && e.route && !/^https?:\/\//.test(e.route)).forEach((e) =>
    ok(kit.indexOf("route: '" + e.route + "'") >= 0, 'lab-kit.js · Labs list has the manifest lab ' + e.name + ' (' + e.route + ')'));
}

/* the string layer (locale): the name the switcher shows is the name in the page title, so one name per lab */
const kitSource = fs.readFileSync(path.join(PUB, 'app', 'lab-kit.js'), 'utf8');
LABS.forEach((lab) => ok(kitSource.indexOf("name: '" + lab.title.split(' · ')[0] + "'") >= 0, 'string layer · locale · the switcher names ' + lab.id + ' as its title does'));
async function pageChecks(browser, serve) {
  for (const size of [{ w: 1280, h: 800, n: 'wide' }, { w: 390, h: 800, n: 'phone' }]) {
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route(/railway\.app/, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
    await ctx.route('**/api/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
    for (const lab of LABS) {
      const errs = [], page = await ctx.newPage();
      page.on('pageerror', (e) => errs.push(String(e.message)));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|404/.test(m.text())) errs.push(m.text()); });
      await page.goto(serve.url(lab.file), { waitUntil: 'load' });
      await page.waitForTimeout(1200);
      const got = await page.evaluate((id) => ({
        title: document.title,
        framed: !!document.querySelector('[data-testid="skel-app"]') && !!document.querySelector('[data-testid="skel-main"]'),
        otherLabsInMenu: document.querySelectorAll('[data-testid="skel-labs"], .side .lab-link').length,
        switcher: (document.querySelector('[data-testid="shell-switcher"]') || {}).textContent || '',
        font: getComputedStyle(document.body).fontFamily,
        shells: document.querySelectorAll('[data-testid="shell-header"]').length,
        text: document.body.innerText,
        menu: (() => { /* the lit menu entry: its ink against the ground it sits on */
          const el = document.querySelector('.side .nav-btn.active'); if (!el) return 21; /* a lab with no choices of its own has no lit entry */
          const px = (c) => (c.match(/[0-9.]+/g) || []).slice(0, 3).map((v) => (c.indexOf("color(") === 0 ? Number(v) * 255 : Number(v)));
          const lum = (c) => { const [r, g, b] = px(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
          let bg = el, back = 'rgb(255,255,255)';
          while (bg) { const c = getComputedStyle(bg).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)") { back = c; break; } bg = bg.parentElement; }
          const a = lum(getComputedStyle(el).color), b = lum(back);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        })()
      }), lab.id);
      const tag = lab.id + ' · ' + size.n;
      ok(got.framed, tag + ' · in the Finance frame (sidebar + main)');
      ok(got.otherLabsInMenu === 0, tag + ' · the left menu does not list the other labs (W16)');
      /* the Combo Lab is a mode of the Offer Lab's page: its shell entry is the page's app (offer-lab) until Combo is its own lab */
      ok(got.switcher.indexOf(lab.id === 'combo-lab' ? 'Offer Lab' : lab.title.split(' · ')[0]) >= 0, tag + ' · the shell switcher names this lab (' + got.switcher.trim() + ')');
      ok(got.title === lab.title, tag + ' · title "' + got.title + '"');
      ok(!/Times/i.test(got.font), tag + ' · the page face is ours (' + got.font.slice(0, 24) + ')');
      ok(got.menu >= 4.5, tag + ' · AA contrast: the lit menu entry (if any) reads (' + got.menu.toFixed(2) + ':1)');
      ok(!/undefined|NaN/.test(got.text), tag + ' · the screen is in words: no undefined or NaN, nothing it could not read left blank');
      ok(got.shells <= 1, tag + ' · one header only');
      ok(errs.length === 0, tag + ' · no page or console error' + (errs.length ? ' · ' + errs[0].slice(0, 120) : ''));
      await page.close();
    }
    await ctx.close();
  }
}

async function kitChecks(browser, serve) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/railway\.app/, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  await page.goto(serve.url('/list-lab.html'), { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(() => {
    const K = window.CBLabKit, host = document.createElement('div');
    host.id = 'kit-host';
    document.body.appendChild(host);
    const items = ['Cash', 'Bank', 'Stock', 'Debtors', 'Creditors'].map((n, i) => ({ name: n, kind: i % 2 ? 'Asset' : 'Liability' }));
    K.more(host, { id: 't', title: 'All accounts', items, columns: [{ key: 'name', label: 'Name' }, { key: 'kind', label: 'Kind' }] });
    const inline = host.querySelectorAll('li').length, more = host.querySelector('.lk-more');
    more.click();
    const pop = document.querySelector('[data-testid="lk-pop"]');
    const rows = pop ? pop.querySelectorAll('.cbl-row, [data-cbl-row], .cbl [role="row"]').length : -1;
    const hasList = !!(pop && pop.querySelector('.cbl'));
    const popHtml = pop ? pop.innerHTML.length : 0;
    document.querySelector('[data-testid="lk-pop-close"]').click();
    return {
      inline, moreText: more.textContent, hasList, popHtml, rows, closed: !document.querySelector('[data-testid="lk-pop"]'),
      plain: K.plain('div40'), plainUnknown: K.plain('straight_line_x'), notSet: K.notSetUp('India', 'GSTR-1'), blank: K.reason('', 'No bill yet today'), val: K.reason('42', 'x'),
      progress: K.progress(3, 5, 'Registration'), done: K.progress(5, 5, 'x'),
      groups: JSON.stringify(Object.fromEntries(Object.entries(K.groups([{ done: 5, total: 5 }, { done: 2, total: 5 }, { done: 0, total: 3 }])).map(([k, v]) => [k, v.length]))),
      red: K.readiness([{ name: 'A', done: 1, total: 4 }]).indexOf('blocker') >= 0, redBlocker: K.readiness([{ name: 'A', done: 0, total: 4, blocker: 'Cannot trade' }]).indexOf('blocker') >= 0,
      diff: K.tag('diff', 'Different')
    };
  });
  ok(r.inline === 3 && /^and 2 more$/.test(r.moreText), 'kit · more · three lines + "and 2 more" (' + r.inline + ', "' + r.moreText + '")');
  ok(r.hasList, 'kit · more · the popup holds the CBList (the one list control)');
  ok(r.closed, 'kit · more · the popup closes');
  ok(/title="div40"/.test(r.plain) && /Capital allowances/.test(r.plain), 'kit · plain · known code → words, code in the tooltip');
  ok(/Straight line x/.test(r.plainUnknown) && /title="straight_line_x"/.test(r.plainUnknown), 'kit · plain · unknown code is spelled out, never raw');
  ok(/Not set up for India yet · GSTR-1/.test(r.notSet.replace(/<[^>]*>/g, '')), 'kit · notSetUp · plain words');
  ok(/No bill yet today/.test(r.blank) && r.val === '42', 'kit · reason · a blank always says why');
  ok(/3 of 5 ready · next: Registration/.test(r.progress) && /5 of 5 ready<\/div>/.test(r.done), 'kit · progress · "x of y ready · next: …" (next only while something is left)');
  ok(r.groups === '{"Ready":1,"Nearly":1,"Not started":1}', 'kit · groups · Ready / Nearly / Not started ' + r.groups);
  ok(!r.red && r.redBlocker, 'kit · red only for a blocker');
  ok(/lk-tag diff/.test(r.diff), 'kit · a difference is a neutral tag');
  await ctx.close();
}

(async () => {
  staticChecks();
  const { chromium } = require('@playwright/test');
  const { serve } = require('./lib/serve.cjs');
  const web = await serve(), browser = await chromium.launch();
  try {
    await pageChecks(browser, web);
    await kitChecks(browser, web);
  } catch (e) { ok(false, 'run · ' + (e && e.stack || e)); }
  await browser.close(); web.close();
  console.log('\n' + out.pass + ' passed · ' + out.fail + ' failed');
  process.exit(out.fail ? 1 : 0);
})();

/* shell-monday.cjs — L16-M7 proof: ONE default look signed out and in (a dark-OS browser included), Sign out visible in the open menu at 1366x768,
 * popup codes hidden unless the tester switched codes on (?ids=1). Shots: e2e/shots/shell-monday-*.png. Run: NODE_PATH=e2e/node_modules node e2e/shell-monday.cjs */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const J = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
(async () => {
  const { chromium } = require('@playwright/test');
  const { standIn, route: booksRoute } = require('./books-web.cjs');
  const { serve } = require('./lib/serve.cjs');
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-monday-'));
  fs.cpSync(path.join(ROOT, 'public'), site, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(site, 'index.html'));
  const S = standIn(), web = await serve(site), b = await chromium.launch();
  let fail = 0; const ok = (c, m) => { if (!c) fail++; console.log((c ? '  ok  ' : '  XX  FAIL · ') + m); };
  const b64 = (x) => btoa(JSON.stringify(x)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const sess = JSON.stringify({ token: b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-books', identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x', role: 'entity', name: 'Books Shop', entity: 'Books Shop' });
  async function page(w, h, signedIn, ids) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark', serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => { const p = new URL(r.request().url()).pathname; if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Books Shop', currency_code: 'AUD', ui_prefs: {} } }); return booksRoute(S, r); });
    if (signedIn) await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} }, sess);
    const p = await ctx.newPage(); await p.goto(web.url('/' + (ids ? '?ids=1' : ''))); await p.waitForTimeout(1200); return p;
  }
  const theme = (p) => p.evaluate(() => document.documentElement.getAttribute('data-theme') || 'cream');
  const out = await page(1366, 768, false); const tOut = await theme(out); await out.screenshot({ path: path.join(SHOTS, 'shell-monday-signedout.png') });
  const inn = await page(1366, 768, true); const tIn = await theme(inn); await inn.screenshot({ path: path.join(SHOTS, 'shell-monday-signedin.png') });
  ok(tOut === tIn && tOut === 'cream', 'one look: signed out "' + tOut + '" = signed in "' + tIn + '" on a dark-OS browser (cream)');
  await inn.click('[data-testid="avatar"]'); await inn.waitForSelector('[data-testid="avatar-menu"]');
  const box = await inn.locator('[data-testid="nav-signout"]').boundingBox();
  ok(box && box.y + box.height <= 768 && box.y >= 0, 'Sign out is inside 1366x768 in the open menu (y=' + (box && Math.round(box.y)) + ')');
  ok(!(await inn.locator('[data-testid="popup-code"]').first().isVisible()), 'the menu\'s popup code is hidden for a visitor');
  await inn.screenshot({ path: path.join(SHOTS, 'shell-monday-menu.png') });
  const t = await page(1366, 768, true, true); await t.click('[data-testid="avatar"]'); await t.waitForSelector('[data-testid="avatar-menu"]');
  ok(await t.locator('[data-testid="popup-code"]').first().isVisible(), 'with ?ids=1 the popup code shows');
  const ph = await page(390, 844, true); await ph.click('[data-testid="avatar"]'); await ph.waitForSelector('[data-testid="avatar-menu"]');
  const pb = await ph.locator('[data-testid="nav-signout"]').boundingBox(); ok(pb && pb.y + pb.height <= 844, 'phone 390x844: Sign out inside the screen');
  await ph.screenshot({ path: path.join(SHOTS, 'shell-monday-phone-menu.png') });
  /* round 2 (F29): skip link is the first Tab stop; the resize handles are out of the Tab order; the content-sized columns fit both screens */
  const k = await page(1366, 768, true); await k.keyboard.press('Tab');
  ok(await k.evaluate(() => (document.activeElement && document.activeElement.getAttribute('data-testid')) === 'skip-link'), 'the first Tab stop is "Skip to content"');
  await k.keyboard.press('Enter');
  ok(await k.evaluate(() => !!document.activeElement && document.activeElement.tagName === 'MAIN'), 'Enter on it moves focus to the main region');
  for (const [w, h] of [[1536, 730], [1366, 768], [390, 844]]) {
    for (const hash of ['/list-lab.html', '/accounts.html#daybook', '/accounts.html#bank', '/accounts.html#tb', '/finance.html#/collections', '/finance.html', '/network.html', '/crm.html']) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
      await ctx.route(/fonts.(googleapis|gstatic).com/, (r) => r.abort());
      await ctx.route('**/api/**', (r) => { const pp = new URL(r.request().url()).pathname; if (pp === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Books Shop', currency_code: 'AUD', ui_prefs: {} } }); return booksRoute(S, r); });
      await ctx.addInitScript((x) => { try { localStorage.setItem('cb_sess', x); } catch (_) {} }, sess);
      const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(String(e.message)));
      await pg.goto(web.url(hash)); await pg.waitForTimeout(1500);
      const tag = hash.replace(/[^a-z]/g, '') + '-' + w;
      await pg.screenshot({ path: path.join(SHOTS, 'shell-monday-list-' + tag + '.png') });
      const rz = await pg.evaluate(() => [].slice.call(document.querySelectorAll('.cbl-rz')).filter((n) => n.tabIndex !== -1).length);
      const fit = await pg.evaluate(() => [].slice.call(document.querySelectorAll('.cbl-list')).filter((n) => n.scrollWidth > n.clientWidth + 1 || n.getBoundingClientRect().right > innerWidth + 1).length);
      ok(fit === 0, hash + ' @' + w + ': every list fits its box (R47), no sideways scroll');
      ok(rz === 0 && errs.length === 0, hash + ' @' + w + ': no resize handle in the Tab order, no page error' + (errs[0] ? ' (' + errs[0] + ')' : ''));
      await ctx.close();
    }
  }
  await b.close(); await web.close && web.close(); console.log(fail ? 'FAIL ' + fail : 'PASS'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

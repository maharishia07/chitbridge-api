#!/usr/bin/env node
/**
 * CARD  29-qa-test-tooling-ux-locale-and-design-system/editions
 * e2e/walk-editions.cjs - EDITIONS OF HOME, WALKED (round AX1, 2026-10-13): the full app vs the auditor's showing.
 * Black box, signed in as the FIXTURE shop; the site served from this checkout, the API a stand-in answering inside the page (nothing is written anywhere).
 *   E1  full: every area in the menu, every card a door that opens (no app.html)
 *   E2  ?edition=auditor: the chip and the one line; only the auditor's entries are drawn; Labs is not in the menu
 *   E3  auditor: no link anywhere on Home opens an app the edition leaves out; every door it shows opens
 *   E4  the small apps follow it: the switcher on a framed page (Documents) has no Labs; the bell's order row and Standards' till door are judged off-edition
 *   E5  a showing link holds THIS TAB only: the person's saved choice is untouched
 *   E6  the avatar's Edition choice: Everything -> the full Home again, saved; Auditor view -> saved and sent with the ui prefs
 *   E7  rule 13, in Cream and Dark at 1366 and 390: AA contrast of every text, no sideways scroll, the chip and line not clipped, nothing covering the bar, no app.html link, the copy in its budget
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-editions.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
const W = require('./lib/walk.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const C = require('./lib/contract.cjs');   /* M43: every answer for a route in the API contract is held to it (RAIL-LAB-SRV1: the facts family) */
const J = C.json;
const crmApi = require('./lib/crm-api.cjs');   /* RAIL-LAB-SRV1: the rail card (GET /api/facts/rail) from its one builder */
const MAN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'manifest.json'), 'utf8'));
const AUD = MAN.editions.auditor.entries;
const OFF = MAN.entries.filter((e) => AUD.indexOf(e.id) < 0).map((e) => e.id);

const walk = async (w) => {
  const { page, ctx, base } = w;
  const patches = [];
  /* FX-UX2 F9 (14 Oct, 1fe97b56): the server's ui_prefs is the truth — a kind the server holds NONE of sends the device back to its default, so a /me that
     always answered ui_prefs {} wiped the choice the avatar had just saved whenever its pull landed after the redraw (cb_edition null: E6 red on main, green on
     a quicker box). The stand-in now keeps what the person PATCHED and answers it, as the real api does. */
  const prefs = {};
  await ctx.route('**/api/**', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/api/entities/me/prefs/ui') { try { const p = JSON.parse(r.request().postData() || '{}'); patches.push(p); Object.assign(prefs, p); } catch (_) {} return J(r, 200, { ok: true }); }
    if (u.pathname === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR', ui_prefs: Object.assign({}, prefs) } });
    if (u.pathname === '/api/facts/rail') return J(r, 200, crmApi.railFacts({ suppliers: 1, customers: 2, in: 3, out: 1, stuck: 0 }));
    return J(r, 404, { error: 'not found' });
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); if (!localStorage.getItem('cb_theme')) localStorage.setItem('cb_theme', 'cream'); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
  const home = async (q) => { await page.goto(base + '/' + (q || '')); await page.waitForSelector('[data-testid="cbshell"]', { timeout: 20000 }); await page.evaluate(() => window.SHELL && window.SHELL.ready); await page.waitForTimeout(400); };
  const drawn = () => page.$$eval('[data-testid^="shell-card-"],[data-testid^="shell-chip-"]', (es) => es.map((e) => e.getAttribute('data-testid').replace(/^shell-(card|chip)-/, '')));
  const navs = () => page.$$eval('.cbsh-nv', (bs) => bs.filter((b) => !b.hidden && b.offsetParent).map((b) => b.getAttribute('data-go')));
  const links = () => page.$$eval('a[href],[data-href]', (as) => as.filter((a) => a.offsetParent !== null || a.closest('details')).map((a) => a.getAttribute('href') || a.getAttribute('data-href')));
  const opens = async (hrefs) => { const bad = []; for (const h of [...new Set(hrefs)].filter((h) => /^\//.test(h))) { const r = await page.request.get(base + h.split('#')[0].split('?')[0]); if (r.status() !== 200) bad.push(h + ' ' + r.status()); } return bad; };

  await home();
  await w.step('E1', 'Full Home -> all seven areas in the menu; every card is a door that opens, none into app.html', async () => {
    const n = await navs(), cards = await page.$$eval('.cbsh-box', (as) => as.map((a) => a.getAttribute('href'))), chip = await page.locator('[data-testid="shell-edition-chip"]').count();
    const bad = await opens(cards);
    return { ok: n.length === 7 && !chip && cards.length > 10 && !bad.length && !cards.some((h) => /app\.html/.test(h)), saw: n.join(' ') + ' · ' + cards.length + ' cards' + (bad.length ? ' · BROKEN ' + bad.join() : ' all open') + ' · chip ' + chip };
  });

  await home('?edition=auditor');
  await w.step('E2', 'Showing link ?edition=auditor -> the "Auditor view" chip, one line saying what it is for, only the auditor\'s entries, no Labs', async () => {
    const ids = await drawn(), n = await navs();
    const chip = await page.locator('[data-testid="shell-edition-chip"]').innerText().catch(() => '');
    const line = await page.locator('[data-testid="shell-edition-line"]').innerText().catch(() => '');
    const want = AUD.filter((id) => MAN.entries.some((e) => e.id === id));
    const extra = ids.filter((id) => AUD.indexOf(id) < 0), missing = want.filter((id) => ids.indexOf(id) < 0);
    return { ok: chip === 'Auditor view' && /auditor/i.test(line) && !extra.length && !missing.length && n.indexOf('labs') < 0, saw: 'chip "' + chip + '" · drawn ' + ids.join(',') + (extra.length ? ' · EXTRA ' + extra.join() : '') + (missing.length ? ' · MISSING ' + missing.join() : '') + ' · menu ' + n.join(' ') };
  });
  await w.step('E3', 'Auditor Home -> no link opens an app the edition leaves out (cards, chips, rail, alerts, roadmap); every door shown opens', async () => {
    const hs = await links();
    const off = await page.evaluate((hs) => hs.filter((h) => CBEdition.hidesHref(h)), hs);
    const named = hs.filter((h) => /till\.html|tasks\.html|product-lab|offer-lab|combo-lab|network(-design)?\.html|employees\.html|shop\.html/.test(h));
    const bad = await opens(hs);
    return { ok: !off.length && !named.length && !bad.length && !hs.some((h) => /app\.html/.test(h)), saw: hs.length + ' links' + (off.length ? ' · OFF-EDITION ' + off.join() : '') + (named.length ? ' · NAMED ' + named.join() : '') + (bad.length ? ' · BROKEN ' + bad.join() : ' · all open') };
  });
  await w.step('E4', 'The small apps follow it -> Documents\' switcher has no Labs; the bell\'s order row and Standards\' till door are off-edition', async () => {
    await page.goto(base + '/authority-forms.html'); await page.waitForSelector('[data-testid="shell-switcher"]', { timeout: 15000 }); await page.waitForTimeout(500);
    await page.click('[data-testid="shell-switcher"]');
    const sw = await page.$$eval('[data-testid="shell-switcher-menu"] a', (as) => as.map((a) => a.getAttribute('data-testid').replace('shell-switch-', '')));
    const j = await page.evaluate(() => CBEdition.load().then(() => ({ k: CBEdition.key(), tasks: CBEdition.hidesHref('/tasks.html?open=1'), till: CBEdition.hidesHref('/till.html'), crm: CBEdition.hidesHref('/crm.html#/chits?open=1'), acc: CBEdition.hidesHref('/accounts.html') })));
    return { ok: j.k === 'auditor' && sw.length && sw.indexOf('labs') < 0 && j.tasks && j.till && !j.crm && !j.acc, saw: 'edition ' + j.k + ' · switcher ' + sw.join(' ') + ' · tasks hidden ' + j.tasks + ' · till hidden ' + j.till + ' · CRM shown ' + !j.crm };
  });
  await w.step('E5', 'A showing link holds this tab only -> the person\'s saved edition is untouched, a new tab is the full app', async () => {
    const saved = await page.evaluate(() => localStorage.getItem('cb_edition'));
    const p2 = await ctx.newPage(); await p2.goto(base + '/'); await p2.waitForSelector('[data-testid="cbshell"]'); await p2.evaluate(() => window.SHELL && window.SHELL.ready); await p2.waitForTimeout(300);
    const chip2 = await p2.locator('[data-testid="shell-edition-chip"]').count(); await p2.close();
    return { ok: saved !== 'auditor' && chip2 === 0, saw: 'saved ' + saved + ' · new tab chip ' + chip2 };
  });

  await home();
  await w.step('E6', 'Avatar -> Edition: Auditor view -> saved, sent with the ui prefs, Home redrawn; Everything -> the full Home again', async () => {
    await page.click('[data-testid="avatar"]'); await page.waitForSelector('[data-testid="edition-group"]', { timeout: 5000 });
    await Promise.all([page.waitForNavigation({ timeout: 10000 }).catch(() => null), page.click('[data-testid="edition-auditor"]')]);
    await page.waitForSelector('[data-testid="cbshell"]'); await page.evaluate(() => window.SHELL && window.SHELL.ready); await page.waitForTimeout(700);
    const a = { saved: await page.evaluate(() => localStorage.getItem('cb_edition')), chip: await page.locator('[data-testid="shell-edition-chip"]').count(), sent: patches.some((p) => p.edition === 'auditor' && p.theme) };
    await page.click('[data-testid="avatar"]'); await page.waitForSelector('[data-testid="edition-full"]');
    await Promise.all([page.waitForNavigation({ timeout: 10000 }).catch(() => null), page.click('[data-testid="edition-full"]')]);
    await page.waitForSelector('[data-testid="cbshell"]'); await page.evaluate(() => window.SHELL && window.SHELL.ready); await page.waitForTimeout(500);
    const b = { saved: await page.evaluate(() => localStorage.getItem('cb_edition')), chip: await page.locator('[data-testid="shell-edition-chip"]').count(), n: (await navs()).length };
    return { ok: a.saved === 'auditor' && a.chip === 1 && a.sent && b.saved === 'full' && !b.chip && b.n === 7, saw: 'auditor: saved ' + a.saved + ', chip ' + a.chip + ', sent ' + a.sent + ' · full: saved ' + b.saved + ', chip ' + b.chip + ', ' + b.n + ' areas' };
  });

  /* E7: rule 13 — the auditor's Home in two themes and two widths */
  const SH = path.join(__dirname, 'shots', 'editions'); fs.mkdirSync(SH, { recursive: true });
  for (const theme of ['cream', 'dark']) {
    for (const [vw, vh] of [[1366, 860], [390, 844]]) {
      await page.evaluate((t) => localStorage.setItem('cb_theme', t), theme);
      await page.setViewportSize({ width: vw, height: vh });
      await home('?edition=auditor');
      await w.step('E7-' + theme + '-' + vw, 'Auditor Home, ' + theme + ' at ' + vw + ' px -> AA contrast, no sideways scroll, chip and line whole, nothing over the bar, no app.html, copy in budget', async () => {
        const fails = [];
        const tabs = vw === 390 ? await navs() : ['home'];
        for (const t of tabs) {
          if (vw === 390) { await page.click('[data-testid="shell-nav-' + t + '"]'); await page.waitForTimeout(250); }
          const rec = await page.evaluate(measure);
          rec.filter((r) => !r.grad && r.ratio < r.need).forEach((r) => fails.push(t + ':' + r.text + ' ' + r.ratio));
        }
        const g = await page.evaluate(() => {
          const q = (s) => document.querySelector(s), r = (e) => e && e.getBoundingClientRect();
          const chip = q('[data-testid="shell-edition-chip"]'), line = q('[data-testid="shell-edition-line"]'), who = q('.cbsh-who'), av = q('.cbsh-av'), lic = q('.cbsh-lic');
          const hit = (a, b) => a && b && a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
          const main = q('.cbsh-main');
          return {
            sw: Math.max(document.documentElement.scrollWidth - innerWidth, main ? main.scrollWidth - main.clientWidth : 0),
            chipClip: chip ? chip.scrollWidth > chip.clientWidth + 1 || r(chip).right > innerWidth : true,
            lineClip: line && !line.hidden ? line.scrollWidth > line.clientWidth + 1 : false,
            overlap: hit(r(chip), r(who)) || hit(r(chip), r(av)) || hit(r(chip), r(lic)),
            appLinks: [...document.querySelectorAll('a[href]')].filter((a) => /app\.html/.test(a.getAttribute('href'))).length,
            chipText: chip ? chip.textContent : '', lineText: line ? line.textContent : ''
          };
        });
        await page.screenshot({ path: path.join(SH, 'auditor-' + theme + '-' + vw + '.png') });
        const budget = g.chipText.length <= 16 && g.lineText.length <= 110 && g.lineText.split(/[.!?]\s/).length <= 2;
        const ok = !fails.length && g.sw <= 1 && !g.chipClip && !g.lineClip && !g.overlap && !g.appLinks && budget;
        return { ok, saw: (fails.length ? 'LOW CONTRAST ' + fails.slice(0, 4).join(' | ') + ' · ' : 'contrast AA · ') + 'sideways ' + g.sw + ' · chip clipped ' + g.chipClip + ' · line clipped ' + g.lineClip + ' · overlap ' + g.overlap + ' · app.html links ' + g.appLinks + ' · copy ' + g.chipText.length + '/' + g.lineText.length + ' chars' };
      });
    }
  }
  if (w.errs.length) w.note('ERR', 'page errors seen', w.errs.slice(0, 3).join(' | '));
  w.note('OFF', 'entries the auditor edition leaves out', OFF.join(', '));
};
walk.opts = { viewport: { width: 1366, height: 860 } };
W.run('editions', walk);

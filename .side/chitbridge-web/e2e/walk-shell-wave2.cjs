/**
 * e2e/walk-shell-wave2.cjs — THE SHARED SHELL WEARS ITS IDENTITY AND MEETS THE STANDARD (Wave 2 shell, UX-137, 12 Nov 2026)
 * ID        OWN005
 * KIND      test
 * OWNER     cb-ux-locale
 * OWNS      the browser proof that the top bar, the bell, the avatar and the side frame (public/app/shell.js, rail-bell.js, page-frame.js)
 *           carry a data-cbsid on every control, keep the tap rule, fit with no scroll, work from the keyboard, pass axe and read AA in both themes
 * CALLED BY run-shard (walk-*); by hand: NODE_PATH=$PWD/e2e/node_modules node e2e/walk-shell-wave2.cjs
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/page-frame
 * FLOW      sign in a fixture shop → open accounts · tasks · settings → at 1366 and 390, Cream and Dark → count controls, boxes, focus, axe, contrast → Home: tabs, cards, side openers, More rows
 *
 * IT BITES: on main the side menu entries, the Collapse button and the group heads wear no code (a count by testid shows controls with no data-cbsid),
 * so the identity paths FAIL there; with the stamps they pass. A control in the shell zone is a visible button, link, input or tab inside the header,
 * the bell, the avatar or the side menu. A FIXTURE shop: the site is served from this checkout, the API is a stand-in answering inside the page.
 */
'use strict';
const fs = require('fs'), path = require('path');
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const A = require('./lib/a11y-check.cjs');
const { measure } = require('./lib/theme-measure.cjs');

const PAGES = [['accounts', '/accounts.html'], ['tasks', '/tasks.html'], ['settings', '/settings.html']];
const VIEWS = [['1366', { width: 1366, height: 768 }], ['390', { width: 390, height: 844 }]];
const THEMES = ['cream', 'dark'];
const TAP_MIN = 24, TAP_PHONE = 44;
const CODE_RE = /^[A-Z]{3}[0-9]{3}(-[A-Z][0-9]{2})*$/;
const ZONE = '.cbsh-hdr, #side, .cbb, .cbav';
const AXE_TAGS = A.TAGS.concat(['wcag21a', 'best-practice']);

/** the live codes of the register copy this machine has, or null (then a code only has to be well formed) */
function liveCodes() {
  const spots = [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/cb/wt-wave2-docs/SCREENS.json', 'C:/dev/SCREENS.json'].filter(Boolean);
  const found = spots.filter((spot) => fs.existsSync(spot))[0];
  if (!found) return null;
  const rows = Object.values(JSON.parse(fs.readFileSync(found, 'utf8')).screens);
  return new Set(rows.filter((row) => !row.retired).map((row) => row.code));
}
const LIVE = liveCodes();

/** every visible control in a zone: its test id, code and box (runs in the page) */
const SCAN = (zone) => {
  const sel = 'button, a[href], a[role=button], input:not([type=hidden]), select, textarea, [role=tab], [role=menuitem], [role=switch]';
  const out = [];
  document.querySelectorAll(sel).forEach((el) => {
    const r = el.getBoundingClientRect(), st = getComputedStyle(el);
    if (!(r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none') || !el.closest(zone)) return;
    out.push({ id: el.getAttribute('data-testid') || el.id || el.className || el.tagName, code: el.getAttribute('data-cbsid'), mount: el.getAttribute('data-cbmount'), w: Math.round(r.width), h: Math.round(r.height) });
  });
  return out;
};

const walk = async (w) => {
  const { ctx, page, base } = w;
  const state = { theme: 'cream' };
  await ctx.route('**/api/**', (r) => C.json(r, 200, r.request().url().indexOf('/api/entities/me') >= 0
    ? { entity: { display_name: 'Fixture Shop', currency_code: 'INR', country_code: 'IN' } } : {}));
  await ctx.addInitScript(([sess, theme]) => {
    try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', sess); localStorage.setItem('cb_theme', theme); } catch (_) { /* a blocked store: the page draws signed out */ }
  }, [W.session('Fixture Owner', 'Fixture Shop'), 'cream']);

  /** open one page at one size and theme, painted */
  async function open(route, view, theme) {
    await page.setViewportSize(view);
    await page.goto(base + route);
    await page.evaluate((t) => { try { localStorage.setItem('cb_theme', t); } catch (_) { /* blocked */ } }, theme);
    await page.reload();
    await page.waitForSelector('[data-testid="shell-bar"]', { timeout: 8000 });
    await page.waitForTimeout(500);
    state.theme = theme;
  }

  for (const [pname, route] of PAGES) {
    for (const [vname, view] of VIEWS) {
      await open(route, view, 'cream');
      const rows = await page.evaluate(SCAN, ZONE);
      const bare = rows.filter((row) => !row.code), badForm = rows.filter((row) => row.code && !CODE_RE.test(row.code));
      const dead = LIVE ? rows.filter((row) => row.code && CODE_RE.test(row.code) && !LIVE.has(row.code)) : [];
      await w.step('ID-' + pname + '-' + vname, pname + ' at ' + vname + ': every shell and frame control wears a live identity code', async () => ({
        ok: rows.length > 5 && !bare.length && !badForm.length && !dead.length,
        saw: (rows.length - bare.length) + ' of ' + rows.length + ' identified' + (bare.length ? '; none on ' + bare.slice(0, 4).map((x) => x.id).join(', ') : '') + (dead.length ? '; not in the register: ' + dead.slice(0, 3).map((x) => x.code).join(', ') : '')
      }));
      const noMount = rows.filter((row) => /^CMP054/.test(row.code || '') && !row.mount);
      await w.step('MOUNT-' + pname + '-' + vname, pname + ' at ' + vname + ': the frame own controls name their mount', async () => ({ ok: !noMount.length, saw: noMount.slice(0, 3).map((x) => x.id).join(', ') || 'every CMP054 control has a mount' }));
      const small = rows.filter((row) => row.w < TAP_MIN || row.h < TAP_MIN), phone = vname === '390' ? rows.filter((row) => row.h < TAP_PHONE || row.w < TAP_PHONE) : [];
      await w.step('TAP-' + pname + '-' + vname, pname + ' at ' + vname + ': every control is at least 24 px' + (vname === '390' ? ' and 44 px on the phone' : ''), async () => ({
        ok: !small.length && !phone.length, saw: small.concat(phone).slice(0, 4).map((x) => x.id + ' ' + x.w + 'x' + x.h).join(', ') || rows.length + ' boxes measured'
      }));
      const fit = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - innerHeight }));
      await w.step('FIT-' + pname + '-' + vname, pname + ' at ' + vname + ': nothing scrolls sideways or down', async () => ({ ok: fit.x <= 1 && fit.y <= 1, saw: 'over by ' + fit.x + ' across, ' + fit.y + ' down' }));
      for (const theme of THEMES) {
        await open(route, view, theme);
        const bad = (await page.evaluate(measure)).filter((r) => r.ratio < r.need && !r.grad);
        const inZone = await page.evaluate(([z, texts]) => texts.filter((t) => Array.from(document.querySelectorAll(z)).some((el) => (el.textContent || '').indexOf(t) >= 0)), [ZONE, bad.map((r) => r.text)]);
        await w.step('AA-' + pname + '-' + vname + '-' + theme, pname + ' at ' + vname + ' in ' + theme + ': the shell and frame text reads at AA', async () => {
          const mine = bad.filter((r) => inZone.indexOf(r.text) >= 0 && /cbsh|cbav|cbb|side|nav|skel/.test(r.html));
          return { ok: !mine.length, saw: mine.slice(0, 3).map((r) => r.text + ' ' + r.ratio + ':1').join(', ') || bad.length + ' elsewhere on the page, none in the shell' };
        });
        const ax = await A.check(page, { tags: AXE_TAGS, maxNodes: 40 });
        const hits = ax.violations.filter((v) => v.nodes.some((n) => /cbsh|cbav|cbb-|cbsk|skel-|toggleNav|shell-|nav-btn|side/.test(n.html + ' ' + String(n.target || ''))) && (v.impact === 'serious' || v.impact === 'critical'));
        await w.step('AXE-' + pname + '-' + vname + '-' + theme, pname + ' at ' + vname + ' in ' + theme + ': axe (wcag2a/aa/21/22 + best-practice) finds no serious or critical in the shell', async () => ({
          ok: !hits.length, saw: hits.map((v) => v.id + ' x' + v.count).join(', ') || ax.counts.violations + ' findings on the page, none serious in the shell'
        }));
      }
    }
  }

  /* HOME (HOM001): the area tabs, the cards, the side openers at 1366; the More tab and its rows on a phone. Every control wears a live code of its own kind. */
  const HOME_ZONE = '.cbsh-hdr, .cbsh-work';
  const homeSteps = [['1366', { width: 1366, height: 768 }, ['HOM001-K01', 'HOM001-B01', 'HOM001-B03', 'HOM001-B04'], null], ['390', { width: 390, height: 844 }, ['HOM001-K01', 'HOM001-B02'], '[data-testid="shell-nav-more"]']];
  for (const [vname, view, want, opener] of homeSteps) {
    await open('/index.html', view, 'cream');
    if (opener) { await page.click(opener); await page.waitForTimeout(400); }
    const rows = await page.evaluate(SCAN, HOME_ZONE);
    const seen = new Set(rows.map((row) => row.code));
    const bare = rows.filter((row) => !row.code), dead = LIVE ? rows.filter((row) => row.code && !LIVE.has(row.code)) : [];
    const lacking = want.filter((code) => !seen.has(code));
    await w.step('HOME-' + vname, 'Home at ' + vname + ': every control wears a live code and ' + want.join(', ') + ' are all in use', async () => ({
      ok: rows.length > 5 && !bare.length && !dead.length && !lacking.length,
      saw: (rows.length - bare.length) + ' of ' + rows.length + ' identified' + (bare.length ? '; none on ' + bare.slice(0, 4).map((x) => x.id).join(', ') : '') + (lacking.length ? '; not drawn with: ' + lacking.join(', ') : '') + (dead.length ? '; not in the register: ' + dead.slice(0, 3).map((x) => x.code).join(', ') : '')
    }));
  }

  /* the keyboard pass, wide, on tasks: the side menu is reached by Tab, Enter folds the menu, Enter and Escape work the three header menus */
  await open('/tasks.html', { width: 1366, height: 768 }, 'cream');
  const tabTo = async (testidOrId, max) => {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press('Tab');
      const hit = await page.evaluate((t) => { const a = document.activeElement; return !!a && (a.id === t || a.getAttribute('data-testid') === t); }, testidOrId);
      if (hit) return i + 1;
    }
    return 0;
  };
  await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.scrollTo(0, 0); });
  const navTabs = await tabTo('skel-nav-orders_in', 40);
  await w.step('KB-nav', 'tasks: Tab reaches the first side-menu entry (' + navTabs + ' presses) and it shows a focus ring', async () => {
    const ring = await page.evaluate(() => { const a = document.activeElement; if (!a) return ''; const s = getComputedStyle(a); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none' ? 'ring' : ''; });
    return { ok: navTabs > 0 && ring === 'ring', saw: navTabs ? 'reached after ' + navTabs + ' Tab presses, ' + (ring || 'no ring') : 'never reached in 40 presses' };
  });
  await page.focus('#toggleNav');
  await page.keyboard.press('Enter');
  const folded = await page.getAttribute('#toggleNav', 'aria-expanded');
  await page.keyboard.press('Enter');
  const unfolded = await page.getAttribute('#toggleNav', 'aria-expanded');
  await w.step('KB-collapse', 'tasks: Enter on Collapse folds the side menu and Enter again opens it', async () => ({ ok: folded === 'false' && unfolded === 'true', saw: 'after one Enter ' + folded + ', after two ' + unfolded }));
  for (const [name, sel] of [['shop menu', '[data-testid="shell-shop"], [data-testid="shell-switcher"]'], ['avatar menu', '.cbav-btn'], ['bell', '[data-testid="bell-btn"]']]) {
    const present = await page.$(sel);
    await w.step('KB-' + name.split(' ')[0], 'tasks: Enter opens the ' + name + ' and Escape closes it', async () => {
      if (!present) return { ok: false, saw: 'the control is not on the page' };
      await page.focus(sel);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
      const open = await page.getAttribute(sel, 'aria-expanded');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      const shut = await page.getAttribute(sel, 'aria-expanded');
      return { ok: open === 'true' && shut === 'false', saw: 'open ' + open + ', after Escape ' + shut };
    });
  }
};

W.run('shell-wave2', walk);

/* walk-topbar-tap.cjs - THE MAIN APP'S TOP BAR MEETS THE ONE TAP RULE ON A PHONE (Athi 10 Nov, wave 2 step 1b, UX-137)
 *
 * Web #520 put the shared shell header on 44 px and its tests passed while the real app header (public/app.html .topbar) stayed at 34 px and 24 px:
 * they read the shell's CSS text. This walk renders app.html itself and measures the BOX of every control in the bar (getBoundingClientRect):
 *   390  at the four text sizes (cb_fs s m l xl): every control >= 44 x 44, the bar ends 4 px or more inside the screen, nothing scrolls sideways;
 *   1366 at the four text sizes with a very long person and shop name: the bar stays 52 px, one line, no control past the .who block;
 *   the unread dot sits on the bell (position absolute, inside the bell's box); Arabic (rtl) mirrors the bar and still fits; the keyboard focus ring
 *   shows on a .cbtb; the controls keep 3:1 against the bar in the dark and the light theme.
 * A FIXTURE shop: the site is served from this checkout, the API is a stand-in answering inside the page.
 * OWNS       the rendered-box proof of the main top bar's tap size. CALLED BY  run-shard (walk-*), node e2e/walk-topbar-tap.cjs
 * Run: NODE_PATH=$PWD/e2e/node_modules node e2e/walk-topbar-tap.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const MIN = 44, SPARE = 4, BAR_HEIGHT = 52;
const BAR_CONTROLS = ['nav-drawer', 'nav-home', 'icon-legend', 'icon-notifications'];
/* the four text sizes, as cb_fs stores them (avatar.js): s m l xl; xl scales type by 1.32 */
const TEXT_SIZES = ['s', 'm', 'l', 'xl'];
const LONG_NAME = 'Venkatasubramanian Ramachandran-Iyer', LONG_SHOP = 'Sri Venkateswara Traders and General Merchants';

const walk = async (w) => {
  const { ctx, base } = w;
  const state = { name: 'Fixture Owner', shop: 'Fixture Shop', size: 'm', theme: 'device', lang: 'en' };
  await ctx.route('**/api/**', async (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/api/entities/me') return C.json(r, 200, { entity: { display_name: state.shop, currency_code: 'INR', country_code: 'IN' } });
    return C.json(r, 200, {});
  });

  /** every visible control of the bar and its box, found in the real page */
  const measure = (page) => page.evaluate((ids) => {
    const box = (el) => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, l: b.left, r: b.right }; };
    const shown = (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
    const out = {};
    ids.forEach((id) => { const el = document.querySelector('.topbar [data-testid="' + id + '"]'); out[id] = el && shown(el) ? Object.assign(box(el), { cb: el.getAttribute('data-cbname') }) : null; });
    const av = document.querySelector('.topbar .cbav-btn'); out.avatar = av ? box(av) : null;
    const ch = Array.from(document.querySelectorAll('.topbar .cbui-choice-btn, .topbar .cbui-choice [role="radio"]')).filter(shown)[0]; out.presence = ch ? box(ch) : null;
    /* every other control the bar draws, whatever it is: a button, a link or a switch segment that is on screen */
    Array.from(document.querySelectorAll('.topbar button, .topbar a, .topbar [role="radio"]')).filter(shown).forEach((el, i) => { const b = box(el); if (b.w < 44 || b.h < 44) out['other' + i + ' ' + (el.getAttribute('data-testid') || el.className || el.tagName)] = b; });
    const bar = document.querySelector('.topbar'), who = bar.querySelector('.who'), whoBox = who.getBoundingClientRect();
    out.sideways = document.documentElement.scrollWidth - window.innerWidth;
    out.iw = window.innerWidth;
    out.barH = Math.round(bar.getBoundingClientRect().height);
    out.barRight = Math.max.apply(null, Array.from(bar.querySelectorAll('*')).filter(shown).map((e) => e.getBoundingClientRect().right));
    out.dir = document.documentElement.dir || getComputedStyle(document.body).direction;
    /* a single line: no child of the bar sits lower than the first child's top by more than half a bar */
    const tops = Array.from(bar.children).filter(shown).map((e) => e.getBoundingClientRect().top);
    out.oneLine = Math.max.apply(null, tops) - Math.min.apply(null, tops) < 26;
    /* wide: the left edge of the .who block, and the right edge of the bar's own controls */
    out.whoLeft = whoBox.left;
    out.ownRight = Math.max.apply(null, ids.map((id) => (out[id] ? out[id].r : 0)));
    return out;
  }, BAR_CONTROLS);
  const small = (m) => Object.keys(m).filter((k) => m[k] && typeof m[k] === 'object' && (m[k].w < MIN || m[k].h < MIN)).map((k) => k + ' ' + m[k].w + 'x' + m[k].h);
  const open = async (width) => {
    await w.page.setViewportSize({ width, height: 844 });
    /* the app remembers a phone layout (cb_vp) once it has drawn one; the stored values are written before the page's own scripts run */
    await w.page.addInitScript((s) => {
      try { localStorage.removeItem('cb_vp'); localStorage.setItem('cb_fs', s.size); localStorage.setItem('cb_theme', s.theme); localStorage.setItem('cb_lang', s.lang); localStorage.setItem('cb_sess', s.sess); localStorage.setItem('cb_ids', '1'); } catch (_) { /* a blocked store: the defaults are walked and the step says what it saw */ }
    }, { size: state.size, theme: state.theme, lang: state.lang, sess: W.session(state.name, state.shop) });
    await w.page.goto(base + '/app.html?t=' + Date.now() + '#/', { waitUntil: 'load' });   // clock-ok: cache-buster in the URL, not a business date
    await w.page.waitForSelector('.topbar [data-testid="nav-home"]', { timeout: 15000 });
    await w.page.waitForTimeout(600);
    return measure(w.page);
  };

  /* the wide steps run first: the app remembers a phone layout (cb_vp) once it has drawn one */
  for (const size of TEXT_SIZES) {
    await w.step('T-wide-' + size, '1366 · text size ' + size + ', a very long name and shop: the bar stays one 52 px line, no control reaches the .who block', async () => {
      Object.assign(state, { size, name: LONG_NAME, shop: LONG_SHOP, theme: 'device', lang: 'en' });
      const m = await open(1366), tooSmall = ['nav-home', 'icon-legend', 'icon-notifications'].filter((id) => !m[id] || m[id].h < 32 || m[id].w < 32);
      return { ok: !tooSmall.length && m['nav-drawer'] === null && m.sideways <= 0 && m.barH <= BAR_HEIGHT && m.oneLine && m.ownRight <= m.whoLeft + 0.5, saw: JSON.stringify({ barH: m.barH, oneLine: m.oneLine, ownRight: m.ownRight, whoLeft: m.whoLeft, sideways: m.sideways, tooSmall }) };
    });
  }
  for (const size of TEXT_SIZES) {
    await w.step('T-' + size, '390 · text size ' + size + ': every control of the main top bar is at least 44 x 44, 4 px spare at the edge, nothing scrolls sideways', async () => {
      Object.assign(state, { size, name: 'Fixture Owner', shop: 'Fixture Shop', theme: 'device', lang: 'en' });
      const m = await open(390), bad = small(m);
      const components = BAR_CONTROLS.every((id) => m[id] && m[id].cb);
      return { ok: !bad.length && components && m.sideways <= 0 && m.barRight <= 390 - SPARE, saw: JSON.stringify({ small: bad, sideways: m.sideways, barRight: m.barRight, components, presence: m.presence, avatar: m.avatar }) };
    });
  }
  await w.step('T-dot', '390 · with unread activity the red dot sits on the bell (absolute, inside the bell box)', async () => {
    await w.page.evaluate(() => { UI.notifCount = 3; renderApp(); });
    await w.page.waitForTimeout(300);
    const r = await w.page.evaluate(() => {
      const dot = document.getElementById('belldot'), bell = document.getElementById('bellbtn');
      if (!dot || !bell) return null;
      const d = dot.getBoundingClientRect(), b = bell.getBoundingClientRect();
      return { position: getComputedStyle(dot).position, shown: getComputedStyle(dot).display !== 'none', text: dot.textContent, inside: d.left >= b.left - 4 && d.right <= b.right + 4 && d.top >= b.top - 4 && d.bottom <= b.bottom };
    });
    return { ok: !!r && r.position === 'absolute' && r.shown && r.text === '3' && r.inside, saw: JSON.stringify(r) };
  });
  await w.step('T-focus', '390 · the keyboard focus ring shows on the bar\'s controls (Home link and Capabilities button)', async () => {
    const ring = (sel) => w.page.evaluate((s) => { const e = document.querySelector(s); e.focus(); const cs = getComputedStyle(e); return { focused: document.activeElement === e, w: parseFloat(cs.outlineWidth), style: cs.outlineStyle }; }, sel);
    /* a key press first, so :focus-visible applies to the scripted focus */
    await w.page.keyboard.press('Tab');
    const home = await ring('.topbar [data-testid="nav-home"]');
    const key = await ring('.topbar [data-testid="icon-legend"]');
    return { ok: home.focused && home.w >= 2 && home.style !== 'none' && key.focused && key.w >= 2 && key.style !== 'none', saw: JSON.stringify({ home, key }) };
  });
  for (const theme of ['dark', 'light']) for (const vw of [390, 1366]) {
    await w.step('T-' + theme + '-' + vw, vw + ' · ' + theme + ' theme: the bar\'s controls carry words, so they keep 4.5:1 text contrast against the bar (WCAG 1.4.3; no dimming)', async () => {
      Object.assign(state, { size: 'm', theme, lang: 'en' });
      await open(vw);
      const r = await w.page.evaluate(() => {
        const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        const bg = rgb(getComputedStyle(document.querySelector('.topbar')).backgroundColor), out = {};
        ['nav-drawer', 'nav-home', 'icon-legend', 'icon-notifications'].forEach((id) => {
          const el = document.querySelector('.topbar [data-testid="' + id + '"]'); if (!el || !el.getClientRects().length) return; const cs = getComputedStyle(el), op = parseFloat(cs.opacity), fg = rgb(cs.color);
          const mix = fg.map((x, i) => x * op + bg[i] * (1 - op)), a = lum(mix), b = lum(bg);
          out[id] = Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10;
        });
        return out;
      });
      return { ok: Object.keys(r).length >= 3 && Object.keys(r).every((k) => r[k] >= 4.5), saw: JSON.stringify(r) };
    });
  }
  await w.step('T-rtl', '390 · Arabic (right to left): the bar mirrors, every control is still 44 x 44 and the bar ends inside the screen with 4 px spare', async () => {
    Object.assign(state, { size: 'm', theme: 'device', lang: 'ar' });
    await open(390);
    /* the language is the locale engine's: setLang sets the direction and the strings together, then the app repaints */
    await w.page.evaluate(() => { CBLocale.setLang('ar'); renderApp(); });
    await w.page.waitForTimeout(500);
    const m = await measure(w.page), bad = small(m);
    const mirrored = m.dir === 'rtl' && m['nav-drawer'] && m.avatar && m.avatar.l < m['nav-drawer'].l;
    const leftEdge = Math.min.apply(null, BAR_CONTROLS.map((id) => (m[id] ? m[id].l : 999)).concat(m.avatar ? [m.avatar.l] : []));
    return { ok: !bad.length && !!mirrored && m.sideways <= 0 && leftEdge >= SPARE && m.barRight <= 390, saw: JSON.stringify({ dir: m.dir, small: bad, leftEdge, barRight: m.barRight, sideways: m.sideways }) };
  });
};
walk.opts = { viewport: { width: 390, height: 844 } };
W.run('topbar-tap', walk);

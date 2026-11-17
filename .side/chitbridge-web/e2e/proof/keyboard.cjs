'use strict';
// @type: accessibility
// PROOF PACK keyboard: keyboard-and-focus on the 19 customer pages (proof/pages.json) at --widths: tab order, focus ring, skip link, trap, arrows, popups (Esc, focus return, Enter, empty save, dirty Esc).
// MEASURE ONLY: every write to the app is aborted and counted (proof/guard.cjs). From the SIT driver PM/out/kbd-pages-1111.driver.cjs (docs 69f493e6), now parameterised by base URL and run on GitHub (proof.yml).
//   node e2e/proof/keyboard.cjs [--base http://localhost:5173] [--api http://localhost:3000] [--widths 1366,390] [--only crm,till] [--out out/proof/keyboard.json]
const fs = require('fs');
const L = require('./lib.cjs'); const { watchReads, readFailures } = require('./read-failures.cjs'); const { BASE, PAGES, VPS, sleep } = L;
const argv = L.argv, arg = L.arg;
const SHOTS = arg('shots', ''); if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const OUT = arg('out', 'kbd-pages.json'), ONLY = arg('only', ''), MAXOPEN = +arg('maxopen', 40), MAXPOP = +arg('maxpop', 8), MAXTAB = +arg('maxtab', 90);
const JOBS = []; for (const [w, h] of VPS) for (const [n, r] of PAGES) if (!ONLY || ONLY.split(',').includes(n)) JOBS.push([n, r, w, h]);
const FORBID = /sign\s?-?out|log\s?-?out|switch\s+(shop|account|business|user)|change\s+(shop|account)|delete\s+(my\s+)?account|end session/i;

// ---- in-page helpers, installed once per document ----
const HELPERS = () => {
  if (window.__K) return; const K = window.__K = {};
  K.desc = (el) => { if (!el) return 'none'; if (el === document.body) return 'BODY'; if (el === document.documentElement) return 'HTML'; const t = el.tagName.toLowerCase(); const txt = String(el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 28); return t + (el.id ? '#' + el.id : '') + (el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : '') + (txt ? ' "' + txt + '"' : ''); };
  K.vis = (el) => { if (!el || !el.getBoundingClientRect) return false; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0; };
  K.dialogSel = 'dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]';
  // popup roots: any visible dialog-like element, or a fixed element covering a good share of the viewport
  K.popups = () => { const out = new Set(); document.querySelectorAll(K.dialogSel).forEach((e) => { if (K.vis(e)) out.add(e); });
    document.querySelectorAll('body *').forEach((e) => { const s = getComputedStyle(e); if (s.position !== 'fixed' || !K.vis(e)) return; const r = e.getBoundingClientRect(); if (r.width * r.height >= 0.35 * innerWidth * innerHeight && !e.closest('header,nav') && e.tagName !== 'BODY') { let anc = false; out.forEach((o) => { if (o.contains(e) || e.contains(o)) anc = true; }); if (!anc) out.add(e); } });
    return [...out]; };
  K.kind = (e) => e.tagName === 'DIALOG' ? 'native-dialog' : (e.getAttribute('role') === 'dialog' || e.getAttribute('aria-modal') === 'true') ? 'div role=dialog' : 'div overlay (no dialog role)';
  K.focusables = (root) => [...root.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')].filter((e) => !e.disabled && e.tabIndex >= 0 && K.vis(e) && e.type !== 'hidden');
  K.sty = (e) => { const s = getComputedStyle(e); return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderTopColor, s.backgroundColor, s.color, s.textDecorationLine].join('|'); };
  K.outlineVisible = (e) => { const s = getComputedStyle(e); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && s.outlineColor !== 'transparent'; };
  K.writes = 0; K.submits = 0; K.keys = [];
  document.addEventListener('submit', () => { K.submits++; }, true);
  window.addEventListener('keydown', (e) => { K.keys.push({ k: e.key, dp: e.defaultPrevented }); }, false);
};
const initPage = (page) => page.evaluate(HELPERS).catch(() => {});

(async () => {
  const shop = await L.ownShop(); const sess = JSON.parse(shop.session);
  const browser = await L.playwright().chromium.launch({ args: ['--no-sandbox'] });
  const result = { generated: new Date().toISOString(), base: BASE, shop: shop.email, viewports: VPS.map((v) => v[0]), pages: [] };
  for (const [name, route, W, H] of JOBS) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, locale: 'en-IN', serviceWorkers: 'block' });
    await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); window.print = function () {}; } catch (_) {} }, shop.session);
    const counts = { writes: 0 }; await L.guardContext(ctx, counts);
    await ctx.addInitScript(HELPERS); /* every new document (a key press that navigates) gets the helper again: crm @390 lost window.__K on real rows */
    const page = await ctx.newPage(); page.on('dialog', (d) => d.dismiss().catch(() => {})); page.on('download', (d) => d.cancel().catch(() => {})); ctx.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });
    const url = BASE + route.replace('{bridge}', encodeURIComponent(sess.bridgeId || ''));
    const R = { page: name, width: W, err: null, notes: [] };
    const seen = watchReads(page);
    const load = async () => { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}); await sleep(1200); await initPage(page); };
    const press = async (k) => { await page.keyboard.press(k); await sleep(180); };
    try {
      await load();
      // 1 starting focus
      R.loadFocus = await page.evaluate(() => window.__K.desc(document.activeElement));
      R.title = await page.title();
      if (SHOTS) await page.screenshot({ path: SHOTS + '/keyboard-' + name + '-' + W + '.png' }).catch(() => {});
      // 7 skip link + 6 + tab order
      const tabs = []; let lost = 0, stuck = 0, last = '';
      for (let i = 0; i < MAXTAB; i++) {
        await page.keyboard.press('Tab'); await sleep(60);
        const s = await page.evaluate(() => { const K = window.__K, e = document.activeElement, out = {}; const prev = window.__prevEl;
          if (prev && prev !== e && document.contains(prev)) { out.prevBlur = K.sty(prev); }
          out.d = K.desc(e); out.body = e === document.body || e === document.documentElement; out.vis = !out.body && K.vis(e);
          if (!out.body) { out.sty = K.sty(e); out.ol = K.outlineVisible(e); out.fv = (() => { try { return e.matches(':focus-visible'); } catch (_) { return null; } })();
            const r = e.getBoundingClientRect(); out.inView = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
            const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)); const top = document.elementFromPoint(cx, cy); out.obscured = !!top && !(e.contains(top) || top.contains(e)) && out.inView; if (out.obscured) out.obsBy = K.desc(top); }
          window.__prevEl = e; window.__prevSty = out.sty; return out; });
        // blurred-style comparison for the previous element is done in the same call via prevBlur; pair it with the previous focused style
        if (tabs.length && s.prevBlur !== undefined) tabs[tabs.length - 1].changed = tabs[tabs.length - 1].sty !== s.prevBlur;
        if (s.body) { lost++; if (tabs.length > 3 || i > 0) { tabs.push({ d: 'BODY(wrap/lost)', body: true }); if (lost > 1 && s.d === last) break; } }
        if (s.d === last && !s.body) { stuck++; if (stuck >= 3) { R.keyboardTrap = s.d; break; } } else stuck = 0;
        if (tabs.length && !s.body && tabs.some((t) => t.d === s.d && t.i0)) break;
        tabs.push(Object.assign(s, { i: i, i0: false })); last = s.d;
        if (tabs.filter((t) => t.d === s.d).length > 2) break;
      }
      R.tab = { n: tabs.length, first: tabs[0] && tabs[0].d, firstTen: tabs.slice(0, 10).map((t) => t.d), bodyHits: tabs.filter((t) => t.body).length };
      const real = tabs.filter((t) => !t.body);
      R.skip = tabs.slice(0, 3).some((t) => /skip/i.test(t.d)); R.skipHrefExists = await page.evaluate(() => !!document.querySelector('a[href^="#"][class*=skip],a[href^="#"][id*=skip],a.skip,.skip-link,[data-skip]'));
      R.focusRing = { total: real.length, noIndicator: real.filter((t) => !t.ol && t.changed === false).map((t) => t.d).slice(0, 12), noIndicatorN: real.filter((t) => !t.ol && t.changed === false).length, invisible: real.filter((t) => !t.vis || !t.inView).map((t) => t.d).slice(0, 8), obscured: real.filter((t) => t.obscured).map((t) => t.d + ' <- ' + t.obsBy).slice(0, 8) };
      // 3 shortcuts
      R.keys = {};
      for (const k of ['/', '?', 'Escape', 'Control+s', 'Control+Enter']) {
        await load(); await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
        const before = await page.evaluate(() => ({ a: window.__K.desc(document.activeElement), p: window.__K.popups().length, h: location.hash, ty: [...document.querySelectorAll('input,textarea')].some((e) => e === document.activeElement) }));
        const w0 = counts.writes; await page.keyboard.press(k); await sleep(350);
        const after = await page.evaluate(() => ({ a: window.__K.desc(document.activeElement), p: window.__K.popups().length, h: location.hash, kp: window.__K.keys.slice(-2) }));
        const eff = before.a !== after.a || before.p !== after.p || before.h !== after.h || counts.writes !== w0 || (after.kp.some((x) => x.dp));
        R.keys[k] = { works: eff, before: before.a, after: after.a, popups: before.p + '>' + after.p, prevented: after.kp.some((x) => x.dp) };
      }
      R.keyshortcuts = await page.evaluate(() => [...document.querySelectorAll('[aria-keyshortcuts],[accesskey]')].length);
      // 9 composites
      await load();
      R.arrows = await page.evaluate(async () => {
        const K = window.__K, out = { tabs: 'n/a', lists: 'n/a', menus: 'n/a', ev: [] }; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const press = (el, key) => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); };
        return out;
      });
      // arrows via real keys
      const probes = await page.evaluate(() => {
        const K = window.__K, q = (s) => [...document.querySelectorAll(s)].filter((e) => K.vis(e));
        const tabsRole = q('[role=tab]'), tabsPlain = q('.tabs button,.tab,[class*=tabbar] button,[class*=tab-] button,nav[aria-label*=ab] button').filter((e) => e.getAttribute('role') !== 'tab');
        const grid = q('[role=grid],[role=listbox],[role=treegrid],[role=menu]'); const hasPopup = q('[aria-haspopup]');
        const rows = q('[role=row],tbody tr,.cbl-row,[data-row],[class*=listrow],li[tabindex]');
        return { tabsRole: tabsRole.length, tabsPlain: tabsPlain.length, composite: grid.length, hasPopup: hasPopup.length, rows: rows.length, rowFocusable: rows.filter((r) => r.tabIndex >= 0 || r.querySelector('a[href],button,input,[tabindex="0"]')).length };
      });
      R.arrowProbe = probes; R.arrow = {};
      async function arrowTest(selectorExpr, key, label) {
        const ok = await page.evaluate((s) => { const K = window.__K; const e = [...document.querySelectorAll(s)].filter((x) => K.vis(x))[0]; if (!e) return false; const t = e.tabIndex >= 0 ? e : (e.querySelector('a[href],button,input,[tabindex]') || e); t.focus(); window.__arrowFrom = t; return document.activeElement === t; }, selectorExpr);
        if (!ok) return label + ': first element not focusable';
        const a = await page.evaluate(() => window.__K.desc(document.activeElement) + '|' + [...document.querySelectorAll('[aria-selected=true],[aria-current],.active,.on,.sel')].length);
        await press(key);
        const b = await page.evaluate(() => window.__K.desc(document.activeElement) + '|' + [...document.querySelectorAll('[aria-selected=true],[aria-current],.active,.on,.sel')].length);
        return (a !== b ? 'moves' : 'no change') + ' (' + a.split('|')[0] + ' > ' + b.split('|')[0] + ')';
      }
      if (probes.tabsRole) R.arrow.tabs = 'role=tab: ' + await arrowTest('[role=tab]', 'ArrowRight', 'tabs');
      else if (probes.tabsPlain >= 2) R.arrow.tabs = 'plain tab buttons (no role=tab): ' + await arrowTest('.tabs button,.tab,[class*=tabbar] button,[class*=tab-] button,nav[aria-label*=ab] button', 'ArrowRight', 'tabs');
      if (probes.rowFocusable) R.arrow.list = 'rows: ' + await arrowTest('[role=row],tbody tr,.cbl-row,[data-row],[class*=listrow],li[tabindex]', 'ArrowDown', 'list');
      if (probes.composite) R.arrow.composite = await arrowTest('[role=grid],[role=listbox],[role=treegrid],[role=menu]', 'ArrowDown', 'composite');
      // 10 live regions + toast (the page's own toast function, no write)
      R.live = await page.evaluate(() => {
        const live = [...document.querySelectorAll('[aria-live]:not([aria-live=off]),[role=status],[role=alert],[role=log]')];
        const th = document.getElementById('toast'); const out = { regions: live.length, toastHost: th ? ('#toast live=' + (th.getAttribute('aria-live') || th.getAttribute('role') || 'none')) : 'no #toast', toastFn: typeof window.toast === 'function' };
        if (typeof window.toast === 'function') { try { window.toast('keyboard probe'); const t = document.querySelector('.toast'); out.toastInLive = !!(t && t.closest('[aria-live]:not([aria-live=off]),[role=status],[role=alert]')); } catch (e) { out.toastErr = String(e).slice(0, 60); } }
        return out;
      });
      // popups
      await load();
      const openers = await page.evaluate((n) => { const K = window.__K; const seen = new Set(); const out = [];
        document.querySelectorAll('button,[role=button],summary,a[href="#"],a[onclick]').forEach((e) => { if (!K.vis(e) || e.disabled || e.closest('header,nav,[data-dev-only]') ) return; const t = String(e.getAttribute('aria-label') || e.innerText || e.title || e.id).replace(/\s+/g, ' ').trim().slice(0, 40); if (!t || seen.has(t)) return; seen.add(t); out.push(t); });
        return out.slice(0, n); }, MAXOPEN);
      R.dataNotLoaded = readFailures(seen); R.openersScanned = openers.length; R.popups = [];
      const openByText = async (t) => page.evaluate((t) => { const K = window.__K; const e = [...document.querySelectorAll('button,[role=button],summary,a[href="#"],a[onclick]')].find((x) => K.vis(x) && String(x.getAttribute('aria-label') || x.innerText || x.title || x.id).replace(/\s+/g, ' ').trim().slice(0, 40) === t); if (!e) return false; e.focus(); window.__opener = e; window.__openerDesc = K.desc(e); window.__K.before = new Set(K.popups()); return document.activeElement === e; }, t);
      const newPopup = async () => page.evaluate(() => { const K = window.__K; const p = K.popups().filter((e) => !(K.before && K.before.has(e))); return !!p.length; });
      const closeAll = async () => { await press('Escape'); if (await page.evaluate(() => window.__K.popups().length)) { await page.evaluate(() => { const K = window.__K; K.popups().forEach((p) => { const b = [...p.querySelectorAll('button,[role=button]')].find((x) => /^(close|cancel|back|×|✕|x|done|no)$/i.test(String(x.getAttribute('aria-label') || x.innerText).trim())); if (b) b.click(); }); }); await sleep(250); } if (await page.evaluate(() => window.__K.popups().length)) await load(); };
      for (const t of openers) {
        if (R.popups.length >= MAXPOP) break; if (FORBID.test(t)) continue;
        const u0 = page.url(); const ok = await openByText(t); if (!ok) continue; const w0 = counts.writes;
        await press('Enter'); await sleep(350);
        if (page.url().split('#')[0] !== u0.split('#')[0]) { await load(); continue; }
        if (!(await newPopup())) { if (await page.evaluate(() => window.__K.popups().length)) await closeAll(); continue; }
        const P = { opener: t, writesOnOpen: counts.writes - w0 };
        const info = await page.evaluate(() => { const K = window.__K; const p = K.popups().filter((e) => !(K.before && K.before.has(e))).pop() || K.popups().pop(); window.__pop = p; const a = document.activeElement; const fo = K.focusables(p);
          return { kind: K.kind(p), id: p.id || '', cls: String(p.className || '').slice(0, 40), landing: K.desc(a), inside: p.contains(a), landingIsClose: /close|✕|×/i.test(String(a.getAttribute && (a.getAttribute('aria-label') || a.innerText) || '')), landingIsBody: a === document.body, nFocusable: fo.length, firstField: (fo.find((e) => /^(input|textarea|select)$/i.test(e.tagName) && e.type !== 'hidden' && e.type !== 'checkbox' && e.type !== 'radio') || {}).tagName ? true : false, hasRoleDlg: p.getAttribute('role') === 'dialog' || p.tagName === 'DIALOG', hasAriaLabel: !!(p.getAttribute('aria-label') || p.getAttribute('aria-labelledby')), nativeModal: p.tagName === 'DIALOG' && p.matches(':modal') }; });
        Object.assign(P, info);
        // Tab containment
        const esc = []; const n = Math.min(30, info.nFocusable + 4);
        for (let i = 0; i < n; i++) { await page.keyboard.press('Tab'); await sleep(40); const r = await page.evaluate(() => { const p = window.__pop, a = document.activeElement; return a === document.body ? 'BODY' : (p.contains(a) ? 'in' : window.__K.desc(a)); }); if (r !== 'in') esc.push(r); }
        P.tabEscapes = esc.length; P.tabEscapeTo = [...new Set(esc)].slice(0, 3);
        await page.keyboard.press('Shift+Tab'); await sleep(60); P.shiftTabInside = await page.evaluate(() => { const a = document.activeElement; return a === document.body ? 'BODY' : window.__pop.contains(a) ? 'in' : 'out'; });
        // Esc closes + focus returns
        await page.evaluate(() => { const K = window.__K; const f = K.focusables(window.__pop); if (f[0]) f[0].focus(); });
        await press('Escape'); await sleep(200);
        const after = await page.evaluate(() => { const K = window.__K; const open = K.popups().some((e) => e === window.__pop || window.__pop.contains(e) || e.contains(window.__pop)) && document.contains(window.__pop) && K.vis(window.__pop); const a = document.activeElement; const o = window.__opener; return { open, returned: a === o || (document.contains(o) ? false : (K.desc(a) === window.__openerDesc)), now: K.desc(a), openerDesc: window.__openerDesc }; });
        P.escCloses = !after.open; P.focusReturns = !after.open ? after.returned : null; P.focusNow = after.now;
        if (after.open) { await closeAll(); }
        // reopen for form tests
        let reopened = await openByText(t); if (reopened) { await press('Enter'); await sleep(350); reopened = await newPopup(); }
        if (reopened) {
          const f = await page.evaluate(() => { const K = window.__K; const p = K.popups().filter((e) => !(K.before && K.before.has(e))).pop() || K.popups().pop(); window.__pop = p; const fo = K.focusables(p); const field = fo.find((e) => /^(input|textarea)$/i.test(e.tagName) && !/^(checkbox|radio|hidden|file|button|submit|date|range|color)$/.test(e.type)); const prim0 = [...p.querySelectorAll('button')].filter((b) => K.vis(b) && !b.disabled && !/^(close|cancel|back|×|✕|x|no)$/i.test(String(b.getAttribute('aria-label') || b.innerText).trim()) && !/\bmx\b/.test(b.className)); const prim = prim0.find((b) => b.hasAttribute('data-sheet-save')) || prim0.find((b) => b.getAttribute('type') === 'submit' || /primary|btn-p|\bsave\b|\bok\b|receive|add|create|confirm|apply/i.test(b.className + ' ' + b.innerText)) || prim0[prim0.length - 1]; window.__field = field || null; window.__prim = prim || null; return { field: field ? K.desc(field) : null, prim: prim ? K.desc(prim) : null, inForm: field ? !!field.closest('form') : null, required: field ? field.required || field.getAttribute('aria-required') === 'true' : null, forms: p.querySelectorAll('form').length, inputs: fo.filter((e) => /^(input|select|textarea)$/i.test(e.tagName)).length }; });
          P.form = f;
          // 5: save with nothing typed
          if (f.prim) { const k0 = counts.writes; await page.evaluate(() => { window.__K.submits = 0; window.__prim.focus(); }); await press('Enter'); await sleep(400);
            P.emptySave = await page.evaluate(() => { const K = window.__K, a = document.activeElement, p = window.__pop; const stillOpen = document.contains(p) && K.vis(p); const inv = a && (a.getAttribute('aria-invalid') === 'true' || (a.matches && a.matches(':invalid'))); const desc = a && a.getAttribute && a.getAttribute('aria-describedby'); const descTxt = desc ? desc.split(' ').map((i) => (document.getElementById(i) || {}).innerText || '').join(' ').trim() : ''; const live = [...document.querySelectorAll('[role=alert],[aria-live]:not([aria-live=off]),[role=status]')].map((e) => (e.innerText || '').trim()).filter(Boolean).slice(0, 2); const nativeMsg = a && a.validationMessage ? a.validationMessage : ''; const errInDialog = stillOpen ? [...p.querySelectorAll('[class*=err],[class*=invalid],[class*=error],[role=alert]')].filter(K.vis).map((e) => (e.innerText || '').trim().slice(0, 50)).filter(Boolean).slice(0, 2) : []; return { stillOpen, focusOn: K.desc(a), focusInvalid: !!inv, describedby: !!descTxt, descTxt: descTxt.slice(0, 40), live, nativeMsg: nativeMsg.slice(0, 40), errInDialog, submits: K.submits }; });
            P.emptySave.writes = counts.writes - k0; if (!P.emptySave.stillOpen) { await load(); reopened = false; } }
        }
        if (!reopened) { reopened = await openByText(t); if (reopened) { await press('Enter'); await sleep(350); reopened = await newPopup(); } }
        if (reopened) {
          const f = await page.evaluate(() => { const K = window.__K; const p = K.popups().filter((e) => !(K.before && K.before.has(e))).pop() || K.popups().pop(); window.__pop = p; const field = K.focusables(p).find((e) => /^(input|textarea)$/i.test(e.tagName) && !/^(checkbox|radio|hidden|file|button|submit|date|range|color)$/.test(e.type) && !e.readOnly); window.__field = field || null; if (field) field.focus(); return field ? K.desc(field) : null; });
          if (f) {
            await page.keyboard.type('x'); await sleep(80);
            // 4 Enter on the one-line field (only for input, not textarea)
            const isTA = await page.evaluate(() => window.__field.tagName === 'TEXTAREA');
            if (!isTA) { const k0 = counts.writes; await page.evaluate(() => { window.__K.submits = 0; }); await press('Enter'); await sleep(350); P.enter = await page.evaluate(() => ({ submits: window.__K.submits, closed: !(document.contains(window.__pop) && window.__K.vis(window.__pop)) })); P.enter.writes = counts.writes - k0; P.enter.field = f; }
            else P.enter = { textarea: true };
            // 8 unsaved guard: dirty then Esc
            if (await page.evaluate(() => document.contains(window.__pop) && window.__K.vis(window.__pop))) { await page.evaluate(() => { window.__field.focus(); }); await page.keyboard.type('y'); await press('Escape'); await sleep(250);
              P.dirtyEsc = await page.evaluate(() => { const K = window.__K; const open = document.contains(window.__pop) && K.vis(window.__pop); const confirmUi = K.popups().some((e) => e !== window.__pop && !window.__pop.contains(e)) || [...document.querySelectorAll('[role=alertdialog]')].some(K.vis); return { closed: !open, confirmShown: confirmUi }; }); }
            else P.dirtyEsc = { skipped: 'popup closed on Enter' };
          } else { P.enter = { noField: true }; P.dirtyEsc = { noField: true }; }
        }
        await closeAll();
        R.popups.push(P);
      }
    } catch (e) { R.err = String(e && e.stack || e).slice(0, 300); }
    R.writesBlocked = counts.writes; result.pages.push(R); fs.writeFileSync(OUT, JSON.stringify(result, null, 1)); await ctx.close();
    console.log(name.padEnd(20), 'tab', R.tab && R.tab.n, 'skip', R.skip, 'popups', R.popups && R.popups.length, 'writes', counts.writes, R.err || '');
  }
  await browser.close(); console.log('KBD DONE');
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });

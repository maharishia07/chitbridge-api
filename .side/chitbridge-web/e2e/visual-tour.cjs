#!/usr/bin/env node
/**
 * e2e/visual-tour.cjs — THE VISUAL TOUR (round VTOUR, Athi 14 Oct: "do a visual verification of each of the screen starting from the very
 * first index page, and each page scroll up down, click each of the boxes before login in … next sign-in and walkthrough each page, scroll up
 * down and perform random operations in each of the screen").
 *
 * It DISCOVERS what to tour at run time — every page linked from the index, every built door in public/app/manifest.json, every public/*.html
 * (app.html excepted: the workshop) and each page's own tabs/sections — so a new page is toured without an edit here.
 *   PART A (signed out): each page top → bottom, one viewport at a time (a shot each); then EVERY box/card/link/button that does not submit,
 *     pay or send is clicked (one at a time, the page restored after any change): label · target · result (navigated / opened / changed /
 *     nothing happened / error). Sign-in and New shop: each step, the empty submit (what it says), then completed with the LOCAL code.
 *   PART B (signed in as the simulated shop): every page and each of its tabs/sections top → bottom, then RANDOM SAFE operations (open a row,
 *     sort, search, a filter, a tab, open a popup/form and close it) — never delete, pay or send (the danger words below are never clicked).
 * Every state records: screen code + name (public/app/screens.js CBSCREENS; UNNUMBERED when the page has none) · url · console errors ·
 * failed requests · sideways scroll · clipped text · controls under a bar · contrast (lib/theme-measure.cjs, need AA) · rule 13's audit
 * (lib/rule13.cjs) · dead clicks · the page's FRAME (header, avatar, Home, title, fonts) compared later with the index's.
 *
 * ⚠️ LOCAL STACK ONLY. It walks a site that is already running (e2e/lib/stack-local.cjs `up` — that site's /config.js points every api base at
 * the local api) through lib/walk.cjs opts.base, so every request to the production host is refused and FAILS the run (FX-QA1).
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/visual-tour.cjs --part a|b [--theme cream|dark] [--width 1366|390] [--shard 1/3]
 *        [--clicks 40] [--ops 7] [--pages index,shop] [--base http://localhost:5173] [--api http://localhost:3000] [--email simstores@test.example]
 *   node e2e/visual-tour.cjs --report [--fail-on broken]      merge every e2e/out/tour/run-*.json → tour.json + TOUR-FINDINGS.md (+ --docs: docs/testing/TOUR-FINDINGS.md)
 * Output: e2e/out/tour/<nn>-<code>-<page>-<step>.png (never committed — .github/workflows/visual-tour.yml uploads the folder).
 */
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out', 'tour');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

const PART = String(arg('part', 'a')).toLowerCase();
const THEME = arg('theme', 'cream'), WIDTH = Number(arg('width', 1366));
const BASE = String(arg('base', process.env.CB_WEB_BASE || 'http://localhost:5173')).replace(/\/+$/, '');
const API = String(arg('api', process.env.CB_API_BASE || 'http://localhost:3000')).replace(/\/+$/, '');
const EMAIL = arg('email', process.env.TOUR_EMAIL || 'simstores@test.example');
/* signed out, the storefront is toured on the shop api scripts/seed-local.cjs PUBLISHES (simstores' catalogue is private: "Shop not found") */
const STORE_EMAIL = arg('store-email', process.env.TOUR_STORE_EMAIL || 'mayur@local.test');
const MAX_CLICKS = Number(arg('clicks', process.env.TOUR_MAX_CLICKS || 40));
const OPS = Number(arg('ops', 6));
const ONLY = arg('pages', '') ? String(arg('pages')).split(',') : null;
const [SHARD, SHARDS] = String(arg('shard', '1/1')).split('/').map(Number);
const RUN = PART + '-' + THEME + '-' + WIDTH + (SHARDS > 1 ? '-s' + SHARD : '') + (ONLY ? '-p-' + ONLY.join('-').replace(/[^a-z0-9-]+/gi, '').slice(0, 40) : '');   /* a --pages run never overwrites the full run's file */

/* ⚠️ what the tour never clicks, by its words (label · test id · title): anything that writes, pays, sends, prints, leaves or signs out.
   "Open a form and cancel" is allowed — New / Add open a form; the form's own Save is one of these words. */
/* a page's own tabs / sections, signed in: tab roles, segmented controls, the sidebar's buttons */
const TABS = '[role=tab],.tab,.tabs button,.cbl-seg button,.side button,nav button,aside button,.nav-btn,.skel-side button,.skel-side a';
const MAX_SECTIONS = Number(arg('sections', 30));
const DANGER = /\b(pay|paid|payment|send|sent|submit|save|delete|remove|sign ?out|log ?out|print|publish|confirm|place|post(ed)?|issue|seal|archive|trash|approve|reject|refund|void|close (the )?(month|year|day|books)|lock|unlock|reverse|write.?off|settle|record|import|upload|enable|disable|reset|clear|drop|retire|invite|share|whatsapp|e-?mail|sms|download|export|accept|decline|verify|continue|register|buy|order now|checkout|tender|charge|collect|transfer|deactivate|revoke|leave|quit|end)\b/i;

/* ── the screen register (CBSCREENS): the pages that own a code. Everything else is UNNUMBERED — itself a finding (VTOUR critique (a)). ── */
const REG = (() => { const w = {}; try { const src = fs.readFileSync(path.join(ROOT, 'public', 'app', 'screens.js'), 'utf8'); new Function('window', src)(w); } catch (e) { console.log('screens.js not read: ' + e.message); } return w.CBSCREENS || { rows: {} }; })();
const REG_ROWS = Object.values(REG.rows || {});
const PAGE_CODE = { 'till.html': 'Its own app › Counter', 'shop.html': 'Its own app › Storefront', 'app.html': 'The app itself › app.html' };
function codeOf(pageFile) {
  const p = PAGE_CODE[pageFile]; const row = p && REG_ROWS.find((r) => r.path === p);
  return row ? { code: row.code, name: row.screen || row.path } : { code: 'UNNUMBERED', name: null };
}
const slug = (s) => String(s || '').replace(/^\/+/, '').replace(/\.html/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'index';

/* ── what to tour ──────────────────────────────────────────────────────────────────────────────────────────────── */
function pageList(bridge) {
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'app', 'manifest.json'), 'utf8'));
  const doors = man.entries.filter((e) => e.route && e.state === 'built').map((e) => e.route.replace('{bridge_id}', bridge || ''));
  const files = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => /\.html$/.test(f) && f !== 'app.html').map((f) => '/' + f);
  const extra = PART === 'a' ? ['/settings.html#/new', '/shop.html' + (bridge ? '?s=' + bridge : '')] : [];
  const seen = new Set(), out = [];
  for (const u of ['/'].concat(doors, extra, files)) {
    const file = u.split(/[?#]/)[0];
    const key = PART === 'b' ? file : u;    /* signed in, a page's tabs are found on the page itself; signed out each door is its own state */
    if (seen.has(key) || /bill-print/.test(file)) continue;   /* bill-print.html is a print view (window.print) — opened by a bill, never by a person */
    seen.add(key); out.push(u);
  }
  return out.filter((u) => !ONLY || ONLY.some((o) => (o === 'index' && u === '/') || (o !== 'index' && u.includes(o))))
    .filter((_, i) => SHARDS <= 1 || i % SHARDS === SHARD - 1);
}

/* ── in-page probes (serialised whole into the page) ────────────────────────────────────────────────────────────── */
/* the element that scrolls: the document, or the tallest inner scroller (a skeleton page scrolls its main, not the body) */
function findScroller() {
  const de = document.scrollingElement || document.documentElement;
  if (de.scrollHeight > window.innerHeight + 4) return { doc: true, total: de.scrollHeight, view: window.innerHeight };
  let best = null;
  document.querySelectorAll('body *').forEach((el) => {
    const cs = getComputedStyle(el); if (!/auto|scroll/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 4 || el.clientHeight < 120) return;
    if (!best || el.clientHeight * el.clientWidth > best.clientHeight * best.clientWidth) best = el;
  });
  document.querySelectorAll('[data-tour-scroller]').forEach((e) => e.removeAttribute('data-tour-scroller'));
  if (!best) return { doc: true, total: de.scrollHeight, view: window.innerHeight };
  best.setAttribute('data-tour-scroller', '1');
  return { doc: false, total: best.scrollHeight, view: best.clientHeight };
}
function scrollStep(y) { const s = document.querySelector('[data-tour-scroller]'); if (s) s.scrollTop = y; else window.scrollTo(0, y); }

/* the page's frame — what every page should share with the index (one shell, even without a login) */
function frameOf() {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const first = (sel) => Array.from(document.querySelectorAll(sel)).find(vis) || null;
  const hdr = first('.cbsh-hdr, header, [role=banner], .bar, .topbar, .hdr');
  const h1 = first('h1');
  const avatar = first('[data-testid=signin-door], [data-testid=cbavatar], [data-testid=avatar], #cb-avatar .cbav, .cbav');
  const home = first('[data-testid=shell-nav-home], a[href="/"], a[href="/index.html"], a[href="index.html"], [data-testid=home], [data-testid=skel-home]');
  const bcs = getComputedStyle(document.body);
  const font = (el) => el ? getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim() : null;
  return {
    title: document.title, h1: h1 ? h1.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : null, h1Font: font(h1), h1Size: h1 ? getComputedStyle(h1).fontSize : null,
    bodyFont: font(document.body), bodySize: bcs.fontSize, header: hdr ? (hdr.className && typeof hdr.className === 'string' ? '.' + hdr.className.split(' ')[0] : hdr.tagName.toLowerCase()) : null,
    headerH: hdr ? Math.round(hdr.getBoundingClientRect().height) : 0, avatar: !!avatar, avatarText: avatar ? avatar.textContent.replace(/\s+/g, ' ').trim().slice(0, 30) : null, home: !!home,
    switcher: !!first('[data-testid=shell-switcher]'), shell: !!document.querySelector('.cbsh-hdr'), themed: document.documentElement.getAttribute('data-theme'), cbAvatar: !!window.CBAvatar,
    lang: document.documentElement.lang || null,
  };
}

/* controls a fixed/sticky bar sits on, at the top of the page (the content's own first controls hidden under the bar) */
function underBar() {
  const out = [], bars = [];
  document.querySelectorAll('body *').forEach((el) => {
    const cs = getComputedStyle(el); if (!/fixed|sticky/.test(cs.position)) return;
    const r = el.getBoundingClientRect(); if (r.width < window.innerWidth * 0.5 || r.height < 20 || r.height > window.innerHeight * 0.4 || cs.visibility === 'hidden' || cs.display === 'none') return;
    bars.push({ el, r });
  });
  document.querySelectorAll('a,button,input,select,textarea,h1,h2').forEach((c) => {
    const r = c.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
    for (const b of bars) {
      if (b.el.contains(c) || c.contains(b.el)) continue;
      const ov = Math.min(r.bottom, b.r.bottom) - Math.max(r.top, b.r.top);
      if (ov > r.height / 2 && Math.min(r.right, b.r.right) - Math.max(r.left, b.r.left) > 4) {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, ov / 2));
        if (hit && b.el.contains(hit)) out.push((c.dataset.testid || c.id || c.tagName) + ' "' + (c.textContent || '').trim().slice(0, 24) + '" under ' + ((typeof b.el.className === 'string' && b.el.className.split(' ')[0]) || b.el.tagName));
      }
    }
  });
  return out.slice(0, 12);
}

/* the empty-state words a page shows (compared across pages: one wording, or several) */
function emptyWords() {
  const out = new Set();
  document.querySelectorAll('p,div,span,td,li,em,i').forEach((el) => {
    if (el.children.length > 1) return; const r = el.getBoundingClientRect(); if (r.width < 1) return;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t.length > 4 && t.length < 90 && /^(no |nothing|none yet|empty|not yet|there (is|are) no)/i.test(t)) out.add(t);
  });
  return Array.from(out).slice(0, 8);
}

/* the clickables, marked data-tour-i in document order; each carries the words the tour decides on */
function markClickables() {
  const SEL = 'a[href],button,[role=button],[role=tab],[role=link],summary,[onclick]';
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return true; };
  const out = []; let i = 0;
  document.querySelectorAll('[data-tour-i]').forEach((e) => e.removeAttribute('data-tour-i'));
  document.querySelectorAll(SEL).forEach((el) => {
    if (!vis(el) || el.closest('#__walkbanner') || (el.parentElement && el.parentElement.closest(SEL) && !el.matches('a[href],button'))) return;
    el.setAttribute('data-tour-i', String(i));
    const label = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    out.push({ i: i++, tag: el.tagName.toLowerCase(), label, href: el.getAttribute('href') || '', testid: el.dataset.testid || '', type: el.getAttribute('type') || '',
      disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'), inForm: !!el.closest('form'), title: el.getAttribute('title') || '' });
  });
  return out;
}
/* a cheap fingerprint of what the page shows: a change after a click = something opened or changed */
function sig() {
  const open = Array.from(document.querySelectorAll('dialog[open],[role=dialog],[aria-modal=true],.modal,.sheet,.popup,.drawer,[data-open="1"]')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
  /* a jump within the page (scroll), a pressed/current/expanded control, or the focus moving are answers too (Home's area buttons scroll) */
  const sc = document.querySelector('[data-tour-scroller]'), y = Math.round(window.scrollY + (sc ? sc.scrollTop : 0));
  const scrolled = Array.from(document.querySelectorAll('main,[class*=main],[class*=scroll]')).reduce((n, e) => n + Math.round(e.scrollTop || 0), 0);
  const marks = Array.from(document.querySelectorAll('[aria-current],[aria-pressed=true],[aria-expanded=true],[aria-selected=true],details[open]')).map((e) => e.dataset.testid || e.id || e.tagName).join(',');
  const fe = document.activeElement, focus = fe && /^(INPUT|TEXTAREA|SELECT)$/.test(fe.tagName) ?(fe.dataset.testid || fe.id || fe.name || fe.tagName) : '';
  return location.href + '|' + open + '|' + document.body.innerText.length + '|' + document.querySelectorAll('body *').length + '|' + y + '|' + scrolled + '|' + marks + '|' + focus;
}

/* ── the tour ─────────────────────────────────────────────────────────────────────────────────────────────────── */
async function main() {
  if (has('report')) return report();
  fs.mkdirSync(OUT, { recursive: true });
  const W = require('./lib/walk.cjs');
  const { measure } = require('./lib/theme-measure.cjs');
  const { audit } = require('./lib/rule13.cjs');
  const { signinCode } = require('./lib/signin-code.cjs');
  const R = require('./lib/real-stack.cjs');
  const viewport = { width: WIDTH, height: WIDTH > 500 ? 900 : 844 };
  const w = await W.start('tour-' + RUN, { base: BASE, viewport });
  const states = [];
  /* what was seen is kept even when the run is cut short (a time limit's SIGTERM, a crash): the report lists it, never loses it */
  saveRun = (why) => { const f = path.join(OUT, 'run-' + RUN + '.json'); fs.writeFileSync(f, JSON.stringify({ run: RUN, part: PART, theme: THEME, width: WIDTH, base: BASE, at: new Date().toISOString(), refused: w.refused, stopped: why || null, states }, null, 1)); return f; };
  const runIdx = { a: 1, b: 5 }[PART] + (THEME === 'dark' ? 1 : 0) + (WIDTH < 500 ? 2 : 0);
  let counter = 0;
  const nn = () => String(runIdx) + String(SHARD) + String(++counter).padStart(4, '0');
  const tag = (THEME === 'dark' ? 'd' : 'c') + WIDTH;

  /* the signed-in session (Part B): the two calls the Sign in screen makes, against the LOCAL api — real-stack.signIn */
  let sess = null, bridge = '';
  try {
    const s = await R.signIn(API, PART === 'b' ? EMAIL : STORE_EMAIL); bridge = (s.entity && s.entity.bridge_id) || ''; if (PART === 'b') sess = s.session;
    /* signed in, the account's saved appearance is the truth (CBAvatar.hydrate) — the device's cb_theme alone would be painted over, so the theme
       is set the way the avatar menu sets it: the app's own door, PATCH /api/entities/me/prefs/ui (this shop, on the LOCAL api only) */
    if (PART === 'b') { const t = await R.j(API + '/api/entities/me/prefs/ui', { method: 'PATCH', token: s.token, body: { theme: THEME } }); if (t.status >= 300) console.log('theme not saved on the account (' + t.status + ') — signed-in shots keep the account\'s theme'); }
  } catch (e) { if (PART === 'b') { console.log('TOUR STOPPED · cannot sign in ' + EMAIL + ' on ' + API + ': ' + e.message); await w.close(); process.exit(1); } }

  const ctx = await w.contextAt();
  await ctx.addInitScript(([theme, s]) => {
    try { localStorage.setItem('cb_theme', theme); if (s) localStorage.setItem('cb_sess', s); else if (!sessionStorage.getItem('__tour_keep')) localStorage.removeItem('cb_sess'); } catch (_) {}
  }, [THEME, sess]);
  await ctx.setDefaultTimeout(8000);
  let page = await ctx.newPage(); await page.setViewportSize(viewport);
  /* the bucket the listeners fill; swapped at every state */
  let bucket = { console: [], failed: [], pageerr: [], dialogs: [], reach: [] };   /* reach = the TOUR could not get somewhere (a tab it could not press) — not the product's error */
  const wire = (p) => {
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_FAILED$|Failed to load resource: net::ERR_FAILED/.test(m.text())) bucket.console.push(m.text().slice(0, 200)); });
    p.on('pageerror', (e) => bucket.pageerr.push(String(e && e.message || e).slice(0, 200)));
    p.on('requestfailed', (q) => { const why = (q.failure() && q.failure().errorText) || ''; if (!/fonts\.(googleapis|gstatic)/.test(q.url()) && !/ERR_ABORTED/.test(why)) bucket.failed.push('FAILED ' + q.method() + ' ' + q.url().replace(BASE, '').replace(API, 'api:') + ' ' + ((q.failure() && q.failure().errorText) || '')); });
    p.on('response', (r) => { if (r.status() >= 400) bucket.failed.push(r.status() + ' ' + r.request().method() + ' ' + r.url().replace(BASE, '').replace(API, 'api:')); });
    p.on('dialog', (d) => { bucket.dialogs.push(d.type() + ': ' + d.message().slice(0, 80)); d.dismiss().catch(() => {}); });
  };
  wire(page);
  const take = () => { const b = bucket; bucket = { console: [], failed: [], pageerr: [], dialogs: [], reach: [] }; return b; };

  const settle = async (p, ms) => { try { await p.waitForLoadState('load', { timeout: 10000 }); } catch (_) { /* a slow page is shot as it is */ } await p.waitForTimeout(ms || 900); };
  const go = async (u) => {
    let status = 0;
    try { const r = await page.goto(BASE + u, { waitUntil: 'domcontentloaded', timeout: 20000 }); status = r ? r.status() : 0; } catch (e) { bucket.reach.push('navigation: ' + String(e.message).split('\n')[0]); }
    await settle(page, 1200);
    if (declineNow && await page.locator('[data-testid="signin-later"]:visible').count()) { await page.locator('[data-testid="signin-later"]').first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); }
    return status;
  };
  let declineNow = false;   /* after a page's first state: the counter's PIN offer is declined on every reload (see the page loop) */
  const shot = async (name) => { const f = name + '.png'; try { await page.screenshot({ path: path.join(OUT, f) }); return f; } catch (_) { return null; } };
  const fileOf = (u) => { const f = String(u).split(/[?#]/)[0].replace(/^\//, ''); return f || 'index.html'; };

  /** one screen state: shots top → bottom, then the checks */
  async function screenState(u, step, extra) {
    const file = fileOf(new URL(page.url()).pathname), id = codeOf(file), n = nn(), base = n + '-' + id.code + '-' + slug(file === 'index.html' ? 'index' : file) + (step ? '-' + step : '') + '-' + tag;
    const shots = [];
    const sc = await page.evaluate(findScroller).catch(() => ({ doc: true, total: 0, view: viewport.height }));
    const steps = Math.min(12, Math.max(1, Math.ceil(sc.total / Math.max(1, sc.view))));
    for (let i = 0; i < steps; i++) {
      await page.evaluate(scrollStep, i * sc.view).catch(() => {}); await page.waitForTimeout(250);
      const f = await shot(base + (i ? '-s' + i : '-top')); if (f) shots.push(f);
    }
    await page.evaluate(scrollStep, 0).catch(() => {});
    let pairs = [], a = { clip: [], scroll: [], cover: [], app: [], budget: [] }, fr = {}, ub = [], ew = [];
    try { pairs = await page.evaluate(measure); } catch (e) { bucket.pageerr.push('measure: ' + e.message.split('\n')[0]); }
    try { a = await audit(page, '__tour_whole_page__'); } catch (e) { bucket.pageerr.push('audit: ' + e.message.split('\n')[0]); }
    try { fr = await page.evaluate(frameOf); ub = await page.evaluate(underBar); ew = await page.evaluate(emptyWords); } catch (_) { /* a navigating page: the next state carries it */ }
    await page.evaluate(scrollStep, 0).catch(() => {});
    const b = take();
    const st = Object.assign({ nn: n, run: RUN, part: PART, theme: THEME, width: WIDTH, page: file, code: id.code, name: id.name || fr.h1 || fr.title || file,
      url: page.url().replace(BASE, ''), step: step || 'top', kind: 'screen', shots, reach: b.reach,
      console: b.console.concat(b.pageerr.map((x) => 'pageerror: ' + x)), failed: b.failed, dialogs: b.dialogs,
      sideways: a.scroll, clipped: a.clip, underBar: Array.from(new Set(ub.concat(a.cover))).slice(0, 12), appLinks: a.app, budget: a.budget,
      contrast: pairs.filter((x) => !x.grad && x.ratio < x.need).map((x) => x.ratio + ':1 (need ' + x.need + ') "' + x.text + '" ' + x.tag).slice(0, 15),
      measured: pairs.length, lowest: pairs.length ? Math.min.apply(null, pairs.map((x) => x.ratio)) : null, frame: fr, emptyWords: ew }, extra || {});
    states.push(st);
    console.log(st.nn + ' · ' + st.code + ' · ' + st.url + ' · ' + st.step + ' · ' + shots.length + ' shots · console ' + st.console.length + ' · failed ' + st.failed.length + ' · contrast ' + st.contrast.length + ' · clip ' + st.clipped.length + ' · sideways ' + st.sideways.length);
    return st;
  }

  /** click one control and say what happened; the page is restored by the caller when anything changed */
  async function clickOne(c, from) {
    const loc = page.locator('[data-tour-i="' + c.i + '"]').first();
    const before = await page.evaluate(sig).catch(() => ''), urlBefore = page.url();
    let popup = null; const onPage = (p) => { popup = p; }; ctx.on('page', onPage);
    let result = 'nothing happened', target = '', err = '';
    try {
      await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await loc.click({ timeout: 3000 });
      await page.waitForTimeout(700);
      try { await page.waitForLoadState('domcontentloaded', { timeout: 4000 }); } catch (_) { /* stayed */ }
      await page.waitForTimeout(300);
    } catch (e) { err = String(e.message).split('\n')[0].slice(0, 160); result = /Timeout/.test(err) ? 'cannot be clicked' : 'error'; }
    ctx.off('page', onPage);
    if (popup) { result = 'opened a new tab'; target = popup.url(); try { await popup.close(); } catch (_) {} }
    else if (result !== 'error' && result !== 'cannot be clicked') {
      const after = await page.evaluate(sig).catch(() => 'navigating');
      if (page.url() !== urlBefore) { result = 'navigated'; target = page.url().replace(BASE, ''); }
      else if (after !== before) { result = /\|[1-9]\d*\|/.test(after) && !/\|[1-9]\d*\|/.test(before) ? 'opened' : 'changed'; target = 'same page'; }
    }
    const b = bucket;
    if (b.pageerr.length && result !== 'error') { result = 'error'; err = b.pageerr[b.pageerr.length - 1]; }
    return { result, target, err, changed: result !== 'nothing happened', from };
  }

  /** PART A: every box on the page, one at a time */
  async function clickAll(u, file) {
    const seen = new Map(); let clicked = 0;
    let list = await page.evaluate(markClickables).catch(() => []);
    const total = list.length;
    for (let k = 0; k < total && clicked < MAX_CLICKS; k++) {
      list = await page.evaluate(markClickables).catch(() => []);
      const c = list[k]; if (!c) break;
      const key = c.testid || (c.href ? 'href:' + c.href : c.tag + ':' + c.label);
      const rec = { label: c.label || c.testid || c.tag, testid: c.testid, href: c.href };
      const skip = c.disabled ? 'greyed (disabled) — not clicked' : (c.type === 'submit' || DANGER.test(c.label + ' ' + c.testid + ' ' + c.title)) ? 'not clicked (it writes, pays, sends or leaves)'
        : /app\.html/.test(c.href) ? 'links to the workshop (app.html) — not followed' : /^(mailto|tel|sms|whatsapp):/i.test(c.href) ? 'contact link — not followed'
          : (c.href && /^https?:/i.test(c.href) && !c.href.startsWith(BASE)) ? 'external link — not followed' : seen.has(key) ? 'same as ' + seen.get(key) : null;
      if (skip) { states.push({ nn: nn(), run: RUN, part: PART, theme: THEME, width: WIDTH, page: file, code: codeOf(file).code, url: u, kind: 'click', element: rec, result: 'skipped', target: skip, shots: [], console: [], failed: [] }); continue; }
      seen.set(key, rec.label.slice(0, 30)); clicked++;
      take();
      const r = await clickOne(c, u);
      const n = nn(), f = await shot(n + '-' + codeOf(file).code + '-' + slug(file === 'index.html' ? 'index' : file) + '-click' + String(k).padStart(2, '0') + '-' + tag);
      const b = take();
      states.push({ nn: n, run: RUN, part: PART, theme: THEME, width: WIDTH, page: file, code: codeOf(file).code, url: u, kind: 'click', element: rec, result: r.result, target: r.target, error: r.err,
        shots: f ? [f] : [], console: b.console.concat(b.pageerr.map((x) => 'pageerror: ' + x)), failed: b.failed, dialogs: b.dialogs, dead: r.result === 'nothing happened' && !c.disabled });
      console.log('   click ' + k + ' "' + rec.label.slice(0, 40) + '" → ' + r.result + (r.target ? ' ' + r.target : '') + (r.err ? ' (' + r.err + ')' : ''));
      if (r.changed) { await go(u); }
    }
  }

  /** PART A forms: Sign in (empty → code → empty code → the local code) and New shop (empty → code → agree gate → the local code) */
  async function forms() {
    const code = signinCode('owner', API);
    /* sign in, from the index's door (the init script leaves a session alone while __tour_keep is set — the forms' own sign-in must survive its navigation) */
    await go('/'); await page.evaluate(() => sessionStorage.setItem('__tour_keep', '1')); take();
    const door = page.locator('[data-testid="signin-door"]').first();
    if (await door.count()) { await door.click().catch(() => {}); await page.waitForTimeout(500); }
    if (await page.locator('[data-testid="signin-id"]').count()) {
      await screenState('/', 'signin-1-open', { kind: 'form' });
      await page.click('[data-testid="signin-go"]').catch(() => {}); await page.waitForTimeout(800);
      const why = await page.locator('[data-testid="signin-why"]').first().textContent().catch(() => null);
      await screenState('/', 'signin-2-empty', { kind: 'form', validation: why || '(nothing said)' });
      await page.fill('[data-testid="signin-id"]', EMAIL); await page.click('[data-testid="signin-go"]');
      await page.waitForSelector('[data-testid="signin-code"],[data-testid="signin-pin"],[data-testid="signin-choice"]', { timeout: 15000 }).catch(() => {});
      await screenState('/', 'signin-3-code', { kind: 'form' });
      if (await page.locator('[data-testid="signin-code"]').count()) {
        await page.click('[data-testid="signin-verify"]').catch(() => {}); await page.waitForTimeout(800);
        const why2 = await page.locator('[data-testid="signin-why"]').first().textContent().catch(() => null);
        await screenState('/', 'signin-4-empty-code', { kind: 'form', validation: why2 || '(nothing said)' });
        await page.fill('[data-testid="signin-code"]', code); await page.click('[data-testid="signin-verify"]');
        await page.waitForTimeout(2500);
        const inNow = await page.evaluate(() => !!localStorage.getItem('cb_sess')).catch(() => false);
        await screenState('/', 'signin-5-done', { kind: 'form', completed: inNow, validation: inNow ? 'signed in' : 'NOT signed in after the local code' });
      }
    } else states.push({ nn: nn(), run: RUN, part: PART, page: 'index.html', code: 'UNNUMBERED', url: '/', kind: 'form', step: 'signin', result: 'error', error: 'the Sign in door opened no sign-in window', shots: [], console: [], failed: [] });
    await page.evaluate(() => { localStorage.removeItem('cb_sess'); }).catch(() => {});
    /* New shop */
    await go('/settings.html#/new'); take();
    if (await page.locator('[data-testid="reg-name"]').count()) {
      await screenState('/settings.html#/new', 'register-1-open', { kind: 'form' });
      await page.click('[data-testid="reg-submit"]').catch(() => {}); await page.waitForTimeout(800);
      const v = await page.evaluate(() => { const e = document.querySelector('[data-testid="reg-err"],[role=alert],.err,.cbsi-why,:invalid'); return e ? (e.textContent || e.validationMessage || e.getAttribute('name') || '').trim().slice(0, 120) || ('invalid: ' + (e.getAttribute('data-testid') || e.name)) : null; }).catch(() => null);
      await screenState('/settings.html#/new', 'register-2-empty', { kind: 'form', validation: v || '(nothing said)' });
      const handle = 'tour' + String(Date.now()).slice(-7);
      await page.fill('[data-testid="reg-name"]', handle); await page.fill('[data-testid="reg-email"]', handle + '@test.example');
      await page.click('[data-testid="reg-submit"]').catch(() => {});
      await page.waitForSelector('[data-testid="reg-otp"]', { timeout: 15000 }).catch(() => {});
      await screenState('/settings.html#/new', 'register-3-code', { kind: 'form' });
      if (await page.locator('[data-testid="reg-otp"]').count()) {
        const greyed = await page.locator('[data-testid="reg-submit"]').isDisabled().catch(() => null);
        await screenState('/settings.html#/new', 'register-4-agree-gate', { kind: 'form', validation: greyed ? 'Verify greyed until the agreement is ticked' : 'Verify NOT greyed before the agreement' });
        await page.check('[data-testid="reg-agree"]').catch(() => {});
        await page.fill('[data-testid="reg-otp"]', code); await page.click('[data-testid="reg-submit"]').catch(() => {});
        await page.waitForTimeout(3000);
        const inNow = await page.evaluate(() => !!localStorage.getItem('cb_sess')).catch(() => false);
        await screenState(page.url().replace(BASE, ''), 'register-5-done', { kind: 'form', completed: inNow, validation: inNow ? 'registered and signed in' : 'NOT signed in after the local code' });
      }
    }
    await page.evaluate(() => { localStorage.removeItem('cb_sess'); sessionStorage.removeItem('__tour_keep'); }).catch(() => {});
  }

  /** PART B: the page's own tabs / sections (hash links, role=tab, the sidebar) */
  async function sectionsOf(file) {
    return page.evaluate(([file, TABS, MAX, dangerSrc]) => {
      const DANGER = new RegExp(dangerSrc, 'i');
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden'; };
      const out = [], seen = new Set();
      document.querySelectorAll('a[href]').forEach((a) => {
        if (!vis(a)) return; const h = a.getAttribute('href'); let u; try { u = new URL(h, location.href); } catch (_) { return; }
        if (u.origin !== location.origin || u.pathname.replace(/^\//, '') !== (file === 'index.html' ? '' : file) && !(file === 'index.html' && u.pathname === '/index.html')) return;
        if (!u.hash || u.hash.length < 2) return; const k = u.hash.split('?')[0];
        if (seen.has(k)) return; seen.add(k); out.push({ how: 'url', hash: u.hash, label: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) });
      });
      document.querySelectorAll(TABS).forEach((b, i) => {
        if (!vis(b) || b.closest('.cbsh-hdr')) return; const l = (b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40); if (!l || seen.has('btn:' + l)) return;
        /* a group header or a collapse toggle is not a section — and its state is kept, so clicking it would hide the next tabs */
        if (DANGER.test(l + ' ' + (b.dataset.testid || ''))) return;   /* the tour never pays, sends or saves — not even through a "tab" (the counter's Pay ›) */
        if (b.hasAttribute('aria-expanded') || /grp|group|toggle|collapse/i.test(String(b.className) + ' ' + (b.dataset.testid || '')) || /^(collapse|expand|show more|less)$/i.test(l)) return;
        seen.add('btn:' + l); out.push({ how: 'tab', label: l, testid: b.dataset.testid || '', idx: i });
      });
      return out.slice(0, MAX);
    }, [file, TABS, MAX_SECTIONS, DANGER.source]).catch(() => []);
  }

  /* a small seeded random — the same run picks the same operations (a finding reproduces) */
  let seed = 7 + runIdx * 101 + SHARD; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  /** PART B: 5–10 random SAFE operations on the screen in front of us */
  async function randomOps(u, file, section) {
    const collect = () => page.evaluate((dangerSrc) => {
      const DANGER = new RegExp(dangerSrc, 'i');
      const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return true; };
      const words = (el) => ((el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '') + ' ' + (el.dataset.testid || '')).replace(/\s+/g, ' ').trim();
      const out = []; let i = 0;
      /* rows on screen: a sort header over 2 rows or fewer cannot show a change, so it is never a dead click */
      const rowCount = Array.from(document.querySelectorAll('.cbl-row,.cbl-lrec,tbody tr,[data-testid$="-row"]')).filter(vis).length;
      document.querySelectorAll('[data-tour-op]').forEach((e) => e.removeAttribute('data-tour-op'));
      const add = (kind, el) => { if (!vis(el) || el.closest('.cbsh-hdr,#cb-avatar') || el.disabled) return; if (kind !== 'search' && kind !== 'select' && (DANGER.test(words(el)) || !words(el))) return; el.setAttribute('data-tour-op', String(i)); out.push({ i: i++, kind, label: words(el).slice(0, 50), rows: kind === 'sort' ? rowCount : undefined }); };
      document.querySelectorAll('.cbl-row,.cbl-lrec,tbody tr,[data-testid$="-row"],li[onclick],.row[onclick]').forEach((e) => add('open a row', e));
      document.querySelectorAll('.cbl-hc,th[onclick],th button,[data-sort]').forEach((e) => add('sort', e));
      document.querySelectorAll('input[type=search],input[placeholder*="earch" i],input[placeholder*="ind" i]').forEach((e) => add('search', e));
      document.querySelectorAll('select').forEach((e) => { if (!e.closest('form') && e.options.length > 1) add('select', e); });
      document.querySelectorAll('[role=tab],.cbl-seg button,.tab,.chip[onclick],.cbl-fchip,.optchip').forEach((e) => add('switch a tab/filter', e));
      document.querySelectorAll('button,a[href^="#"],[role=button]').forEach((e) => { const t = words(e); if (/(^|\s)(＋|\+|new|add|more|details?|open|view|filter|columns|show|info|why|help|ⓘ|⋯|…|›)(\s|$)/i.test(t)) add('open a popup / form', e); });
      return out;
    }, DANGER.source).catch(() => []);
    /* the list is collected again before every operation (the last one may have re-drawn the screen), and a used control is not picked twice */
    let ops = await collect();
    if (!ops.length) return;
    const want = Math.min(ops.length, OPS + Math.floor(rnd() * 4) - 1), done = new Set();
    for (let k = 0; k < want; k++) {
      if (k) ops = await collect();
      const fresh = ops.filter((x) => !done.has(x.kind + ':' + x.label)); if (!fresh.length) break;
      const o = fresh[Math.floor(rnd() * fresh.length)]; done.add(o.kind + ':' + o.label);
      take();
      const loc = page.locator('[data-tour-op="' + o.i + '"]').first(); const urlBefore = page.url(), before = await page.evaluate(sig).catch(() => '');
      let result = 'nothing happened', err = '';
      try {
        await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        if (o.kind === 'search') { await loc.fill('a', { timeout: 3000 }); await page.waitForTimeout(700); }
        else if (o.kind === 'select') { await loc.evaluate((s) => { s.selectedIndex = (s.selectedIndex + 1) % s.options.length; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(700); }
        else { await loc.click({ timeout: 3000 }); await page.waitForTimeout(800); }
      } catch (e) { err = String(e.message).split('\n')[0].slice(0, 160); result = /Timeout/.test(err) ? 'cannot be clicked' : 'error'; }
      const after = await page.evaluate(sig).catch(() => 'navigating');
      if (result !== 'error' && result !== 'cannot be clicked') result = page.url() !== urlBefore ? 'navigated' : after !== before ? 'changed' : 'nothing happened';
      const n = nn(), f = await shot(n + '-' + codeOf(file).code + '-' + slug(file) + '-' + slug(section) + '-op' + k + '-' + tag);
      /* close what opened: Esc, then a visible ✕ / Close / Cancel; a different page → back to the section */
      if (result !== 'nothing happened' && result !== 'cannot be clicked') {
        await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(250);
        const closer = page.locator('[role=dialog] button:has-text("✕"), dialog[open] button:has-text("✕"), button:has-text("Cancel"), button:has-text("Close"), [aria-label="Close"]').first();
        if (await closer.isVisible().catch(() => false)) { await closer.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(300); }
        if (o.kind === 'search') await loc.fill('', { timeout: 2000 }).catch(() => {});
      }
      const b = take();
      if (b.pageerr.length && result !== 'error') { result = 'error'; err = b.pageerr[0]; }
      states.push({ nn: n, run: RUN, part: PART, theme: THEME, width: WIDTH, page: file, code: codeOf(file).code, url: u, section, kind: 'op', op: o.kind, element: { label: o.label }, result, error: err,
        shots: f ? [f] : [], console: b.console.concat(b.pageerr.map((x) => 'pageerror: ' + x)), failed: b.failed, dialogs: b.dialogs, dead: result === 'nothing happened' && o.kind !== 'search' && o.kind !== 'select' && !(o.kind === 'sort' && o.rows < 3) });
      console.log('   op ' + k + ' ' + o.kind + ' "' + o.label.slice(0, 40) + '" → ' + result + (err ? ' (' + err + ')' : ''));
      if (result !== 'nothing happened') await go(u);   /* every operation starts from the screen as it first stood */
    }
  }

  const pages = pageList(bridge);
  console.log('VISUAL TOUR · part ' + PART.toUpperCase() + ' · ' + THEME + ' · ' + WIDTH + ' px · ' + pages.length + ' page(s) · ' + BASE + (sess ? ' · signed in as ' + EMAIL : ' · signed out'));
  const deadline = Date.now() + Number(process.env.TOUR_BUDGET_MS || 9 * 60 * 1000);
  const doForms = PART === 'a' && MAX_CLICKS > 0 && SHARD === 1 && (!ONLY || has('forms'));
  if (doForms) await forms();
  for (const u of pages) {
    if (Date.now() > deadline) { states.push({ nn: nn(), run: RUN, part: PART, page: fileOf(u), code: codeOf(fileOf(u)).code, url: u, kind: 'skipped', result: 'not reached in this command\'s time budget — run with --pages ' + slug(fileOf(u)), shots: [], console: [], failed: [] }); continue; }
    const file = fileOf(u); take();
    declineNow = false;
    const status = await go(u);
    const st = await screenState(u, null, { status });
    if (status >= 400) continue;
    /* a window that covers the whole screen on arrival (the counter's PIN offer) is shot once, above; then declined so the screen under it is toured */
    if (PART === 'b' && await page.locator('[data-testid="signin-later"]:visible').count()) {
      st.blocker = 'a window covers the screen on arrival: ' + ((await page.locator('[data-testid="signin-later"]').first().evaluate((b) => { const d = b.closest('[role=dialog],dialog,.modal,.cbsi,div'); const h = d && d.querySelector('h2,h3'); return h ? h.textContent.trim() : 'a window'; }).catch(() => 'a window')));
      await page.locator('[data-testid="signin-later"]').first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500);
      await screenState(u, 'after-not-now', { from: st.nn });
    }
    declineNow = PART === 'b';
    if (PART === 'a') { if (MAX_CLICKS > 0) await clickAll(u, file); continue; }
    if (OPS > 0) await randomOps(u, file, 'main');
    for (const s of (await sectionsOf(file))) {
      if (Date.now() > deadline) break;
      take();
      if (s.how === 'url') await go(u.split('#')[0] + s.hash);
      else {
        await go(u);
        /* the same control, found again after the reload by its place among the page's tabs (a test id when it has one) */
        await page.evaluate(([TABS, idx]) => { document.querySelectorAll('[data-tour-sec]').forEach((e) => e.removeAttribute('data-tour-sec')); const el = document.querySelectorAll(TABS)[idx]; if (el) el.setAttribute('data-tour-sec', '1'); }, [TABS, s.idx]).catch(() => {});
        const b = s.testid ? page.locator('[data-testid="' + s.testid + '"]:visible').first() : page.locator('[data-tour-sec]').first();
        await b.click({ timeout: 3000 }).catch((e) => { bucket.reach.push('tab "' + s.label + '" could not be pressed: ' + String(e.message).split('\n')[0].slice(0, 100)); });
        await settle(page, 700);
      }
      await screenState(page.url().replace(BASE, ''), slug(s.label || s.hash), { section: s.label || s.hash, from: st.nn });
      if (OPS > 0) await randomOps(page.url().replace(BASE, ''), file, s.label || s.hash);
    }
  }
  const out = saveRun();
  console.log('\nVISUAL TOUR ' + RUN + ': ' + states.length + ' states → ' + path.relative(ROOT, out) + (w.refused.length ? ' · ⚠️ ' + w.refused.length + ' request(s) to PRODUCTION refused' : ''));
  await w.close();
  process.exit(w.refused.length ? 1 : 0);
}

/* ── the report: every run → tour.json + TOUR-FINDINGS.md (ranked) + the inventory table ─────────────────────────── */
function report() {
  const runs = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((f) => /^run-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))) : [];
  if (!runs.length) { console.log('no run-*.json in ' + OUT); process.exit(1); }
  /* a page re-toured later (same part · theme · width, e.g. `--pages till` after a fix to the harness) supersedes the earlier run's states of it */
  const latest = new Map();
  runs.forEach((r) => r.states.forEach((s) => { const k = r.part + '|' + r.theme + '|' + r.width + '|' + s.page; if (!latest.has(k) || latest.get(k) < r.at) latest.set(k, r.at); }));
  const states = [].concat(...runs.map((r) => r.states.filter((s) => latest.get(r.part + '|' + r.theme + '|' + r.width + '|' + s.page) === r.at)));
  fs.writeFileSync(path.join(OUT, 'tour.json'), JSON.stringify({ at: new Date().toISOString(), runs: runs.map((r) => ({ run: r.run, base: r.base, at: r.at, states: r.states.length, refused: r.refused })), states }, null, 1));
  /* what the LOCAL stack causes and production does not — listed with its reason, never ranked */
  const KNOWN = [{ re: /^404 GET \/api\/state\b/, why: 'the counter asks the shop-PC program\'s /api/state when it is served over http (public/till.html:6490 skips it on https) — a local-stack effect' }];
  const known = new Map(), reach = [];
  const F = new Map();   /* key → { rank, what, code, page, shots[], repro, n, runs:Set } */
  const add = (rank, key, what, s, repro) => {
    const k = rank + '|' + key; const f = F.get(k) || { rank, what, code: s.code, page: s.page, shots: [], repro, n: 0, runs: new Set() };
    f.n++; f.runs.add(s.theme + ' ' + s.width); if (s.shots && s.shots[0] && f.shots.length < 3) f.shots.push(s.shots[0]); F.set(k, f);
  };
  const how = (s) => 'open ' + (s.url || '/' + s.page) + ' ' + (s.part === 'b' ? 'signed in' : 'signed out') + ' · ' + s.theme + ' · ' + s.width + ' px' + (s.section ? ' · section "' + s.section + '"' : '') + (s.element ? ' · ' + (s.kind === 'op' ? s.op + ' ' : 'click ') + '"' + String(s.element.label).slice(0, 40) + '"' : '');
  const index = states.find((s) => s.kind === 'screen' && s.page === 'index.html' && s.step === 'top' && s.part === 'a' && s.frame && s.frame.title) || states.find((s) => s.kind === 'screen' && s.page === 'index.html' && s.frame && s.frame.title);
  const idx = index ? index.frame : null;
  for (const s of states) {
    /* a run written before reach had its own bucket kept the tour's tab timeouts as page errors — they are reach, not the product */
    s.reach = (s.reach || []).concat((s.console || []).filter((x) => /^pageerror: (tab "|navigation:)/.test(x)).map((x) => x.replace(/^pageerror: /, '')));
    s.console = (s.console || []).filter((x) => !/^pageerror: (tab "|navigation:)/.test(x));
    /* "Failed to load resource" carries no address — the same request is in s.failed WITH its address, so it is counted there */
    for (const c of (s.console || []).filter((x) => !/^Failed to load resource/.test(x))) add('broken', s.page + '|console|' + c.slice(0, 70), 'console error on ' + s.page + ': `' + c.slice(0, 140).replace(/`/g, "'") + '`', s, how(s));
    (s.reach || []).forEach((x) => reach.push({ page: s.page, code: s.code, what: x, shot: (s.shots || [])[0] || '—', run: s.run }));
    for (const q of (s.failed || []).filter((x) => { const k = KNOWN.find((K) => K.re.test(x)); if (k) { known.set(k.why, (known.get(k.why) || 0) + 1); } return !k; })) add(/^(5\d\d|404|FAILED)/.test(q) ? 'broken' : 'inconsistent', s.page + '|req|' + q.replace(/\?.*/, '').slice(0, 80), 'request failed on ' + s.page + ': `' + q.slice(0, 120) + '`', s, how(s));
    if (s.status >= 400) add('broken', s.page + '|status', s.page + ' answers HTTP ' + s.status, s, how(s));
    if (s.result === 'error') add('broken', s.page + '|err|' + (s.element ? s.element.label : s.step), 'a control errored on ' + s.page + ': "' + (s.element ? s.element.label : s.step) + '" — ' + String(s.error || '').slice(0, 120), s, how(s));
    if (s.result === 'cannot be clicked') add('inconsistent', s.page + '|noclick|' + s.element.label, 'a box on ' + s.page + ' cannot be clicked: "' + String(s.element.label).slice(0, 50) + '" — something covers it, or it is never on screen', s, how(s));
    if (s.dead) add('inconsistent', s.page + '|dead|' + s.element.label, 'dead click on ' + s.page + ': "' + String(s.element.label).slice(0, 50) + '" — nothing happened', s, how(s));
    if (s.kind === 'form' && s.completed === false) add('broken', s.page + '|form|' + s.step, s.step + ': ' + s.validation, s, how(s));
    if (s.kind === 'form' && s.validation === '(nothing said)') add('inconsistent', s.page + '|formsay|' + s.step, s.step + ': the empty submit says nothing (no line on what to fix)', s, how(s));
    if (s.kind === 'form' && /NOT greyed/.test(s.validation || '')) add('inconsistent', s.page + '|agree', s.validation, s, how(s));
    if (s.blocker) add('inconsistent', s.page + '|blocker', s.page + ' — ' + s.blocker + ' (every visit, before anything else can be done)', s, how(s));
    if (s.kind === 'skipped') add('inconsistent', s.page + '|skipped', s.page + ' was not reached: ' + s.result, s, how(s));
    if (s.kind !== 'screen' && s.kind !== 'form') continue;
    for (const x of s.sideways || []) add('inconsistent', s.page + '|side|' + x.split(' ')[0], 'sideways scroll on ' + s.page + ': ' + x, s, how(s));
    /* covered controls: one finding per page and per bar that covers them (the controls named in it) */
    const bars = {}; (s.underBar || []).forEach((x) => { const b = x.split(' under ').pop(); (bars[b] = bars[b] || []).push(x.split(' under ')[0]); });
    Object.keys(bars).forEach((b) => add('inconsistent', s.page + '|bar|' + b, 'controls covered by `' + b + '` on ' + s.page + ' (they cannot be brought out from under it): ' + bars[b].slice(0, 5).join(', ') + (bars[b].length > 5 ? ' +' + (bars[b].length - 5) : ''), s, how(s)));
    for (const x of s.appLinks || []) add('inconsistent', s.page + '|app|' + x.slice(0, 40), s.page + ' links to the workshop (app.html): `' + x.slice(0, 80).replace(/`/g, "'") + '`', s, how(s));
    /* contrast: one finding per page and per kind of element (the lowest first, three examples) */
    const byTag = {}; (s.contrast || []).forEach((x) => { const t = x.split(' ').pop(); (byTag[t] = byTag[t] || []).push(x); });
    Object.keys(byTag).forEach((t) => { const xs = byTag[t].sort((a, b) => parseFloat(a) - parseFloat(b)); add(parseFloat(xs[0]) < 3 ? 'inconsistent' : 'cosmetic', s.page + '|contrast|' + t + '|' + s.theme, 'contrast below AA on ' + s.page + ' (' + s.theme + '), `' + t + '`: ' + xs.slice(0, 3).map((x) => x.replace(/ \S+$/, '')).join(' · ') + (xs.length > 3 ? ' +' + (xs.length - 3) : ''), s, how(s)); });
    for (const x of s.clipped || []) add('cosmetic', s.page + '|clip|' + x.slice(0, 30), 'clipped text on ' + s.page + ': "' + x + '"', s, how(s));
    for (const x of s.budget || []) add('cosmetic', s.page + '|budget|' + x.slice(0, 40), 'copy over the text budget on ' + s.page + ': ' + x, s, how(s));
    const fr = s.frame || {};
    if (s.theme === 'dark' && fr.title && fr.themed !== 'dark') add('inconsistent', s.page + '|theme', s.page + ' ignores the chosen theme (Dark saved; the page paints ' + (fr.themed || 'its own colours') + (fr.cbAvatar ? '' : ', no CBAvatar') + ')', s, how(s));
    if (idx && fr.title && s.step === 'top') {
      if (!fr.shell && idx.shell) add('inconsistent', s.page + '|frame|shell', s.page + ' does not draw the shared shell header (.cbsh-hdr) the index draws' + (fr.header ? ' — it has ' + fr.header : ''), s, how(s));
      if (!fr.avatar) add('inconsistent', s.page + '|frame|avatar', s.page + ' has no avatar / Sign in door', s, how(s));
      if (!fr.home && s.page !== 'index.html') add('inconsistent', s.page + '|frame|home', s.page + (fr.switcher ? ' has no Home button — Home is only inside the app switcher menu (the index has ⌂ Home in its rail)' : ' has no Home button / link back to the index'), s, how(s));
      if (fr.bodyFont && idx.bodyFont && fr.bodyFont !== idx.bodyFont) add('inconsistent', s.page + '|frame|font', s.page + ' body font "' + fr.bodyFont + '" ≠ the index\'s "' + idx.bodyFont + '"', s, how(s));
      if (fr.h1Font && idx.h1Font && fr.h1Font !== idx.h1Font) add('cosmetic', s.page + '|frame|h1font', s.page + ' heading font "' + fr.h1Font + '" ≠ the index\'s "' + idx.h1Font + '"', s, how(s));
      if (fr.bodySize && idx.bodySize && fr.bodySize !== idx.bodySize) add('cosmetic', s.page + '|frame|size', s.page + ' body text ' + fr.bodySize + ' ≠ the index\'s ' + idx.bodySize, s, how(s));
      /* no tab-title check: the trademark appears in ONE place only (Athi, 17 Oct) */
    }
  }
  /* empty-state wording across pages */
  const empties = new Map(); states.forEach((s) => (s.emptyWords || []).forEach((t) => { const k = t.replace(/[.!]$/, ''); if (!empties.has(k)) empties.set(k, new Set()); empties.get(k).add(s.page); }));
  const unnumbered = new Set(states.filter((s) => s.code === 'UNNUMBERED').map((s) => s.page));
  const order = { broken: 0, inconsistent: 1, cosmetic: 2 };
  const list = Array.from(F.values()).sort((a, b) => order[a.rank] - order[b.rank] || b.n - a.n);
  /* the inventory: every toured screen (code · page) + the registry's screens the tour does not reach (app.html, the workshop) */
  const inv = new Map();
  states.forEach((s) => { const k = s.code === 'UNNUMBERED' ? 'UNNUMBERED · ' + s.page : s.code; const v = inv.get(k) || { code: s.code, name: s.code === 'UNNUMBERED' ? (s.frame && (s.frame.h1 || s.frame.title)) || s.page : s.name, page: s.page, visited: false, issues: 0 }; if (s.kind === 'screen' || s.kind === 'form') v.visited = true; inv.set(k, v); });
  list.forEach((f) => { const k = f.code === 'UNNUMBERED' ? 'UNNUMBERED · ' + f.page : f.code; if (inv.has(k)) inv.get(k).issues++; });
  REG_ROWS.filter((r) => !/Control|Popup/.test(r.group)).forEach((r) => { if (!inv.has(r.code)) inv.set(r.code, { code: r.code, name: r.path, page: r.nav ? 'app.html#' + r.nav : '—', visited: false, issues: 0, why: 'the workshop (app.html) — not on the tour' }); });
  const counts = { broken: 0, inconsistent: 0, cosmetic: 0 }; list.forEach((f) => counts[f.rank]++);
  const screens = states.filter((s) => s.kind === 'screen' || s.kind === 'form'), clicks = states.filter((s) => s.kind === 'click'), ops = states.filter((s) => s.kind === 'op');
  const md = [];
  md.push('# TOUR-FINDINGS — the visual tour (round VTOUR, ' + new Date().toISOString().slice(0, 10) + ')', '');
  md.push('Harness: `e2e/visual-tour.cjs` on the LOCAL stack (`e2e/lib/stack-local.cjs` + api `tools/sim-load.cjs` shop `simstores` + `scripts/seed-local.cjs`). Runs: ' + runs.map((r) => '`' + r.run + '`').join(' · ') + '.');
  md.push('States: ' + screens.length + ' screen states · ' + clicks.length + ' boxes (' + clicks.filter((c) => c.result !== 'skipped').length + ' clicked) · ' + ops.length + ' random operations. Findings: **' + counts.broken + ' broken · ' + counts.inconsistent + ' inconsistent · ' + counts.cosmetic + ' cosmetic** (grouped; n = states it was seen in). Screenshots: the `visual-tour` artifact (`e2e/out/tour/`), never committed.', '');
  runs.filter((r) => r.stopped || (r.refused && r.refused.length)).forEach((r) => md.push('⚠️ run `' + r.run + '`' + (r.stopped ? ' was cut short (' + r.stopped + ') — its states up to then are kept' : '') + (r.refused && r.refused.length ? ' · ' + r.refused.length + ' request(s) to the PRODUCTION host refused' : '') + '.', ''));
  md.push('**Screen codes:** ' + unnumbered.size + ' toured page(s) carry no code in the register (public/app/screens.js numbers app.html, the Counter and the Storefront only): ' + Array.from(unnumbered).sort().join(', ') + '. → the SCREEN-ID round.', '');
  for (const rank of ['broken', 'inconsistent', 'cosmetic']) {
    const rows = list.filter((f) => f.rank === rank); md.push('## ' + rank[0].toUpperCase() + rank.slice(1) + ' (' + rows.length + ')', '');
    if (!rows.length) { md.push('None.', ''); continue; }
    md.push('| # | code | finding | seen | screenshot | reproduce |', '|---|---|---|---|---|---|');
    rows.slice(0, rank === 'cosmetic' ? 80 : 150).forEach((f, i) => md.push('| ' + (i + 1) + ' | ' + f.code + ' | ' + f.what.replace(/\|/g, '\\|').replace(/\n/g, ' ') + ' | ' + f.n + '× (' + Array.from(f.runs).join(', ') + ') | ' + (f.shots[0] || '—') + ' | ' + f.repro.replace(/\|/g, '\\|') + ' |'));
    if (rows.length > (rank === 'cosmetic' ? 80 : 150)) md.push('', '… ' + (rows.length - (rank === 'cosmetic' ? 80 : 150)) + ' more in tour.json.');
    md.push('');
  }
  md.push('## Known local-stack effects (not ranked)', '');
  if (!known.size) md.push('None.'); else known.forEach((n, why) => md.push('- ' + why + ' — ' + n + '×'));
  md.push('', '## Where the tour could not reach (not ranked — a tab it could not press, a page that would not load)', '');
  if (!reach.length) md.push('None.'); else reach.slice(0, 40).forEach((r) => md.push('- ' + r.code + ' · ' + r.page + ' (' + r.run + '): ' + r.what.replace(/\|/g, '/')));
  md.push('');
  md.push('## Empty-state wording across pages', '');
  if (!empties.size) md.push('No empty state was on screen.'); else Array.from(empties.entries()).slice(0, 30).forEach(([t, p]) => md.push('- "' + t + '" — ' + Array.from(p).join(', ')));
  md.push('', '## Inventory (mark the screen inventory)', '', '| code | name | page | visited | issues |', '|---|---|---|---|---|');
  Array.from(inv.values()).sort((a, b) => (b.visited - a.visited) || String(a.code + a.page).localeCompare(b.code + b.page)).forEach((v) => md.push('| ' + v.code + ' | ' + String(v.name || '').replace(/\|/g, '/').slice(0, 50) + ' | ' + v.page + ' | ' + (v.visited ? '✓' : '✗' + (v.why ? ' ' + v.why : '')) + ' | ' + v.issues + ' |'));
  md.push('', '## Boxes per page (Part A) — label → result', '');
  const byPage = new Map(); clicks.forEach((c) => { if (!byPage.has(c.page)) byPage.set(c.page, []); byPage.get(c.page).push(c); });
  byPage.forEach((cs, p) => {
    const tally = {}; cs.forEach((c) => { tally[c.result] = (tally[c.result] || 0) + 1; });
    md.push('- **' + p + '** — ' + Object.entries(tally).map(([k, v]) => v + ' ' + k).join(' · ') + (cs.some((c) => c.dead) ? ' · dead: ' + cs.filter((c) => c.dead).map((c) => '"' + String(c.element.label).slice(0, 24) + '"').slice(0, 6).join(', ') : ''));
  });
  const text = md.join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, 'TOUR-FINDINGS.md'), text);
  if (has('docs')) fs.writeFileSync(path.join(ROOT, 'docs', 'testing', 'TOUR-FINDINGS.md'), text);
  console.log('tour.json · TOUR-FINDINGS.md: ' + states.length + ' states · ' + counts.broken + ' broken · ' + counts.inconsistent + ' inconsistent · ' + counts.cosmetic + ' cosmetic' + (has('docs') ? ' (copied to docs/testing/)' : ''));
  /* --fail-on broken: the run fails (exit 1) when any Broken finding stands — a 4xx/5xx request, a page error, a console error; the rest stay report-only */
  if (arg('fail-on', '') === 'broken' && counts.broken > 0) {
    console.log('FAIL: ' + counts.broken + ' broken finding(s) — see TOUR-FINDINGS.md');
    process.exitCode = 1;
  }
}

let saveRun = null;
process.on('SIGTERM', () => { console.log('visual tour: SIGTERM — saving what was seen'); try { if (saveRun) saveRun('SIGTERM'); } catch (e) { console.log('could not save: ' + e.message); } process.exit(1); });
main().catch((e) => { console.log('visual tour stopped: ' + (e && e.stack || e)); try { if (saveRun) saveRun('stopped: ' + String(e && e.message || e).split('\n')[0]); } catch (e2) { console.log('could not save: ' + e2.message); } process.exit(1); });

/* frame-every-width.cjs — ONE FRAME, EVERY WIDTH (Round U, Athi 2026-10-09: "check the alignments … misalignment in CRM on the top").
 * Rows UI1–UI8 / K2. Pattern: kural-footer.cjs — Playwright, the shared stand-in API (e2e/lib/standin.cjs) answering INSIDE the page, a static server;
 * nothing reaches the live site. The server hands out public/app/kurals.json, so the band DRAWS here — this spec asserts that, because a walk where
 * the band never draws cannot see where it sits (the old walks missed the band-in-the-header for exactly that reason).
 * For each app page x 390 · 957 · 1366 · 1568 · 1920 px:
 *   a  nothing scrolls sideways
 *   b  no two visible controls (button · link · field · select · label) overlap: the header's name · bell · Home · avatar against the page's toolbar
 *   c  the kural band is never inside a header / bar / title row, and when drawn it is whole and inside the window
 *   d  the shop's name stays on one line
 *   e  the "Online" pill and the avatar never overlap
 *   f  the header line is one height across the sidebar and the main column (where the page has both)
 *   g  NO LAYOUT JUMP (UI9, 2026-10-09) on CRM and CB Accounts: with a slow line, the menu, the title and the toolbar are in the FIRST paint and do not move when the data arrives
 *   h  the kural is in the footer (never a card in the page), and the Group control is ONE labelled dropdown
 * Screenshots: e2e/shots/frame-<page>-<width>.png (FRAME_SHOTS=<dir> to put them elsewhere). ONLY=crm,accounts narrows the pages. */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = process.env.FRAME_PUB || path.join(ROOT, 'public'), SHOTS = process.env.FRAME_SHOTS || path.join(__dirname, 'shots');
const { standIn, route } = require('./lib/standin.cjs');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const PAGES = [['crm', '/crm.html'], ['accounts', '/accounts.html'], ['standards', '/standards.html'], ['product-lab', '/product-lab.html'], ['offer-lab-next', '/offer-lab-next.html'],
  ['combo-lab', '/offer-lab-next.html?mode=combo'], ['know-your-business', '/know-your-business.html'], ['authority-forms', '/authority-forms.html'], ['index', '/']];
const WIDTHS = [[390, 844], [957, 800], [1366, 768], [1568, 900], [1920, 1020]];
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const OWNER = { token: b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };

/* runs in the page: the boxes of the frame — what must already be there in the first paint and must not move */
function frameBoxes() {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  return { navN: document.querySelectorAll('#nav .nav-btn').length, nav0: r('#nav .nav-btn'), brand: r('#side .brand'), title: r('.cbl-title h1') || r('#title'), tools: r('.cbl-tools'), skel: document.querySelectorAll('.cbl-skel,.bk-skel i').length };
}
/* runs in the page: every measurement the checks need */
function measure() {
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 && !e.closest('[hidden],dialog:not([open]),.cbsh-scrim'); };
  const label = (e) => String(e.getAttribute('data-testid') || e.id || (e.className && String(e.className).split(' ')[0]) || e.tagName).slice(0, 40) + (e.innerText ? ' "' + e.innerText.trim().replace(/\s+/g, ' ').slice(0, 24) + '"' : '');
  /* an overlay surface (a drawer, a menu, a dialog) legitimately sits over the page: only controls on the page plane are compared */
  const ctl = Array.from(document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,label,[role=button],[role=tab]')).filter(vis)
    .filter((e) => !e.closest('dialog,[role=dialog],.modalback,.cbsh-pop,.cbsh-swpop,[role=menu],[role=listbox],.cbl-pop,.pop,.menu,.drawer,[aria-hidden=true],.sr-only,.cbsh-sheet,.cbsh-scrim'))
    .filter((e) => { const r = e.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight; }).slice(0, 500);
  /* a control scrolled out of its own scroller is not on screen: clip every rect by each ancestor that clips (overflow hidden / auto / scroll) */
  const clip = (e) => { const r = e.getBoundingClientRect(); let l = r.left, t = r.top, rr = r.right, b = r.bottom; for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) { const s = getComputedStyle(a); if (/(hidden|auto|scroll|clip)/.test(s.overflowX + s.overflowY)) { const c = a.getBoundingClientRect(); l = Math.max(l, c.left); t = Math.max(t, c.top); rr = Math.min(rr, c.right); b = Math.min(b, c.bottom); } } return { e, l, t, r: rr, b }; };
  const rects = ctl.concat(Array.from(document.querySelectorAll('.netpill')).filter(vis)).map(clip).filter((x) => x.r - x.l > 2 && x.b - x.t > 2);
  const hits = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], c = rects[j];
    if (a.e.contains(c.e) || c.e.contains(a.e)) continue;
    const w = Math.min(a.r, c.r) - Math.max(a.l, c.l), h = Math.min(a.b, c.b) - Math.max(a.t, c.t);
    if (w > 3 && h > 3) hits.push(label(a.e) + '  x  ' + label(c.e) + ' (' + Math.round(w) + 'x' + Math.round(h) + ')');
  }
  const band = document.querySelector('[data-testid="kural-footer"]'), br = band && !band.hidden ? band.getBoundingClientRect() : null;
  const name = Array.from(document.querySelectorAll('[data-testid="shop-name"],.cbsh-name,.shopname,#shopname,.who .name,.who b')).filter(vis)[0];
  const nr = name ? name.getBoundingClientRect() : null;
  const online = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length < 3 && /^●?\s*Online$/i.test((e.textContent || '').trim()) && vis(e))[0];
  const av = Array.from(document.querySelectorAll('[data-testid="avatar-btn"],.cb-avatar,#cbav,[data-cbavatar],.cbsh-who,.cbav-btn')).filter(vis)[0];
  const ov = online && av ? (() => { const a = online.getBoundingClientRect(), c = av.getBoundingClientRect(); return Math.min(a.right, c.right) - Math.max(a.left, c.left) > 2 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 2; })() : false;
  const sh = Array.from(document.querySelectorAll('aside .brand,.side .brand')).filter(vis)[0];
  const mh = Array.from(document.querySelectorAll('.main > #shell [data-testid="shell-header"],.main.overbar .cbl-title,.main:not(.overbar) .bar,main > header')).filter(vis)[0];   /* SHELL-ONE: the frame's bar is the main column's header line */
  return {
    sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight, hits: hits.slice(0, 6), nHits: hits.length,
    band: band ? { drawn: !!br, inShellFoot: !!band.closest('[data-testid="shell-foot"],[data-testid="shell-pfoot"]'), inHead: !!band.closest('header,.bar,.top,.topbar,.titlerow,.cbl-title,.cbsh-hd,.cbsh-head,[role=banner]'), top: br && Math.round(br.top), bottom: br && Math.round(br.bottom), w: br && Math.round(br.width), l: br && Math.round(br.left), parent: band.parentElement && (band.parentElement.tagName + '.' + band.parentElement.className) } : null,
    nameLines: nr ? Math.round(nr.height / (parseFloat(getComputedStyle(name).lineHeight) || parseFloat(getComputedStyle(name).fontSize) * 1.3)) : 0,
    onlineOverAvatar: ov,
    tool: (() => { const t = Array.from(document.querySelectorAll('.cbl-tools')).filter(vis)[0]; if (!t) return null; const kids = Array.from(t.children).filter((c) => vis(c) && !c.classList.contains('cbl-fchips')); const mids = kids.map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; }); const sr = t.querySelector('input[type=search]'); const lab = t.querySelector('.cbl-glab'); return { rows: mids.filter((y) => Math.abs(y - mids[0]) > 14).length ? 2 : 1, searchW: sr ? Math.round(sr.getBoundingClientRect().width) : 0, scrollW: sr ? sr.scrollWidth : 0, ph: sr ? sr.placeholder : '', lab: lab ? vis(lab) : null, hasGroup: !!t.querySelector('.cbl-seg[data-testid^="cbl-group"], .cbl-gsel') }; })(),
    sideH: sh ? Math.round(sh.getBoundingClientRect().bottom) : null, mainH: mh && sh && mh.getBoundingClientRect().left > sh.getBoundingClientRect().right - 2 ? Math.round(mh.getBoundingClientRect().bottom) : null,
  };
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = rel === 'index.html' ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port, b = await chromium.launch(), offHost = [];
  const kural = JSON.parse(fs.readFileSync(path.join(PUB, 'app', 'kurals.json'), 'utf8'));
  ok(kural.kurals.length >= 10, 'the kural text is served to the page (' + kural.kurals.length + ' couplets), so the band can draw');
  for (const [name, url] of PAGES) {
    if (only.length && only.indexOf(name) < 0) continue;
    console.log('— ' + name);
    for (const [w, h] of WIDTHS) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
      await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!fonts\.g)/, (r) => { offHost.push(r.request().url()); return r.abort(); });
      const S = standIn(), slow = name === 'crm' || name === 'accounts';
      await ctx.route('**/api/**', (r) => route(S, r));
      if (slow) await ctx.route('**/api/**', async (r) => { await new Promise((x) => setTimeout(x, 900)); r.fallback(); });   /* a slow line, to look at the first paint */
      await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, OWNER);
      const p = await ctx.newPage(), threw = [];
      p.on('pageerror', (e) => threw.push(e.message));
      await p.goto(base + url).catch(() => {});
      let f0 = null; if (slow) { await p.waitForTimeout(400); f0 = await p.evaluate(frameBoxes); }
      await p.waitForSelector('[data-testid="kural-footer"]:not([hidden])', { timeout: 6000 }).catch(() => {});
      await p.waitForTimeout(700);
      const m = await p.evaluate(measure);
      const tag = name + ' @' + w;
      if (slow) {
        const f1 = await p.evaluate(frameBoxes), same = (a, b2) => !!a && !!b2 && a.every((v, i) => Math.abs(v - b2[i]) <= 1);
        ok(f0.navN > 0 && !!f0.title && !!f0.brand && (name !== 'crm' || (!!f0.tools && f0.skel > 0)), tag + ': FIRST PAINT has the whole frame — ' + f0.navN + ' menu items, the title' + (name === 'crm' ? ', the toolbar, ' + f0.skel + ' skeleton rows' : '') + ' (data still on its way)');
        ok(same(f0.nav0, f1.nav0) && same(f0.brand, f1.brand) && same(f0.title, f1.title) && (name !== 'crm' || same(f0.tools, f1.tools)), tag + ': when the data arrives the menu, title and toolbar do not move (' + JSON.stringify([f0.nav0, f0.title, f0.tools]) + ' → ' + JSON.stringify([f1.nav0, f1.title, f1.tools]) + ')');
      }
      if (name === 'index' && w <= 700) ok(await p.evaluate(() => { const k = document.querySelector('#cbkural'); return !k || k.hidden || !!k.closest('[data-testid="shell-pfoot"]'); }), tag + ': on a phone the kural is in the footer above the tab bar, never a card in Home');
      ok(m.sw <= m.iw + 1, tag + ': nothing scrolls sideways (' + m.sw + ' / ' + m.iw + ')');
      ok(m.nHits === 0, tag + ': no two controls overlap' + (m.nHits ? ' — ' + m.hits.join(' | ') : ''));
      if (m.band) {
        ok(!m.band.inHead, tag + ': the kural band is not inside a header (parent ' + m.band.parent + ')');
        ok(!m.band.drawn || m.band.inShellFoot || (m.band.top >= 0 && m.band.bottom <= m.ih + 1 && m.band.l <= 1 && m.band.w >= w - 2), tag + ': the band is whole, full width, inside the window (x ' + m.band.l + ', y ' + m.band.top + '–' + m.band.bottom + ', ' + m.band.w + ' wide)');
      }
      ok(m.nameLines <= 1, tag + ': the shop name is on one line');
      if (m.tool && m.tool.hasGroup) ok(m.tool.lab, tag + ': the Group control carries its label');
      /* On a phone (<= 700 px, list-ctl.js PHONE_MAX) the Group choice lives in the View popover, not the toolbar (UX-137 wave 2, 889416f6,
         2026-11-11; list-ctl.js:1095). So at 390 the same rule is asked of the popover: still ONE labelled dropdown, still no row of toggles,
         (the popover button sits in the toolbar; the select is only in the popover). */
      if (name === 'crm' && w <= 700) {
        await p.click('[data-testid^="cbl-view-menu-"]').catch(() => {});
        await p.waitForSelector('[data-testid^="cbl-view-pop-"]', { timeout: 4000 }).catch(() => {});
        ok(await p.evaluate(() => !!document.querySelector('[data-testid^="cbl-view-pop-"] .cbl-gsel select') && !document.querySelector('.cbl-seg[data-testid^="cbl-group"]')), tag + ': Group is ONE labelled dropdown in the View popover, not a row of buttons');
      } else if (name === 'crm') ok(await p.evaluate(() => !!document.querySelector('.cbl-tools .cbl-gsel select') && !document.querySelector('.cbl-tools .cbl-seg[data-testid^="cbl-group"]')), tag + ': Group is ONE labelled dropdown, not a row of buttons');
      if (m.tool && w >= 957 && name === 'crm') ok(m.tool.rows === 1, tag + ': the tool row is one line (' + m.tool.rows + ' rows)');
      if (name === 'standards') {   /* Standards tidy (2026-10-09): ONE LINE per row on the laptop, the count table whole, ONE grouping control, no workshop link */
        const sg = await p.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('#std_list .cbl-row')), hs = rows.map((r) => r.getBoundingClientRect().height);
          const cut = Array.from(document.querySelectorAll('#mxBody .mx-rh,#mxBody .mx-ch')).filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim());
          return { rows: rows.length, tall: hs.length ? Math.max.apply(null, hs) : 0, cut, dim: document.querySelectorAll('[data-dim]').length, kind: !!document.querySelector('#std_list .cbl-hdr') ? Array.from(document.querySelectorAll('#std_list .cbl-hc')).some((h) => /^KIND/i.test(h.innerText.trim())) : null, app: Array.from(document.querySelectorAll('#std_list a[href],[data-testid="std-go"]')).filter((e) => /app[.]html/.test(e.getAttribute('href') || '')).length };
        });
        if (w >= 1366) { ok(sg.rows > 0 && sg.tall <= 44, tag + ': standards rows are one line (' + sg.rows + ' rows, tallest ' + Math.round(sg.tall) + ' px)'); ok(sg.kind === true, tag + ': standards has a Kind column'); }
        ok(sg.dim === 0, tag + ': standards has no second Count by control — the table follows Group by');
        ok(sg.app === 0, tag + ': standards links nothing into the workshop (app.html)');
        if (w >= 1366 || w === 390) ok(sg.cut.length === 0, tag + ': the standards count table is whole — no label or head cut (' + JSON.stringify(sg.cut) + ')');
      }
      if (m.tool && m.tool.searchW) ok(m.tool.searchW >= (m.tool.ph.length * 7.4) - 30, tag + ': the search box is wide enough for its hint "' + m.tool.ph + '" (' + m.tool.searchW + ' px)');
      ok(!m.onlineOverAvatar, tag + ': the Online pill does not sit on the avatar');
      if (m.sideH && m.mainH) ok(Math.abs(m.sideH - m.mainH) <= 2, tag + ': the sidebar header line and the main header line meet (' + m.sideH + ' / ' + m.mainH + ')');
      if (!/-lab$/.test(name)) ok(!threw.length, tag + ': no script error' + (threw.length ? ' — ' + threw[0] : ''));
      await p.screenshot({ path: path.join(SHOTS, 'frame-' + name + '-' + w + '.png') }).catch(() => {});
      await ctx.close();
    }
  }
  ok(offHost.length === 0, 'nothing reached a host outside the stand-in' + (offHost.length ? ' — ' + offHost[0] : ''));
  await b.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

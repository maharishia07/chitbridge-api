/* kural-footer.cjs — THE KURAL FOOTER (CBKural, public/app/kural.js), PROVED ON EVERY CB PAGE.
 * docs/design/ledgers-page/CLOUD-TASK.md · README "The kural footer". Pattern: cb-accounts.cjs — Playwright, a stand-in API answering INSIDE the
 * page (ctx.route), a static server on a port the OS picks; nothing here reaches localhost:3000, port 7351 or the live site (any other host
 * is refused and counted). KURAL_PUB=<dir> runs against another copy of public/ (kural-footer-breaks.cjs).
 *
 *  1  the data: public/app/kurals.json is docs/design/kural-kit/kurals.json, byte for byte as data; 552 is excluded and never a route's kural
 *  2  on accounts · crm · index: ONE band, a direct child of <body> AFTER the page shell (outside the head), the couplet + the ENGLISH meaning from
 *     kurals.json for that page's route; no Tamil prose (the only Tamil on the band is the couplet and the word குறள்); the shell gives it room
 *  3  one kural per PAGE, not per site: CB Accounts' views, CRM's pages and the index each name their own route (kurals.json)
 *  4  by space: wide → side by side · 1000 px → the meaning below · 390 → they take turns (tap switches; the timer switches every 7 s; with Less
 *     motion only a tap does)
 *  5  closable: ✕ → one small `குறள் N ›` line, kept for the day (reload keeps it), back tomorrow, › brings it back
 *  6  never beside a warning (an amber chip, an alert) and never in a dialog — the band is not drawn while one is on screen, and returns after
 *  7  never in a message: the band is not inside any text field, and no file that builds an outgoing message mentions it
 *  8  tokens only: right in Cream · Dark · Terminal (WCAG AA for the verse and the meaning), never amber, never blue, no italic
 *  9  other languages: Tamil and English read the English line; a language with no `meaning.<lang>` falls back to English
 * Screenshots: e2e/shots/kural-{accounts,crm,index}-laptop.png, kural-accounts-phone.png, kural-accounts-phone-meaning.png, kural-accounts-meaning-below-1000.png (KURAL_SHOTS=<dir> to put them elsewhere)
 * Playwright is not in the cloud image: `npm i @playwright/test` in a temp dir and NODE_PATH at it (the PR says so). */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PUB = process.env.KURAL_PUB || path.join(ROOT, 'public');
const INDEX = process.env.KURAL_INDEX || path.join(ROOT, 'index.html');
const SHOTS = process.env.KURAL_SHOTS || path.join(__dirname, 'shots');
const KIT = path.join(ROOT, 'docs', 'design', 'kural-kit', 'kurals.json');
const FIX = path.join(__dirname, 'fixtures', 'golden-parties.json');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const TA = /[஀-௿]/;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const C = require('./lib/contract.cjs'), crmApi = require('./lib/crm-api.cjs'), books = require('./lib/books-api.cjs');   /* every answer served for a route in the API contract is checked (e2e/fixtures/web-api.contract.json) */
const J = C.json;
const TODAY = new Date().toISOString().slice(0, 10);
const lk = require('./lib/contrast.cjs');
const toHex = (c) => { const m = /rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/.exec(c || ''); return m ? '#' + [m[1], m[2], m[3]].map((n) => ('0' + (+n).toString(16)).slice(-2)).join('') : null; };

const KURALS = JSON.parse(fs.readFileSync(path.join(PUB, 'app', 'kurals.json'), 'utf8'));
const byRoute = (r) => KURALS.kurals.find((k) => k.route === r);

const claims = (c) => { const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return b64({ alg: 'none' }) + '.' + b64(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, c)) + '.x'; };
const OWNER = { token: claims({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan' };
const { standIn, route } = require('./lib/standin.cjs');

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? INDEX : path.join(PUB, rel);
    if (((!f.startsWith(PUB)) && f !== INDEX) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const threw = [], offHost = [];

  async function open(S, o) {
    o = o || {};
    const ctx = await b.newContext({ viewport: o.viewport || { width: 1366, height: 768 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block', reducedMotion: o.reduce ? 'reduce' : 'no-preference' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offHost.push(r.request().url()); return r.abort(); });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => route(S, r));
    if (o.session !== null) await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, OWNER);
    /* W7: the band is on by default only where Tamil is read (pref kural=auto); this guard proves the band itself, so it asks for On unless a case seeds its own */
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('cb_kural')) localStorage.setItem('cb_kural', 'on'); } catch (_) {} });
    if (o.seed) await ctx.addInitScript(o.seed);
    const p = await ctx.newPage();
    if (o.clock) await p.clock.install();
    p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + (o.path || '/accounts.html'));
    return { ctx, p };
  }
  const band = (p) => p.locator('[data-testid="kural-footer"]');
  const shown = async (p) => (await band(p).count()) === 1 && await band(p).isVisible();
  const view = async (p) => p.evaluate(() => { const e = document.querySelector('[data-testid="kural-footer"]'); if (!e) return null;
    const v = e.querySelector('[data-testid="kural-verse"]'), m = e.querySelector('[data-testid="kural-meaning"]'), no = e.querySelector('[data-testid="kural-no"]');
    return { n: document.querySelectorAll('[data-testid="kural-footer"]').length, hidden: e.hidden, no: e.getAttribute('data-kural'), parent: e.parentElement && e.parentElement.tagName, inShellFoot: !!e.closest('[data-testid="shell-foot"], [data-testid="shell-pfoot"]'), verse: v ? Array.from(v.querySelectorAll('.cbk-ln')).map((x) => x.textContent.replace(/\s+/g, ' ').trim()) : null,
      meaning: m ? m.textContent.trim() : null, text: e.innerText, cls: e.className, top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom, vh: window.innerHeight, sw: document.documentElement.scrollWidth, ih: window.innerWidth,
      inHead: !!e.closest('header,.top,.bar,.cbl-title,.titlerow'), inField: !!e.closest('textarea,input,[contenteditable],[data-testid*="compose"],[data-testid*="message"]'),
      kv: v ? { dir: getComputedStyle(e.querySelector('.cbk-body')).flexDirection || '', display: getComputedStyle(e.querySelector('.cbk-body')).display, vt: v.getBoundingClientRect().top, mt: m.getBoundingClientRect().top, vb: v.getBoundingClientRect().bottom, mo: getComputedStyle(m).opacity, vo: getComputedStyle(v).opacity } : null }; });
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  /* ── 1 · the data ── */
  {
    const kit = JSON.parse(fs.readFileSync(KIT, 'utf8'));
    ok(JSON.stringify(kit) === JSON.stringify(KURALS), 'public/app/kurals.json is docs/design/kural-kit/kurals.json (one source, one copy)');
    const ex = KURALS.excluded.map((x) => x.no);
    ok(ex.indexOf(552) >= 0 && KURALS.kurals.every((k) => ex.indexOf(k.no) < 0), '552 is on the excluded list and on no route');
    ok(KURALS.kurals.filter((k) => /^crm-/.test(k.route)).length === 7, 'the seven CRM pages each have their kural (group crm)');
    ok(KURALS.kurals.every((k) => k.verse.length === 2 && k.meaning && k.meaning.en && !k.meaning.ta), 'every kural is a two-line couplet with an English meaning, and the Tamil prose slot stays empty');
  }

  /* ── 2 · every page: ONE band outside the head, couplet + English only ── */
  const PAGES = [['accounts', '/accounts.html', 'accounts'], ['crm', '/crm.html', 'crm-parties'], ['index', '/', 'planning']];
  for (const [name, url, route_] of PAGES) {
    const S = standIn();
    const { ctx, p } = await open(S, { path: url, session: name === 'index' ? null : undefined });
    await p.waitForSelector('[data-testid="kural-footer"]:not([hidden])', { timeout: 8000 }).catch(() => {});
    const v = await view(p), k = byRoute(route_);
    ok(v && v.n === 1 && !v.hidden, name + ': exactly one kural band, and it is drawn');
    /* N18: the index is CBShell's Home, and the shell gives the band its place — the foot slot (a laptop) or the foot of Home (a phone) */
    ok(v && (name === 'index' ? v.inShellFoot : v.parent === 'BODY') && v.top >= 0 && v.bottom <= v.vh + 1 + (name === 'index' ? 4000 : 0) && !v.inHead, name + (name === 'index' ? ': the band sits in the shell\'s foot slot' : ': the band is a child of <body>, after the page shell') + ' — never in the head (' + (v && Math.round(v.top)) + ' → ' + (v && Math.round(v.bottom)) + ' of ' + (v && v.vh) + ')');
    ok(v && v.no === String(k.no) && v.verse && v.verse.map(clean).join('|') === k.verse.map(clean).join('|'), name + ': the couplet is kural ' + (k && k.no) + "'s own, both lines (route " + route_ + ')');
    ok(v && v.meaning === k.meaning.en, name + ': the meaning is the English translation, as the kit has it');
    const st = await p.evaluate(() => { const l = Array.from(document.querySelectorAll('[data-testid="kural-verse"] .cbk-ln')).map((x) => x.getBoundingClientRect()), vv = document.querySelector('[data-testid="kural-verse"]').getBoundingClientRect(); return { n: l.length, stacked: l.length === 2 && l[1].top >= l[0].bottom - 2 && Math.abs(l[1].left - l[0].left) < 40, h: vv.height, disp: getComputedStyle(document.querySelector('[data-testid="kural-verse"] .cbk-ln')).display }; });
    ok(st.n === 2 && st.stacked && st.disp === 'block' && st.h < 90, name + ': the couplet is two lines, one above the other (no page rule bends it: ' + Math.round(st.h) + ' px tall)');
    const rest = v ? v.text.split(k.verse[0]).join('').split(k.verse[1]).join('').split('குறள்').join('') : '';
    ok(v && !TA.test(rest.replace(k.verse.join('').replace(/[\s]/g, ''), '')) && !TA.test(rest), name + ': no Tamil prose, no transcription — the only Tamil is the couplet and the word குறள்');
    if (name !== 'index') ok(v.sw <= v.ih, name + ': nothing scrolls sideways with the band (' + v.sw + ' / ' + v.ih + ')');
    await p.screenshot({ path: path.join(SHOTS, 'kural-' + name + '-laptop.png') }).catch(() => {});
    await ctx.close();
  }

  /* ── 3 · one kural per PAGE: the views and the pages name their own ── */
  {
    const { ctx, p } = await open(standIn());
    await p.waitForSelector('[data-testid="kural-footer"]:not([hidden])');
    const got = {};
    for (const [tab, route_] of [['daybook', 'daybook'], ['receivables', 'sales'], ['pl', 'reports'], ['lock', 'month-lock'], ['gstclose', 'gst'], ['todo', 'accounts']]) {
      await p.click('[data-testid="acc-nav-' + tab + '"]'); await p.waitForTimeout(500);
      const v = await view(p); got[tab] = v && !v.hidden ? v.no : 'none';
      /* a view with a warning on screen (the Day book's "Walk-ins not closed yet" is not in this stand-in) is the next test; here none is */
      ok(got[tab] === String(byRoute(route_).no) || got[tab] === 'none', 'Accounts › ' + tab + ' → kural ' + byRoute(route_).no + ' (' + route_ + ') — ' + got[tab]);
    }
    ok(new Set(Object.values(got)).size >= 4, 'Accounts does not show one kural everywhere (' + JSON.stringify(got) + ')');
    await ctx.close();
    const c2 = await open(standIn(), { path: '/crm.html' });
    await c2.p.waitForSelector('[data-testid="kural-footer"]:not([hidden])');
    const a = (await view(c2.p)).no;
    await c2.p.evaluate(() => { location.hash = '#/followups'; }); await c2.p.waitForTimeout(500);
    const bb = (await view(c2.p));
    ok(a === '120' && bb && bb.no === '783', 'CRM: the parties list carries 120 and the follow-ups page 783 (' + a + ' → ' + (bb && bb.no) + ')');
    await c2.ctx.close();
  }

  /* ── 4 · by space ── */
  {
    const wide = await open(standIn(), { viewport: { width: 1366, height: 768 } });
    await wide.p.waitForSelector('[data-testid="kural-footer"]:not([hidden])');
    let v = await view(wide.p);
    ok(v.kv.dir === 'row' && Math.abs(v.kv.vt - v.kv.mt) < 40, 'wide (1366): the couplet and the meaning sit side by side');
    ok(v.kv.mo === '1' && v.kv.vo === '1', 'wide: both lines are shown at once');
    await wide.ctx.close();
    const mid = await open(standIn(), { viewport: { width: 1000, height: 768 } });
    await mid.p.waitForSelector('[data-testid="kural-footer"]:not([hidden])');
    v = await view(mid.p);
    ok(v.kv.dir === 'column' && v.kv.mt >= v.kv.vb - 2, 'narrow laptop (1000): the meaning sits BELOW the couplet');
    await mid.p.screenshot({ path: path.join(SHOTS, 'kural-accounts-meaning-below-1000.png') }).catch(() => {});
    await mid.ctx.close();
    const ph = await open(standIn(), { viewport: { width: 390, height: 844 }, clock: true });
    await ph.p.waitForSelector('[data-testid="kural-footer"]:not([hidden])');
    v = await view(ph.p);
    ok(v.kv.display === 'grid' && v.kv.vo === '1' && v.kv.mo === '0', 'phone (390): one line at a time — the couplet first, the meaning waiting in the same place');
    ok(v.sw === 390, 'phone: document.scrollWidth is 390 with the band');
    await ph.p.waitForTimeout(500); await ph.p.clock.fastForward(7100); await ph.p.waitForTimeout(700);   /* the band now paints in the very first moments (the frame is up at once); the fake clock needs a beat before a jump reaches a timer made that early */
    v = await view(ph.p);
    ok(v.kv.mo === '1' && v.kv.vo === '0', 'phone: after 7 s the two take turns (the meaning now shows)');
    await ph.p.screenshot({ path: path.join(SHOTS, 'kural-accounts-phone-meaning.png') }).catch(() => {});
    await ph.p.click('[data-testid="kural-body"]'); await ph.p.waitForTimeout(700);
    v = await view(ph.p);
    ok(v.kv.mo === '0' && v.kv.vo === '1', 'phone: a tap switches back');
    await ph.p.clock.fastForward(15000); await ph.p.waitForTimeout(700);
    v = await view(ph.p);
    ok(v.kv.mo === '0' && v.kv.vo === '1', 'phone: after a tap the person is in charge — it stops taking turns by itself');
    await ph.p.screenshot({ path: path.join(SHOTS, 'kural-accounts-phone.png') }).catch(() => {});
    await ph.ctx.close();
    const still = await open(standIn(), { viewport: { width: 390, height: 844 }, clock: true, reduce: true });
    await still.p.waitForSelector('[data-testid="kural-footer"]:not([hidden])');
    /* 8 s is ONE turn of the 7 s clock, so a clock that still runs shows it; at 30 s it is four turns, which flips back to where it began and hid the break */
    await still.p.clock.fastForward(8000); await still.p.waitForTimeout(700);
    v = await view(still.p);
    ok(v.kv.vo === '1' && v.kv.mo === '0', 'Less motion: 8 s later (one turn of the clock) it has NOT changed by itself');
    await still.p.clock.fastForward(22000); await still.p.waitForTimeout(700);
    v = await view(still.p);
    ok(v.kv.vo === '1' && v.kv.mo === '0', 'Less motion: 30 s later it has NOT changed by itself');
    await still.p.click('[data-testid="kural-body"]'); await still.p.waitForTimeout(700);
    v = await view(still.p);
    ok(v.kv.mo === '1' && v.kv.vo === '0', 'Less motion: a tap switches it');
    await still.ctx.close();
  }

  /* ── 5 · closable ── */
  {
    const { ctx, p } = await open(standIn());
    await p.waitForSelector('[data-testid="kural-footer"]:not([hidden])');
    ok(await p.locator('[data-testid="kural-hide"]').getAttribute('aria-label') === 'Hide the kural for today', '✕ is named "Hide the kural for today"');
    await p.click('[data-testid="kural-hide"]'); await p.waitForTimeout(200);
    let v = await view(p);
    ok(v && /^குறள் \d+ ›$/.test(clean(v.text)) && !v.verse, '✕ → the band is one small line, "குறள் N ›"');
    ok(v.bottom - v.top < 60, 'the small line is small (' + Math.round(v.bottom - v.top) + ' px)');
    await p.reload(); await p.waitForSelector('[data-testid="kural-footer"]:not([hidden])');
    v = await view(p);
    ok(v && /^குறள் \d+ ›$/.test(clean(v.text)), 'a reload keeps it away for the day');
    await p.click('[data-testid="kural-show"]'); await p.waitForTimeout(200);
    v = await view(p);
    ok(v && v.verse && v.verse.length === 2, '› brings the couplet back');
    await p.click('[data-testid="kural-hide"]');
    await p.evaluate(() => localStorage.setItem('kural.hidden', '2000-01-01')); await p.reload(); await p.waitForSelector('[data-testid="kural-footer"]:not([hidden])');
    v = await view(p);
    ok(v && v.verse && v.verse.length === 2, 'on another day it is back by itself');
    await ctx.close();
  }

  /* ── 6 · never beside a warning, never in a dialog ── */
  {
    const { ctx, p } = await open(standIn({ noClose: true }));
    await p.waitForSelector('[data-testid="kural-footer"]:not([hidden])');
    await p.click('[data-testid="acc-nav-daybook"]'); await p.waitForSelector('[data-testid="strip-noclose"]'); await p.waitForTimeout(300);
    ok(!(await shown(p)), 'the Day book with "Walk-ins not closed yet" on screen: the band is not drawn');
    await ctx.close();
    const ok2 = await open(standIn());
    await ok2.p.click('[data-testid="acc-nav-daybook"]'); await ok2.p.waitForSelector('[data-testid^="db-entry-"]'); await ok2.p.waitForTimeout(300);
    ok(await shown(ok2.p) && (await view(ok2.p)).no === '520', 'the same Day book with the day closed: kural 520 is there');
    await ok2.p.evaluate(() => { const c = document.createElement('span'); c.className = 'cbl-chip warn'; c.id = 'probe_warn'; c.textContent = 'Something needs a hand'; document.querySelector('.content').appendChild(c); });
    await ok2.p.waitForTimeout(300);
    ok(!(await shown(ok2.p)), 'an amber chip appears → the band goes');
    await ok2.p.evaluate(() => document.getElementById('probe_warn').remove()); await ok2.p.waitForTimeout(300);
    ok(await shown(ok2.p), 'the chip goes → the band comes back');
    await ok2.p.evaluate(() => { const d = document.createElement('dialog'); d.id = 'probe_dlg'; d.innerHTML = '<p>A dialog</p>'; document.body.appendChild(d); d.showModal(); });
    await ok2.p.waitForTimeout(300);
    ok(!(await shown(ok2.p)), 'a dialog is open → the band is not drawn');
    await ok2.p.evaluate(() => { const d = document.getElementById('probe_dlg'); d.close(); d.remove(); }); await ok2.p.waitForTimeout(300);
    ok(await shown(ok2.p), 'the dialog closes → the band returns');
    await ok2.ctx.close();
  }

  /* ── 7 · never in a message ── */
  {
    const { ctx, p } = await open(standIn(), { path: '/crm.html' });
    await p.waitForSelector('[data-testid="kural-footer"]:not([hidden])');
    const v = await view(p);
    ok(v && !v.inField, 'the band is not inside any text field or composer');
    const fields = await p.evaluate(() => Array.from(document.querySelectorAll('textarea,input,[contenteditable="true"]')).map((e) => (e.value || e.textContent || '')).join('\n'));
    const k = byRoute('crm-messages');
    ok(!TA.test(fields) && !fields.includes(k.verse[0]) && !fields.includes(k.meaning.en), 'no text field on the page holds a verse or its meaning');
    await ctx.close();
    const MSG = ['public/app/cap-messages.js', 'public/app/cap-crm-record.js', 'public/app/cap-dispute.js', 'public/app/cap-service.js'].filter((f) => fs.existsSync(path.join(PUB, '..', f.replace(/^public\//, 'public/'))) || fs.existsSync(path.join(PUB, f.replace(/^public\//, ''))));
    const src = MSG.map((f) => { const g = fs.existsSync(path.join(PUB, f.replace(/^public\//, ''))) ? path.join(PUB, f.replace(/^public\//, '')) : path.join(PUB, '..', f); return fs.readFileSync(g, 'utf8'); }).join('\n');
    ok(MSG.length >= 2 && !/kural|குறள்/i.test(src), 'no file that builds an outgoing message (' + MSG.map((f) => path.basename(f)).join(' · ') + ') mentions the kural');
  }

  /* ── 8 · tokens only: three themes, AA, never amber/blue, no italic ── */
  {
    const { ctx, p } = await open(standIn(), { viewport: { width: 1366, height: 768 } });
    await p.waitForSelector('[data-testid="kural-footer"]:not([hidden])');
    const themeBg = [];
    for (const th of ['cream', 'dark', 'terminal']) {
      await p.evaluate((t) => { CBAvatar.applyTheme(t); }, th);
      await p.waitForTimeout(150);
      const m = await p.evaluate(() => { const e = document.querySelector('[data-testid="kural-footer"]'), cs = (x) => getComputedStyle(x);
        return { bg: cs(e).backgroundColor, verse: cs(e.querySelector('.cbk-v')).color, mean: cs(e.querySelector('.cbk-m')).color, no: cs(e.querySelector('.cbk-no')).color, style: cs(e.querySelector('.cbk-m')).fontStyle + '/' + cs(e.querySelector('.cbk-v')).fontStyle,
          amberT: cs(document.documentElement).getPropertyValue('--amber-t').trim(), blue: cs(document.documentElement).getPropertyValue('--blue').trim(), border: cs(e).borderTopColor }; });
      themeBg.push(toHex(m.bg));
      const bg = toHex(m.bg), r1 = lk.ratio(toHex(m.verse), bg), r2 = lk.ratio(toHex(m.mean), bg), r3 = lk.ratio(toHex(m.no), bg);
      ok(bg && r1 >= 4.5 && r2 >= 4.5, th + ': the couplet (' + (r1 && r1.toFixed(1)) + ') and the meaning (' + (r2 && r2.toFixed(1)) + ') read at AA on the band');
      ok(r3 && r3 >= 3, th + ': the verse number reads (' + (r3 && r3.toFixed(1)) + ')');
      ok(m.style === 'normal/normal', th + ': no italic');
      ok(toHex(m.bg) !== toHex(m.amberT || '') && toHex(m.verse) !== toHex(m.blue || ''), th + ': neither amber (needs a hand) nor blue (a link)');
    }
    ok(new Set(themeBg).size === 3, 'the three themes really were applied — three different band backgrounds (' + themeBg.join(' ') + ')');
    const css = fs.readFileSync(path.join(PUB, 'app', 'kural.js'), 'utf8');
    const lit = (css.match(/CSS = \[([\s\S]*?)\]\.join/) || [, ''])[1].replace(/var\([^)]*\)/g, '').match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    ok(lit.length === 0, 'kural.js paints with tokens only — no colour literal outside a var() fallback (' + lit.length + ' found)');
    await ctx.close();
  }

  /* ── 9 · languages ── */
  {
    for (const [lang, want] of [['ta', 'en'], ['hi', 'en']]) {
      const { ctx, p } = await open(standIn(), { seed: "try{localStorage.setItem('cb_lang','" + lang + "')}catch(_){}" });
      await p.waitForSelector('[data-testid="kural-footer"]:not([hidden])').catch(() => {});
      const v = await view(p), k = byRoute('accounts');
      ok(v && v.meaning === k.meaning.en && !TA.test(v.meaning), 'app language ' + lang + ': the English translation shows (no meaning.' + lang + ' in the kit)');
      await ctx.close();
    }
    const { ctx, p } = await open(standIn());
    await p.waitForSelector('[data-testid="kural-footer"]:not([hidden])');
    const unk = await p.evaluate(async () => { await CBKural.set('no-such-page'); const e = document.querySelector('[data-testid="kural-footer"]'); const a = !e || e.hidden; await CBKural.set('accounts'); return a; });
    ok(unk, 'a route the kit does not know draws nothing');
    ok(await p.evaluate(async () => { await CBKural.set('accounts'); return !!document.querySelector('[data-testid="kural-footer"] [data-testid="kural-verse"]'); }), 'and a known route draws again');
    await ctx.close();
  }

  ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw.slice(0, 3).join(' | ') : ''));
  const strange = offHost.filter((u) => !/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(u));
  ok(...C.finish());
  ok(strange.length === 0, 'nothing but the stand-in was reachable' + (strange.length ? ' — refused: ' + strange[0] : ''));
  await b.close(); srv.close();
  console.log('\n  kural-footer: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

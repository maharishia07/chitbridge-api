#!/usr/bin/env node
/**
 * e2e/walk-home.cjs - THE HOME PAGE, WALKED (rows H1-H37 of C:/dev/TEST-LOG-2026-10-09.md that are READ-ONLY and were fixed or are meant to keep working).
 * Black box: it drives the controls a person touches (the rail's digits, the chips, the cards, the bell, the avatar, the left menu) and says what the
 * screen showed. Signed in as a FIXTURE shop ("Fixture Shop" / CBWALK0001): the site is served from this checkout and the API is a stand-in answering inside
 * the page, so nothing reaches localhost:3000 or the live site and nothing is written anywhere.
 * Open rows (H20 till sign-in, H34/H35 avatar doors, H12-H15 roadmap wording) are listed at the end as NOTE lines, not asserted.
 * THE LISTS ROUND (2026-10-09): C8-C11 (CRM one line per party · the formatted mini-card · only the rows scroll), O6/C9 (an internal .cr handle is never an e-mail), Z1 (zebra rows),
 * UI9 (no layout jump: the whole frame in the first paint, only the rows change — CRM and Home), P2-2 (the kural is ALWAYS in the footer, above the tab bar on a phone).
 *
 *   NODE_PATH=e2e/node_modules node e2e/walk-home.cjs            headless, fast
 *   node e2e/walk-home.cjs --show                                 watch it: headed, captions, green/red per step, a results page that stays open
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-home-NN.png.
 */
'use strict';
const TD = require('./lib/today.cjs');
const fs = require('fs'), path = require('path');
const W = require('./lib/walk.cjs');
const books = require('./lib/books-api.cjs'), crmApi = require('./lib/crm-api.cjs');
const FX = crmApi.resolve(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden-parties.json'), 'utf8')), TD.nowMs());   /* the designer's golden parties: so the CRM page draws a real toolbar */
const C = require('./lib/contract.cjs');   /* M43: every /api/books and /api/crm answer this stand-in serves is held to the API contract */
const J = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

W.run('home', async (w) => {
  const { page, ctx, base } = w;
  /* the day as the log found it: 24 in, 0 out, 21 stuck; 1 supplier, 2 customers (self excluded); one posting waiting for the ledger */
  const RAIL = crmApi.railFacts({ suppliers: 1, customers: 2, in: 24, out: 0, stuck: 21 });
  /* Home's rail is "Your work" since 17 Oct (4652ab12, Athi's index walk): ONE read, GET /api/work/facts, figures the server computed; the old suppliers · in · out · stuck chips are gone */
  const WORK = { truncated: false, counts: { orders_in: 24, orders_out: 0, tasks: 5, done: 7 }, lines: [{ text: '3 new orders', value: 3, tone: 'dn' }], figures: { orders_new: 3, orders_in: 24, orders_out: 0, tasks: 5, tasks_mine: 2, done: 7 } };
  await ctx.route('**/api/**', (r0) => {
    const r = C.wrap(r0);
    const u = new URL(r.request().url());
    if (u.pathname === '/api/facts/rail') return J(r, 200, RAIL);
    if (u.pathname === '/api/work/facts') return J(r, 200, WORK);
    if (u.pathname === '/api/books/health') return J(r, 200, books.health({ waiting: [books.waitingRow({ id: 1, reason: 'September is locked.' })] }));
    if (u.pathname === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR' } });
    if (u.pathname === '/api/crm/parties') return J(r, 200, crmApi.list(FX.list, { records: FX.records }));
    if (u.pathname === '/api/crm/followups') return J(r, 200, crmApi.followups([]));
    return J(r, 404, { error: 'not found' });
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, require('./lib/walk.cjs').session('Fixture Owner', 'Fixture Shop'));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'manifest.json'), 'utf8'));
  const home = async () => { await page.goto(base + '/'); await page.waitForSelector('[data-testid="cbshell"]', { timeout: 20000 }); await page.evaluate(() => window.SHELL && window.SHELL.ready); await page.waitForSelector('[data-testid="rail"]', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(300); };
  await home();

  /* H1 H2-r H4 H10-r H11 H16-r pinned the OLD Home: a rail of suppliers · in · out · stuck chips (read from /api/facts/rail) and a roadmap fold. Athi's index walk of
     17 Oct (commit 4652ab12 "Home, first impression") replaced the rail by "Your work" (/api/work/facts: new orders · orders in · orders out · tasks for you · done, each
     figure a door to its folder in Tasks & Orders) and took the roadmap off Home (index.html "the roadmap is our own self-declaration"; roadmap.js retired, RETIRED.md).
     The same six paths now walk the same promises on what Home draws: figures are the server's, each is a door with a word on it, a click opens its folder, no second roadmap. */
  await w.step('H1', 'Home -> "Your work" shows 3 new · 24 in · 0 out · 2 for you · 7 done, and each figure is a door to its folder', async () => {
    const pips = await page.$$eval('[data-testid="rail"] a.node', (as) => as.map((a) => ({ t: a.textContent.replace(/\s+/g, ' ').trim().replace(/^(\d+)\s*/, '$1 '), href: a.getAttribute('href') })));   /* the figure and its word sit in two spans: "3" + "New orders" */
    const want = [['3 New orders', /\/tasks\.html\?view=orders_in$/], ['24 Orders in', /\/tasks\.html\?view=orders_in$/], ['0 Orders out', /\/tasks\.html\?view=orders_out$/], ['2 Tasks for you', /\/tasks\.html\?view=tasks$/], ['7 Done', /\/tasks\.html\?view=done$/]];
    const ok = want.every(([t, h]) => pips.some((p) => p.t === t && h.test(p.href || '')));
    return { ok, saw: 'figures: ' + pips.map((p) => p.t + ' -> ' + (p.href || 'NOT A LINK')).join(' | ') };
  });
  await w.step('H2-r', 'Home "Your work" vs the server -> each number is exactly what /api/work/facts said (none made up, none 0 for a missing one)', async () => {
    const got = {}; for (const k of ['new', 'in', 'out', 'mine', 'done']) got[k] = await txt('[data-testid="work-' + k + '"]');
    return { ok: got.new === '3' && got.in === '24' && got.out === '0' && got.mine === '2' && got.done === '7', saw: JSON.stringify(got) };
  });
  await w.step('H4', 'Home -> "24 Orders in" is a door with a word on it, not a bare number', async () => {
    const t = await txt('[data-testid="work-in-open"]'); const tag = await page.locator('[data-testid="work-in-open"]').first().evaluate((e) => e.tagName);
    return { ok: /^24\s*Orders in$/.test(t) && tag === 'A', saw: '"' + t + '" is ' + (tag === 'A' ? 'a link' : 'plain text') };
  });
  await w.step('H10-r', 'Home -> click "24 Orders in" -> opens Tasks & Orders on the Orders in folder', async () => {
    await Promise.all([page.waitForNavigation({ timeout: 10000 }).catch(() => null), page.click('[data-testid="work-in-open"]')]);
    await page.waitForTimeout(400);
    const u = page.url();
    return { ok: /\/tasks\.html/.test(u) && /view=orders_in/.test(u), saw: 'went to ' + u.replace(base, '') };
  });
  await home();
  await w.step('H11', 'Home -> click "2 Tasks for you" -> Tasks & Orders on the Tasks folder', async () => {
    await page.click('[data-testid="work-mine-open"]'); await page.waitForTimeout(500);
    const u = page.url();
    return { ok: /\/tasks\.html/.test(u) && /view=tasks/.test(u), saw: 'went to ' + u.replace(base, '') };
  });
  await home();
  await w.step('H16-r', 'Home signed in -> no roadmap is drawn (the cards are not said twice; the comparison lives in Standards)', async () => {
    const n = await page.locator('[data-testid="roadmap"]').count(), fold = await page.locator('[data-testid="rm-going"]').count();
    return { ok: n === 0 && fold === 0, saw: n + ' roadmap block, ' + fold + ' fold' };
  });
  await w.step('H22-r', 'Home -> Storefront card -> a link to this shop\'s own page, not "No shop specified"', async () => {
    const h = await page.getAttribute('[data-testid="shell-card-storefront"]', 'href');
    return { ok: /^\/shop\.html\?s=CBWALK0001$/.test(h || ''), saw: 'link is ' + h };
  });
  await w.step('H23-H24', 'Home -> Know your business and Documents cards -> real pages in the same frame, never the workshop', async () => {
    const a = await page.getAttribute('[data-testid="shell-card-kyb"]', 'href'), b = await page.getAttribute('[data-testid="shell-card-documents"]', 'href');
    const lands = [];
    for (const h of [a, b]) { const p2 = await ctx.newPage(); await p2.goto(base + h); await p2.waitForSelector('[data-testid="shell-header"], header, h1', { timeout: 15000 }).catch(() => {}); lands.push(await p2.evaluate(() => !!document.querySelector('[data-testid="shell-header"]'))); await p2.close(); }
    return { ok: !!a && !!b && !/app\.html/.test(a + b) && lands.every(Boolean), saw: a + ' (shell header ' + lands[0] + ') - ' + b + ' (shell header ' + lands[1] + ')' };
  });
  await w.step('H36-r', 'Home -> Catalogue card -> CB Catalogue (T3-CATALOGUE: built, its own small app)', async () => {
    const h = await page.locator('[data-testid="shell-card-catalogue"]').first().getAttribute('href').catch(() => null);
    return { ok: /\/catalogue\.html/.test(h || ''), saw: 'the card links to ' + h };
  });
  await w.step('H37', 'Left menu -> Running -> scrolls Home to that section', async () => {
    const nav = page.locator('[data-testid="shell-nav-running"]').first();
    if (!(await nav.count())) return { ok: false, saw: 'no "Running" entry in the left menu' };
    await nav.click(); await page.waitForTimeout(600);
    const vis = await page.evaluate(() => { const s = document.querySelector('.cbsh-sec.running'); if (!s) return null; const r = s.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; });
    return { ok: vis !== false, saw: vis === null ? 'the section is its own page' : 'the Running section is on screen' };
  });
  /* ROUND P: CB Commerce pillar boxes - the manifest places every entry in ONE box; Home draws them in order; no new read */
  const PIL = ['marketing', 'sales', 'finance', 'accounting', 'operations', 'people', 'trade'];
  const BOXED = ['marketing', 'sales', 'finance', 'accounting'];
  await w.step('P1', 'Manifest -> every entry has a pillar, and the pillars are the nine known words', async () => {
    const known = PIL.concat(['labs', 'setup']), bad = man.entries.filter((e) => known.indexOf(e.pillar) < 0).map((e) => e.id);
    const need = ['marketing', 'finance', 'operations'].filter((id) => { const e = man.entries.find((x) => x.id === id); return !e || e.state === 'built' && !e.route || !e.what && id !== 'trade'; });   /* marketing: built since T3-P2-CRM (route + facts) */
    return { ok: !bad.length && !need.length, saw: bad.length ? 'no/odd pillar: ' + bad.join() : need.length ? 'missing box: ' + need.join() : man.entries.length + ' entries, all placed; the coming boxes exist' };
  });
  const reqs = []; const onReq = (rq) => { const u = new URL(rq.url()); if (u.pathname.indexOf('/api/') === 0) reqs.push(u.pathname); };
  page.on('request', onReq);
  await page.setViewportSize({ width: 1366, height: 800 }); await home(); await page.waitForTimeout(800);
  page.off('request', onReq);
  await w.step('P2', 'Home -> Selling + Money: the four pillar boxes in order (two, then two), each card once, the coming boxes show no figure', async () => {
    const r = await page.evaluate(() => {
      const ps = [...document.querySelectorAll('.cbsh-pil')].map((p) => p.dataset.pillar);
      const ids = [...document.querySelectorAll('[data-testid^="shell-card-"],[data-testid^="shell-chip-"]')].map((e) => e.dataset.id || e.getAttribute('data-testid').replace(/^shell-(card|chip)-/, ''));
      const comingFacts = ['operations', 'delivery'].map((id) => { const c = document.querySelector('[data-testid="shell-chip-' + id + '"]'); return c ? c.innerText.replace(/\s+/g, ' ').trim() : 'MISSING ' + id; });   /* marketing (T3-P2-CRM) and finance are cards now */
      const cap = (document.querySelector('.cbsh-sec.selling .cbsh-cap b') || {}).textContent;
      const rows = ['selling', 'money'].map((a) => [...document.querySelectorAll('.cbsh-sec.' + a + ' .cbsh-pil')].map((p) => Math.round(p.getBoundingClientRect().top)).filter((v, i, x) => x.indexOf(v) === i).length);
      return { ps, dup: ids.filter((v, i) => ids.indexOf(v) !== i), comingFacts, cap, rows };
    });
    const inOrder = r.ps.join() === BOXED.join();   /* NAMES-1: Running it (operations · people) and Trade draw flat, so only Selling and Money have boxes */
    const noFig = r.comingFacts.every((s) => !/\d/.test(s));
    return { ok: inOrder && !r.dup.length && noFig && r.cap === 'Selling' && r.rows.join() === '1,1', saw: 'title ' + r.cap + ' | boxes ' + r.ps.join(' > ') + ' | repeated: ' + (r.dup.join() || 'none') + ' | rows ' + r.rows.join('+') + ' | coming boxes: ' + r.comingFacts.join(' / ') };
  });
  await w.step('P3', 'Home -> the pillar boxes add no read: every /api call is one the manifest or Home already makes', async () => {
    const own = new Set(man.entries.filter((e) => e.state === 'built' && e.facts).map((e) => e.facts));
    const known = new Set(['/api/facts/rail', '/api/books/health', '/api/entities/me', '/api/entities/header', '/api/crm/parties', '/api/crm/followups', '/api/entities/sides']);
    const strange = [...new Set(reqs)].filter((p) => !own.has(p) && !known.has(p) && !/^\/api\/(notifications|events|sides|me|session|counters|catalogue|offers|network|messages|reference)/.test(p));
    return { ok: !strange.length && !reqs.some((p) => !own.has(p) && /finance|marketing|people|operations/.test(p)),   /* a pillar's own built card (its manifest facts URL, e.g. /api/facts/operations since T3-OPS) is not a box reading; CB Employees: /api/facts/people, PEOPLE-SRV1 */ saw: reqs.length + ' calls (' + [...new Set(reqs)].join(', ') + ')' + (strange.length ? ' - NEW: ' + strange.join() : '') };
  });
  const PS = path.join(__dirname, 'shots', 'pillars'); fs.mkdirSync(PS, { recursive: true });
  await w.step('P4', 'Home at 1366 and 390 -> the boxes fit the width (no sideways scroll), shots saved', async () => {
    const out = [];
    for (const [vw, vh] of [[1366, 800], [390, 844]]) {
      await page.setViewportSize({ width: vw, height: vh }); await home(); await page.waitForTimeout(500);
      if (vw === 390) { await page.click('[data-testid="shell-nav-selling"]').catch(() => {}); await page.waitForTimeout(500); }
      const m = await page.evaluate(() => { const mn = document.querySelector('.cbsh-main'); return { over: mn.scrollWidth - mn.clientWidth, boxes: [...document.querySelectorAll('.cbsh-pil')].filter((p) => p.offsetParent).length }; });
      await page.screenshot({ path: path.join(PS, 'home-' + vw + '.png') });
      if (vw === 1366) { await page.evaluate(() => { const s = document.querySelector('.cbsh-main'); if (s) s.scrollTop = 0; }); await page.screenshot({ path: path.join(PS, 'home-' + vw + '-full.png'), fullPage: true }).catch(() => {}); }
      if (vw === 390) { await page.click('[data-testid="shell-nav-running"]').catch(() => {}); await page.waitForTimeout(400); await page.screenshot({ path: path.join(PS, 'home-390-supporting.png') }); }
      out.push(vw + ': overflow ' + m.over + ', ' + m.boxes + ' boxes in view');
      if (m.over > 1) return { ok: false, saw: out.join(' | ') };
    }
    return { ok: true, saw: out.join(' | ') };
  });
  await page.setViewportSize({ width: 1366, height: 800 }); await home();
  await w.step('H30', 'Shop button -> the sheet opens, Esc closes it', async () => {
    await page.click('[data-testid="shell-shop"]'); const opened = await page.locator('[data-testid="shell-sheet"]').isVisible().catch(() => false);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const closed = !(await page.locator('[data-testid="shell-sheet"]').isVisible().catch(() => false));
    return { ok: opened && closed, saw: 'sheet ' + (opened ? 'opened' : 'did not open') + ', then ' + (closed ? 'closed on Esc' : 'stayed open') };
  });
  await w.step('H33', 'Bell -> opens, and what it lists reads as words (no "undefined", no "null")', async () => {
    const b = page.locator('[data-testid="shell-bell"]').first();
    if (!(await b.count())) return { ok: false, saw: 'no bell on Home' };
    await b.click(); await page.waitForTimeout(500);
    const t = await page.evaluate(() => (document.body.innerText || ''));
    return { ok: !/\bundefined\b|\bnull\b|\[object/.test(t), saw: 'the bell panel opened; no placeholder words on screen (the fixture serves no notifications, so row wording is not checked here)' };
  });
  await w.step('H27-28', 'Home -> signed in the whole way: no error text, no sign-in asked again', async () => {
    const t = await page.evaluate(() => document.body.innerText || '');
    return { ok: !/404|error|not signed in|send code/i.test(t) && w.errs.length === 0, saw: w.errs.length ? 'page error: ' + w.errs[0] : 'no error words, no code box' };
  });

  /* ── LAYOUT (UI1-UI8, 2026-10-09): at four widths, no two header/toolbar controls overlap, and the kural band is in one place ── */
  const probe = () => page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < 190 && r.right > 0 && r.left < innerWidth; };
    const nm = (e) => (e.getAttribute('data-testid') || e.getAttribute('aria-label') || e.textContent || e.tagName).trim().replace(/s+/g, ' ').slice(0, 24);
    const els = [...document.querySelectorAll('button, a[href], input, select, [role="button"], h1, h2, .cbsh-name, [data-testid="shell-shop"]')].filter(vis).filter((e) => !e.closest('#__walkbanner'));
    const bad = [];
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j]; if (a.contains(b) || b.contains(a)) continue;
      const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
      const ox = Math.min(x.right, y.right) - Math.max(x.left, y.left), oy = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
      if (ox > 3 && oy > 3) bad.push(nm(a) + ' over ' + nm(b));
    }
    const k = document.querySelector('#cbkural, [data-testid="kural"], .cbkural');
    let band = null;
    if (k) { const r = k.getBoundingClientRect(); const lines = [...k.querySelectorAll('*')].filter((e) => e.children.length === 0 && (e.textContent || '').trim()).map((e) => e.getBoundingClientRect());
      let lap = 0; for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) { const a = lines[i], b = lines[j]; if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 3 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 3) lap++; }
      band = { where: (r.top + r.height / 2) < innerHeight / 2 ? 'top' : 'bottom', w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, linesOverlap: lap, inside: r.left >= -1 && r.right <= innerWidth + 1 }; }
    return { bad: bad.slice(0, 4), n: els.length, band };
  });
  const goPage = async (url) => { await page.goto(base + url); await page.waitForSelector('[data-testid="cbshell"], header, h1', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(700); };
  const bands = {};
  for (const [pg, url] of [['Home', '/'], ['CRM', '/crm.html']]) {
    bands[pg] = [];
    for (const vw of [390, 957, 1366, 1568]) {
      await page.setViewportSize({ width: vw, height: 860 });
      await w.step('L-' + pg + '-' + vw, pg + ' at ' + vw + ' px -> no two header / toolbar controls overlap, and the kural band is not squeezed over its own lines', async () => {
        await goPage(url); const r = await probe(); bands[pg].push({ vw, band: r.band });
        const bandBad = r.band && (r.band.linesOverlap > 0 || !r.band.inside);
        return { ok: r.bad.length === 0 && !bandBad, saw: r.n + ' controls in the top of the page; ' + (r.bad.length ? 'OVERLAP: ' + r.bad.join('; ') : 'none overlap') + '; band ' + (r.band ? r.band.where + ', ' + r.band.w + 'x' + r.band.h + (bandBad ? ', ITS LINES OVERLAP / it spills off the screen' : ', lines clear') : 'not on this page') };
      });
    }
    await w.step('L-' + pg + '-band', pg + ' -> the kural band is in ONE place at every width (390 / 957 / 1366 / 1568)', async () => {
      const seen = bands[pg].filter((x) => x.band); if (!seen.length) return { ok: true, saw: 'no band on this page at any width' };
      const places = [...new Set(seen.map((x) => x.band.where))];
      return { ok: places.length === 1, saw: seen.map((x) => x.vw + 'px: ' + x.band.where).join(' | ') };
    });
  }
  await page.setViewportSize({ width: 1280, height: 860 });

  /* ── THE LISTS ROUND (2026-10-09) ── */
  FX.list.forEach((q) => { if (q.party_no === 'P-0004') q.email = '9894055621@fixture-shop.cr'; if (q.party_no === 'P-0005') q.email = 'meena.s=outlook.com@fixture-shop.cr'; });
  await page.setViewportSize({ width: 1366, height: 800 });
  await goPage('/crm.html'); await page.waitForSelector('[data-testid^="crm-row-"]', { timeout: 15000 }); await page.waitForTimeout(300);
  await w.step('C10', 'CRM -> Parties -> ONE line per party, in columns (Role · On the network · Dues · Last activity · Next follow-up), nothing stacked under the name', async () => {
    const g = await page.evaluate(() => ({ heads: Array.from(document.querySelectorAll('#crm_list .cbl-hc')).map((h) => h.textContent.replace(/[▲▼⇅▾●]/g, '').trim()), rows: Array.from(document.querySelectorAll('#crm_list .cbl-row')).map((r) => Math.round(r.getBoundingClientRect().height)), stacked: document.querySelectorAll('#crm_list .cbl-row .l2, #crm_list .cbl-row .tag').length }));
    return { ok: /Party/i.test(g.heads[0]) && g.heads.some((h) => /^role$/i.test(h)) && g.heads.some((h) => /on the network/i.test(h)) && g.rows.length >= 5 && g.rows.every((h) => h <= 56) && g.stacked === 0, saw: 'columns ' + g.heads.join(' · ') + '; row heights ' + g.rows.join('/') + ' px; ' + g.stacked + ' chips under a name' };
  });
  await w.step('C11', 'CRM -> the title, views and toolbar stay put while the rows scroll', async () => {
    const t0 = await page.evaluate(() => document.querySelector('.cbl-tools').getBoundingClientRect().top);
    await page.evaluate(() => { const l = document.querySelector('#crm_list .cbl-list'); l.scrollTop = 300; const rs = document.querySelectorAll('#crm_list [data-row]'); rs[rs.length - 1].scrollIntoView({ block: 'end' }); });
    const t1 = await page.evaluate(() => ({ tools: document.querySelector('.cbl-tools').getBoundingClientRect().top, scr: document.getElementById('screen').scrollTop, doc: document.documentElement.scrollTop }));
    return { ok: t1.tools === t0 && t1.scr === 0 && t1.doc === 0, saw: 'toolbar at ' + t0 + ' px before, ' + t1.tools + ' after; the screen scrolled ' + t1.scr + ', the page ' + t1.doc };
  });
  await w.step('C8', 'CRM -> ▸ opens a formatted mini-card: contact · money · last chits · every action (the refused one greyed with its sentence)', async () => {
    await page.click('[data-testid="crm-row-P-0003"] [data-caret]'); await page.waitForSelector('[data-testid="crm-mini-P-0003"]'); await page.waitForTimeout(500);
    const g = await page.evaluate(() => ({ boxes: document.querySelectorAll('[data-testid="crm-mini-P-0003"] .mc-box').length, tel: !!document.querySelector('[data-testid="crm-mini-phone-P-0003"] a[href^="tel:"]'), acts: Array.from(document.querySelectorAll('#crm_list .cbl-next [data-act]')).map((b) => b.getAttribute('data-act') + (b.disabled ? ':off' : '')), why: (document.querySelector('[data-testid="crm-mini-message-why"]') || {}).textContent || '' }));
    await page.click('[data-testid="crm-row-P-0003"] [data-caret]');
    return { ok: g.boxes === 3 && g.tel && g.acts.join() === 'call,message:off,pay,followup,open' && /Not on the network/.test(g.why), saw: g.boxes + ' boxes; actions ' + g.acts.join(' ') + '; Message says "' + g.why + '"' };
  });
  await w.step('C9-O6', 'CRM -> an internal handle (…@fixture-shop.cr) is never shown as an e-mail — list, E-mail column, mini-card', async () => {
    await page.click('[data-testid="cols-btn-crm-parties"]'); await page.check('[data-testid="cols-crm-parties-email"]'); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await page.click('[data-testid="crm-row-P-0004"] [data-caret]'); await page.waitForSelector('[data-testid="crm-mini-email-P-0004"]');
    const t = await page.evaluate(() => document.body.textContent), mini = await txt('[data-testid="crm-mini-email-P-0004"]');
    await page.click('[data-testid="crm-row-P-0004"] [data-caret]');
    return { ok: !/@fixture-shop\.cr/i.test(t) && /meena\.s@outlook\.com/.test(t) && /no e-mail/.test(mini), saw: 'handle on screen: ' + /@fixture-shop\.cr/i.test(t) + '; the encoded one reads meena.s@outlook.com: ' + /meena\.s@outlook\.com/.test(t) + '; the phone handle says "' + mini + '"' };
  });
  await w.step('Z1', 'CRM -> every other row is a different shade, and the row under the pointer is neither', async () => {
    const g = await page.evaluate(() => { const bg = (e) => getComputedStyle(e).backgroundColor, rs = Array.from(document.querySelectorAll('#crm_list .cbl-row')); return { a: bg(rs[0]), b: bg(rs[1]), c: bg(rs[2]) }; });
    await page.hover('[data-testid="crm-row-P-0002"]'); await page.waitForTimeout(80);
    const h = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="crm-row-P-0002"]')).backgroundColor);
    await page.mouse.move(2, 2);
    return { ok: g.a === g.c && g.a !== g.b && h !== g.a && h !== g.b, saw: 'rows ' + g.a + ' / ' + g.b + ' / ' + g.c + '; hovered ' + h };
  });
  await w.step('UI9-crm', 'CRM -> slow connection: the whole frame is there first (menu, title, toolbar, header, skeleton rows, the kural\'s room); when the rows arrive nothing above them moves', async () => {
    const slow = async (r) => { await new Promise((x) => setTimeout(x, 1500)); r.fallback(); };
    await ctx.route('**/api/**', slow);
    await page.goto(base + '/crm.html'); await page.waitForTimeout(450);   /* a fixed beat, before the slow line answers anything: this IS the first paint */
    const box = () => page.evaluate(() => { const r = (s, n) => { const e = document.querySelectorAll(s)[n || 0]; if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
      return { nav: document.querySelectorAll('#nav .nav-btn').length, n0: r('#nav .nav-btn', 0), title: r('.cbl-title'), tools: r('.cbl-tools'), hdr: r('.cbl-hdr'), skel: document.querySelectorAll('.cbl-skel').length, band: r('#cbkural,#cbkural-reserve'), rows: document.querySelectorAll('.cbl-row').length }; });
    const a = await box();
    await page.waitForSelector('[data-testid^="crm-row-"]', { timeout: 15000 }); await page.waitForTimeout(500);
    const z = await box(); await ctx.unroute('**/api/**', slow);
    const same = (p, q) => !!p && !!q && p.every((v, i) => Math.abs(v - q[i]) <= 1);
    /* the menu has grown (Leads, Calls): the first paint must hold ALL of it — the same count before and after the rows arrive */
    return { ok: a.nav >= 3 && a.nav === z.nav && !!a.title && !!a.tools && !!a.hdr && a.skel >= 5 && a.rows === 0 && !!a.band && same(a.n0, z.n0) && same(a.title, z.title) && same(a.tools, z.tools) && same(a.hdr, z.hdr), saw: 'first paint: ' + a.nav + ' menu items, title, toolbar, header, ' + a.skel + ' skeleton rows, kural room ' + (a.band && a.band[3]) + ' px; toolbar ' + JSON.stringify(a.tools) + ' → ' + JSON.stringify(z.tools) };
  });
  await page.setViewportSize({ width: 1366, height: 800 });
  await w.step('UI9-home', 'Home -> the sidebar and header are in the first paint and do not move when the cards arrive', async () => {
    const slow = async (r) => { await new Promise((x) => setTimeout(x, 1500)); r.fallback(); };
    await ctx.route('**/app/manifest.json', slow); await ctx.route('**/api/**', slow);
    await page.goto(base + '/'); await page.waitForSelector('[data-testid="shell-header"]', { timeout: 8000 }); await page.waitForTimeout(250);
    const box = () => page.evaluate(() => { const r = (s, n) => { const e = document.querySelectorAll(s)[n || 0]; if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
      return { nav: document.querySelectorAll('[data-testid^="shell-nav-"]').length, n0: r('[data-testid="shell-nav-home"]'), n1: r('[data-testid="shell-nav-running"]'), hdr: r('[data-testid="shell-header"]'), title: r('.cbsh-ph'), band: r('#cbkural,#cbkural-reserve') }; });
    const a = await box();
    await page.waitForSelector('[data-testid="rail-suppliers"]', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(600);
    const z = await box(); await ctx.unroute('**/app/manifest.json', slow); await ctx.unroute('**/api/**', slow);
    const same = (p, q) => !!p && !!q && p.every((v, i) => Math.abs(v - q[i]) <= 1);
    return { ok: a.nav >= 4 && same(a.n0, z.n0) && same(a.n1, z.n1) && same(a.hdr, z.hdr) && same(a.title, z.title) && !!a.band, saw: 'first paint: ' + a.nav + ' menu items, header ' + JSON.stringify(a.hdr) + ', title ' + JSON.stringify(a.title) + ', kural room ' + (a.band && a.band[3]) + ' px; after: menu ' + JSON.stringify([z.n0, z.n1]) + ' header ' + JSON.stringify(z.hdr) };
  });
  await w.step('P2-2', 'Home -> the kural is in the FOOTER on every width: under the page on a laptop, above the tab bar on a phone — never a card in the middle', async () => {
    const where = () => page.evaluate(() => { const k = document.querySelector('#cbkural'); if (!k) return null; const nav = document.querySelector('[data-testid="shell-nav"]'), r = k.getBoundingClientRect(), n = nav && nav.getBoundingClientRect(); return { inFoot: !!k.closest('[data-testid="shell-foot"],[data-testid="shell-pfoot"]'), inSec: !!k.closest('.cbsh-sec'), bottom: Math.round(r.bottom), navTop: n ? Math.round(n.top) : null, navLeft: n ? Math.round(n.left) : null, ih: innerHeight, hidden: k.hidden }; });
    /* the band is the OWNER'S choice since WALK-REG 2026-10-16 (off for an English shop by default, on when chosen: walk-settings-walk1 A25), so this walk chooses it first */
    await page.evaluate(() => { try { localStorage.setItem('cb_kural', 'on'); } catch (_) {} });
    await page.setViewportSize({ width: 390, height: 844 }); await goPage('/'); await page.waitForSelector('#cbkural:not([hidden])', { timeout: 8000 }).catch(() => {});
    const ph = await where();
    await page.setViewportSize({ width: 1366, height: 800 }); await goPage('/'); await page.waitForSelector('#cbkural:not([hidden])', { timeout: 8000 }).catch(() => {});
    const lp = await where();
    const phoneOk = ph && !ph.hidden && ph.inFoot && !ph.inSec && ph.navTop != null && ph.bottom <= ph.navTop + 1, lapOk = lp && !lp.hidden && lp.inFoot && !lp.inSec;
    return { ok: !!phoneOk && !!lapOk, saw: 'phone: ' + JSON.stringify(ph) + ' | laptop: ' + JSON.stringify(lp) };
  });
  await page.setViewportSize({ width: 1280, height: 860 });
  await w.step('H14-chip', 'Home -> the Connectors chip does not say WORKSHOP when Tally + Zoho work (manifest works = true)', async () => {
    await goPage('/'); await page.waitForSelector('[data-testid="shell-chip-connectors"], [data-testid="shell-card-connectors"]', { timeout: 15000 });
    /* T3-SETTINGS: Connectors is BUILT (CB Settings › Connectors) — a built door is a card, never a chip, so it cannot say workshop */
    if (await page.locator('[data-testid="shell-card-connectors"]').count()) {
      const others = await page.$$eval('[data-testid^="shell-chip-"][data-state="workshop"]', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
      return { ok: others.every((t) => !/Connectors/.test(t)), saw: 'Connectors is a built card (Settings); chips still marked workshop: ' + others.length };
    }
    const c = await page.locator('[data-testid="shell-chip-connectors"]').first().evaluate((e) => ({ st: e.getAttribute('data-state'), t: e.textContent.replace(/\s+/g, ' ').trim() }));
    const others = await page.$$eval('[data-testid^="shell-chip-"][data-state="workshop"]', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    return { ok: c.st === 'works' && !/workshop/i.test(c.t) && /works today/i.test(c.t) && others.every((t) => !/Connectors/.test(t)), saw: '"' + c.t + '" (state ' + c.st + '); chips still marked workshop: ' + others.length };
  });

  await w.step('M43', 'the stand-in answered every /api/books and /api/crm call as the API contract says', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });

  w.note('H20', 'Home -> Till card, owner signed in', 'open (BACKLOG): the till still asks to sign in - not asserted here, see walk-bill');
  w.note('H34-35', 'Avatar menu -> Profile / Support / Settings doors', 'open: the doors still go to the workshop - not asserted');
  w.note('H12-15', 'Home -> roadmap wording and plan ids', 'open: wording review, not a pass/fail path');
});
